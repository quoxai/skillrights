# SkillRights: Brief for Legal Counsel

Prepared 2026-09-10 by Quox LTD (UK). Ready to forward. Contact: adam@quox.ai.

## What we need from you

Review and finalise three short licence texts so we can remove their "draft" banners, plus answers to the numbered questions below. We would like: (a) marked-up licence texts, (b) short written answers to the questions, (c) a one-paragraph risk view we can act on. Target: 2 to 3 weeks.

## Context, in one page

AI "agent skills" are short structured text files (typically Markdown with YAML frontmatter) in which a person writes down a professional methodology so an AI agent can execute it: diagnostic sequences, checklists, decision rules, sometimes code and reference files. Anthropic and OpenAI both ship skill formats; the Anthropic format has an optional `license` frontmatter field that conventionally holds an SPDX-style identifier.

We have published **SkillRights** (skillrights.org): three licences for such skills, distinguishing four permissions: execute (an AI or human may use the skill to perform work, including loading it into a model's context at inference time), train (use in training, fine-tuning, distillation, or synthetic-training-data derivation for machine-learning models), redistribute, and commercial execution.

- **SkillRights-Open-1.0**: everything permitted, attribution on redistribution.
- **SkillRights-NoTrain-1.0** (flagship): execute and redistribute permitted, training expressly reserved, with wording intended to constitute a machine-readable reservation under Article 4(3) of Directive (EU) 2019/790.
- **SkillRights-Reserved-1.0**: execution by authorised recipients only; training and redistribution reserved.

Draft texts: https://skillrights.org/notrain/1.0-draft.txt, /open/1.0-draft.txt, /reserved/1.0-draft.txt (also in the repo under spec/licenses/). Each is deliberately short (one to two pages) and plain-language; we want to keep that character.

Commercial context: Quox LTD operates QuoxSkills, a marketplace/registry for such skills. The licences are free and vendor-neutral by design; Quox's commercial layer (signing, provenance receipts, marketplace terms, enterprise controls) sits on top. We publish honestly about enforceability limits and want the licences to be the strongest honest instrument available, not theatre.

## Relevant landscape (verified 2026-09-10, sources on request)

- Bartz v. Anthropic (N.D. Cal.): June 2025 partial summary judgment that training on lawfully acquired books is fair use; piracy claims settled (~$1.5B, final approval July 2026). Whether a machine-readable rights reservation alters the analysis for lawfully obtained content was not adjudicated.
- EU: DSM Directive Art 4(3) machine-readable TDM reservation; AI Act Art 53(1)(c) in force since 2025-08-02 requires GPAI providers to honour such reservations (recital 106: including training outside the EU); the Commission's consultation on qualifying machine-readable protocols closed 2026-01-09, guidance pending.
- Prior art licences with AI-training restrictions exist (non-AI MIT variants, RAIL family); common critiques are privity (no bite against non-parties), OSI incompatibility, and proliferation.

## Questions

1. **Copyright floor.** Skills are short procedural texts; methods and processes are excluded from copyright (s.3 CDPA / 17 U.S.C. 102(b) analogues). To what extent are typical skills protectable expression, and how should the licences be structured so that where copyright is thin, the terms still operate as enforceable contract or conditions of access? Does our section 7 fallback wording ("stands as a stated condition of access and a documented, dated reservation of consent") do useful work, and can it be strengthened?
2. **The training reservation.** Is the NoTrain section 3 wording sufficient to constitute an Art 4(3) reservation "in an appropriate manner, such as machine-readable means"? Should the reservation also appear in specific companion formats (robots.txt, TDMRep file, HTTP header) to maximise the chance of qualifying under whatever the Commission's guidance names, and should the licence commit to any of them?
3. **Definition of Train.** We deliberately collapse training, fine-tuning, distillation and synthetic-data derivation into one broad definition. Any drafting risks? Specifically: our boundary rule says inference-time retrieval (RAG) of the skill is execution, while building an embedding corpus for model improvement is training. Is that line drafted tightly enough?
4. **Privity and fair use.** Please confirm our working assumption: against a US party that never accepted the licence and whose training use is held fair, the licence gives no copyright claim, and value there is limited to evidence of non-consent, possible contract claims where a relationship exists, and the EU route. We want our public claims calibrated to your answer.
5. **Termination and downstream rights.** NoTrain terminates on breach but preserves compliant downstream recipients. Sound? Anything needed on cure periods?
6. **Reserved variant.** Is "Authorised Recipient" adequately defined for the private/commercial case, or should authorisation mechanics (e.g. reference to a separate agreement or order form) be tightened?
7. **Warranty and liability.** Skills encode professional judgement; a user executes them at their own risk. Are the disclaimers adequate for UK/EU consumer-law and unfair-terms exposure, given licensors may be individuals?
8. **Governing law.** The licences are currently silent on governing law and jurisdiction (like MIT/CC). Keep silent, or specify England and Wales? Trade-offs for an international standard?
9. **Trademark.** Clearance search and, if clear, filing strategy for "SkillRights" (UK/EU/US, classes for software, licensing services, online publications). The name is in public use by us as of 2026-09-10.
10. **Marketplace terms.** One clause for QuoxSkills' ToS binding every downloader to the skill's declared SkillRights terms (this is where enforcement is strongest). Draft or review ours.
11. **SPDX submission.** Any legal considerations in submitting the final texts to the SPDX license list (irrevocability of the published text, steward obligations)?
12. **Our public claims.** We publish a "what this can and cannot do" section (skillrights.org/spec/). Please flag anything there, or in our launch article, that overstates or understates the legal position.

## Constraints

- Keep the licences short and readable by non-lawyers; complexity belongs in your memo, not the texts.
- Identifiers are immutable once final ("SkillRights-NoTrain-1.0" text can never change; fixes become 1.1).
- We will publish your requested changes as a public diff from the drafts; nothing about the process is confidential except your advice itself.


## Questions added 2026-09-11 (from the independent cross-review)

- NoTrain section 2(c) requires modifications to be redistributed only under
  the same licence (share-alike). Does this interact acceptably with the
  attribution condition, and is the scope of "modification" adequately
  defined for skill files that embed third-party content?
- Reserved limits execution to the recipient organisation's internal
  business purposes and excludes third-party benefit without written
  permission. Please confirm this wording does what we intend for
  consultancies, agencies and managed service providers, and whether an
  express carve-in mechanism (a written permission template) is advisable.
- When a recipient's AI system sends a Reserved or NoTrain skill's text to
  an external model provider in the ordinary course of execution, is that
  disclosure within the licence's contemplation, and should the texts say
  so explicitly either way?


## Questions added 2026-09-11 (third independent AI reviewer, Gemini 3.1 Pro)

Full review: legal/REVIEW_GEMINI.md. The two critical items are v1.1
candidates and need counsel's drafting, not ours:
- NoTrain/Reserved s1 RAG carve-out uses the passive "provided that it is
  not subsequently used for Train", which makes the licensee retroactively
  breach when a THIRD PARTY misuses their lawfully built index. Proposed
  fix direction: "provided that You do not subsequently use it for Train."
- NoTrain s2(c) share-alike never defines "modification". Where is the
  boundary against aggregation and dynamic composition (an agent chaining a
  NoTrain skill with an MIT skill)?
- The "to the extent that the activity requires permission" prefix in the
  Train definition may self-nullify the reservation in fair-use
  jurisdictions while the EU Art 4(3) reservation needs to remain EXPRESSED
  regardless. Confirm the definition still constitutes a valid reservation.
- Reserved s2 "or otherwise for the benefit of a third party" may ban
  ordinary internal IT that incidentally serves customers; confirm intent.
- Reserved s4 "where practicable" deletion may create a perpetual retention
  loophole for vector indexes; consider an objective standard.
- The Train definitions drift slightly between Open and NoTrain/Reserved
  ("evaluate with a view to improve" vs "evaluate, distil into"); align.
