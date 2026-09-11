// SR-SIGV (2026-09-11): read the user's EXISTING Ed25519 SSH private key and
// sign the artifact hash string the registry actually receives.
//
// Why this exists: `ssh-keygen -Y sign` signs the MANIFEST FILE, which never
// leaves the author's machine, so the registry could only ever record that
// signature verbatim and mark it signatureVerified:false. Signing the hash
// string itself is the one relation the registry CAN check, so the same key
// the author already has now produces a signature the log can verify. No new
// key management, no new file, no agent.
//
// Security rules this file obeys, deliberately and without exception:
//   - private key material is read into memory, used, and the buffers holding
//     it are zeroed; it is never copied to another path, logged, printed,
//     included in an error message, or transmitted anywhere;
//   - a passphrase-protected key is REFUSED, never prompted for and never
//     handed to ssh-agent: the caller degrades to manifest-file signing;
//   - anything that is not an unencrypted single ed25519 OpenSSH key is
//     refused. The parser fails closed on every malformed shape rather than
//     guessing, because a guess here would sign under the wrong key.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPrivateKey, sign as edSign } from 'node:crypto';

const AUTH_MAGIC = Buffer.from('openssh-key-v1\0', 'binary');
// RFC 8410 PKCS#8 prefix for an Ed25519 private key; the 32-byte seed is
// appended to make a key node:crypto will import.
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const PEM_RE = /-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]+?)-----END OPENSSH PRIVATE KEY-----/;

function fail(message, code) {
  const err = new Error(message);
  if (code) err.code = code;
  return err;
}

/** Reads one SSH wire string (uint32 length then that many bytes). */
function sshString(buf, offset) {
  if (offset + 4 > buf.length) return null;
  const len = buf.readUInt32BE(offset);
  if (len > buf.length - offset - 4) return null;
  return { value: buf.subarray(offset + 4, offset + 4 + len), next: offset + 4 + len };
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

function wire(value) {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  return Buffer.concat([u32(buf.length), buf]);
}

export function resolveHome(p) {
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return path.resolve(p);
}

/** The default key this CLI looks for, matching what `sign` already used. */
export function defaultKeyPath() {
  return path.join(os.homedir(), '.ssh', 'id_ed25519');
}

/**
 * Parses an UNENCRYPTED OpenSSH ed25519 private key. Returns the 32-byte
 * seed, the 32-byte public key and the comment. Throws (fails closed) on
 * anything else: encrypted keys, other algorithms, multi-key files,
 * inconsistent inner/outer public keys, truncation, or trailing junk.
 *
 * The returned seed is the CALLER'S to zero; loadEd25519PrivateKey does that.
 */
export function parseOpenSSHPrivateKey(text) {
  if (typeof text !== 'string') throw fail('the key file could not be read as text');
  const pem = PEM_RE.exec(text);
  if (!pem) throw fail('not an OpenSSH private key (expected an OPENSSH PRIVATE KEY block)');

  const body = Buffer.from(pem[1].replace(/\s+/g, ''), 'base64');
  if (body.length < AUTH_MAGIC.length || !body.subarray(0, AUTH_MAGIC.length).equals(AUTH_MAGIC)) {
    throw fail('not an OpenSSH private key (bad magic)');
  }
  let off = AUTH_MAGIC.length;

  const cipher = sshString(body, off);
  if (!cipher) throw fail('the OpenSSH private key is malformed (truncated cipher name)');
  off = cipher.next;
  const kdf = sshString(body, off);
  if (!kdf) throw fail('the OpenSSH private key is malformed (truncated kdf name)');
  off = kdf.next;
  const kdfOptions = sshString(body, off);
  if (!kdfOptions) throw fail('the OpenSSH private key is malformed (truncated kdf options)');
  off = kdfOptions.next;

  const cipherName = cipher.value.toString('utf8');
  const kdfName = kdf.value.toString('utf8');
  if (cipherName !== 'none' || kdfName !== 'none') {
    throw fail(
      'the key is protected by a passphrase, so this CLI cannot use it to sign the registry hash (it never prompts for passphrases or uses ssh-agent)',
      'ENCRYPTED_KEY'
    );
  }

  if (off + 4 > body.length) throw fail('the OpenSSH private key is malformed (truncated key count)');
  const keyCount = body.readUInt32BE(off);
  off += 4;
  if (keyCount !== 1) throw fail(`the OpenSSH private key holds ${keyCount} keys; only single-key files are supported`);

  const publicBlob = sshString(body, off);
  if (!publicBlob) throw fail('the OpenSSH private key is malformed (truncated public key)');
  off = publicBlob.next;
  const privateSection = sshString(body, off);
  if (!privateSection) throw fail('the OpenSSH private key is malformed (truncated private section)');
  if (privateSection.next !== body.length) throw fail('the OpenSSH private key is malformed (trailing data)');

  const outerType = sshString(publicBlob.value, 0);
  if (!outerType) throw fail('the OpenSSH private key is malformed (unreadable public key type)');
  if (outerType.value.toString('utf8') !== 'ssh-ed25519') {
    throw fail(`the key is ${outerType.value.toString('utf8')}, not ed25519; SkillRights signs with ed25519 keys only`);
  }
  const outerPub = sshString(publicBlob.value, outerType.next);
  if (!outerPub || outerPub.value.length !== 32 || outerPub.next !== publicBlob.value.length) {
    throw fail('the OpenSSH private key is malformed (bad public key blob)');
  }

  const priv = privateSection.value;
  if (priv.length < 8 || priv.length % 8 !== 0) throw fail('the OpenSSH private key is malformed (bad private section length)');
  if (priv.readUInt32BE(0) !== priv.readUInt32BE(4)) {
    // For an unencrypted key these always match; a mismatch means corruption
    // (or an encrypted body mislabelled as plaintext).
    throw fail('the OpenSSH private key is malformed or encrypted (check integers do not match)');
  }
  let p = 8;
  const innerType = sshString(priv, p);
  if (!innerType) throw fail('the OpenSSH private key is malformed (unreadable inner key type)');
  if (innerType.value.toString('utf8') !== 'ssh-ed25519') {
    throw fail(`the key is ${innerType.value.toString('utf8')}, not ed25519; SkillRights signs with ed25519 keys only`);
  }
  p = innerType.next;
  const innerPub = sshString(priv, p);
  if (!innerPub || innerPub.value.length !== 32) throw fail('the OpenSSH private key is malformed (bad inner public key)');
  p = innerPub.next;
  const secret = sshString(priv, p);
  if (!secret || secret.value.length !== 64) throw fail('the OpenSSH private key is malformed (bad private key length)');
  p = secret.next;
  const comment = sshString(priv, p);
  if (!comment) throw fail('the OpenSSH private key is malformed (unreadable comment)');
  p = comment.next;
  for (let i = 0; p + i < priv.length; i += 1) {
    if (priv[p + i] !== ((i + 1) & 0xff)) throw fail('the OpenSSH private key is malformed (bad padding)');
  }

  // The public key appears three times (outer blob, inner copy, tail of the
  // secret). All three must agree or we do not know which key we are holding.
  if (!innerPub.value.equals(outerPub.value) || !secret.value.subarray(32).equals(outerPub.value)) {
    throw fail('the OpenSSH private key is inconsistent (public key does not match the private key)');
  }

  return {
    seed: Buffer.from(secret.value.subarray(0, 32)),
    publicKey: Buffer.from(outerPub.value),
    comment: comment.value.toString('utf8'),
  };
}

/** The OpenSSH `ssh-ed25519 AAAA... comment` line for 32 raw public bytes. */
export function opensshPublicLine(publicKey, comment = '') {
  const blob = Buffer.concat([wire('ssh-ed25519'), wire(publicKey)]);
  const line = `ssh-ed25519 ${blob.toString('base64')}`;
  return comment ? `${line} ${comment}` : line;
}

/**
 * Loads a usable signing key from a path. Returns a node:crypto KeyObject
 * plus the matching OpenSSH public line (which is what gets submitted, and
 * is the shape the registry's verifier already accepts).
 *
 * The seed buffer is zeroed once the KeyObject holds the key; no copy of the
 * private material is kept by this module.
 */
export function loadEd25519PrivateKey(keyPath) {
  const text = fs.readFileSync(keyPath, 'utf8');
  const parsed = parseOpenSSHPrivateKey(text);
  const pkcs8 = Buffer.concat([ED25519_PKCS8_PREFIX, parsed.seed]);
  try {
    const privateKey = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
    return {
      privateKey,
      publicKeyLine: opensshPublicLine(parsed.publicKey, parsed.comment),
      comment: parsed.comment,
    };
  } finally {
    parsed.seed.fill(0);
    pkcs8.fill(0);
  }
}

/**
 * Signs the artifact hash STRING (the 64-character lowercase hex digest, as
 * UTF-8 bytes) with the key at `keyPath`. Returns the signature as raw hex
 * and the public key as an OpenSSH line, which is exactly the pair the
 * registry checks in verifySubmittedSignature(hash, publicKey, signature).
 */
export function signArtifactHash(hash, keyPath) {
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/i.test(hash)) {
    throw fail('refusing to sign: the artifact hash is not a 64-character hex digest');
  }
  const { privateKey, publicKeyLine } = loadEd25519PrivateKey(keyPath);
  const signature = edSign(null, Buffer.from(hash, 'utf8'), privateKey).toString('hex');
  return { signature, publicKey: publicKeyLine };
}
