import chalk from 'chalk';
import { approveIntent } from '../lib/intake.js';
import { requireIntakeWorkspaceOrExit } from './intake-workspace.js';

export async function intakeApproveCommand(opts) {
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

  const result = approveIntent(root, opts.intent, {
    approver: opts.approver || undefined,
    reason: opts.reason || undefined,
  });

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log('');
    console.log(chalk.green(`  Approved intent ${result.intent.intent_id}`));
    console.log(chalk.dim(`  Approver: ${result.intent.approved_by}`));
    console.log(chalk.dim(`  Status: triaged → approved`));
    console.log('');
  } else {
    console.log(chalk.red(`  ${result.error}`));
  }

  process.exit(result.exitCode);
}
