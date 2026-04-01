/**
 * agentxchain step — governed-only single-turn execution command.
 *
 * Composes the full turn lifecycle in one command:
 *   1. Initialize/resume run if needed (like `resume`)
 *   2. Assign a turn and write dispatch bundle
 *   3. Wait for the turn to complete (adapter-specific)
 *   4. Validate the staged result
 *   5. Accept or reject (with retry if applicable)
 *   6. Print outcome summary
 *
 * This is the first truthful single-turn governed operator experience.
 * It does NOT loop — it runs exactly one turn and exits.
 *
 * Adapter support:
 *   - manual: prints dispatch instructions, polls for staged result file
 *   - local_cli: implemented via subprocess dispatch + staged turn result
 *   - api_proxy: implemented for synchronous review-only turns and stages
 *     provider-backed JSON before validation/acceptance
 */

import chalk from 'chalk';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { loadProjectContext } from '../lib/config.js';
import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  rejectGovernedTurn,
  STATE_PATH,
} from '../lib/governed-state.js';
import { writeDispatchBundle } from '../lib/dispatch-bundle.js';
import { validateStagedTurnResult } from '../lib/turn-result-validator.js';
import {
  printManualDispatchInstructions,
  waitForStagedResult,
} from '../lib/adapters/manual-adapter.js';
import {
  dispatchLocalCli,
  saveDispatchLogs,
  resolvePromptTransport,
} from '../lib/adapters/local-cli-adapter.js';
import { dispatchApiProxy } from '../lib/adapters/api-proxy-adapter.js';
import { safeWriteJson } from '../lib/safe-write.js';
import { deriveRecoveryDescriptor } from '../lib/blocked-state.js';

export async function stepCommand(opts) {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config } = context;

  if (config.protocol_mode !== 'governed') {
    console.log(chalk.red('The step command is only available for governed (v4) projects.'));
    console.log(chalk.dim('Legacy projects use: agentxchain start'));
    process.exit(1);
  }

  // ── Phase 1: Initialize/Resume Run ────────────────────────────────────────

  let state = loadState(root);
  if (!state) {
    console.log(chalk.red('No governed state.json found. Run `agentxchain init --governed` first.'));
    process.exit(1);
  }

  // Completed runs cannot take more turns
  if (state.status === 'completed') {
    console.log(chalk.green.bold('This run is already completed.'));
    if (state.completed_at) {
      console.log(chalk.dim(`  Completed at: ${state.completed_at}`));
    }
    console.log(chalk.dim('  No more turns can be assigned to a completed run.'));
    process.exit(0);
  }

  // If a turn is already active, skip assignment and go straight to waiting
  let skipAssignment = false;

  if (state.status === 'active' && state.current_turn) {
    if (opts.resume) {
      // User explicitly wants to resume waiting for the active turn
      skipAssignment = true;
      console.log(chalk.yellow(`Resuming active turn: ${state.current_turn.turn_id}`));
    } else {
      console.log(chalk.yellow('A turn is already active:'));
      console.log(`  Turn:  ${state.current_turn.turn_id}`);
      console.log(`  Role:  ${state.current_turn.assigned_role}`);
      console.log('');
      console.log(chalk.dim('Use agentxchain step --resume to continue waiting for this turn.'));
      console.log(chalk.dim('Or run: agentxchain accept-turn / reject-turn'));
      process.exit(1);
    }
  }

  if (!skipAssignment) {
    // Handle paused + failed/retrying turn → re-dispatch
    if (state.status === 'paused' && state.current_turn) {
      const turnStatus = state.current_turn.status;
      if (turnStatus === 'failed' || turnStatus === 'retrying') {
        console.log(chalk.yellow(`Re-dispatching failed turn: ${state.current_turn.turn_id}`));
        state.status = 'active';
        state.blocked_on = null;
        safeWriteJson(join(root, STATE_PATH), state);
        skipAssignment = true;

        const bundleResult = writeDispatchBundle(root, state, config);
        if (!bundleResult.ok) {
          console.log(chalk.red(`Failed to write dispatch bundle: ${bundleResult.error}`));
          process.exit(1);
        }
        printDispatchBundleWarnings(bundleResult);
      }
    }

    // idle → initialize run
    if (!skipAssignment && state.status === 'idle' && !state.run_id) {
      const initResult = initializeGovernedRun(root, config);
      if (!initResult.ok) {
        console.log(chalk.red(`Failed to initialize run: ${initResult.error}`));
        process.exit(1);
      }
      state = initResult.state;
      console.log(chalk.green(`Initialized governed run: ${state.run_id}`));
    }

    // paused → resume
    if (!skipAssignment && state.status === 'paused' && state.run_id) {
      state.status = 'active';
      state.blocked_on = null;
      state.escalation = null;
      safeWriteJson(join(root, STATE_PATH), state);
      console.log(chalk.green(`Resumed governed run: ${state.run_id}`));
    }

    // Assign the turn
    if (!skipAssignment) {
      const roleId = resolveTargetRole(opts, state, config);
      if (!roleId) {
        process.exit(1);
      }

      const assignResult = assignGovernedTurn(root, config, roleId);
      if (!assignResult.ok) {
        console.log(chalk.red(`Failed to assign turn: ${assignResult.error}`));
        process.exit(1);
      }
      state = assignResult.state;

      const bundleResult = writeDispatchBundle(root, state, config);
      if (!bundleResult.ok) {
        console.log(chalk.red(`Failed to write dispatch bundle: ${bundleResult.error}`));
        process.exit(1);
      }
      printDispatchBundleWarnings(bundleResult);
    }
  } else {
    const bundleResult = writeDispatchBundle(root, state, config);
    if (!bundleResult.ok) {
      console.log(chalk.red(`Failed to write dispatch bundle: ${bundleResult.error}`));
      process.exit(1);
    }
    printDispatchBundleWarnings(bundleResult);
  }

  // ── Phase 2: Dispatch — adapter-specific ──────────────────────────────────

  const turn = state.current_turn;
  const roleId = turn.assigned_role;
  const role = config.roles?.[roleId];
  const runtimeId = turn.runtime_id;
  const runtime = config.runtimes?.[runtimeId];
  const runtimeType = runtime?.type || role?.runtime_class || 'manual';

  const controller = new AbortController();
  process.on('SIGINT', () => {
    controller.abort();
  });

  if (runtimeType === 'api_proxy') {
    console.log(chalk.cyan(`Dispatching to API proxy: ${runtime?.provider || '(unknown)'} / ${runtime?.model || '(unknown)'}`));
    console.log(chalk.dim(`Turn: ${turn.turn_id}  Role: ${roleId}  Phase: ${state.phase}`));

    const apiResult = await dispatchApiProxy(root, state, config, {
      signal: controller.signal,
      onStatus: (msg) => console.log(chalk.dim(`  ${msg}`)),
    });

    if (!apiResult.ok) {
      console.log('');
      console.log(chalk.red(`API proxy dispatch failed: ${apiResult.error}`));

      if (apiResult.classified) {
        const c = apiResult.classified;
        console.log(chalk.yellow(`  Error class: ${c.error_class}${c.retryable ? ' (retryable)' : ''}`));
        console.log(chalk.yellow(`  Recovery: ${c.recovery}`));
      }

      console.log(chalk.dim('The turn remains assigned. You can:'));
      console.log(chalk.dim('  - Fix the issue and retry: agentxchain step --resume'));
      console.log(chalk.dim('  - Complete manually: edit .agentxchain/staging/turn-result.json'));
      console.log(chalk.dim('  - Reject: agentxchain reject-turn --reason "api proxy failed"'));
      process.exit(1);
    }

    console.log(chalk.green('API proxy completed. Staged result detected.'));
    if (apiResult.usage) {
      console.log(chalk.dim(`  Tokens: ${apiResult.usage.input_tokens || 0} in / ${apiResult.usage.output_tokens || 0} out`));
    }
    console.log('');
  }

  // ── Phase 3: Wait for turn completion ─────────────────────────────────────

  if (runtimeType === 'api_proxy') {
    // api_proxy is synchronous — result already staged in Phase 2
  } else if (runtimeType === 'local_cli') {
    // ── Local CLI adapter: spawn subprocess ──
    const transport = runtime ? resolvePromptTransport(runtime) : 'dispatch_bundle_only';
    console.log(chalk.cyan(`Dispatching to local CLI: ${runtime?.command || '(default)'}`));
    console.log(chalk.dim(`Turn: ${turn.turn_id}  Role: ${roleId}  Phase: ${state.phase}  Transport: ${transport}`));
    if (transport === 'dispatch_bundle_only') {
      console.log(chalk.yellow('Warning: prompt_transport is "dispatch_bundle_only" — the prompt will NOT be delivered to the subprocess automatically.'));
      console.log(chalk.yellow('The subprocess must independently read from .agentxchain/dispatch/current/PROMPT.md'));
      console.log(chalk.dim('To enable automatic prompt delivery, set prompt_transport to "argv" or "stdin" in the runtime config.'));
    }
    console.log(chalk.dim('Press Ctrl+C to abort and leave the turn assigned.'));
    console.log('');

    const cliResult = await dispatchLocalCli(root, state, config, {
      signal: controller.signal,
      onStdout: opts.verbose ? (text) => process.stdout.write(chalk.dim(text)) : undefined,
      onStderr: opts.verbose ? (text) => process.stderr.write(chalk.yellow(text)) : undefined,
    });

    // Save logs for auditability
    if (cliResult.logs?.length) {
      saveDispatchLogs(root, cliResult.logs);
    }

    if (cliResult.aborted) {
      console.log('');
      console.log(chalk.yellow('Aborted. Turn remains assigned.'));
      console.log(chalk.dim('Resume later with: agentxchain step --resume'));
      console.log(chalk.dim('Or accept/reject manually: agentxchain accept-turn / reject-turn'));
      process.exit(0);
    }

    if (cliResult.timedOut) {
      console.log('');
      console.log(chalk.red('Turn timed out. Subprocess was terminated.'));
      console.log(chalk.dim('The turn remains assigned. You can:'));
      console.log(chalk.dim('  - Re-dispatch: agentxchain step --resume'));
      console.log(chalk.dim('  - Reject and retry: agentxchain reject-turn --reason "timeout"'));
      process.exit(1);
    }

    if (!cliResult.ok) {
      console.log('');
      console.log(chalk.red(`Subprocess failed: ${cliResult.error}`));
      if (cliResult.exitCode != null) {
        console.log(chalk.dim(`Exit code: ${cliResult.exitCode}`));
      }
      console.log(chalk.dim('The turn remains assigned. You can:'));
      console.log(chalk.dim('  - Fix and retry: agentxchain step --resume'));
      console.log(chalk.dim('  - Reject: agentxchain reject-turn --reason "subprocess failed"'));
      process.exit(1);
    }

    console.log(chalk.green('Subprocess completed. Staged result detected.'));
    console.log('');
  } else {
    // ── Manual adapter: poll for staged result ──
    console.log(printManualDispatchInstructions(state, config));
    console.log(chalk.dim('Waiting for turn result...'));
    console.log(chalk.dim(`Polling: .agentxchain/staging/turn-result.json (every ${opts.poll || 2}s)`));
    console.log(chalk.dim('Press Ctrl+C to abort and leave the turn assigned.'));
    console.log('');

    const pollIntervalMs = (parseInt(opts.poll, 10) || 2) * 1000;
    const timeoutMs = turn.deadline_at
      ? Math.max(0, new Date(turn.deadline_at).getTime() - Date.now())
      : 1200000; // 20 minutes default

    const waitResult = await waitForStagedResult(root, {
      pollIntervalMs,
      timeoutMs,
      signal: controller.signal,
    });

    if (waitResult.aborted) {
      console.log('');
      console.log(chalk.yellow('Aborted. Turn remains assigned.'));
      console.log(chalk.dim('Resume later with: agentxchain step --resume'));
      console.log(chalk.dim('Or accept/reject manually: agentxchain accept-turn / reject-turn'));
      process.exit(0);
    }

    if (waitResult.timedOut) {
      console.log('');
      console.log(chalk.red('Turn timed out. No staged result found.'));
      console.log(chalk.dim('The turn remains assigned. You can:'));
      console.log(chalk.dim('  - Continue working and run: agentxchain step --resume'));
      console.log(chalk.dim('  - Reject and retry: agentxchain reject-turn --reason "timeout"'));
      process.exit(1);
    }

    console.log(chalk.green('Staged result detected.'));
    console.log('');
  }

  // ── Phase 4: Validate and accept/reject ───────────────────────────────────

  // Reload state (it may have been modified by the agent in local_cli mode)
  state = loadState(root);

  const validation = validateStagedTurnResult(root, state, config);

  if (validation.ok) {
    // Accept the turn
    const acceptResult = acceptGovernedTurn(root, config);
    if (!acceptResult.ok) {
      console.log(chalk.red(`Acceptance failed: ${acceptResult.error}`));
      process.exit(1);
    }

    printAcceptSummary(acceptResult);
  } else {
    // Reject and potentially retry
    console.log(chalk.yellow('Validation failed:'));
    console.log(`  Stage:  ${validation.stage}`);
    for (const err of validation.errors) {
      console.log(`  Error:  ${err}`);
    }
    console.log('');

    if (opts.autoReject) {
      const rejectResult = rejectGovernedTurn(root, config, {
        errors: validation.errors,
        failed_stage: validation.stage,
      });

      if (!rejectResult.ok) {
        console.log(chalk.red(`Rejection failed: ${rejectResult.error}`));
        process.exit(1);
      }

      if (rejectResult.escalated) {
        printEscalationSummary(rejectResult);
      } else {
        console.log(chalk.yellow('Turn rejected for retry.'));
        console.log(`  Attempt: ${rejectResult.state?.current_turn?.attempt}`);
        console.log('');
        console.log(chalk.dim('The retry dispatch bundle has been written.'));
        console.log(chalk.dim('Run: agentxchain step --resume to continue.'));
      }
    } else {
      console.log(chalk.dim('The staged result failed validation.'));
      console.log(chalk.dim('Review the errors above, then:'));
      console.log(chalk.dim('  - Fix the staged result and run: agentxchain accept-turn'));
      console.log(chalk.dim('  - Reject and retry: agentxchain reject-turn'));
      console.log(chalk.dim('  - Auto-reject on failure: agentxchain step --auto-reject'));
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function loadState(root) {
  const statePath = join(root, STATE_PATH);
  if (!existsSync(statePath)) return null;
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
}

function resolveTargetRole(opts, state, config) {
  const phase = state.phase;
  const routing = config.routing?.[phase];

  if (opts.role) {
    if (!config.roles?.[opts.role]) {
      console.log(chalk.red(`Unknown role: "${opts.role}"`));
      console.log(chalk.dim(`Available roles: ${Object.keys(config.roles || {}).join(', ')}`));
      return null;
    }
    if (routing?.allowed_next_roles && !routing.allowed_next_roles.includes(opts.role) && opts.role !== 'human') {
      console.log(chalk.yellow(`Warning: role "${opts.role}" is not in allowed_next_roles for phase "${phase}".`));
    }
    return opts.role;
  }

  // Use stored next_recommended_role if routing-legal
  if (state.next_recommended_role) {
    const recommended = state.next_recommended_role;
    if (config.roles?.[recommended]) {
      const isLegal = !routing?.allowed_next_roles || routing.allowed_next_roles.includes(recommended);
      if (isLegal) {
        console.log(chalk.dim(`Using recommended role: ${recommended} (from previous turn)`));
        return recommended;
      }
    }
  }

  if (routing?.entry_role) {
    return routing.entry_role;
  }

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

function printAcceptSummary(result) {
  const accepted = result.accepted;
  const recovery = deriveRecoveryDescriptor(result.state);
  console.log('');
  console.log(chalk.green('  Turn Accepted'));
  console.log(chalk.dim('  ' + '-'.repeat(44)));
  console.log('');
  console.log(`  ${chalk.dim('Turn:')}     ${accepted?.turn_id || '(unknown)'}`);
  console.log(`  ${chalk.dim('Role:')}     ${accepted?.role || '(unknown)'}`);
  console.log(`  ${chalk.dim('Status:')}   ${accepted?.status || 'completed'}`);
  console.log(`  ${chalk.dim('Summary:')}  ${accepted?.summary || '(none)'}`);
  if (accepted?.proposed_next_role) {
    console.log(`  ${chalk.dim('Proposed:')} ${accepted.proposed_next_role}`);
  }
  if (accepted?.cost?.usd != null) {
    console.log(`  ${chalk.dim('Cost:')}     $${(accepted.cost.usd || 0).toFixed(2)}`);
  }
  console.log('');

  if (result.state?.status === 'completed') {
    console.log(chalk.green.bold('  \u2713 Run completed'));
    if (result.state.completed_at) {
      console.log(chalk.dim(`  Completed at: ${result.state.completed_at}`));
    }
  } else if (recovery) {
    console.log(`  ${chalk.dim('Reason:')}   ${recovery.typed_reason}`);
    console.log(`  ${chalk.dim('Owner:')}    ${recovery.owner}`);
    console.log(`  ${chalk.dim('Action:')}   ${recovery.recovery_action}`);
    console.log(`  ${chalk.dim('Turn:')}     ${recovery.turn_retained ? 'retained' : 'cleared'}`);
    if (recovery.detail) {
      console.log(`  ${chalk.dim('Detail:')}   ${recovery.detail}`);
    }
  } else if (accepted?.proposed_next_role && accepted.proposed_next_role !== 'human') {
    console.log(chalk.dim(`  Next: agentxchain step --role ${accepted.proposed_next_role}`));
  } else {
    console.log(chalk.dim('  Next: review state, then run agentxchain step when ready.'));
  }
  console.log('');
}

function printEscalationSummary(result) {
  const recovery = deriveRecoveryDescriptor(result.state);
  console.log('');
  console.log(chalk.red('  Turn Escalated'));
  console.log(chalk.dim('  ' + '-'.repeat(44)));
  console.log('');
  if (recovery) {
    console.log(`  ${chalk.dim('Reason:')}   ${recovery.typed_reason}`);
    console.log(`  ${chalk.dim('Owner:')}    ${recovery.owner}`);
    console.log(`  ${chalk.dim('Action:')}   ${recovery.recovery_action}`);
    console.log(`  ${chalk.dim('Turn:')}     ${recovery.turn_retained ? 'retained' : 'cleared'}`);
    if (recovery.detail) {
      console.log(`  ${chalk.dim('Detail:')}   ${recovery.detail}`);
    }
  } else {
    console.log(`  ${chalk.dim('Blocked on:')} ${result.state?.blocked_on}`);
    console.log(chalk.dim('  Resolve the escalation, then run agentxchain step to re-dispatch.'));
  }
  console.log('');
}
