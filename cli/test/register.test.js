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
    // SR-SIGV: the submitted signature is now the raw hex signature over the
    // registered hash, under the OpenSSH public line of the same key, so the
    // registry VERIFIES it instead of merely recording it.
    assert.match(bundle.receipt.record.signature, /^[0-9a-f]{128}$/);
    assert.match(bundle.receipt.record.publicKey, /^ssh-ed25519 /);
    assert.equal(bundle.receipt.record.signatureVerified, true);
    assert.equal(result.signatureVerified, true);
    assert.equal(result.signatureKind, 'artifact-hash');
    // The manifest-file signature is untouched and still on disk for
    // `skillrights verify`.
    assert.ok(fs.readFileSync(path.join(skillDir, '.skillrights.manifest.json.sig'), 'utf8').includes('SSH SIGNATURE'));

    // runReceipt reads and verifies the same bundle.
    const check = runReceipt([skillDir]);
    assert.equal(check.ok, true, check.reason || '');
    assert.equal(check.srid, result.srid);
    assert.equal(check.signatureVerified, true, 'the saved receipt records a registry-verified signature');

    // Tampering the saved record breaks verification.
    bundle.receipt.record.license = 'LicenseRef-SkillRights-Open-1.0';
    fs.writeFileSync(path.join(skillDir, RECEIPT_NAME), JSON.stringify(bundle));
    const tampered = runReceipt([skillDir]);
    assert.equal(tampered.ok, false);
  } finally {
    server.close();
  }
});

/**
 * SR-SIGV: when the key cannot produce a hash signature (here an RSA key;
 * a passphrase-protected key takes the same path, covered in
 * hashSignature.test.js because ssh-keygen would prompt), registration must
 * still work, fall back to the manifest-file signature, and never report it
 * as verified. The CLI never prompts for a passphrase and never uses
 * ssh-agent.
 */
test('register falls back honestly when the key cannot sign the hash', { skip: !sshKeygenAvailable() }, async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillrights-register-fallback-'));
  const skillDir = path.join(workDir, 'skill');
  fs.mkdirSync(skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\nname: locked\ndescription: Key cannot sign the hash.\nauthor: test-signer\n---\n\nBody.\n`);
  await runInit([skillDir], { license: 'notrain', yes: true });

  // Throwaway key generated in a temp dir. ~/.ssh is never read by any test here.
  const keyPath = path.join(workDir, 'rsakey');
  const gen = spawnSync('ssh-keygen', ['-t', 'rsa', '-b', '2048', '-f', keyPath, '-N', ''], { encoding: 'utf8' });
  assert.equal(gen.status, 0, gen.stderr);

  const server = createServer({ dataDir: path.join(workDir, 'registry-data') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const registry = `http://127.0.0.1:${server.address().port}`;

  try {
    const result = await runRegister([skillDir], { key: keyPath, registry }, fetch, () => {});
    assert.equal(result.signatureKind, 'manifest-file');
    assert.match(result.hashSignatureSkippedReason, /ed25519/i);
    assert.equal(result.signatureVerified, false, 'never reported as verified when the registry could not check it');
    const bundle = JSON.parse(fs.readFileSync(result.receiptPath, 'utf8'));
    assert.ok(bundle.receipt.record.signature.includes('SSH SIGNATURE'));
  } finally {
    server.close();
  }
});

test('register without a receipt file reports not found', () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillrights-noreceipt-'));
  const result = runReceipt([emptyDir]);
  assert.equal(result.found, false);
});
