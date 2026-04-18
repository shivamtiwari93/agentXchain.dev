import chalk from 'chalk';
import { loadProjectContext } from '../lib/config.js';
import { acceptGovernedTurn } from '../lib/governed-state.js';
import { deriveRecoveryDescriptor } from '../lib/blocked-state.js';
import { checkpointAcceptedTurn } from '../lib/turn-checkpoint.js';

export async function acceptTurnCommand(opts = {}) {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config } = context;

  if (config.protocol_mode !== 'governed') {
    console.log(chalk.red('The accept-turn command is only available for governed projects.'));
    console.log(chalk.dim('Legacy projects use: agentxchain release'));
    process.exit(1);
  }

  const result = acceptGovernedTurn(root, config, {
    turnId: opts.turn,
    resolutionMode: opts.resolution || 'standard',
  });
  if (!result.ok) {
    if (result.error_code === 'policy_escalation' || result.error_code === 'policy_violation') {
      const recovery = result.state ? deriveRecoveryDescriptor(result.state, config) : null;
      const retainedTurnId = result.state?.blocked_reason?.turn_id || opts.turn || '(unknown)';
      const policyTitle = result.error_code === 'policy_escalation'
        ? 'Turn Acceptance Escalated By Policy'
        : 'Turn Acceptance Blocked By Policy';

      console.log('');
      console.log(chalk.yellow(`  ${policyTitle}`));
      console.log(chalk.dim('  ' + '─'.repeat(44)));
      console.log('');
      console.log(`  ${chalk.dim('Turn:')}     ${retainedTurnId}`);
      console.log(`  ${chalk.dim('Error:')}    ${result.error}`);
      const violations = Array.isArray(result.policy_violations) ? result.policy_violations : [];
      for (const violation of violations) {
        console.log(`  ${chalk.dim('Policy:')}   ${violation.policy_id} (${violation.rule})`);
        console.log(`  ${chalk.dim('Detail:')}   ${violation.message}`);
      }
      if (recovery) {
        console.log(`  ${chalk.dim('Reason:')}   ${recovery.typed_reason}`);
        console.log(`  ${chalk.dim('Owner:')}    ${recovery.owner}`);
        console.log(`  ${chalk.dim('Action:')}   ${recovery.recovery_action}`);
        console.log(`  ${chalk.dim('Turn:')}     ${recovery.turn_retained ? 'retained' : 'cleared'}`);
      } else {
        console.log(`  ${chalk.dim('Action:')}   Fix the policy condition, then rerun agentxchain accept-turn`);
      }
      console.log('');
      process.exit(1);
    }

    if (result.error_code?.startsWith('hook_') || result.error_code === 'hook_blocked') {
      const recovery = deriveRecoveryDescriptor(result.state, config);
      const activeTurn = result.state?.current_turn;
      const hookName = result.hookResults?.blocker?.hook_name
        || result.hookResults?.results?.find((entry) => entry.hook_name)?.hook_name
        || '(unknown)';

      console.log('');
      console.log(chalk.yellow(`  ${result.accepted ? 'Turn Accepted, Hook Failure Detected' : 'Turn Acceptance Blocked By Hook'}`));
      console.log(chalk.dim('  ' + '─'.repeat(44)));
      console.log('');
      console.log(`  ${chalk.dim('Turn:')}     ${result.accepted?.turn_id || activeTurn?.turn_id || opts.turn || '(unknown)'}`);
      console.log(`  ${chalk.dim('Role:')}     ${result.accepted?.role || activeTurn?.assigned_role || '(unknown)'}`);
      if (result.accepted?.status) {
        console.log(`  ${chalk.dim('Status:')}   ${result.accepted.status}`);
      }
      console.log(`  ${chalk.dim('Hook:')}     ${hookName}`);
      console.log(`  ${chalk.dim('Error:')}    ${result.error}`);
      if (recovery) {
        console.log(`  ${chalk.dim('Reason:')}   ${recovery.typed_reason}`);
        console.log(`  ${chalk.dim('Owner:')}    ${recovery.owner}`);
        console.log(`  ${chalk.dim('Action:')}   ${recovery.recovery_action}`);
        if (recovery.detail) {
          console.log(`  ${chalk.dim('Detail:')}   ${recovery.detail}`);
        }
      }
      console.log('');
      process.exit(1);
    }

    if (result.error_code === 'conflict' && result.conflict) {
      console.log('');
      console.log(chalk.yellow('  Acceptance Conflict Detected'));
      console.log(chalk.dim('  ' + '─'.repeat(44)));
      console.log('');
      console.log(`  ${chalk.dim('Turn:')}     ${result.conflict.conflicting_turn.turn_id}`);
      console.log(`  ${chalk.dim('Role:')}     ${result.conflict.conflicting_turn.role}`);
      console.log(`  ${chalk.dim('Files:')}    ${result.conflict.conflicting_files.join(', ') || '(none)'}`);
      console.log(`  ${chalk.dim('Overlap:')}  ${(result.conflict.overlap_ratio * 100).toFixed(0)}%`);
      console.log(`  ${chalk.dim('Suggest:')}  ${result.conflict.suggested_resolution}`);
      if (result.state?.status === 'blocked') {
        const recovery = deriveRecoveryDescriptor(result.state, config);
        if (recovery) {
          console.log(`  ${chalk.dim('Action:')}   ${recovery.recovery_action}`);
        }
      }
      console.log('');
      process.exit(1);
    }

    if (result.error_code === 'lock_timeout') {
      console.log('');
      console.log(chalk.yellow('  Acceptance Lock Held'));
      console.log(chalk.dim('  ' + '─'.repeat(44)));
      console.log('');
      console.log(`  ${chalk.dim('Reason:')}   ${result.error}`);
      console.log(`  ${chalk.dim('Action:')}   Wait for the other acceptance to complete, then retry.`);
      console.log(`  ${chalk.dim('Note:')}     Stale locks are auto-reclaimed after 30 seconds.`);
      console.log('');
      process.exit(1);
    }

    if (result.error_code === 'protocol_error') {
      console.log(chalk.red(result.error || 'Protocol error.'));
      process.exit(1);
    }

    if (!result.validation) {
      console.log(chalk.red(result.error || 'Failed to accept turn.'));
      process.exit(1);
    }

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
  if (opts.checkpoint) {
    const checkpoint = checkpointAcceptedTurn(root, { turnId });
    if (!checkpoint.ok) {
      console.log(`  ${chalk.yellow('Checkpoint:')} accepted but checkpoint failed`);
      console.log(`  ${chalk.dim('Action:')}   ${checkpoint.error}`);
      console.log(`  ${chalk.dim('Retry:')}    agentxchain checkpoint-turn --turn ${turnId}`);
      console.log('');
      process.exit(1);
    }
    if (!checkpoint.skipped) {
      console.log(`  ${chalk.dim('Checkpoint:')} ${checkpoint.checkpoint_sha}`);
    }
  }
  if (accepted?.verification_replay) {
    const verifiedAt = accepted.verification_replay.verified_at
      ? ` at ${accepted.verification_replay.verified_at}`
      : '';
    console.log(`  ${chalk.dim('Replay:')}   ${accepted.verification_replay.overall} (${accepted.verification_replay.matched_commands}/${accepted.verification_replay.replayed_commands})${verifiedAt}`);
  }
  if (result.budget_warning) {
    console.log(`  ${chalk.yellow('Budget warning:')} ${result.budget_warning}`);
  }
  console.log('');

  const recovery = deriveRecoveryDescriptor(result.state, config);
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
