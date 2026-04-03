import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findProjectRoot } from '../lib/config.js';
import { recordEvent } from '../lib/intake.js';

export async function intakeRecordCommand(opts) {
  const root = findProjectRoot(process.cwd());
  if (!root) {
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, error: 'agentxchain.json not found' }, null, 2));
    } else {
      console.log(chalk.red('agentxchain.json not found'));
    }
    process.exit(2);
  }

  let payload;
  try {
    payload = parsePayload(opts);
  } catch (err) {
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, error: err.message }, null, 2));
    } else {
      console.log(chalk.red(err.message));
    }
    process.exit(1);
  }

  const result = recordEvent(root, payload);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    if (result.deduplicated) {
      console.log('');
      console.log(chalk.yellow(`  Event already recorded: ${result.event.event_id} (deduplicated)`));
      if (result.intent) {
        console.log(chalk.dim(`  Linked intent: ${result.intent.intent_id} (${result.intent.status})`));
      }
    } else {
      console.log('');
      console.log(chalk.green(`  Recorded event ${result.event.event_id}`));
      console.log(chalk.green(`  Created intent ${result.intent.intent_id} (detected)`));
    }
    console.log('');
  } else {
    console.log(chalk.red(`  ${result.error}`));
  }

  process.exit(result.exitCode);
}

function parsePayload(opts) {
  if (opts.file) {
    const raw = readFileSync(resolve(opts.file), 'utf8');
    return JSON.parse(raw);
  }

  if (opts.stdin) {
    const raw = readFileSync(0, 'utf8');
    return JSON.parse(raw);
  }

  if (opts.source) {
    if (!opts.signal) throw new Error('--source requires --signal');
    if (!opts.evidence) throw new Error('--source requires --evidence');

    const signal = JSON.parse(opts.signal);
    let evidence;
    if (Array.isArray(opts.evidence)) {
      evidence = opts.evidence.map(e => JSON.parse(e));
    } else {
      evidence = [JSON.parse(opts.evidence)];
    }

    return {
      source: opts.source,
      signal,
      evidence,
      category: opts.category || undefined,
    };
  }

  throw new Error('one of --file, --stdin, or --source is required');
}
