import chalk from 'chalk';
import { loadProjectContext, loadProjectState } from '../lib/config.js';
import { approveRunCompletion } from '../lib/governed-state.js';
import { deriveRecoveryDescriptor } from '../lib/blocked-state.js';

export async function approveCompletionCommand(opts) {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  if (context.config.protocol_mode !== 'governed') {
    console.log(chalk.red('approve-completion is only available in governed mode.'));
    process.exit(1);
  }

  const { root, config } = context;
  const state = loadProjectState(root, config);

  if (!state?.pending_run_completion) {
    console.log(chalk.yellow('No pending run completion to approve.'));
    if (state?.status === 'completed') {
      console.log(chalk.dim('  This run is already completed.'));
    } else if (state?.phase) {
      console.log(chalk.dim(`  Current phase: ${state.phase}, status: ${state.status}`));
    }
    process.exit(1);
  }

  const pc = state.pending_run_completion;
  console.log('');
  console.log(chalk.bold('  Approving Run Completion'));
  console.log(chalk.dim('  ' + '─'.repeat(44)));
  console.log(`  ${chalk.dim('Phase:')}  ${state.phase}`);
  console.log(`  ${chalk.dim('Gate:')}   ${pc.gate}`);
  console.log(`  ${chalk.dim('Turn:')}   ${pc.requested_by_turn}`);
  console.log('');

  const result = approveRunCompletion(root, config, { dryRun: opts.dryRun });

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
      printGateHookFailure(result, 'run_completion', pc);
    } else if (result.error_code === 'gate_action_failed') {
      printGateActionFailure(result, pc);
    } else {
      console.log(chalk.red(`  Failed: ${result.error}`));
    }
    process.exit(1);
  }

  console.log(chalk.green('  \u2713 Run completed'));
  if (result.gateActionRun?.actions?.length > 0) {
    console.log(`  ${chalk.dim('Gate actions:')} ${result.gateActionRun.actions.length} completed`);
  }
  console.log(chalk.dim(`  Completed at: ${result.state.completed_at}`));
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
    console.log(`  ${chalk.dim('Action:')}   Fix or reconfigure hook "${hookName}", then rerun agentxchain approve-completion`);
  }
  console.log('');
}

function printGateActionFailure(result, gateInfo) {
  const failure = result.gateActionRun?.failed_action;
  const exitLabel = failure?.timed_out
    ? `timeout after ${failure.timeout_ms}ms`
    : failure?.exit_code ?? failure?.signal ?? 'unknown';
  const stderrOrError = failure?.stderr_tail || failure?.spawn_error || null;

  console.log('');
  console.log(chalk.yellow('  Run Completion Blocked By Gate Action'));
  console.log(chalk.dim('  ' + '-'.repeat(44)));
  console.log('');
  console.log(`  ${chalk.dim('Gate:')}     ${gateInfo.gate}`);
  console.log(`  ${chalk.dim('Action:')}   ${failure?.action_label || failure?.command || '(unknown)'}`);
  console.log(`  ${chalk.dim('Exit:')}     ${exitLabel}`);
  if (stderrOrError) {
    console.log(`  ${chalk.dim('stderr:')}   ${stderrOrError}`);
  }
  console.log(`  ${chalk.dim('Retry:')}    agentxchain approve-completion`);
  console.log('');
}
