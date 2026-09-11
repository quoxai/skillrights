// SR (2026-09-11), outstanding audit finding: a file ADDED to a signed skill
// directory after signing produced integrity PASS with only an informational
// note. An attacker who drops a malicious script beside a signed SKILL.md kept
// verification green, so the manifest could never honestly claim the directory
// matched it. Added files are now an integrity FAILURE, with the paths named.
//
// The exclusion set (the artifacts this CLI writes into the directory itself)
// is shared between sign and verify, so a signed, registered skill still
// round-trips green.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInit } from '../lib/init.js';
import { runSign, MANIFEST_NAME, SIG_NAME } from '../lib/sign.js';
import { runVerify } from '../lib/verify.js';
import { RECEIPT_NAME } from '../lib/receipt.js';
import { TOOL_ARTIFACTS } from '../lib/artifacts.js';

async function mkSignedSkill() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillrights-added-'));
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: cluster-doctor\ndescription: Diagnose failing clusters.\n---\n\nBody.\n`);
  await runInit([dir], { license: 'notrain', yes: true });
  runSign([dir], { key: path.join(dir, 'no-such-key') }); // manifest only
  return dir;
}

test('an untouched signed directory verifies green', async () => {
  const dir = await mkSignedSkill();

  const result = runVerify([dir], {});
  assert.equal(result.status.integrity, 'pass', result.findings.join('; '));
  assert.equal(result.ok, true, result.findings.join('; '));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('a file ADDED after signing FAILS integrity and is named in the findings', async () => {
  const dir = await mkSignedSkill();
  fs.writeFileSync(path.join(dir, 'added.sh'), '#!/bin/sh\necho pwned\n');

  const result = runVerify([dir], {});
  assert.equal(result.status.integrity, 'fail', result.findings.join('; '));
  assert.equal(result.ok, false, result.findings.join('; '));
  assert.ok(
    result.findings.some((f) => f.startsWith('FAIL:') && f.includes('added.sh')),
    result.findings.join('; ')
  );
  // The old behaviour: a NOTE that let the run stay green.
  assert.ok(
    !result.findings.some((f) => f.startsWith('NOTE:') && f.includes('added.sh')),
    'an added file must not be reported as a note'
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('a file added in a SUBDIRECTORY fails, with its relative path named', async () => {
  const dir = await mkSignedSkill();
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scripts', 'evil.sh'), 'echo hi\n');

  const result = runVerify([dir], {});
  assert.equal(result.ok, false);
  assert.equal(result.status.integrity, 'fail');
  assert.ok(
    result.findings.some((f) => f.startsWith('FAIL:') && f.includes('scripts/evil.sh')),
    result.findings.join('; ')
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('a REMOVED file still fails integrity', async () => {
  const dir = await mkSignedSkill();
  const licences = fs.readdirSync(path.join(dir, 'LICENSES'));
  assert.ok(licences.length, 'init should have written a licence file to delete');
  fs.rmSync(path.join(dir, 'LICENSES', licences[0]));

  const result = runVerify([dir], {});
  assert.equal(result.status.integrity, 'fail', result.findings.join('; '));
  assert.equal(result.ok, false);
  assert.ok(
    result.findings.some((f) => f.startsWith('FAIL:') && f.includes('is missing')),
    result.findings.join('; ')
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('the CLI\'s own artifacts and .git do not trip the added-files check', async () => {
  const dir = await mkSignedSkill();

  // Every artifact this tool writes into the directory, present at once.
  fs.writeFileSync(path.join(dir, SIG_NAME), 'not a real signature\n');
  fs.writeFileSync(path.join(dir, RECEIPT_NAME), '{}\n');
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');

  const result = runVerify([dir], {});
  assert.equal(result.status.integrity, 'pass', result.findings.join('; '));
  assert.ok(
    !result.findings.some((f) => f.startsWith('FAIL:')),
    result.findings.join('; ')
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('sign and verify share one exclusion set, so a receipt written after signing round-trips', async () => {
  assert.ok(TOOL_ARTIFACTS.has(MANIFEST_NAME));
  assert.ok(TOOL_ARTIFACTS.has(SIG_NAME));
  assert.ok(TOOL_ARTIFACTS.has(RECEIPT_NAME));

  const dir = await mkSignedSkill();
  // A receipt present BEFORE signing must not be hashed into the manifest
  // either, or re-registering would change the artifact hash every time.
  fs.writeFileSync(path.join(dir, RECEIPT_NAME), '{"receipt":"first"}\n');
  const first = runSign([dir], { key: path.join(dir, 'no-such-key') });
  fs.writeFileSync(path.join(dir, RECEIPT_NAME), '{"receipt":"second"}\n');
  const second = runSign([dir], { key: path.join(dir, 'no-such-key') });

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_NAME), 'utf8'));
  assert.equal(Object.prototype.hasOwnProperty.call(manifest.files, RECEIPT_NAME), false);
  assert.equal(second.fileCount, first.fileCount, 'the receipt must not change the hashed file set');

  const result = runVerify([dir], {});
  assert.equal(result.status.integrity, 'pass', result.findings.join('; '));
  assert.equal(result.ok, true, result.findings.join('; '));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('any subcommand with --help prints usage and never executes (the register --help incident)', async () => {
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync('node', [new URL('../bin/skillrights.js', import.meta.url).pathname, 'register', '--help'], { encoding: 'utf8', cwd: '/tmp' });
  assert.match(out, /Usage|usage|skillrights/i);
  assert.ok(!out.includes('Registered:'), 'register must not run under --help');
});
