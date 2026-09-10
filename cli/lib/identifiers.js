// Licence variant identifiers, per SkillRights spec.
// Identifiers are immutable once published: see SPEC.md "Versioning".

export const VARIANT_LABELS = {
  open: 'Open',
  notrain: 'NoTrain',
  reserved: 'Reserved',
};

export const VARIANT_KEYS = Object.keys(VARIANT_LABELS);

const IDENTIFIER_RE = /^LicenseRef-SkillRights-(Open|NoTrain|Reserved)-1\.0$/;

export function isKnownVariant(variant) {
  return Object.prototype.hasOwnProperty.call(VARIANT_LABELS, variant);
}

export function identifierFor(variant) {
  const label = VARIANT_LABELS[variant];
  if (!label) {
    throw new Error(
      `Unknown licence variant "${variant}". Use one of: ${VARIANT_KEYS.join(', ')}.`
    );
  }
  return `LicenseRef-SkillRights-${label}-1.0`;
}

export function licenseFileName(variant) {
  return `${identifierFor(variant)}.txt`;
}

export function sourceFileName(variant) {
  const label = VARIANT_LABELS[variant];
  return `SkillRights-${label}-1.0-draft.txt`;
}

export function variantFromIdentifier(identifier) {
  const match = IDENTIFIER_RE.exec(identifier || '');
  if (!match) return null;
  const label = match[1];
  return VARIANT_KEYS.find((key) => VARIANT_LABELS[key] === label) || null;
}

export function isValidIdentifier(identifier) {
  return variantFromIdentifier(identifier) !== null;
}

export function urlSlugFor(variant) {
  return variant;
}
