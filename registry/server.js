// SkillRights Registry + Witness — zero-dependency HTTP service.
// Endpoints (all JSON):
//   GET  /health                      -> { status, registrations }
//   POST /api/v1/register             -> 201 { receipt }
//   GET  /api/v1/registry/<srid>      -> { record, leafIndex }
//   GET  /api/v1/hash/<sha256>        -> { matches: [{srid, seq, ts, mode}] }
//   GET  /api/v1/log/tree-head        -> signed tree head
//   GET  /api/v1/log/key              -> { publicKeyPem, keyId }
//   GET  /api/v1/log/proof?index=N    -> { leafIndex, proof, treeHead }
//   GET  /api/v1/stats                -> aggregate counts only
//
// Free, no accounts: identity is the registrant's signing key, abuse
// control is per-IP rate limiting plus strict size caps. Data lives in an
// append-only JSONL log (see lib/store.js) that anyone can mirror.

import http from 'node:http';
import { openStore } from './lib/store.js';
import { register } from './lib/registry.js';

const MAX_BODY = 64 * 1024;
const SHA256_RE = /^[a-f0-9]{64}$/;
const SRID_RE = /^sr:skill:[0-9A-HJKMNP-TV-Z]{26}$/;

function makeBucket(burst, refillPerSec) {
  const buckets = new Map();
  return (ip) => {
    const nowS = Date.now() / 1000;
    let b = buckets.get(ip);
    if (!b) { b = { tokens: burst, last: nowS }; buckets.set(ip, b); }
    b.tokens = Math.min(burst, b.tokens + (nowS - b.last) * refillPerSec);
    b.last = nowS;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  };
}

export function createServer({ dataDir = process.env.REGISTRY_DATA_DIR || './data', postBurst = 30, getBurst = 120 } = {}) {
  const store = openStore(dataDir);
  const allowPost = makeBucket(postBurst, 0.5);
  const allowGet = makeBucket(getBurst, 5);

  return http.createServer((req, res) => {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';

    function json(status, body) {
      const payload = JSON.stringify(body);
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'cache-control': 'no-store',
      });
      res.end(payload);
    }

    if (req.method === 'OPTIONS') return json(204, {});

    const url = new URL(req.url, 'http://internal');
    const p = url.pathname;

    if (req.method === 'GET') {
      if (!allowGet(ip)) return json(429, { error: 'rate_limited' });
      if (p === '/health') return json(200, { status: 'ok', registrations: store.size() });
      if (p === '/api/v1/log/tree-head') return json(200, store.signedTreeHead());
      if (p === '/api/v1/log/key') return json(200, { publicKeyPem: store.publicKeyPem(), keyId: store.keyId() });
      if (p === '/api/v1/stats') return json(200, store.counts());
      if (p === '/api/v1/log/proof') {
        const index = Number(url.searchParams.get('index'));
        if (!Number.isInteger(index)) return json(400, { error: 'index must be an integer' });
        const proof = store.inclusionProofFor(index);
        if (!proof) return json(404, { error: 'index out of range' });
        return json(200, { leafIndex: index, proof, treeHead: store.signedTreeHead() });
      }
      if (p.startsWith('/api/v1/registry/')) {
        const srid = decodeURIComponent(p.slice('/api/v1/registry/'.length));
        if (!SRID_RE.test(srid)) return json(400, { error: 'malformed srid' });
        const entry = store.getBySrid(srid);
        if (!entry) return json(404, { error: 'not_found' });
        return json(200, { record: entry.record, leafIndex: entry.record.seq });
      }
      if (p.startsWith('/api/v1/hash/')) {
        const hash = p.slice('/api/v1/hash/'.length);
        if (!SHA256_RE.test(hash)) return json(400, { error: 'malformed sha256' });
        const matches = store.getByHash(hash).map((e) => ({
          srid: e.record.srid, seq: e.record.seq, ts: e.record.ts, mode: e.record.mode,
        }));
        return json(200, { matches });
      }
      return json(404, { error: 'not_found' });
    }

    if (req.method === 'POST' && p === '/api/v1/register') {
      if (!allowPost(ip)) return json(429, { error: 'rate_limited' });
      let size = 0;
      const chunks = [];
      let overflowed = false;
      req.on('data', (chunk) => {
        if (overflowed) return;
        size += chunk.length;
        if (size > MAX_BODY) {
          overflowed = true;
          json(413, { error: 'body_too_large', maxBytes: MAX_BODY });
          req.removeAllListeners('data');
          req.resume(); // drain the rest without buffering
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (overflowed) return;
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          return json(400, { error: 'invalid_json' });
        }
        try {
          const { receipt } = register(store, body);
          return json(201, { receipt });
        } catch (err) {
          if (err.code === 'invalid_registration') return json(400, { error: err.code, errors: err.errors });
          return json(500, { error: 'registration_failed' });
        }
      });
      return;
    }

    return json(404, { error: 'not_found' });
  });
}

// Direct execution (Docker CMD): node server.js
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 3111);
  const server = createServer({});
  server.listen(port, '0.0.0.0', () => {
    console.log(`skillrights-registry listening on :${port}`);
  });
}
