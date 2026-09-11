// SR-SIGV (2026-09-11): the CLI signs THE ARTIFACT HASH STRING it submits,
// with the user's existing Ed25519 SSH key, so the registry can actually
// verify the signature it records. Before this, the only signature sent was
// an `ssh-keygen -Y` signature over the MANIFEST FILE, which the registry
// never receives, so every live submission landed signatureVerified:false.
//
// The cross-test below is the point of this file: a signature produced by
// the CLI side, checked by the REGISTRY's own verifier, unmodified.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verify as edVerify } from 'node:crypto';

import { loadEd25519PrivateKey, signArtifactHash } from '../lib/sshkey.js';
import { runSign } from '../lib/sign.js';
import { runInit } from '../lib/init.js';
// Test-only cross-package import: the registry service lives in this same
// repository, and its verifier is the thing we must satisfy.
import { verifySubmittedSignature, parsePublicKey } from '../../registry/lib/signature.js';
import { throwawayEd25519, writeOpenSSHPrivateKey, opensshPublicLine } from './helpers/opensshKey.js';

const HASH = 'c'.repeat(64);

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sr-sigv-'));
}

/** Writes a throwaway key into a temp dir. Never touches ~/.ssh. */
function keyFile(options = {}) {
  const dir = tmpDir();
  const key = throwawayEd25519();
  const file = path.join(dir, 'id_ed25519');
  fs.writeFileSync(file, writeOpenSSHPrivateKey({ seed: key.seed, pub: key.pub, ...options }), { mode: 0o600 });
  return { dir, file, ...key };
}

test('parses an unencrypted OpenSSH ed25519 key and derives its public line', () => {
  const k = keyFile();
  const loaded = loadEd25519PrivateKey(k.file);

  assert.equal(loaded.publicKeyLine, opensshPublicLine(k.pub));
  assert.equal(loaded.comment, 'throwaway@test');
  assert.equal(loaded.privateKey.asymmetricKeyType, 'ed25519');

  // The parsed private key is the real one: a signature under it verifies
  // against the independently generated public key.
  const sig = signArtifactHash(HASH, k.file);
  assert.equal(edVerify(null, Buffer.from(HASH, 'utf8'), k.publicKey, Buffer.from(sig.signature, 'hex')), true);
});

test('CROSS-TEST: a CLI-produced signature verifies with the REGISTRY verifier', () => {
  const k = keyFile();
  const { signature, publicKey } = signArtifactHash(HASH, k.file);

  assert.match(signature, /^[0-9a-f]{128}$/, 'submitted as raw hex, the shape the registry parses');
  assert.ok(parsePublicKey(publicKey), 'the submitted public key parses registry-side');
  assert.equal(
    verifySubmittedSignature(HASH, publicKey, signature),
    true,
    'the registry must return signatureVerified:true for what the CLI submits'
  );

  // And it is bound to THIS hash: another hash does not verify.
  assert.equal(verifySubmittedSignature('d'.repeat(64), publicKey, signature), false);
});

test('signs the hash STRING bytes, not the decoded hash bytes', () => {
  const k = keyFile();
  const { signature, publicKey } = signArtifactHash(HASH, k.file);
  const key = parsePublicKey(publicKey);
  assert.equal(edVerify(null, Buffer.from(HASH, 'utf8'), key, Buffer.from(signature, 'hex')), true);
  assert.equal(edVerify(null, Buffer.from(HASH, 'hex'), key, Buffer.from(signature, 'hex')), false);
});

test('fails closed on a passphrase-protected key, and never prompts', () => {
  const k = keyFile({ cipher: 'aes256-ctr', kdf: 'bcrypt' });
  assert.throws(() => loadEd25519PrivateKey(k.file), (err) => {
    assert.match(err.message, /passphrase/i);
    assert.equal(err.code, 'ENCRYPTED_KEY');
    // The error must not leak any part of the key file.
    assert.ok(!err.message.includes('OPENSSH PRIVATE KEY'));
    return true;
  });
});

test('refuses keys that are not ed25519', () => {
  const k = keyFile({ keyType: 'ssh-rsa' });
  assert.throws(() => loadEd25519PrivateKey(k.file), /ed25519/i);
});

test('fails closed on malformed containers', () => {
  const cases = {
    'mismatched public key': keyFile({ mismatchedPub: throwawayEd25519().pub }),
    'bad check integers': keyFile({ badCheck: true }),
    'more than one key': keyFile({ keyCount: 2 }),
  };
  for (const [label, k] of Object.entries(cases)) {
    assert.throws(() => loadEd25519PrivateKey(k.file), Error, `should refuse: ${label}`);
  }

  const truncated = tmpDir();
  const file = path.join(truncated, 'id_ed25519');
  const k = throwawayEd25519();
  const good = writeOpenSSHPrivateKey({ seed: k.seed, pub: k.pub });
  fs.writeFileSync(file, good.slice(0, good.length / 2));
  assert.throws(() => loadEd25519PrivateKey(file), Error, 'should refuse a truncated file');

  const pkcs8 = path.join(truncated, 'pkcs8');
  fs.writeFileSync(pkcs8, k.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  assert.throws(() => loadEd25519PrivateKey(pkcs8), /OpenSSH/i, 'only the OpenSSH container is accepted');
});

test('sign attaches a registry-verifiable hash signature when the key is usable', () => {
  const k = keyFile();
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: t\ndescription: d\nauthor: a\n---\n\nBody.\n');
  runInit([dir], { license: 'notrain', yes: true });

  const result = runSign([dir], { key: k.file });
  assert.ok(result.hashSignature, 'a hash signature is produced');
  assert.equal(result.hashSignatureSkippedReason, null);
  assert.equal(result.publicKeyLine, opensshPublicLine(k.pub));
  assert.equal(verifySubmittedSignature(result.manifestSha256, result.publicKeyLine, result.hashSignature), true);
});

test('sign degrades honestly when the key cannot be used', () => {
  const k = keyFile({ cipher: 'aes256-ctr', kdf: 'bcrypt' });
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: t\ndescription: d\nauthor: a\n---\n\nBody.\n');
  runInit([dir], { license: 'notrain', yes: true });

  const result = runSign([dir], { key: k.file });
  assert.equal(result.hashSignature, null);
  assert.match(result.hashSignatureSkippedReason, /passphrase/i);
});
