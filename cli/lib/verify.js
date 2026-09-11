import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sha256Hex, canonicalJSON } from './hash.js';
import { fileExists, walkFiles } from './fsutil.js';
import { MANIFEST_NAME, SIG_NAME } from './sign.js';

/**
 * `verify` answers TWO questions and never blends them (Codex review,
 * 2026-09-11: "verify can return success without checking a signature").
 *
 *   status.integrity  'pass' | 'fail'    do the files match the manifest
 *   status.signature  'absent'           no signature file beside them
 *                     'present'          a signature exists, NOT checked
 *                                        (no --signers file was given)
 *                     'verified'         checked against allowed signers
 *                     'failed'           checked, and it did not verify
 *
 * Neither status says anything about identity or ownership: a verified
 * signature relates signed bytes to a key, and relating that key to a
 * person is separate evidence this CLI does not hold.
 *
 * Exit status (ok): integrity failure or a present-and-failing signature is
 * a failure. Unsigned, and signed-but-unchecked, are reported plainly and
 * are not failures.
 */
export function runVerify(positional, flags) {
  const dir = path.resolve(positional[0] || '.');
  const manifestPath = path.join(dir, MANIFEST_NAME);
  const sigPath = path.join(dir, SIG_NAME);

  const findings = [];
  const status = { integrity: 'pass', signature: 'absent' };
  let ok = true;

  if (!fileExists(manifestPath)) {
    return {
      ok: false,
      status: { integrity: 'fail', signature: fileExists(sigPath) ? 'present' : 'absent' },
      findings: [`No manifest found at ${manifestPath}. Run "skillrights sign" first.`],
      dir,
    };
  }

  const rawManifestBuffer = fs.readFileSync(manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(rawManifestBuffer.toString('utf8'));
  } catch (err) {
    return {
      ok: false,
      status: { integrity: 'fail', signature: fileExists(sigPath) ? 'present' : 'absent' },
      findings: [`Manifest is not valid JSON: ${err.message}`],
      dir,
    };
  }

  const { manifestSha256, ...core } = manifest;
  const recomputed = sha256Hex(canonicalJSON(core));
  if (recomputed !== manifestSha256) {
    ok = false;
    status.integrity = 'fail';
    findings.push(
      'FAIL: manifest integrity check failed (manifestSha256 does not match recomputed hash; the manifest file itself may have been altered).'
    );
  } else {
    findings.push('PASS: manifest integrity check.');
  }

  const declaredFiles = manifest.files || {};
  const declaredPaths = Object.keys(declaredFiles).sort();
  for (const rel of declaredPaths) {
    const full = path.join(dir, rel);
    if (!fileExists(full)) {
      ok = false;
      status.integrity = 'fail';
      findings.push(`FAIL: ${rel} is missing (present in manifest, not found on disk).`);
      continue;
    }
    const actual = sha256Hex(fs.readFileSync(full));
    if (actual !== declaredFiles[rel]) {
      ok = false;
      status.integrity = 'fail';
      findings.push(`FAIL: ${rel} content has changed since signing.`);
    }
  }

  const onDisk = new Set(walkFiles(dir, new Set([MANIFEST_NAME, SIG_NAME])));
  const declaredSet = new Set(declaredPaths);
  const untracked = [...onDisk].filter((rel) => !declaredSet.has(rel)).sort();
  for (const rel of untracked) {
    findings.push(`NOTE: ${rel} exists on disk but is not tracked in the manifest.`);
  }

  if (declaredPaths.length && ok && untracked.length === 0) {
    findings.push(`PASS: all ${declaredPaths.length} tracked file(s) match the manifest.`);
  }

  const signersPath = flags.signers ? path.resolve(flags.signers) : null;
  if (signersPath) {
    if (!fileExists(sigPath)) {
      ok = false;
      status.signature = 'absent';
      findings.push(`FAIL: no signature file found at ${sigPath}; cannot verify against allowed signers.`);
    } else if (!fileExists(signersPath)) {
      ok = false;
      status.signature = 'present';
      findings.push(`FAIL: allowed signers file not found: ${signersPath}.`);
    } else {
      // Principal choice, documented in README/help: --identity wins if
      // given, otherwise the manifest's own author field (set at sign
      // time from SKILL.md frontmatter).
      const principal = flags.identity || manifest.author;
      if (!principal) {
        ok = false;
        status.signature = 'present';
        findings.push(
          'FAIL: no principal to verify against. Pass --identity, or sign a SKILL.md that has an "author" frontmatter field.'
        );
      } else {
        const result = spawnSync(
          'ssh-keygen',
          ['-Y', 'verify', '-f', signersPath, '-I', principal, '-n', 'skillrights', '-s', sigPath],
          { input: rawManifestBuffer, encoding: 'utf8' }
        );
        if (result.status === 0) {
          status.signature = 'verified';
          findings.push(
            `PASS: signature verified for principal "${principal}" (this binds the signed manifest to that key, not the key to a person).`
          );
        } else {
          ok = false;
          status.signature = 'failed';
          findings.push(
            `FAIL: signature verification failed for principal "${principal}": ${(result.stderr || result.stdout || '').trim()}`
          );
        }
      }
    }
  } else if (fileExists(sigPath)) {
    status.signature = 'present';
    findings.push(`NOTE: a signature exists at ${sigPath} but was not checked (pass --signers <allowed_signers> to check it).`);
  } else {
    findings.push('NOTE: unsigned: integrity only. Nothing here relates these files to a key or an author.');
  }

  return { ok, status, findings, dir };
}
