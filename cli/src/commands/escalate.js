import chalk from 'chalk';
import { loadProjectContext, loadProjectState } from '../lib/config.js';
import { deriveRecoveryDescriptor } from '../lib/blocked-state.js';
import { raiseOperatorEscalation } from '../lib/governed-state.js';

export async function escalateCommand(opts) {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config } = context;

  if (config.protocol_mode !== 'governed') {
    console.log(chalk.red('The escalate command is only available for governed projects.'));
    console.log(chalk.dim('Legacy projects use: agentxchain claim / release'));
    process.exit(1);
  }

  const state = loadProjectState(root, config);
  if (!state) {
    console.log(chalk.red('No governed state.json found. Run `agentxchain init --governed` first.'));
    process.exit(1);
  }

  const result = raiseOperatorEscalation(root, config, {
    reason: opts.reason,
    detail: opts.detail,
    action: opts.action,
    turnId: opts.turn,
  });
  if (!result.ok) {
    console.log(chalk.red(result.error));
    process.exit(1);
  }

  const recovery = deriveRecoveryDescriptor(result.state, config);

  console.log('');
  console.log(chalk.yellow('  Run Escalated'));
  console.log(chalk.dim('  ' + '─'.repeat(44)));
  console.log('');
  console.log(`  ${chalk.dim('Reason:')}   ${result.escalation.reason}`);
  if (result.escalation.detail && result.escalation.detail !== result.escalation.reason) {
    console.log(`  ${chalk.dim('Detail:')}   ${result.escalation.detail}`);
  }
  console.log(`  ${chalk.dim('Blocked:')}  ${result.state.blocked_on}`);
  console.log(`  ${chalk.dim('Source:')}   operator`);
  console.log(`  ${chalk.dim('Turn:')}     ${result.escalation.from_turn_id || 'none retained'}`);
  if (result.escalation.from_role) {
    console.log(`  ${chalk.dim('Role:')}     ${result.escalation.from_role}`);
  }
  console.log('');

  if (recovery) {
    console.log(`  ${chalk.dim('Typed:')}    ${recovery.typed_reason}`);
    console.log(`  ${chalk.dim('Owner:')}    ${recovery.owner}`);
    console.log(`  ${chalk.dim('Action:')}   ${recovery.recovery_action}`);
    console.log(`  ${chalk.dim('Retained:')} ${recovery.turn_retained ? 'yes' : 'no'}`);
  }
  console.log('');
}
