import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server.js';
import { openStore } from '../lib/store.js';
import { serializeOts, writeVarint, parseOts } from '../lib/ots.js';
import { verifyInclusion } from '../lib/merkle.js';

// The Bitcoin attestation tag, as emitted by real calendars (registry/lib/ots.js).
const ATT_BITCOIN = Buffer.from('0588960d73d71901', 'hex');

// A minimal-but-valid detached .ots that commits `rootHex` to a Bitcoin block.
// Real proofs carry an op chain from the digest to the block's merkle root;
// our code only reads the committed digest and the block height (the op chain
// is what the external `ots verify` tool checks against Bitcoin), so a bare
// bitcoin attestation over the digest exercises exactly what we assert here.
function bitcoinOts(rootHex, height) {
  const digest = Buffer.from(rootHex, 'hex');
  const tree = { msg: digest, items: [{ kind: 'att', tag: ATT_BITCOIN, payload: writeVarint(height) }] };
  return serializeOts(digest, tree);
}

function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-anchproof-'));
  const store = openStore(dir);
  const server = createServer({ dataDir: dir, store });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ dir, store, server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

function seed(store, n) {
  for (let i = 0; i < n; i += 1) {
    store.append({
      srid: `sr:skill:01ARZ3NDEKTSV4RRFFQ69G5F${'ABCDEFGH'[i]}${'A'}`,
      seq: i,
      ts: new Date().toISOString(),
      mode: 'public',
      artifact: { algorithm: 'sha256', sha256: String(i).repeat(64).slice(0, 64) },
    });
  }
}

test('inclusionProofAtSize proves an early leaf against a later root', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-anchproof-unit-'));
  const store = openStore(dir);
  seed(store, 7);
  const size = 5;
  const rootHex = store.rootAtSize(size);
  const built = store.inclusionProofAtSize(1, size);
  assert.equal(built.root, rootHex);
  const leaf = Buffer.from(store.entries()[1].leaf, 'hex');
  assert.equal(verifyInclusion(leaf, 1, size, built.proof, rootHex), true);
  // Out of range and impossible sizes are refused, not silently wrong.
  assert.equal(store.inclusionProofAtSize(5, 5), null);
  assert.equal(store.inclusionProofAtSize(0, 99), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('anchored-proof endpoint returns a Bitcoin-anchored chain a client can verify', async () => {
  const { dir, store, server, base } = await boot();
  seed(store, 6);
  const anchorSize = 4;
  const rootHex = store.rootAtSize(anchorSize);
  const anchorsDir = path.join(dir, 'anchors');
  fs.writeFileSync(path.join(anchorsDir, `${anchorSize}-${rootHex}.ots`), bitcoinOts(rootHex, 966403));

  const res = await fetch(`${base}/api/v1/log/anchored-proof?index=1`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.leafIndex, 1);
  assert.equal(body.anchor.size, anchorSize);
  assert.equal(body.anchor.root, rootHex);
  assert.deepEqual(body.anchor.bitcoinHeights, [966403]);
  assert.equal(body.otsUrl, `/api/v1/log/anchor/${anchorSize}-${rootHex}.ots`);

  // The whole point: the returned proof reaches the anchored root with no
  // trust in the registry's signature.
  const leaf = Buffer.from(store.entries()[1].leaf, 'hex');
  assert.equal(verifyInclusion(leaf, 1, anchorSize, body.inclusionProof, rootHex), true);

  // And the .ots at otsUrl commits exactly that root to Bitcoin.
  const otsRes = await fetch(`${base}${body.otsUrl}`);
  assert.equal(otsRes.status, 200);
  const parsed = parseOts(Buffer.from(await otsRes.arrayBuffer()));
  assert.equal(parsed.digest.toString('hex'), rootHex);
  assert.deepEqual(parsed.bitcoins.map((b) => b.height), [966403]);

  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('anchored-proof picks the smallest confirmed anchor that covers the leaf', async () => {
  const { dir, store, server, base } = await boot();
  seed(store, 8);
  const anchorsDir = path.join(dir, 'anchors');
  for (const size of [3, 6]) {
    const rootHex = store.rootAtSize(size);
    fs.writeFileSync(path.join(anchorsDir, `${size}-${rootHex}.ots`), bitcoinOts(rootHex, 966400 + size));
  }
  // Leaf 1 is covered by both; the smaller (size 3) wins.
  const a = await (await fetch(`${base}/api/v1/log/anchored-proof?index=1`)).json();
  assert.equal(a.anchor.size, 3);
  // Leaf 4 is only covered by size 6.
  const b = await (await fetch(`${base}/api/v1/log/anchored-proof?index=4`)).json();
  assert.equal(b.anchor.size, 6);
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('anchored-proof reports no_bitcoin_anchor_yet and bad input honestly', async () => {
  const { dir, store, server, base } = await boot();
  seed(store, 4);
  // A pending (non-bitcoin) anchor does not count.
  const rootHex = store.rootAtSize(4);
  const anchorsDir = path.join(dir, 'anchors');
  const digest = Buffer.from(rootHex, 'hex');
  const pending = serializeOts(digest, { msg: digest, items: [{ kind: 'att', tag: Buffer.from('83dfe30d2ef90c8e', 'hex'), payload: Buffer.concat([writeVarint(20), Buffer.from('https://a.pool.opentimestamps.org', 'utf8')]) }] });
  fs.writeFileSync(path.join(anchorsDir, `4-${rootHex}.ots`), pending);

  const none = await fetch(`${base}/api/v1/log/anchored-proof?index=0`);
  assert.equal(none.status, 404);
  assert.equal((await none.json()).error, 'no_bitcoin_anchor_yet');

  const oor = await fetch(`${base}/api/v1/log/anchored-proof?index=99`);
  assert.equal(oor.status, 404);
  await oor.text();

  const bad = await fetch(`${base}/api/v1/log/anchored-proof?index=-1`);
  assert.equal(bad.status, 400);
  await bad.text();

  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
