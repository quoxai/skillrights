# SkillRights Registry, Witness and Directory — design draft 0.1

**Status: v1 SHIPPED except the Directory (2026-09-10).** Live: the Registry
service at registry.skillrights.org (append-only JSONL transparency log,
RFC 6962 inclusion proofs, Ed25519 signed tree heads, SRIDs, private/public
modes, free, no accounts), `skillrights register` + `skillrights receipt` in
CLI 0.2.0 on npm, the first registration
(sr:skill:01M26A1FG6KZ0A994WBQJEWY7Q, the skillrights skill itself; receipt
committed in-repo), and EXTERNAL ANCHORING (registry 0.2.0): every tree head
is RFC 3161 countersigned (verified live with `openssl ts -verify`) and
submitted to three public OpenTimestamps calendars (verified live with the
reference `ots` client; proofs auto-upgrade in place once Bitcoin-committed),
plus the mirroring endpoints (`/api/v1/log/entries`, `/api/v1/log/anchors`)
and registry/MIRRORING.md. NOT yet live: the Directory page (phase 17).
Drafted 2026-09-10 from the owner's ruling ("can't prove who owns it, but
an independently witnessed hash can prove it existed at a certain time").

## The one-sentence idea

A licence declaration states terms. A witnessed registration establishes
that a specific artefact existed at a specific time and that a particular
identity claimed and signed it. Together they turn "trust me, I wrote this
first" into presentable evidence.

## The ruling that shapes everything

The Phase One blueprint placed the registry on the Quox side ("local
signing in open CLI; registry in Quox"; "this is the moat"). The owner's
2026-09-10 ruling moves it: **the Registry, Witness and Directory are part
of the open standard, and registration is free.** The reasoning is the
Sigstore/Let's Encrypt shape: a proof-of-existence layer is worth more as
infrastructure everyone cites than as a paywalled feature, and the registry
everyone cites IS the position. Quox's commercial layer moves up-stack
(org-identity signing, WARD-receipted governance, marketplace enforcement,
enterprise vault skills); `quox skill protect` becomes a governed consumer
of the open registry, never a fork of it.

Cost honesty: free-forever is feasible because records are hashes and
signatures (bytes, not content), anchoring is batchable, and the store is
append-only. If it ever costs real money, the answer is batching and
mirrors, not a price tag.

## Receipt verification hardening (2026-09-10)

A cross-implementation agreement test (`registry/test/crossImplementation.test.js`)
found that all three verifiers accepted a receipt whose `leafIndex` had been
altered. The walk used the `side` values carried in the proof, so the claimed
index did no work beyond a bounds check, and a holder could misstate their
position in the log while the receipt still verified. Position is part of what
the log claims to establish (chronology between registrations), so this was a
real hole, if a narrow one: it never permitted forging content, a timestamp or
a signature, because those are inside the hashed bytes.

Closed in all three implementations the same day, in two complementary ways:
the sides are now DERIVED from `(index, size)` and the proof length is checked
(proper RFC 6962 verification), and `leafIndex` is asserted to equal the
record's own `seq`, which is inside the hashed bytes. Honestly issued receipts
are unaffected, including every receipt issued before the fix: both existing
production receipts re-verify unchanged.

## What a registration is

```
sha256 of the canonicalised skill directory   (the existing sign format)
+ licence identifier at time of registration
+ claimed author identity
+ signature (ssh-keygen -Y, the existing scheme; no new key management)
+ registry timestamp
+ independent witnesses (see below)
= SRID  sr:skill:<ULID>       (permanent identifier)
```

Two modes:
- **Private registration** (default): hash, signature, licence, timestamp,
  optional pseudonymous key identity. The registry NEVER receives the
  skill content. Not searchable unless the holder later chooses. Years
  later, present the file, anyone hashes it: exact match, existed by then.
- **Public registration**: the same evidence plus metadata (name, author,
  description, optional repository URL). Feeds the Directory.

Versioning: a new hash is a new registration; `supersedes: sha256:...`
records claimed lineage. Lineage and derivation (`derived_from`) are
CLAIMED, recorded verbatim, never adjudicated.

## Witnessing (the Volt/Ward part)

The registry must not be its own only witness. "Our database says
Tuesday" proves nothing if we are the ones saying it. Layered, phased:

1. **v1: SkillRights transparency log.** Append-only Merkle log over all
   registrations (Rekor's shape). Signed tree heads published; log
   mirrorable by anyone; inclusion proofs returned to the registrant.
2. **v1: OpenTimestamps anchoring.** Batched OTS attestation of the tree
   head (free, anchors into Bitcoin, verification survives us entirely).
3. **v2: RFC 3161 TSA countersignature** of tree heads (purpose-built
   third-party proof-of-existence; free TSAs exist to start).
4. **Later, optional: Rekor submission** for ecosystem interop.

The registrant's receipt bundles: registry record, inclusion proof, OTS
proof, and (v2) the TSA token, so a holder can verify offline with
standard tooling even if skillrights.org disappears. Don't record the
claim; record the evidence for the claim.

## What it proves and what it does not (binding honesty text)

Proves: that this exact artefact existed by this time, and that the holder
of this key claimed and signed it then. Establishes chronology between
registrations.

Does NOT prove: legal ownership, authorship, or originality. Anyone can
register a file they did not write; the registry records first-seen
evidence, it does not adjudicate disputes. Registration is evidence for a
tribunal, not a verdict. Every surface that mentions the registry carries
this paragraph's substance.

The upgraded position (approved direction for future copy, echoing
Codex's published line): "A licence declaration does not prove ownership.
A witnessed registration can, however, establish that a specific artefact
existed at a specific time and that a particular identity claimed or
signed it."

## CLI shape

`skillrights register [./skill-dir] [--public] [--supersedes <sha256>]`
- Hash + sign locally (existing code paths), POST only the evidence
  (hash, sig, licence, metadata if public) to the registry API, print the
  SRID + receipt, save the receipt file beside the signature.
- Zero-dependency constraint holds: node's stdlib https is enough.
- **Opt-in honesty**: every existing verb (init/check/explain/sign/verify/
  posture) stays fully offline; `register` is the ONLY verb that touches
  the network, it says so, and the "no account, no telemetry, nothing
  phones home" claim on /adopt gets scoped to the offline verbs the day
  register ships. No account still holds: identity is the signing key.
- `skillrights verify` grows: given a receipt, verify inclusion proof +
  OTS proof offline.

## Directory (opt-in discovery)

skillrights.org/registry: search over PUBLIC registrations only. Listing
shows: name, author, licence + witnessed date + signature badges, version
count/lineage, repository link if given. Private registrations are counted
in aggregate, never listed. This is the human-facing third; the protocol
does not depend on it.

## Quox layer on top (the moat, moved up-stack)

- `quox skill protect` = org-identity signing + WARD-witnessed receipt in
  the org's evidence chain + automatic open-registry registration. Wraps
  the open CLI, consumes its formats.
- Sovereign Skill badge = declared + signed + witnessed (open registry) +
  org-receipted (Quox). Two badges, two meanings, never conflated.
- Marketplace enforcement, enterprise vault skills, disclosure ledger:
  unchanged from the product plan, now citing SRIDs.

## Build order sketch

1. Registry API + store (append-only, hash-only records) + Merkle log +
   receipts. Smallest real artefact first.
2. `skillrights register` + receipt verification in the CLI.
3. OTS batching. 4. Directory page. 5. RFC 3161. 6. `quox skill protect`
   integration (product stream phase 10 consumes this instead of owning
   the registry).

## Open questions (decide before build)

- Hosting home for the registry service (hostnode-prod beside the static
  site, or a dedicated box) and its backup/restore coverage (RECOVERABLE
  dimension applies from day one).
- Key rotation story for registrants (allowed-signers continuity).
- Abuse handling for public listings (squatting, impersonation): moderate
  the Directory, never the log (the log is append-only evidence; the
  Directory is edited discovery).
- Spec versioning: registry becomes a numbered section of SPEC.md v0.3.
