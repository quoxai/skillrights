// Phase One reconciliation honesty slate (2026-09-11), CLI half:
//   item 2 - "private" becomes "unlisted", and register discloses what
//            enters the public log BEFORE it sends anything.
//   item 3 - check fails on duplicate license: fields, the LICENSES
//            ancestor walk stops at a package boundary, verify reports
//            integrity and signature as separate named statuses, and
//            receipt compares itself with the local directory.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runInit } from '../lib/init.js';
import { runCheck, MAX_LICENSE_WALK_LEVELS } from '../lib/check.js';
import { runSign, MANIFEST_NAME } from '../lib/sign.js';
import { runVerify } from '../lib/verify.js';
import { runRegister, runReceipt, REGISTRATION_DISCLOSURE } from '../lib/register.js';
import { RECEIPT_NAME } from '../lib/receipt.js';
import { createServer } from '../../registry/server.js';

function sshKeygenAvailable() {
  const r = spawnSync('ssh-keygen', ['-V'], { encoding: 'utf8' });
  return !r.error;
}

function mkSkillDir(frontmatter) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillrights-recon-'));
  fs.writeFileSync(path.join(dir, 'SKILL.md'), frontmatter || `---\nname: cluster-doctor\ndescription: Diagnose failing clusters.\n---\n\nBody.\n`);
  return dir;
}

// --- item 3: duplicate licence fields ------------------------------------

test('check FAILS when SKILL.md declares license twice', async () => {
  const dir = mkSkillDir();
  await runInit([dir], { license: 'notrain', yes: true });
  const skillPath = path.join(dir, 'SKILL.md');
  const content = fs.readFileSync(skillPath, 'utf8');
  fs.writeFileSync(skillPath, content.replace('name: cluster-doctor', 'name: cluster-doctor\nlicense: LicenseRef-SkillRights-Open-1.0'));

  const result = runCheck([dir]);
  assert.equal(result.ok, false, result.findings.join('; '));
  assert.ok(result.findings.some((f) => /declares "license" 2 times/.test(f)), result.findings.join('; '));

  fs.rmSync(dir, { recursive: true, force: true });
});

// --- item 3: bounded LICENSES walk ---------------------------------------

test('the LICENSES walk stops at a .git package boundary', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillrights-recon-'));
  const pkg = path.join(root, 'package');
  const skillDir = path.join(pkg, 'skills', 'restart-things');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\nname: restart-things\n---\n\nBody.\n`);
  await runInit([skillDir], { license: 'reserved', yes: true });

  // The only licence text now sits ABOVE the package boundary.
  fs.renameSync(path.join(skillDir, 'LICENSES'), path.join(root, 'LICENSES'));
  fs.mkdirSync(path.join(pkg, '.git'));

  const result = runCheck([skillDir]);
  assert.equal(result.ok, false, 'a licence outside the package must not be adopted');
  assert.ok(result.findings.some((f) => f.includes('Missing licence text')), result.findings.join('; '));
  assert.ok(result.findings.some((f) => f.includes('package boundary')), result.findings.join('; '));

  fs.rmSync(root, { recursive: true, force: true });
});

test('the LICENSES walk gives up after a bounded number of levels', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillrights-recon-'));
  const depth = MAX_LICENSE_WALK_LEVELS + 3;
  let deep = root;
  for (let i = 0; i < depth; i += 1) deep = path.join(deep, `d${i}`);
  fs.mkdirSync(deep, { recursive: true });
  fs.writeFileSync(path.join(deep, 'SKILL.md'), `---\nname: deep\n---\n\nBody.\n`);
  await runInit([deep], { license: 'open', yes: true });
  fs.renameSync(path.join(deep, 'LICENSES'), path.join(root, 'LICENSES'));

  const result = runCheck([deep]);
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.includes('Missing licence text')), result.findings.join('; '));

  fs.rmSync(root, { recursive: true, force: true });
});

// --- item 3: verify status split -----------------------------------------

test('verify reports integrity and signature as separate statuses; unsigned is exit 0', async () => {
  const dir = mkSkillDir();
  await runInit([dir], { license: 'notrain', yes: true });
  runSign([dir], { key: path.join(dir, 'no-such-key') }); // manifest only, no signature

  const result = runVerify([dir], {});
  assert.equal(result.status.integrity, 'pass');
  assert.equal(result.status.signature, 'absent');
  assert.equal(result.ok, true, result.findings.join('; '));
  assert.ok(result.findings.some((f) => f.includes('unsigned: integrity only')), result.findings.join('; '));

  // Integrity failure is still a failure.
  fs.appendFileSync(path.join(dir, 'SKILL.md'), '\nTampered.\n');
  const tampered = runVerify([dir], {});
  assert.equal(tampered.status.integrity, 'fail');
  assert.equal(tampered.ok, false);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('verify separates a present-but-unchecked signature from a verified one', { skip: !sshKeygenAvailable() }, async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'skillrights-recon-'));
  const dir = path.join(work, 'skill');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: cluster-doctor\nauthor: test-signer\n---\n\nBody.\n`);
  await runInit([dir], { license: 'notrain', yes: true });

  const keyPath = path.join(work, 'testkey');
  assert.equal(spawnSync('ssh-keygen', ['-t', 'ed25519', '-f', keyPath, '-N', ''], { encoding: 'utf8' }).status, 0);
  assert.equal(runSign([dir], { key: keyPath }).signed, true);

  const unchecked = runVerify([dir], {});
  assert.equal(unchecked.status.signature, 'present');
  assert.equal(unchecked.ok, true, 'not checked is not a failure, but it is never reported as verified');
  assert.ok(unchecked.findings.some((f) => /not checked/i.test(f)));

  const signersPath = path.join(work, 'allowed_signers');
  fs.writeFileSync(signersPath, `test-signer ${fs.readFileSync(`${keyPath}.pub`, 'utf8').trim()}\n`);
  const verified = runVerify([dir], { signers: signersPath });
  assert.equal(verified.status.signature, 'verified');
  assert.equal(verified.status.integrity, 'pass');
  assert.equal(verified.ok, true, verified.findings.join('; '));

  // A signature that is present and does NOT verify fails.
  const otherKey = path.join(work, 'otherkey');
  spawnSync('ssh-keygen', ['-t', 'ed25519', '-f', otherKey, '-N', ''], { encoding: 'utf8' });
  fs.writeFileSync(signersPath, `test-signer ${fs.readFileSync(`${otherKey}.pub`, 'utf8').trim()}\n`);
  const failed = runVerify([dir], { signers: signersPath });
  assert.equal(failed.status.signature, 'failed');
  assert.equal(failed.ok, false);

  fs.rmSync(work, { recursive: true, force: true });
});

// --- item 2 + item 1 + item 3: register, receipt --------------------------

test('register defaults to unlisted, discloses the public log first, and surfaces signature status', { skip: !sshKeygenAvailable() }, async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'skillrights-recon-'));
  const dir = path.join(work, 'skill');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: cluster-doctor\ndescription: Diagnose clusters.\nauthor: test-signer\n---\n\nBody.\n`);
  await runInit([dir], { license: 'notrain', yes: true });
  const keyPath = path.join(work, 'testkey');
  spawnSync('ssh-keygen', ['-t', 'ed25519', '-f', keyPath, '-N', ''], { encoding: 'utf8' });

  const server = createServer({ dataDir: path.join(work, 'registry-data') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const registry = `http://127.0.0.1:${server.address().port}`;

  const lines = [];
  try {
    let disclosedBeforeSend = false;
    const fetchFn = (...args) => {
      disclosedBeforeSend = lines.includes(REGISTRATION_DISCLOSURE);
      return fetch(...args);
    };
    const result = await runRegister([dir], { key: keyPath, registry }, fetchFn, (line) => lines.push(line));
    assert.equal(disclosedBeforeSend, true, 'the disclosure is printed before anything is sent');
    assert.equal(result.mode, 'unlisted');
    assert.match(REGISTRATION_DISCLOSURE, /PUBLIC append-only log/);
    assert.match(REGISTRATION_DISCLOSURE, /unlisted/);

    // SR-SIGV (2026-09-11): the CLI now signs the submitted hash itself with
    // the same ed25519 SSH key, so the registry verifies it rather than
    // merely recording it. Before this the only submittable signature covered
    // the manifest FILE, which the registry never receives, and this read
    // false. It reads true only because the registry's signed record says so.
    assert.equal(result.signatureVerified, true);
    assert.equal(result.signatureKind, 'artifact-hash');

    const check = runReceipt([dir]);
    assert.equal(check.ok, true, check.reason || '');
    assert.equal(check.mode, 'unlisted');
    assert.equal(check.signatureVerified, true);
    assert.equal(check.localArtifact, 'match', 'the receipt hash matches the local manifest');

    // Re-sign the directory after an edit: the receipt now describes an
    // older artefact, and says so without failing.
    fs.appendFileSync(path.join(dir, 'SKILL.md'), '\nA later edit.\n');
    runSign([dir], { key: keyPath });
    const stale = runReceipt([dir]);
    assert.equal(stale.ok, true, 'the receipt itself still verifies');
    assert.equal(stale.localArtifact, 'mismatch');

    // Standalone: a receipt with no manifest beside it is not a failure.
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'skillrights-recon-'));
    fs.copyFileSync(path.join(dir, RECEIPT_NAME), path.join(bare, RECEIPT_NAME));
    const standalone = runReceipt([bare]);
    assert.equal(standalone.ok, true);
    assert.equal(standalone.localArtifact, 'not-checked');
    assert.ok(!fs.existsSync(path.join(bare, MANIFEST_NAME)));
    fs.rmSync(bare, { recursive: true, force: true });
  } finally {
    server.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
