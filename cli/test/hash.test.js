import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex, canonicalJSON } from '../lib/hash.js';

test('sha256Hex matches a known vector', () => {
  // echo -n "abc" | sha256sum
  assert.equal(
    sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
});

test('canonicalJSON sorts object keys regardless of insertion order', () => {
  const a = canonicalJSON({ b: 1, a: 2, c: { z: 1, y: 2 } });
  const b = canonicalJSON({ a: 2, c: { y: 2, z: 1 }, b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":2,"b":1,"c":{"y":2,"z":1}}');
});

test('canonicalJSON handles arrays without reordering elements', () => {
  assert.equal(canonicalJSON({ list: [3, 1, 2] }), '{"list":[3,1,2]}');
});
