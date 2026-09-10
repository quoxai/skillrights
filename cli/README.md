# skillrights

A small command-line tool for declaring and verifying execution, training,
redistribution and commercial rights on AI agent skill files (for example
Anthropic's SKILL.md format). See the SkillRights specification for the
full reasoning behind the three licences.

This tool is MIT licensed. The SkillRights licences it applies to your
skills are not: they are separate legal texts, version 1.0, and their
identifiers are documented in `SPEC.md`.

Licence texts are version 1.0, produced through adversarial multi-model
AI review (see `legal/RECONCILIATION.md` in the repository); not advice
from qualified counsel; professional review planned.

No telemetry, no accounts. Every command runs locally and offline against
files on disk (`posture` reads a bundled, dated snapshot rather than
fetching anything live), with one explicit exception: `register` sends
evidence (hash, signature, licence identifier, claimed author, and with
`--public` the skill's name and description) to the registry you name.
The skill's content never leaves your machine.

## Install

```
npm install -g skillrights
```

Requires Node.js 22 or later. Zero runtime dependencies.

## Commands

### `skillrights init [dir] [--license open|notrain|reserved] [--author "Name"] [--yes]`

Declares a licence for the skill in `dir` (default: current directory):

- Writes `LICENSES/LicenseRef-SkillRights-<Variant>-1.0.txt` with the
  bundled 1.0 licence text.
- If `SKILL.md` exists and has a YAML frontmatter block, sets its
  `license:` field to the matching identifier (and `author:` if
  `--author` was given), leaving every other frontmatter line and the
  rest of the file untouched. If `SKILL.md` has no frontmatter block, it
  is left unedited and you are told how to add the field by hand.
- If `README.md` exists, appends the one-line human/crawler-readable
  declaration, unless that exact line is already present.

Without `--license`/`--author`, and without `--yes`, `init` asks
interactively (default licence: `notrain`). With `--yes`, it proceeds
with the default and no author, non-interactively. Running `init` twice
with the same arguments changes nothing on the second run.

### `skillrights check [dir] [--format text|json]`

Checks that a SkillRights declaration exists and is internally
consistent: `SKILL.md` has a `license:` field with a known identifier,
the matching `LICENSES/*.txt` file exists, and its own `Identifier:` line
agrees with `SKILL.md`. Exits 0 and prints the findings on success, exits
1 with the specific problem(s) otherwise. `--format json` prints
`{"ok": bool, "findings": [...]}` instead.

### `skillrights explain [identifier]`

Plain-language summary of what a licence permits and reserves, on
execute/train/redistribute/commercial. Accepts a short variant name
(`open`, `notrain`, `reserved`) or a full identifier
(`LicenseRef-SkillRights-NoTrain-1.0`). With no argument, prints a table
comparing all three. Always ends with:

> A declaration is a dated statement of terms and non-consent. In the EU
> it supports a text-and-data-mining rights reservation. It is not a
> technical shield against scraping.

### `skillrights sign [dir] [--key ~/.ssh/id_ed25519]`

Hashes every tracked file under `dir` (excluding `.git`, `node_modules`,
and the manifest/signature files themselves) with SHA-256, builds a
manifest (`.skillrights.manifest.json`) recording each file's hash, the
manifest's own hash, the creation time, and the skill's `license`/
`author` fields if present, then signs the manifest file with
`ssh-keygen -Y sign` using your existing SSH key. If signing fails (no
key, no `ssh-keygen`, or the command errors), the manifest is still
written and the command says signing was skipped and why.

### `skillrights verify [dir] [--signers <allowed_signers_file>] [--identity <name>]`

Recomputes every file's hash and compares it against the manifest,
reporting per-file mismatches, missing files, and untracked new files. If
`--signers` is given and a `.sig` file exists, also runs
`ssh-keygen -Y verify` against it. The principal checked is `--identity`
if given, otherwise the `author` field recorded in the manifest at sign
time. Prints a clear PASS or FAIL summary and exits 0 or 1 accordingly.

Verification establishes that a holder of the corresponding key signed
the manifest. It does not by itself prove the signer's legal identity,
ownership of the work, or the date of signing.

### `skillrights register [dir] [--public] [--registry <url>] [--supersedes <sha256>] [--repository <url>]`

Signs (or re-signs) the skill, then registers its manifest hash in the
SkillRights Registry (default `https://registry.skillrights.org`), an
append-only transparency log with Merkle inclusion proofs and Ed25519
signed tree heads. Returns a permanent SRID and saves a portable receipt
(`.skillrights.receipt.json`) that is verified locally before it is
written. Private mode (the default) sends only evidence: hash, signature,
licence, claimed author. `--public` additionally sends the frontmatter
name and description for the public directory. A registration establishes
that this exact artefact existed by this time and that your key claimed
and signed it. It does not prove legal ownership, authorship, or
originality.

### `skillrights receipt [dir]`

Verifies a saved receipt fully offline: recomputes the record's leaf hash,
walks the inclusion proof to the tree head root, and checks the tree head
signature against the bundled log key. Works even if the registry is
unreachable or gone; to confirm authenticity online, compare the printed
log key id against `GET /api/v1/log/key`.

### `skillrights posture`

Prints the bundled dataset of AI provider model-training defaults
(consumer vs. commercial tiers, toggles, retention, verification dates
and method) as a table, plus the relevant EU/US legal context. Never
makes a network call: the data is a dated snapshot bundled with the
package. Always ends with a reminder to confirm against the primary
sources linked in the data.

## Licence texts

The three bundled licence texts (`licenses/SkillRights-Open-1.0.txt`,
`licenses/SkillRights-NoTrain-1.0.txt`,
`licenses/SkillRights-Reserved-1.0.txt`) are byte-identical copies of the
final 1.0 texts published alongside the SkillRights specification.

## Development

```
node --test test/
```

No build step. No dependencies to install.
