import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import {
  OTS_MAGIC, writeVarint, writeVarbytes, buildDetachedOts, parseOts, upgradeOts, submitToCalendars,
} from '../lib/ots.js';
import { buildTsq, parseTsr, requestTimestamp } from '../lib/tsa.js';
import { createAnchorWorker } from '../lib/anchorWorker.js';
import { openStore } from '../lib/store.js';

const sha256 = (b) => createHash('sha256').update(b).digest();
const ATT_PENDING = Buffer.from('83dfe30d2ef90c8e', 'hex');
const ATT_BITCOIN = Buffer.from('0588960d73d71901', 'hex');


// --- DER fixtures ---------------------------------------------------------

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

/** A granted TimeStampResp carrying a structurally valid timestamp token
 *  whose TSTInfo messageImprint IS `digest`. The client reads the imprint
 *  out of TSTInfo now, so a token-shaped blob containing the digest bytes is
 *  no longer accepted (audit, 2026-09-11). Signature and certificates are
 *  omitted: chain verification is the documented openssl path. */
function grantedTsr(digest) {
  const algId = der(0x30, Buffer.concat([der(0x06, SHA256_OID), Buffer.from([0x05, 0x00])]));
  const imprint = der(0x30, Buffer.concat([algId, der(0x04, digest)]));
  const tstInfo = der(0x30, Buffer.concat([
    der(0x02, Buffer.from([0x01])),
    der(0x06, Buffer.from('2a03', 'hex')),
    imprint,
    der(0x02, Buffer.from([0x2a])),
    der(0x18, Buffer.from('20260911000000Z', 'utf8')),
  ]));
  const encap = der(0x30, Buffer.concat([der(0x06, OID_TST_INFO), der(0xa0, der(0x04, tstInfo))]));
  const signedData = der(0x30, Buffer.concat([
    der(0x02, Buffer.from([0x03])),
    der(0x31, Buffer.alloc(0)),
    encap,
  ]));
  const token = der(0x30, Buffer.concat([der(0x06, OID_SIGNED_DATA), der(0xa0, signedData)]));
  return der(0x30, Buffer.concat([der(0x30, der(0x02, Buffer.from([0x00]))), token]));
}

/** Extract the digest from a TimeStampReq our client built (…0420 <32B> 0101ff). */
function digestFromTsq(body) {
  const b = Buffer.from(body);
  return b.subarray(b.length - 3 - 32, b.length - 3);
}

/** A realistic calendar /digest response: append(nonce) -> sha256 -> pending. */
function fakeCalendarResponse(nonce, uri) {
  const payload = writeVarbytes(Buffer.from(uri, 'utf8'));
  return Buffer.concat([
    Buffer.from([0xf0]), writeVarbytes(nonce),   // append nonce
    Buffer.from([0x08]),                          // sha256
    Buffer.from([0x00]), ATT_PENDING, writeVarbytes(payload), // pending attestation
  ]);
}

/** A continuation timestamp ending in a Bitcoin attestation. */
function fakeBitcoinContinuation(prefix, height) {
  const payload = writeVarint(height);
  return Buffer.concat([
    Buffer.from([0xf1]), writeVarbytes(prefix),   // prepend
    Buffer.from([0x08]),                          // sha256
    Buffer.from([0x00]), ATT_BITCOIN, writeVarbytes(payload),
  ]);
}

// --- OTS file format ------------------------------------------------------

test('buildDetachedOts produces a parseable single-calendar file with the right commitment', () => {
  const digest = randomBytes(32);
  const nonce = randomBytes(16);
  const file = buildDetachedOts(digest, [fakeCalendarResponse(nonce, 'https://cal.example')]);
  assert.ok(file.subarray(0, OTS_MAGIC.length).equals(OTS_MAGIC));
  const parsed = parseOts(file);
  assert.deepEqual(parsed.digest, digest);
  assert.equal(parsed.pendings.length, 1);
  assert.equal(parsed.pendings[0].uri, 'https://cal.example');
  assert.deepEqual(parsed.pendings[0].commitment, sha256(Buffer.concat([digest, nonce])));
  assert.equal(parsed.bitcoins.length, 0);
});

test('buildDetachedOts merges multiple calendars as forks', () => {
  const digest = randomBytes(32);
  const file = buildDetachedOts(digest, [
    fakeCalendarResponse(randomBytes(16), 'https://a.example'),
    fakeCalendarResponse(randomBytes(16), 'https://b.example'),
    fakeCalendarResponse(randomBytes(16), 'https://c.example'),
  ]);
  const parsed = parseOts(file);
  assert.deepEqual(parsed.pendings.map((x) => x.uri).sort(), ['https://a.example', 'https://b.example', 'https://c.example']);
});

test('parseOts rejects bad magic, trailing bytes, unknown ops', () => {
  assert.throws(() => parseOts(Buffer.from('deadbeef', 'hex')), /bad magic/);
  const digest = randomBytes(32);
  const good = buildDetachedOts(digest, [fakeCalendarResponse(randomBytes(8), 'x')]);
  assert.throws(() => parseOts(Buffer.concat([good, Buffer.from([0x01])])), /trailing/);
  const bad = Buffer.from(good);
  bad[OTS_MAGIC.length + 2 + 32] = 0x99; // clobber the first op tag
  assert.throws(() => parseOts(bad), /unknown op/);
});

test('upgradeOts splices a Bitcoin continuation in place of the pending attestation', async () => {
  const digest = randomBytes(32);
  const nonce = randomBytes(16);
  const file = buildDetachedOts(digest, [fakeCalendarResponse(nonce, 'https://cal.example')]);
  const commitment = sha256(Buffer.concat([digest, nonce]));
  const continuation = fakeBitcoinContinuation(randomBytes(4), 850000);
  const fetchFn = async (url) => {
    assert.equal(url, `https://cal.example/timestamp/${commitment.toString('hex')}`);
    return { ok: true, status: 200, arrayBuffer: async () => continuation };
  };
  const { file: upgraded, upgraded: n, notReady } = await upgradeOts(file, fetchFn, { calendars: ['https://cal.example'] });
  assert.equal(n, 1);
  assert.equal(notReady, 0);
  const parsed = parseOts(upgraded);
  assert.equal(parsed.pendings.length, 0);
  assert.deepEqual(parsed.bitcoins, [{ height: 850000 }]);
});

test('upgradeOts treats 404 as not-ready, not failure', async () => {
  const digest = randomBytes(32);
  const file = buildDetachedOts(digest, [fakeCalendarResponse(randomBytes(16), 'https://cal.example')]);
  const { file: same, upgraded, notReady, failures } = await upgradeOts(file, async () => ({ ok: false, status: 404 }), { calendars: ['https://cal.example'] });
  assert.equal(upgraded, 0);
  assert.equal(notReady, 1);
  assert.equal(failures.length, 0);
  assert.deepEqual(same, file);
});

test('upgradeOts upgrades every branch of a merged file', async () => {
  const digest = randomBytes(32);
  const nonceA = randomBytes(16);
  const nonceB = randomBytes(16);
  const file = buildDetachedOts(digest, [
    fakeCalendarResponse(nonceA, 'https://a.example'),
    fakeCalendarResponse(nonceB, 'https://b.example'),
  ]);
  const fetchFn = async (url) => ({ ok: true, status: 200, arrayBuffer: async () => fakeBitcoinContinuation(randomBytes(4), url.includes('//a.') ? 1 : 2) });
  const { file: upgraded, upgraded: n } = await upgradeOts(file, fetchFn, { calendars: ['https://a.example', 'https://b.example'] });
  assert.equal(n, 2);
  const parsed = parseOts(upgraded);
  assert.deepEqual(parsed.bitcoins.map((b) => b.height).sort(), [1, 2]);
});

test('submitToCalendars records failures distinctly and keeps successes', async () => {
  const digest = randomBytes(32);
  const fetchFn = async (url) => {
    if (url.startsWith('https://bad')) throw new Error('boom');
    return { ok: true, status: 200, arrayBuffer: async () => fakeCalendarResponse(randomBytes(8), 'https://good.example') };
  };
  const { responses, failures } = await submitToCalendars(digest, ['https://good.example', 'https://bad.example'], fetchFn);
  assert.equal(responses.length, 1);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].calendar, 'https://bad.example');
});

// --- RFC 3161 -------------------------------------------------------------

test('buildTsq emits the exact expected DER for a known digest', () => {
  const digest = Buffer.alloc(32, 0xab);
  const tsq = buildTsq(digest);
  const expected = Buffer.from(
    '30390201013031300d060960864801650304020105000420' + 'ab'.repeat(32) + '0101ff',
    'hex',
  );
  assert.deepEqual(tsq, expected);
});

test('parseTsr recognises granted-with-token and rejection', () => {
  const grantedWithToken = Buffer.from('300a3003020100' + '30030201aa', 'hex');
  const r1 = parseTsr(grantedWithToken);
  assert.equal(r1.granted, true);
  assert.equal(r1.tokenPresent, true);

  const rejected = Buffer.from('30053003020102', 'hex');
  const r2 = parseTsr(rejected);
  assert.equal(r2.granted, false);
  assert.equal(r2.tokenPresent, false);
});

test('requestTimestamp throws on rejection and returns raw bytes on grant', async () => {
  const digest = randomBytes(32);
  const grantedResp = grantedTsr(digest);
  const ok = await requestTimestamp(digest, 'https://tsa.example/tsr', async (url, opts) => {
    assert.equal(opts.headers['content-type'], 'application/timestamp-query');
    assert.deepEqual(Buffer.from(opts.body), buildTsq(digest));
    return { ok: true, status: 200, arrayBuffer: async () => grantedResp, headers: { get: () => null } };
  });
  assert.deepEqual(ok, grantedResp);
  await assert.rejects(
    requestTimestamp(digest, 'https://tsa.example/tsr', async () => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from('30053003020102', 'hex'), headers: { get: () => null } })),
    /rejected/,
  );
});

// --- anchor worker (scheduler triad) --------------------------------------

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-anchors-'));
  const store = openStore(dir);
  store.append({ srid: 'sr:skill:01ARZ3NDEKTSV4RRFFQ69G5FAV', seq: 0, ts: new Date().toISOString(), mode: 'private', artifact: { algorithm: 'sha256', sha256: 'a'.repeat(64) } });
  return { dir, store };
}

function workingFetch(calls) {
  return async (url, opts) => {
    calls.push(url);
    if (url.endsWith('/digest')) {
      return { ok: true, status: 200, arrayBuffer: async () => fakeCalendarResponse(randomBytes(8), 'https://cal.example') };
    }
    if (url.includes('/timestamp/')) return { ok: false, status: 404 };
    if (url.endsWith('/tsr')) {
      return { ok: true, status: 200, arrayBuffer: async () => grantedTsr(digestFromTsq(opts.body)), headers: { get: () => null } };
    }
    throw new Error(`unexpected url ${url}`);
  };
}

test('worker: failures are counted, backoff grows, and success resets it', async () => {
  const { dir, store } = tmpStore();
  let failMode = true;
  const calls = [];
  const worker = createAnchorWorker({
    store,
    dataDir: dir,
    intervalMs: 1000,
    maxIntervalMs: 8000,
    calendars: ['https://cal.example'],
    tsaUrl: 'https://tsa.example/tsr',
    fetchFn: async (url, opts) => {
      if (failMode) throw new Error('network down');
      return workingFetch(calls)(url, opts);
    },
  });

  const r1 = await worker.tick();
  assert.equal(r1.progress, false);
  assert.ok(r1.failures >= 2); // ots submit + tsa both failed
  assert.equal(worker.nextDelay(), 2000);
  await worker.tick();
  assert.equal(worker.nextDelay(), 4000);

  // Failures are ledgered distinctly (ok:false entries with op names).
  const ledger = fs.readFileSync(path.join(dir, 'anchors', 'ledger.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(ledger.some((e) => e.ok === false && e.op === 'ots_submit'));
  assert.ok(ledger.some((e) => e.ok === false && e.op === 'tsa'));

  failMode = false;
  const r3 = await worker.tick();
  assert.equal(r3.progress, true);
  assert.equal(worker.nextDelay(), 1000); // reset

  const head = store.signedTreeHead();
  assert.ok(fs.existsSync(path.join(dir, 'anchors', `${head.size}-${head.root}.ots`)));
  assert.ok(fs.existsSync(path.join(dir, 'anchors', `${head.size}-${head.root}.tsr`)));
});

test('worker: existing anchors are retired (no resubmission), pending upgrades to complete', async () => {
  const { dir, store } = tmpStore();
  const calls = [];
  let continuationReady = false;
  const fetchFn = async (url, opts) => {
    calls.push(url);
    if (url.endsWith('/digest')) return { ok: true, status: 200, arrayBuffer: async () => fakeCalendarResponse(Buffer.from('0102030405060708', 'hex'), 'https://cal.example') };
    if (url.includes('/timestamp/')) {
      if (!continuationReady) return { ok: false, status: 404 };
      return { ok: true, status: 200, arrayBuffer: async () => fakeBitcoinContinuation(randomBytes(4), 900000) };
    }
    if (url.endsWith('/tsr')) return { ok: true, status: 200, arrayBuffer: async () => grantedTsr(digestFromTsq(opts.body)), headers: { get: () => null } };
    throw new Error(`unexpected ${url}`);
  };
  const worker = createAnchorWorker({ store, dataDir: dir, calendars: ['https://cal.example'], tsaUrl: 'https://tsa.example/tsr', fetchFn });

  await worker.tick(); // submits ots + tsa
  const submits = calls.filter((u) => u.endsWith('/digest')).length;
  const tsas = calls.filter((u) => u.endsWith('/tsr')).length;
  assert.equal(submits, 1);
  assert.equal(tsas, 1);

  await worker.tick(); // same head: no resubmission, upgrade attempt only (404)
  assert.equal(calls.filter((u) => u.endsWith('/digest')).length, 1);
  assert.equal(calls.filter((u) => u.endsWith('/tsr')).length, 1);
  // one upgrade probe per tick (tick 1 probes right after submitting)
  assert.equal(calls.filter((u) => u.includes('/timestamp/')).length, 2);
  assert.deepEqual(worker.listAnchors().map((a) => a.ots), ['pending']);

  continuationReady = true;
  const r = await worker.tick();
  assert.equal(r.progress, true);
  assert.deepEqual(worker.listAnchors().map((a) => a.ots), ['bitcoin']);
  assert.deepEqual(worker.listAnchors()[0].bitcoinHeights, [900000]);

  const before = calls.length;
  await worker.tick(); // complete: fully retired, zero network calls
  assert.equal(calls.length, before);
});
