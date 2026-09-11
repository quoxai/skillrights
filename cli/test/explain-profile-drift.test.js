// Single-source drift guard: `skillrights explain`'s wording (lib/explain.js)
// and spec/profile/skillrights-profile-1.0.json summarise the same three
// licence texts independently, in different formats, for different
// audiences (explain: a human at a terminal; profile: tooling). This test
// does not rewrite explain, it only asserts the two never disagree about
// which of the four permissions is granted for each licence.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { explain } from '../lib/explain.js';
import { VARIANT_KEYS, identifierFor } from '../lib/identifiers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_PATH = path.join(__dirname, '..', '..', 'spec', 'profile', 'skillrights-profile-1.0.json');
const profile = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));

// explain() prints "  Execute:      <phrase>" style lines; map the label
// text uses to the permission key the profile uses.
const LABELS = {
  execute: 'Execute',
  train: 'Train',
  redistribute: 'Redistribute',
  commercial: 'Commercial',
};

function lineFor(text, label) {
  const re = new RegExp(`^\\s*${label}:\\s+(.+)$`, 'm');
  const match = re.exec(text);
  assert.ok(match, `explain() output has no "${label}:" line:\n${text}`);
  return match[1].trim();
}

// A permission value from the profile enum implies a minimal phrasing
// shape explain() must not contradict. This is intentionally loose (it
// checks the shape of the claim, not the exact prose) so editorial changes
// to explain()'s wording do not fail the test for no reason; it only fails
// when explain() and the profile would tell an operator different things.
function assertPhraseMatchesValue(value, phrase, where) {
  const lower = phrase.toLowerCase();
  if (value === 'allowed') {
    assert.ok(lower.startsWith('yes'), `${where}: profile says "allowed" but explain() says "${phrase}"`);
  } else if (value === 'reserved') {
    assert.ok(lower.startsWith('no'), `${where}: profile says "reserved" but explain() says "${phrase}"`);
  } else if (value === 'authorised-recipients') {
    assert.ok(lower.includes('authorised'), `${where}: profile says "authorised-recipients" but explain() says "${phrase}"`);
  } else if (value === 'by-agreement') {
    assert.ok(lower.includes('agreement'), `${where}: profile says "by-agreement" but explain() says "${phrase}"`);
  } else {
    assert.fail(`${where}: unrecognised profile permission value "${value}"`);
  }
}

for (const variant of VARIANT_KEYS) {
  test(`explain(${variant}) agrees with the profile on all four permissions`, () => {
    const identifier = identifierFor(variant);
    const licence = profile.licences[identifier];
    assert.ok(licence, `profile is missing ${identifier}`);

    const text = explain(variant);

    for (const [permName, label] of Object.entries(LABELS)) {
      const phrase = lineFor(text, label);
      const value = licence.permissions[permName].value;
      assertPhraseMatchesValue(value, phrase, `${identifier} ${permName}`);
    }
  });
}

test('explain() with no argument prints the same three licences the profile knows about', () => {
  const table = explain();
  for (const variant of VARIANT_KEYS) {
    const identifier = identifierFor(variant);
    assert.ok(profile.licences[identifier], `profile is missing ${identifier}`);
    // The bare identifier (without the LicenseRef- prefix) appears in the
    // table's licence column, e.g. "SkillRights-NoTrain-1.0".
    const bareId = identifier.replace('LicenseRef-', '');
    assert.ok(table.includes(bareId), `explain() table is missing ${bareId}`);
  }
});
