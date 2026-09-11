// Item 2 of the Phase One reconciliation honesty slate (2026-09-11): the
// mode formerly called "private" is "unlisted". The public log endpoint
// serves every record regardless of directory visibility, so "private"
// promised confidentiality the service never delivered. Existing rows keep
// the value they were stored with; the API accepts both spellings and
// normalises new records to "unlisted".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../lib/store.js';
import { register, validateRegistration } from '../lib/registry.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'srmode-'));
}

test('both spellings are accepted and new records normalise to unlisted', () => {
  const store = openStore(tmpDir());
  assert.equal(validateRegistration({ hash: HASH_A, mode: 'unlisted' }).ok, true);
  assert.equal(validateRegistration({ hash: HASH_A, mode: 'private' }).ok, true);
  assert.equal(validateRegistration({ hash: HASH_A, mode: 'secret' }).ok, false);

  assert.equal(register(store, { hash: HASH_A, mode: 'private' }).record.mode, 'unlisted');
  assert.equal(register(store, { hash: HASH_B, mode: 'unlisted' }).record.mode, 'unlisted');
  assert.equal(register(store, { hash: HASH_A, mode: 'public' }).record.mode, 'public');
});

test('meta stays public-only under either spelling', () => {
  assert.equal(validateRegistration({ hash: HASH_A, mode: 'unlisted', meta: { name: 'x' } }).ok, false);
  assert.equal(validateRegistration({ hash: HASH_A, mode: 'private', meta: { name: 'x' } }).ok, false);
});

test('counts report unlisted, and keep the legacy private key for existing readers', () => {
  const dir = tmpDir();
  const store = openStore(dir);
  register(store, { hash: HASH_A, mode: 'private' });
  register(store, { hash: HASH_B, mode: 'unlisted' });
  register(store, { hash: HASH_A, mode: 'public' });
  const counts = store.counts();
  assert.equal(counts.registrations, 3);
  assert.equal(counts.public, 1);
  assert.equal(counts.unlisted, 2);
  assert.equal(counts.private, 2, 'legacy key kept so existing directory readers do not break');
});

test('a record stored as private before the rename keeps its bytes on reload', () => {
  const dir = tmpDir();
  const store = openStore(dir);
  // Written the way the pre-rename service wrote it.
  store.append({
    srid: 'sr:skill:01ARZ3NDEKTSV4RRFFQ69G5FAV',
    seq: 0,
    ts: '2026-09-01T00:00:00.000Z',
    mode: 'private',
    artifact: { algorithm: 'sha256', sha256: HASH_A },
  });
  const reloaded = openStore(dir);
  assert.equal(reloaded.getBySrid('sr:skill:01ARZ3NDEKTSV4RRFFQ69G5FAV').record.mode, 'private');
  assert.equal(reloaded.counts().unlisted, 1, 'legacy private rows count as unlisted');
});
