import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { scanSource, SCAN_SOURCES } from '../lib/intake.js';
import { requireIntakeWorkspaceOrExit } from './intake-workspace.js';

export async function intakeScanCommand(opts) {
  const root = requireIntakeWorkspaceOrExit(opts);

  if (!opts.source) {
    const msg = `--source is required. Supported scan sources: ${SCAN_SOURCES.join(', ')}`;
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
    } else {
      console.log(chalk.red(msg));
    }
    process.exit(1);
  }

  if (!opts.file && !opts.stdin) {
    const msg = 'one of --file or --stdin is required';
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
    } else {
      console.log(chalk.red(msg));
    }
    process.exit(1);
  }

  if (opts.file && opts.stdin) {
    const msg = '--file and --stdin are mutually exclusive';
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
    } else {
      console.log(chalk.red(msg));
    }
    process.exit(1);
  }

  let snapshot;
  try {
    let raw;
    if (opts.file) {
      raw = readFileSync(resolve(opts.file), 'utf8');
    } else {
      raw = readFileSync(0, 'utf8');
    }
    snapshot = JSON.parse(raw);
  } catch (err) {
    const msg = opts.file
      ? `failed to read snapshot from ${opts.file}: ${err.message}`
      : `failed to read snapshot from stdin: ${err.message}`;
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
    } else {
      console.log(chalk.red(msg));
    }
    process.exit(opts.file && err.code === 'ENOENT' ? 2 : 1);
  }

  const result = scanSource(root, opts.source, snapshot);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log('');
    console.log(chalk.green(`  Scan complete: ${result.scanned} item(s) processed`));
    console.log(`  Created:      ${result.created}`);
    console.log(`  Deduplicated: ${result.deduplicated}`);
    if (result.rejected > 0) {
      console.log(chalk.yellow(`  Rejected:     ${result.rejected}`));
    }
    console.log('');
  } else {
    console.log(chalk.red(`  ${result.error}`));
  }

  process.exit(result.exitCode);
}
