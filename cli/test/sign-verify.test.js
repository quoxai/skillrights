import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runInit } from '../lib/init.js';
import { runSign } from '../lib/sign.js';
import { runVerify } from '../lib/verify.js';

function sshKeygenAvailable() {
  const r = spawnSync('ssh-keygen', ['-V'], { encoding: 'utf8' });
  return !r.error;
}

// This test generates its own disposable Ed25519 key pair inside the test's
// temp directory. It never touches the real user's ~/.ssh directory.
test('sign then verify passes; tampering a file makes verify fail', { skip: !sshKeygenAvailable() }, async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillrights-signtest-'));
  const skillDir = path.join(workDir, 'skill');
  fs.mkdirSync(skillDir);
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: cluster-doctor\nauthor: test-signer\n---\n\nBody.\n`
  );
  fs.writeFileSync(path.join(skillDir, 'README.md'), '# cluster-doctor\n');
  await runInit([skillDir], { license: 'notrain', yes: true });

  const keyPath = path.join(workDir, 'testkey');
  const gen = spawnSync('ssh-keygen', ['-t', 'ed25519', '-f', keyPath, '-N', ''], { encoding: 'utf8' });
  assert.equal(gen.status, 0, gen.stderr);

  const signResult = runSign([skillDir], { key: keyPath });
  assert.equal(signResult.signed, true, signResult.signSkippedReason || '');
  assert.ok(fs.existsSync(signResult.manifestPath));
  assert.ok(fs.existsSync(signResult.sigPath));

  const pubKey = fs.readFileSync(`${keyPath}.pub`, 'utf8').trim();
  const signersPath = path.join(workDir, 'allowed_signers');
  fs.writeFileSync(signersPath, `test-signer ${pubKey}\n`);

  const verifyPass = runVerify([skillDir], { signers: signersPath });
  assert.equal(verifyPass.ok, true, JSON.stringify(verifyPass.findings));
  assert.ok(verifyPass.findings.some((f) => f.startsWith('PASS: signature verified')));

  // Tamper with a tracked file's content.
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  fs.appendFileSync(skillMdPath, '\nTampered line.\n');

  const verifyFail = runVerify([skillDir], { signers: signersPath });
  assert.equal(verifyFail.ok, false);
  assert.ok(verifyFail.findings.some((f) => f.includes('SKILL.md content has changed')));

  fs.rmSync(workDir, { recursive: true, force: true });
});

test('verify reports a clear error when no manifest exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillrights-noverify-'));
  const result = runVerify([dir], {});
  assert.equal(result.ok, false);
  assert.ok(result.findings[0].includes('No manifest found'));
  fs.rmSync(dir, { recursive: true, force: true });
});
