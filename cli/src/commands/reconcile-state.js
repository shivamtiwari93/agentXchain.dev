import chalk from 'chalk';
import { loadProjectContext } from '../lib/config.js';
import { reconcileOperatorHead } from '../lib/operator-commit-reconcile.js';

export async function reconcileStateCommand(opts = {}) {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config } = context;
  if (config.protocol_mode !== 'governed') {
    console.log(chalk.red('The reconcile-state command is only available for governed projects.'));
    process.exit(1);
  }

  if (!opts.acceptOperatorHead) {
    console.log(chalk.red('No reconciliation action selected.'));
    console.log(chalk.dim('Run `agentxchain reconcile-state --accept-operator-head` to accept safe operator commits on top of the last checkpoint.'));
    process.exit(1);
  }

  const result = reconcileOperatorHead(root);
  if (!result.ok) {
    console.log(chalk.red(`Reconcile refused (${result.error_class || 'unknown'}).`));
    console.log(chalk.red(result.error || 'Unable to reconcile operator commits.'));
    if (result.offending_path) {
      console.log(chalk.dim(`Offending path: ${result.offending_path}`));
    }
    if (result.offending_commit) {
      console.log(chalk.dim(`Offending commit: ${result.offending_commit}`));
    }
    console.log(chalk.dim('Manual recovery: inspect the commit range, restore governed state artifacts if needed, then restart from an explicit checkpoint.'));
    process.exit(1);
  }

  if (result.no_op) {
    console.log(chalk.green(`State already reconciled at ${result.accepted_head.slice(0, 8)}.`));
    return;
  }

  console.log(chalk.green(`Reconciled ${result.accepted_commits.length} operator commit(s).`));
  console.log(chalk.dim(`Previous baseline: ${result.previous_baseline}`));
  console.log(chalk.dim(`Accepted HEAD:      ${result.accepted_head}`));
  if (result.paths_touched.length > 0) {
    console.log(chalk.dim(`Paths touched:      ${result.paths_touched.join(', ')}`));
  }
}
