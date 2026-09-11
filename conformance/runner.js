#!/usr/bin/env node
// Conformance runner.
//
// Runs an IMPLEMENTATION UNDER TEST against every fixture in
// conformance/fixtures/ and reports PASS/FAIL per fixture. See
// conformance/INTEGRATION.md for the full implementation contract; in
// short:
//
//   - The runner spawns the implementation as a child process (a .js file
//     is run with the current `node`; anything else is executed directly,
//     so it must be a chmod +x executable with its own shebang).
//   - The runner writes ONE line to the child's stdin: the absolute path
//     of the directory to evaluate (a SKILL.md's containing directory).
//   - The child writes ONE JSON object to stdout and exits 0:
//       { "declaration": {...}, "findings": [...], "decision": {...} }
//     (see a fixture's expected.json for the exact shape).
//
// CLI usage:
//   node conformance/runner.js <path-to-implementation> [--fixtures <dir>]
//
// Exits 0 only if every fixture passes; nonzero otherwise. Output is
// deterministic: fixtures run in sorted directory-name order, no
// timestamps, no wall-clock-dependent content.

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FIXTURES_DIR = path.join(__dirname, 'fixtures');

/** Lists fixture directories, sorted, each holding an expected.json. */
export function listFixtures(fixturesDir) {
  return fs
    .readdirSync(fixturesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function loadExpected(fixtureDir) {
  const raw = fs.readFileSync(path.join(fixtureDir, 'expected.json'), 'utf8');
  return JSON.parse(raw);
}

/**
 * Spawns `implPath` (node script or executable), feeds it `targetDir` on
 * stdin, and returns its parsed stdout JSON. Throws with a descriptive
 * message on a nonzero exit, a spawn error, or unparseable stdout, so a
 * broken implementation always shows up as a FAIL rather than a crash.
 */
export function invokeImplementation(implPath, targetDir) {
  const isJs = implPath.endsWith('.js');
  const command = isJs ? process.execPath : implPath;
  const args = isJs ? [implPath] : [];

  const result = spawnSync(command, args, {
    input: `${targetDir}\n`,
    encoding: 'utf8',
    timeout: 10000,
  });

  if (result.error) {
    throw new Error(`failed to run implementation: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `implementation exited ${result.status}: ${(result.stderr || '').trim() || '(no stderr)'}`
    );
  }

  const stdout = (result.stdout || '').trim();
  try {
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`implementation stdout was not valid JSON: ${stdout.slice(0, 200)}`);
  }
}

function expectedShape(expected) {
  // "input" is fixture metadata (which subdirectory to point the
  // implementation at), not part of the actual.json contract.
  const { declaration, findings, decision } = expected;
  return { declaration, findings, decision };
}

/**
 * Runs `implPath` against every fixture under `fixturesDir`. Returns
 * { results, allPassed } where results is an array of
 * { name, pass, error? } in sorted fixture order.
 */
export function runConformance(implPath, fixturesDir = DEFAULT_FIXTURES_DIR) {
  const names = listFixtures(fixturesDir);
  const results = [];

  for (const name of names) {
    const fixtureDir = path.join(fixturesDir, name);
    const expected = loadExpected(fixtureDir);
    const targetDir = path.resolve(fixtureDir, expected.input || '.');

    try {
      const actual = invokeImplementation(implPath, targetDir);
      assert.deepStrictEqual(actual, expectedShape(expected));
      results.push({ name, pass: true });
    } catch (err) {
      results.push({ name, pass: false, error: err.message });
    }
  }

  return { results, allPassed: results.every((r) => r.pass) };
}

function printReport(results) {
  const width = Math.max(...results.map((r) => r.name.length), 'FIXTURE'.length);
  console.log(`${'FIXTURE'.padEnd(width)}  RESULT`);
  for (const r of results) {
    console.log(`${r.name.padEnd(width)}  ${r.pass ? 'PASS' : 'FAIL'}`);
    if (!r.pass) console.log(`${' '.repeat(width)}  - ${r.error}`);
  }
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} fixtures passed.`);
}

function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const [implPath, ...rest] = process.argv.slice(2);
  if (!implPath) {
    console.error('Usage: node conformance/runner.js <path-to-implementation> [--fixtures <dir>]');
    process.exit(2);
  }
  let fixturesDir = DEFAULT_FIXTURES_DIR;
  const flagIndex = rest.indexOf('--fixtures');
  if (flagIndex !== -1 && rest[flagIndex + 1]) {
    fixturesDir = path.resolve(rest[flagIndex + 1]);
  }

  const { results, allPassed } = runConformance(path.resolve(implPath), fixturesDir);
  printReport(results);
  process.exit(allPassed ? 0 : 1);
}
