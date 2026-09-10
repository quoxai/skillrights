import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server.js';

const HASH_A = 'c'.repeat(64);
const HASH_B = 'd'.repeat(64);

let server;
let base;

before(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srreg-api-'));
  server = createServer({ dataDir, postBurst: 5, getBurst: 200 });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('health responds with log size', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(typeof body.registrations, 'number');
});

test('POST /api/v1/register returns a 201 receipt for a private registration', async () => {
  const res = await fetch(`${base}/api/v1/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hash: HASH_A, mode: 'private', license: 'LicenseRef-SkillRights-Reserved-1.0' }),
  });
  assert.equal(res.status, 201);
  const { receipt } = await res.json();
  assert.match(receipt.srid, /^sr:skill:/);
  assert.equal(receipt.record.mode, 'private');
  assert.ok(Array.isArray(receipt.inclusionProof));
});

test('GET by srid and by hash both resolve', async () => {
  const reg = await (await fetch(`${base}/api/v1/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hash: HASH_B, mode: 'public', meta: { name: 'API Skill', repository: 'https://github.com/example/skill' } }),
  })).json();

  const bySrid = await (await fetch(`${base}/api/v1/registry/${reg.receipt.srid}`)).json();
  assert.equal(bySrid.record.artifact.sha256, HASH_B);

  const byHash = await (await fetch(`${base}/api/v1/hash/${HASH_B}`)).json();
  assert.equal(byHash.matches.length, 1);
  assert.equal(byHash.matches[0].srid, reg.receipt.srid);
});

test('unknown srid is 404, malformed hash is 400', async () => {
  assert.equal((await fetch(`${base}/api/v1/registry/sr:skill:00000000000000000000000000`)).status, 404);
  assert.equal((await fetch(`${base}/api/v1/hash/zz`)).status, 400);
});

test('invalid registration is 400 with named errors', async () => {
  const res = await fetch(`${base}/api/v1/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hash: 'nope', mode: 'private' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.errors.length >= 1);
});

test('tree head and log key endpoints expose verifiable state', async () => {
  const head = await (await fetch(`${base}/api/v1/log/tree-head`)).json();
  assert.ok(head.size >= 2);
  assert.match(head.root, /^[a-f0-9]{64}$/);
  const key = await (await fetch(`${base}/api/v1/log/key`)).json();
  assert.match(key.publicKeyPem, /BEGIN PUBLIC KEY/);
  assert.equal(key.keyId, head.keyId);
});

test('stats reports aggregate counts only', async () => {
  const stats = await (await fetch(`${base}/api/v1/stats`)).json();
  assert.ok(stats.registrations >= 2);
  assert.ok(stats.public >= 1);
  assert.ok(stats.private >= 1);
});

test('oversized bodies are rejected with 413', async () => {
  const res = await fetch(`${base}/api/v1/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hash: HASH_A, mode: 'private', signature: 'x'.repeat(80000) }),
  });
  assert.equal(res.status, 413);
});

test('POST rate limiting kicks in past the burst', async () => {
  let limited = false;
  for (let i = 0; i < 12; i++) {
    const res = await fetch(`${base}/api/v1/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hash: HASH_A, mode: 'private' }),
    });
    if (res.status === 429) { limited = true; break; }
  }
  assert.equal(limited, true, 'expected a 429 within 12 rapid posts at burst 5');
});
