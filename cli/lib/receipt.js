import { createHash, verify as edVerify } from 'node:crypto';
import { canonicalJSON } from './hash.js';

export const RECEIPT_NAME = '.skillrights.receipt.json';

// RFC 6962 verification primitives, duplicated from the registry service
// deliberately: the whole point of a portable receipt is that verification
// needs nothing but this CLI and the receipt file. The two implementations
// MUST stay in sync (registry/lib/merkle.js is the sibling).
function sha(...bufs) {
  const h = createHash('sha256');
  for (const b of bufs) h.update(b);
  return h.digest();
}

function leafHash(data) {
  return sha(Buffer.from([0]), data);
}

function nodeHash(left, right) {
  return sha(Buffer.from([1]), left, right);
}

function verifyInclusion(leaf, index, size, proof, rootHex) {
  if (index < 0 || index >= size) return false;
  let current = leaf;
  for (const step of proof) {
    const sibling = Buffer.from(step.hash, 'hex');
    if (step.side === 'right') current = nodeHash(current, sibling);
    else if (step.side === 'left') current = nodeHash(sibling, current);
    else return false;
  }
  return current.equals(Buffer.from(rootHex, 'hex'));
}

/**
 * Verifies a saved receipt bundle fully offline:
 * 1. the record's recomputed leaf hash sits in the tree via the inclusion proof;
 * 2. the tree head signature verifies against the bundled log public key.
 * Returns { ok, keyId, reason? }. The bundled key proves internal
 * consistency; authenticity additionally requires comparing keyId against
 * the registry's published key (GET /api/v1/log/key), which the caller may
 * do when online.
 */
export function verifyReceiptBundle(bundle) {
  try {
    const receipt = bundle.receipt;
    const publicKeyPem = bundle.logKey && bundle.logKey.publicKeyPem;
    if (!receipt || !publicKeyPem) return { ok: false, reason: 'bundle missing receipt or logKey' };

    const leaf = leafHash(Buffer.from(canonicalJSON(receipt.record)));
    const { size, root, ts, signature } = receipt.treeHead;
    if (!verifyInclusion(leaf, receipt.leafIndex, size, receipt.inclusionProof, root)) {
      return { ok: false, reason: 'inclusion proof does not reach the tree head root' };
    }
    const headBytes = Buffer.from(canonicalJSON({ size, root, ts }));
    if (!edVerify(null, headBytes, publicKeyPem, Buffer.from(signature, 'base64'))) {
      return { ok: false, reason: 'tree head signature invalid for the bundled log key' };
    }
    return { ok: true, keyId: bundle.logKey.keyId };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
