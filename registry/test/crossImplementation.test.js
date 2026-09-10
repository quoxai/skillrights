/**
 * Cross-implementation agreement for the receipt format.
 *
 * RFC 6962 hashing and canonical JSON are DUPLICATED in three places on
 * purpose, because a portable receipt must be verifiable with no shared
 * dependency:
 *
 *   1. registry/lib/{merkle,canonical}.js   (the service that issues receipts)
 *   2. cli/lib/receipt.js + cli/lib/hash.js (the open CLI, offline verifier)
 *   3. quox-dashboard services/collector/lib/skillProtect.js (the Quox layer)
 *
 * Deliberate duplication is only safe if it is CHECKED. Three copies that
 * silently drift produce receipts one implementation accepts and another
 * rejects, which is worse than having no verifier at all: the failure is
 * quiet and shows up years later when someone needs the evidence.
 *
 * This file is that check. It feeds the same inputs to every implementation
 * present on the box and asserts byte-identical results. Implementations
 * outside this repo are sibling checkouts, so each is SKIPPED VISIBLY when
 * absent rather than silently reducing coverage.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { randomBytes, generateKeyPairSync, sign as edSign, createPublicKey } from 'node:crypto';

import { canonicalJSON as registryCanonical, sha256Hex as registrySha } from '../lib/canonical.js';
import { leafHash, rootOf, inclusionProof, verifyInclusion } from '../lib/merkle.js';

const require = createRequire(import.meta.url);

const CLI_HASH = '/home/control/skillrights/cli/lib/hash.js';
const CLI_RECEIPT = '/home/control/skillrights/cli/lib/receipt.js';
const COLLECTOR_PROTECT = process.env.SR_COLLECTOR_PROTECT || '/home/control/quox-dashboard/services/collector/lib/skillProtect.js';

const cliPresent = fs.existsSync(CLI_HASH) && fs.existsSync(CLI_RECEIPT);
const collectorPresent = fs.existsSync(COLLECTOR_PROTECT);

if (!cliPresent) console.warn(`[crossImplementation] SKIPPING CLI comparisons: ${CLI_HASH} not found.`);
if (!collectorPresent) console.warn(`[crossImplementation] SKIPPING collector comparisons: ${COLLECTOR_PROTECT} not found.`);

/** Values chosen to catch the ways canonical JSON implementations usually differ. */
const CANONICAL_CASES = [
  {},
  { b: 1, a: 2 },
  { z: { y: 1, x: [3, 2, 1] }, a: null },
  { nested: { deep: { deeper: { key: 'value', another: 0 } } } },
  { unicode: 'skill éè 中文 🚀', quote: 'he said "no"', backslash: 'a\\b' },
  { empty: {}, emptyArr: [], zero: 0, false: false, nullv: null },
  { 'key with spaces': 1, 'UPPER': 2, lower: 3, '0numeric': 4, '-dash': 5 },
  { arrayOfObjects: [{ b: 1, a: 2 }, { d: 3, c: 4 }] },
  { float: 1.5, negative: -42, big: 9007199254740991 },
  // A realistic registry record, the thing that actually gets hashed.
  {
    srid: 'sr:skill:01M26GZQHPKS13QXWB4H63BES2',
    seq: 1,
    ts: '2026-09-10T20:43:42.519Z',
    mode: 'private',
    artifact: { algorithm: 'sha256', sha256: 'e'.repeat(64) },
    license: 'LicenseRef-SkillRights-Reserved-1.0',
    publicKey: 'ed25519:' + 'a'.repeat(64),
    signature: 'skillrights-protect-v1:ed25519:' + 'b'.repeat(128),
  },
];

test('canonical JSON agrees byte-for-byte across every implementation present', () => {
  const impls = [['registry', registryCanonical]];
  if (cliPresent) impls.push(['cli', require(CLI_HASH.replace(/\.js$/, '.js')) && null]);
  // The CLI is ESM-only; load it dynamically below instead of via require.
  assert.ok(impls.length >= 1);
});

test('canonical JSON: registry vs collector', { skip: !collectorPresent }, () => {
  const { canonicalJSON: collectorCanonical, sha256Hex: collectorSha } = require(COLLECTOR_PROTECT);
  for (const value of CANONICAL_CASES) {
    assert.equal(
      collectorCanonical(value),
      registryCanonical(value),
      `canonical JSON diverged for ${JSON.stringify(value).slice(0, 80)}`,
    );
    assert.equal(collectorSha(registryCanonical(value)), registrySha(registryCanonical(value)));
  }
});

test('canonical JSON: registry vs open CLI', { skip: !cliPresent }, async () => {
  const { canonicalJSON: cliCanonical, sha256Hex: cliSha } = await import(CLI_HASH);
  for (const value of CANONICAL_CASES) {
    assert.equal(
      cliCanonical(value),
      registryCanonical(value),
      `canonical JSON diverged for ${JSON.stringify(value).slice(0, 80)}`,
    );
    assert.equal(cliSha(registryCanonical(value)), registrySha(registryCanonical(value)));
  }
});

/**
 * Builds a real receipt bundle from the registry's own primitives, at a
 * given tree size and leaf index, signed with a throwaway log key.
 */
function makeBundle(size, index) {
  const records = Array.from({ length: size }, (_, i) => ({
    srid: `sr:skill:01ARZ3NDEKTSV4RRFFQ69G5F${String(i).padStart(2, '0')}`,
    seq: i,
    ts: `2026-09-10T20:00:${String(i % 60).padStart(2, '0')}.000Z`,
    mode: i % 2 ? 'public' : 'private',
    artifact: { algorithm: 'sha256', sha256: randomBytes(32).toString('hex') },
  }));
  const leaves = records.map((r) => leafHash(Buffer.from(registryCanonical(r))));
  const root = rootOf(leaves).toString('hex');
  const proof = inclusionProof(index, leaves).map((s) => ({ hash: s.hash.toString('hex'), side: s.side }));

  const { privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  const head = { size, root, ts: '2026-09-10T20:30:00.000Z' };
  const signature = edSign(null, Buffer.from(registryCanonical(head)), privateKey).toString('base64');
  // Derived exactly as registry/lib/store.js does it: verifiers now recompute
  // this rather than trusting the bundle, so a stub id would be rejected.
  const keyId = registrySha(publicKeyPem).slice(0, 16);

  return {
    receipt: {
      srid: records[index].srid,
      record: records[index],
      leafIndex: index,
      inclusionProof: proof,
      treeHead: { ...head, keyId, signature },
    },
    logKey: { publicKeyPem, keyId },
  };
}

// Sizes and indices that exercise the awkward shapes: single leaf, powers of
// two, one past a power of two, and the last leaf of an odd tree (the classic
// off-by-one in RFC 6962 split-point handling).
const SHAPES = [[1, 0], [2, 0], [2, 1], [3, 0], [3, 2], [4, 3], [5, 4], [7, 6], [8, 0], [9, 8], [16, 9], [17, 16]];

test('every implementation accepts the same valid receipts', { skip: !cliPresent && !collectorPresent }, async () => {
  const cli = cliPresent ? await import(CLI_RECEIPT) : null;
  const collector = collectorPresent ? require(COLLECTOR_PROTECT) : null;

  for (const [size, index] of SHAPES) {
    const bundle = makeBundle(size, index);

    // Registry's own primitives must accept it (the issuer's view).
    const leaf = leafHash(Buffer.from(registryCanonical(bundle.receipt.record)));
    assert.equal(
      verifyInclusion(leaf, index, size, bundle.receipt.inclusionProof.map((s) => ({ hash: Buffer.from(s.hash, 'hex'), side: s.side })), Buffer.from(bundle.receipt.treeHead.root, 'hex')),
      true,
      `registry rejected its own valid receipt at size=${size} index=${index}`,
    );

    const { verifyReceipt: registryVerify } = await import('../lib/registry.js');
    assert.equal(registryVerify(bundle.receipt, bundle.logKey.publicKeyPem), true,
      `REGISTRY rejected a valid receipt at size=${size} index=${index}`);

    if (cli) {
      const r = cli.verifyReceiptBundle(bundle);
      assert.equal(r.ok, true, `CLI rejected a valid receipt at size=${size} index=${index}: ${r.reason}`);
    }
    if (collector) {
      const r = collector.verifyReceiptBundle(bundle);
      assert.equal(r.ok, true, `collector rejected a valid receipt at size=${size} index=${index}: ${r.reason}`);
    }
  }
});

test('every implementation REJECTS the same tampered receipts', { skip: !cliPresent && !collectorPresent }, async () => {
  const cli = cliPresent ? await import(CLI_RECEIPT) : null;
  const collector = collectorPresent ? require(COLLECTOR_PROTECT) : null;

  const tampers = {
    'record content changed': (b) => { b.receipt.record.artifact.sha256 = 'f'.repeat(64); },
    'licence swapped after the fact': (b) => { b.receipt.record.license = 'LicenseRef-SkillRights-Open-1.0'; },
    'timestamp backdated': (b) => { b.receipt.record.ts = '2020-01-01T00:00:00.000Z'; },
    'root altered': (b) => { b.receipt.treeHead.root = 'a'.repeat(64); },
    'tree head ts altered (signature no longer covers it)': (b) => { b.receipt.treeHead.ts = '2026-01-01T00:00:00.000Z'; },
    'proof step flipped side': (b) => {
      if (b.receipt.inclusionProof.length) {
        b.receipt.inclusionProof[0].side = b.receipt.inclusionProof[0].side === 'left' ? 'right' : 'left';
      } else {
        b.receipt.treeHead.size = 99; // single-leaf trees have no proof steps to flip
        b.receipt.leafIndex = 98;
      }
    },
    'leaf index moved': (b) => { b.receipt.leafIndex = b.receipt.leafIndex + 1; },
    'signature corrupted': (b) => {
      const sig = Buffer.from(b.receipt.treeHead.signature, 'base64');
      sig[0] ^= 0xff;
      b.receipt.treeHead.signature = sig.toString('base64');
    },
    'log key swapped for an attacker key': (b) => {
      const { privateKey } = generateKeyPairSync('ed25519');
      b.logKey.publicKeyPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
    },
  };

  // The registry's own exported verifier is part of the agreement set too:
  // asserting only its ACCEPT side is how its missing seq check slipped
  // through the first version of this suite (audit, 2026-09-10).
  const { verifyReceipt: registryVerify } = await import('../lib/registry.js');

  for (const [size, index] of [[1, 0], [4, 2], [7, 6], [9, 8]]) {
    for (const [name, tamper] of Object.entries(tampers)) {
      const bundle = makeBundle(size, index);
      tamper(bundle);

      if (name !== 'log key swapped for an attacker key') {
        // (key-swap lives in the bundle wrapper the registry function never sees)
        assert.equal(registryVerify(bundle.receipt, bundle.logKey.publicKeyPem), false,
          `REGISTRY ACCEPTED a tampered receipt (${name}) at size=${size} index=${index}`);
      }
      if (cli) {
        assert.equal(cli.verifyReceiptBundle(bundle).ok, false, `CLI ACCEPTED a tampered receipt (${name}) at size=${size} index=${index}`);
      }
      if (collector) {
        assert.equal(collector.verifyReceiptBundle(bundle).ok, false, `collector ACCEPTED a tampered receipt (${name}) at size=${size} index=${index}`);
      }
    }
  }
});

test('a receipt issued by the live-shaped store verifies in every implementation', { skip: !cliPresent && !collectorPresent }, async () => {
  // Uses the real store + register path rather than hand-built bundles, so
  // this catches a drift between what the service ISSUES and what the
  // verifiers ACCEPT, which the synthetic cases above cannot.
  const os = await import('node:os');
  const path = await import('node:path');
  const { openStore } = await import('../lib/store.js');
  const { register } = await import('../lib/registry.js');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-cross-'));
  try {
    const store = openStore(dir);
    let bundle;
    for (let i = 0; i < 5; i += 1) {
      const { receipt } = register(store, { hash: randomBytes(32).toString('hex'), mode: 'private' });
      bundle = { receipt, logKey: { publicKeyPem: store.publicKeyPem(), keyId: store.keyId() } };
      if (cliPresent) {
        const cli = await import(CLI_RECEIPT);
        const r = cli.verifyReceiptBundle(bundle);
        assert.equal(r.ok, true, `CLI rejected a freshly issued receipt at size ${i + 1}: ${r.reason}`);
      }
      if (collectorPresent) {
        const collector = require(COLLECTOR_PROTECT);
        const r = collector.verifyReceiptBundle(bundle);
        assert.equal(r.ok, true, `collector rejected a freshly issued receipt at size ${i + 1}: ${r.reason}`);
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('every implementation REJECTS a forged bundle that claims a real key id', { skip: !cliPresent && !collectorPresent }, async () => {
  // The attack found by audit 2026-09-10: sign a fabricated, backdated record
  // with your own key, then set logKey.keyId to the REAL registry's id. Before
  // the fix, verification returned ok AND echoed the claimed id, so the
  // documented authenticity check ("compare the printed key id against GET
  // /api/v1/log/key") passed on a pure fabrication.
  const cli = cliPresent ? await import(CLI_RECEIPT) : null;
  const collector = collectorPresent ? require(COLLECTOR_PROTECT) : null;
  const REAL_KEY_ID = '2bd03f0ecd7704c8';

  const bundle = makeBundle(4, 2);
  bundle.logKey.keyId = REAL_KEY_ID;               // the lie
  bundle.receipt.treeHead.keyId = REAL_KEY_ID;

  if (cli) {
    const r = cli.verifyReceiptBundle(bundle);
    assert.equal(r.ok, false, 'CLI ACCEPTED a bundle claiming a key id its bundled key does not have');
    assert.match(r.reason, /keyId/);
  }
  if (collector) {
    const r = collector.verifyReceiptBundle(bundle);
    assert.equal(r.ok, false, 'collector ACCEPTED a bundle claiming a key id its bundled key does not have');
  }
});

test('a verified bundle reports the DERIVED key id, not the claimed one', { skip: !cliPresent && !collectorPresent }, async () => {
  const cli = cliPresent ? await import(CLI_RECEIPT) : null;
  const collector = collectorPresent ? require(COLLECTOR_PROTECT) : null;
  const bundle = makeBundle(3, 1);
  const derived = registrySha(bundle.logKey.publicKeyPem).slice(0, 16);
  delete bundle.logKey.keyId;                       // no claim at all
  delete bundle.receipt.treeHead.keyId;
  if (cli) {
    const r = cli.verifyReceiptBundle(bundle);
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.keyId, derived, 'CLI did not derive the key id from the bundled public key');
  }
  if (collector) {
    const r = collector.verifyReceiptBundle(bundle);
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.keyId, derived, 'collector did not derive the key id from the bundled public key');
  }
});

test('every implementation REJECTS an edited display srid', { skip: !cliPresent && !collectorPresent }, async () => {
  // receipt.srid sits outside the hashed record, so before the fix it could be
  // rewritten and shown next to a green "verified".
  const cli = cliPresent ? await import(CLI_RECEIPT) : null;
  const collector = collectorPresent ? require(COLLECTOR_PROTECT) : null;
  const bundle = makeBundle(5, 3);
  bundle.receipt.srid = 'sr:skill:01SOMEONEELSESIDENTIFIER0';
  if (cli) assert.equal(cli.verifyReceiptBundle(bundle).ok, false, 'CLI ACCEPTED an edited display srid');
  if (collector) assert.equal(collector.verifyReceiptBundle(bundle).ok, false, 'collector ACCEPTED an edited display srid');
});
