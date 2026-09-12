// Read-only OpenTimestamps parser, dependency-free, for verifying a receipt's
// embedded Bitcoin anchor with nothing but this CLI. It is the parsing half of
// the registry's registry/lib/ots.js, verbatim in structure so the two agree
// byte-for-byte on what a proof commits to; the calendar/submit/upgrade
// networking lives only on the server and is deliberately absent here.
//
// What this establishes: a detached .ots commits a 32-byte digest to one or
// more Bitcoin blocks. parseOts returns that digest and the block height(s).
// It does NOT itself confirm the block against the Bitcoin chain: that final
// step is what the standard `ots verify` tool (or a block explorer) does, and
// the receipt/verify output points the holder at it.

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

// Resource bounds mirror registry/lib/ots.js: these parsers run on bytes a
// holder may have received from anywhere, so a crafted proof must not be able
// to blow up memory or spin the CPU. Matches the reference python-opentimestamps.
export const MAX_MSG_LENGTH = 4096;
export const MAX_OPS = 512;

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

function readVarbytes(buf, pos) {
  const [len, p] = readVarint(buf, pos);
  if (p + len > buf.length) throw new Error('ots: truncated varbytes');
  return [buf.subarray(p, p + len), p + len];
}

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
  return { item: { kind: 'op', tag, child: child.node }, pos: child.pos };
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

function walkTree(node, out) {
  node.items.forEach((item) => {
    if (item.kind === 'op') { walkTree(item.child, out); return; }
    if (item.tag.equals(ATT_PENDING)) out.pendings.push({});
    else if (item.tag.equals(ATT_BITCOIN)) {
      const [height] = readVarint(item.payload, 0);
      out.bitcoins.push({ height });
    } else out.unknown.push({ tag: item.tag.toString('hex') });
  });
}

/**
 * Parse a detached .ots buffer. Returns { digest, pendings, bitcoins, unknown }
 * where digest is the committed 32 bytes and bitcoins carries { height } for
 * each Bitcoin attestation found.
 */
export function parseOts(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (!buf.subarray(0, OTS_MAGIC.length).equals(OTS_MAGIC)) throw new Error('ots: bad magic');
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
  const out = { digest: Buffer.from(digest), pendings: [], bitcoins: [], unknown: [] };
  walkTree(node, out);
  return out;
}
