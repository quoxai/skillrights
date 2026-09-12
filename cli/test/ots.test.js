import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOts, OTS_MAGIC } from '../lib/ots.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REAL = path.join(here, 'fixtures', 'real-bitcoin-anchor.ots');

test('parses a real Bitcoin anchor: committed root and block height', () => {
  const parsed = parseOts(fs.readFileSync(REAL));
  assert.equal(
    parsed.digest.toString('hex'),
    '7d81435671c78b22005818872394d51da9f7098c0224cc2503ffa8bc4f6f5624',
  );
  assert.ok(parsed.bitcoins.length >= 1);
  assert.ok(parsed.bitcoins.every((b) => b.height === 966403));
});

test('rejects a file with the wrong magic', () => {
  assert.throws(() => parseOts(Buffer.from('not an ots file at all, padding padding padding padding')), /bad magic/);
});

test('rejects trailing bytes after a valid proof', () => {
  const good = fs.readFileSync(REAL);
  assert.throws(() => parseOts(Buffer.concat([good, Buffer.from([0x00])])), /ots:/);
});

test('rejects a truncated proof', () => {
  const good = fs.readFileSync(REAL);
  assert.throws(() => parseOts(good.subarray(0, good.length - 5)), /ots:/);
});

test('rejects an unsupported version', () => {
  const buf = Buffer.concat([OTS_MAGIC, Buffer.from([0x02])]); // version 2
  assert.throws(() => parseOts(buf), /unsupported version/);
});
