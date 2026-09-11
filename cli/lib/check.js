import path from 'node:path';
import { readSkillFrontmatter, skillMdPath } from './skillfile.js';
import { variantFromIdentifier, licenseFileName } from './identifiers.js';
import { fileExists, readFileIfExists } from './fsutil.js';

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
      // the SPDX LicenseRef convention). Nearest ancestor wins; the walk
      // stops at the filesystem root.
      let licenseText = null;
      let searched = 0;
      for (let cur = dir; ; cur = path.dirname(cur)) {
        licenseText = readFileIfExists(path.join(cur, 'LICENSES', licenseFileName(variant)));
        searched += 1;
        if (licenseText !== null || path.dirname(cur) === cur) break;
      }
      if (licenseText === null) {
        findings.push(
          `Missing licence text: LICENSES/${licenseFileName(variant)} (looked beside the skill and in ${searched - 1} ancestor director${searched - 1 === 1 ? 'y' : 'ies'}).`
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
