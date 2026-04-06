import chalk from 'chalk';
import { resolveIntent } from '../lib/intake.js';
import { requireIntakeWorkspaceOrExit } from './intake-workspace.js';

export async function intakeResolveCommand(opts) {
  const root = requireIntakeWorkspaceOrExit(opts);

  if (!opts.intent) {
    const msg = '--intent <id> is required';
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
    } else {
      console.log(chalk.red(msg));
    }
    process.exit(1);
  }

  const result = resolveIntent(root, opts.intent);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log('');
    if (result.no_change) {
      console.log(chalk.yellow(`  Intent ${opts.intent} — run still ${result.run_outcome}, no transition`));
    } else {
      console.log(chalk.green(`  Resolved intent ${opts.intent}`));
      console.log(chalk.dim(`  ${result.previous_status} → ${result.new_status}`));
      console.log(chalk.dim(`  Run outcome: ${result.run_outcome}`));
    }
    console.log('');
  } else {
    console.log(chalk.red(`  ${result.error}`));
  }

  process.exit(result.exitCode);
}
