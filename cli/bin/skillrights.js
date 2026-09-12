#!/usr/bin/env node
import { runInit } from '../lib/init.js';
import { runCheck } from '../lib/check.js';
import { explain } from '../lib/explain.js';
import { runSign } from '../lib/sign.js';
import { runVerify } from '../lib/verify.js';
import { formatPosture } from '../lib/posture.js';
import { runRegister, runReceipt, runReceiptUpgrade, runReceiptExtractOts } from '../lib/register.js';
import { VARIANT_KEYS } from '../lib/identifiers.js';

const USAGE = `skillrights - declare and verify AI agent skill licence terms

Usage:
  skillrights init [dir] [--license open|notrain|reserved] [--author "Name"] [--yes]
  skillrights check [dir] [--format text|json]
  skillrights explain [identifier]
  skillrights sign [dir] [--key ~/.ssh/id_ed25519]
  skillrights verify [dir] [--signers <allowed_signers_file>] [--identity <name>]
  skillrights posture
  skillrights register [dir] [--public] [--registry <url>] [--supersedes <sha256>] [--repository <url>]
  skillrights receipt [dir]
  skillrights receipt --upgrade [dir] [--registry <url>]
  skillrights receipt --offline [dir]
  skillrights receipt --extract-ots [dir]

\`verify\` reports two separate statuses: integrity (does this directory hold
exactly the manifest's files, unchanged and with nothing added) and signature
(absent, present but unchecked, verified, or failed). A verified signature relates the signed manifest to a key. It
does not establish identity, authorship or ownership: relating a key to a
person is separate evidence this tool does not hold.

No telemetry, no accounts. Every command runs locally and offline, except
\`register\`, which sends ONLY evidence (hash, signature, licence, claimed
author; plus name/description with --public) to the registry you name.
Skill content never leaves the machine. Registrations go into a PUBLIC
append-only log in both modes; --public additionally lists the skill in the
directory, and the default (unlisted) does not. A registration proves
existence at a time and a signer's claim; it does not prove legal ownership.`;

// Flags that are ALWAYS boolean and must never swallow the following token as
// their value. Without this, `receipt --upgrade <dir>` (the order the usage
// documents) bound the directory to `upgrade` and left no positional, so the
// command looked in the cwd and reported "no receipt found".
const BOOLEAN_FLAGS = new Set(['public', 'yes', 'upgrade', 'offline', 'extract-ots']);

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!BOOLEAN_FLAGS.has(key) && next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    console.log(USAGE);
    process.exit(command ? 0 : 1);
  }

  const { positional, flags } = parseArgs(rest);

  // `skillrights <command> --help` must NEVER execute the command. Learned
  // the hard way 2026-09-12: `register --help` wrote a junk record into the
  // production append-only log, which cannot be deleted. Help is help.
  if (flags.help || flags.h) {
    console.log(USAGE);
    process.exit(0);
  }

  try {
    switch (command) {
      case 'init': {
        const result = await runInit(positional, flags);
        console.log(`SkillRights init: ${result.dir}`);
        console.log(`Licence: ${result.identifier}`);
        console.log('');
        for (const m of result.messages) console.log(`- ${m}`);
        console.log('');
        console.log('Next steps:');
        console.log(`  1. Review LICENSES/${result.identifier}.txt.`);
        console.log('  2. Commit these changes with your skill.');
        console.log('  3. Run "skillrights check" to confirm the declaration is consistent.');
        console.log('  4. Run "skillrights explain" to see what this licence permits and reserves.');
        break;
      }

      case 'check': {
        const result = runCheck(positional);
        if (flags.format === 'json') {
          console.log(JSON.stringify({ ok: result.ok, findings: result.findings }));
        } else {
          console.log(result.ok ? 'PASS' : 'FAIL');
          for (const f of result.findings) console.log(`- ${f}`);
        }
        process.exit(result.ok ? 0 : 1);
        break;
      }

      case 'explain': {
        if (positional[0] === undefined) {
          console.log(explain());
        } else if (!VARIANT_KEYS.includes(positional[0]) && !positional[0].startsWith('LicenseRef-')) {
          console.error(`Unknown identifier "${positional[0]}". Use one of: ${VARIANT_KEYS.join(', ')}, or a full LicenseRef-SkillRights-*-1.0 identifier.`);
          process.exit(1);
        } else {
          console.log(explain(positional[0]));
        }
        break;
      }

      case 'sign': {
        const result = runSign(positional, flags);
        console.log(`SkillRights sign: ${result.dir}`);
        console.log(`Manifest: ${result.manifestPath}`);
        console.log(`Files hashed: ${result.fileCount}`);
        if (result.identifier) console.log(`Identifier: ${result.identifier}`);
        if (result.author) console.log(`Author: ${result.author}`);
        if (result.signed) {
          console.log(`Signature: ${result.sigPath}`);
        } else {
          console.log(`Signature skipped: ${result.signSkippedReason}`);
          console.log('The manifest was still written and can be verified for content integrity without a signature.');
        }
        break;
      }

      case 'verify': {
        const result = runVerify(positional, flags);
        const SIGNATURE_LABELS = {
          absent: 'absent (unsigned: integrity only)',
          present: 'present, NOT checked (pass --signers to check it)',
          verified: 'verified against the allowed signers file',
          failed: 'present and FAILED verification',
        };
        console.log(result.ok ? 'PASS' : 'FAIL');
        console.log(`- integrity: ${result.status.integrity.toUpperCase()}`);
        console.log(`- signature: ${SIGNATURE_LABELS[result.status.signature] || result.status.signature}`);
        for (const f of result.findings) console.log(`- ${f}`);
        process.exit(result.ok ? 0 : 1);
        break;
      }

      case 'posture': {
        console.log(formatPosture());
        break;
      }

      case 'register': {
        const result = await runRegister(positional, flags);
        console.log(`Registered: ${result.srid}`);
        console.log(`Hash:       sha256:${result.hash}`);
        console.log(`Mode:       ${result.mode}${result.mode === 'unlisted' ? ' (in the public log, not in the directory)' : ''}`);
        if (result.license) console.log(`Licence:    ${result.license}`);
        console.log(`Signed:     ${result.signed ? 'yes' : `no (${result.signSkippedReason})`}`);
        // Never upgraded locally: this line only says "verified" when the
        // registry's own signed record says signatureVerified true.
        if (result.signatureVerified !== null) {
          console.log(
            `Signature:  ${result.signatureVerified
              ? 'signature verified by registry (signed the registered hash with your ed25519 SSH key)'
              : 'signature submitted (not verifiable by the registry)'}`
          );
          if (result.signatureVerified !== true && result.hashSignatureSkippedReason) {
            console.log(`            Manifest-file signed only: ${result.hashSignatureSkippedReason}`);
          }
        }
        console.log(`Registry:   ${result.registry} (log key ${result.keyId}, tree size ${result.treeSize})`);
        console.log(`Receipt:    ${result.receiptPath} (verified, and checked against this submission, before saving)`);
        console.log('');
        console.log('This proves that this exact artefact existed at this time, and records the claim you submitted with it. It does not prove legal ownership, authorship or originality.');
        break;
      }

      case 'receipt': {
        if (flags.upgrade) {
          const up = await runReceiptUpgrade(positional, flags);
          if (up.state === 'no-receipt') {
            console.error(`No receipt found at ${up.receiptPath}. Run \`skillrights register\` first.`);
            process.exit(1);
          }
          if (up.state === 'pending') {
            console.log('Not anchored to Bitcoin yet.');
            console.log(up.reason);
            console.log('Anchoring runs on a cycle; try `skillrights receipt --upgrade` again later.');
            break;
          }
          if (up.state === 'already') {
            console.log(`Already anchored: Bitcoin block ${up.bitcoinHeights.join(', ')} (tree size ${up.size}).`);
            console.log('Verify offline with `skillrights receipt --offline`.');
            break;
          }
          console.log(`Anchored: this receipt now verifies against Bitcoin block ${up.bitcoinHeights.join(', ')}.`);
          console.log(`Merkle root ${up.root} (tree size ${up.size}) is committed into that block by the embedded OpenTimestamps proof.`);
          console.log(`Saved to ${up.receiptPath}. It no longer needs the registry to prove it.`);
          console.log('Verify offline with `skillrights receipt --offline`.');
          break;
        }

        if (flags['extract-ots']) {
          const ex = runReceiptExtractOts(positional);
          if (ex.state === 'no-receipt') {
            console.error(`No receipt found at ${ex.receiptPath}. Run \`skillrights register\` first.`);
            process.exit(1);
          }
          if (ex.state === 'no-anchor') {
            console.error(`No Bitcoin anchor to extract: ${ex.reason}`);
            console.error('Run `skillrights receipt --upgrade` first.');
            process.exit(1);
          }
          console.log(`Wrote ${ex.otsPath}`);
          console.log('');
          console.log('Confirm it against Bitcoin yourself, with no help from SkillRights.');
          console.log('Install the independent OpenTimestamps client: pip install opentimestamps-client');
          console.log('');
          console.log('If you run a Bitcoin node:');
          console.log(`  ots verify -d ${ex.digest} ${ex.otsPath}`);
          console.log('Otherwise, read the proof and check the block on any explorer:');
          console.log(`  ots info ${ex.otsPath}   # shows BitcoinBlockHeaderAttestation(${ex.bitcoinHeights[0]}) and the expected merkle root`);
          console.log(`  then confirm block ${ex.bitcoinHeights.join(', ')} shows that same merkle root, e.g. https://mempool.space/block/${ex.bitcoinHeights[0]}`);
          break;
        }

        const result = runReceipt(positional);
        if (!result.found) {
          console.error(`No receipt found at ${result.receiptPath}. Run \`skillrights register\` first.`);
          process.exit(1);
        }
        if (!result.ok) {
          console.error(`Receipt FAILED verification: ${result.reason}`);
          process.exit(1);
        }
        const LOCAL_LABELS = {
          match: 'matches the manifest in this directory',
          mismatch: 'does NOT match the manifest in this directory (the skill changed or was re-signed since)',
          'not-checked': 'not compared: no manifest in this directory to compare against',
        };
        console.log(`Receipt OK: ${result.srid}`);
        console.log(`Registered: ${result.ts}`);
        console.log(`Mode:       ${result.mode}${result.mode === 'unlisted' ? ' (in the public log, not in the directory)' : ''}`);
        console.log(`Registry:   ${result.registry} (unsigned bundle metadata; log key ${result.keyId})`);
        if (result.hasSignature) {
          console.log(
            `Signature:  ${result.signatureVerified === true
              ? 'signature verified by registry (checked against the registered hash)'
              : 'signature submitted (not verifiable by the registry)'}`
          );
        } else {
          console.log('Signature:  none in this record');
        }
        console.log(`Artifact:   ${LOCAL_LABELS[result.localArtifact]}`);
        console.log('Inclusion proof and tree head signature verify against the bundled log key.');

        const anchor = result.anchor;
        if (anchor && anchor.ok) {
          console.log('');
          console.log(`Bitcoin:    anchored in block ${anchor.bitcoinHeights.join(', ')} (verified offline, no registry needed).`);
          console.log(`            Merkle root ${anchor.root} (tree size ${anchor.size}) is committed to Bitcoin by the embedded OpenTimestamps proof.`);
          console.log('            Confirm it against Bitcoin yourself, without us:');
          console.log('              skillrights receipt --extract-ots   # writes the .ots + the exact commands');
          console.log(`              or open https://mempool.space/block/${anchor.bitcoinHeights[0]}`);
        } else if (flags.offline) {
          console.error('');
          console.error(`No Bitcoin anchor in this receipt: ${anchor ? anchor.reason : 'none'}`);
          console.error('Run `skillrights receipt --upgrade` once the registration has been anchored (usually within a day).');
          process.exit(1);
        } else {
          console.log('');
          console.log('Bitcoin:    not anchored in this receipt yet. Run `skillrights receipt --upgrade` to embed the Bitcoin proof,');
          console.log('            after which it verifies with no registry at all (`skillrights receipt --offline`).');
        }
        break;
      }

      default:
        console.error(`Unknown command "${command}".`);
        console.log('');
        console.log(USAGE);
        process.exit(1);
    }
  } catch (err) {
    console.error(`skillrights: ${err.message}`);
    process.exit(1);
  }
}

main();
