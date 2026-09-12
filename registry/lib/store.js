// Append-only JSONL store: the transparency log IS a file anyone can mirror
// and re-verify. One line per registration: { record, leaf } where leaf is
// the hex RFC 6962 leaf hash of canonicalJSON(record). Appends are fsynced
// before the receipt is returned, so a receipt never references an entry
// that could be lost by a crash. Derived indexes (srid, hash) live in
// memory and rebuild on boot.
//
// The Ed25519 tree-head signing key persists beside the log
// (service-key.pem, 0600). Backup story: copy the data dir; restore story:
// point REGISTRY_DATA_DIR at the copy (RECOVERABLE dimension: this store
// must be in the hostnode-prod backup set before launch is called done).

import fs from 'node:fs';
import path from 'node:path';
import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  sign as edSign,
} from 'node:crypto';
import { leafHash, rootOf, inclusionProof } from './merkle.js';
import { canonicalJSON, sha256Hex } from './canonical.js';

const LOG_NAME = 'log.jsonl';
const KEY_NAME = 'service-key.pem';

export function openStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const logPath = path.join(dataDir, LOG_NAME);
  const keyPath = path.join(dataDir, KEY_NAME);

  // --- signing key -------------------------------------------------------
  let privateKey;
  if (fs.existsSync(keyPath)) {
    privateKey = createPrivateKey(fs.readFileSync(keyPath, 'utf8'));
  } else {
    const pair = generateKeyPairSync('ed25519');
    const pem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    fs.writeFileSync(keyPath, pem, { mode: 0o600 });
    privateKey = pair.privateKey;
  }
  const publicPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  const keyId = sha256Hex(publicPem).slice(0, 16);

  // --- log load ----------------------------------------------------------
  const entries = []; // { record, leaf(hex) }
  const bySrid = new Map();
  const byHash = new Map(); // sha256 -> [entry, ...] first-seen order
  if (fs.existsSync(logPath)) {
    const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      indexEntry(JSON.parse(line));
    }
  }

  function indexEntry(entry) {
    entries.push(entry);
    bySrid.set(entry.record.srid, entry);
    const h = entry.record.artifact.sha256;
    if (!byHash.has(h)) byHash.set(h, []);
    byHash.get(h).push(entry);
  }

  function leaves() {
    return entries.map((e) => Buffer.from(e.leaf, 'hex'));
  }

  // A tree head is a pure function of the log size (root, and the ts/signature
  // fixed the first time that size was published). Recomputing the whole
  // Merkle root on every /tree-head, /proof and read was O(N) event-loop work
  // per request; cache by size so it is computed once per append. (Astra
  // reliability review, 2026-09-12: read-path CPU.) Bonus: every head for a
  // given size is now byte-identical, which is friendlier to verifiers.
  let _headCache = null; // { size, head }
  function signedTreeHead() {
    const size = entries.length;
    if (_headCache && _headCache.size === size) return _headCache.head;
    const root = rootOf(leaves()).toString('hex');
    const ts = new Date().toISOString();
    const headBytes = Buffer.from(canonicalJSON({ size, root, ts }));
    const signature = edSign(null, headBytes, privateKey).toString('base64');
    const head = { size, root, ts, keyId, signature };
    _headCache = { size, head };
    return head;
  }

  return {
    size: () => entries.length,
    getBySrid: (srid) => bySrid.get(srid) || null,
    getByHash: (hash) => byHash.get(hash) || [],
    entries: () => entries,
    publicKeyPem: () => publicPem,
    keyId: () => keyId,
    signedTreeHead,

    counts() {
      let pub = 0;
      for (const e of entries) if (e.record.mode === 'public') pub += 1;
      const unlisted = entries.length - pub;
      // `private` is the old name for `unlisted` (renamed 2026-09-11 because
      // the log serves every record regardless of listing). Both keys are
      // returned so an older reader of /api/v1/stats keeps working; rows
      // stored under either spelling count as unlisted.
      return { registrations: entries.length, public: pub, unlisted, private: unlisted };
    },

    /** Append a record; returns { entry, leafIndex, treeHead, proof }. */
    append(record) {
      const leaf = leafHash(Buffer.from(canonicalJSON(record))).toString('hex');
      const entry = { record, leaf };
      const fd = fs.openSync(logPath, 'a');
      try {
        fs.writeSync(fd, JSON.stringify(entry) + '\n');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      indexEntry(entry);
      const all = leaves();
      const leafIndex = entries.length - 1;
      return {
        entry,
        leafIndex,
        treeHead: signedTreeHead(),
        proof: inclusionProof(leafIndex, all).map((s) => ({ hash: s.hash.toString('hex'), side: s.side })),
      };
    },

    inclusionProofFor(index) {
      if (index < 0 || index >= entries.length) return null;
      return inclusionProof(index, leaves()).map((s) => ({ hash: s.hash.toString('hex'), side: s.side }));
    },
  };
}
