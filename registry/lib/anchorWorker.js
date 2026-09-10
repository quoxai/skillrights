// External anchoring worker: makes sure the transparency log is never its
// own only witness. Each new tree head root is (a) submitted to public
// OpenTimestamps calendars (batched into Bitcoin by them; proof upgraded in
// place once committed) and (b) countersigned by an RFC 3161 TSA. Anchor
// files live in <dataDir>/anchors and are served read-only by the API.
//
// Scheduler triad (2026-08-30 charter, load-bearing):
//   - failure accounting: failures are counted and ledgered DISTINCTLY from
//     "nothing to do" and from "calendar not ready yet" (which is normal);
//   - backoff: a tick with failures and zero progress doubles the delay,
//     capped; any progress resets it;
//   - retirement: anchor files on disk are the durable record; a completed
//     anchor is never re-submitted, an existing file is never re-requested.

import fs from 'node:fs';
import path from 'node:path';
import { buildDetachedOts, parseOts, submitToCalendars, upgradeOts } from './ots.js';
import { requestTimestamp } from './tsa.js';

export const DEFAULT_CALENDARS = [
  'https://a.pool.opentimestamps.org',
  'https://b.pool.opentimestamps.org',
  'https://a.pool.eternitywall.com',
];
export const DEFAULT_TSA = 'https://freetsa.org/tsr';

const NAME_RE = /^(\d+)-([a-f0-9]{64})\.(ots|tsr)$/;

export function createAnchorWorker({
  store,
  dataDir,
  fetchFn = fetch,
  calendars = DEFAULT_CALENDARS,
  tsaUrl = DEFAULT_TSA,
  intervalMs = 30 * 60 * 1000,
  maxIntervalMs = 6 * 60 * 60 * 1000,
  log = () => {},
}) {
  const anchorsDir = path.join(dataDir, 'anchors');
  fs.mkdirSync(anchorsDir, { recursive: true });
  const ledgerPath = path.join(anchorsDir, 'ledger.jsonl');
  let failStreak = 0;
  let timer = null;
  let stopped = false;

  function ledger(entry) {
    fs.appendFileSync(ledgerPath, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  }

  function anchorPath(size, root, ext) {
    return path.join(anchorsDir, `${size}-${root}.${ext}`);
  }

  // Parsed-status cache keyed by filename, invalidated on mtime/size change.
  // listAnchors backs the PUBLIC /api/v1/log/anchors route; without this,
  // every request re-parsed every proof file on disk, which combined badly
  // with parser cost on adversarial files (audit, 2026-09-10) and is O(N)
  // I/O forever as the log grows.
  const otsStatusCache = new Map(); // name -> { mtimeMs, size, ots, bitcoinHeights }

  /** List anchors on disk with their parsed status. */
  function listAnchors() {
    const bases = new Map();
    for (const name of fs.readdirSync(anchorsDir)) {
      const m = NAME_RE.exec(name);
      if (!m) continue;
      const key = `${m[1]}-${m[2]}`;
      if (!bases.has(key)) bases.set(key, { size: Number(m[1]), root: m[2], ots: null, tsr: false });
      const info = bases.get(key);
      if (m[3] === 'tsr') { info.tsr = true; continue; }

      const file = path.join(anchorsDir, name);
      let stat;
      try {
        stat = fs.statSync(file);
      } catch {
        continue; // raced with a concurrent rewrite; next call sees it
      }
      const cached = otsStatusCache.get(name);
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        info.ots = cached.ots;
        info.bitcoinHeights = cached.bitcoinHeights;
        continue;
      }
      let entry;
      try {
        const parsed = parseOts(fs.readFileSync(file));
        entry = {
          ots: parsed.bitcoins.length > 0 ? 'bitcoin' : 'pending',
          bitcoinHeights: parsed.bitcoins.map((b) => b.height),
        };
      } catch {
        entry = { ots: 'unreadable', bitcoinHeights: [] };
      }
      otsStatusCache.set(name, { mtimeMs: stat.mtimeMs, size: stat.size, ...entry });
      info.ots = entry.ots;
      info.bitcoinHeights = entry.bitcoinHeights;
    }
    return [...bases.values()].sort((a, b) => a.size - b.size);
  }

  async function tick() {
    const head = store.signedTreeHead();
    let progress = false;
    let failures = 0;

    if (head.size > 0) {
      const digest = Buffer.from(head.root, 'hex');

      // 1. New root -> OTS calendar submission (skipped forever once the file exists).
      const otsFile = anchorPath(head.size, head.root, 'ots');
      if (!fs.existsSync(otsFile)) {
        const { responses, failures: calFails } = await submitToCalendars(digest, calendars, fetchFn);
        for (const f of calFails) ledger({ ok: false, op: 'ots_submit', calendar: f.calendar, error: f.error, size: head.size, root: head.root });
        if (responses.length > 0) {
          try {
            const file = buildDetachedOts(digest, responses.map((r) => r.timestamp));
            fs.writeFileSync(otsFile, file);
            ledger({ ok: true, op: 'ots_submit', size: head.size, root: head.root, calendars: responses.map((r) => r.calendar) });
            progress = true;
          } catch (err) {
            failures += 1;
            ledger({ ok: false, op: 'ots_build', error: err.message, size: head.size, root: head.root });
          }
        } else {
          failures += 1;
        }
      }

      // 2. New root -> RFC 3161 countersignature.
      const tsrFile = anchorPath(head.size, head.root, 'tsr');
      if (!fs.existsSync(tsrFile)) {
        try {
          const tsr = await requestTimestamp(digest, tsaUrl, fetchFn);
          fs.writeFileSync(tsrFile, tsr);
          ledger({ ok: true, op: 'tsa', size: head.size, root: head.root, tsa: tsaUrl });
          progress = true;
        } catch (err) {
          failures += 1;
          ledger({ ok: false, op: 'tsa', error: err.message, size: head.size, root: head.root, tsa: tsaUrl });
        }
      }
    }

    // 3. Upgrade any pending OTS proofs (historical roots included).
    for (const info of listAnchors()) {
      if (info.ots !== 'pending') continue;
      const file = anchorPath(info.size, info.root, 'ots');
      try {
        const buf = fs.readFileSync(file);
        const { file: nextBuf, upgraded, notReady, failures: upFails } = await upgradeOts(buf, fetchFn);
        for (const f of upFails) ledger({ ok: false, op: 'ots_upgrade', calendar: f.calendar, error: f.error, size: info.size, root: info.root });
        failures += upFails.length;
        if (upgraded > 0) {
          fs.writeFileSync(file, nextBuf);
          const done = parseOts(nextBuf).bitcoins;
          ledger({ ok: true, op: 'ots_upgrade', size: info.size, root: info.root, upgraded, notReady, complete: done.length > 0, bitcoinHeights: done.map((b) => b.height) });
          progress = true;
        }
      } catch (err) {
        failures += 1;
        ledger({ ok: false, op: 'ots_upgrade', error: err.message, size: info.size, root: info.root });
      }
    }

    failStreak = progress || failures === 0 ? 0 : failStreak + 1;
    return { progress, failures, failStreak };
  }

  function nextDelay() {
    return Math.min(intervalMs * 2 ** failStreak, maxIntervalMs);
  }

  function arm(fn, ms) {
    timer = setTimeout(fn, ms);
    if (timer.unref) timer.unref();
  }

  function start() {
    stopped = false;
    const loop = async () => {
      if (stopped) return;
      try {
        const r = await tick();
        log(`anchors: tick progress=${r.progress} failures=${r.failures} streak=${r.failStreak}`);
      } catch (err) {
        failStreak += 1;
        ledger({ ok: false, op: 'tick', error: err.message });
        log(`anchors: tick crashed: ${err.message}`);
      }
      if (!stopped) arm(loop, nextDelay());
    };
    arm(loop, 5000);
  }

  function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
  }

  return { tick, start, stop, listAnchors, anchorsDir, nextDelay };
}
