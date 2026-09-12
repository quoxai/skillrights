// SkillRights Registry + Witness — zero-dependency HTTP service.
// Endpoints (all JSON):
//   GET  /health                      -> { status, registrations }
//   POST /api/v1/register             -> 201 { receipt }
//   GET  /api/v1/registry/<srid>      -> { record, leafIndex }
//   GET  /api/v1/hash/<sha256>        -> { matches: [{srid, seq, ts, mode}] }
//   GET  /api/v1/log/tree-head        -> signed tree head
//   GET  /api/v1/log/key              -> { publicKeyPem, keyId }
//   GET  /api/v1/log/proof?index=N    -> { leafIndex, proof, treeHead }
//   GET  /api/v1/log/entries?start=N&limit=M -> raw log slice (mirroring)
//   GET  /api/v1/log/anchors          -> external anchor inventory
//   GET  /api/v1/log/anchor/<size>-<root>.(ots|tsr) -> raw proof bytes
//   GET  /api/v1/stats                -> aggregate counts only
//
// Free, no accounts: identity is the registrant's signing key, abuse
// control is per-IP rate limiting plus strict size caps. Data lives in an
// append-only JSONL log (see lib/store.js) that anyone can mirror.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { openStore } from './lib/store.js';
import { register } from './lib/registry.js';
import { createAnchorWorker, DEFAULT_CALENDARS, DEFAULT_TSA } from './lib/anchorWorker.js';

const MAX_BODY = 64 * 1024;
const SHA256_RE = /^[a-f0-9]{64}$/;
const SRID_RE = /^sr:skill:[0-9A-HJKMNP-TV-Z]{26}$/;
const ANCHOR_FILE_RE = /^(\d{1,12})-([a-f0-9]{64})\.(ots|tsr)$/;
const MAX_ENTRIES_PAGE = 500;

function makeBucket(burst, refillPerSec) {
  const buckets = new Map();
  // The bucket Map must not grow without bound: a caller that varies its
  // apparent identity every request (see resolveClientIp) would otherwise
  // leak memory until the process dies. Cap it; when full, evict the
  // stalest entries. An evicted attacker just gets a fresh full bucket,
  // which is fine: the cap protects memory, the token math protects rate.
  const MAX_BUCKETS = 20000;
  function evictIfFull() {
    if (buckets.size <= MAX_BUCKETS) return;
    const victims = [...buckets.entries()].sort((a, b) => a[1].last - b[1].last)
      .slice(0, Math.ceil(MAX_BUCKETS / 10));
    for (const [k] of victims) buckets.delete(k);
  }
  return (ip) => {
    const nowS = Date.now() / 1000;
    let b = buckets.get(ip);
    if (!b) { evictIfFull(); b = { tokens: burst, last: nowS }; buckets.set(ip, b); }
    b.tokens = Math.min(burst, b.tokens + (nowS - b.last) * refillPerSec);
    b.last = nowS;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  };
}

// Resolve the client IP for rate limiting. X-Forwarded-For's FIRST value is
// attacker-controlled (any client can send the header), so trusting it lets
// a caller mint a new identity per request and bypass the per-IP limit
// entirely. Behind Cloudflare (our deployment) CF-Connecting-IP is set by
// the edge and cannot be spoofed through it; prefer it. Off Cloudflare, the
// socket peer is the only trustworthy source. We deliberately do NOT trust
// arbitrary X-Forwarded-For. (Audit finding, owner question, 2026-09-12.)
export function resolveClientIp(req, { trustCfHeader = true } = {}) {
  if (trustCfHeader) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.trim()) return cf.trim();
  }
  return (req.socket && req.socket.remoteAddress) || '?';
}

export function createServer({ dataDir = process.env.REGISTRY_DATA_DIR || './data', postBurst = 30, getBurst = 120, anchorWorker = null, store = null } = {}) {
  store = store || openStore(dataDir);
  const allowPost = makeBucket(postBurst, 0.5);
  const allowGet = makeBucket(getBurst, 5);
  // Passive anchor lister when no live worker is attached (worker owns the
  // same directory layout; created here purely for listAnchors/anchorsDir).
  const anchors = anchorWorker || createAnchorWorker({ store, dataDir, fetchFn: () => { throw new Error('anchoring disabled'); } });

  return http.createServer((req, res) => {
    const ip = resolveClientIp(req);

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
      if (p === '/' || p === '/index.html') {
        // A human in a browser lands here expecting "the registry". The
        // machine API lives under /api/v1; the human directory lives on the
        // main site. Greet, do not 404 (owner hit exactly this, 2026-09-12).
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end('<!doctype html><meta charset="utf-8"><title>SkillRights Registry API</title>'
          + '<body style="font-family:system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#0B2545;background:#F8FAFC">'
          + '<h1>SkillRights Registry</h1>'
          + '<p>This host serves the registry API (an append-only transparency log).</p>'
          + '<p><strong>Looking for the directory of registered skills?</strong> It lives at '
          + '<a href="https://skillrights.org/registry/" style="color:#0EA5A0">skillrights.org/registry</a>.</p>'
          + '<p>Machine endpoints: <code>/health</code>, <code>/api/v1/log/tree-head</code>, '
          + '<code>/api/v1/log/entries</code>, <code>/api/v1/log/anchors</code>, <code>/api/v1/log/key</code>. '
          + 'Mirroring recipe: <a href="https://github.com/quoxai/skillrights/blob/master/registry/MIRRORING.md" style="color:#0EA5A0">MIRRORING.md</a>.</p></body>');
        return;
      }
      if (p === '/health') return json(200, { status: 'ok', registrations: store.size() });
      if (p === '/robots.txt') {
        // API host: nothing here is for crawlers; the human-facing directory
        // lives on skillrights.org.
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end('User-agent: *\nDisallow: /\n');
      }
      if (p === '/api/v1/log/tree-head') return json(200, store.signedTreeHead());
      if (p === '/api/v1/log/entries') {
        const start = Number(url.searchParams.get('start') || 0);
        const limit = Math.min(Number(url.searchParams.get('limit') || MAX_ENTRIES_PAGE), MAX_ENTRIES_PAGE);
        if (!Number.isInteger(start) || start < 0 || !Number.isInteger(limit) || limit < 1) {
          return json(400, { error: 'start and limit must be non-negative integers' });
        }
        const all = store.entries();
        return json(200, { size: all.length, start, entries: all.slice(start, start + limit) });
      }
      if (p === '/api/v1/log/anchors') {
        return json(200, { anchors: anchors.listAnchors() });
      }
      if (p.startsWith('/api/v1/log/anchor/')) {
        const name = p.slice('/api/v1/log/anchor/'.length);
        if (!ANCHOR_FILE_RE.test(name)) return json(400, { error: 'malformed anchor name' });
        const file = path.join(anchors.anchorsDir, name);
        if (!fs.existsSync(file)) return json(404, { error: 'not_found' });
        res.writeHead(200, {
          'content-type': name.endsWith('.tsr') ? 'application/timestamp-reply' : 'application/octet-stream',
          'access-control-allow-origin': '*',
          'cache-control': 'no-store',
        });
        return res.end(fs.readFileSync(file));
      }
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
          if (err.code === 'invalid_registration' || err.code === 'invalid_record_key') {
            return json(400, { error: err.code, errors: err.errors });
          }
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
  const dataDir = process.env.REGISTRY_DATA_DIR || './data';
  const store = openStore(dataDir); // one store instance shared by server and worker
  let worker = null;
  if (process.env.REGISTRY_ANCHORS !== 'off') {
    worker = createAnchorWorker({
      store,
      dataDir,
      calendars: process.env.REGISTRY_CALENDARS
        ? process.env.REGISTRY_CALENDARS.split(',').map((s) => s.trim()).filter(Boolean)
        : DEFAULT_CALENDARS,
      tsaUrl: process.env.REGISTRY_TSA_URL || DEFAULT_TSA,
      log: console.log,
    });
    worker.start();
  }
  const server = createServer({ dataDir, store, anchorWorker: worker });
  server.listen(port, '0.0.0.0', () => {
    console.log(`skillrights-registry listening on :${port} (anchoring ${worker ? 'on' : 'off'})`);
  });
}
