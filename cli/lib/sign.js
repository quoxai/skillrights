import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { walkFiles, fileExists } from './fsutil.js';
import { sha256Hex, canonicalJSON } from './hash.js';
import { readSkillFrontmatter } from './skillfile.js';
import { signArtifactHash } from './sshkey.js';
import { MANIFEST_NAME, SIG_NAME, toolArtifactNames } from './artifacts.js';

// One shared exclusion set for sign and verify (see lib/artifacts.js).
export { MANIFEST_NAME, SIG_NAME };

function resolveHome(p) {
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return path.resolve(p);
}

export function runSign(positional, flags) {
  const dir = path.resolve(positional[0] || '.');
  const manifestPath = path.join(dir, MANIFEST_NAME);
  const sigPath = path.join(dir, SIG_NAME);

  const files = walkFiles(dir, toolArtifactNames());

  const fileHashes = {};
  for (const rel of files) {
    const content = fs.readFileSync(path.join(dir, rel));
    fileHashes[rel] = sha256Hex(content);
  }

  const skill = readSkillFrontmatter(dir);
  const identifier = skill.hasFrontmatter ? skill.license : null;
  const author = skill.hasFrontmatter ? skill.author : null;

  const core = {
    version: 1,
    created: new Date().toISOString(),
    identifier: identifier || null,
    author: author || null,
    files: fileHashes,
  };
  const manifestSha256 = sha256Hex(canonicalJSON(core));
  const manifest = { ...core, manifestSha256 };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  const keyPath = flags.key ? resolveHome(flags.key) : path.join(os.homedir(), '.ssh', 'id_ed25519');

  let signed = false;
  let signSkippedReason = null;

  if (!fileExists(keyPath)) {
    signSkippedReason = `Signing key not found at ${keyPath}.`;
  } else {
    const result = spawnSync(
      'ssh-keygen',
      ['-Y', 'sign', '-f', keyPath, '-n', 'skillrights', manifestPath],
      { encoding: 'utf8' }
    );
    if (result.error) {
      signSkippedReason = result.error.message;
    } else if (result.status !== 0) {
      signSkippedReason = (result.stderr || result.stdout || `ssh-keygen exited with status ${result.status}`).trim();
    } else if (!fileExists(sigPath)) {
      signSkippedReason = 'ssh-keygen reported success but no .sig file was produced.';
    } else {
      signed = true;
    }
  }

  // SR-SIGV (2026-09-11): additionally sign the MANIFEST HASH STRING with the
  // same key. The ssh-keygen signature above covers the manifest FILE and
  // stays exactly as it was for local `skillrights verify`; this second,
  // additive signature is the one the registry can actually check, because
  // the hash string is the only thing it receives. Failure here is never
  // fatal: the manifest and the file signature are unaffected, and the caller
  // says plainly which of the two it managed to produce.
  let hashSignature = null;
  let publicKeyLine = null;
  let hashSignatureSkippedReason = null;

  if (!fileExists(keyPath)) {
    hashSignatureSkippedReason = `Signing key not found at ${keyPath}.`;
  } else {
    try {
      const signed = signArtifactHash(manifestSha256, keyPath);
      hashSignature = signed.signature;
      publicKeyLine = signed.publicKey;
    } catch (err) {
      hashSignatureSkippedReason = err.message;
    }
  }

  return {
    dir,
    manifestPath,
    sigPath,
    fileCount: files.length,
    identifier,
    author,
    keyPath,
    signed,
    signSkippedReason,
    manifestSha256,
    // Raw hex Ed25519 signature over the 64-character hash string, and the
    // matching OpenSSH public line. Null when the key is missing, encrypted,
    // or not an ed25519 key; the reason is carried alongside, never guessed at.
    hashSignature,
    publicKeyLine,
    hashSignatureSkippedReason,
  };
}
