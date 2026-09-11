# SkillRights machine-readable licence profile

`skillrights-profile-1.0.json` is a machine-readable **summary** of the
three SkillRights 1.0 licence texts (`spec/licenses/*.txt`), for tooling
that wants to make a decision about a licence without parsing prose:
installers, marketplaces, policy engines, training-data pipelines, audits.

## The text governs, always

The named licence texts stay the authoring interface. Each licence's
canonical text, at its canonical URL and in `spec/licenses/*.txt`, is the
only source of legal meaning. The profile:

- never claims a permission, condition, or boundary that the text does not
  state;
- marks a question `unresolved` rather than picking a reading, wherever the
  text (or the independent legal reviews in `legal/`) leaves it open;
- carries a `sha256` of each source text (`sourceTexts` in the JSON) so a
  consumer can confirm it is reading the profile for the text it thinks it
  is reading.

If the profile and a licence text ever disagree, the text wins. That is not
a hedge; it is the whole design. A summary that could silently drift ahead
of the text it summarises would be worse than no summary.

## What is in it

Per licence (keyed by the full `LicenseRef-SkillRights-<Name>-1.0`
identifier from `cli/lib/identifiers.js`):

- **permissions**: `execute`, `train`, `redistribute`, `commercial`, each
  with a `value` from the fixed enum `allowed | reserved |
  authorised-recipients | by-agreement`, plus the licence section it comes
  from.
- **conditions**: `attribution`, `noticesPreservation`,
  `licenceTextMustAccompany`, `shareAlikeOnModifications`,
  `internalBusinessPurposesOnly`, `noThirdPartyBenefit` (Reserved also
  carries `confidentiality`, because section 4 of that text is a real,
  separate obligation), each with `applies: true/false` and the section it
  comes from.
- **boundaries**: the shared retrieval/training line from `SPEC.md`
  (`retrievalAtInference: "execution"`, `corpusForModelImprovement:
  "training"`), restated per licence with any licence-specific caveat.
- **unresolved**: the open questions already sent to counsel
  (`legal/COUNSEL_BRIEF.md`) that this profile refuses to resolve on its
  own, each with the exact section, a plain description, and a source
  citation. Non-empty for NoTrain and Reserved, because they genuinely have
  open questions the Open licence does not.

`generalLimitations` at the document level holds the handful of questions
that cut across all three licences (for example, that no SkillRights
licence can restrain use of unprotectable methodology once separated from
protected expression) rather than duplicating them into every licence
entry.

## Versioning promise

- `profileVersion` follows semver independently of the licence texts'
  own `1.0`.
- A profile **patch** release (`1.0.x`) may only *clarify* how the profile
  describes the existing 1.0 texts: fixing a wrong section citation, adding
  a missing `unresolved` entry once a new ambiguity is documented, improving
  a description's wording. A patch release can never change what a
  permission or condition value *is* for a given licence, because that
  would silently change the licence's meaning without a new licence
  version, which `SPEC.md`'s "Versioning" section forbids.
- If a licence's actual terms change, that is a new licence version
  (`1.1`, `2.0`, ...) with its own identifier, per `SPEC.md`. Only then does
  the profile gain a new top-level licence entry, or a new
  `skillrights-profile-2.0.json` file if the schema itself needs to change.
  The `1.0.0` texts referenced by this profile are immutable; so is what
  this profile says about them, beyond patch-level clarification.
- Consumers should pin to a `profileVersion`, the same way they pin to a
  licence identifier.

## Worked example: an installer consuming it

An installer that fetches an agent skill and wants to refuse silently
enrolling it in a training pipeline can read the frontmatter `license:`
field to get the identifier, then look the identifier up in the profile
instead of parsing the licence prose itself:

```js
import fs from 'node:fs';

const profile = JSON.parse(
  fs.readFileSync('spec/profile/skillrights-profile-1.0.json', 'utf8')
);

function canTrainOn(identifier) {
  const licence = profile.licences[identifier];
  if (!licence) {
    // Unknown identifier: not a SkillRights 1.0 licence this profile
    // covers. Do not assume permission either way; fall back to the
    // installer's own default policy for undeclared or unrecognised
    // licences.
    return 'unknown';
  }
  return licence.permissions.train.value; // "allowed" | "reserved"
}

const identifier = 'LicenseRef-SkillRights-NoTrain-1.0';
if (canTrainOn(identifier) !== 'allowed') {
  // Exclude this skill from the training corpus. The installer still
  // shows the human operator licence.unresolved for NoTrain, because a
  // "reserved" value here is a summary of a reservation that itself has
  // open questions (see unresolved[]), not a guaranteed legal outcome.
  console.log('excluded from training corpus:', identifier);
}
```

The installer never needs to know the licence prose changed a word; it
reads `permissions.train.value`. If the installer wants to surface the
honest caveats too (for a compliance report, say), it walks
`licence.unresolved` and `profile.generalLimitations` the same way.
