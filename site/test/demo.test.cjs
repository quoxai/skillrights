const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const page = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../assets/demo.js'), 'utf8');

// Parse the actual HTML into a tree with the Python standard library, available
// on the Ubuntu CI runner, without adding npm or browser dependencies.
function parseHTML(filename) {
  const scratch = fs.mkdtempSync(path.join(__dirname, '.demo-dom-'));
  const output = path.join(scratch, 'document.json');
  const descriptor = fs.openSync(output, 'w');
  try {
    const parsed = spawnSync('python3', ['-c', `
import json, sys
from html.parser import HTMLParser
class Document(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = {'tag': '#document', 'attrs': {}, 'children': [], 'textContent': ''}
        self.stack = [self.root]
    def handle_starttag(self, tag, attrs):
        node = {'tag': tag, 'attrs': dict(attrs), 'children': [], 'textContent': ''}
        self.stack[-1]['children'].append(node)
        if tag not in {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}:
            self.stack.append(node)
    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index]['tag'] == tag:
                del self.stack[index:]
                break
    def handle_data(self, data):
        for node in self.stack:
            node['textContent'] += data
doc = Document()
with open(sys.argv[1], encoding='utf8') as source:
    doc.feed(source.read())
print(json.dumps(doc.root))
`, filename], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', descriptor, 'pipe'] });
    assert.equal(parsed.status, 0, parsed.stderr || String(parsed.error));
    return JSON.parse(fs.readFileSync(output, 'utf8'));
  } finally {
    fs.closeSync(descriptor);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function descendants(node) {
  return node.children.flatMap(child => [child, ...descendants(child)]);
}
const tree = parseHTML(path.join(__dirname, '../index.html'));
const elements = descendants(tree);
const byId = id => elements.find(node => node.attrs.id === id);
const has = (node, name) => Object.hasOwn(node.attrs, name);
const steps = elements.filter(node => has(node, 'data-demo-step'));

const initOutput = `SkillRights init: cluster-doctor
Licence: LicenseRef-SkillRights-NoTrain-1.0
- Wrote LICENSES/LicenseRef-SkillRights-NoTrain-1.0.txt.
- Updated SKILL.md frontmatter (license: LicenseRef-SkillRights-NoTrain-1.0).`;
const honesty = 'This proves that this exact artefact existed at this time, and records the claim you submitted with it. It does not prove legal ownership, authorship or originality.';
const registerOutput = `Registered: sr:skill:01M29JZG0BRGAP2G3NC6X5501R
Hash:       sha256:625885acb87f2810551f9efdfac0ca11bfed62f8a2ac016a8bad611a517adb99
Mode:       public
Signed:     yes
Signature:  signature verified by registry (signed the registered hash with your ed25519 SSH key)
Receipt:    .skillrights.receipt.json (verified before saving)
${honesty}`;

test('homepage contains four labelled steps, all visible without JavaScript', () => {
  assert.equal(steps.length, 4);
  assert.deepEqual(steps.map(step => step.attrs.id), ['demo-step-1', 'demo-step-2', 'demo-step-3', 'demo-step-4']);
  for (const step of steps) {
    assert.ok(!has(step, 'hidden'));
    assert.ok(byId(step.attrs['aria-labelledby']).textContent.trim());
    assert.ok(!descendants(step).some(node => has(node, 'hidden')));
  }
  assert.ok(elements.filter(node => has(node, 'data-demo-controls')).every(node => has(node, 'hidden')));
  const ids = elements.filter(node => node.attrs.id).map(node => node.attrs.id);
  assert.equal(new Set(ids).size, ids.length, 'hash targets must be unique');
  const demo = elements.find(node => has(node, 'data-demo'));
  const ancestors = elements.filter(node => descendants(node).includes(demo));
  assert.ok([demo, ...ancestors].every(node => !has(node, 'hidden')));
});

test('captured commands, outputs and both honesty sentences remain verbatim', () => {
  assert.equal(byId('demo-init-output').textContent, initOutput);
  assert.equal(byId('demo-register-output').textContent, registerOutput);
  assert.ok(steps[1].textContent.includes('$ npx skillrights init --license notrain --yes'));
  assert.ok(steps[2].textContent.includes('$ npx skillrights register --public'));
  assert.ok(steps[2].textContent.includes(honesty));
  assert.doesNotMatch(byId('demo-before').textContent, /license:/);
  assert.match(byId('out-frontmatter').textContent, /license: LicenseRef-SkillRights-NoTrain-1\.0/);
  const added = descendants(steps[1]).find(node => node.tag === 'mark');
  assert.equal(added.textContent, 'license: LicenseRef-SkillRights-NoTrain-1.0');
  assert.ok(steps[1].textContent.includes('LICENSES/'));
});

test('declaration, consumers, existing honesty, and live directory links survive', () => {
  assert.ok(tree.textContent.includes('That is the whole declaration; about 20 tokens, loaded only when the skill is invoked.'));
  assert.ok(tree.textContent.includes('Distributing, interpreting and enforcing it are their own integrations (a public conformance suite covers the parsing and decision layer).'));
  assert.ok(tree.textContent.includes('Tested consumers today: the skillrights CLI and the QuoxSkills distribution pipeline (a public conformance suite covers both); marketplaces, crawlers and corpus filters are the prospective audience the format is designed for.'));
  assert.ok(byId('what-this-can-and-cannot-do'));
  assert.ok(descendants(steps[3]).some(node => node.attrs.href === 'https://skillrights.org/registry/'));
  assert.match(steps[3].textContent, /signature verified/);
  assert.match(steps[3].textContent, /witnessed/);
  assert.match(steps[3].textContent, /claimed/i);
  assert.match(steps[3].textContent, /Illustrative directory preview/);
  assert.match(steps[2].textContent, /registered artefact is the .*cluster-doctor example in the public repo/);
  assert.ok(descendants(steps[3]).some(node => node.tag === 'time' && node.attrs.datetime === '2026-09-11'));
  const registry = parseHTML(path.join(__dirname, '../registry/index.html'));
  assert.ok(descendants(registry).some(node => node.attrs.href === '/#how-it-works'));
  assert.doesNotMatch(page + script, /\u2014|&mdash;|&#(?:8212|x2014);/i);
});

// Bind the parsed elements to the small DOM surface used by the enhancement.
// Assertions below exercise navigation against the real homepage structure.
function walkthrough(hash = '') {
  const document = JSON.parse(JSON.stringify(tree));
  for (const node of [document, ...descendants(document)]) {
    node.id = node.attrs.id || '';
    node.hidden = has(node, 'hidden');
    node.events = {};
    node.querySelectorAll = selector => descendants(node).filter(child => has(child, selector.slice(1, -1)));
    node.querySelector = selector => node.querySelectorAll(selector)[0] || null;
    node.setAttribute = (name, value) => { node.attrs[name] = value; };
    node.removeAttribute = name => { delete node.attrs[name]; };
    node.addEventListener = (name, fn) => { node.events[name] = fn; };
  }
  const events = {};
  const window = {
    location: { hash },
    history: { pushState(_state, _unused, hash) { window.location.hash = hash; } },
    addEventListener(name, fn) { events[name] = fn; },
  };
  vm.runInNewContext(script, { document, window });
  return { document, window, events, find: name => document.querySelector(`[data-demo-${name}]`), steps: document.querySelectorAll('[data-demo-step]') };
}

test('stepper supports Prev/Next, dots, boundary states, and one visible step', () => {
  const demo = walkthrough();
  const visible = () => demo.steps.filter(step => !step.hidden).map(step => step.id);
  assert.deepEqual(visible(), ['demo-step-1']);
  assert.equal(demo.find('controls').hidden, false);
  assert.equal(demo.find('prev').attrs['aria-disabled'], 'true');
  demo.find('prev').events.click();
  assert.deepEqual(visible(), ['demo-step-1']);
  demo.find('next').events.click();
  assert.deepEqual(visible(), ['demo-step-2']);
  assert.equal(demo.window.location.hash, '#demo-step-2');
  const dots = demo.document.querySelectorAll('[data-demo-go]');
  dots[3].events.click();
  assert.deepEqual(visible(), ['demo-step-4']);
  assert.equal(demo.find('next').attrs['aria-disabled'], 'true');
  demo.find('next').events.click();
  assert.deepEqual(visible(), ['demo-step-4']);
  demo.find('prev').events.click();
  assert.deepEqual(visible(), ['demo-step-3']);
  assert.equal(dots[2].attrs['aria-current'], 'step');
  assert.equal(dots.filter(dot => has(dot, 'aria-current')).length, 1);
  assert.equal(demo.find('status').textContent, 'Step 3 of 4');
});

test('direct hashes and browser history reveal the requested step without autoplay', () => {
  const demo = walkthrough('#demo-step-3');
  assert.equal(demo.steps[2].hidden, false);
  demo.window.location.hash = '#demo-step-4';
  demo.events.hashchange();
  assert.equal(demo.steps[3].hidden, false);
  demo.window.location.hash = '#demo-step-2';
  demo.events.popstate();
  assert.equal(demo.steps[1].hidden, false);
  demo.window.location.hash = '#how-it-works';
  demo.events.hashchange();
  assert.equal(demo.steps[0].hidden, false);
  assert.equal(walkthrough('#unrelated-section').steps[0].hidden, false);
  assert.doesNotMatch(script, /setInterval|setTimeout|requestAnimationFrame/);
  assert.doesNotThrow(() => vm.runInNewContext(script, { document: { querySelector: () => null } }));
});
