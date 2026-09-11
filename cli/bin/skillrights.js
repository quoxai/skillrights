#!/usr/bin/env node
import { runInit } from '../lib/init.js';
import { runCheck } from '../lib/check.js';
import { explain } from '../lib/explain.js';
import { runSign } from '../lib/sign.js';
import { runVerify } from '../lib/verify.js';
import { formatPosture } from '../lib/posture.js';
import { runRegister, runReceipt } from '../lib/register.js';
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

\`verify\` reports two separate statuses: integrity (do these files still
match the manifest) and signature (absent, present but unchecked, verified,
or failed). A verified signature relates the signed manifest to a key. It
does not establish identity, authorship or ownership: relating a key to a
person is separate evidence this tool does not hold.

No telemetry, no accounts. Every command runs locally and offline, except
\`register\`, which sends ONLY evidence (hash, signature, licence, claimed
author; plus name/description with --public) to the registry you name.
Skill content never leaves the machine. Registrations go into a PUBLIC
append-only log in both modes; --public additionally lists the skill in the
directory, and the default (unlisted) does not. A registration proves
existence at a time and a signer's claim; it does not prove legal ownership.`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
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
        if (result.signatureVerified !== null) {
          console.log(
            `Signature:  ${result.signatureVerified
              ? 'verified by the registry against the registered hash'
              : 'submitted and recorded verbatim; the registry could not verify it against the registered hash'}`
          );
        }
        console.log(`Registry:   ${result.registry} (log key ${result.keyId}, tree size ${result.treeSize})`);
        console.log(`Receipt:    ${result.receiptPath} (verified, and checked against this submission, before saving)`);
        console.log('');
        console.log('This proves that this exact artefact existed at this time, and records the claim you submitted with it. It does not prove legal ownership, authorship or originality.');
        break;
      }

      case 'receipt': {
        const result = runReceipt(positional);
        if (!result.found) {
          console.error(`No receipt found at ${result.receiptPath}. Run \`skillrights register\` first.`);
          process.exit(1);
        }
        if (result.ok) {
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
                ? 'verified by the registry against the registered hash'
                : 'submitted; NOT verified by the registry against the registered hash'}`
            );
          } else {
            console.log('Signature:  none in this record');
          }
          console.log(`Artifact:   ${LOCAL_LABELS[result.localArtifact]}`);
          console.log('Inclusion proof and tree head signature verify against the bundled log key.');
          console.log('To confirm authenticity online, compare the log key id with GET /api/v1/log/key.');
        } else {
          console.error(`Receipt FAILED verification: ${result.reason}`);
          process.exit(1);
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
