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
 *   - materializes dispatch bundle to .agentxchain/dispatch/current/
 *   - exits without waiting for turn completion
 */

import chalk from 'chalk';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { loadProjectContext } from '../lib/config.js';
import {
  initializeGovernedRun,
  assignGovernedTurn,
  STATE_PATH,
} from '../lib/governed-state.js';
import { writeDispatchBundle, DISPATCH_CURRENT } from '../lib/dispatch-bundle.js';
import { safeWriteJson } from '../lib/safe-write.js';

export async function resumeCommand(opts) {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config } = context;

  if (config.protocol_mode !== 'governed') {
    console.log(chalk.red('The resume command is only available for governed (v4) projects.'));
    console.log(chalk.dim('Legacy projects use: agentxchain start'));
    process.exit(1);
  }

  // Load governed state
  const statePath = join(root, STATE_PATH);
  if (!existsSync(statePath)) {
    console.log(chalk.red('No governed state.json found. Run `agentxchain init --governed` first.'));
    process.exit(1);
  }

  let state;
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch (err) {
    console.log(chalk.red(`Failed to parse state.json: ${err.message}`));
    process.exit(1);
  }

  // §47: active + current_turn → reject
  if (state.status === 'active' && state.current_turn) {
    console.log(chalk.yellow('A turn is already active:'));
    console.log(`  Turn:  ${state.current_turn.turn_id}`);
    console.log(`  Role:  ${state.current_turn.assigned_role}`);
    console.log(`  Phase: ${state.phase}`);
    console.log('');
    console.log(chalk.dim('The dispatch bundle is at: .agentxchain/dispatch/current/'));
    console.log(chalk.dim('Complete the current turn before resuming.'));
    process.exit(1);
  }

  // §47: paused + current_turn with failed/retrying status → re-dispatch same turn
  if (state.status === 'paused' && state.current_turn) {
    const turnStatus = state.current_turn.status;
    if (turnStatus === 'failed' || turnStatus === 'retrying') {
      console.log(chalk.yellow(`Re-dispatching failed turn: ${state.current_turn.turn_id}`));
      console.log(`  Role:    ${state.current_turn.assigned_role}`);
      console.log(`  Attempt: ${state.current_turn.attempt}`);
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

      printDispatchSummary(state, config);
      return;
    }
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
  if (state.status === 'paused' && state.run_id) {
    state.status = 'active';
    state.blocked_on = null;
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

function printDispatchBundleWarnings(bundleResult) {
  for (const warning of bundleResult.warnings || []) {
    console.log(chalk.yellow(`Dispatch bundle warning: ${warning}`));
  }
}

function printDispatchSummary(state, config) {
  const turn = state.current_turn;
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
  console.log(`  ${chalk.dim('Dispatch bundle:')} .agentxchain/dispatch/current/`);
  console.log(`  ${chalk.dim('Prompt:')}           .agentxchain/dispatch/current/PROMPT.md`);
  console.log(`  ${chalk.dim('Submit result to:')} .agentxchain/staging/turn-result.json`);
  console.log('');
  console.log(chalk.dim('  When done, run: agentxchain validate --mode turn'));
  console.log('');
}
