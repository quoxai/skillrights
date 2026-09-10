# Mirroring and independently verifying the SkillRights registry log

The registry is an append-only transparency log. You do not have to trust
it: you can hold a full copy, recompute the Merkle root yourself, and check
the external anchors with standard tooling. This document is the recipe.

## Mirror the log

```
curl 'https://registry.skillrights.org/api/v1/log/entries?start=0&limit=500'
```

Page `start` forward until you have `size` entries. Each entry is
`{ record, leaf }` where `leaf` is the hex RFC 6962 leaf hash of the
canonicalised record (JSON with recursively sorted keys, no whitespace):
`leaf = SHA-256(0x00 || canonicalJSON(record))`. Interior nodes are
`SHA-256(0x01 || left || right)` with the split point at the largest power
of two less than n. Recompute the root over all leaves in order and it must
equal the `root` in:

```
curl https://registry.skillrights.org/api/v1/log/tree-head
```

The tree head is signed (Ed25519) by the log key; fetch the key and its id
from `/api/v1/log/key`. A mirror that stores each day's tree head can prove
append-only behaviour: every later tree must contain the earlier one as a
prefix (a shrinking or rewritten log cannot produce consistent roots).

## Check the external anchors

The log must never be its own only witness, so each new root is anchored
outside our infrastructure:

- **OpenTimestamps**: the root is submitted to public calendar servers,
  which batch it into the Bitcoin blockchain. Proof files:
  `/api/v1/log/anchors` lists them; download raw with
  `/api/v1/log/anchor/<size>-<root>.ots`. Verify with the standard client
  (`pip install opentimestamps-client`):

  ```
  ots info <size>-<root>.ots        # inspect the proof
  ots verify -d <root> <size>-<root>.ots   # verify the digest path
  ```

  A fresh anchor reports "pending confirmation" until the calendars commit
  a Bitcoin transaction (typically hours); the registry upgrades the file
  in place once committed, after which verification is independent of both
  the registry and the calendars.

- **RFC 3161**: the same root is countersigned by a public Time Stamping
  Authority. Download `/api/v1/log/anchor/<size>-<root>.tsr` and verify
  with OpenSSL against the TSA's published certificates:

  ```
  openssl ts -reply -in <size>-<root>.tsr -text
  openssl ts -verify -digest <root> -in <size>-<root>.tsr \
      -CAfile cacert.pem -untrusted tsa.crt
  ```

## What this proves, and what it does not

An anchored root proves the entire log contents, and therefore every
registration in it, existed at the anchored time. Combined with a
registrant's inclusion proof (bundled in their receipt), it proves a
specific artefact hash existed by then, without trusting skillrights.org.
It does not prove legal ownership, authorship, or originality of anything
registered; the registry records evidence, it does not adjudicate.
