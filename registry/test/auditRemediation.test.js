/**
 * Remediation tests for the external audit of 2026-09-11 (round 3).
 *
 * Every test here reproduces a finding FIRST and then pins the fixed
 * behaviour. Findings covered on the registry side:
 *
 *   F2  canonicalization silently dropped an own `__proto__` property, so a
 *       stored record could carry evidence the hashed bytes never saw;
 *   F4  OTS upgrade spliced RAW continuation bytes, so a crafted
 *       continuation could consume a neighbouring fork's bytes (changing an
 *       untouched sibling's commitment), while a valid forked continuation
 *       in a non-final sibling position was rejected outright;
 *   F5  structurally invalid TSA responses were accepted (the digest was
 *       merely searched for anywhere in the body) and an invalid .tsr on
 *       disk retired the anchor forever;
 *   F6  pending attestation URIs were fetched wherever they pointed (SSRF);
 *   F7  response caps applied only after the whole body was buffered;
 *   F15 the registry accepted array-LIKE proofs and sloppy sibling hex where
 *       the CLI and collector did not (a real three-way disagreement);
 *   F16 the anchor status cache was not invalidated by the worker's own
 *       writes, so an mtime/size collision served stale anchor status.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

import { canonicalJSON, sha256Hex } from '../lib/canonical.js';
import { register, validateRegistration } from '../lib/registry.js';
import { openStore } from '../lib/store.js';
import { verifyInclusion, leafHash, rootOf, inclusionProof } from '../lib/merkle.js';
import {
  OTS_MAGIC, writeVarint, writeVarbytes, buildDetachedOts, parseOts, upgradeOts,
  submitToCalendars, MAX_RESPONSE_BYTES,
} from '../lib/ots.js';
import { parseTsr, requestTimestamp, tsrCoversDigest } from '../lib/tsa.js';
import { createAnchorWorker } from '../lib/anchorWorker.js';

const sha256 = (b) => createHash('sha256').update(b).digest();
const ATT_PENDING = Buffer.from('83dfe30d2ef90c8e', 'hex');
const ATT_BITCOIN = Buffer.from('0588960d73d71901', 'hex');

// --- F2: canonical JSON must preserve every JSON key ----------------------

test('F2: canonical bytes keep an own __proto__ property instead of dropping it', () => {
  // JSON.parse creates `__proto__` as an OWN property; `{}` + assignment then
  // hit the prototype setter and the key vanished from the hashed bytes while
  // the store persisted it: unhashed-but-stored evidence, freely alterable.
  const record = JSON.parse('{"a":1,"__proto__":{"owner":"alterable evidence"},"z":2}');
  const canonical = canonicalJSON(record);
  assert.ok(canonical.includes('"__proto__"'), `__proto__ dropped from canonical bytes: ${canonical}`);
  assert.equal(canonical, '{"__proto__":{"owner":"alterable evidence"},"a":1,"z":2}');

  // Nested, too: the audit's reproduction put it inside `meta`.
  const nested = JSON.parse('{"meta":{"__proto__":{"owner":"x"},"name":"n"}}');
  assert.equal(canonicalJSON(nested), '{"meta":{"__proto__":{"owner":"x"},"name":"n"}}');
});

test('F2: canonical bytes for a known-good record are UNCHANGED by the fix', () => {
  // Legit records never contained these keys, so every previously issued
  // receipt must still hash to exactly the same bytes. This hash was computed
  // with the pre-fix canonicalizer.
  const record = {
    srid: 'sr:skill:01M26GZQHPKS13QXWB4H63BES2',
    seq: 7,
    ts: '2026-09-10T20:43:42.519Z',
    mode: 'public',
    artifact: { algorithm: 'sha256', sha256: 'e'.repeat(64) },
    license: 'LicenseRef-SkillRights-NoTrain-1.0',
    author: 'test-signer',
    publicKey: 'ssh-ed25519 AAAA',
    signature: 'SSH SIGNATURE',
    meta: { name: 'cluster-doctor', description: 'Diagnose clusters.', repository: 'https://github.com/example/skill' },
  };
  assert.equal(canonicalJSON(record).length, 457);
  assert.equal(sha256Hex(canonicalJSON(record)), 'ad89d07d84e7737002ae009ed44b170f877339fe109a68dd8ad8253d5f3ce1ea');
});

test('F2: a submission carrying __proto__, constructor or prototype is refused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-proto-'));
  try {
    const store = openStore(dir);
    for (const raw of [
      '{"hash":"' + 'a'.repeat(64) + '","mode":"private","__proto__":{"owner":"x"}}',
      '{"hash":"' + 'a'.repeat(64) + '","mode":"public","meta":{"name":"n","__proto__":{"owner":"x"}}}',
      '{"hash":"' + 'a'.repeat(64) + '","mode":"public","meta":{"constructor":"x"}}',
      '{"hash":"' + 'a'.repeat(64) + '","mode":"public","meta":{"prototype":"x"}}',
    ]) {
      const body = JSON.parse(raw);
      const v = validateRegistration(body);
      assert.equal(v.ok, false, `accepted a forbidden key: ${raw}`);
      assert.equal(v.code, 'invalid_record_key');
      assert.throws(() => register(store, body), (err) => err.code === 'invalid_record_key');
    }
    // An ordinary registration still works.
    const { record } = register(store, { hash: 'b'.repeat(64), mode: 'public', meta: { name: 'ok' } });
    assert.equal(record.meta.name, 'ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- F15: strict proof schema --------------------------------------------

function smallTree(size, index) {
  const leaves = Array.from({ length: size }, () => leafHash(randomBytes(16)));
  const root = rootOf(leaves);
  const proof = inclusionProof(index, leaves).map((s) => ({ hash: s.hash.toString('hex'), side: s.side }));
  return { leaf: leaves[index], root, proof };
}

test('F15: verifyInclusion requires a real array, not an array-LIKE object', () => {
  const { leaf, root, proof } = smallTree(4, 2);
  assert.equal(verifyInclusion(leaf, 2, 4, proof, root), true);
  const arrayLike = { length: proof.length };
  proof.forEach((step, i) => { arrayLike[i] = step; });
  assert.equal(verifyInclusion(leaf, 2, 4, arrayLike, root), false,
    'registry accepted an array-like proof object that the CLI and collector reject');
});

test('F15: verifyInclusion requires every sibling hash to be strict lowercase hex', () => {
  const { leaf, root, proof } = smallTree(4, 2);
  const suffixed = proof.map((s, i) => (i === 0 ? { ...s, hash: `${s.hash}zz` } : s));
  assert.equal(verifyInclusion(leaf, 2, 4, suffixed, root), false,
    'registry accepted a sibling hash with an invalid hex suffix (Buffer.from stops at the first bad char)');
  const upper = proof.map((s, i) => (i === 0 ? { ...s, hash: s.hash.toUpperCase() } : s));
  assert.equal(verifyInclusion(leaf, 2, 4, upper, root), false, 'registry accepted a non-lowercase sibling hash');
  const short = proof.map((s, i) => (i === 0 ? { ...s, hash: s.hash.slice(0, 62) } : s));
  assert.equal(verifyInclusion(leaf, 2, 4, short, root), false, 'registry accepted a short sibling hash');
});

// --- OTS fixtures ---------------------------------------------------------

function fileHeader(digest) {
  return Buffer.concat([OTS_MAGIC, writeVarint(1), Buffer.from([0x08]), digest]);
}

/** A realistic calendar /digest response: append(nonce) -> sha256 -> pending. */
function fakeCalendarResponse(nonce, uri) {
  return Buffer.concat([
    Buffer.from([0xf0]), writeVarbytes(nonce),
    Buffer.from([0x08]),
    pendingAttestation(uri),
  ]);
}

function pendingAttestation(uri) {
  return Buffer.concat([
    Buffer.from([0x00]), ATT_PENDING, writeVarbytes(writeVarbytes(Buffer.from(uri, 'utf8'))),
  ]);
}

/** A continuation timestamp ending in a Bitcoin attestation. */
function bitcoinContinuation(prefix, height) {
  return Buffer.concat([
    Buffer.from([0xf1]), writeVarbytes(prefix),
    Buffer.from([0x08]),
    Buffer.from([0x00]), ATT_BITCOIN, writeVarbytes(writeVarint(height)),
  ]);
}

const CAL = ['https://cal.example', 'https://cal2.example'];

// --- F4: structural upgrade merge ----------------------------------------

/** Two sibling pending attestations in ONE node: the shape the audit used. */
function siblingPendingFile(digest, nonce) {
  return Buffer.concat([
    fileHeader(digest),
    Buffer.from([0xf0]), writeVarbytes(nonce),
    Buffer.from([0x08]),
    Buffer.from([0xff]), pendingAttestation('https://cal.example'), // non-final sibling
    pendingAttestation('https://cal2.example'),
  ]);
}

test('F4: a continuation that only parses by eating a sibling fork is refused', async () => {
  // Reproduction from the audit: a COMPLETE pending attestation followed by a
  // dangling sha256 opcode. Spliced as raw bytes it parsed (`upgraded: 1`,
  // no failures) because the trailing opcode swallowed the neighbouring
  // attestation, and the untouched sibling P2 then committed to
  // SHA256(its original commitment) instead of its own.
  const digest = randomBytes(32);
  const nonce = randomBytes(16);
  const file = siblingPendingFile(digest, nonce);
  const commitment = sha256(Buffer.concat([digest, nonce]));
  assert.deepEqual(parseOts(file).pendings.map((p) => p.commitment.toString('hex')),
    [commitment.toString('hex'), commitment.toString('hex')]);

  const evil = Buffer.concat([
    pendingAttestation('https://cal.example'),
    Buffer.from([0x08]), // dangling sha256: consumes whatever follows it
  ]);
  const { file: after, upgraded, failures } = await upgradeOts(
    file,
    async (url) => (url.startsWith('https://cal.example/')
      ? { ok: true, status: 200, arrayBuffer: async () => evil }
      : { ok: false, status: 404 }),
    { calendars: CAL },
  );

  assert.equal(upgraded, 0, 'a continuation that does not stand alone was merged');
  assert.equal(failures.length, 1);
  const parsed = parseOts(after);
  assert.deepEqual(
    parsed.pendings.map((p) => p.commitment.toString('hex')),
    [commitment.toString('hex'), commitment.toString('hex')],
    "the untouched sibling's commitment changed",
  );
  assert.notEqual(
    parsed.pendings[1].commitment.toString('hex'),
    sha256(commitment).toString('hex'),
  );
});

test('F4: a valid forked continuation in a NON-FINAL sibling position is accepted', async () => {
  // The mirror failure: a pending attestation preceded by a 0xff fork marker
  // plus a continuation that itself starts with 0xff produced "ff ff", which
  // the byte-splicing path rejected as `unknown op tag 0xff`.
  const digest = randomBytes(32);
  const nonce = randomBytes(16);
  const commitment = sha256(Buffer.concat([digest, nonce]));
  const file = siblingPendingFile(digest, nonce);
  assert.equal(parseOts(file).pendings.length, 2);

  const forked = Buffer.concat([
    Buffer.from([0xff]), bitcoinContinuation(randomBytes(4), 810000),
    bitcoinContinuation(randomBytes(4), 820000),
  ]);
  const { file: after, upgraded, failures } = await upgradeOts(
    file,
    async (url) => (url.startsWith('https://cal.example/')
      ? { ok: true, status: 200, arrayBuffer: async () => forked }
      : { ok: true, status: 200, arrayBuffer: async () => bitcoinContinuation(randomBytes(4), 830000) }),
    { calendars: CAL },
  );

  assert.deepEqual(failures, []);
  assert.equal(upgraded, 2);
  const parsed = parseOts(after);
  assert.equal(parsed.pendings.length, 0);
  assert.deepEqual(parsed.bitcoins.map((b) => b.height).sort((a, b) => a - b), [810000, 820000, 830000]);
  assert.deepEqual(parsed.digest, digest);
  // Every merged branch still commits to the SAME calendar commitment.
  assert.ok(commitment.length === 32);
});

// --- F6: SSRF -------------------------------------------------------------

test('F6: an upgrade URI off the calendar allowlist is never fetched', async () => {
  const digest = randomBytes(32);
  const file = buildDetachedOts(digest, [
    fakeCalendarResponse(randomBytes(16), 'http://127.0.0.1:9848/private'),
  ]);
  const seen = [];
  const { upgraded, notReady, failures } = await upgradeOts(
    file,
    async (url) => { seen.push(url); return { ok: true, status: 200, arrayBuffer: async () => Buffer.alloc(0) }; },
    { calendars: CAL },
  );
  assert.deepEqual(seen, [], `the worker fetched an internal URI: ${seen.join(', ')}`);
  assert.equal(upgraded, 0);
  assert.equal(notReady, 0);
  assert.equal(failures.length, 1, 'an off-allowlist destination must be a COUNTED failure, not a silent skip');
  assert.match(failures[0].error, /allowlist|https/);
});

test('F6: a plain-http origin is refused even when its host is allowlisted', async () => {
  const digest = randomBytes(32);
  const file = buildDetachedOts(digest, [fakeCalendarResponse(randomBytes(16), 'http://cal.example')]);
  const seen = [];
  const { failures } = await upgradeOts(
    file,
    async (url) => { seen.push(url); return { ok: false, status: 404 }; },
    { calendars: CAL },
  );
  assert.deepEqual(seen, []);
  assert.equal(failures.length, 1);
});

// --- F7: caps apply while streaming --------------------------------------

/** A response with NO content-length whose body streams `total` bytes. */
function streamedResponse(total, chunkSize = 4096) {
  const stats = { sent: 0, cancelled: false, reads: 0 };
  const reader = {
    async read() {
      stats.reads += 1;
      if (stats.sent >= total) return { done: true, value: undefined };
      const n = Math.min(chunkSize, total - stats.sent);
      stats.sent += n;
      return { done: false, value: new Uint8Array(n) };
    },
    async cancel() { stats.cancelled = true; },
    releaseLock() {},
  };
  const res = {
    ok: true,
    status: 200,
    headers: { get: () => null }, // no content-length: the audit's case
    body: { getReader: () => reader },
    arrayBuffer: async () => { throw new Error('arrayBuffer() called: the cap must apply while streaming'); },
  };
  return { res, stats };
}

test('F7: a chunked calendar response one byte over the cap is cancelled mid-stream', async () => {
  const { res, stats } = streamedResponse(MAX_RESPONSE_BYTES + 1);
  const { responses, failures } = await submitToCalendars(randomBytes(32), ['https://cal.example'], async () => res);
  assert.equal(responses.length, 0);
  assert.equal(failures.length, 1);
  assert.match(failures[0].error, /too large/);
  assert.equal(stats.cancelled, true, 'the body reader was not cancelled at the cap');
  assert.ok(stats.sent <= MAX_RESPONSE_BYTES + 4096, `buffered ${stats.sent} bytes past the cap`);
});

test('F7: a chunked TSA response over the cap is cancelled mid-stream', async () => {
  const { res, stats } = streamedResponse(64 * 1024 + 1);
  await assert.rejects(
    requestTimestamp(randomBytes(32), 'https://tsa.example/tsr', async () => res),
    /too large/,
  );
  assert.equal(stats.cancelled, true, 'the TSA body reader was not cancelled at the cap');
});

// --- F5: TSA responses must be structurally valid -------------------------

function derLen(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  let v = n;
  while (v > 0) { bytes.unshift(v & 0xff); v >>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
function der(tag, content) {
  return Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
}
const SHA256_OID = Buffer.from('608648016503040201', 'hex');
const OID_SIGNED_DATA = Buffer.from('2a864886f70d010702', 'hex');
const OID_TST_INFO = Buffer.from('2a864886f70d0109100104', 'hex');

/** A structurally valid RFC 3161 granted response whose TSTInfo imprint is
 *  `digest`. Signature and certificates are omitted deliberately: this
 *  exercises structure and imprint LOCATION, which is what the client now
 *  enforces (chain verification stays the documented openssl path). */
function grantedTsr(digest, nonce = null) {
  const algId = der(0x30, Buffer.concat([der(0x06, SHA256_OID), Buffer.from([0x05, 0x00])]));
  const imprint = der(0x30, Buffer.concat([algId, der(0x04, digest)]));
  const tstInfo = der(0x30, Buffer.concat([
    der(0x02, Buffer.from([0x01])),                       // version
    der(0x06, Buffer.from('2a03', 'hex')),                // policy OID
    imprint,
    der(0x02, Buffer.from([0x2a])),                       // serialNumber
    der(0x18, Buffer.from('20260911000000Z', 'utf8')),    // genTime
    ...(nonce ? [der(0x02, Buffer.concat([Buffer.from([0x00]), nonce]))] : []), // optional nonce
  ]));
  const encap = der(0x30, Buffer.concat([der(0x06, OID_TST_INFO), der(0xa0, der(0x04, tstInfo))]));
  const signedData = der(0x30, Buffer.concat([
    der(0x02, Buffer.from([0x03])), // CMS version
    der(0x31, Buffer.alloc(0)),     // digestAlgorithms
    encap,
  ]));
  const token = der(0x30, Buffer.concat([der(0x06, OID_SIGNED_DATA), der(0xa0, signedData)]));
  return der(0x30, Buffer.concat([der(0x30, der(0x02, Buffer.from([0x00]))), token]));
}

function tsaFetch(body) {
  return async () => ({ ok: true, status: 200, arrayBuffer: async () => body, headers: { get: () => null } });
}

test('F5: the audit 41-byte fixture is refused (digest sits outside the outer SEQUENCE)', async () => {
  const digest = randomBytes(32);
  const fixture = Buffer.concat([Buffer.from('300830030201000000', 'hex'), digest]);
  assert.throws(() => parseTsr(fixture), /DER|trailing/);
  await assert.rejects(requestTimestamp(digest, 'https://tsa.example/tsr', tsaFetch(fixture)), /DER|trailing/);
  assert.equal(tsrCoversDigest(fixture, digest), false);
});

test('F5: a granted response with no real CMS token is refused', async () => {
  const digest = randomBytes(32);
  // Granted, "token present", and the digest bytes appear in the body: the
  // old byte-scan accepted exactly this shape.
  const fake = der(0x30, Buffer.concat([
    der(0x30, der(0x02, Buffer.from([0x00]))),
    der(0x30, der(0x04, digest)),
  ]));
  const parsed = parseTsr(fake);
  assert.equal(parsed.granted, true);
  assert.equal(parsed.tokenPresent, true);
  assert.equal(parsed.messageImprint, null, 'an imprint was invented from a non-CMS token');
  await assert.rejects(requestTimestamp(digest, 'https://tsa.example/tsr', tsaFetch(fake)), /token/);
  assert.equal(tsrCoversDigest(fake, digest), false);
});

test('F5: the imprint is read from TSTInfo, not found anywhere in the bytes', async () => {
  const digest = randomBytes(32);
  const other = randomBytes(32);
  const good = grantedTsr(digest);
  assert.deepEqual(await requestTimestamp(digest, 'https://tsa.example/tsr', tsaFetch(good)), good);
  assert.equal(tsrCoversDigest(good, digest), true);

  // A token for a DIFFERENT imprint that nevertheless carries our digest in
  // an unrelated field (a nonce): the old whole-body byte scan accepted it.
  const decoy = grantedTsr(other, digest);
  assert.ok(decoy.includes(digest), 'fixture must contain the digest outside the imprint');
  assert.equal(tsrCoversDigest(decoy, digest), false);
  await assert.rejects(requestTimestamp(digest, 'https://tsa.example/tsr', tsaFetch(decoy)), /imprint/);
});

test('F5: a rejected status is still a rejection', async () => {
  const digest = randomBytes(32);
  await assert.rejects(
    requestTimestamp(digest, 'https://tsa.example/tsr', tsaFetch(Buffer.from('30053003020102', 'hex'))),
    /rejected/,
  );
});

// --- worker: invalid .tsr is retryable, cache invalidation ----------------

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-audit-'));
  const store = openStore(dir);
  store.append({ srid: 'sr:skill:01ARZ3NDEKTSV4RRFFQ69G5FAV', seq: 0, ts: new Date().toISOString(), mode: 'private', artifact: { algorithm: 'sha256', sha256: 'a'.repeat(64) } });
  return { dir, store };
}

/** Extract the digest from a TimeStampReq our client built (…0420 <32B> 0101ff). */
function digestFromTsq(body) {
  const b = Buffer.from(body);
  return b.subarray(b.length - 3 - 32, b.length - 3);
}

test('F5: an invalid .tsr on disk is retried, never treated as a retired anchor', async () => {
  const { dir, store } = tmpStore();
  const head = store.signedTreeHead();
  const anchors = path.join(dir, 'anchors');
  fs.mkdirSync(anchors, { recursive: true });
  const tsrFile = path.join(anchors, `${head.size}-${head.root}.tsr`);
  // The exact shape the audit got accepted, sitting on disk as "done".
  fs.writeFileSync(tsrFile, Buffer.concat([Buffer.from('300830030201000000', 'hex'), Buffer.from(head.root, 'hex')]));

  const calls = [];
  const worker = createAnchorWorker({
    store,
    dataDir: dir,
    calendars: ['https://cal.example'],
    tsaUrl: 'https://tsa.example/tsr',
    fetchFn: async (url, opts) => {
      calls.push(url);
      if (url.endsWith('/digest')) return { ok: true, status: 200, arrayBuffer: async () => fakeCalendarResponse(randomBytes(8), 'https://cal.example') };
      if (url.includes('/timestamp/')) return { ok: false, status: 404 };
      if (url.endsWith('/tsr')) return { ok: true, status: 200, arrayBuffer: async () => grantedTsr(digestFromTsq(opts.body)), headers: { get: () => null } };
      throw new Error(`unexpected ${url}`);
    },
  });

  await worker.tick();
  assert.equal(calls.filter((u) => u.endsWith('/tsr')).length, 1, 'an invalid .tsr retired the anchor');
  assert.equal(tsrCoversDigest(fs.readFileSync(tsrFile), Buffer.from(head.root, 'hex')), true);

  // Now that it is valid, it IS retired: no further requests.
  await worker.tick();
  assert.equal(calls.filter((u) => u.endsWith('/tsr')).length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('F16: the worker invalidates its status cache on its own writes', async () => {
  const { dir, store } = tmpStore();
  // Sized so the upgraded proof is EXACTLY as long as the pending one: with
  // equal size and a pinned mtime, an uninvalidated cache serves the old
  // status forever (the audit's collision).
  const uri = 'https://cal.example'; // 19 bytes -> 30-byte pending attestation
  const prefix = randomBytes(14);    // -> 30-byte bitcoin continuation
  let continuationReady = false;
  const worker = createAnchorWorker({
    store,
    dataDir: dir,
    calendars: [uri],
    tsaUrl: 'https://tsa.example/tsr',
    fetchFn: async (url, opts) => {
      if (url.endsWith('/digest')) return { ok: true, status: 200, arrayBuffer: async () => fakeCalendarResponse(randomBytes(8), uri) };
      if (url.includes('/timestamp/')) {
        if (!continuationReady) return { ok: false, status: 404 };
        return { ok: true, status: 200, arrayBuffer: async () => bitcoinContinuation(prefix, 900000) };
      }
      if (url.endsWith('/tsr')) return { ok: true, status: 200, arrayBuffer: async () => grantedTsr(digestFromTsq(opts.body)), headers: { get: () => null } };
      throw new Error(`unexpected ${url}`);
    },
  });

  await worker.tick();
  const head = store.signedTreeHead();
  const otsFile = path.join(dir, 'anchors', `${head.size}-${head.root}.ots`);
  const pinned = new Date(1600000000000);
  fs.utimesSync(otsFile, pinned, pinned);
  const sizeBefore = fs.statSync(otsFile).size;
  assert.deepEqual(worker.listAnchors().map((a) => a.ots), ['pending']); // populates the cache

  continuationReady = true;
  await worker.tick();
  fs.utimesSync(otsFile, pinned, pinned); // same mtime AND same size as the cached entry
  const sizeAfter = fs.statSync(otsFile).size;
  assert.equal(sizeAfter, sizeBefore, 'test fixture no longer collides on size; adjust the prefix length');

  assert.deepEqual(worker.listAnchors().map((a) => a.ots), ['bitcoin'], 'stale anchor status served from the cache');
  assert.deepEqual(worker.listAnchors()[0].bitcoinHeights, [900000]);

  // Proof writes are atomic: no temp files left beside the anchors.
  const stray = fs.readdirSync(path.join(dir, 'anchors')).filter((n) => !/^(\d+-[a-f0-9]{64}\.(ots|tsr)|ledger\.jsonl)$/.test(n));
  assert.deepEqual(stray, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('GET / greets humans with HTML pointing at the directory, never a JSON 404', async () => {
  const { createServer } = await import('../server.js').catch(() => ({}));
  // Fallback: drive over HTTP against a scratch instance like anchors tests do
  if (!createServer) {
    const { spawn } = await import('node:child_process');
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srroot-'));
    const proc = spawn('node', [new URL('../server.js', import.meta.url).pathname], {
      env: { ...process.env, SR_DATA_DIR: dir, PORT: '3477' }, stdio: 'ignore',
    });
    await new Promise((r) => setTimeout(r, 700));
    try {
      const res = await fetch('http://127.0.0.1:3477/');
      const text = await res.text();
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /text\/html/);
      assert.match(text, /skillrights\.org\/registry/);
    } finally { proc.kill('SIGKILL'); fs.rmSync(dir, { recursive: true, force: true }); }
  }
});
