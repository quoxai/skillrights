// Minimal zero-dependency OpenTimestamps client: enough to submit a 32-byte
// digest to public calendar servers, assemble a valid detached .ots proof
// file, and later upgrade it in place once the calendars have committed the
// digest to Bitcoin. The serialization format follows the reference
// python-opentimestamps implementation; produced files are verifiable with
// the standard `ots` tooling (`ots info`, `ots verify -d <digest>`).
//
// Scope is deliberately narrow: sha256 digests only, the op set calendars
// actually emit (append/prepend/sha256/sha1/ripemd160/reverse/hexlify), and
// pending/bitcoin attestations. Anything unrecognised fails parsing loudly
// rather than being guessed at.

import { createHash } from 'node:crypto';

/**
 * The calendars we talk to, in ONE place. Submission and upgrade share this
 * list: an upgrade used to follow whatever URI a pending attestation carried,
 * so a malicious or compromised calendar could aim the registry process at an
 * internal service (audit, 2026-09-11). The worker overrides it from
 * REGISTRY_CALENDARS; whatever it is configured with is both where digests go
 * and the only place upgrades may be fetched from.
 */
export const DEFAULT_CALENDARS = [
  'https://a.pool.opentimestamps.org',
  'https://b.pool.opentimestamps.org',
  'https://a.pool.eternitywall.com',
];

export const OTS_MAGIC = Buffer.from(
  '004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294',
  'hex',
);
const TAG_SHA256_FILEHASH = 0x08;

const ATT_PENDING = Buffer.from('83dfe30d2ef90c8e', 'hex');
const ATT_BITCOIN = Buffer.from('0588960d73d71901', 'hex');

const OP_APPEND = 0xf0;
const OP_PREPEND = 0xf1;
const OP_REVERSE = 0xf2;
const OP_HEXLIFY = 0xf3;
const OP_SHA1 = 0x02;
const OP_RIPEMD160 = 0x03;
const OP_SHA256 = 0x08;
const OP_KECCAK256 = 0x67;
const BINARY_OPS = new Set([OP_APPEND, OP_PREPEND]);
const UNARY_OPS = new Set([OP_REVERSE, OP_HEXLIFY, OP_SHA1, OP_RIPEMD160, OP_SHA256, OP_KECCAK256]);

// --- varint / varbytes ----------------------------------------------------

export function writeVarint(n) {
  const out = [];
  let v = n;
  while (v > 0x7f) { out.push((v & 0x7f) | 0x80); v >>>= 7; }
  out.push(v);
  return Buffer.from(out);
}

function readVarint(buf, pos) {
  let value = 0;
  let shift = 0;
  for (;;) {
    if (pos >= buf.length) throw new Error('ots: truncated varint');
    const b = buf[pos];
    pos += 1;
    value |= (b & 0x7f) << shift;
    if (!(b & 0x80)) return [value >>> 0, pos];
    shift += 7;
    if (shift > 28) throw new Error('ots: varint too large');
  }
}

export function writeVarbytes(bytes) {
  return Buffer.concat([writeVarint(bytes.length), bytes]);
}

function readVarbytes(buf, pos) {
  const [len, p] = readVarint(buf, pos);
  if (p + len > buf.length) throw new Error('ots: truncated varbytes');
  return [buf.subarray(p, p + len), p + len];
}

// --- op application -------------------------------------------------------

// Resource bounds (audit finding 2026-09-10). These parsers run on bytes from
// calendar servers we do not control, inside the process that serves the
// public API, and listAnchors re-parses stored proofs on request. Without a
// message cap, a ~25-byte hexlify chain doubles the working buffer per op:
// measured ~700MB allocated and multi-second event-loop stalls. The reference
// python-opentimestamps caps messages at 4096 bytes; we match it, and bound
// the op count as well so recursion depth is bounded with it.
export const MAX_MSG_LENGTH = 4096;
export const MAX_OPS = 512;
export const MAX_RESPONSE_BYTES = 64 * 1024;
export const FETCH_TIMEOUT_MS = 30_000;

function applyOp(tag, msg, arg) {
  if (msg.length > MAX_MSG_LENGTH) throw new Error('ots: message too long');
  if (arg && arg.length > MAX_MSG_LENGTH) throw new Error('ots: message too long (op argument)');
  let result;
  switch (tag) {
    case OP_APPEND: result = Buffer.concat([msg, arg]); break;
    case OP_PREPEND: result = Buffer.concat([arg, msg]); break;
    case OP_REVERSE: result = Buffer.from(msg).reverse(); break;
    case OP_HEXLIFY: result = Buffer.from(msg.toString('hex'), 'utf8'); break;
    case OP_SHA1: result = createHash('sha1').update(msg).digest(); break;
    case OP_RIPEMD160: result = createHash('ripemd160').update(msg).digest(); break;
    case OP_SHA256: result = createHash('sha256').update(msg).digest(); break;
    case OP_KECCAK256: throw new Error('ots: keccak256 unsupported');
    default: throw new Error(`ots: unknown op 0x${tag.toString(16)}`);
  }
  if (result.length > MAX_MSG_LENGTH) throw new Error('ots: message too long');
  return result;
}

/**
 * Read a fetch Response body with a hard byte cap. The declared length is
 * checked first, then the body is read INCREMENTALLY and the response is
 * cancelled the moment the cap is passed: calling arrayBuffer() first meant a
 * chunked reply with no content-length was buffered in full before the cap
 * could refuse it, so the advertised cap bounded nothing an adversarial
 * server chose not to declare (audit, 2026-09-11).
 */
export async function readBodyCapped(res, cap = MAX_RESPONSE_BYTES) {
  const declared = res.headers && typeof res.headers.get === 'function' ? Number(res.headers.get('content-length')) : NaN;
  if (Number.isFinite(declared) && declared > cap) {
    throw new Error(`response too large (${declared} > ${cap} bytes)`);
  }
  const stream = res.body;
  if (!stream || typeof stream.getReader !== 'function') {
    // No readable stream (a test double, or a runtime without one): fall back
    // to the buffered read, which is still capped after the fact.
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > cap) throw new Error(`response too large (${body.length} > ${cap} bytes)`);
    return body;
  }
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;
      total += value.length;
      if (total > cap) {
        await reader.cancel(`response too large (> ${cap} bytes)`);
        throw new Error(`response too large (> ${cap} bytes)`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    if (typeof reader.releaseLock === 'function') {
      try { reader.releaseLock(); } catch { /* already released by cancel() */ }
    }
  }
  return Buffer.concat(chunks, total);
}

// --- timestamp parsing (structural tree, for merges) ----------------------
//
// The parse builds an explicit tree instead of tracking byte offsets:
//
//   node  = { msg, items: [ item, ... ] }            (>= 1 item)
//   item  = { kind: 'att', tag, payload }
//         | { kind: 'op',  tag, arg, child: node }
//
// Upgrades MERGE at this level and reserialize, because splicing raw
// continuation bytes into a byte range let a crafted continuation consume
// its NEIGHBOUR's bytes: a dangling opcode at the end of a continuation
// swallowed the sibling attestation, which then committed to
// SHA256(its own commitment) instead, and the whole-file reparse could not
// tell the difference. The same byte splicing rejected a legitimate forked
// continuation whose first byte was 0xff when the pending attestation sat in
// a non-final sibling position ("unknown op tag 0xff"). Audit, 2026-09-11.
//
// Serialization is order-preserving, so parse -> serialize is byte-identical
// for a file we did not modify.

function parseEntry(buf, pos, msg, ctx) {
  const tag = buf[pos];
  if (tag === undefined) throw new Error('ots: truncated entry');
  if (tag === 0x00) {
    const attTag = buf.subarray(pos + 1, pos + 9);
    if (attTag.length < 8) throw new Error('ots: truncated attestation tag');
    const [payload, p] = readVarbytes(buf, pos + 9);
    return { item: { kind: 'att', tag: Buffer.from(attTag), payload: Buffer.from(payload) }, pos: p };
  }
  ctx.opCount += 1;
  if (ctx.opCount > MAX_OPS) throw new Error('ots: too many ops');
  let arg = null;
  let p = pos + 1;
  if (BINARY_OPS.has(tag)) {
    [arg, p] = readVarbytes(buf, p);
  } else if (!UNARY_OPS.has(tag)) {
    throw new Error(`ots: unknown op tag 0x${tag.toString(16)}`);
  }
  const next = applyOp(tag, msg, arg);
  const child = parseNode(buf, p, next, ctx);
  return {
    item: { kind: 'op', tag, arg: arg ? Buffer.from(arg) : null, child: child.node },
    pos: child.pos,
  };
}

function parseNode(buf, pos, msg, ctx) {
  const node = { msg, items: [] };
  for (;;) {
    const forked = buf[pos] === 0xff;
    const r = parseEntry(buf, forked ? pos + 1 : pos, msg, ctx);
    node.items.push(r.item);
    pos = r.pos;
    if (!forked) return { node, pos };
  }
}

function serializeItem(item) {
  if (item.kind === 'att') {
    return Buffer.concat([Buffer.from([0x00]), item.tag, writeVarbytes(item.payload)]);
  }
  const parts = [Buffer.from([item.tag])];
  if (BINARY_OPS.has(item.tag)) parts.push(writeVarbytes(item.arg));
  parts.push(serializeNode(item.child));
  return Buffer.concat(parts);
}

function serializeNode(node) {
  const parts = [];
  node.items.forEach((item, i) => {
    if (i < node.items.length - 1) parts.push(Buffer.from([0xff]));
    parts.push(serializeItem(item));
  });
  return Buffer.concat(parts);
}

function walkTree(node, out) {
  node.items.forEach((item, index) => {
    if (item.kind === 'op') {
      walkTree(item.child, out);
      return;
    }
    if (item.tag.equals(ATT_PENDING)) {
      const [uriBytes] = readVarbytes(item.payload, 0);
      out.pendings.push({ uri: uriBytes.toString('utf8'), commitment: node.msg, node, index });
    } else if (item.tag.equals(ATT_BITCOIN)) {
      const [height] = readVarint(item.payload, 0);
      out.bitcoins.push({ height });
    } else {
      out.unknown.push({ tag: item.tag.toString('hex') });
    }
  });
}

function otsHeader(digest) {
  return Buffer.concat([OTS_MAGIC, writeVarint(1), Buffer.from([TAG_SHA256_FILEHASH]), digest]);
}

/** Serialize a parsed tree back to a detached .ots file. */
export function serializeOts(digest, tree) {
  return Buffer.concat([otsHeader(digest), serializeNode(tree)]);
}

/**
 * Parse a detached .ots file. Returns
 * { digest, pendings, bitcoins, unknown, tree }. Each pending carries the
 * calendar URI, the commitment bytes to query it with, and the node/index it
 * occupies so an upgrade can replace it structurally.
 */
export function parseOts(buf) {
  if (!buf.subarray(0, OTS_MAGIC.length).equals(OTS_MAGIC)) {
    throw new Error('ots: bad magic');
  }
  let pos = OTS_MAGIC.length;
  let version;
  [version, pos] = readVarint(buf, pos);
  if (version !== 1) throw new Error(`ots: unsupported version ${version}`);
  if (buf[pos] !== TAG_SHA256_FILEHASH) throw new Error('ots: only sha256 file hashes supported');
  pos += 1;
  const digest = buf.subarray(pos, pos + 32);
  if (digest.length < 32) throw new Error('ots: truncated digest');
  pos += 32;
  const { node, pos: end } = parseNode(buf, pos, Buffer.from(digest), { opCount: 0 });
  if (end !== buf.length) throw new Error('ots: trailing bytes');
  const out = { digest: Buffer.from(digest), pendings: [], bitcoins: [], unknown: [], tree: node };
  walkTree(node, out);
  return out;
}

/**
 * Parse a calendar continuation ON ITS OWN, against the commitment it claims
 * to extend. It must consume its own bytes exactly and completely: anything
 * that only parses with help from neighbouring bytes is refused here rather
 * than discovered (or not) after a splice.
 */
export function parseContinuation(buf, commitment) {
  if (buf.length === 0) throw new Error('ots: empty continuation');
  const { node, pos } = parseNode(buf, 0, Buffer.from(commitment), { opCount: 0 });
  if (pos !== buf.length) {
    throw new Error(`ots: continuation does not consume its own bytes exactly (${pos} of ${buf.length})`);
  }
  return node;
}

/**
 * Assemble a detached .ots file for a sha256 digest from one or more
 * serialized calendar timestamps (the raw POST /digest response bodies).
 * Each response must begin with an op entry (which calendar responses do);
 * responses starting with a fork marker cannot be merged and throw.
 */
export function buildDetachedOts(digest, calendarTimestamps) {
  if (digest.length !== 32) throw new Error('ots: digest must be 32 bytes');
  if (calendarTimestamps.length === 0) throw new Error('ots: no calendar timestamps');
  for (const t of calendarTimestamps) {
    if (t[0] === 0xff || t[0] === 0x00) throw new Error('ots: calendar response is not a single op entry');
  }
  const parts = [OTS_MAGIC, writeVarint(1), Buffer.from([TAG_SHA256_FILEHASH]), digest];
  for (let i = 0; i < calendarTimestamps.length - 1; i += 1) {
    parts.push(Buffer.from([0xff]), calendarTimestamps[i]);
  }
  parts.push(calendarTimestamps[calendarTimestamps.length - 1]);
  const file = Buffer.concat(parts);
  parseOts(file); // must round-trip before we let it exist
  return file;
}

/** Submit a digest to calendar servers. Returns { responses, failures }. */
export async function submitToCalendars(digest, calendars, fetchFn = fetch) {
  const responses = [];
  const failures = [];
  await Promise.all(calendars.map(async (base) => {
    try {
      const res = await fetchFn(`${base.replace(/\/$/, '')}/digest`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/vnd.opentimestamps.v1' },
        body: digest,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const body = await readBodyCapped(res);
      if (body.length === 0) throw new Error('empty response');
      responses.push({ calendar: base, timestamp: body });
    } catch (err) {
      failures.push({ calendar: base, error: err.message });
    }
  }));
  return { responses, failures };
}

/** The https origins upgrades may be fetched from, from a calendar list. */
export function allowedUpgradeOrigins(calendars = DEFAULT_CALENDARS) {
  const origins = new Set();
  for (const base of calendars) {
    try {
      const u = new URL(base);
      if (u.protocol === 'https:') origins.add(u.origin);
    } catch { /* a malformed configured calendar simply allows nothing */ }
  }
  return origins;
}

/** Throws unless `uri` is an https origin on the configured calendar list. */
function upgradeUrlFor(uri, commitment, allowed) {
  let parsedUri;
  try {
    parsedUri = new URL(uri);
  } catch {
    throw new Error(`upgrade URI is not a URL: ${uri}`);
  }
  if (parsedUri.protocol !== 'https:') {
    throw new Error(`upgrade destination must be https, got ${parsedUri.protocol}//`);
  }
  if (!allowed.has(parsedUri.origin)) {
    throw new Error(`upgrade destination ${parsedUri.origin} is not on the calendar allowlist`);
  }
  return `${uri.replace(/\/$/, '')}/timestamp/${commitment.toString('hex')}`;
}

/**
 * Attempt to upgrade a pending .ots: query each pending attestation's
 * calendar for the committed timestamp, parse the continuation on its own
 * against that attestation's commitment, and MERGE it structurally in place
 * of the pending attestation. A calendar that is not ready yet (404) is
 * normal and not a failure; a destination off the calendar allowlist is a
 * counted failure for that fork and never stops the sweep. Returns
 * { file, upgraded, notReady, failures } where file is the (possibly new)
 * buffer.
 */
export async function upgradeOts(buf, fetchFn = fetch, { calendars = DEFAULT_CALENDARS } = {}) {
  const parsed = parseOts(buf);
  let upgraded = 0;
  let notReady = 0;
  const failures = [];
  const allowed = allowedUpgradeOrigins(calendars);

  // Reverse discovery order: within a node, higher item indexes are replaced
  // first, so the indexes recorded for the earlier siblings stay valid.
  for (const pending of [...parsed.pendings].reverse()) {
    try {
      const url = upgradeUrlFor(pending.uri, pending.commitment, allowed);
      const res = await fetchFn(url, {
        headers: { accept: 'application/vnd.opentimestamps.v1' },
        redirect: 'error', // a redirect would escape the allowlist check above
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.status === 404) { notReady += 1; continue; }
      if (!res.ok) throw new Error(`http ${res.status}`);
      const continuation = await readBodyCapped(res);
      if (continuation.length === 0) throw new Error('empty continuation');
      // Parsed against THIS attestation's commitment and required to consume
      // itself exactly: a continuation cannot reach a neighbouring fork.
      const merged = parseContinuation(continuation, pending.commitment);
      pending.node.items.splice(pending.index, 1, ...merged.items);
      upgraded += 1;
    } catch (err) {
      failures.push({ calendar: pending.uri, error: err.message });
    }
  }

  if (upgraded === 0) return { file: buf, upgraded, notReady, failures };

  const file = serializeOts(parsed.digest, parsed.tree);
  try {
    parseOts(file); // the merged file must round-trip before it may exist
  } catch (err) {
    failures.push({ calendar: 'merge', error: `merged proof did not re-parse: ${err.message}` });
    return { file: buf, upgraded: 0, notReady, failures };
  }
  return { file, upgraded, notReady, failures };
}
