import { createHash, verify as edVerify } from 'node:crypto';
import { canonicalJSON, sha256Hex } from './hash.js';
import { parseOts } from './ots.js';

// Bundle versions this CLI understands. v1 is a receipt with an inclusion
// proof and a signed tree head; v2 adds an optional `anchor` block binding the
// same leaf to a Bitcoin-anchored root (see verifyAnchor). A v2 bundle with no
// anchor is just a v1 bundle that has been through `receipt --upgrade` and
// found nothing to add yet, so both versions verify under the v1 rules.
export const SUPPORTED_BUNDLE_VERSIONS = new Set([1, 2]);

// Named once in lib/artifacts.js, with the rest of this tool's own artifacts,
// so sign and verify exclude exactly the same files.
export { RECEIPT_NAME } from './artifacts.js';

// Receipt/bundle versions this CLI understands. A receipt from a future
// format must not be verified under today's rules and reported green.
export const SUPPORTED_RECEIPT_VERSIONS = new Set([1]);

// What a verified receipt actually establishes, stated HERE rather than read
// out of the bundle. The bundle's own `whatThisProves` string is unsigned
// transport metadata: a holder can rewrite it, and echoing it put words the
// evidence does not support next to a green "verified" (audit, 2026-09-11).
// Kept word-for-word in step with the registry's binding text.
export const WHAT_THIS_PROVES =
  'This receipt establishes that the artifact hash above was registered in the SkillRights transparency log at the recorded time, together with the claimed author, key and signature exactly as submitted. The registry records the claims verbatim; it checks a submitted signature against the submitted hash where the format allows, and records that answer as signatureVerified, which is false whenever the check could not be made. Registration does not prove legal ownership, authorship, or originality.';

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

// Exactly 32 bytes of lowercase hex. Buffer.from(x, 'hex') STOPS at the first
// non-hex character, so a sibling hash with a junk suffix decoded to the same
// bytes and verified in all three implementations (audit, 2026-09-11).
const SIBLING_HEX_RE = /^[0-9a-f]{64}$/;

function verifyInclusion(leaf, index, size, proof, rootHex) {
  if (!Number.isInteger(index) || !Number.isInteger(size)) return false;
  if (index < 0 || index >= size) return false;
  const sides = expectedSides(index, size);
  if (!Array.isArray(proof) || proof.length !== sides.length) return false;
  let current = leaf;
  for (let step = 0; step < proof.length; step += 1) {
    if (!proof[step] || typeof proof[step] !== 'object') return false;
    if (proof[step].side !== sides[step]) return false;
    if (!SIBLING_HEX_RE.test(proof[step].hash)) return false;
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

    // Version is unsigned transport metadata, so it cannot be trusted as a
    // claim, but it CAN be refused: a receipt announcing a format this CLI
    // does not implement must not be checked under today's rules and shown
    // as verified. An absent version is a pre-versioning bundle and is read
    // as version 1 (the collector and registry do the same).
    for (const [what, value, supported] of [
      ['receipt', receipt.version, SUPPORTED_RECEIPT_VERSIONS],
      ['bundle', bundle.version, SUPPORTED_BUNDLE_VERSIONS],
    ]) {
      if (value !== undefined && !supported.has(value)) {
        return { ok: false, reason: `unsupported ${what} version ${value} (this CLI understands ${[...supported].join(', ')})` };
      }
    }

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
    // Report the DERIVED id and the LOCAL explanation, never the bundle's.
    return { ok: true, keyId: derivedKeyId, whatThisProves: WHAT_THIS_PROVES };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// What a verified anchor establishes, stated HERE, in step with the site copy.
// The chain it proves needs nothing from SkillRights: the registry's signing
// key is not in it. The one step it does NOT close is confirming the Bitcoin
// block itself, which is what the external `ots verify` tool (or a block
// explorer) does; the CLI prints exactly how.
export const WHAT_THE_ANCHOR_PROVES =
  'The anchor binds this receipt to a Merkle root that an OpenTimestamps proof commits into the Bitcoin blockchain. Recomputing it needs only this receipt and this tool: the artifact hash sits in a tree whose root the .ots proof commits to Bitcoin. It does not by itself confirm the Bitcoin block is real. Close that last step with the independent OpenTimestamps client (ots verify) or a Bitcoin block explorer, both named below.';

/**
 * Verify a v2 bundle's `anchor` block fully offline, WITHOUT the registry's
 * signing key. The chain checked here is exactly the "survives our demise"
 * claim:
 *   1. the record's recomputed leaf sits in a tree of `size` leaves whose root
 *      is anchor.root, via anchor.inclusionProof (RFC 6962, no signature);
 *   2. the embedded .ots proof commits to precisely that root
 *      (parseOts(ots).digest === anchor.root);
 *   3. that .ots carries at least one Bitcoin attestation, whose height(s) are
 *      returned for display and for the independent-verify instructions.
 * The .ots's own commitment to the Bitcoin chain is NOT re-run here (it needs
 * a Bitcoin node); the caller is told to close it with `ots verify`.
 * Returns { ok, reason?, size, root, leafIndex, bitcoinHeights }.
 */
export function verifyAnchor(bundle) {
  try {
    const receipt = bundle && bundle.receipt;
    const anchor = bundle && bundle.anchor;
    if (!receipt || !receipt.record) return { ok: false, reason: 'bundle missing receipt' };
    if (!anchor) return { ok: false, reason: 'no anchor in this receipt (run `skillrights receipt --upgrade` once it is Bitcoin-anchored)' };

    const { size, root, ots } = anchor;
    if (!Number.isInteger(size) || size < 1) return { ok: false, reason: 'anchor size is not a positive integer' };
    if (typeof root !== 'string' || !/^[0-9a-f]{64}$/.test(root)) return { ok: false, reason: 'anchor root is not a 32-byte hex string' };
    if (typeof ots !== 'string' || ots.length === 0) return { ok: false, reason: 'anchor is missing the .ots proof bytes' };

    const leafIndex = receipt.leafIndex;
    if (!Number.isInteger(leafIndex) || leafIndex < 0) return { ok: false, reason: 'receipt leafIndex is not a valid index' };
    if (leafIndex >= size) return { ok: false, reason: 'anchor size does not cover this leaf' };
    // The leafIndex must still agree with the signed record's own seq, or the
    // anchor could prove a DIFFERENT leaf than the receipt describes.
    if (typeof receipt.record.seq === 'number' && receipt.record.seq !== leafIndex) {
      return { ok: false, reason: 'leafIndex does not match the record sequence number' };
    }

    const leaf = leafHash(Buffer.from(canonicalJSON(receipt.record)));
    if (!verifyInclusion(leaf, leafIndex, size, anchor.inclusionProof, root)) {
      return { ok: false, reason: 'anchor inclusion proof does not reach the anchored root' };
    }

    let parsed;
    try {
      parsed = parseOts(Buffer.from(ots, 'base64'));
    } catch (err) {
      return { ok: false, reason: `embedded .ots did not parse: ${err.message}` };
    }
    if (parsed.digest.toString('hex') !== root) {
      return { ok: false, reason: 'embedded .ots commits to a different root than the inclusion proof reaches' };
    }
    if (parsed.bitcoins.length === 0) {
      return { ok: false, reason: 'embedded .ots carries no Bitcoin attestation yet (still pending)' };
    }
    const bitcoinHeights = [...new Set(parsed.bitcoins.map((b) => b.height))].sort((a, b) => a - b);
    return { ok: true, size, root, leafIndex, bitcoinHeights, whatThisProves: WHAT_THE_ANCHOR_PROVES };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
