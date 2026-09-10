// Registration validation, SRID minting, receipts, and receipt
// verification. What a registration proves, and does not, is fixed text in
// spec/REGISTRY-DESIGN.md: existence-by-time, signer claim, chronology.
// Never ownership. Nothing in this module adjudicates anything; caps and
// formats are the only judgement applied.

import { verify as edVerify } from 'node:crypto';
import { ulid } from './ulid.js';
import { canonicalJSON, sha256Hex } from './canonical.js';
import { leafHash, verifyInclusion } from './merkle.js';

const SHA256_RE = /^[a-f0-9]{64}$/;
const MODES = new Set(['private', 'public']);

const CAPS = {
  license: 120,
  author: 200,
  publicKey: 800,
  signature: 8000,
  metaName: 120,
  metaDescription: 500,
  metaRepository: 300,
};

function capped(value, cap) {
  return typeof value === 'string' && value.length <= cap;
}

export function validateRegistration(body) {
  const errors = [];
  if (!body || typeof body !== 'object') return { ok: false, errors: ['body must be a JSON object'] };

  if (typeof body.hash !== 'string' || !SHA256_RE.test(body.hash)) {
    errors.push('hash must be a lowercase hex sha256');
  }
  if (!MODES.has(body.mode)) errors.push("mode must be 'private' or 'public'");
  if (body.license !== undefined && !capped(body.license, CAPS.license)) errors.push('license too long or not a string');
  if (body.author !== undefined && !capped(body.author, CAPS.author)) errors.push('author too long or not a string');
  if (body.publicKey !== undefined && !capped(body.publicKey, CAPS.publicKey)) errors.push('publicKey too long or not a string');
  if (body.signature !== undefined && !capped(body.signature, CAPS.signature)) errors.push('signature too long or not a string');
  if (body.supersedes !== undefined && (typeof body.supersedes !== 'string' || !SHA256_RE.test(body.supersedes))) {
    errors.push('supersedes must be a lowercase hex sha256');
  }
  if (body.meta !== undefined) {
    if (body.mode !== 'public') errors.push('meta is only allowed on public registrations');
    else if (!body.meta || typeof body.meta !== 'object') errors.push('meta must be an object');
    else {
      if (body.meta.name !== undefined && !capped(body.meta.name, CAPS.metaName)) errors.push('meta.name too long');
      if (body.meta.description !== undefined && !capped(body.meta.description, CAPS.metaDescription)) errors.push('meta.description too long');
      if (body.meta.repository !== undefined && !capped(body.meta.repository, CAPS.metaRepository)) errors.push('meta.repository too long');
    }
  }
  return { ok: errors.length === 0, errors };
}

export function register(store, body, now = () => new Date()) {
  const v = validateRegistration(body);
  if (!v.ok) {
    const err = new Error('invalid registration');
    err.code = 'invalid_registration';
    err.errors = v.errors;
    throw err;
  }

  const record = {
    srid: `sr:skill:${ulid(now().getTime())}`,
    seq: store.size(),
    ts: now().toISOString(),
    mode: body.mode,
    artifact: { algorithm: 'sha256', sha256: body.hash },
    ...(body.license !== undefined ? { license: body.license } : {}),
    ...(body.author !== undefined ? { author: body.author } : {}),
    ...(body.publicKey !== undefined ? { publicKey: body.publicKey } : {}),
    ...(body.signature !== undefined ? { signature: body.signature } : {}),
    ...(body.supersedes !== undefined ? { supersedes: body.supersedes } : {}),
    ...(body.meta !== undefined ? { meta: body.meta } : {}),
  };

  const { leafIndex, treeHead, proof } = store.append(record);

  const receipt = {
    version: 1,
    srid: record.srid,
    record,
    leafIndex,
    inclusionProof: proof,
    treeHead,
    whatThisProves:
      'This receipt establishes that the artifact hash above was registered in the SkillRights transparency log at the recorded time, together with the claimed author, key and signature exactly as submitted. The registry records these claims verbatim and does not verify submitted signatures. It does not prove legal ownership, authorship, or originality.',
  };
  return { record, receipt };
}

/** Offline receipt verification: leaf recompute -> inclusion proof -> tree head signature.
 *  Kept behaviourally identical to the CLI's and collector's verifyReceiptBundle:
 *  the three are deliberate duplicates, and the audit of 2026-09-10 found this
 *  copy had drifted (no seq binding, no display-srid binding), producing a real
 *  three-way disagreement on the same bundle. The cross-implementation suite
 *  now asserts this function's REJECTIONS too, not just its accepts. */
export function verifyReceipt(receipt, publicKeyPem) {
  try {
    // The record's own seq is inside the hashed bytes; leafIndex is not.
    if (typeof receipt.record.seq === 'number' && receipt.record.seq !== receipt.leafIndex) return false;
    // The top-level srid is display copy outside the hash; bind it too.
    if (receipt.srid && receipt.record && receipt.srid !== receipt.record.srid) return false;
    const leaf = leafHash(Buffer.from(canonicalJSON(receipt.record)));
    const { size, root, ts, signature } = receipt.treeHead;
    if (!verifyInclusion(leaf, receipt.leafIndex, size, receipt.inclusionProof, root)) return false;
    const headBytes = Buffer.from(canonicalJSON({ size, root, ts }));
    if (receipt.treeHead.keyId && receipt.treeHead.keyId !== sha256Hex(publicKeyPem).slice(0, 16)) return false;
    return edVerify(null, headBytes, publicKeyPem, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}
