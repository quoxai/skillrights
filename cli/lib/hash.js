import { createHash } from 'node:crypto';

export function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

// Deterministic key ordering so the same data always hashes to the same
// bytes, regardless of insertion order.
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
