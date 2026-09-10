import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verify as edVerify } from 'node:crypto';
import { openStore } from '../lib/store.js';
import { validateRegistration, register, verifyReceipt } from '../lib/registry.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'srreg-'));
}

function goodBody(extra = {}) {
  return {
    hash: HASH_A,
    mode: 'private',
    license: 'LicenseRef-SkillRights-NoTrain-1.0',
    author: 'adam@quox.ai',
    ...extra,
  };
}

test('validateRegistration accepts a minimal private registration', () => {
  const v = validateRegistration(goodBody());
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});

test('validateRegistration rejects bad hashes, modes, and meta on private', () => {
  assert.equal(validateRegistration(goodBody({ hash: 'nope' })).ok, false);
  assert.equal(validateRegistration(goodBody({ hash: HASH_A.toUpperCase() })).ok, false);
  assert.equal(validateRegistration(goodBody({ mode: 'secret' })).ok, false);
  assert.equal(validateRegistration(goodBody({ meta: { name: 'x' } })).ok, false, 'meta requires public mode');
  assert.equal(validateRegistration(goodBody({ supersedes: 'short' })).ok, false);
  assert.equal(validateRegistration({}).ok, false);
});

test('validateRegistration enforces size caps', () => {
  assert.equal(validateRegistration(goodBody({ license: 'x'.repeat(200) })).ok, false);
  assert.equal(validateRegistration(goodBody({ author: 'x'.repeat(300) })).ok, false);
  assert.equal(validateRegistration(goodBody({ signature: 'x'.repeat(9000) })).ok, false);
  const v = validateRegistration({ hash: HASH_A, mode: 'public', meta: { name: 'n'.repeat(300) } });
  assert.equal(v.ok, false);
});

test('register mints an SRID, appends, and the receipt self-verifies', () => {
  const store = openStore(tmpDir());
  const { receipt } = register(store, goodBody());
  assert.match(receipt.srid, /^sr:skill:[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.equal(receipt.record.artifact.sha256, HASH_A);
  assert.equal(receipt.leafIndex, 0);
  assert.equal(receipt.treeHead.size, 1);
  assert.equal(verifyReceipt(receipt, store.publicKeyPem()), true);
});

test('receipts keep verifying as the log grows, and tampering breaks them', () => {
  const store = openStore(tmpDir());
  const first = register(store, goodBody()).receipt;
  const second = register(store, goodBody({ hash: HASH_B })).receipt;
  assert.equal(second.leafIndex, 1);
  assert.equal(verifyReceipt(first, store.publicKeyPem()), true, 'first receipt against its own tree head');
  assert.equal(verifyReceipt(second, store.publicKeyPem()), true);
  const tampered = JSON.parse(JSON.stringify(second));
  tampered.record.artifact.sha256 = HASH_A;
  assert.equal(verifyReceipt(tampered, store.publicKeyPem()), false);
});

test('the log survives a restart (append-only JSONL reload)', () => {
  const dir = tmpDir();
  let store = openStore(dir);
  const { receipt } = register(store, goodBody());
  register(store, goodBody({ hash: HASH_B, mode: 'public', meta: { name: 'Cluster Doctor' } }));
  store = openStore(dir); // fresh process
  assert.equal(store.size(), 2);
  const rec = store.getBySrid(receipt.srid);
  assert.equal(rec.record.artifact.sha256, HASH_A);
  const matches = store.getByHash(HASH_B);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].record.meta.name, 'Cluster Doctor');
});

test('the same hash may be registered twice; chronology is preserved', () => {
  const store = openStore(tmpDir());
  const r1 = register(store, goodBody()).receipt;
  const r2 = register(store, goodBody({ author: 'someone-else@example.com' })).receipt;
  const matches = store.getByHash(HASH_A);
  assert.equal(matches.length, 2);
  assert.equal(matches[0].record.srid, r1.srid, 'first-seen order preserved');
  assert.equal(matches[1].record.srid, r2.srid);
  assert.ok(r1.record.seq < r2.record.seq);
});

test('supersedes is recorded verbatim as a claim', () => {
  const store = openStore(tmpDir());
  const { receipt } = register(store, goodBody({ hash: HASH_B, supersedes: HASH_A }));
  assert.equal(receipt.record.supersedes, HASH_A);
});

test('tree head signature is a real Ed25519 signature over the canonical head', () => {
  const store = openStore(tmpDir());
  const { receipt } = register(store, goodBody());
  const { size, root, ts, keyId, signature } = receipt.treeHead;
  const headBytes = Buffer.from(JSON.stringify({ root, size, ts }));
  const ok = edVerify(null, headBytes, store.publicKeyPem(), Buffer.from(signature, 'base64'));
  assert.equal(ok, true);
  assert.equal(typeof keyId, 'string');
});
