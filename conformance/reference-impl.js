#!/usr/bin/env node
// Reference conformance implementation.
//
// Wraps this repository's own parser (cli/lib/skillfile.js, frontmatter.js,
// identifiers.js, check.js's findLicenseText) directly: no logic here is
// reimplemented, only reshaped into the actual.json contract documented in
// conformance/INTEGRATION.md. This file is itself a valid "implementation
// under test" per that contract: it reads a directory path on stdin and
// writes one JSON object to stdout.
//
// Machine finding codes (see INTEGRATION.md for the full table):
//   OK, NO_SKILL_MD, NO_FRONTMATTER, NO_LICENSE_FIELD,
//   DUPLICATE_LICENSE_FIELD, UNKNOWN_VARIANT, LICENSE_TEXT_MISSING,
//   LICENSE_TEXT_EMPTY, LICENSE_TEXT_NO_IDENTIFIER_LINE,
//   LICENSE_TEXT_IDENTIFIER_MISMATCH.

import fs from 'node:fs';
import path from 'node:path';
import { readSkillFrontmatter } from '../cli/lib/skillfile.js';
import { countField } from '../cli/lib/frontmatter.js';
import { variantFromIdentifier, licenseFileName } from '../cli/lib/identifiers.js';
import { findLicenseText } from '../cli/lib/check.js';

const IDENTIFIER_LINE_RE = /^Identifier:\s*(\S+)/m;

/**
 * Evaluates one skill directory against the SkillRights declaration and
 * decision model. Pure function of the filesystem at `dir`: no network, no
 * mutation, no timestamps in the output.
 *
 * @param {string} dir absolute path to the directory containing SKILL.md
 * @returns {{declaration: object, findings: string[], decision: object}}
 */
export function evaluate(dir) {
  const declaration = { present: false, identifier: null, variant: null };
  const findings = [];

  const skill = readSkillFrontmatter(dir);

  if (!skill.exists) {
    findings.push('NO_SKILL_MD');
  } else if (!skill.hasFrontmatter) {
    findings.push('NO_FRONTMATTER');
  } else if (countField(skill.parsed, 'license') > 1) {
    // Never resolve an ambiguous declaration by taking the first line: two
    // "license" lines means the author's intent cannot be attributed to
    // either one, so no declaration is present at all.
    findings.push('DUPLICATE_LICENSE_FIELD');
  } else if (!skill.license) {
    findings.push('NO_LICENSE_FIELD');
  } else {
    declaration.present = true;
    declaration.identifier = skill.license;
    const variant = variantFromIdentifier(skill.license);
    declaration.variant = variant;

    if (!variant) {
      // A LicenseRef- identifier this implementation does not recognise.
      // Per SPDX convention this is still a declaration, just an unknown
      // one: it passes through rather than being reported as absent.
      findings.push('UNKNOWN_VARIANT');
    } else {
      const found = findLicenseText(dir, licenseFileName(variant));
      if (found.text === null) {
        findings.push('LICENSE_TEXT_MISSING');
      } else if (found.text.trim().length === 0) {
        findings.push('LICENSE_TEXT_EMPTY');
      } else {
        const match = IDENTIFIER_LINE_RE.exec(found.text);
        if (!match) {
          findings.push('LICENSE_TEXT_NO_IDENTIFIER_LINE');
        } else if (match[1] !== skill.license) {
          findings.push('LICENSE_TEXT_IDENTIFIER_MISMATCH');
        } else {
          findings.push('OK');
        }
      }
    }
  }

  return { declaration, findings, decision: decisionFor(declaration) };
}

/**
 * The decision model: what each of the three installer policies from
 * quox-dashboard's evaluateDistributionPolicy() (skillPackInstaller.js)
 * resolves to for this declaration. See INTEGRATION.md for the mapping.
 */
export function decisionFor(declaration) {
  const isReservedVariant = declaration.present && declaration.variant === 'reserved';
  return {
    allow: true,
    'require-declaration': declaration.present,
    'respect-reserved': !isReservedVariant,
  };
}

function readStdinPath() {
  const raw = fs.readFileSync(0, 'utf8');
  return raw.trim();
}

// Only run as a CLI entry point when invoked directly (`node reference-impl.js`
// or piped a path on stdin), not when imported by the test suite.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const target = path.resolve(readStdinPath());
  const result = evaluate(target);
  process.stdout.write(JSON.stringify(result));
}
