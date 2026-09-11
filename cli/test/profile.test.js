// Validates spec/profile/skillrights-profile-1.0.json (the machine-readable
// licence profile, see spec/profile/README.md): parses, matches the
// identifiers this codebase actually knows about, uses only the declared
// permission enum, carries a genuinely non-empty unresolved[] for the two
// licences with open questions, and stays tied to the real licence texts
// (sha256) and free of timestamps that would make it non-byte-stable.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { VARIANT_KEYS, identifierFor } from '../lib/identifiers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const PROFILE_PATH = path.join(REPO_ROOT, 'spec', 'profile', 'skillrights-profile-1.0.json');

const RAW = fs.readFileSync(PROFILE_PATH, 'utf8');

function loadProfile() {
  return JSON.parse(RAW);
}

test('the profile file parses as JSON', () => {
  assert.doesNotThrow(() => loadProfile());
});

test('profileVersion is present and looks like semver', () => {
  const profile = loadProfile();
  assert.match(profile.profileVersion, /^\d+\.\d+\.\d+$/);
});

test('every licence id in the profile matches identifiers.js, and nothing is missing', () => {
  const profile = loadProfile();
  const expected = VARIANT_KEYS.map((v) => identifierFor(v)).sort();
  const actual = Object.keys(profile.licences).sort();
  assert.deepEqual(actual, expected);
});

test('every permission value comes from the declared enum', () => {
  const profile = loadProfile();
  const allowedValues = new Set(profile.permissionValues);
  assert.ok(allowedValues.size > 0, 'permissionValues must be declared');
  for (const [id, licence] of Object.entries(profile.licences)) {
    for (const [permName, perm] of Object.entries(licence.permissions)) {
      assert.ok(
        allowedValues.has(perm.value),
        `${id} permissions.${permName}.value "${perm.value}" is not in permissionValues`
      );
      assert.equal(typeof perm.description, 'string');
      assert.ok(perm.description.length > 0, `${id} permissions.${permName} needs a description`);
      assert.equal(typeof perm.section, 'string');
    }
  }
});

test('every permission line names all four permissions: execute, train, redistribute, commercial', () => {
  const profile = loadProfile();
  for (const [id, licence] of Object.entries(profile.licences)) {
    assert.deepEqual(
      Object.keys(licence.permissions).sort(),
      ['commercial', 'execute', 'redistribute', 'train'],
      `${id} is missing a permission`
    );
  }
});

test('NoTrain and Reserved carry a genuinely non-empty unresolved[]; Open is not padded with one', () => {
  const profile = loadProfile();
  const notrain = profile.licences[identifierFor('notrain')];
  const reserved = profile.licences[identifierFor('reserved')];
  const open = profile.licences[identifierFor('open')];

  assert.ok(Array.isArray(notrain.unresolved) && notrain.unresolved.length > 0, 'NoTrain must have open questions');
  assert.ok(Array.isArray(reserved.unresolved) && reserved.unresolved.length > 0, 'Reserved must have open questions');
  assert.ok(Array.isArray(open.unresolved), 'Open must at least declare the unresolved array');

  for (const entry of [...notrain.unresolved, ...reserved.unresolved]) {
    for (const key of ['id', 'question', 'section', 'source', 'status']) {
      assert.equal(typeof entry[key], 'string', `unresolved entry missing "${key}": ${JSON.stringify(entry)}`);
      assert.ok(entry[key].length > 0, `unresolved entry has empty "${key}"`);
    }
  }
});

test('the four named counsel questions are present and attached to the right licence', () => {
  const profile = loadProfile();
  const notrainIds = profile.licences[identifierFor('notrain')].unresolved.map((u) => u.id);
  const reservedIds = profile.licences[identifierFor('reserved')].unresolved.map((u) => u.id);

  assert.ok(notrainIds.includes('modification-boundary-undefined'), 'NoTrain must flag the undefined modification boundary');
  assert.ok(notrainIds.includes('requires-permission-prefix'), 'NoTrain must flag the requires-permission prefix');
  assert.ok(reservedIds.includes('requires-permission-prefix'), 'Reserved must flag the requires-permission prefix');
  assert.ok(reservedIds.includes('third-party-benefit-breadth'), 'Reserved must flag third-party-benefit breadth');
  assert.ok(reservedIds.includes('where-practicable-deletion'), 'Reserved must flag where-practicable deletion');
});

test('sourceTexts sha256 matches the actual licence text on disk (ties the summary to the real text)', () => {
  const profile = loadProfile();
  for (const [id, entry] of Object.entries(profile.sourceTexts)) {
    const filePath = path.join(REPO_ROOT, entry.path);
    const actualHash = createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    assert.equal(actualHash, entry.sha256, `${id} sourceTexts.sha256 is stale against ${entry.path}`);
  }
});

test('the profile carries no timestamp, so it stays byte-stable across reads', () => {
  // A generated-at timestamp would make the file change every time it is
  // rewritten, defeating the point of a hand-authored, reviewable summary.
  const ISO_TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
  assert.equal(ISO_TIMESTAMP_RE.test(RAW), false, 'profile JSON must not contain an ISO date-time timestamp');
  const profile = loadProfile();
  assert.equal('generatedAt' in profile, false);
  assert.equal('timestamp' in profile, false);
});

test('reading the file twice yields byte-identical content', () => {
  const again = fs.readFileSync(PROFILE_PATH, 'utf8');
  assert.equal(again, RAW);
});
