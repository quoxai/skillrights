# SkillRights Specification

**Version 0.1 (DRAFT).** Status: proposal, open for comment. The licence texts referenced here have not yet completed legal review and are published as drafts. Do not treat this page as legal advice.

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

- **In the EU**, the DSM Directive (Art 4(3)) lets rights holders reserve text-and-data-mining rights in machine-readable form, and the EU AI Act (Art 53(1)(c), in force since August 2025) requires general-purpose AI providers to honour such reservations, including for training done outside the EU. Which exact formats qualify is being decided by the European Commission now. SkillRights declarations state the reservation in natural language, in metadata, and via companion signals (robots.txt, TDMRep) to maximise the chance of qualifying.
- **In the US**, a licence binds parties who accept it or who need copyright permission and take it through the licence. Whether model training on lawfully obtained content requires permission at all is unsettled: Bartz v. Anthropic (2025) found training on lawfully acquired books to be fair use, and no court has yet ruled on whether a machine-readable reservation changes that. A SkillRights declaration is a dated, unambiguous statement of non-consent, provenance and contractual terms for those who deal with you. It is not a technical or guaranteed legal shield against scraping.
- **Within a marketplace or between contracting parties**, the reservations are ordinary contract terms and fully enforceable as such.

## Companion signals

For skills published on the web, the `skillrights` CLI can also emit:

- `robots.txt` additions for training crawlers (GPTBot, ClaudeBot, Google-Extended and peers)
- a TDMRep (`tdmrep.json`) reservation file
- an RSL licence pointer, where a site already uses RSL

SkillRights is designed to compose with the emerging AI-rights layer, not compete with it: its `train` semantics align with the IETF AIPREF `train-ai` category, Cloudflare Content Signals `ai-train`, and RSL's training tier. Think of it as the skill-file profile of that layer.

## Provenance (optional but recommended)

`skillrights sign` hashes the skill directory and signs it with your existing SSH key (`ssh-keygen -Y` format). `skillrights verify` checks it. A dated, signed declaration is worth more than an unsigned string: it proves who reserved what, and when.

## Versioning

Identifiers are immutable: the meaning of `SkillRights-NoTrain-1.0` will never change. Corrections and additions come as 1.1, 2.0 and so on. Draft-stage texts carry `-draft` in their URLs until legal review completes.

## Stewardship

SkillRights was initiated and is maintained by Quox LTD. You do not need Quox, a Quox account, or any Quox software to use SkillRights: the licences, this specification and the `skillrights` CLI are free, open and account-free, permanently. Spec changes happen in public. If adoption grows beyond our orbit, we commit to moving stewardship to a neutral body.
