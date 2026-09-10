// The one-line, human-and-crawler-readable declaration text described in
// SPEC.md ("The declaration"), keyed by licence variant.

export const ONE_LINERS = {
  open: 'AI execution, modification and training permitted. Attribution required on redistribution.',
  notrain: 'AI execution permitted. Model training rights reserved.',
  reserved: 'Execution limited to authorised recipients. Model training and redistribution rights reserved.',
};

export function headerLineFor(variant, urlSlug) {
  const label = { open: 'Open', notrain: 'NoTrain', reserved: 'Reserved' }[variant];
  return `SkillRights-${label}-1.0: ${ONE_LINERS[variant]} https://skillrights.org/${urlSlug}/1.0`;
}
