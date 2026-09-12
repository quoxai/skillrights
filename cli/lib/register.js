import fs from 'node:fs';
import path from 'node:path';
import { runSign, MANIFEST_NAME, SIG_NAME } from './sign.js';
import { readSkillFrontmatter } from './skillfile.js';
import { getField } from './frontmatter.js';
import { verifyReceiptBundle, verifyAnchor, RECEIPT_NAME } from './receipt.js';
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
 * Printed BEFORE anything is sent. The mode used to be called "private",
 * which read as confidential; the log endpoint serves every record
 * regardless of listing, so the only thing the mode controls is the
 * directory (Codex review, 2026-09-11).
 */
export const REGISTRATION_DISCLOSURE =
  'What you submit (the hash, claimed author, public key, signature, licence identifier and mode) enters a PUBLIC append-only log, readable by anyone, even when unlisted. Unlisted controls only whether the skill appears in the directory at skillrights.org/registry. Your skill content never leaves this machine.';

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
export async function runRegister(positional, flags, fetchFn = fetch, log = console.log) {
  const dir = path.resolve(positional[0] || '.');
  const registry = String(flags.registry || DEFAULT_REGISTRY).replace(/\/$/, '');
  const mode = flags.public ? 'public' : 'unlisted';

  // A registration records rights claims about a SKILL. A directory with no
  // SKILL.md has nothing to claim rights over; refuse BEFORE signing or any
  // network call. (An empty test directory reached the permanent production
  // log before this guard existed, 2026-09-12.)
  const precheck = readSkillFrontmatter(dir);
  if (!precheck.exists) {
    throw new Error(`No SKILL.md found at ${path.join(dir, 'SKILL.md')}: nothing to register.`);
  }

  const sign = runSign([dir], flags);

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_NAME), 'utf8'));
  const skill = readSkillFrontmatter(dir);

  const body = {
    hash: manifest.manifestSha256,
    mode,
    ...(manifest.identifier ? { license: manifest.identifier } : {}),
    ...(manifest.author ? { author: manifest.author } : {}),
  };

  // SR-SIGV (2026-09-11): prefer the signature the registry can CHECK. The
  // hash signature covers the exact `hash` field below (the 64-character hex
  // string as UTF-8 bytes) under the author's own ed25519 SSH key, so the
  // record comes back signatureVerified:true. The ssh-keygen signature over
  // the manifest FILE remains on disk for `skillrights verify`, and is still
  // what gets submitted when the key cannot be used (passphrase-protected,
  // missing, or not ed25519), which the registry records as submitted but
  // unverified. Never both: one submitted signature, and we say which it is.
  let signatureKind = 'none';
  if (sign.hashSignature && sign.publicKeyLine) {
    body.signature = sign.hashSignature;
    body.publicKey = sign.publicKeyLine;
    signatureKind = 'artifact-hash';
  } else if (sign.signed) {
    body.signature = fs.readFileSync(path.join(dir, SIG_NAME), 'utf8');
    const pubPath = `${sign.keyPath}.pub`;
    if (fs.existsSync(pubPath)) body.publicKey = fs.readFileSync(pubPath, 'utf8').trim();
    signatureKind = 'manifest-file';
  }

  if (typeof flags.supersedes === 'string') body.supersedes = flags.supersedes;

  if (mode === 'public') {
    const meta = {};
    if (skill.hasFrontmatter) {
      const name = getField(skill.parsed, 'name');
      const description = getField(skill.parsed, 'description');
      if (name) meta.name = name;
      if (description) {
        // The registry caps listing descriptions at 500 chars. A listing
        // blurb is display metadata, so truncate honestly (marked with an
        // ellipsis) instead of failing the whole registration; the full
        // description stays in the skill itself, which never leaves here.
        meta.description = description.length > 500
          ? description.slice(0, 499) + '\u2026'
          : description;
      }
    }
    if (typeof flags.repository === 'string') meta.repository = flags.repository;
    if (Object.keys(meta).length) body.meta = meta;
  }

  log(REGISTRATION_DISCLOSURE);
  log('');

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
    // Which signature this invocation actually submitted:
    //   'artifact-hash'  signed the submitted hash with the author's ed25519
    //                    SSH key, so the registry can verify it
    //   'manifest-file'  fell back to the ssh-keygen signature over the
    //                    manifest file, which the registry cannot check
    //   'none'           nothing to submit
    signatureKind,
    // Why the verifiable path was unavailable, when it was (encrypted key,
    // missing key, non-ed25519 key). Null when it was used.
    hashSignatureSkippedReason: signatureKind === 'artifact-hash' ? null : sign.hashSignatureSkippedReason,
    // The registry's own answer, recorded in the signed record: did the
    // submitted signature verify against the submitted hash? null means the
    // record carries no signature at all. Reported exactly as the registry
    // returned it; this CLI never upgrades "submitted" to "verified".
    signatureVerified: typeof receipt.record.signatureVerified === 'boolean' ? receipt.record.signatureVerified : null,
    receiptPath,
    keyId: verification.keyId,
    treeSize: receipt.treeHead.size,
    // Derived locally, never the bundle's own (unsigned) wording.
    whatThisProves: verification.whatThisProves,
  };
}

/**
 * Compares the receipt's artifact hash with the manifest hash of the
 * directory it sits in. A receipt can verify perfectly and still describe
 * an EARLIER version of the skill beside it (Codex review, 2026-09-11:
 * "receipt verification does not compare it with the current skill
 * directory"). Reported as its own distinct status, never folded into the
 * receipt's own ok: verifying a receipt on its own, away from any skill, is
 * a legitimate use and must not fail a script.
 *   'match'       the local manifest hash is the registered hash
 *   'mismatch'    the directory has changed or was re-signed since
 *   'not-checked' no manifest here to compare against
 */
function compareWithLocalArtifact(dir, receipt) {
  const manifestPath = path.join(dir, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) return { state: 'not-checked', localHash: null };
  let localHash = null;
  try {
    localHash = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).manifestSha256 || null;
  } catch {
    return { state: 'not-checked', localHash: null };
  }
  const registered = receipt && receipt.record && receipt.record.artifact && receipt.record.artifact.sha256;
  if (!localHash || !registered) return { state: 'not-checked', localHash };
  return { state: localHash === registered ? 'match' : 'mismatch', localHash };
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
  const record = (bundle.receipt && bundle.receipt.record) || {};
  const local = compareWithLocalArtifact(dir, bundle.receipt);
  return {
    found: true,
    receiptPath,
    ok: verification.ok,
    reason: verification.reason || null,
    keyId: verification.keyId || null,
    mode: record.mode || null,
    hash: (record.artifact && record.artifact.sha256) || null,
    // What the registry recorded about the submitted signature: true only
    // if it verified against the registered hash, false if it did not or
    // could not be checked, null if the record carries no signature.
    signatureVerified: typeof record.signatureVerified === 'boolean' ? record.signatureVerified : null,
    hasSignature: record.signature !== undefined,
    localArtifact: local.state,
    localHash: local.localHash,
    // The SIGNED record's srid, not the unbound display copy beside it.
    srid: bundle.receipt && bundle.receipt.record && bundle.receipt.record.srid,
    // UNSIGNED transport metadata: where this bundle says it came from. It is
    // not covered by any signature, so it is reported as provenance of the
    // file, never as part of what was verified.
    registry: bundle.registry,
    ts: bundle.receipt && bundle.receipt.record && bundle.receipt.record.ts,
    // Derived locally; the bundle's own `whatThisProves` is never echoed.
    whatThisProves: verification.ok ? verification.whatThisProves : null,
    // The Bitcoin anchor, if this receipt has been upgraded to carry one.
    // Reported as its own status so a receipt with no anchor is not a failure.
    anchor: bundle.anchor ? verifyAnchor(bundle) : { ok: false, reason: 'none' },
  };
}

const DEFAULT_REGISTRY_FOR = (bundle, flags) =>
  (typeof flags.registry === 'string' && flags.registry) || bundle.registry || DEFAULT_REGISTRY;

/**
 * `skillrights receipt --upgrade [dir]` — fetch the Bitcoin anchor covering
 * this receipt's leaf and embed it, turning a v1 "trust the log's signature"
 * receipt into a v2 receipt that verifies against Bitcoin alone. Every part of
 * the fetched chain is verified LOCALLY before the file is rewritten, so a
 * hostile or broken registry cannot make us save an anchor that does not check
 * out. Network is used for the fetch only; verification is offline.
 * Returns { state: 'upgraded'|'already'|'pending'|'no-receipt', ... }.
 */
export async function runReceiptUpgrade(positional, flags, fetchFn = fetch) {
  const dir = path.resolve(positional[0] || '.');
  const receiptPath = path.join(dir, RECEIPT_NAME);
  if (!fs.existsSync(receiptPath)) return { state: 'no-receipt', receiptPath };
  const bundle = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));

  const base = verifyReceiptBundle(bundle);
  if (!base.ok) throw new Error(`refusing to upgrade a receipt that does not verify: ${base.reason}`);

  if (bundle.anchor) {
    const existing = verifyAnchor(bundle);
    if (existing.ok) return { state: 'already', receiptPath, bitcoinHeights: existing.bitcoinHeights, size: existing.size };
    // A present-but-invalid anchor is replaced, not trusted.
  }

  const registry = DEFAULT_REGISTRY_FOR(bundle, flags).replace(/\/$/, '');
  const leafIndex = bundle.receipt.leafIndex;

  const proofRes = await fetchFn(`${registry}/api/v1/log/anchored-proof?index=${leafIndex}`);
  if (proofRes.status === 404) {
    let reason = 'no Bitcoin-confirmed anchor covers this leaf yet';
    try { reason = (await proofRes.json()).message || reason; } catch { /* keep default */ }
    return { state: 'pending', receiptPath, registry, reason };
  }
  if (!proofRes.ok) throw new Error(`registry returned HTTP ${proofRes.status} for the anchored proof`);
  const proof = await proofRes.json();

  // Fetch the raw .ots for the anchored head. The proof named the URL; refuse
  // anything that is not the expected anchor path (no following the registry to
  // an arbitrary location).
  const expectedOtsPath = `/api/v1/log/anchor/${proof.anchor.size}-${proof.anchor.root}.ots`;
  if (proof.otsUrl !== expectedOtsPath) throw new Error('registry named an unexpected anchor file path');
  const otsRes = await fetchFn(`${registry}${expectedOtsPath}`);
  if (!otsRes.ok) throw new Error(`could not fetch the .ots proof (HTTP ${otsRes.status})`);
  const otsBytes = Buffer.from(await otsRes.arrayBuffer());

  const candidate = {
    ...bundle,
    version: 2,
    anchor: {
      size: proof.anchor.size,
      root: proof.anchor.root,
      inclusionProof: proof.inclusionProof,
      ots: otsBytes.toString('base64'),
      bitcoin: { heights: proof.anchor.bitcoinHeights || [] },
      retrievedAt: new Date().toISOString(),
    },
  };

  // The whole chain must verify offline before we let the new file exist.
  const check = verifyAnchor(candidate);
  if (!check.ok) throw new Error(`fetched anchor failed local verification: ${check.reason}`);
  // And the base receipt must still verify with the version bumped to 2.
  const rebase = verifyReceiptBundle(candidate);
  if (!rebase.ok) throw new Error(`receipt no longer verifies after upgrade: ${rebase.reason}`);

  fs.writeFileSync(receiptPath, JSON.stringify(candidate, null, 2) + '\n');
  return { state: 'upgraded', receiptPath, registry, size: check.size, root: check.root, bitcoinHeights: check.bitcoinHeights };
}

/**
 * `skillrights receipt --extract-ots [dir]` — write the embedded .ots proof
 * out as a standalone file and print the exact command to verify it against
 * Bitcoin with the independent OpenTimestamps client. This is the bridge off
 * SkillRights entirely: `ots verify` talks to Bitcoin, not to us.
 * Returns { state: 'written'|'no-anchor'|'no-receipt', otsPath, digest, ... }.
 */
export function runReceiptExtractOts(positional) {
  const dir = path.resolve(positional[0] || '.');
  const receiptPath = path.join(dir, RECEIPT_NAME);
  if (!fs.existsSync(receiptPath)) return { state: 'no-receipt', receiptPath };
  const bundle = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  const check = verifyAnchor(bundle);
  if (!check.ok) return { state: 'no-anchor', receiptPath, reason: check.reason };

  const srid = (bundle.receipt.record && bundle.receipt.record.srid) || 'receipt';
  const safe = srid.replace(/[^a-zA-Z0-9._-]/g, '_');
  const otsPath = path.join(dir, `${safe}.ots`);
  fs.writeFileSync(otsPath, Buffer.from(bundle.anchor.ots, 'base64'));
  return { state: 'written', otsPath, digest: check.root, bitcoinHeights: check.bitcoinHeights };
}
