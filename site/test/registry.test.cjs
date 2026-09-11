const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const page = fs.readFileSync(path.join(__dirname, '../registry/index.html'), 'utf8');
const script = page.match(/<script>([\s\S]*?)<\/script>/)[1];
const root = 'a'.repeat(64);
const record = {
  mode: 'public', srid: 'SRID-01K4SKILLRIGHTS123456789000', ts: '2026-09-11T12:00:00.000Z',
  artifact: { sha256: 'b'.repeat(64) }, author: 'control@door.black',
  meta: { name: 'cluster-doctor', description: 'Diagnose clusters.' },
  license: 'LicenseRef-SkillRights-NoTrain-1.0',
};

async function directory({ anchors = [], records = [record], fail = '', clipboard } = {}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      innerHTML: '', textContent: '', hidden: true, value: '', dataset: {},
      addEventListener(event, fn) { this[event] = fn; }, focus() {}, setAttribute() {},
    });
    return elements.get(id);
  };
  const document = { getElementById: element, addEventListener() {} };
  const context = {
    document, navigator: { clipboard }, URL, AbortController, setTimeout, clearTimeout,
    fetch: async url => {
      if (fail && url.includes(fail)) return { ok: false, status: 503 };
      let body;
      if (url.includes('/stats')) body = { registrations: records.length, public: records.filter(r => r.mode === 'public').length, unlisted: records.filter(r => r.mode !== 'public').length };
      else if (url.includes('/tree-head')) body = { root, size: records.length };
      else if (url.includes('/anchors')) body = { anchors };
      else body = { entries: records.map(record => ({ record })) };
      return { ok: true, json: async () => body };
    },
  };
  vm.runInNewContext(script, context);
  await new Promise(resolve => setImmediate(resolve));
  return element;
}

test('anchor evidence belongs to the displayed root, never an older root', async () => {
  const el = await directory({ anchors: [{ root: 'c'.repeat(64), size: 1, tsr: true, ots: 'bitcoin', bitcoinHeights: [900001] }] });
  assert.doesNotMatch(el('reg-evidence').innerHTML, /Bitcoin-anchored|RFC 3161 countersigned/);
  assert.match(el('reg-evidence').innerHTML, /No external anchor recorded for this root/);
});

test('signature status requires an explicit verification result; author stays a claim', async () => {
  const el = await directory({ records: [record, { ...record, signature: 'unchecked' }, { ...record, signature: 'checked', signatureVerified: true }] });
  const html = el('reg-list').innerHTML;
  assert.equal((html.match(/signature verified</g) || []).length, 1);
  assert.equal((html.match(/signature submitted</g) || []).length, 1);
  assert.equal((html.match(/witnessed</g) || []).length, 3);
  assert.match(html, /control@door.black/);
  assert.match(html.toLowerCase(), /claimed/);
});

test('unlisted records stay out of listings and author search still finds public claims', async () => {
  const el = await directory({ records: [record, { ...record, mode: 'unlisted', meta: { name: 'never-list-this' } }] });
  assert.doesNotMatch(el('reg-list').innerHTML, /never-list-this/);
  el('reg-search').value = 'DOOR.BLACK';
  el('reg-search').input();
  assert.match(el('reg-list').innerHTML, /cluster-doctor/);
  el('reg-search').value = 'no-match';
  el('reg-search').input();
  assert.match(el('reg-list').innerHTML, /No listings match/);
});

test('current pending and confirmed anchors are represented without promotion', async () => {
  const pending = await directory({ anchors: [{ root, size: 1, ots: 'pending', tsr: true }] });
  assert.match(pending('reg-evidence').innerHTML, /RFC 3161 countersigned/);
  assert.match(pending('reg-evidence').innerHTML, /Bitcoin confirmation pending/);
  assert.doesNotMatch(pending('reg-evidence').innerHTML, /Bitcoin-anchored/);
  const confirmed = await directory({ anchors: [{ root, size: 1, ots: 'bitcoin', bitcoinHeights: [900002] }] });
  assert.match(confirmed('reg-evidence').innerHTML, /Bitcoin-anchored \(block 900002\)/);
});

test('anchor outage preserves directory; log outage exposes a retry and raw evidence link', async () => {
  const partial = await directory({ fail: '/anchors' });
  assert.match(partial('reg-evidence').innerHTML, /Anchor state unavailable/);
  assert.match(partial('reg-list').innerHTML, /cluster-doctor/);
  const failed = await directory({ fail: '/entries' });
  assert.match(failed('reg-list').innerHTML, /HTTP 503/);
  assert.match(failed('reg-list').innerHTML, /Try again/);
  assert.match(failed('reg-list').innerHTML, /Read the raw log/);
});

test('untrusted claims are escaped and script URLs never become repository links', async () => {
  const el = await directory({ records: [{ ...record, author: '<img src=x onerror=alert(1)>', meta: { name: '<script>alert(1)</script>', repository: 'javascript:alert(1)' } }] });
  assert.doesNotMatch(el('reg-list').innerHTML, /<script>|<img|href="javascript:/);
  assert.match(el('reg-list').innerHTML, /&lt;script&gt;/);
});

test('copy uses the full SRID and reports a denied clipboard honestly', async () => {
  let copied;
  const success = await directory({ clipboard: { writeText: async value => { copied = value; } } });
  const button = { getAttribute: () => record.srid, previousElementSibling: { textContent: '' } };
  success('reg-list').click({ target: { closest: () => button } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(copied, record.srid);
  assert.match(success('reg-copy-status').textContent, /SRID copied/);
  const failure = await directory({ clipboard: { writeText: async () => { throw new Error('denied'); } } });
  failure('reg-list').click({ target: { closest: () => button } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(button.previousElementSibling.textContent, record.srid);
  assert.match(failure('reg-copy-status').textContent, /Could not copy automatically/);
});
