import chalk from 'chalk';
import { loadProjectContext } from '../lib/config.js';
import { injectIntent } from '../lib/intake.js';

export async function injectCommand(description, opts) {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config } = context;

  if (config.protocol_mode !== 'governed') {
    console.log(chalk.red('The inject command is only available for governed projects.'));
    process.exit(1);
  }

  if (!description || !String(description).trim()) {
    console.log(chalk.red('A description is required. Example: agentxchain inject "Fix the sidebar ordering"'));
    process.exit(1);
  }

  const result = injectIntent(root, String(description).trim(), {
    priority: opts.priority,
    template: opts.template,
    charter: opts.charter,
    acceptance: opts.acceptance,
    approver: opts.approver,
    noApprove: opts.approve === false,
  });

  if (!result.ok) {
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, error: result.error }, null, 2));
    } else {
      console.log(chalk.red(result.error));
    }
    process.exit(result.exitCode || 1);
  }

  if (opts.json) {
    console.log(JSON.stringify({
      ok: true,
      intent_id: result.intent.intent_id,
      event_id: result.event.event_id,
      status: result.intent.status,
      priority: result.intent.priority,
      deduplicated: result.deduplicated,
      preemption_marker: result.preemption_marker,
    }, null, 2));
    return;
  }

  console.log('');
  if (result.deduplicated) {
    console.log(chalk.yellow('  ⚠ Duplicate injection — existing intent returned'));
    console.log(chalk.dim(`  Intent: ${result.intent?.intent_id || 'unknown'}`));
    console.log(chalk.dim(`  Status: ${result.intent?.status || 'unknown'}`));
    console.log('');
    return;
  }

  const priority = result.intent.priority || 'p0';
  const priorityColor = priority === 'p0' ? chalk.red.bold : priority === 'p1' ? chalk.yellow.bold : chalk.dim;

  console.log(chalk.green.bold('  Injected'));
  console.log(chalk.dim(`  Intent:   ${result.intent.intent_id}`));
  console.log(`  Priority: ${priorityColor(priority)}`);
  console.log(chalk.dim(`  Status:   ${result.intent.status}`));
  console.log(chalk.dim(`  Charter:  ${result.intent.charter || description}`));

  if (result.preemption_marker) {
    console.log('');
    console.log(chalk.red.bold('  ⚡ Preemption marker written'));
    console.log(chalk.dim('  The current run will yield after the active turn completes.'));
    console.log(chalk.dim('  The next dispatch (manual resume, step --resume, or continuous loop) will consume this intent.'));
  }

  console.log('');
}
