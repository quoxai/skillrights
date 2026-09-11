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
    // Object.create(null) + defineProperty, NOT `{}` + assignment: a plain
    // object inherits a `__proto__` SETTER, so assigning a key named
    // `__proto__` mutated the temporary object's prototype instead of
    // creating an own property. The key then vanished from the hashed bytes
    // while the store persisted it verbatim: unhashed-but-stored evidence
    // that could be altered freely after the fact (audit, 2026-09-11).
    // Records that never carried such a key hash to exactly the same bytes
    // as before, so previously issued receipts are unaffected.
    const sorted = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      Object.defineProperty(sorted, key, {
        value: canonicalize(value[key]),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return sorted;
  }
  return value;
}

export function canonicalJSON(value) {
  return JSON.stringify(canonicalize(value));
}
