<p align="center">
  <a href="https://skillrights.org"><img src="site/assets/src/mark-hand-flame.png" alt="SkillRights mark: an open hand holding a flame" width="140"></a>
</p>
<p align="center">
  <a href="https://skillrights.org"><img src="site/assets/wordmark.png" alt="SkillRights" width="360"></a>
</p>

[![CI](https://github.com/quoxai/skillrights/actions/workflows/check.yml/badge.svg)](https://github.com/quoxai/skillrights/actions/workflows/check.yml)

**An open licence family for AI agent skills: execution permitted, training rights reserved, in one line.**

Agent skills are executable expertise: procedures, judgement and methodology written down so a machine can act on them. Publishing a skill so agents can use it should not silently grant permission to absorb it into a model. SkillRights separates those permissions, using the `license` frontmatter field skill formats already have:

```yaml
---
name: cluster-doctor
description: Diagnose failing clusters the way a 15-year SRE does.
license: LicenseRef-SkillRights-NoTrain-1.0
---
```

That is the whole declaration; about 20 tokens, loaded only when the skill is invoked. Distributing, interpreting and enforcing it are their own integrations (a public conformance suite covers the parsing and decision layer). Website: **https://skillrights.org** · Spec: https://skillrights.org/spec/ · Generator: https://skillrights.org/generator/ · Adoption guide: https://skillrights.org/adopt/

## The three licences (version 1.0)

| Licence | Execute | Train | Redistribute | Text |
|---|---|---|---|---|
| `LicenseRef-SkillRights-Open-1.0` | yes | yes | yes (attribution) | [open/1.0](https://skillrights.org/open/1.0.txt) |
| `LicenseRef-SkillRights-NoTrain-1.0` | yes | **reserved** | yes (attribution; modified copies stay under this licence) | [notrain/1.0](https://skillrights.org/notrain/1.0.txt) |
| `LicenseRef-SkillRights-Reserved-1.0` | authorised recipients, internal business use only | **reserved** | **reserved** | [reserved/1.0](https://skillrights.org/reserved/1.0.txt) |

The 1.0 texts were produced through adversarial review by two independent AI reviewers at high reasoning effort; the full reconciliation record is public in [`legal/`](legal/). They are not advice from qualified counsel, and professional review remains planned. What a declaration can and cannot do, stated honestly (EU, UK, US, marketplaces): https://skillrights.org/spec/

## The CLI

Zero dependencies, no telemetry, no account. No network use except the optional `register` verb, which sends the registration evidence to the public registry.

```
skillrights init            # apply a licence: frontmatter + LICENSES/ + README line
skillrights check           # validate consistency (CI-friendly exit codes)
skillrights explain         # plain-language summary, with the enforcement caveat
skillrights sign / verify   # hash + sign the skill with your existing SSH key
skillrights posture         # AI provider training defaults, dated and sourced
```

On npm as [`skillrights`](https://www.npmjs.com/package/skillrights): `npx skillrights init`, or `npm install -g skillrights`. See [`cli/README.md`](cli/README.md).

## GitHub Action

```yaml
- uses: actions/checkout@v4
- uses: quoxai/skillrights/action@master
  with:
    path: path/to/your-skill
```

This repository's own CI runs it against [`examples/cluster-doctor`](examples/cluster-doctor).

## Make it automatic

An installable agent skill lives at [`integrations/claude-skill/skillrights`](integrations/claude-skill/skillrights): once in `~/.claude/skills/`, agents apply a declaration whenever they author a skill. A copy-paste rules snippet for CLAUDE.md / AGENTS.md is at https://skillrights.org/adopt/

## Repository layout

```
spec/        the specification and the immutable licence texts (drafts archived with hashes)
cli/         the zero-dependency CLI (MIT)
action/      the composite GitHub Action
integrations/  the installable agent skill (SkillRights-Open-1.0)
examples/    a licensed example skill (SkillRights-NoTrain-1.0)
site/        source of skillrights.org
legal/       counsel brief, both AI reviews, reconciliation record
data/        provider posture dataset
```

## Licensing of this repository

The CLI and Action are MIT. The SkillRights licence texts may be copied and redistributed verbatim for the purpose of applying them to any work. The site content and documentation are copyright Quox LTD.

## Stewardship

SkillRights was initiated and is maintained by [Quox LTD](https://quox.ai). You do not need Quox, a Quox account, or any Quox software to use it, permanently. Spec changes happen in public in this repository. If adoption grows beyond our orbit, we commit to moving stewardship to a neutral body. Contact: hello@quox.ai
