/**
 * agentxchain resume — governed-only command.
 *
 * Transitions a governed project from idle/paused into an assigned turn
 * with a concrete dispatch bundle. Per §44-§47 of the frozen spec:
 *
 *   - governed-only (rejects legacy projects)
 *   - resolves target role from routing or --role override
 *   - if idle + no run_id → initializeGovernedRun() + assign
 *   - if paused + run_id exists → resume same run + assign
 *   - if paused + current_turn with failed status → re-dispatch same turn
 *   - if active + current_turn exists → reject (no double assignment)
 *   - materializes a turn-scoped dispatch bundle under .agentxchain/dispatch/turns/<turn_id>/
 *   - exits without waiting for turn completion
 */

import chalk from 'chalk';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { loadProjectContext, loadProjectState } from '../lib/config.js';
import {
  initializeGovernedRun,
  assignGovernedTurn,
  markRunBlocked,
  getActiveTurns,
  getActiveTurnCount,
  reactivateGovernedRun,
  STATE_PATH,
} from '../lib/governed-state.js';
import { writeDispatchBundle, getDispatchTurnDir, getTurnStagingResultPath } from '../lib/dispatch-bundle.js';
import { finalizeDispatchManifest } from '../lib/dispatch-manifest.js';
import {
  getDispatchAssignmentPath,
  getDispatchContextPath,
  getDispatchEffectiveContextPath,
  getDispatchPromptPath,
} from '../lib/turn-paths.js';
import { safeWriteJson } from '../lib/safe-write.js';
import { deriveRecoveryDescriptor } from '../lib/blocked-state.js';
import { runHooks } from '../lib/hook-runner.js';

export async function resumeCommand(opts) {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config } = context;

  if (config.protocol_mode !== 'governed') {
    console.log(chalk.red('The resume command is only available for governed projects.'));
    console.log(chalk.dim('Legacy projects use: agentxchain start'));
    process.exit(1);
  }

  // Load governed state
  const statePath = join(root, STATE_PATH);
  if (!existsSync(statePath)) {
    console.log(chalk.red('No governed state.json found. Run `agentxchain init --governed` first.'));
    process.exit(1);
  }

  let state = loadProjectState(root, config);
  if (!state) {
    let parseError = 'Failed to parse state.json';
    try {
      JSON.parse(readFileSync(statePath, 'utf8'));
    } catch (err) {
      parseError = `Failed to parse state.json: ${err.message}`;
    }
    console.log(chalk.red(parseError));
    process.exit(1);
  }

  // §47: active + turns present → reject (resume assigns new turns, not re-dispatches)
  const activeCount = getActiveTurnCount(state);
  const activeTurns = getActiveTurns(state);

  if (state.status === 'active' && activeCount > 0) {
    if (activeCount === 1) {
      const turn = Object.values(activeTurns)[0];
      console.log(chalk.yellow('A turn is already active:'));
      console.log(`  Turn:  ${turn.turn_id}`);
      console.log(`  Role:  ${turn.assigned_role}`);
      console.log(`  Phase: ${state.phase}`);
      console.log('');
      console.log(chalk.dim(`The dispatch bundle is at: ${getDispatchTurnDir(turn.turn_id)}/`));
    } else {
      console.log(chalk.yellow(`${activeCount} turns are already active:`));
      for (const turn of Object.values(activeTurns)) {
        const statusLabel = turn.status === 'conflicted' ? chalk.red('conflicted') : turn.status;
        console.log(`  ${chalk.yellow('●')} ${turn.turn_id} — ${chalk.bold(turn.assigned_role)} (${statusLabel})`);
      }
      console.log('');
    }
    console.log(chalk.dim('Complete or accept/reject active turns before resuming.'));
    console.log(chalk.dim('Use agentxchain step --resume to continue waiting for an active turn.'));
    process.exit(1);
  }

  // §47: paused + retained turn with failed/retrying status → re-dispatch same turn
  if (state.status === 'paused' && activeCount > 0) {
    // Resolve which turn to re-dispatch
    let retainedTurn = null;
    if (opts.turn) {
      retainedTurn = activeTurns[opts.turn];
      if (!retainedTurn) {
        console.log(chalk.red(`No active turn found for --turn ${opts.turn}`));
        process.exit(1);
      }
    } else if (activeCount > 1) {
      console.log(chalk.red('Multiple retained turns exist. Use --turn <id> to specify which to re-dispatch.'));
      for (const turn of Object.values(activeTurns)) {
        console.log(`  ${chalk.yellow('●')} ${turn.turn_id} — ${chalk.bold(turn.assigned_role)} (${turn.status})`);
      }
      console.log('');
      console.log(chalk.dim('Example: agentxchain resume --turn <turn_id>'));
      process.exit(1);
    } else {
      retainedTurn = Object.values(activeTurns)[0];
    }

    const turnStatus = retainedTurn.status;
    if (turnStatus === 'failed' || turnStatus === 'retrying') {
      console.log(chalk.yellow(`Re-dispatching failed turn: ${retainedTurn.turn_id}`));
      console.log(`  Role:    ${retainedTurn.assigned_role}`);
      console.log(`  Attempt: ${retainedTurn.attempt}`);
      console.log('');

      // Reactivate the run
      state.status = 'active';
      state.blocked_on = null;
      safeWriteJson(statePath, state);

      // Write dispatch bundle for the existing turn
      const bundleResult = writeDispatchBundle(root, state, config);
      if (!bundleResult.ok) {
        console.log(chalk.red(`Failed to write dispatch bundle: ${bundleResult.error}`));
        process.exit(1);
      }
      printDispatchBundleWarnings(bundleResult);

      // after_dispatch hooks with bundle-core tamper protection
      const hooksConfig = config.hooks || {};
      if (hooksConfig.after_dispatch?.length > 0) {
        const afterDispatchResult = runAfterDispatchHooks(root, hooksConfig, state, retainedTurn);
        if (!afterDispatchResult.ok) {
          process.exit(1);
        }
      }

      printDispatchSummary(state, config, retainedTurn);
      return;
    }
  }

  if (state.status === 'blocked' && activeCount > 0) {
    let retainedTurn = null;
    if (opts.turn) {
      retainedTurn = activeTurns[opts.turn];
      if (!retainedTurn) {
        console.log(chalk.red(`No active turn found for --turn ${opts.turn}`));
        process.exit(1);
      }
    } else if (activeCount > 1) {
      console.log(chalk.red('Multiple retained turns exist. Use --turn <id> to specify which to re-dispatch.'));
      for (const turn of Object.values(activeTurns)) {
        console.log(`  ${chalk.yellow('●')} ${turn.turn_id} — ${chalk.bold(turn.assigned_role)} (${turn.status})`);
      }
      console.log('');
      console.log(chalk.dim('Example: agentxchain resume --turn <turn_id>'));
      process.exit(1);
    } else {
      retainedTurn = Object.values(activeTurns)[0];
    }

    if (retainedTurn.status === 'conflicted') {
      console.log(chalk.red(`Turn ${retainedTurn.turn_id} is conflicted. Resolve the conflict before resuming.`));
      process.exit(1);
    }

    console.log(chalk.yellow(`Re-dispatching blocked turn: ${retainedTurn.turn_id}`));
    console.log(`  Role:    ${retainedTurn.assigned_role}`);
    console.log(`  Attempt: ${retainedTurn.attempt}`);
    console.log('');

    const reactivated = reactivateGovernedRun(root, state, { via: 'resume --turn', notificationConfig: config });
    if (!reactivated.ok) {
      console.log(chalk.red(`Failed to reactivate blocked run: ${reactivated.error}`));
      process.exit(1);
    }
    state = reactivated.state;

    const bundleResult = writeDispatchBundle(root, state, config, { turnId: retainedTurn.turn_id });
    if (!bundleResult.ok) {
      console.log(chalk.red(`Failed to write dispatch bundle: ${bundleResult.error}`));
      process.exit(1);
    }
    printDispatchBundleWarnings(bundleResult);

    const hooksConfig = config.hooks || {};
    if (hooksConfig.after_dispatch?.length > 0) {
      const afterDispatchResult = runAfterDispatchHooks(root, hooksConfig, state, retainedTurn, config);
      if (!afterDispatchResult.ok) {
        process.exit(1);
      }
    }

    printDispatchSummary(state, config, retainedTurn);
    return;
  }

  // §47: idle + no run_id → initialize new run
  if (state.status === 'idle' && !state.run_id) {
    const initResult = initializeGovernedRun(root, config);
    if (!initResult.ok) {
      console.log(chalk.red(`Failed to initialize run: ${initResult.error}`));
      process.exit(1);
    }
    state = initResult.state;
    console.log(chalk.green(`Initialized governed run: ${state.run_id}`));
  }

  // §47: paused + run_id exists → resume same run
  if (state.status === 'blocked' && state.run_id) {
    const reactivated = reactivateGovernedRun(root, state, { via: 'resume', notificationConfig: config });
    if (!reactivated.ok) {
      console.log(chalk.red(`Failed to reactivate blocked run: ${reactivated.error}`));
      process.exit(1);
    }
    state = reactivated.state;
    console.log(chalk.green(`Resumed blocked run: ${state.run_id}`));
  }

  // §47: paused + run_id exists → resume same run
  if (state.status === 'paused' && state.run_id) {
    state.status = 'active';
    state.blocked_on = null;
    state.blocked_reason = null;
    state.escalation = null;
    safeWriteJson(statePath, state);
    console.log(chalk.green(`Resumed governed run: ${state.run_id}`));
  }

  // Resolve target role
  const roleId = resolveTargetRole(opts, state, config);
  if (!roleId) {
    process.exit(1);
  }

  // Assign the turn
  const assignResult = assignGovernedTurn(root, config, roleId);
  if (!assignResult.ok) {
    if (assignResult.error_code?.startsWith('hook_') || assignResult.error_code === 'hook_blocked') {
      printAssignmentHookFailure(assignResult, roleId);
    }
    console.log(chalk.red(`Failed to assign turn: ${assignResult.error}`));
    process.exit(1);
  }
  state = assignResult.state;

  // Write dispatch bundle
  const bundleResult = writeDispatchBundle(root, state, config);
  if (!bundleResult.ok) {
    console.log(chalk.red(`Failed to write dispatch bundle: ${bundleResult.error}`));
    process.exit(1);
  }
  printDispatchBundleWarnings(bundleResult);

  // after_dispatch hooks with bundle-core tamper protection
  const hooksConfig = config.hooks || {};
  const turn = state.current_turn;
  if (hooksConfig.after_dispatch?.length > 0) {
    const afterDispatchResult = runAfterDispatchHooks(root, hooksConfig, state, turn, config);
    if (!afterDispatchResult.ok) {
      process.exit(1);
    }
  }

  // Finalize dispatch manifest (seals bundle after hooks)
  const manifestResult = finalizeDispatchManifest(root, turn.turn_id, {
    run_id: state.run_id,
    role: turn.assigned_role,
  });
  if (!manifestResult.ok) {
    console.log(chalk.red(`Failed to finalize dispatch manifest: ${manifestResult.error}`));
    process.exit(1);
  }

  printDispatchSummary(state, config);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function resolveTargetRole(opts, state, config) {
  const phase = state.phase;
  const routing = config.routing?.[phase];

  if (opts.role) {
    // Validate the override
    if (!config.roles?.[opts.role]) {
      console.log(chalk.red(`Unknown role: "${opts.role}"`));
      console.log(chalk.dim(`Available roles: ${Object.keys(config.roles || {}).join(', ')}`));
      return null;
    }
    if (routing?.allowed_next_roles && !routing.allowed_next_roles.includes(opts.role) && opts.role !== 'human') {
      console.log(chalk.yellow(`Warning: role "${opts.role}" is not in allowed_next_roles for phase "${phase}".`));
      console.log(chalk.dim(`Allowed: ${routing.allowed_next_roles.join(', ')}`));
      // Allow it as an override, but warn
    }
    return opts.role;
  }

  // Default: use the phase's entry_role
  if (routing?.entry_role) {
    return routing.entry_role;
  }

  // Fallback: first role in config
  const roles = Object.keys(config.roles || {});
  if (roles.length > 0) {
    console.log(chalk.yellow(`No entry_role for phase "${phase}". Defaulting to "${roles[0]}".`));
    return roles[0];
  }

  console.log(chalk.red('No roles defined in config.'));
  return null;
}

function runAfterDispatchHooks(root, hooksConfig, state, turn, config) {
  const turnId = turn.turn_id;
  const roleId = turn.assigned_role;

  const afterDispatchHooks = runHooks(root, hooksConfig, 'after_dispatch', {
    turn_id: turnId,
    role_id: roleId,
    bundle_path: getDispatchTurnDir(turnId),
    bundle_files: ['ASSIGNMENT.json', 'PROMPT.md', 'CONTEXT.md'],
  }, {
    run_id: state.run_id,
    turn_id: turnId,
    protectedPaths: [
      getDispatchAssignmentPath(turnId),
      getDispatchPromptPath(turnId),
      getDispatchContextPath(turnId),
      getDispatchEffectiveContextPath(turnId),
    ],
  });

  if (!afterDispatchHooks.ok) {
    const hookName = afterDispatchHooks.blocker?.hook_name
      || afterDispatchHooks.tamper?.file
      || afterDispatchHooks.results?.find((e) => e.hook_name)?.hook_name
      || 'unknown';
    const detail = afterDispatchHooks.blocker?.message
      || afterDispatchHooks.tamper?.message
      || `after_dispatch hook blocked dispatch for turn ${turnId}`;
    const errorCode = afterDispatchHooks.tamper?.error_code || 'hook_blocked';

    markRunBlocked(root, {
      blockedOn: `hook:after_dispatch:${hookName}`,
      category: 'dispatch_error',
      recovery: {
        typed_reason: afterDispatchHooks.tamper ? 'hook_tamper' : 'hook_block',
        owner: 'human',
        recovery_action: `Fix or reconfigure the hook, then rerun agentxchain resume`,
        turn_retained: true,
        detail,
      },
      turnId,
      notificationConfig: config,
    });

    printDispatchHookFailure({
      turnId,
      roleId,
      hookName,
      error: detail,
      errorCode,
      hookResults: afterDispatchHooks,
    });

    return { ok: false };
  }

  return { ok: true };
}

function printDispatchHookFailure({ turnId, roleId, hookName, error, hookResults }) {
  const isTamper = hookResults?.tamper;
  console.log('');
  console.log(chalk.yellow('  Dispatch Blocked By Hook'));
  console.log(chalk.dim('  ' + '-'.repeat(44)));
  console.log('');
  console.log(`  ${chalk.dim('Turn:')}     ${turnId || '(unknown)'}`);
  console.log(`  ${chalk.dim('Role:')}     ${roleId || '(unknown)'}`);
  console.log(`  ${chalk.dim('Hook:')}     ${hookName}`);
  console.log(`  ${chalk.dim('Error:')}    ${error}`);
  console.log(`  ${chalk.dim('Reason:')}   ${isTamper ? 'hook_tamper' : 'hook_block'}`);
  console.log(`  ${chalk.dim('Owner:')}    human`);
  console.log(`  ${chalk.dim('Action:')}   Fix or reconfigure the hook, then rerun agentxchain resume`);
  console.log('');
}

function printDispatchBundleWarnings(bundleResult) {
  for (const warning of bundleResult.warnings || []) {
    console.log(chalk.yellow(`Dispatch bundle warning: ${warning}`));
  }
}

function printAssignmentHookFailure(result, roleId) {
  const recovery = deriveRecoveryDescriptor(result.state);
  const hookName = result.hookResults?.blocker?.hook_name
    || result.hookResults?.results?.find((entry) => entry.hook_name)?.hook_name
    || '(unknown)';

  console.log('');
  console.log(chalk.yellow('  Turn Assignment Blocked By Hook'));
  console.log(chalk.dim('  ' + '-'.repeat(44)));
  console.log('');
  console.log(`  ${chalk.dim('Role:')}     ${roleId || '(unknown)'}`);
  console.log(`  ${chalk.dim('Phase:')}    ${result.state?.phase || '(unknown)'}`);
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
    console.log(`  ${chalk.dim('Action:')}   Fix or reconfigure hook "${hookName}", then rerun agentxchain resume --role ${roleId}`);
  }
  console.log('');
}

function printDispatchSummary(state, config, explicitTurn) {
  const turn = explicitTurn || state.current_turn;
  const role = config.roles?.[turn.assigned_role];

  console.log('');
  console.log(chalk.bold('  Turn Assigned'));
  console.log(chalk.dim('  ' + '─'.repeat(44)));
  console.log('');
  console.log(`  ${chalk.dim('Turn:')}     ${turn.turn_id}`);
  console.log(`  ${chalk.dim('Role:')}     ${role?.title || turn.assigned_role}`);
  console.log(`  ${chalk.dim('Phase:')}    ${state.phase}`);
  console.log(`  ${chalk.dim('Runtime:')}  ${turn.runtime_id}`);
  console.log(`  ${chalk.dim('Attempt:')}  ${turn.attempt}`);
  console.log('');
  console.log(`  ${chalk.dim('Dispatch bundle:')} ${getDispatchTurnDir(turn.turn_id)}/`);
  console.log(`  ${chalk.dim('Prompt:')}           ${getDispatchTurnDir(turn.turn_id)}/PROMPT.md`);
  console.log(`  ${chalk.dim('Submit result to:')} ${getTurnStagingResultPath(turn.turn_id)}`);
  console.log('');
  console.log(chalk.dim('  When done, run: agentxchain validate --mode turn'));
  console.log('');
}
