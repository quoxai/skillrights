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

/** Read a fetch Response body with a hard byte cap, checking the declared
 *  length first so an oversized body is refused rather than buffered. */
async function readBodyCapped(res, cap = MAX_RESPONSE_BYTES) {
  const declared = res.headers && typeof res.headers.get === 'function' ? Number(res.headers.get('content-length')) : NaN;
  if (Number.isFinite(declared) && declared > cap) {
    throw new Error(`response too large (${declared} > ${cap} bytes)`);
  }
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > cap) throw new Error(`response too large (${body.length} > ${cap} bytes)`);
  return body;
}

// --- timestamp parsing (offset-tracking, for in-place upgrades) -----------

function parseAttestation(buf, pos, msg, out, start) {
  const tag = buf.subarray(pos, pos + 8);
  if (tag.length < 8) throw new Error('ots: truncated attestation tag');
  pos += 8;
  const [payload, p] = readVarbytes(buf, pos);
  pos = p;
  if (tag.equals(ATT_PENDING)) {
    const [uriBytes] = readVarbytes(payload, 0);
    out.pendings.push({ uri: uriBytes.toString('utf8'), commitment: msg, start, end: pos });
  } else if (tag.equals(ATT_BITCOIN)) {
    const [height] = readVarint(payload, 0);
    out.bitcoins.push({ height });
  } else {
    out.unknown.push({ tag: tag.toString('hex') });
  }
  return pos;
}

function parseEntry(buf, pos, msg, out) {
  const tag = buf[pos];
  if (tag === undefined) throw new Error('ots: truncated entry');
  if (tag === 0x00) {
    return parseAttestation(buf, pos + 1, msg, out, pos);
  }
  out.opCount = (out.opCount || 0) + 1;
  if (out.opCount > MAX_OPS) throw new Error('ots: too many ops');
  let arg = null;
  let p = pos + 1;
  if (BINARY_OPS.has(tag)) {
    [arg, p] = readVarbytes(buf, p);
  } else if (!UNARY_OPS.has(tag)) {
    throw new Error(`ots: unknown op tag 0x${tag.toString(16)}`);
  }
  const next = applyOp(tag, msg, arg);
  return parseTimestamp(buf, p, next, out);
}

function parseTimestamp(buf, pos, msg, out) {
  for (;;) {
    if (buf[pos] === 0xff) {
      pos = parseEntry(buf, pos + 1, msg, out);
    } else {
      return parseEntry(buf, pos, msg, out);
    }
  }
}

/**
 * Parse a detached .ots file. Returns { digest, pendings, bitcoins, unknown }.
 * pendings carry the calendar URI, the commitment bytes to query it with,
 * and the [start, end) byte range of the attestation entry for splicing.
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
  const out = { digest: Buffer.from(digest), pendings: [], bitcoins: [], unknown: [] };
  const end = parseTimestamp(buf, pos, Buffer.from(digest), out);
  if (end !== buf.length) throw new Error('ots: trailing bytes');
  return out;
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

/**
 * Attempt to upgrade a pending .ots: query each pending attestation's
 * calendar for the committed timestamp and splice it in place. A calendar
 * that is not ready yet (404) is normal and not a failure. Returns
 * { file, upgraded, notReady, failures } where file is the (possibly new)
 * buffer.
 */
export async function upgradeOts(buf, fetchFn = fetch) {
  const parsed = parseOts(buf);
  let file = buf;
  let upgraded = 0;
  let notReady = 0;
  const failures = [];
  // Splice from the last offset backwards so earlier offsets stay valid.
  const pendings = [...parsed.pendings].sort((a, b) => b.start - a.start);
  for (const pending of pendings) {
    try {
      const url = `${pending.uri.replace(/\/$/, '')}/timestamp/${pending.commitment.toString('hex')}`;
      const res = await fetchFn(url, {
        headers: { accept: 'application/vnd.opentimestamps.v1' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.status === 404) { notReady += 1; continue; }
      if (!res.ok) throw new Error(`http ${res.status}`);
      const continuation = await readBodyCapped(res);
      if (continuation.length === 0) throw new Error('empty continuation');
      const candidate = Buffer.concat([
        file.subarray(0, pending.start),
        continuation,
        file.subarray(pending.end),
      ]);
      parseOts(candidate); // reject a splice that does not parse
      file = candidate;
      upgraded += 1;
    } catch (err) {
      failures.push({ calendar: pending.uri, error: err.message });
    }
  }
  return { file, upgraded, notReady, failures };
}
