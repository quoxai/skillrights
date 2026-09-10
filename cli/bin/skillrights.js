#!/usr/bin/env node
import { runInit } from '../lib/init.js';
import { runCheck } from '../lib/check.js';
import { explain } from '../lib/explain.js';
import { runSign } from '../lib/sign.js';
import { runVerify } from '../lib/verify.js';
import { formatPosture } from '../lib/posture.js';
import { VARIANT_KEYS } from '../lib/identifiers.js';

const USAGE = `skillrights - declare and verify AI agent skill licence terms

Usage:
  skillrights init [dir] [--license open|notrain|reserved] [--author "Name"] [--yes]
  skillrights check [dir] [--format text|json]
  skillrights explain [identifier]
  skillrights sign [dir] [--key ~/.ssh/id_ed25519]
  skillrights verify [dir] [--signers <allowed_signers_file>] [--identity <name>]
  skillrights posture

No telemetry, no accounts, no network access. Everything runs locally.`;

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
        console.log(result.ok ? 'PASS' : 'FAIL');
        for (const f of result.findings) console.log(`- ${f}`);
        process.exit(result.ok ? 0 : 1);
        break;
      }

      case 'posture': {
        console.log(formatPosture());
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
