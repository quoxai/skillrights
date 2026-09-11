/**
 * Hardening tests for the OTS/TSA parsers (audit findings, 2026-09-10).
 *
 * The anchor worker feeds these parsers bytes from calendar and TSA servers
 * we do not control, inside the same process that serves the public API, and
 * listAnchors re-parses proof files on request. So the parsers must be
 * resource-bounded, not merely correct on honest input:
 *
 *  - a hexlify chain doubles the working message per op; unbounded, ~25
 *    bytes of input allocated ~700MB and blocked the event loop for
 *    seconds (measured). The reference python client caps messages at
 *    4096 bytes; we match it.
 *  - op count (and therefore recursion depth) must be bounded.
 *  - network reads need a deadline and a body-size cap.
 *  - the TSA DER reader must reject negative long-form lengths.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  OTS_MAGIC, writeVarint, writeVarbytes, parseOts, buildDetachedOts,
  submitToCalendars, upgradeOts, MAX_MSG_LENGTH, MAX_OPS,
} from '../lib/ots.js';
import { parseTsr, requestTimestamp } from '../lib/tsa.js';

const ATT_BITCOIN = Buffer.from('0588960d73d71901', 'hex');

function fileHeader(digest) {
  return Buffer.concat([OTS_MAGIC, writeVarint(1), Buffer.from([0x08]), digest]);
}

function bitcoinAtt(height = 1) {
  return Buffer.concat([Buffer.from([0x00]), ATT_BITCOIN, writeVarbytes(writeVarint(height))]);
}

test('a hexlify chain is rejected long before it can exhaust memory', () => {
  const digest = randomBytes(32);
  // 24 hexlify ops double the 32-byte digest towards ~512MB; the cap must
  // trip within the first few microseconds instead.
  const chain = Buffer.concat([
    Buffer.alloc(24, 0xf3), // hexlify x24
    bitcoinAtt(),
  ]);
  const file = Buffer.concat([fileHeader(digest), chain]);
  const started = process.hrtime.bigint();
  assert.throws(() => parseOts(file), /message too long/);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(elapsedMs < 250, `rejection took ${elapsedMs}ms; the cap is not doing its job`);
});

test('an append bomb (huge varbytes arg) is rejected by the same cap', () => {
  const digest = randomBytes(32);
  const bigArg = Buffer.alloc(5000, 0x41);
  const chain = Buffer.concat([
    Buffer.from([0xf0]), writeVarbytes(bigArg), // append 5000 bytes -> result > 4096
    bitcoinAtt(),
  ]);
  const file = Buffer.concat([fileHeader(digest), chain]);
  assert.throws(() => parseOts(file), /message too long/);
});

test('op count is bounded (no unbounded recursion on crafted input)', () => {
  const digest = randomBytes(32);
  // A long chain of sha256 ops stays within the size cap (32 bytes each)
  // but must trip the op-count bound rather than recurse to a RangeError.
  const chain = Buffer.concat([
    Buffer.alloc(MAX_OPS + 10, 0x08), // sha256 x (MAX_OPS+10)
    bitcoinAtt(),
  ]);
  const file = Buffer.concat([fileHeader(digest), chain]);
  assert.throws(() => parseOts(file), /too many ops/);
});

test('honest-sized proofs still parse under the caps', () => {
  const digest = randomBytes(32);
  const nonce = randomBytes(16);
  const payload = writeVarbytes(Buffer.from('https://cal.example', 'utf8'));
  const resp = Buffer.concat([
    Buffer.from([0xf0]), writeVarbytes(nonce),
    Buffer.from([0x08]),
    Buffer.from([0x00]), Buffer.from('83dfe30d2ef90c8e', 'hex'), writeVarbytes(payload),
  ]);
  const file = buildDetachedOts(digest, [resp]);
  const parsed = parseOts(file);
  assert.equal(parsed.pendings.length, 1);
});

test('submitToCalendars rejects an oversized response body instead of buffering it', async () => {
  const digest = randomBytes(32);
  const huge = Buffer.alloc(1024 * 1024, 0xf0); // 1MB "response"
  const { responses, failures } = await submitToCalendars(digest, ['https://cal.example'], async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => huge,
    headers: { get: () => String(huge.length) },
  }));
  assert.equal(responses.length, 0);
  assert.equal(failures.length, 1);
  assert.match(failures[0].error, /too large/);
});

test('upgradeOts rejects an oversized continuation', async () => {
  const digest = randomBytes(32);
  const nonce = randomBytes(16);
  const payload = writeVarbytes(Buffer.from('https://cal.example', 'utf8'));
  const resp = Buffer.concat([
    Buffer.from([0xf0]), writeVarbytes(nonce),
    Buffer.from([0x08]),
    Buffer.from([0x00]), Buffer.from('83dfe30d2ef90c8e', 'hex'), writeVarbytes(payload),
  ]);
  const file = buildDetachedOts(digest, [resp]);
  const huge = Buffer.alloc(1024 * 1024, 0xf0);
  const { upgraded, failures } = await upgradeOts(file, async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => huge,
    headers: { get: () => String(huge.length) },
  }), { calendars: ['https://cal.example'] });
  assert.equal(upgraded, 0);
  assert.equal(failures.length, 1);
  assert.match(failures[0].error, /too large/);
});

test('network calls carry an abort deadline', async () => {
  // The fetch stub records the options it was given; the assertion is that a
  // signal is present, which is what turns a slow-drip server from "anchoring
  // wedged forever, silently" into a counted failure with backoff.
  const digest = randomBytes(32);
  let sawSignal = false;
  await submitToCalendars(digest, ['https://cal.example'], async (url, opts) => {
    sawSignal = opts && opts.signal instanceof AbortSignal;
    throw new Error('stop here');
  });
  assert.equal(sawSignal, true, 'submitToCalendars sent no AbortSignal');

  let tsaSignal = false;
  await requestTimestamp(digest, 'https://tsa.example/tsr', async (url, opts) => {
    tsaSignal = opts && opts.signal instanceof AbortSignal;
    throw new Error('stop here');
  }).catch(() => {});
  assert.equal(tsaSignal, true, 'requestTimestamp sent no AbortSignal');
});

test('TSA DER reader rejects negative long-form lengths', () => {
  // 0x84 = long form, 4 length bytes; 0xff... would go negative through
  // signed shifts and previously made end < start, which read status 0
  // ("granted") from garbage.
  const evil = Buffer.from('308480000000', 'hex');
  assert.throws(() => parseTsr(evil), /DER/);
});

test('requestTimestamp refuses a token that does not cover the digest', async () => {
  const digest = randomBytes(32);
  // A granted response whose "token" is not an RFC 3161 timestamp token at
  // all: no CMS SignedData, so no TSTInfo and no message imprint. Since the
  // 2026-09-11 audit the imprint must be LOCATED in TSTInfo rather than
  // found anywhere in the body, so this is refused as unstructured.
  const grantedForOtherDigest = Buffer.from('300a3003020100' + '30030201aa', 'hex');
  await assert.rejects(
    requestTimestamp(digest, 'https://tsa.example/tsr', async () => ({
      ok: true, status: 200,
      arrayBuffer: async () => grantedForOtherDigest,
      headers: { get: () => String(grantedForOtherDigest.length) },
    })),
    /token|imprint/,
  );
});
