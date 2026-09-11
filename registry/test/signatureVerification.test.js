// Item 1 of the Phase One reconciliation honesty slate (2026-09-11): a
// registration that carries a public key and a signature is CHECKED at
// submission time, and the answer is recorded on the record. Before this,
// arbitrary bytes were accepted while the directory badge said "signed".
//
// What a true answer means here is narrow on purpose: the submitted
// signature verifies, under the submitted key, over the submitted artifact
// hash. Anything the registry cannot relate to that hash (an SSH signature
// over a manifest file it never receives, for instance) is FALSE, which
// reads on every surface as "signature submitted", never "verified".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, sign as edSign } from 'node:crypto';
import { openStore } from '../lib/store.js';
import { register, validateRegistration, verifySubmittedSignature } from '../lib/registry.js';
import { canonicalJSON } from '../lib/canonical.js';
import { leafHash } from '../lib/merkle.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'srsig-'));
}

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    privateKey,
    pem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    rawHex: publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex'),
    sign: (message) => edSign(null, Buffer.from(message), privateKey),
  };
}

test('a real Ed25519 signature over the artifact hash verifies (PEM, raw hex, ed25519: prefixed)', () => {
  const k = keypair();
  const sigB64 = k.sign(HASH_A).toString('base64');
  const sigHex = k.sign(HASH_A).toString('hex');

  assert.equal(verifySubmittedSignature(HASH_A, k.pem, sigB64), true, 'PEM key, base64 signature');
  assert.equal(verifySubmittedSignature(HASH_A, k.rawHex, sigHex), true, 'raw hex key, hex signature');
  assert.equal(verifySubmittedSignature(HASH_A, `ed25519:${k.rawHex}`, `ed25519:${sigB64}`), true, 'prefixed forms');
});

test('an OpenSSH ed25519 public key line is accepted as a key encoding', () => {
  const k = keypair();
  const raw = Buffer.from(k.rawHex, 'hex');
  const name = Buffer.from('ssh-ed25519');
  const blob = Buffer.concat([
    Buffer.from([0, 0, 0, name.length]), name,
    Buffer.from([0, 0, 0, raw.length]), raw,
  ]);
  const sshLine = `ssh-ed25519 ${blob.toString('base64')} test@example.com`;
  assert.equal(verifySubmittedSignature(HASH_A, sshLine, k.sign(HASH_A).toString('base64')), true);
});

test('signatures over other bytes, garbage keys and garbage signatures are false, never a throw', () => {
  const k = keypair();
  const other = keypair();
  assert.equal(verifySubmittedSignature(HASH_A, k.pem, k.sign(HASH_B).toString('base64')), false, 'signed a different hash');
  assert.equal(verifySubmittedSignature(HASH_A, other.pem, k.sign(HASH_A).toString('base64')), false, 'wrong key');
  assert.equal(verifySubmittedSignature(HASH_A, 'not a key', 'not a signature'), false);
  assert.equal(verifySubmittedSignature(HASH_A, k.pem, 'not a signature'), false);
  assert.equal(verifySubmittedSignature(HASH_A, undefined, 'x'), false);
  assert.equal(verifySubmittedSignature(HASH_A, k.pem, undefined), false);
});

test('an SSH signature over a manifest the registry never sees is NOT verified', () => {
  // Honest by construction: the bytes ssh-keygen -Y signed are the manifest
  // file, which never leaves the author's machine, so the registry cannot
  // bind that signature to the submitted hash.
  const sshsig = '-----BEGIN SSH SIGNATURE-----\nU1NIU0lHAAAAAQ==\n-----END SSH SIGNATURE-----\n';
  assert.equal(verifySubmittedSignature(HASH_A, 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5', sshsig), false);
});

test('register stores signatureVerified true for a good signature and false for garbage', () => {
  const store = openStore(tmpDir());
  const k = keypair();

  const good = register(store, {
    hash: HASH_A,
    mode: 'unlisted',
    publicKey: k.pem,
    signature: k.sign(HASH_A).toString('base64'),
  }).record;
  assert.equal(good.signatureVerified, true);

  const bad = register(store, {
    hash: HASH_B,
    mode: 'unlisted',
    publicKey: 'not a key',
    signature: 'not a signature',
  }).record;
  assert.equal(bad.signatureVerified, false);
});

test('a signature with no key, or a key with no signature, is recorded honestly', () => {
  const store = openStore(tmpDir());
  const k = keypair();

  const sigOnly = register(store, { hash: HASH_A, mode: 'unlisted', signature: k.sign(HASH_A).toString('base64') }).record;
  assert.equal(sigOnly.signatureVerified, false, 'no key to check against');

  const keyOnly = register(store, { hash: HASH_B, mode: 'unlisted', publicKey: k.pem }).record;
  assert.equal('signatureVerified' in keyOnly, false, 'no signature, so nothing to report');
});

test('records without a signature carry no signatureVerified field at all', () => {
  const store = openStore(tmpDir());
  const { record } = register(store, { hash: HASH_A, mode: 'unlisted', author: 'a@example.com' });
  assert.equal('signatureVerified' in record, false);
  assert.deepEqual(Object.keys(record).sort(), ['artifact', 'author', 'mode', 'seq', 'srid', 'ts']);
});

test('the shipped production record still hashes to its published root (canonical bytes pinned)', () => {
  // sr:skill:01M26A1FG6KZ0A994WBQJEWY7Q, the first registration. It predates
  // signatureVerified and must keep its exact bytes: the new field is
  // additive for NEW records only. Pinned as a FROZEN FIXTURE: the live
  // receipt path was re-registered on 2026-09-11 (the verified-signature
  // dogfood), so reading it live made this test assert yesterday's file
  // (test went red for a day while production was fine: the test name lied).
  const bundlePath = path.join(HERE, 'fixtures', 'first-production-receipt.json');
  const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
  const record = bundle.receipt.record;
  assert.equal('signatureVerified' in record, false, 'an existing record must not gain fields');
  assert.equal(record.mode, 'public');
  const leaf = leafHash(Buffer.from(canonicalJSON(record))).toString('hex');
  assert.equal(leaf, bundle.receipt.treeHead.root, 'single-entry tree: leaf IS the published root');
  assert.equal(leaf, '7d81435671c78b22005818872394d51da9f7098c0224cc2503ffa8bc4f6f5624');
});

test('the CURRENT committed receipt is the second registration, verified-signature era', () => {
  const bundlePath = path.join(HERE, '..', '..', 'integrations', 'claude-skill', 'skillrights', '.skillrights.receipt.json');
  const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
  const record = bundle.receipt.record;
  assert.equal(record.srid, 'sr:skill:01M27J5PQAY039QZYR4N1PJD8N');
  assert.equal(record.signatureVerified, true, 'the dogfood registration was registry-verified');
});

test('validateRegistration still refuses a signature past the cap before any verification', () => {
  const v = validateRegistration({ hash: HASH_A, mode: 'unlisted', signature: 'x'.repeat(9000) });
  assert.equal(v.ok, false);
});
