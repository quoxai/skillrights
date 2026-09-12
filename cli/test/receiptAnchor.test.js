import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInit } from '../lib/init.js';
import { runRegister, runReceipt, runReceiptUpgrade, runReceiptExtractOts } from '../lib/register.js';
import { verifyAnchor, RECEIPT_NAME } from '../lib/receipt.js';
// Cross-package test imports: the registry lives in the same repo. Runtime CLI
// stays dependency-free; these are only used to stand up a real log + anchor.
import { createServer } from '../../registry/server.js';
import { openStore } from '../../registry/lib/store.js';
import { serializeOts, writeVarint } from '../../registry/lib/ots.js';

const ATT_BITCOIN = Buffer.from('0588960d73d71901', 'hex');
const BLOCK = 966403;

function bitcoinOts(rootHex, height) {
  const digest = Buffer.from(rootHex, 'hex');
  return serializeOts(digest, { msg: digest, items: [{ kind: 'att', tag: ATT_BITCOIN, payload: writeVarint(height) }] });
}

// Register one skill against a live in-process registry, then hand-anchor the
// resulting tree size to Bitcoin. Returns everything a test needs.
async function setup() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-recanchor-'));
  const skillDir = path.join(workDir, 'skill');
  fs.mkdirSync(skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\nname: cluster-doctor\ndescription: Diagnose clusters.\nauthor: test-signer\n---\n\nBody.\n`);
  await runInit([skillDir], { license: 'notrain', yes: true });

  const dataDir = path.join(workDir, 'registry-data');
  const store = openStore(dataDir);
  const server = createServer({ dataDir, store });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const registry = `http://127.0.0.1:${server.address().port}`;

  await runRegister([skillDir], { registry, public: true });

  // Anchor the current tree size (1) to Bitcoin by writing the .ots the worker
  // would have written once calendars committed.
  const size = store.size();
  const rootHex = store.rootAtSize(size);
  fs.writeFileSync(path.join(dataDir, 'anchors', `${size}-${rootHex}.ots`), bitcoinOts(rootHex, BLOCK));

  return { workDir, skillDir, server, registry, rootHex, size };
}

test('receipt --upgrade embeds a Bitcoin anchor that verifies offline', async () => {
  const { workDir, skillDir, server, rootHex } = await setup();
  try {
    const up = await runReceiptUpgrade([skillDir], {});
    assert.equal(up.state, 'upgraded');
    assert.equal(up.root, rootHex);
    assert.deepEqual(up.bitcoinHeights, [BLOCK]);

    const bundle = JSON.parse(fs.readFileSync(path.join(skillDir, RECEIPT_NAME), 'utf8'));
    assert.equal(bundle.version, 2);
    assert.ok(bundle.anchor && typeof bundle.anchor.ots === 'string');

    // Verifies with the registry gone entirely (offline is the whole point).
    server.close();
    const v = verifyAnchor(bundle);
    assert.equal(v.ok, true, v.reason);
    assert.deepEqual(v.bitcoinHeights, [BLOCK]);

    // A second upgrade is a no-op ("already").
    const again = await runReceiptUpgrade([skillDir], {});
    assert.equal(again.state, 'already');
  } finally {
    try { server.close(); } catch { /* already closed */ }
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('runReceipt reports the anchor once upgraded', async () => {
  const { workDir, skillDir, server } = await setup();
  try {
    await runReceiptUpgrade([skillDir], {});
    const r = runReceipt([skillDir]);
    assert.equal(r.ok, true);
    assert.equal(r.anchor.ok, true);
    assert.deepEqual(r.anchor.bitcoinHeights, [BLOCK]);
  } finally {
    try { server.close(); } catch { /* already closed */ }
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('extract-ots writes a standalone proof whose digest is the anchored root', async () => {
  const { workDir, skillDir, server, rootHex } = await setup();
  try {
    await runReceiptUpgrade([skillDir], {});
    const ex = runReceiptExtractOts([skillDir]);
    assert.equal(ex.state, 'written');
    assert.equal(ex.digest, rootHex);
    assert.ok(fs.existsSync(ex.otsPath));
    // The written bytes are exactly the .ots for that root.
    const { parseOts } = await import('../lib/ots.js');
    const parsed = parseOts(fs.readFileSync(ex.otsPath));
    assert.equal(parsed.digest.toString('hex'), rootHex);
  } finally {
    try { server.close(); } catch { /* already closed */ }
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('verifyAnchor rejects tampering: wrong root, corrupt ots, altered proof', async () => {
  const { workDir, skillDir, server } = await setup();
  try {
    await runReceiptUpgrade([skillDir], {});
    const good = JSON.parse(fs.readFileSync(path.join(skillDir, RECEIPT_NAME), 'utf8'));
    assert.equal(verifyAnchor(good).ok, true);

    // (a) claim a different anchored root: inclusion proof no longer reaches it.
    const wrongRoot = { ...good, anchor: { ...good.anchor, root: 'ff'.repeat(32) } };
    assert.equal(verifyAnchor(wrongRoot).ok, false);

    // (b) corrupt the .ots bytes.
    const badOts = Buffer.from(good.anchor.ots, 'base64');
    badOts[badOts.length - 1] ^= 0xff;
    const corrupt = { ...good, anchor: { ...good.anchor, ots: badOts.toString('base64') } };
    assert.equal(verifyAnchor(corrupt).ok, false);

    // (c) tamper with a sibling hash in the inclusion proof (single-leaf tree
    // has an empty proof, so instead flip the leafIndex out of range).
    const badIndex = JSON.parse(JSON.stringify(good));
    badIndex.receipt.leafIndex = 5;
    assert.equal(verifyAnchor(badIndex).ok, false);

    // (d) no anchor at all reports cleanly, not a crash.
    const noAnchor = { ...good };
    delete noAnchor.anchor;
    const na = verifyAnchor(noAnchor);
    assert.equal(na.ok, false);
    assert.match(na.reason, /no anchor/);
  } finally {
    try { server.close(); } catch { /* already closed */ }
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('receipt --upgrade reports pending when no Bitcoin anchor covers the leaf', async () => {
  // Register but do NOT write any anchor file: upgrade must say "pending".
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-recanchor-pending-'));
  const skillDir = path.join(workDir, 'skill');
  fs.mkdirSync(skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\nname: cluster-doctor\ndescription: x.\nauthor: t\n---\n\nBody.\n`);
  await runInit([skillDir], { license: 'open', yes: true });
  const dataDir = path.join(workDir, 'registry-data');
  const server = createServer({ dataDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const registry = `http://127.0.0.1:${server.address().port}`;
  try {
    await runRegister([skillDir], { registry, public: true });
    const up = await runReceiptUpgrade([skillDir], {});
    assert.equal(up.state, 'pending');
  } finally {
    server.close();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
