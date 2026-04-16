import chalk from 'chalk';
import { loadProjectContext, loadProjectState } from '../lib/config.js';
import { approvePhaseTransition } from '../lib/governed-state.js';
import { deriveRecoveryDescriptor } from '../lib/blocked-state.js';

export async function approveTransitionCommand(opts) {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  if (context.config.protocol_mode !== 'governed') {
    console.log(chalk.red('approve-transition is only available in governed mode.'));
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

  const result = approvePhaseTransition(root, config, { dryRun: opts.dryRun });

  if (result.dry_run) {
    console.log(chalk.cyan('  Dry Run: gate approval preview only'));
    if (result.gate_actions?.length > 0) {
      console.log(`  ${chalk.dim('Gate actions:')} ${result.gate_actions.length}`);
      for (const action of result.gate_actions) {
        console.log(`    ${action.index}. ${action.label || action.run}`);
        if (action.label) {
          console.log(`       ${chalk.dim(action.run)}`);
        }
      }
    } else {
      console.log(`  ${chalk.dim('Gate actions:')} none configured`);
    }
    console.log('');
    return;
  }

  if (!result.ok) {
    if (result.error_code?.startsWith('hook_') || result.error_code === 'hook_blocked') {
      printGateHookFailure(result, 'phase_transition', pt);
    } else if (result.error_code === 'gate_action_failed') {
      printGateActionFailure(result, 'phase_transition', pt);
    } else {
      console.log(chalk.red(`  Failed: ${result.error}`));
    }
    process.exit(1);
  }

  console.log(chalk.green(`  ✓ Phase advanced: ${pt.from} → ${pt.to}`));
  if (result.gateActionRun?.actions?.length > 0) {
    console.log(`  ${chalk.dim('Gate actions:')} ${result.gateActionRun.actions.length} completed`);
  }
  console.log(chalk.dim(`  Run status: ${result.state.status}`));
  console.log('');
  console.log(chalk.dim(`  Next: agentxchain step  (to run the first turn in ${pt.to} phase)`));
  console.log('');
}

function printGateHookFailure(result, gateType, gateInfo) {
  const recovery = deriveRecoveryDescriptor(result.state);
  const hookName = result.hookResults?.blocker?.hook_name
    || result.hookResults?.results?.find((entry) => entry.hook_name)?.hook_name
    || '(unknown)';

  console.log('');
  console.log(chalk.yellow(`  ${gateType === 'phase_transition' ? 'Phase Transition' : 'Run Completion'} Blocked By Hook`));
  console.log(chalk.dim('  ' + '-'.repeat(44)));
  console.log('');
  if (gateType === 'phase_transition') {
    console.log(`  ${chalk.dim('From:')}     ${gateInfo.from}`);
    console.log(`  ${chalk.dim('To:')}       ${gateInfo.to}`);
  }
  console.log(`  ${chalk.dim('Gate:')}     ${gateInfo.gate}`);
  console.log(`  ${chalk.dim('Hook:')}     ${hookName}`);
  console.log(`  ${chalk.dim('Error:')}    ${result.error}`);
  if (recovery) {
    console.log(`  ${chalk.dim('Reason:')}   ${recovery.typed_reason}`);
    console.log(`  ${chalk.dim('Owner:')}    ${recovery.owner}`);
    console.log(`  ${chalk.dim('Action:')}   ${recovery.recovery_action}`);
    if (recovery.detail) {
      console.log(`  ${chalk.dim('Detail:')}   ${recovery.detail}`);
    }
  } else {
    console.log(`  ${chalk.dim('Action:')}   Fix or reconfigure hook "${hookName}", then rerun agentxchain approve-transition`);
  }
  console.log('');
}

function printGateActionFailure(result, gateType, gateInfo) {
  const failure = result.gateActionRun?.failed_action;

  console.log('');
  console.log(chalk.yellow(`  ${gateType === 'phase_transition' ? 'Phase Transition' : 'Run Completion'} Blocked By Gate Action`));
  console.log(chalk.dim('  ' + '-'.repeat(44)));
  console.log('');
  if (gateType === 'phase_transition') {
    console.log(`  ${chalk.dim('From:')}     ${gateInfo.from}`);
    console.log(`  ${chalk.dim('To:')}       ${gateInfo.to}`);
  }
  console.log(`  ${chalk.dim('Gate:')}     ${gateInfo.gate}`);
  console.log(`  ${chalk.dim('Action:')}   ${failure?.action_label || failure?.command || '(unknown)'}`);
  console.log(`  ${chalk.dim('Exit:')}     ${failure?.exit_code ?? failure?.signal ?? 'unknown'}`);
  if (failure?.stderr_tail) {
    console.log(`  ${chalk.dim('stderr:')}   ${failure.stderr_tail}`);
  }
  console.log(`  ${chalk.dim('Retry:')}    ${gateType === 'phase_transition' ? 'agentxchain approve-transition' : 'agentxchain approve-completion'}`);
  console.log('');
}
