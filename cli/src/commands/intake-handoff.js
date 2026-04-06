import chalk from 'chalk';
import { handoffIntent } from '../lib/intake.js';
import { requireIntakeWorkspaceOrExit } from './intake-workspace.js';

export async function intakeHandoffCommand(opts) {
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

  if (!opts.coordinatorRoot) {
    const msg = '--coordinator-root <path> is required';
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
    } else {
      console.log(chalk.red(msg));
    }
    process.exit(1);
  }

  if (!opts.workstream) {
    const msg = '--workstream <id> is required';
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
    } else {
      console.log(chalk.red(msg));
    }
    process.exit(1);
  }

  const result = handoffIntent(root, opts.intent, {
    coordinatorRoot: opts.coordinatorRoot,
    workstreamId: opts.workstream,
  });

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log('');
    console.log(chalk.green(`  Handed off intent ${result.intent.intent_id}`));
    console.log(`  Workstream: ${result.intent.target_workstream.workstream_id}`);
    console.log(`  Super Run:  ${result.super_run_id}`);
    console.log(`  Handoff:    ${result.handoff_path}`);
    console.log(chalk.dim('  Status:     planned → executing (coordinator-managed)'));
    console.log('');
  } else {
    console.log(chalk.red(`  ${result.error}`));
  }

  process.exit(result.exitCode);
}
