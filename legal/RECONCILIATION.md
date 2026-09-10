# Licence review reconciliation, 2026-09-10

Reviewer A: Claude Fable 5 (legal/REVIEW_CLAUDE.md). Reviewer B: Codex, xhigh reasoning (legal/REVIEW_CODEX.md). Both worked independently from legal/COUNSEL_BRIEF.md. This document records the reconciliation and the decisions applied to the 1.0 texts. **Neither review is advice from qualified counsel; professional review remains planned (owner decision 2026-09-10: deferred, not cancelled).**

## Agreements (adopted without debate)
Self-contained texts, no cross-licence incorporation (A-D1 / B-2). Licensor/You definitions (A-D2 / B-3). RAG/retrieval carve-out inside the Train definition (A-D3 / B-11, B's tighter wording adopted). Cure-period termination with training non-curable (A-D5 / B-12, B-8). Reserved recipient must be a legal person with AI systems covered as instruments (A-D6 / B-13). Trademark non-grant (A-D9 / B-7). Savings-clause warranty language (A-Q7 / B-9).

## Reviewer B right, Reviewer A missed (adopted)
1. **Identifier hygiene.** Draft texts carried final `-1.0` identifiers. Resolution: final 1.0 texts are cut now (public draft exposure was hours, adoption effectively zero); drafts stay archived at their `-draft` URLs with SHA-256 hashes recorded below and a superseded notice; the public diff is this repo's history.
2. **Mandatory exceptions.** EU DSM Art 3 (scientific research) is not defeated by an Art 4(3) reservation, and UK s.29A is a separate regime. The 1.0 texts say so; summaries no longer imply "nobody may train".
3. **Qualified Art 4(3) wording.** "To the extent that the Licensor is the relevant rightholder..." replaces flat self-certification. B's proposed reference to a not-yet-existing "TDM Signal Profile" is NOT adopted in the licence text (B itself warned not to ship an unpublished reference); companion signals stay in the spec as documentation, and a frozen profile is future work.
4. **Patent and moral rights** provisions added to all three.
5. **Confidentiality section** added to Reserved, with B's note preserved: a public licence file cannot itself maintain trade-secret status; gated access plus executed agreement for genuinely secret material.
6. **Open needed a termination/reinstatement mechanism** and attribution as an express condition.
7. **Spec corrections**: EU/UK/US/marketplace wording replaced with B's calibrated block; the false "CLI emits companion signals" claim corrected (only the web generator offers them); provenance claim softened (a signature proves key possession, not legal identity or date); AIPREF alignment claim softened to design intent toward draft vocabularies.
8. **Generator TDMRep output was schema-invalid** (W3C CG-FINAL requires rule objects with `location` and numeric `tdm-reservation`). Fixed in the generator.

## Reviewer B proposals modified or declined (with reasons)
1. **Article closing triad kept.** B would rewrite "Your data belongs to you..." into qualified legal prose. Declined: it is the manifesto close of an opinion piece, "should" carries the aspiration, and no reader takes a peroration as legal advice. The five other article wording fixes B proposed are all adopted.
2. **Reserved affiliates.** A proposed including affiliates by default; B excludes them unless the authorisation record names them. B adopted (licensor-protective default is correct for this variant).
3. **Fresh non-1.0 identifier.** B preferred abandoning the 1.0 identifiers entirely. Declined as disproportionate given hours-old exposure; the archive+hash+diff route B allowed as alternative is taken instead.

## Draft archive (immutable, superseded by 1.0)
SHA-256 of the archived draft texts recorded at cut time in spec/licenses/DRAFT_ARCHIVE.md.

## Outcome
Three self-contained 1.0 texts in spec/licenses/, published at /open/1.0, /notrain/1.0, /reserved/1.0 with the draft pages retained and marked superseded. Banners now read: "1.0. Adversarially reviewed by two independent AI reviewers at high effort; not advice from qualified counsel; professional review planned." Remaining professional-work items that AI review cannot substitute: trademark clearance search, and counsel sign-off when funds allow.
