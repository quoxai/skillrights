// Minimal ULID: 48-bit millisecond timestamp + 80 random bits, Crockford
// base32, 26 chars, lexically sortable. No dependency; crypto randomness.

import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(now = Date.now()) {
  let time = now;
  const chars = new Array(26);
  for (let i = 9; i >= 0; i--) {
    chars[i] = ALPHABET[time % 32];
    time = Math.floor(time / 32);
  }
  const rand = randomBytes(16);
  let acc = 0;
  let bits = 0;
  let pos = 10;
  for (const byte of rand) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5 && pos < 26) {
      chars[pos++] = ALPHABET[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (pos >= 26) break;
  }
  return chars.join('');
}
