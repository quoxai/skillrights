import { VARIANT_KEYS, identifierFor, variantFromIdentifier } from './identifiers.js';

export const ENFORCEMENT_CAVEAT =
  'A declaration is a dated statement of terms and non-consent. In the EU it supports ' +
  'a text-and-data-mining rights reservation. It is not a technical shield against scraping.';

const SUMMARIES = {
  open: {
    execute: 'Yes, by anyone, including in commercial settings.',
    train: 'Yes. Training, fine-tuning and distillation are permitted.',
    redistribute: 'Yes, in original or modified form, with attribution retained.',
    commercial: 'Yes, without restriction.',
    prose:
      'This licence is a full grant: use it, learn from it, build on it, sell what you build. ' +
      'The only condition is that redistribution keeps the stated author and licence identifier attached.',
  },
  notrain: {
    execute: 'Yes, by a human or an AI agent acting for one, including in commercial settings.',
    train: 'No. Training rights are expressly reserved; this includes fine-tuning, distillation and building a training or embedding corpus from it.',
    redistribute: 'Yes, in original or modified form, with attribution retained.',
    commercial: 'Yes for execution; not for training.',
    prose:
      'Agents may read, load and act on this work at inference time, including retrieval. ' +
      'Nobody may use it to improve a model. That reservation is stated in machine-readable form ' +
      'for the purposes of the EU DSM Directive Article 4(3).',
  },
  reserved: {
    execute: 'Only by recipients the owner has specifically authorised.',
    train: 'No. Training rights are expressly reserved, on the same terms as the NoTrain licence.',
    redistribute: 'No. Redistribution outside authorised recipients is expressly reserved.',
    commercial: 'Only by separate written agreement with the licensor.',
    prose:
      'This is the closed variant: private, internal or commercially licensed skills where the owner ' +
      'wants to name exactly who may use the work at all, and reserve everything else.',
  },
};

function formatOne(variant) {
  const s = SUMMARIES[variant];
  const identifier = identifierFor(variant);
  const lines = [
    `${identifier}`,
    '',
    s.prose,
    '',
    `  Execute:      ${s.execute}`,
    `  Train:        ${s.train}`,
    `  Redistribute: ${s.redistribute}`,
    `  Commercial:   ${s.commercial}`,
  ];
  return lines.join('\n');
}

function formatTable() {
  const header = ['Licence', 'Execute', 'Train', 'Redistribute', 'Commercial'];
  const rows = [
    ['SkillRights-Open-1.0', 'yes', 'yes', 'yes (attribution)', 'yes'],
    ['SkillRights-NoTrain-1.0', 'yes', 'reserved', 'yes (attribution)', 'yes'],
    ['SkillRights-Reserved-1.0', 'authorised only', 'reserved', 'reserved', 'by agreement'],
  ];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const formatRow = (row) => row.map((cell, i) => cell.padEnd(widths[i])).join('  ');
  return [formatRow(header), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(formatRow)].join('\n');
}

export function explain(identifierOrVariant) {
  if (!identifierOrVariant) {
    return `${formatTable()}\n\n${ENFORCEMENT_CAVEAT}`;
  }
  let variant = VARIANT_KEYS.includes(identifierOrVariant)
    ? identifierOrVariant
    : variantFromIdentifier(identifierOrVariant);
  if (!variant) {
    throw new Error(
      `Unknown identifier "${identifierOrVariant}". Use one of: ${VARIANT_KEYS.join(', ')}, ` +
        `or a full identifier such as LicenseRef-SkillRights-NoTrain-1.0.`
    );
  }
  return `${formatOne(variant)}\n\n${ENFORCEMENT_CAVEAT}`;
}
