import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { VARIANT_KEYS, isKnownVariant, licenseFileName } from './identifiers.js';
import { readEmbeddedLicenseText } from './embedded.js';
import { fileExists, dirExists, readFileIfExists } from './fsutil.js';
import { skillMdPath, readSkillFrontmatter } from './skillfile.js';
import { setField } from './frontmatter.js';
import { headerLineFor } from './oneliners.js';

function ask(question, defaultValue) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    const suffix = defaultValue ? ` [${defaultValue}]` : '';
    rl.question(`${question}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function resolveOptions(flags) {
  let variant = typeof flags.license === 'string' ? flags.license : undefined;
  let author = typeof flags.author === 'string' ? flags.author : undefined;

  if (variant !== undefined && !isKnownVariant(variant)) {
    throw new Error(`Unknown licence variant "${variant}". Use one of: ${VARIANT_KEYS.join(', ')}.`);
  }

  if (!flags.yes) {
    if (variant === undefined) {
      const answer = await ask('Licence variant (open, notrain, reserved)', 'notrain');
      variant = answer || 'notrain';
      if (!isKnownVariant(variant)) {
        throw new Error(`Unknown licence variant "${variant}". Use one of: ${VARIANT_KEYS.join(', ')}.`);
      }
    }
    if (author === undefined) {
      author = await ask('Author name (optional, for attribution)', '');
    }
  } else {
    if (variant === undefined) variant = 'notrain';
    if (author === undefined) author = '';
  }

  return { variant, author };
}

export async function runInit(positional, flags) {
  const dir = path.resolve(positional[0] || '.');
  const { variant, author } = await resolveOptions(flags);
  const messages = [];

  fs.mkdirSync(dir, { recursive: true });

  // 1. LICENSES/LicenseRef-SkillRights-<Variant>-1.0.txt
  const licensesDir = path.join(dir, 'LICENSES');
  fs.mkdirSync(licensesDir, { recursive: true });
  const licenseText = readEmbeddedLicenseText(variant);
  const licenseFilePath = path.join(licensesDir, licenseFileName(variant));
  const existingLicenseText = readFileIfExists(licenseFilePath);
  if (existingLicenseText === licenseText) {
    messages.push(`LICENSES/${licenseFileName(variant)} already up to date.`);
  } else {
    fs.writeFileSync(licenseFilePath, licenseText);
    messages.push(`Wrote LICENSES/${licenseFileName(variant)}.`);
  }

  // 2. SKILL.md frontmatter: license (and author, if given)
  const skillPath = skillMdPath(dir);
  if (!fileExists(skillPath)) {
    messages.push('No SKILL.md found; skipping frontmatter update.');
  } else {
    const before = readSkillFrontmatter(dir);
    if (!before.hasFrontmatter) {
      messages.push(
        'SKILL.md has no YAML frontmatter block (no leading "---" ... "---"); left untouched. ' +
          `Add a "license: ${licenseFileName(variant).replace(/\.txt$/, '')}" line to its frontmatter by hand.`
      );
    } else {
      let content = before.content;
      const identifier = licenseFileName(variant).replace(/\.txt$/, '');
      const changedLicense = before.license !== identifier;
      if (changedLicense) {
        content = setField(content, 'license', identifier);
      }
      let changedAuthor = false;
      if (author) {
        changedAuthor = before.author !== author;
        if (changedAuthor) {
          content = setField(content, 'author', author);
        }
      }
      if (changedLicense || changedAuthor) {
        fs.writeFileSync(skillPath, content);
        messages.push(`Updated SKILL.md frontmatter (license: ${identifier}${changedAuthor ? `, author: ${author}` : ''}).`);
      } else {
        messages.push('SKILL.md frontmatter already up to date.');
      }
    }
  }

  // 3. README.md header line
  const readmePath = path.join(dir, 'README.md');
  if (!fileExists(readmePath)) {
    messages.push('No README.md found; skipping header line.');
  } else {
    const readme = fs.readFileSync(readmePath, 'utf8');
    const headerLine = headerLineFor(variant, variant);
    const alreadyPresent = readme.split(/\r\n|\n/).some((line) => line.trim() === headerLine);
    if (alreadyPresent) {
      messages.push('README.md already has the SkillRights header line.');
    } else {
      const separator = readme.endsWith('\n') ? '' : '\n';
      fs.writeFileSync(readmePath, `${readme}${separator}\n${headerLine}\n`);
      messages.push('Appended the SkillRights header line to README.md.');
    }
  }

  return {
    dir,
    variant,
    identifier: licenseFileName(variant).replace(/\.txt$/, ''),
    messages,
  };
}
