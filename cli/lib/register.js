import fs from 'node:fs';
import path from 'node:path';
import { runSign, MANIFEST_NAME, SIG_NAME } from './sign.js';
import { readSkillFrontmatter } from './skillfile.js';
import { getField } from './frontmatter.js';
import { verifyReceiptBundle, RECEIPT_NAME } from './receipt.js';
import { canonicalJSON } from './hash.js';

/**
 * A receipt can be internally perfect and still describe a DIFFERENT
 * registration: a valid historical receipt for someone else's hash, mode and
 * signer used to be accepted and saved beside this skill (audit,
 * 2026-09-11). So after verification, every field this invocation submitted
 * must appear in the signed record, unchanged, and the record must carry
 * nothing extra we did not send.
 */
const BOUND_FIELDS = ['license', 'author', 'publicKey', 'signature', 'supersedes', 'meta'];

function assertReceiptMatchesRequest(receipt, body) {
  const record = receipt && receipt.record;
  if (!record || typeof record !== 'object') throw new Error('the registry returned a receipt with no record');

  const mismatches = [];
  const artifactHash = record.artifact && record.artifact.sha256;
  if (record.artifact && record.artifact.algorithm !== 'sha256') {
    mismatches.push(`artifact algorithm is ${record.artifact.algorithm}, expected sha256`);
  }
  if (artifactHash !== body.hash) mismatches.push(`artifact hash is ${artifactHash}, submitted ${body.hash}`);
  if (record.mode !== body.mode) mismatches.push(`mode is ${record.mode}, submitted ${body.mode}`);
  for (const field of BOUND_FIELDS) {
    const sent = body[field];
    const got = record[field];
    if (sent === undefined && got === undefined) continue;
    if (sent === undefined) { mismatches.push(`record carries ${field} which was not submitted`); continue; }
    if (got === undefined) { mismatches.push(`record is missing the submitted ${field}`); continue; }
    if (canonicalJSON(sent) !== canonicalJSON(got)) mismatches.push(`${field} does not match the submitted value`);
  }
  if (mismatches.length > 0) {
    throw new Error(`the registry receipt does not match what was submitted: ${mismatches.join('; ')}`);
  }
}

export const DEFAULT_REGISTRY = 'https://registry.skillrights.org';

/**
 * `skillrights register [dir] [--public] [--registry <url>] [--supersedes <sha256>] [--key <path>]`
 *
 * The ONLY networked verb in this CLI, and it says so. Signs (or re-signs)
 * the skill locally, then sends ONLY the evidence to the registry: the
 * manifest hash, the licence identifier, the claimed author, the signature
 * and public key. The skill's content never leaves the machine. Public
 * mode additionally sends name/description from the frontmatter (and
 * --repository if given) for the Directory.
 *
 * The returned receipt is verified locally (inclusion proof + tree head
 * signature) BEFORE it is saved; a receipt this CLI writes has always been
 * checked, not just downloaded.
 */
export async function runRegister(positional, flags, fetchFn = fetch) {
  const dir = path.resolve(positional[0] || '.');
  const registry = String(flags.registry || DEFAULT_REGISTRY).replace(/\/$/, '');
  const mode = flags.public ? 'public' : 'private';

  const sign = runSign([dir], flags);

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_NAME), 'utf8'));
  const skill = readSkillFrontmatter(dir);

  const body = {
    hash: manifest.manifestSha256,
    mode,
    ...(manifest.identifier ? { license: manifest.identifier } : {}),
    ...(manifest.author ? { author: manifest.author } : {}),
  };

  if (sign.signed) {
    body.signature = fs.readFileSync(path.join(dir, SIG_NAME), 'utf8');
    const pubPath = `${sign.keyPath}.pub`;
    if (fs.existsSync(pubPath)) body.publicKey = fs.readFileSync(pubPath, 'utf8').trim();
  }

  if (typeof flags.supersedes === 'string') body.supersedes = flags.supersedes;

  if (mode === 'public') {
    const meta = {};
    if (skill.hasFrontmatter) {
      const name = getField(skill.parsed, 'name');
      const description = getField(skill.parsed, 'description');
      if (name) meta.name = name;
      if (description) meta.description = description;
    }
    if (typeof flags.repository === 'string') meta.repository = flags.repository;
    if (Object.keys(meta).length) body.meta = meta;
  }

  const res = await fetchFn(`${registry}/api/v1/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status !== 201) {
    let detail = '';
    try { detail = JSON.stringify(await res.json()); } catch { /* non-JSON error body */ }
    throw new Error(`registry refused the registration (HTTP ${res.status}) ${detail}`);
  }
  const { receipt } = await res.json();

  const keyRes = await fetchFn(`${registry}/api/v1/log/key`);
  if (!keyRes.ok) throw new Error(`could not fetch the registry log key (HTTP ${keyRes.status})`);
  const logKey = await keyRes.json();

  const bundle = { version: 1, registry, retrievedAt: new Date().toISOString(), receipt, logKey };
  const verification = verifyReceiptBundle(bundle);
  if (!verification.ok) {
    throw new Error(`receipt failed local verification before saving: ${verification.reason}`);
  }
  // Verified, and verified to be OURS: same artifact digest, mode, licence,
  // author and signer fields this invocation sent.
  assertReceiptMatchesRequest(receipt, body);

  const receiptPath = path.join(dir, RECEIPT_NAME);
  fs.writeFileSync(receiptPath, JSON.stringify(bundle, null, 2) + '\n');

  return {
    dir,
    registry,
    mode,
    srid: receipt.srid,
    hash: manifest.manifestSha256,
    license: manifest.identifier || null,
    signed: sign.signed,
    signSkippedReason: sign.signSkippedReason,
    receiptPath,
    keyId: verification.keyId,
    treeSize: receipt.treeHead.size,
    // Derived locally, never the bundle's own (unsigned) wording.
    whatThisProves: verification.whatThisProves,
  };
}

/** `skillrights receipt [dir]` — offline verification of a saved receipt bundle. */
export function runReceipt(positional) {
  const dir = path.resolve(positional[0] || '.');
  const receiptPath = path.join(dir, RECEIPT_NAME);
  if (!fs.existsSync(receiptPath)) {
    return { found: false, receiptPath };
  }
  const bundle = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  const verification = verifyReceiptBundle(bundle);
  return {
    found: true,
    receiptPath,
    ok: verification.ok,
    reason: verification.reason || null,
    keyId: verification.keyId || null,
    // The SIGNED record's srid, not the unbound display copy beside it.
    srid: bundle.receipt && bundle.receipt.record && bundle.receipt.record.srid,
    // UNSIGNED transport metadata: where this bundle says it came from. It is
    // not covered by any signature, so it is reported as provenance of the
    // file, never as part of what was verified.
    registry: bundle.registry,
    ts: bundle.receipt && bundle.receipt.record && bundle.receipt.record.ts,
    // Derived locally; the bundle's own `whatThisProves` is never echoed.
    whatThisProves: verification.ok ? verification.whatThisProves : null,
  };
}
