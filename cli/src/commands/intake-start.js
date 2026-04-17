import chalk from 'chalk';
import { startIntent } from '../lib/intake.js';
import { requireIntakeWorkspaceOrExit } from './intake-workspace.js';

export async function intakeStartCommand(opts) {
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

  const result = startIntent(root, opts.intent, {
    role: opts.role || undefined,
    allowTerminalRestart: opts.restartCompleted === true,
  });

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log('');
    console.log(chalk.green(`  Started intent ${result.intent.intent_id}`));
    console.log(`  Run:    ${result.run_id}`);
    console.log(`  Turn:   ${result.turn_id}`);
    console.log(`  Role:   ${result.role}`);
    console.log(chalk.dim(`  Status: planned \u2192 executing`));
    console.log('');
  } else if (result.missing) {
    console.log('');
    console.log(chalk.red(`  Cannot start intent ${opts.intent}`));
    console.log(chalk.red('  Recorded planning artifacts are missing on disk:'));
    for (const m of result.missing) {
      console.log(chalk.red(`    ${m}`));
    }
    console.log('');
  } else {
    console.log(chalk.red(`  ${result.error}`));
  }

  process.exit(result.exitCode);
}
