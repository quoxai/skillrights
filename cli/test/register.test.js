import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runInit } from '../lib/init.js';
import { runRegister, runReceipt } from '../lib/register.js';
import { verifyReceiptBundle, RECEIPT_NAME } from '../lib/receipt.js';
// Test-only import across packages: the registry service lives in the same
// repository. The CLI's runtime stays dependency-free.
import { createServer } from '../../registry/server.js';

function sshKeygenAvailable() {
  const r = spawnSync('ssh-keygen', ['-V'], { encoding: 'utf8' });
  return !r.error;
}

test('register signs, registers, verifies and saves a receipt; receipt verifies offline', { skip: !sshKeygenAvailable() }, async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillrights-register-'));
  const skillDir = path.join(workDir, 'skill');
  fs.mkdirSync(skillDir);
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: cluster-doctor\ndescription: Diagnose clusters like a veteran.\nauthor: test-signer\n---\n\nBody.\n`
  );
  await runInit([skillDir], { license: 'notrain', yes: true });

  const keyPath = path.join(workDir, 'testkey');
  const gen = spawnSync('ssh-keygen', ['-t', 'ed25519', '-f', keyPath, '-N', ''], { encoding: 'utf8' });
  assert.equal(gen.status, 0, gen.stderr);

  const server = createServer({ dataDir: path.join(workDir, 'registry-data') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const registry = `http://127.0.0.1:${server.address().port}`;

  try {
    const result = await runRegister([skillDir], { key: keyPath, registry, public: true, repository: 'https://github.com/example/skill' });
    assert.match(result.srid, /^sr:skill:/);
    assert.equal(result.signed, true);
    assert.equal(result.mode, 'public');
    assert.ok(fs.existsSync(result.receiptPath));

    // The saved bundle verifies offline (server can be gone entirely).
    const bundle = JSON.parse(fs.readFileSync(result.receiptPath, 'utf8'));
    assert.equal(verifyReceiptBundle(bundle).ok, true);
    assert.equal(bundle.receipt.record.meta.name, 'cluster-doctor');
    assert.equal(bundle.receipt.record.license, 'LicenseRef-SkillRights-NoTrain-1.0');
    assert.ok(bundle.receipt.record.signature.includes('SSH SIGNATURE'));

    // runReceipt reads and verifies the same bundle.
    const check = runReceipt([skillDir]);
    assert.equal(check.ok, true, check.reason || '');
    assert.equal(check.srid, result.srid);

    // Tampering the saved record breaks verification.
    bundle.receipt.record.license = 'LicenseRef-SkillRights-Open-1.0';
    fs.writeFileSync(path.join(skillDir, RECEIPT_NAME), JSON.stringify(bundle));
    const tampered = runReceipt([skillDir]);
    assert.equal(tampered.ok, false);
  } finally {
    server.close();
  }
});

test('register without a receipt file reports not found', () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillrights-noreceipt-'));
  const result = runReceipt([emptyDir]);
  assert.equal(result.found, false);
});
