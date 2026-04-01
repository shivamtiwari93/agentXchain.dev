import chalk from 'chalk';
import { loadProjectContext } from '../lib/config.js';
import { acceptGovernedTurn } from '../lib/governed-state.js';
import { deriveRecoveryDescriptor } from '../lib/blocked-state.js';

export async function acceptTurnCommand() {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config } = context;

  if (config.protocol_mode !== 'governed') {
    console.log(chalk.red('The accept-turn command is only available for governed (v4) projects.'));
    console.log(chalk.dim('Legacy projects use: agentxchain release'));
    process.exit(1);
  }

  const result = acceptGovernedTurn(root, config);
  if (!result.ok) {
    const errorClass = result.validation?.error_class || 'unknown';
    const stage = result.validation?.stage || 'unknown';

    console.log('');
    console.log(chalk.red(`  Validation failed at stage ${stage}`));
    console.log(chalk.dim('  ' + '─'.repeat(44)));
    console.log('');
    console.log(`  ${chalk.dim('Reason:')}   ${errorClass}`);
    console.log(`  ${chalk.dim('Owner:')}    human`);
    console.log(`  ${chalk.dim('Action:')}   Fix staged result and rerun agentxchain accept-turn, or reject with agentxchain reject-turn --reason "..."`);
    console.log(`  ${chalk.dim('Turn:')}     retained`);
    if (result.validation?.errors?.length) {
      for (const err of result.validation.errors) {
        console.log(`  ${chalk.dim('Detail:')}   ${err}`);
      }
    }
    console.log('');
    console.log(chalk.dim('Inspect the staged result with: agentxchain validate --mode turn'));
    process.exit(1);
  }

  const accepted = result.accepted;
  const turnId = accepted?.turn_id || result.state?.last_completed_turn_id || '(unknown)';

  console.log('');
  console.log(chalk.green('  Turn Accepted'));
  console.log(chalk.dim('  ' + '─'.repeat(44)));
  console.log('');
  console.log(`  ${chalk.dim('Turn:')}     ${turnId}`);
  console.log(`  ${chalk.dim('Role:')}     ${accepted?.role || '(unknown)'}`);
  console.log(`  ${chalk.dim('Status:')}   ${accepted?.status || 'completed'}`);
  console.log(`  ${chalk.dim('Summary:')}  ${accepted?.summary || '(none)'}`);
  if (accepted?.proposed_next_role) {
    console.log(`  ${chalk.dim('Proposed:')} ${accepted.proposed_next_role}`);
  }
  if (result.state?.accepted_integration_ref) {
    console.log(`  ${chalk.dim('Accepted:')} ${result.state.accepted_integration_ref}`);
  }
  if (accepted?.cost?.usd != null) {
    console.log(`  ${chalk.dim('Cost:')}     $${formatUsd(accepted.cost.usd)}`);
  }
  console.log('');

  const recovery = deriveRecoveryDescriptor(result.state);
  if (recovery) {
    console.log(`  ${chalk.dim('Reason:')}   ${recovery.typed_reason}`);
    console.log(`  ${chalk.dim('Owner:')}    ${recovery.owner}`);
    console.log(`  ${chalk.dim('Action:')}   ${recovery.recovery_action}`);
    console.log(`  ${chalk.dim('Turn:')}     ${recovery.turn_retained ? 'retained' : 'cleared'}`);
    if (recovery.detail) {
      console.log(`  ${chalk.dim('Detail:')}   ${recovery.detail}`);
    }
  } else if (accepted?.proposed_next_role && accepted.proposed_next_role !== 'human') {
    console.log(chalk.dim(`  Next: agentxchain resume --role ${accepted.proposed_next_role}`));
  } else {
    console.log(chalk.dim('  Next: review state, then run agentxchain resume when ready.'));
  }
  console.log('');
}

function formatUsd(value) {
  return typeof value === 'number' && !Number.isNaN(value) ? value.toFixed(2) : '0.00';
}
