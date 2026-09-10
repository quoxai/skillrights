import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { leafHash, rootOf, inclusionProof, verifyInclusion } from '../lib/merkle.js';

function sha(...bufs) {
  const h = createHash('sha256');
  for (const b of bufs) h.update(b);
  return h.digest();
}

test('leafHash is RFC 6962 (0x00 prefix)', () => {
  const data = Buffer.from('hello');
  assert.equal(leafHash(data).toString('hex'), sha(Buffer.from([0]), data).toString('hex'));
});

test('root of a single leaf is the leaf hash', () => {
  const l = leafHash(Buffer.from('only'));
  assert.equal(rootOf([l]).toString('hex'), l.toString('hex'));
});

test('root of two leaves is node(0x01 || l || r)', () => {
  const a = leafHash(Buffer.from('a'));
  const b = leafHash(Buffer.from('b'));
  assert.equal(rootOf([a, b]).toString('hex'), sha(Buffer.from([1]), a, b).toString('hex'));
});

test('inclusion proofs verify for every index at sizes 1 through 9', () => {
  for (let size = 1; size <= 9; size++) {
    const leaves = Array.from({ length: size }, (_, i) => leafHash(Buffer.from(`leaf-${i}`)));
    const root = rootOf(leaves);
    for (let i = 0; i < size; i++) {
      const proof = inclusionProof(i, leaves);
      assert.equal(
        verifyInclusion(leaves[i], i, size, proof, root), true,
        `size ${size} index ${i} should verify`
      );
    }
  }
});

test('a tampered leaf fails verification', () => {
  const leaves = Array.from({ length: 5 }, (_, i) => leafHash(Buffer.from(`leaf-${i}`)));
  const root = rootOf(leaves);
  const proof = inclusionProof(2, leaves);
  const evil = leafHash(Buffer.from('evil'));
  assert.equal(verifyInclusion(evil, 2, 5, proof, root), false);
});

test('a proof for one index does not verify another', () => {
  const leaves = Array.from({ length: 6 }, (_, i) => leafHash(Buffer.from(`leaf-${i}`)));
  const root = rootOf(leaves);
  const proof = inclusionProof(1, leaves);
  assert.equal(verifyInclusion(leaves[2], 2, 6, proof, root), false);
});
