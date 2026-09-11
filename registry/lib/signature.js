// Submitted-signature verification (honesty slate item 1, 2026-09-11).
//
// The registry used to accept any bytes at all in `publicKey` and
// `signature` while public copy and directory badges implied a checked
// signature: `publicKey: "not a key"` returned ok. It now CHECKS, and
// records the answer on the record as `signatureVerified`.
//
// What "verified" means here is deliberately narrow, and nothing else is
// ever reported as verified: the submitted signature verifies, under the
// submitted key, over the submitted artifact hash (the 64-character
// lowercase hex string, as UTF-8 bytes). That is the only relation the
// registry can check, because the artefact itself never leaves the
// author's machine.
//
// Consequence, stated plainly rather than papered over: an `ssh-keygen -Y`
// signature (what the CLI produces today) signs the MANIFEST FILE, which
// the registry never receives, so it cannot be bound to the submitted hash
// and is recorded as verified:false. On every surface that reads as
// "signature submitted", never "signature verified". The bytes are still
// kept verbatim, and anyone holding the manifest can check them offline
// with ssh-keygen -Y verify.

import { createPublicKey, verify as edVerify } from 'node:crypto';

// SPKI DER prefix for an Ed25519 public key (RFC 8410): the 32 raw key
// bytes appended to this make a key node:crypto will import anywhere.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const HEX64_RE = /^[0-9a-f]{64}$/i;
const HEX128_RE = /^[0-9a-f]{128}$/i;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const SSH_ED25519_LINE_RE = /^ssh-ed25519\s+([A-Za-z0-9+/=]+)/;

function fromRaw(raw) {
  if (!Buffer.isBuffer(raw) || raw.length !== 32) return null;
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: 'der',
    type: 'spki',
  });
}

// Reads one SSH wire-format string (uint32 length, then that many bytes).
function sshString(buf, offset) {
  if (offset + 4 > buf.length) return null;
  const len = buf.readUInt32BE(offset);
  if (len > buf.length - offset - 4) return null;
  return { value: buf.subarray(offset + 4, offset + 4 + len), next: offset + 4 + len };
}

/** Parses the key encodings a registrant may plausibly submit. Returns a
 *  KeyObject, or null for anything unparseable (never throws). */
export function parsePublicKey(publicKey) {
  if (typeof publicKey !== 'string') return null;
  const value = publicKey.trim();
  if (value.length === 0) return null;
  try {
    if (value.includes('-----BEGIN')) {
      const key = createPublicKey(value);
      return key.asymmetricKeyType === 'ed25519' ? key : null;
    }
    const ssh = SSH_ED25519_LINE_RE.exec(value);
    if (ssh) {
      const blob = Buffer.from(ssh[1], 'base64');
      const name = sshString(blob, 0);
      if (!name || name.value.toString() !== 'ssh-ed25519') return null;
      const raw = sshString(blob, name.next);
      return raw ? fromRaw(raw.value) : null;
    }
    const hex = value.startsWith('ed25519:') ? value.slice('ed25519:'.length) : value;
    if (HEX64_RE.test(hex)) return fromRaw(Buffer.from(hex, 'hex'));
    return null;
  } catch {
    return null;
  }
}

/** Parses a raw 64-byte Ed25519 signature in hex or base64, with an
 *  optional `<label>:` prefix. An armoured SSH signature is NOT a raw
 *  signature and is refused here: see the header note. */
export function parseSignature(signature) {
  if (typeof signature !== 'string') return null;
  let value = signature.trim();
  if (value.length === 0 || value.includes('-----BEGIN')) return null;
  const colon = value.lastIndexOf(':');
  if (colon !== -1) value = value.slice(colon + 1);
  if (HEX128_RE.test(value)) return Buffer.from(value, 'hex');
  if (!BASE64_RE.test(value)) return null;
  const raw = Buffer.from(value, 'base64');
  return raw.length === 64 ? raw : null;
}

/**
 * True only when `signature` verifies under `publicKey` over the artifact
 * hash itself. False for every other case, including unparseable keys,
 * unparseable signatures, signatures over other bytes, and signature
 * formats the registry cannot relate to the hash. Never throws: a
 * malformed submission is recorded as unverified, not rejected with a 500.
 */
export function verifySubmittedSignature(hash, publicKey, signature) {
  try {
    if (typeof hash !== 'string' || !HEX64_RE.test(hash)) return false;
    const key = parsePublicKey(publicKey);
    const sig = parseSignature(signature);
    if (!key || !sig) return false;
    return edVerify(null, Buffer.from(hash, 'utf8'), key, sig);
  } catch {
    return false;
  }
}
