// Test-only helper: builds OpenSSH private key files from throwaway
// node:crypto Ed25519 keypairs, in a temp dir. Tests NEVER read ~/.ssh and
// never use the developer's own keys; every key here is generated for the
// test and thrown away with the temp dir.

import { generateKeyPairSync, randomBytes } from 'node:crypto';

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

function sshString(value) {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  return Buffer.concat([u32(buf.length), buf]);
}

function armour(body) {
  const b64 = body.toString('base64').replace(/(.{70})/g, '$1\n');
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${b64}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

/** A throwaway Ed25519 keypair, with the raw seed and public bytes the
 *  OpenSSH container format needs. */
export function throwawayEd25519() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const seed = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32));
  const pub = Buffer.from(publicKey.export({ type: 'spki', format: 'der' }).subarray(-32));
  return { publicKey, privateKey, seed, pub };
}

/**
 * Serialises an unencrypted (or, for fail-closed tests, a fake-encrypted)
 * OpenSSH private key. Options let a test corrupt exactly one field:
 *   cipher      ciphername, default 'none' ('aes256-ctr' fakes an encrypted key)
 *   kdf         kdfname, default 'none'
 *   keyType     the inner key type string, default 'ssh-ed25519'
 *   mismatchedPub  write a different public key inside the private section
 *   badCheck    make the two check integers differ
 *   keyCount    number of keys declared, default 1
 */
export function writeOpenSSHPrivateKey({
  seed,
  pub,
  comment = 'throwaway@test',
  cipher = 'none',
  kdf = 'none',
  keyType = 'ssh-ed25519',
  mismatchedPub = null,
  badCheck = false,
  keyCount = 1,
} = {}) {
  const publicBlob = Buffer.concat([sshString('ssh-ed25519'), sshString(pub)]);
  const check = randomBytes(4);
  const check2 = badCheck ? Buffer.from([check[0] ^ 0xff, check[1], check[2], check[3]]) : check;
  const innerPub = mismatchedPub || pub;

  let priv = Buffer.concat([
    check,
    check2,
    sshString(keyType),
    sshString(innerPub),
    sshString(Buffer.concat([seed, innerPub])),
    sshString(comment),
  ]);
  let pad = 1;
  while (priv.length % 8 !== 0) priv = Buffer.concat([priv, Buffer.from([pad++])]);

  const body = Buffer.concat([
    Buffer.from('openssh-key-v1\0', 'binary'),
    sshString(cipher),
    sshString(kdf),
    sshString(''),
    u32(keyCount),
    sshString(publicBlob),
    sshString(priv),
  ]);
  return armour(body);
}

/** The OpenSSH public line a correct parser must derive from that file. */
export function opensshPublicLine(pub, comment = 'throwaway@test') {
  const blob = Buffer.concat([sshString('ssh-ed25519'), sshString(pub)]);
  return `ssh-ed25519 ${blob.toString('base64')} ${comment}`;
}
