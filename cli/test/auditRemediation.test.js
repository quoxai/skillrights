/**
 * Remediation tests for the external audit of 2026-09-11 (round 3), CLI half.
 *
 *   F2  canonicalization dropped an own `__proto__` property, so a record
 *       could carry a field the hashed bytes never saw;
 *   F3  `register` verified the receipt's internal consistency and then
 *       saved it WITHOUT comparing it to what this invocation submitted, so
 *       a valid receipt for someone else's registration was accepted;
 *   F15 the proof schema was looser than it looked (any hex-ish sibling
 *       decoded), and unsigned wrapper fields (version, whatThisProves) were
 *       trusted and echoed as if they were part of the evidence.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { canonicalJSON } from '../lib/hash.js';
import { runInit } from '../lib/init.js';
import { runRegister } from '../lib/register.js';
import { verifyReceiptBundle, WHAT_THIS_PROVES, RECEIPT_NAME } from '../lib/receipt.js';
// Test-only import across packages: the registry service lives in the same
// repository and mints the receipts this CLI has to agree with.
import { openStore } from '../../registry/lib/store.js';
import { register } from '../../registry/lib/registry.js';

test('F2: the CLI canonicalizer keeps an own __proto__ property', () => {
  const record = JSON.parse('{"a":1,"__proto__":{"owner":"alterable evidence"},"z":2}');
  assert.equal(canonicalJSON(record), '{"__proto__":{"owner":"alterable evidence"},"a":1,"z":2}');
  const nested = JSON.parse('{"meta":{"__proto__":{"owner":"x"},"name":"n"}}');
  assert.equal(canonicalJSON(nested), '{"meta":{"__proto__":{"owner":"x"},"name":"n"}}');
});

const FLAGS = { registry: 'https://registry.example', key: '/nonexistent/key' }; // unsigned: no ssh-keygen needed

/**
 * A skill directory plus a fake registry backed by the REAL store, so every
 * receipt it hands back is genuinely valid. `tamper` rewrites the submitted
 * body before the record is minted: that is how a valid receipt for a
 * different registration is produced.
 */
async function fixture() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-cli-audit-'));
  const skillDir = path.join(workDir, 'skill');
  fs.mkdirSync(skillDir);
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    '---\nname: cluster-doctor\ndescription: Diagnose clusters like a veteran.\nauthor: test-signer\n---\n\nBody.\n',
  );
  await runInit([skillDir], { license: 'notrain', yes: true });
  const store = openStore(path.join(workDir, 'registry-data'));
  const logKey = { publicKeyPem: store.publicKeyPem(), keyId: store.keyId() };
  const submissions = [];

  const registryFetch = (tamper = (b) => b) => async (url, opts) => {
    if (url.endsWith('/api/v1/register')) {
      const body = JSON.parse(opts.body);
      submissions.push(body);
      const { receipt } = register(store, tamper({ ...body }));
      return { status: 201, json: async () => ({ receipt }) };
    }
    return { ok: true, status: 200, json: async () => logKey };
  };

  return { workDir, skillDir, store, logKey, registryFetch, submissions };
}

test('F3: a valid receipt for a DIFFERENT registration is refused, not saved', async () => {
  const { workDir, skillDir, registryFetch } = await fixture();
  try {
    // Genuine and fully verifiable, but for another artifact, another mode
    // and another signer. The audit accepted exactly this.
    const otherRegistration = () => ({
      hash: 'c'.repeat(64),
      mode: 'public',
      author: 'someone-else',
      license: 'LicenseRef-SkillRights-Open-1.0',
    });
    await assert.rejects(
      runRegister([skillDir], FLAGS, registryFetch(otherRegistration)),
      /does not match what was submitted/,
    );
    assert.equal(fs.existsSync(path.join(skillDir, RECEIPT_NAME)), false,
      'a receipt that does not describe this registration was saved anyway');
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('F3: every submitted field is compared, one at a time', async () => {
  const variants = {
    'artifact hash': (b) => ({ ...b, hash: 'd'.repeat(64) }),
    mode: (b) => ({ ...b, mode: 'public' }),
    licence: (b) => ({ ...b, license: 'LicenseRef-SkillRights-Open-1.0' }),
    author: (b) => ({ ...b, author: 'not-the-signer' }),
    'dropped licence': (b) => { const c = { ...b }; delete c.license; return c; },
    'unrequested metadata': (b) => ({ ...b, mode: 'public', meta: { name: 'someone elses skill' } }),
  };
  for (const [what, tamper] of Object.entries(variants)) {
    const { workDir, skillDir, registryFetch } = await fixture();
    try {
      await assert.rejects(
        runRegister([skillDir], FLAGS, registryFetch(tamper)),
        /does not match what was submitted/,
        `a mismatched ${what} was accepted`,
      );
      assert.equal(fs.existsSync(path.join(skillDir, RECEIPT_NAME)), false);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
});

test('F3: the honest receipt for this exact submission is accepted and saved', async () => {
  const { workDir, skillDir, registryFetch, submissions } = await fixture();
  try {
    const result = await runRegister([skillDir], FLAGS, registryFetch());
    assert.equal(result.mode, 'unlisted');
    assert.equal(result.hash, submissions[0].hash);
    assert.ok(fs.existsSync(result.receiptPath));
    const bundle = JSON.parse(fs.readFileSync(result.receiptPath, 'utf8'));
    assert.equal(bundle.receipt.record.artifact.sha256, submissions[0].hash);
    assert.equal(verifyReceiptBundle(bundle).ok, true);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('F15: an unknown receipt or bundle version is refused', async () => {
  const { workDir, skillDir, registryFetch } = await fixture();
  try {
    const result = await runRegister([skillDir], FLAGS, registryFetch());
    const bundle = JSON.parse(fs.readFileSync(result.receiptPath, 'utf8'));
    assert.equal(verifyReceiptBundle(bundle).ok, true);

    const futureReceipt = JSON.parse(JSON.stringify(bundle));
    futureReceipt.receipt.version = 99;
    assert.match(verifyReceiptBundle(futureReceipt).reason, /version/);

    const futureBundle = JSON.parse(JSON.stringify(bundle));
    futureBundle.version = 99;
    assert.match(verifyReceiptBundle(futureBundle).reason, /version/);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('F15: whatThisProves is derived locally, never echoed from the bundle', async () => {
  const { workDir, skillDir, registryFetch } = await fixture();
  try {
    const result = await runRegister([skillDir], FLAGS, registryFetch());
    assert.equal(result.whatThisProves, WHAT_THIS_PROVES);
    const bundle = JSON.parse(fs.readFileSync(result.receiptPath, 'utf8'));

    // The string is unsigned transport metadata: a holder can rewrite it.
    bundle.receipt.whatThisProves = 'This receipt proves legal ownership of the skill.';
    const verification = verifyReceiptBundle(bundle);
    assert.equal(verification.ok, true, verification.reason);
    assert.equal(verification.whatThisProves, WHAT_THIS_PROVES);
    assert.ok(!/legal ownership of the skill/.test(verification.whatThisProves));
    assert.match(WHAT_THIS_PROVES, /does not prove legal ownership/);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('F15: the CLI rejects array-like proofs and sloppy sibling hex', async () => {
  const { workDir, skillDir, store, registryFetch } = await fixture();
  try {
    // Fill the log first so the receipt carries real proof steps.
    for (let i = 0; i < 3; i += 1) register(store, { hash: String(i).repeat(64), mode: 'private' });
    const result = await runRegister([skillDir], FLAGS, registryFetch());
    const saved = JSON.parse(fs.readFileSync(result.receiptPath, 'utf8'));
    assert.equal(verifyReceiptBundle(saved).ok, true);
    assert.ok(saved.receipt.inclusionProof.length > 0, 'fixture produced no proof steps to tamper with');

    const suffixed = JSON.parse(JSON.stringify(saved));
    suffixed.receipt.inclusionProof[0].hash += 'zz';
    assert.equal(verifyReceiptBundle(suffixed).ok, false, 'CLI accepted an invalid hex suffix on a sibling hash');

    const arrayLike = JSON.parse(JSON.stringify(saved));
    const steps = arrayLike.receipt.inclusionProof;
    const fake = { length: steps.length };
    steps.forEach((s, i) => { fake[i] = s; });
    arrayLike.receipt.inclusionProof = fake;
    assert.equal(verifyReceiptBundle(arrayLike).ok, false, 'CLI accepted an array-like proof object');
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('register refuses a directory with no SKILL.md before touching the network (the empty-dir junk record)', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srempty-'));
  let fetched = false;
  const { runRegister } = await import('../lib/register.js');
  await assert.rejects(
    () => runRegister([dir], { public: true, yes: true }, async () => { fetched = true; throw new Error('must not fetch'); }, () => {}),
    /SKILL\.md/i,
  );
  assert.equal(fetched, false, 'no network before validation');
  fs.rmSync(dir, { recursive: true, force: true });
});
