import chalk from 'chalk';
import { triageIntent } from '../lib/intake.js';
import { requireIntakeWorkspaceOrExit } from './intake-workspace.js';

export async function intakeTriageCommand(opts) {
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

  const fields = {
    suppress: opts.suppress || false,
    reject: opts.reject || false,
    reason: opts.reason || null,
    priority: opts.priority || null,
    template: opts.template || null,
    charter: opts.charter || null,
    acceptance_contract: opts.acceptance
      ? opts.acceptance.split(',').map(s => s.trim()).filter(Boolean)
      : [],
  };

  const result = triageIntent(root, opts.intent, fields);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log('');
    console.log(chalk.green(`  Intent ${result.intent.intent_id} → ${result.intent.status}`));
    if (result.intent.priority) {
      console.log(chalk.dim(`  Priority: ${result.intent.priority}  Template: ${result.intent.template}`));
    }
    console.log('');
  } else {
    console.log(chalk.red(`  ${result.error}`));
  }

  process.exit(result.exitCode);
}
