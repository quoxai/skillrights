# SkillRights Specification

**Specification version 0.2 (DRAFT, open for comment). Licence texts: version 1.0, final.** The 1.0 texts were produced through adversarial review by two independent AI reviewers at high reasoning effort (see the public reconciliation record in the repository); that is not advice from qualified counsel, and professional review remains planned. The superseded 1.0-draft texts stay published at their -draft URLs with recorded hashes. Do not treat this page as legal advice.

## What this is

SkillRights is a small, machine-readable way for the author of an AI agent skill to say what an AI system, and the people running one, may do with it. It separates four permissions that current licences blur together:

- **Execute**: an AI agent (or a human) may read and use the skill to perform work.
- **Train**: the skill's content may be used to train, fine-tune, distil, or derive training data for a machine-learning model.
- **Redistribute**: the skill may be copied, republished, or included in other collections.
- **Commercial**: the skill may be executed in commercial settings.

A skill is executable expertise: procedures, judgement and methodology written down so a machine can act on them. Publishing one so agents can use it should not silently grant permission to absorb it into a model. SkillRights makes that distinction explicit, in one line.

## The declaration

Agent skill files (for example Anthropic's SKILL.md format) already define an optional `license` frontmatter field. SkillRights uses it, unchanged:

```yaml
---
name: cluster-doctor
description: Diagnose failing clusters the way a 15-year SRE does.
license: LicenseRef-SkillRights-NoTrain-1.0
---
```

For human readers, crawlers and corpus filters, add one line near the top of the file body or README:

```
SkillRights-NoTrain-1.0: AI execution permitted. Model training rights reserved. https://skillrights.org/notrain/1.0
```

That is the whole integration. About 20 tokens, loaded only when the skill is invoked. No AI model needs to read legal prose for the declaration to work: installers, marketplaces, crawlers and courts are the audience.

Per SPDX `LicenseRef-` convention, a repository using a SkillRights licence should include the licence text in a `LICENSES/` directory (the `skillrights` CLI does this for you).

## The three licences

| Licence | Execute | Train | Redistribute | Commercial |
|---|---|---|---|---|
| `SkillRights-Open-1.0` | yes | yes | yes (attribution) | yes |
| `SkillRights-NoTrain-1.0` | yes | **reserved** | yes (attribution) | yes |
| `SkillRights-Reserved-1.0` | authorised recipients only | **reserved** | **reserved** | by agreement |

Named variants, not checkboxes: three reviewed texts beat an unreviewable matrix. `Open` exists because a rights standard that cannot express "take it, learn from it, improve everything" is an anti-AI posture, and this is not one.

"Train" is defined broadly and deliberately as one right: training, fine-tuning, distillation and synthetic-training-data derivation are not separately reservable, because no creator meaningfully wants them split and no observer can tell them apart from outside.

Boundary rule for retrieval: using a skill in a retrieval or RAG pipeline at inference time is **execution**. Building an embedding or corpus for model improvement is **training**.

## What this can and cannot do

Honesty is a design requirement of this specification, so:

- **In the EU**, Article 4(3) of the DSM Directive allows relevant rightholders to reserve rights against the Article 4 text-and-data-mining exception; for publicly available online content the reservation should be expressed by appropriate machine-readable means, and the EU AI Act (Art 53(1)(c), in force since August 2025) requires providers of general-purpose AI models placed on the EU market to have a copyright-compliance policy that identifies and complies with such reservations. SkillRights provides a stated reservation and, where implemented, companion technical signals. Whether a particular signal qualifies, and whether the content and use fall within the relevant law, depend on the facts and applicable national law. The Article 3 scientific-research exception is not subject to an Article 4(3) opt-out. Which exact formats qualify is being decided by the European Commission now.
- **In the UK**, the DSM Directive does not itself apply. Separate UK copyright exceptions, including the non-commercial text-and-data-analysis exception, may apply.
- **In the US**, a SkillRights text is a copyright licence for protected expression and may be a contract where a user affirmatively accepts it. Bartz v. Anthropic (2025) found training on lawfully acquired books to be fair use, and no court has yet ruled on whether a machine-readable reservation changes that analysis. A declaration does not by itself bind a non-assenting person, eliminate fair use, or prevent scraping. It is dated evidence of a stated reservation, and its evidential weight grows with provenance (signing, timestamping, publication).
- **Within a marketplace or other contracting relationship**, the declared terms can be enforceable where they are clearly presented, affirmatively accepted, supported by a valid contract, and consistent with mandatory law. They are not automatically or universally enforceable, but this is where enforcement is strongest today.

## Companion signals

For skills published on the web, the generator at skillrights.org/generator offers example companion signals: `robots.txt` additions for training crawlers (GPTBot, ClaudeBot, Google-Extended and peers) and a TDMRep (`/.well-known/tdmrep.json`) reservation file. The current CLI does not generate them. Such signals communicate reservations or preferences; they are not technical blocks and do not by themselves establish legal compliance.

SkillRights is designed to compose with the emerging AI-rights layer, not compete with it: its `train` right is designed to align with the vocabulary directions of the IETF AIPREF drafts (which remain unsettled Internet-Drafts), Cloudflare Content Signals `ai-train`, and RSL's training tier. Think of it as a skill-file-specific profile of that layer; other protocols may also be capable of describing rights for a skill file.

## Provenance (optional but recommended)

`skillrights sign` records a signed hash of the skill directory using your existing SSH key (`ssh-keygen -Y` format), with a claimed creation time; `skillrights verify` checks it. Verification establishes that a holder of the corresponding key signed the manifest. It does not by itself prove the signer's legal identity, ownership of the Work, or the date of signing.

`skillrights register` (CLI 0.2.0) adds the independent evidence: it registers the signed hash in the SkillRights Registry, an append-only transparency log at registry.skillrights.org that returns a permanent SRID and a portable receipt (Merkle inclusion proof plus an Ed25519-signed tree head), verified locally before it is saved. Registration is free, needs no account, and in private mode sends only the hash, signature, licence identifier and claimed author: the skill's content never leaves your machine. A registration establishes that the artefact existed by the recorded time and that a particular key claimed and signed it; it does not prove legal ownership, authorship or originality.

The log is never its own only witness. Every tree head is countersigned by an independent RFC 3161 time-stamping authority, and submitted to public OpenTimestamps calendar servers, which batch it into the Bitcoin blockchain (the proof upgrades in place once the calendars commit, typically within hours). Anyone can mirror the full log (`GET /api/v1/log/entries`), recompute the Merkle root, download the anchor proofs (`GET /api/v1/log/anchors`) and check them with standard tooling (`ots verify`, `openssl ts -verify`), with no trust in skillrights.org required. The full recipe is in [registry/MIRRORING.md](../registry/MIRRORING.md).

## Versioning

Identifiers are immutable: the meaning of `SkillRights-NoTrain-1.0` will never change now that 1.0 is cut. Corrections and additions come as 1.1, 2.0 and so on. The pre-release drafts remain archived at their `-draft` URLs, immutable, with SHA-256 hashes recorded in the repository; the 1.0 texts supersede them and no prior acceptance of a draft is affected.

## Stewardship

SkillRights was initiated and is maintained by Quox LTD. You do not need Quox, a Quox account, or any Quox software to use SkillRights: the licences, this specification and the `skillrights` CLI are free, open and account-free, permanently. Spec changes happen in public. If adoption grows beyond our orbit, we commit to moving stewardship to a neutral body.
