import fs from 'node:fs';
import path from 'node:path';

const EXCLUDE_DIRS = new Set(['.git', 'node_modules']);

// Recursively lists every file under rootDir as a sorted list of
// forward-slash relative paths, skipping .git and node_modules directories
// and any relative path present in excludeFiles.
export function walkFiles(rootDir, excludeFiles = new Set()) {
  const results = [];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && EXCLUDE_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(rootDir, full).split(path.sep).join('/');
      if (excludeFiles.has(rel)) continue;
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        results.push(rel);
      }
    }
  }

  walk(rootDir);
  results.sort();
  return results;
}

export function fileExists(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function dirExists(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function readFileIfExists(p) {
  if (!fileExists(p)) return null;
  return fs.readFileSync(p, 'utf8');
}
