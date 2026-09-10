import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server.js';
import { openStore } from '../lib/store.js';

function boot(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-anchapi-'));
  const store = openStore(dir);
  const server = createServer({ dataDir: dir, store, ...extra });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ dir, store, server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

test('log entries endpoint pages the raw mirrorable log', async () => {
  const { dir, store, server, base } = await boot();
  for (let i = 0; i < 3; i += 1) {
    store.append({ srid: `sr:skill:01ARZ3NDEKTSV4RRFFQ69G5FA${'ABC'[i]}`, seq: i, ts: new Date().toISOString(), mode: 'private', artifact: { algorithm: 'sha256', sha256: String(i).repeat(64).slice(0, 64) } });
  }
  const all = await (await fetch(`${base}/api/v1/log/entries`)).json();
  assert.equal(all.size, 3);
  assert.equal(all.entries.length, 3);
  assert.ok(all.entries[0].leaf);
  const page = await (await fetch(`${base}/api/v1/log/entries?start=1&limit=1`)).json();
  assert.equal(page.entries.length, 1);
  assert.equal(page.entries[0].record.seq, 1);
  const bad = await fetch(`${base}/api/v1/log/entries?start=-1`);
  assert.equal(bad.status, 400);
  await bad.text();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('anchors endpoints list and serve raw anchor files', async () => {
  const { dir, server, base } = await boot();
  const root = 'ab'.repeat(32);
  const anchorsDir = path.join(dir, 'anchors');
  fs.writeFileSync(path.join(anchorsDir, `1-${root}.tsr`), Buffer.from('3003020100', 'hex'));

  const list = await (await fetch(`${base}/api/v1/log/anchors`)).json();
  assert.equal(list.anchors.length, 1);
  assert.equal(list.anchors[0].tsr, true);
  assert.equal(list.anchors[0].ots, null);

  const raw = await fetch(`${base}/api/v1/log/anchor/1-${root}.tsr`);
  assert.equal(raw.status, 200);
  assert.equal(raw.headers.get('content-type'), 'application/timestamp-reply');
  assert.deepEqual(Buffer.from(await raw.arrayBuffer()), Buffer.from('3003020100', 'hex'));

  // Percent-encoded traversal survives client URL normalization and must be
  // rejected by the name regex server-side.
  const trav = await fetch(`${base}/api/v1/log/anchor/%2e%2e%2fpasswd`);
  assert.equal(trav.status, 400);
  await trav.text();
  const missing = await fetch(`${base}/api/v1/log/anchor/2-${root}.ots`);
  assert.equal(missing.status, 404);
  await missing.text();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('robots.txt disallows crawling of the API host', async () => {
  const { dir, server, base } = await boot();
  const res = await fetch(`${base}/robots.txt`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Disallow: \//);
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
