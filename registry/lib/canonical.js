// Byte-identical to cli/lib/hash.js's canonicalJSON: deterministic key
// ordering so the same record always hashes to the same bytes. Duplicated
// rather than imported because the registry deploys standalone (Docker)
// without the CLI package; the two MUST stay in sync (a divergence breaks
// receipt verification across the CLI/registry boundary).

import { createHash } from 'node:crypto';

export function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize(value[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalJSON(value) {
  return JSON.stringify(canonicalize(value));
}
