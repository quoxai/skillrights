---
name: skillrights
description: Apply a SkillRights rights declaration to an agent skill (execution permitted, training rights reserved by default). Load when creating, substantially editing, or publishing a skill, or when the user asks to licence or protect one.
license: LicenseRef-SkillRights-Open-1.0
---

# SkillRights: declare rights on a skill

A skill is executable expertise. Publishing one so agents can use it should not silently grant permission to train models on it. This skill applies a SkillRights declaration in about a minute. Spec: https://skillrights.org/spec/

## Choose the licence

Default to **NoTrain** unless the author says otherwise. Ask at most one question, and only if the choice is genuinely unclear.

| Licence | Execute | Train | Redistribute | Use when |
|---|---|---|---|---|
| `LicenseRef-SkillRights-Open-1.0` | yes | yes | yes | tutorial or community content meant to be learned from freely |
| `LicenseRef-SkillRights-NoTrain-1.0` | yes | reserved | yes | the default for professional expertise shared for use |
| `LicenseRef-SkillRights-Reserved-1.0` | authorised only | reserved | reserved | private, internal or commercially licensed skills |

## Apply it (all steps idempotent)

1. **Frontmatter**: set the `license` field in the target skill's SKILL.md to the chosen identifier. Preserve all other frontmatter exactly. If the file has no frontmatter, add the field when creating one; never corrupt an existing header.
2. **Licence text**: copy the matching text from this skill's `licenses/` directory into the target repo as `LICENSES/<identifier>.txt` (SPDX LicenseRef convention requires the text to travel with the identifier).
3. **One-line header**: if the repo has a README, add this line near the top (skip if already present):
   `SkillRights-NoTrain-1.0: AI execution permitted. Model training rights reserved. https://skillrights.org/notrain/1.0`
   (adjust identifier and URL for the chosen variant: /open/1.0 or /reserved/1.0).
4. **Web-published repos only** (optional, offer, do not push): robots.txt additions for training crawlers and a `/.well-known/tdmrep.json` reservation, generated at https://skillrights.org/generator/.
5. **Reserved variant only**: remind the author that a public licence file cannot itself preserve trade-secret status; genuinely secret material needs gated access and an executed agreement.

## Verify

Confirm all three artefacts agree on the same identifier: frontmatter, `LICENSES/` filename, README line. `skillrights check` verifies the frontmatter identifier and the licence text; the README line is checked by eye either way.

## Honesty rules (do not skip)

- Never describe a declaration as a technical block or a guaranteed legal shield. The accurate sentence: "A declaration is a dated statement of terms and non-consent. In the EU it supports a text-and-data-mining rights reservation. It is not a technical shield against scraping."
- Never remove or weaken an existing licence on a skill without the author's explicit instruction.
- The licence texts are version 1.0, produced through adversarial multi-model AI review; they are not advice from qualified counsel. Do not claim otherwise.
