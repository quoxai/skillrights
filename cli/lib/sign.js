import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { walkFiles, fileExists } from './fsutil.js';
import { sha256Hex, canonicalJSON } from './hash.js';
import { readSkillFrontmatter } from './skillfile.js';

export const MANIFEST_NAME = '.skillrights.manifest.json';
export const SIG_NAME = `${MANIFEST_NAME}.sig`;

function resolveHome(p) {
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return path.resolve(p);
}

export function runSign(positional, flags) {
  const dir = path.resolve(positional[0] || '.');
  const manifestPath = path.join(dir, MANIFEST_NAME);
  const sigPath = path.join(dir, SIG_NAME);

  const exclude = new Set([MANIFEST_NAME, SIG_NAME]);
  const files = walkFiles(dir, exclude);

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
  };
}
