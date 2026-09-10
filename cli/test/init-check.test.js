import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInit } from '../lib/init.js';
import { runCheck } from '../lib/check.js';

function mkSkillDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillrights-test-'));
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: cluster-doctor\ndescription: Diagnose failing clusters.\n---\n\n# cluster-doctor\n\nBody text.\n`
  );
  fs.writeFileSync(path.join(dir, 'README.md'), `# cluster-doctor\n\nA test skill.\n`);
  return dir;
}

test('init writes LICENSES text, updates frontmatter, appends README header', async () => {
  const dir = mkSkillDir();
  const result = await runInit([dir], { license: 'notrain', author: 'Test Author', yes: true });

  assert.equal(result.identifier, 'LicenseRef-SkillRights-NoTrain-1.0');

  const licenseText = fs.readFileSync(
    path.join(dir, 'LICENSES', 'LicenseRef-SkillRights-NoTrain-1.0.txt'),
    'utf8'
  );
  assert.match(licenseText, /SkillRights NoTrain Licence/);
  assert.match(licenseText, /Version 1\.0 \(2026-09-10\)/);
  assert.doesNotMatch(licenseText, /1\.0-draft/);

  const skillMd = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  assert.match(skillMd, /license: LicenseRef-SkillRights-NoTrain-1\.0/);
  assert.match(skillMd, /author: Test Author/);
  assert.match(skillMd, /name: cluster-doctor/);
  assert.match(skillMd, /Body text\./);

  const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
  assert.match(readme, /SkillRights-NoTrain-1\.0: .*https:\/\/skillrights\.org\/notrain\/1\.0/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('init is idempotent: a second run changes nothing', async () => {
  const dir = mkSkillDir();
  await runInit([dir], { license: 'open', author: 'A', yes: true });

  const snapshot = {
    license: fs.readFileSync(path.join(dir, 'LICENSES', 'LicenseRef-SkillRights-Open-1.0.txt'), 'utf8'),
    skill: fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'),
    readme: fs.readFileSync(path.join(dir, 'README.md'), 'utf8'),
  };

  await runInit([dir], { license: 'open', author: 'A', yes: true });

  assert.equal(
    fs.readFileSync(path.join(dir, 'LICENSES', 'LicenseRef-SkillRights-Open-1.0.txt'), 'utf8'),
    snapshot.license
  );
  assert.equal(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), snapshot.skill);
  assert.equal(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), snapshot.readme);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('init on a SKILL.md without frontmatter does not edit it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillrights-test-'));
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '# no frontmatter here\n');
  const before = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');

  const result = await runInit([dir], { license: 'open', yes: true });

  const after = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  assert.equal(before, after);
  assert.ok(result.messages.some((m) => m.includes('no YAML frontmatter')));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('check passes after init and fails on a bare directory', async () => {
  const dir = mkSkillDir();
  await runInit([dir], { license: 'reserved', yes: true });

  const passResult = runCheck([dir]);
  assert.equal(passResult.ok, true);

  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillrights-test-'));
  const failResult = runCheck([emptyDir]);
  assert.equal(failResult.ok, false);
  assert.ok(failResult.findings.some((f) => f.includes('No SKILL.md found')));

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(emptyDir, { recursive: true, force: true });
});

test('check fails when the LICENSES text is missing', async () => {
  const dir = mkSkillDir();
  await runInit([dir], { license: 'open', yes: true });
  fs.rmSync(path.join(dir, 'LICENSES', 'LicenseRef-SkillRights-Open-1.0.txt'));

  const result = runCheck([dir]);
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.includes('Missing licence text')));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('check fails when the identifier in LICENSES text does not match SKILL.md', async () => {
  const dir = mkSkillDir();
  await runInit([dir], { license: 'open', yes: true });
  const licensePath = path.join(dir, 'LICENSES', 'LicenseRef-SkillRights-Open-1.0.txt');
  const text = fs.readFileSync(licensePath, 'utf8');
  fs.writeFileSync(licensePath, text.replace('Identifier: LicenseRef-SkillRights-Open-1.0', 'Identifier: LicenseRef-SkillRights-NoTrain-1.0'));

  const result = runCheck([dir]);
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.includes('Identifier mismatch')));

  fs.rmSync(dir, { recursive: true, force: true });
});
