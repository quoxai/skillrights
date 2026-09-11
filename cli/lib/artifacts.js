/**
 * The artifacts this CLI writes INTO a skill directory.
 *
 * They live here, in one place, because sign and verify must agree exactly.
 * Sign excludes them from the hashed file set; verify excludes them from the
 * added-files check. If the two lists ever drifted, a skill that was signed
 * and then registered (which drops a receipt beside the manifest) would fail
 * its own verification, and a false failure teaches people to ignore the tool.
 *
 * Directories are handled separately, in walkFiles: `.git` and `node_modules`
 * are never walked at either end.
 */
export const MANIFEST_NAME = '.skillrights.manifest.json';
export const SIG_NAME = `${MANIFEST_NAME}.sig`;
export const RECEIPT_NAME = '.skillrights.receipt.json';

export const TOOL_ARTIFACTS = new Set([MANIFEST_NAME, SIG_NAME, RECEIPT_NAME]);

/** A fresh copy, so a caller cannot mutate the shared set by accident. */
export function toolArtifactNames() {
  return new Set(TOOL_ARTIFACTS);
}
