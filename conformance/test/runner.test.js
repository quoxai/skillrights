import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runConformance, listFixtures, DEFAULT_FIXTURES_DIR } from '../runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REFERENCE_IMPL = path.join(__dirname, '..', 'reference-impl.js');

test('fixtures directory is non-empty and covers the required scenarios', () => {
  const names = listFixtures(DEFAULT_FIXTURES_DIR);
  assert.ok(names.length >= 10, `expected at least 10 fixtures, found ${names.length}`);
  for (const name of names) {
    const expectedPath = path.join(DEFAULT_FIXTURES_DIR, name, 'expected.json');
    assert.ok(fs.existsSync(expectedPath), `${name} is missing expected.json`);
    const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
    assert.ok('declaration' in expected, `${name} expected.json missing "declaration"`);
    assert.ok('findings' in expected, `${name} expected.json missing "findings"`);
    assert.ok('decision' in expected, `${name} expected.json missing "decision"`);
    assert.ok(Array.isArray(expected.findings), `${name} "findings" must be an array`);
    for (const policy of ['allow', 'require-declaration', 'respect-reserved']) {
      assert.equal(
        typeof expected.decision[policy],
        'boolean',
        `${name} decision.${policy} must be a boolean`
      );
    }
  }
});

test('the reference implementation passes 100% of the conformance fixtures', () => {
  const { results, allPassed } = runConformance(REFERENCE_IMPL);
  if (!allPassed) {
    const failures = results.filter((r) => !r.pass).map((r) => `${r.name}: ${r.error}`);
    assert.fail(`reference implementation failed fixtures:\n${failures.join('\n')}`);
  }
  assert.equal(results.length, listFixtures(DEFAULT_FIXTURES_DIR).length);
});

test('the runner reports FAIL for an implementation that gets the decision wrong', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillrights-conformance-'));
  const brokenImplPath = path.join(dir, 'broken-impl.js');
  // A deliberately wrong implementation: always claims "undeclared", no
  // matter what it is handed. Proves the runner actually compares output
  // rather than trivially passing everything.
  fs.writeFileSync(
    brokenImplPath,
    `import fs from 'node:fs';\n` +
      `fs.readFileSync(0, 'utf8');\n` +
      `process.stdout.write(JSON.stringify({\n` +
      `  declaration: { present: false, identifier: null, variant: null },\n` +
      `  findings: ['NO_LICENSE_FIELD'],\n` +
      `  decision: { allow: true, 'require-declaration': false, 'respect-reserved': true }\n` +
      `}));\n`
  );

  const { results, allPassed } = runConformance(brokenImplPath);
  assert.equal(allPassed, false);
  const declaredPass = results.find((r) => r.name === '001-declared-notrain');
  assert.equal(declaredPass.pass, false);
  const undeclaredPass = results.find((r) => r.name === '004-undeclared');
  assert.equal(undeclaredPass.pass, true);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('the runner reports FAIL rather than crashing on non-JSON stdout', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillrights-conformance-'));
  const brokenImplPath = path.join(dir, 'not-json-impl.js');
  fs.writeFileSync(
    brokenImplPath,
    `import fs from 'node:fs';\n` +
      `fs.readFileSync(0, 'utf8');\n` +
      `process.stdout.write('not json at all');\n`
  );

  const { results, allPassed } = runConformance(brokenImplPath);
  assert.equal(allPassed, false);
  assert.ok(results.every((r) => r.pass === false));
  assert.ok(results[0].error.includes('not valid JSON'));

  fs.rmSync(dir, { recursive: true, force: true });
});
