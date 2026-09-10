# Second-eye adversarial legal review

**Important: This memo is not legal advice from qualified counsel. It is a legal-risk review for discussion with UK, EU, and US qualified IP and technology counsel.**

**Verdict:** do not remove `-draft`. The texts currently overstate their ability to regulate non-contracting users, mishandle the EU and UK statutory exceptions, and do not provide a defensible operational Art. 4(3) reservation workflow.

## Answers to counsel brief questions

1. **Copyright floor**

Typical skills can attract copyright in their original wording, selection, arrangement, examples, prompts, and code. A terse checklist, process, professional method, decision rule, facts, and functional commands may have very thin or no protection. The brief’s reference to CDPA s.3 is inaccurate: s.3 defines literary works; it is not the UK equivalent of 17 U.S.C. §102(b). UK law protects expression, not the underlying idea or method. [UK IPO guidance](https://www.gov.uk/government/publications/ip-basics/ip-basics), [US Copyright Office guidance](https://www.copyright.gov/help/faq/faq-general.html)

The licence should grant and reserve only rights the Licensor controls, including copyright, database, and related rights, rather than imply an autonomous legal right in “methodology.” A public licence can condition use of protected expression. It cannot make a method proprietary or create a contract with a stranger merely by being displayed.

Section 7’s current fallback does little useful legal work. It proves a stated position, subject to provenance evidence. It does not create a condition of access unless access was actually conditioned on assent, nor a contract without agreement. Replace it with the wording in Defect 10 below. Use clickwrap and a downloader covenant for marketplace enforcement.

2. **Training reservation and Art. 4(3)**

No. Current NoTrain section 3 is an express reservation, but the assertion that “this document constitutes that reservation in machine-readable form” is unsupported. A plain text licence at a URL might be machine-readable in the ordinary sense, but there is no decision establishing that this identifier and text alone satisfy Art. 4(3) for public web content.

Art. 4(3) concerns reproductions and extractions for text and data mining, not a freestanding worldwide “training right.” For publicly available online content, the Directive gives machine-readable means as the example; recital 18 specifically points to metadata and website/service terms. [DSM Directive, Art. 4 and recital 18](https://eur-lex.europa.eu/eli/dir/2019/790/oj)

Use layered, origin-level signals: embedded licence metadata, `robots.txt`, a valid TDMRep signal or HTTP `tdm-reservation` header, and later any final AIPREF standard. The Commission’s current process expressly treats `robots.txt`, TDMRep, and several other protocols as candidates, but has not made the existing SkillRights declaration a legally qualifying protocol. [Commission consultation FAQ](https://digital-strategy.ec.europa.eu/en/faqs/stakeholder-consultation-ai-and-copyright-compliance)

Do not hard-code a mutable third-party protocol in the licence. Create and freeze a versioned `SkillRights TDM Signal Profile 1.0`, then make the licence refer to that profile only for public online distributions controlled by the Licensor.

3. **Definition of Train**

The broad commercial intention is understandable, but the definition is legally and technically overbroad.

“Evaluation-for-improvement” could capture ordinary testing without an update to a model. “Synthetic training data derived from it” cannot give copyright control over independently expressed ideas or methods. The present RAG boundary also fails to say whether creating and retaining the vector embedding/index for retrieval is execution. It should be expressly permitted when solely used for inference-time retrieval, and prohibited when used to improve a model.

Use the replacement definition in Defect 11. It correctly separates inference retrieval from model development while preserving the intended commercial restriction for assenting users and protected expression.

4. **Privity and fair use**

Your working assumption is substantially right, with important qualifications.

Against a US actor that did not assent, a SkillRights text is not a contract. If the skill has no protectable expression, or if the actor’s copying is held to be fair use, the licence does not itself create a copyright claim. A reservation can be evidence of non-consent, provenance, and knowledge, but it does not eliminate fair use or create a new exclusive right.

*Bartz* is a district-court decision on particular facts, not nationwide authority. It held the training use of lawfully acquired books fair, while leaving separate piracy issues unresolved until settlement. It did not decide the effect of a machine-readable opt-out. [Order on fair use](https://www.hunton.com/assets/htmldocuments/Bartz_et_al_v_Anthropic_Order_on_Fair_Use.pdf), [final settlement approval](https://law.justia.com/cases/federal/district-courts/california/candce/4:2024cv05417/434709/680/)

Do not say the only residual value is “non-consent.” A particular fact pattern could also support a valid platform contract, breach of site terms, anti-circumvention, trespass, database-right, or other claim. Those are separate causes of action and should not be implied without facts.

5. **Termination and downstream rights**

The intent is sound but the drafting is not. Automatic termination for completed training neither reverses training nor identifies a remedy. The downstream sentence is ambiguous and needlessly ties a compliant recipient’s position to a breaching intermediary.

Use a direct-grant structure: every compliant recipient receives a licence directly from the Licensor. Permit a 30-day cure for fixable breaches such as missing attribution. Do not permit automatic reinstatement of a completed Train breach without written Licensor consent.

6. **Reserved variant**

“Authorised Recipient” is inadequate. It does not say how authority is evidenced, whether employees, contractors, affiliates, hosted systems, or customers are included, or who may give permission. It also calls an AI system a recipient even though an AI system cannot accept a contract or bear liability.

Reserved should operate only with a named written order form, agreement, account entitlement, or access record. For confidential or commercially valuable skills, a separate executed agreement should be mandatory, not optional.

7. **Warranty and liability**

The disclaimers are inadequate for consumer-facing use. They attempt an absolute exclusion, omit non-excludable liability, and in Reserved omit the professional-advice limitation entirely. A trader’s consumer notice or clickwrap can be reviewed for fairness in the UK even if it is not a fully formed contract. UK and EU consumer law can preserve mandatory remedies and invalidate unfair exclusions. [UK Consumer Rights Act material](https://www.legislation.gov.uk/ukpga/2015/15/pdfs/ukpga_20150015_en.pdf), [Unfair Terms Directive](https://eur-lex.europa.eu/eli/dir/1993/13/oj/eng)

Use the replacement in Defect 9. It cannot remove statutory rights, regulated-profession duties, fraud liability, or liability that law does not permit a Licensor to exclude.

8. **Governing law and jurisdiction**

Keep the public licences silent. England and Wales law and exclusive jurisdiction would not create privity, would create friction for worldwide adoption, and cannot displace mandatory consumer protections. It also does not decide the territorial law governing an infringement claim.

Specify England and Wales law and courts in Quox’s marketplace and enterprise agreements, with consumer savings. Do not add it to the three public licence texts.

9. **Trademark**

I cannot clear the mark from this workspace. A public-web exact-name screen is not a UKIPO, EUIPO, USPTO, common-law, phonetic, and goods/services clearance search. Do not describe the mark as “clear.”

Risk is material: `SkillRights` is suggestive at best and may be considered descriptive for rights-management terms for skills. `Skill` is weak in the relevant market. Obtain professional clearance for `SKILLRIGHTS`, `SKILL RIGHTS`, `SKILLRIGHT`, and phonetic variants, including classes 9, 35, 41, 42, and 45 only where the actual goods/services justify them.

Recommended sequence:

1. Commission UK, EU, and US clearance before marketing spend.
2. File the UK word mark and logo mark promptly if cleared.
3. Within six months, use Paris priority for EU and US filings.
4. In the US, use intent-to-use unless there is established qualifying US interstate use.
5. Keep a stylised logo application as a fallback. Do not rely on it as a substitute for a viable word mark.
6. Adopt a trademark-use policy allowing nominative use of the licence identifiers while prohibiting confusing branding claims.

10. **Marketplace clause**

The existing marketplace wording is insufficient unless download, clone, install, and invocation are technically gated behind affirmative assent. A browsewrap link is not enough. Quox must preserve the exact text and hash shown at assent, and the uploader agreement should authorise Quox to present the relevant licence.

Use this clause in QuoxSkills ToS, with an affirmative control labelled “I agree to the skill licence”:

```text
SKILL-SPECIFIC LICENCE COVENANT

Before a User may download, export, clone, install, invoke, or otherwise
obtain a Skill through the Service, the Service will present the Skill's
licence identifier, canonical URL, complete licence text, and a hash or
version record of that text. By selecting the affirmative acceptance control,
or by proceeding after the Service records that affirmative acceptance, the
User agrees with Quox to comply with the declared licence terms for that
Skill, including every restriction on Train, redistribution, commercial use,
and confidentiality.

The Skill's identified Licensor is an intended third-party beneficiary of
this covenant and may enforce it directly to the extent permitted by
applicable law. Quox may also enforce it, suspend access, and preserve and
produce the acceptance record. The User must not remove or bypass the
Service's access controls to avoid this covenant.

This covenant applies only to the version of the licence text displayed and
recorded when the User accepts it. Nothing in this clause requires a User to
waive a right that applicable law does not permit the User to waive.
```

This binds platform users, not a person who obtains the material from an external mirror, a raw public repository, or an ungated URL.

11. **SPDX submission**

Keep `LicenseRef-` while these are custom texts. A `LicenseRef-` denotes a licence not on the official SPDX List and, in an SPDX document, should be accompanied by the custom licence text rather than merely a URL. [SPDX specification](https://spdx.dev/wp-content/uploads/sites/31/2024/12/SPDX-3.0.1-1.pdf)

Do not submit drafts. SPDX requires stable, identifiable text and expects a steward commitment not to alter an accepted text except through a new version. It also weighs broad usability, actual substantial use, and consistency with open-source or free-content principles. [SPDX inclusion principles](https://github.com/spdx/license-list-XML/blob/main/DOCS/license-inclusion-principles.md)

`Open` may be a candidate once fixed and used. `NoTrain` and `Reserved` are unlikely to satisfy open-source criteria because of their material use restrictions. SPDX acceptance is not legal validation and should not delay publication of a proper final text.

12. **Public claims**

The specification materially overstates:

- that the current licence text itself is an Art. 4(3) machine-readable reservation;
- that the CLI emits companion signals;
- that the current `tdmrep.json` output is TDMRep-compliant;
- that marketplace terms are “fully enforceable”;
- that a signature proves who reserved what and when;
- that IETF AIPREF has a settled `train-ai` category;
- that the AI Act universally requires every AI provider to honour the declaration.

It also understates the mandatory EU Art. 3 scientific-research exception and the UK s.29A non-commercial text-and-data-analysis exception. The AI Act requires providers of general-purpose AI models placed on the EU market to put in place a copyright-compliance policy, including identifying and complying with Art. 4(3) reservations. It is not a private cause of action or a universal training ban. [AI Act Art. 53](https://eur-lex.europa.eu/eli/reg/2024/1689/oj), [Commission GPAI guidance](https://digital-strategy.ec.europa.eu/en/faqs/guidelines-obligations-general-purpose-ai-providers)

## Drafting defect register

The wording below is exact proposed replacement language.

1. **BLOCKER, all three: final identifiers are already used on expressly non-reliance drafts.**

The draft CLI and generator distribute `LicenseRef-SkillRights-*-1.0` while the text says it must not be relied on. Do not silently substitute a materially revised final text under an already distributed identifier.

Replace the draft footer, while the material remains draft, with:

```text
Identifier: LicenseRef-SkillRights-NoTrain-1.0-draft
Canonical draft URL: https://skillrights.org/notrain/1.0-draft
```

Use equivalent variant names. For final publication, preferably use a fresh final version because of the existing public use of the `1.0` identifiers. If retaining `1.0`, archive the exact drafts permanently, publish a hash and public diff, and state clearly that the final text supersedes no prior accepted licence.

2. **BLOCKER, Open and Reserved: mutable incorporation by reference.**

Open and Reserved incorporate NoTrain “1.0,” which is a different text, currently a draft, and may change. Reserved section 3 also imports operative wording that refers to NoTrain’s own section 2.

Delete every incorporation-by-reference sentence. Reproduce the shared definitions in each licence. Replace each imported Art. 4 reservation with the NoTrain section 3 replacement in Defect 4, adapted only to the variant name.

3. **MAJOR, all three: parties, rights, work scope, and AI responsibility are undefined or unclear.**

Replace each definitions section with this shared core, then add the Reserved-specific definition in Defect 13:

```text
1. DEFINITIONS

"Licensor" means the person or legal entity offering the Work under this
licence.

"You" means the individual or legal entity exercising permissions under this
licence. If You exercise permissions for an organisation, "You" includes that
organisation and You confirm that You have authority to bind it.

"Work" means the files and material that the Licensor identifies as subject
to this licence in a copyright notice, licence notice, or distribution record,
including the skill, instructions, prompts, code, resources, and accompanying
files. It does not include material merely linked from the Work. This licence
applies only to rights in that material that the Licensor owns or controls.

"Execute" means to read, load, interpret, follow, retrieve, or otherwise use
the Work at run-time to perform a task for You or on Your behalf, including
loading or retrieving the Work in the context of an AI model at inference
time.

"Redistribute" means to reproduce, publish, host, mirror, convey, or make
available all or a material part of the Work to another person or legal entity,
in original or modified form.
```

4. **BLOCKER, NoTrain and Reserved: unsupported Art. 4(3) assertion and wrong legal scope.**

Replace NoTrain section 3 and Reserved section 3’s first paragraph with:

```text
3. RESERVATION OF TRAINING AND TEXT-AND-DATA-MINING RIGHTS

Except for the express permissions in this licence, the Licensor does not
grant permission to Train.

To the extent that the Licensor is the relevant rightholder, the Licensor
expressly reserves, for the purposes of Article 4(3) of Directive (EU)
2019/790 and the laws implementing it, the rights to reproduce and extract
the Work for text and data mining, including text and data mining for Train.

Where the Work is made publicly available online by or for the Licensor, the
Licensor will also express this reservation using the machine-readable
metadata and public signals specified in the immutable SkillRights TDM Signal
Profile 1.0 at https://skillrights.org/tdm-signal-profile/1.0. A Redistributor
must preserve those signals or apply an equally prominent machine-readable
reservation to the copy that it makes publicly available online.

This section does not restrict an act that an applicable mandatory exception
or limitation permits.
```

Do not publish this until the referenced profile exists, is frozen, and is technically tested.

5. **BLOCKER, NoTrain and Reserved: omission of EU Art. 3 and UK s.29A divergence.**

The present “nobody may train” summary is legally false in important circumstances. Art. 3 scientific research is unaffected by the Art. 4 opt-out, and the UK’s text-and-data-analysis exception is separate from DSM Art. 4. [DSM Directive](https://eur-lex.europa.eu/eli/dir/2019/790/oj), [UK IPO exceptions guidance](https://www.gov.uk/guidance/exceptions-to-copyright)

Add to each NoTrain and Reserved summary:

```text
This summary is not a statement that every use called training is unlawful.
Mandatory copyright exceptions and limitations may apply.
```

The final sentence in Defect 4 must remain in the operative text.

6. **MAJOR, all three: incomplete grant, no irrevocability, no related-rights scope.**

Replace each grant opening with:

```text
Subject to the terms of this licence, the Licensor grants You a worldwide,
royalty-free, non-exclusive, perpetual, and irrevocable, except as expressly
provided in the termination section, licence under the rights in the Work that
the Licensor controls to exercise the permissions stated below.
```

For NoTrain, replace section 2(a) through (c) with:

```text
(a) Execute the Work, including for commercial purposes;
(b) modify the Work; and
(c) Redistribute the Work and modifications of it, subject to section 4 and,
    for modifications, only under this same licence.
```

For Open, replace section 2 with:

```text
2. GRANT

Subject to section 3, the Licensor grants You permission to Execute, Train
using, reproduce, modify, and Redistribute the Work, in original or modified
form, for any purpose, including commercial purposes.
```

7. **MAJOR, all three: attribution is vague and lacks modification, notice, endorsement, and trademark treatment.**

Replace each attribution section with:

```text
4. ATTRIBUTION AND NOTICES

On any Redistribution, You must retain the copyright, attribution,
reservation, and licence notices supplied with the Work; identify the original
author or source as stated in the Work, unless the Licensor has asked
otherwise; state that You modified the Work if You did; and provide the full
licence identifier and canonical licence URL.

You may add Your own notices and attribution, but must not state or imply
that the Licensor endorses You or a modified Work.

This licence does not grant permission to use the Licensor's trademarks,
service marks, or logos except as reasonably necessary to identify the Work
and comply with this section.
```

For NoTrain, retain the same-licence requirement in Defect 6. Open should not be described as copyleft unless it adopts that same requirement.

8. **BLOCKER, Open: attribution is not clearly a condition and there is no termination.**

Insert this new section after Open attribution:

```text
4. TERMINATION AND REINSTATEMENT

The permissions granted to You terminate automatically if You materially
breach section 3. If You cure the breach within 30 days after receiving
written notice from the Licensor, the permissions reinstate automatically on
cure. Each recipient receives the grant directly from the Licensor, and a
breach by another recipient does not terminate that recipient's rights.

Sections 4 and 5 survive termination.
```

Renumber the remaining sections.

9. **MAJOR, all three: warranty and liability language is too absolute and Reserved omits professional-risk wording.**

Replace every warranty and liability section with:

```text
NO WARRANTY; LIMITATION

To the maximum extent permitted by applicable law, the Work is provided "as
is" and "as available", without warranties, conditions, or representations of
any kind, whether express, implied, or statutory, including as to accuracy,
completeness, fitness for a particular purpose, non-infringement,
merchantability, or availability.

Unless the Licensor separately agrees otherwise in writing, the Work is
general informational material. It is not tailored professional advice and
does not create a professional-client relationship. You are responsible for
independently assessing the Work and its outputs.

Nothing in this licence excludes or limits liability that applicable law does
not permit the Licensor to exclude or limit, including liability for death or
personal injury caused by negligence, or for fraud or fraudulent
misrepresentation, where applicable.
```

10. **BLOCKER, NoTrain and Reserved: section 7 falsely suggests that a unilateral licence becomes a binding access condition.**

Replace the final two sentences of NoTrain section 7 and Reserved section 6 with:

```text
Except for the permissions expressly granted, the Licensor does not grant or
imply consent to use the Work. This licence is evidence of that stated
reservation, but it does not by itself create a contract with a person who has
not agreed to it. A platform or other access provider may require a separate
agreement as a condition of access.
```

11. **MAJOR, NoTrain and Reserved: training and RAG boundary is not sufficiently tight.**

Add this definition after `Execute`:

```text
"Train" means, to the extent that the activity requires permission from the
Licensor, using all or part of the Work as input, data, or source material to
develop, train, pre-train, fine-tune, align, evaluate with a view to improve,
distil into, or otherwise improve a machine-learning model, or to create
synthetic training data from the Work for any such activity. Train includes
placing the Work in a dataset, embedding or vector corpus, cache, or index
used for any such activity.

Train does not include making or retaining a copy, embedding or vector index,
cache, or corpus solely to retrieve the Work at inference time for Execute,
provided that it is not subsequently used for Train.
```

12. **MAJOR, NoTrain and Reserved: termination does not distinguish curable breaches, completed training, or direct downstream grants.**

Replace NoTrain section 5 with:

```text
5. TERMINATION AND REINSTATEMENT

The permissions granted to You terminate automatically if You materially
breach this licence. If You cure a breach other than a completed act of Train
within 30 days after receiving written notice from the Licensor, the
permissions reinstate automatically on cure. A completed act of Train may be
reinstated only by the Licensor's express written agreement.

Each recipient receives the grant directly from the Licensor. A breach by
another recipient does not terminate the rights of a recipient that remains in
compliance with this licence.
```

Use equivalent wording in Reserved, but make unauthorised disclosure and confidentiality breaches non-curable except by express written agreement.

13. **BLOCKER, Reserved: Authorised Recipient and commercial scope are indeterminate.**

Replace the Reserved definition and grant with:

```text
"Authorised Recipient" means a person or legal entity expressly identified in
a written agreement, order form, account entitlement, or other durable record
issued by or on behalf of the Licensor as permitted to Execute the Work. It
includes that entity's employees and contractors solely to the extent that
they act on its behalf and are bound by written obligations at least as
protective as this licence. It excludes affiliates, customers, and other third
parties unless the relevant record expressly includes them.

2. GRANT

Subject to this licence, the Licensor grants each Authorised Recipient a
non-exclusive, non-transferable, non-sublicensable licence to reproduce, load,
store, and Execute the Work only as reasonably necessary for its internal
business purposes. It may make the Work available only to its permitted
employees and contractors.

An Authorised Recipient may not Execute the Work to provide a service to a
third party, or otherwise for the benefit of a third party, unless the
Licensor has separately agreed in writing.
```

14. **BLOCKER, Reserved: no confidentiality protection.**

Insert this new section before termination:

```text
4. CONFIDENTIALITY

The Work and non-public information supplied with it are Confidential
Information. Each Authorised Recipient must protect them using at least
reasonable care, use them only as section 2 permits, and disclose them only to
permitted employees and contractors bound by written obligations at least as
protective as this section.

This section does not apply to information that the Authorised Recipient can
document was lawfully public without breach, already known without a duty of
confidence, independently developed without use of the Work, or lawfully
received without a duty of confidence.

On termination or the Licensor's written request, the Authorised Recipient
must stop using the Work and, where practicable, delete its copies, except for
one archival copy retained solely to comply with law or resolve a dispute.
```

A public `Reserved` file cannot itself preserve trade-secret status. Use gated access and an executed agreement.

15. **MAJOR, all three: code is included but patent and moral-rights positions are unstated.**

Insert after the grant in each licence:

```text
PATENT AND MORAL RIGHTS

To the extent the Licensor owns or controls patent claims that would be
infringed only by exercising an express permission under this licence, the
Licensor grants You a worldwide, royalty-free, non-exclusive patent licence
under those claims for that exercise. This sentence does not grant permission
to Train unless the Open Licence expressly grants it.

To the extent permitted by applicable law and to the extent the Licensor can
do so, the Licensor waives, and otherwise agrees not to assert, moral rights
in the Work to the extent necessary to exercise the permissions granted by
this licence, except for the attribution requirement and protection against
false attribution.
```

16. **MINOR, all three: summaries use “owner” and “nobody may” too categorically.**

Replace the NoTrain summary with:

```text
Summary, not part of the licence: the Licensor permits execution and sharing
on the stated conditions, but does not grant permission to Train using the
Work. Mandatory legal exceptions may apply.
```

Replace the Reserved summary with:

```text
Summary, not part of the licence: only Authorised Recipients may use the Work
within the stated scope. Training and redistribution are not granted. Mandatory
legal exceptions may apply.
```

## Specification and launch-article corrections

`spec/SPEC.md` should not say that all declarations are legally effective machine-readable reservations. Replace the EU, US, and marketplace bullets with:

```text
In the EU, Article 4(3) of the DSM Directive allows relevant rightholders to
reserve rights against the Article 4 text-and-data-mining exception. For
publicly available online content, the reservation should be expressed by
appropriate machine-readable means. SkillRights provides a stated reservation
and, where implemented, companion technical signals. Whether a particular
signal qualifies and whether the content and use fall within the relevant law
depend on the facts and applicable national law. The Article 3 scientific
research exception is not subject to an Article 4(3) opt-out.

In the UK, the DSM Directive does not itself apply. Separate UK copyright
exceptions, including the non-commercial text-and-data-analysis exception, may
apply.

In the US, a SkillRights text is a copyright licence for protected expression
and may be a contract where a user affirmatively accepts it. It does not itself
bind a non-assenting person, eliminate fair use, or prevent scraping.

Within a marketplace or other contracting relationship, the declared terms can
be enforceable if they are clearly presented, affirmatively accepted, supported
by a valid contract, and consistent with mandatory law. They are not
automatically or universally enforceable.
```

The current claim that the CLI emits companion signals is false in this repository. The web generator, not the CLI, offers them. Further, its emitted JSON is not valid TDMRep. TDMRep requires an array of rule objects containing `location` and numeric `tdm-reservation`; the current `tdm-reservation-location` field is not part of that schema. [TDMRep specification](https://www.w3.org/community/reports/tdmrep/CG-FINAL-tdmrep-20240202/)

Until implemented and tested, replace the companion-signals section with:

```text
SkillRights documents examples of companion web signals. The current CLI does
not generate them. Such signals communicate reservations or preferences; they
are not technical blocks and do not by themselves establish legal compliance.
```

Replace the provenance claim with:

```text
`skillrights sign` records a signed hash and a claimed creation time.
Verification establishes that a holder of the corresponding key signed the
manifest. It does not by itself prove the signer's legal identity, ownership
of the Work, or the date of signing. Independent publication or trusted
timestamping provides stronger evidence.
```

The AIPREF sentence is stale. The current IETF work remains an Internet-Draft, and its vocabulary is unsettled. Do not claim present semantic equivalence with `train-ai`. [Current AIPREF status](https://datatracker.ietf.org/doc/draft-ietf-aipref-vocab/)

In the launch article, change:

- “in the EU it is not open; it is answered” to the qualified EU wording above.
- “stated in the exact terms EU law recognises” to “intended to express a reservation in language and signals designed for the EU framework.”
- “a contractual term for everyone who deals with you” to “a contractual term for users who affirmatively accept it.”
- “a dated proof of non-consent” to “evidence of a stated reservation, with evidential weight depending on provenance.”
- “Every one of those efforts stops at the boundary of the web page” to “SkillRights is intended as a skill-file-specific profile; other protocols may also be capable of describing rights for a skill file.”
- “Your data belongs to you. Your work belongs to you.” to “You may have legal rights and contractual choices concerning your data and work. Those rights vary by asset, ownership, contract, and jurisdiction.”

The article’s Anthropic and OpenAI product-policy discussion is broadly consistent with their currently published materials, but should say “their published terms state” rather than make timeless assertions. Its claim that an existing-user toggle was preselected should be retained only with a preserved contemporaneous screenshot and source record. [Anthropic policy update](https://www.anthropic.com/news/updates-to-our-consumer-terms), [OpenAI Codex data controls](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan/)

## Final verdict: required must-fix list before removing `-draft`

1. Stop distributing final `LicenseRef-SkillRights-*-1.0` identifiers with draft text. Archive the drafts and use unambiguous draft identifiers. Prefer a fresh final version if any public adoption occurred.
2. Make each final licence self-contained. Delete all incorporation by reference.
3. Replace the false Art. 4(3) self-certification with the qualified reservation language and publish a frozen, tested TDM Signal Profile.
4. Correct public claims to acknowledge EU Art. 3 and UK s.29A mandatory exceptions.
5. Delete the claim that a public licence alone creates an access condition or binds non-assenting users.
6. Gate QuoxSkills access behind affirmative assent, preserve versioned acceptance evidence, and use the marketplace covenant above.
7. Repair the Open attribution condition and termination mechanism.
8. Repair NoTrain’s Train and RAG boundary, cure structure, downstream direct-grant language, and irrevocability.
9. Rebuild Reserved around documented authorisation, limited internal use, copying permission, and confidentiality. Do not use it for trade-secret material without an executed agreement.
10. Replace all warranty and liability clauses with consumer-safe, non-excludable-liability wording.
11. Add precise attribution, modification notice, no-endorsement, trademark, patent, and moral-rights provisions.
12. Remove or correct false CLI, TDMRep, provenance, AIPREF, AI Act, and marketplace-enforceability statements in the specification and launch article.
