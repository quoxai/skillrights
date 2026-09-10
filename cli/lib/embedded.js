// Resolves paths to the licence texts and posture data bundled with this
// package, regardless of where the package is installed from.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileIfExists } from './fsutil.js';
import { sourceFileName } from './identifiers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = path.join(__dirname, '..');
export const LICENSES_DIR = path.join(PACKAGE_ROOT, 'licenses');
export const DATA_DIR = path.join(PACKAGE_ROOT, 'data');
export const POSTURE_PATH = path.join(DATA_DIR, 'posture.json');

export function readEmbeddedLicenseText(variant) {
  const p = path.join(LICENSES_DIR, sourceFileName(variant));
  const text = readFileIfExists(p);
  if (text === null) {
    throw new Error(`Bundled licence text missing: ${p}`);
  }
  return text;
}

export function readEmbeddedPosture() {
  const text = readFileIfExists(POSTURE_PATH);
  if (text === null) {
    throw new Error(`Bundled posture data missing: ${POSTURE_PATH}`);
  }
  return JSON.parse(text);
}
