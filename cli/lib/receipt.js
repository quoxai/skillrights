import { createHash, verify as edVerify } from 'node:crypto';
import { canonicalJSON, sha256Hex } from './hash.js';

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

// Largest power of two strictly less than n (RFC 6962 split point).
function splitPoint(n) {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

// The side each sibling must sit on, derived from (index, size) alone. See
// registry/lib/merkle.js for why the sides carried in the proof are not
// trusted: without this, the claimed leaf index is decorative and a receipt
// could misstate its position in the log while still verifying.
function expectedSides(index, size) {
  const sides = [];
  let i = index;
  let n = size;
  while (n > 1) {
    const k = splitPoint(n);
    if (i < k) { sides.push('right'); n = k; }
    else { sides.push('left'); i -= k; n -= k; }
  }
  return sides.reverse();
}

function verifyInclusion(leaf, index, size, proof, rootHex) {
  if (!Number.isInteger(index) || !Number.isInteger(size)) return false;
  if (index < 0 || index >= size) return false;
  const sides = expectedSides(index, size);
  if (!Array.isArray(proof) || proof.length !== sides.length) return false;
  let current = leaf;
  for (let step = 0; step < proof.length; step += 1) {
    if (proof[step].side !== sides[step]) return false;
    const sibling = Buffer.from(proof[step].hash, 'hex');
    if (sides[step] === 'right') current = nodeHash(current, sibling);
    else current = nodeHash(sibling, current);
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

    // The key id MUST be derived from the bundled public key, never taken
    // from the bundle's own claim. Echoing the claimed id let a forged
    // bundle (signed with an attacker key, any content, any date) display
    // the REAL registry's key id, so the documented authenticity check
    // ("compare the printed key id against GET /api/v1/log/key") passed on
    // a fabrication. Found by audit 2026-09-10. Derivation matches
    // registry/lib/store.js.
    const derivedKeyId = sha256Hex(publicKeyPem).slice(0, 16);
    if (bundle.logKey.keyId && bundle.logKey.keyId !== derivedKeyId) {
      return { ok: false, reason: `logKey.keyId claims ${bundle.logKey.keyId} but the bundled public key is ${derivedKeyId}` };
    }
    if (receipt.treeHead && receipt.treeHead.keyId && receipt.treeHead.keyId !== derivedKeyId) {
      return { ok: false, reason: 'tree head keyId does not match the bundled public key' };
    }
    // The top-level srid is not covered by any hash; the record's is. If the
    // display copy has been edited, the receipt is lying to the reader even
    // though the cryptography checks out.
    if (receipt.srid && receipt.record && receipt.srid !== receipt.record.srid) {
      return { ok: false, reason: 'receipt srid does not match the signed record srid' };
    }

    const leaf = leafHash(Buffer.from(canonicalJSON(receipt.record)));
    const { size, root, ts, signature } = receipt.treeHead;
    // The record's own seq is inside the hashed bytes; leafIndex is not. If
    // they disagree, the receipt is misstating its position in the log.
    if (typeof receipt.record.seq === 'number' && receipt.record.seq !== receipt.leafIndex) {
      return { ok: false, reason: 'leafIndex does not match the record sequence number' };
    }
    if (!verifyInclusion(leaf, receipt.leafIndex, size, receipt.inclusionProof, root)) {
      return { ok: false, reason: 'inclusion proof does not reach the tree head root' };
    }
    const headBytes = Buffer.from(canonicalJSON({ size, root, ts }));
    if (!edVerify(null, headBytes, publicKeyPem, Buffer.from(signature, 'base64'))) {
      return { ok: false, reason: 'tree head signature invalid for the bundled log key' };
    }
    // Report the DERIVED id, never the bundle's claim.
    return { ok: true, keyId: derivedKeyId };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
