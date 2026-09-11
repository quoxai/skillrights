# SkillRights conformance fixtures

This directory is for people building something OTHER than the `skillrights`
CLI that still needs to read a SkillRights declaration correctly: an
installer, a marketplace, a crawler, a training-data pipeline, a second
implementation of the CLI in another language. It answers one question:
"if I parse this SKILL.md the way the spec describes, do I get the same
answer the reference implementation gets?"

**What this certifies, and what it does not.** Passing this fixture set
certifies PARSING and DECISION conformance only: that an implementation
reads the declaration the same way the reference reader does, and reaches
the same allow/require-declaration/respect-reserved outcome. It does not
certify legal compliance, does not certify that a declaration is
enforceable, and does not certify anything about the licence texts
themselves. See spec/SPEC.md's "What this can and cannot do" section for
that boundary; nothing here changes it.

## The declaration, restated precisely

Per SPEC.md's "The declaration" section, the machine-readable declaration is
the `license:` field in a SKILL.md's leading YAML frontmatter block, and
ONLY that field. The companion plain-text line ("SkillRights-NoTrain-1.0:
AI execution permitted...") that the spec recommends adding to the file
body or README is for human readers, crawlers and corpus filters. It is
not a second, alternative place to look for the declaration: a file that
carries the companion line but no frontmatter `license:` field is
undeclared, exactly as if neither were present. Fixture
`010-body-line-only-declaration` exercises this directly.

## The implementation contract

An implementation under test is any executable or script that:

1. Reads one line from stdin: the absolute path of a directory (the
   directory containing a SKILL.md, not the SKILL.md file itself).
2. Writes exactly one JSON object to stdout and exits 0:

   ```json
   {
     "declaration": { "present": true, "identifier": "LicenseRef-SkillRights-NoTrain-1.0", "variant": "notrain" },
     "findings": ["OK"],
     "decision": { "allow": true, "require-declaration": true, "respect-reserved": true }
   }
   ```

`declaration.present` is whether a single, unambiguous `license:` value was
found in the frontmatter. `declaration.identifier` is that raw value
verbatim, or `null`. `declaration.variant` is one of `"open"`, `"notrain"`,
`"reserved"` when the identifier matches a known SkillRights 1.0 licence, or
`null` if it is absent, unparseable, or an unrecognised identifier
(including a well-formed but non-SkillRights `LicenseRef-` value).

`findings` is a non-empty array of machine codes, in the order the
reference implementation would produce them (this fixture set never
exercises more than one finding per fixture, but an implementation may
extend the array with additional codes it also detects, as long as the
codes below are present as documented per fixture):

| Code | Meaning |
|---|---|
| `OK` | Declaration present, known variant, licence text present and matching. |
| `NO_SKILL_MD` | No SKILL.md found at the target directory. |
| `NO_FRONTMATTER` | SKILL.md exists but has no valid leading `---`...`---` block (includes an unterminated block). |
| `NO_LICENSE_FIELD` | Frontmatter is valid but has no `license:` field. |
| `DUPLICATE_LICENSE_FIELD` | Frontmatter declares `license:` more than once. Ambiguous, treated as absent. |
| `UNKNOWN_VARIANT` | `license:` is present and non-empty but is not one of the three known `LicenseRef-SkillRights-{Open,NoTrain,Reserved}-1.0` identifiers. Includes a custom `LicenseRef-` value: per SPDX convention this is still a valid identifier shape, just one this implementation does not interpret further. |
| `LICENSE_TEXT_MISSING` | A known variant is declared but no `LICENSES/<identifier>.txt` was found beside the skill or in any ancestor directory. |
| `LICENSE_TEXT_EMPTY` | The licence text file exists but is empty or whitespace-only. |
| `LICENSE_TEXT_NO_IDENTIFIER_LINE` | The licence text has no `Identifier: ...` line. |
| `LICENSE_TEXT_IDENTIFIER_MISMATCH` | The licence text's `Identifier:` line names a different identifier than the frontmatter declares. |

The `LICENSES/` text search walks upward from the skill directory looking
for the nearest `LICENSES/<file>`, so a catalog of many skills can share one
`LICENSES/` at its root (fixture `008-ancestor-catalog-license`). It is
bounded: it stops at the first ancestor containing a `.git` directory (the
package boundary) or after 8 levels, whichever comes first, so it can never
adopt a licence text from an unrelated ancestor in repositories (the walk stops at a .git boundary; outside any repository the 8-level cap merely bounds the search, it does not establish a package boundary). See
`cli/lib/check.js`'s `findLicenseText()` for the reference implementation of
this walk, reused directly by `reference-impl.js` here.

## The decision model

`decision` maps the declaration onto the three install-time policies this
CLI's own downstream consumer implements today: `evaluateDistributionPolicy()`
in `quox-dashboard/services/collector/lib/skillPackInstaller.js`. Each
policy answers "does this declaration allow install to proceed", from the
perspective of an installer receiving this one skill file from outside its
own distribution boundary (the same posture that consumer takes for a
cross-org pack install):

- **`allow`**: the default policy. It never blocks. Every fixture in this
  set has `decision.allow: true`, including the Reserved and duplicate-field
  ones. This is deliberate and matches the consumer's own behaviour: an
  unrecognised or misconfigured policy value also resolves to `allow` there,
  so a bad setting can never brick a fleet. State plainly: a SkillRights
  declaration under `allow` is recorded, never enforced. Anyone reading
  `decision.allow: true` on a Reserved-declared skill should not conclude
  the declaration did nothing; it means this particular policy does not
  read it. **`allow` is never a technical block, and this repository never
  claims otherwise.**
- **`require-declaration`**: true only when `declaration.present` is true,
  by ANY identifier, known or unknown. This mirrors
  `skillPackInstaller.js`'s own `parseSkillLicense()`, which extracts the raw
  `license:` value without validating it against the three known variants:
  a skill declaring a custom `LicenseRef-` is "declared" for this policy's
  purposes even though its rights are uninterpretable
  (`005-unknown-custom-licenseref`). Undeclared, duplicate-field, and
  malformed-frontmatter fixtures all resolve to `false` here.
- **`respect-reserved`**: false only when `declaration.variant` is exactly
  `"reserved"`. This mirrors `RESERVED_LICENSE_PATTERN` in
  `skillPackInstaller.js`, which pattern-matches the literal string
  `skillrights-reserved` inside the declared licence value. An unknown
  custom identifier, even one containing the word "reserved" in some other
  form, does not trip this policy: it is not the recognised SkillRights
  Reserved licence.

One finding does NOT feed the decision model: `LICENSE_TEXT_MISSING` (and
its siblings `LICENSE_TEXT_EMPTY` / `LICENSE_TEXT_NO_IDENTIFIER_LINE` /
`LICENSE_TEXT_IDENTIFIER_MISMATCH`). `skillPackInstaller.js` never reads
`LICENSES/` at all; it reads only the frontmatter field. The `LICENSES/`
text is SPDX-style provenance for `skillrights check`/`verify` and for
human readers, not an input to the install-time decision
(`009-license-text-missing` has `decision.require-declaration: true`
despite the missing text).

## Running the runner

```bash
node conformance/runner.js conformance/reference-impl.js
```

Point it at any other implementation instead, JS or otherwise (a `.js` path
is run with the current `node`; anything else is executed directly and must
be its own chmod +x executable):

```bash
node conformance/runner.js /path/to/your/skillrights-reader
```

Exit code is 0 only if every fixture passes; nonzero otherwise, so it is
safe to wire into CI as a gate. This repository does exactly that in
`.github/workflows/check.yml`, alongside the CLI's own test suite.

## Honesty framing, restated

A SkillRights declaration is recorded and honoured by whichever install-time
policy an installer or marketplace chooses to enforce. It is never, by
itself, a technical block: nothing in this fixture set, the CLI, or the
specification prevents a party from reading a Reserved-declared skill file
and training on it anyway. What conformance testing buys is narrower and
real: that when an installer DOES choose to honour a declaration, it reads
the same declaration, the same way, that every other conformant
implementation reads it. Enforcement, where it exists, lives in contract
and platform policy, per spec/SPEC.md's "What this can and cannot do" and
"Companion signals" sections, not in the file format itself.

## What the specification leaves open (not invented here)

- The spec does not define machine finding codes; the table above is this
  fixture set's own vocabulary, not a spec requirement. Another conformant
  implementation may use different code names as long as its
  `declaration`/`decision` output matches.
- The spec does not define an install-time policy vocabulary at all;
  `allow` / `require-declaration` / `respect-reserved` are this repository's
  own downstream consumer's names, reused here because it is the only real
  consumer this fixture set has to anchor against. A different installer is
  free to define other policies over the same declaration.
- The spec does not say what a body-line-only file (companion line present,
  frontmatter field absent) means beyond "the declaration is the frontmatter
  field". This fixture set takes the narrowest reading (undeclared) rather
  than inventing a fallback-to-body-text behaviour the spec never
  describes.
- Whether an unknown custom `LicenseRef-` identifier should ever be
  resolvable to rights information (a lookup table, a second registry) is
  not addressed by the spec or this fixture set; it currently only reaches
  `UNKNOWN_VARIANT` and stops there.
