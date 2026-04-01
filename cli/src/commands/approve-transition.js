import chalk from 'chalk';
import { loadProjectContext, loadProjectState } from '../lib/config.js';
import { approvePhaseTransition } from '../lib/governed-state.js';

export async function approveTransitionCommand(opts) {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  if (context.config.protocol_mode !== 'governed') {
    console.log(chalk.red('approve-transition is only available in governed mode (v4).'));
    process.exit(1);
  }

  const { root, config } = context;
  const state = loadProjectState(root, config);

  if (!state?.pending_phase_transition) {
    console.log(chalk.yellow('No pending phase transition to approve.'));
    if (state?.phase) {
      console.log(chalk.dim(`  Current phase: ${state.phase}`));
    }
    process.exit(1);
  }

  const pt = state.pending_phase_transition;
  console.log('');
  console.log(chalk.bold('  Approving Phase Transition'));
  console.log(chalk.dim('  ' + '─'.repeat(44)));
  console.log(`  ${chalk.dim('From:')}  ${pt.from}`);
  console.log(`  ${chalk.dim('To:')}    ${pt.to}`);
  console.log(`  ${chalk.dim('Gate:')}  ${pt.gate}`);
  console.log(`  ${chalk.dim('Turn:')}  ${pt.requested_by_turn}`);
  console.log('');

  const result = approvePhaseTransition(root);

  if (!result.ok) {
    console.log(chalk.red(`  Failed: ${result.error}`));
    process.exit(1);
  }

  console.log(chalk.green(`  ✓ Phase advanced: ${pt.from} → ${pt.to}`));
  console.log(chalk.dim(`  Run status: ${result.state.status}`));
  console.log('');
  console.log(chalk.dim(`  Next: agentxchain step  (to run the first turn in ${pt.to} phase)`));
  console.log('');
}
