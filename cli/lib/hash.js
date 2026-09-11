import { createHash } from 'node:crypto';

export function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

// Deterministic key ordering so the same data always hashes to the same
// bytes, regardless of insertion order.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    // Object.create(null) + defineProperty, NOT `{}` + assignment: a plain
    // object inherits a `__proto__` SETTER, so a key named `__proto__`
    // mutated the temporary object's prototype instead of becoming an own
    // property, and silently disappeared from the hashed bytes while the
    // record kept it (audit, 2026-09-11). Byte-identical to
    // registry/lib/canonical.js, which MUST carry the same fix.
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
