import path from 'node:path';
import fs from 'node:fs';
import { readSkillFrontmatter, skillMdPath } from './skillfile.js';
import { countField } from './frontmatter.js';
import { variantFromIdentifier, licenseFileName } from './identifiers.js';
import { fileExists, readFileIfExists } from './fsutil.js';

// The licence text may live beside the skill or at the root of a catalog
// that ships many skills under one LICENSES/ directory, so the search walks
// upwards. It is BOUNDED (Codex review, 2026-09-11): an unbounded walk
// reached the filesystem root and could adopt a licence from outside the
// package entirely, which is also outside the directory `sign` covers.
// The walk stops at the first directory holding a .git (the package
// boundary), or after this many levels, whichever comes first.
export const MAX_LICENSE_WALK_LEVELS = 8;

// Marker that means "this is the top of the package". Kept as a list so a
// second marker can be added without changing the walk.
const BOUNDARY_MARKERS = ['.git'];

function isBoundary(dir) {
  return BOUNDARY_MARKERS.some((marker) => fs.existsSync(path.join(dir, marker)));
}

/** Nearest LICENSES/<file> at or above `dir`, within the package boundary.
 *  Returns { text, levels, stoppedAt } where text is null if not found. */
export function findLicenseText(dir, fileName) {
  let levels = 0;
  let cur = dir;
  for (;;) {
    const text = readFileIfExists(path.join(cur, 'LICENSES', fileName));
    if (text !== null) return { text, levels, stoppedAt: null };
    if (isBoundary(cur)) return { text: null, levels, stoppedAt: 'package boundary' };
    const parent = path.dirname(cur);
    if (parent === cur) return { text: null, levels, stoppedAt: 'filesystem root' };
    if (levels >= MAX_LICENSE_WALK_LEVELS) return { text: null, levels, stoppedAt: `${MAX_LICENSE_WALK_LEVELS}-level limit` };
    cur = parent;
    levels += 1;
  }
}

export function runCheck(positional) {
  const dir = path.resolve(positional[0] || '.');
  const findings = [];
  let ok = true;
  let identifier = null;

  const skill = readSkillFrontmatter(dir);
  if (!skill.exists) {
    findings.push(`No SKILL.md found at ${skillMdPath(dir)}.`);
    ok = false;
  } else if (!skill.hasFrontmatter) {
    findings.push('SKILL.md has no YAML frontmatter block (expected a leading "---" ... "---").');
    ok = false;
  } else if (!skill.license) {
    findings.push('SKILL.md frontmatter has no "license" field.');
    ok = false;
  } else if (countField(skill.parsed, 'license') > 1) {
    // Never resolve an ambiguous declaration by taking the first line.
    findings.push(
      `SKILL.md frontmatter declares "license" ${countField(skill.parsed, 'license')} times. A skill states its rights once; remove the duplicates and re-run.`
    );
    ok = false;
  } else {
    identifier = skill.license;
    const variant = variantFromIdentifier(identifier);
    if (!variant) {
      findings.push(`Unknown or invalid licence identifier "${identifier}" in SKILL.md frontmatter.`);
      ok = false;
    } else {
      // The licence text may live beside the skill OR in an ancestor
      // directory: a catalog that ships many skills under one root keeps a
      // single LICENSES/ at that root (same shape as repo-root LICENSES/ in
      // the SPDX LicenseRef convention). Nearest ancestor wins, within the
      // package the skill belongs to.
      const found = findLicenseText(dir, licenseFileName(variant));
      const licenseText = found.text;
      if (licenseText === null) {
        findings.push(
          `Missing licence text: LICENSES/${licenseFileName(variant)} (looked beside the skill and in ${found.levels} ancestor director${found.levels === 1 ? 'y' : 'ies'}, stopping at the ${found.stoppedAt}).`
        );
        ok = false;
      } else if (licenseText.trim().length === 0) {
        findings.push(`Licence text is empty: LICENSES/${licenseFileName(variant)}.`);
        ok = false;
      } else {
        const match = /^Identifier:\s*(\S+)/m.exec(licenseText);
        if (!match) {
          findings.push(`LICENSES/${licenseFileName(variant)} has no "Identifier:" line.`);
          ok = false;
        } else if (match[1] !== identifier) {
          findings.push(
            `Identifier mismatch: SKILL.md declares "${identifier}" but LICENSES/${licenseFileName(variant)} declares "${match[1]}".`
          );
          ok = false;
        }
      }
    }
  }

  if (ok) {
    findings.push(`SkillRights declaration OK: ${identifier}.`);
  }

  return { ok, findings, dir, identifier };
}
