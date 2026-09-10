import test from 'node:test';
import assert from 'node:assert/strict';
import {
  identifierFor,
  variantFromIdentifier,
  isValidIdentifier,
  isKnownVariant,
  licenseFileName,
} from '../lib/identifiers.js';

test('identifierFor produces the three known identifiers', () => {
  assert.equal(identifierFor('open'), 'LicenseRef-SkillRights-Open-1.0');
  assert.equal(identifierFor('notrain'), 'LicenseRef-SkillRights-NoTrain-1.0');
  assert.equal(identifierFor('reserved'), 'LicenseRef-SkillRights-Reserved-1.0');
});

test('identifierFor rejects unknown variants', () => {
  assert.throws(() => identifierFor('bogus'), /Unknown licence variant/);
});

test('variantFromIdentifier round-trips', () => {
  for (const v of ['open', 'notrain', 'reserved']) {
    assert.equal(variantFromIdentifier(identifierFor(v)), v);
  }
});

test('variantFromIdentifier rejects garbage', () => {
  assert.equal(variantFromIdentifier('not-a-real-identifier'), null);
  assert.equal(variantFromIdentifier(''), null);
  assert.equal(variantFromIdentifier(undefined), null);
});

test('isValidIdentifier matches variantFromIdentifier', () => {
  assert.equal(isValidIdentifier('LicenseRef-SkillRights-Open-1.0'), true);
  assert.equal(isValidIdentifier('LicenseRef-SkillRights-Open-2.0'), false);
});

test('isKnownVariant', () => {
  assert.equal(isKnownVariant('open'), true);
  assert.equal(isKnownVariant('closed'), false);
});

test('licenseFileName', () => {
  assert.equal(licenseFileName('notrain'), 'LicenseRef-SkillRights-NoTrain-1.0.txt');
});
