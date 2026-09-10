import test from 'node:test';
import assert from 'node:assert/strict';
import { splitFrontmatter, getField, setField } from '../lib/frontmatter.js';

const SAMPLE = `---
name: cluster-doctor
description: Diagnose failing clusters.
license: LicenseRef-SkillRights-Open-1.0
---

# Body

Some content here.
`;

test('splitFrontmatter finds the block', () => {
  const parsed = splitFrontmatter(SAMPLE);
  assert.equal(parsed.hasFrontmatter, true);
  assert.equal(parsed.lines[0], '---');
  assert.equal(parsed.lines[parsed.endIndex], '---');
});

test('splitFrontmatter reports missing frontmatter', () => {
  const parsed = splitFrontmatter('# just a heading\nno frontmatter here\n');
  assert.equal(parsed.hasFrontmatter, false);
});

test('splitFrontmatter reports unterminated frontmatter as missing', () => {
  const parsed = splitFrontmatter('---\nname: x\n# no closing delimiter\n');
  assert.equal(parsed.hasFrontmatter, false);
});

test('getField reads an existing key', () => {
  const parsed = splitFrontmatter(SAMPLE);
  assert.equal(getField(parsed, 'license'), 'LicenseRef-SkillRights-Open-1.0');
  assert.equal(getField(parsed, 'name'), 'cluster-doctor');
});

test('getField returns null for a missing key', () => {
  const parsed = splitFrontmatter(SAMPLE);
  assert.equal(getField(parsed, 'author'), null);
});

test('setField replaces an existing key and preserves everything else', () => {
  const updated = setField(SAMPLE, 'license', 'LicenseRef-SkillRights-NoTrain-1.0');
  assert.match(updated, /license: LicenseRef-SkillRights-NoTrain-1\.0/);
  assert.match(updated, /name: cluster-doctor/);
  assert.match(updated, /description: Diagnose failing clusters\./);
  assert.match(updated, /# Body/);
  assert.match(updated, /Some content here\./);
});

test('setField inserts a new key when absent, preserving order of the rest', () => {
  const withoutLicense = `---\nname: foo\n---\nbody\n`;
  const updated = setField(withoutLicense, 'license', 'LicenseRef-SkillRights-Open-1.0');
  const parsed = splitFrontmatter(updated);
  assert.equal(getField(parsed, 'license'), 'LicenseRef-SkillRights-Open-1.0');
  assert.equal(getField(parsed, 'name'), 'foo');
  assert.match(updated, /body/);
});

test('setField throws when there is no frontmatter block', () => {
  assert.throws(() => setField('no frontmatter', 'license', 'x'), /No YAML frontmatter/);
});

test('setField is idempotent when run twice with the same value', () => {
  const once = setField(SAMPLE, 'license', 'LicenseRef-SkillRights-Open-1.0');
  const twice = setField(once, 'license', 'LicenseRef-SkillRights-Open-1.0');
  assert.equal(once, twice);
});
