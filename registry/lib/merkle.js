// RFC 6962 Merkle tree: leaf = SHA-256(0x00 || data), node = SHA-256(0x01 || l || r).
// Small, recursive, no dependencies. Log sizes here are thousands, not billions;
// clarity beats cleverness.

import { createHash } from 'node:crypto';

function sha(...bufs) {
  const h = createHash('sha256');
  for (const b of bufs) h.update(b);
  return h.digest();
}

export function leafHash(data) {
  return sha(Buffer.from([0]), data);
}

export function nodeHash(left, right) {
  return sha(Buffer.from([1]), left, right);
}

// Largest power of two strictly less than n (RFC 6962 split point).
function splitPoint(n) {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

/** Root over an array of leaf-hash Buffers. */
export function rootOf(leaves) {
  const n = leaves.length;
  if (n === 0) return sha(Buffer.alloc(0)); // empty-tree hash, RFC 6962
  if (n === 1) return leaves[0];
  const k = splitPoint(n);
  return nodeHash(rootOf(leaves.slice(0, k)), rootOf(leaves.slice(k)));
}

/**
 * Inclusion proof for leaves[index]: array of { hash, side } where side is
 * which side the SIBLING sits on ('left' | 'right') when recombining upward.
 */
export function inclusionProof(index, leaves) {
  const n = leaves.length;
  if (n === 1) return [];
  const k = splitPoint(n);
  if (index < k) {
    return [...inclusionProof(index, leaves.slice(0, k)), { hash: rootOf(leaves.slice(k)), side: 'right' }];
  }
  return [...inclusionProof(index - k, leaves.slice(k)), { hash: rootOf(leaves.slice(0, k)), side: 'left' }];
}

/** Verify an inclusion proof. All hashes are Buffers except proof entries may carry hex strings. */
export function verifyInclusion(leaf, index, size, proof, root) {
  if (index < 0 || index >= size) return false;
  let current = Buffer.isBuffer(leaf) ? leaf : Buffer.from(leaf, 'hex');
  for (const step of proof) {
    const sibling = Buffer.isBuffer(step.hash) ? step.hash : Buffer.from(step.hash, 'hex');
    if (step.side === 'right') current = nodeHash(current, sibling);
    else if (step.side === 'left') current = nodeHash(sibling, current);
    else return false;
  }
  const expected = Buffer.isBuffer(root) ? root : Buffer.from(root, 'hex');
  return current.equals(expected);
}
