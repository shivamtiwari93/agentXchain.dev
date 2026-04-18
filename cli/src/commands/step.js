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
 *   - mcp: implemented for synchronous MCP stdio or streamable_http tool dispatch
 *   - remote_agent: implemented for synchronous HTTP dispatch to external agent services
 */

import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadProjectContext, loadProjectState } from '../lib/config.js';
import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  deriveAfterDispatchHookRecoveryAction,
  rejectGovernedTurn,
  markRunBlocked,
  getActiveTurnCount,
  getActiveTurns,
  reactivateGovernedRun,
  refreshTurnBaselineSnapshot,
  STATE_PATH,
} from '../lib/governed-state.js';
import { getMaxConcurrentTurns } from '../lib/normalized-config.js';
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
import { describeMcpRuntimeTarget, dispatchMcp, resolveMcpTransport } from '../lib/adapters/mcp-adapter.js';
import { dispatchRemoteAgent, describeRemoteAgentTarget } from '../lib/adapters/remote-agent-adapter.js';
import { summarizeRunProvenance } from '../lib/run-provenance.js';
import {
  getDispatchAssignmentPath,
  getDispatchContextPath,
  getDispatchEffectiveContextPath,
  getDispatchPromptPath,
  getDispatchTurnDir,
  getTurnStagingResultPath,
} from '../lib/turn-paths.js';
import { dispatchApiProxy } from '../lib/adapters/api-proxy-adapter.js';
import { deriveRecoveryDescriptor } from '../lib/blocked-state.js';
import { deriveConflictedTurnResolutionActions } from '../lib/conflict-actions.js';
import { runHooks } from '../lib/hook-runner.js';
import { finalizeDispatchManifest, verifyDispatchManifest } from '../lib/dispatch-manifest.js';
import { resolveGovernedRole } from '../lib/role-resolution.js';
import { shouldSuggestManualQaFallback } from '../lib/manual-qa-fallback.js';
import { evaluateApprovalSlaReminders } from '../lib/notification-runner.js';
import { consumeNextApprovedIntent } from '../lib/intake.js';

export async function stepCommand(opts) {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config } = context;

  if (config.protocol_mode !== 'governed') {
    console.log(chalk.red('The step command is only available for governed projects.'));
    console.log(chalk.dim('Legacy projects use: agentxchain start'));
    process.exit(1);
  }

  // ── Phase 1: Initialize/Resume Run ────────────────────────────────────────

  let state = loadProjectState(root, config);
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

  // If a turn is already active, decide whether to skip assignment or allow parallel
  let skipAssignment = false;
  let bundleWritten = false;
  let targetTurn = null;
  const maxConcurrent = getMaxConcurrentTurns(config, state.phase);
  const activeCount = getActiveTurnCount(state);
  const activeTurns = getActiveTurns(state);

  if (state.status === 'active' && activeCount > 0) {
    if (opts.resume) {
      // Resolve the target turn for resume
      if (opts.turn) {
        targetTurn = activeTurns[opts.turn];
        if (!targetTurn) {
          console.log(chalk.red(`No active turn found for --turn ${opts.turn}`));
          process.exit(1);
        }
      } else if (activeCount > 1) {
        console.log(chalk.red('Multiple active turns exist. Use --turn <id> to specify which turn to resume.'));
        console.log('');
        for (const turn of Object.values(activeTurns)) {
          const statusLabel = turn.status === 'conflicted' ? chalk.red('conflicted') : turn.status;
          console.log(`  ${chalk.yellow('●')} ${turn.turn_id} — ${chalk.bold(turn.assigned_role)} (${statusLabel})`);
        }
        console.log('');
        console.log(chalk.dim('Example: agentxchain step --resume --turn <turn_id>'));
        process.exit(1);
      } else {
        targetTurn = Object.values(activeTurns)[0];
      }

      // If the target turn is conflicted, print recovery paths instead of resuming
      if (targetTurn.status === 'conflicted') {
        const [reassignAction, mergeAction] = deriveConflictedTurnResolutionActions(targetTurn.turn_id);
        console.log(chalk.yellow(`Turn ${targetTurn.turn_id} is conflicted. Resolve the conflict before resuming.`));
        console.log('');
        console.log(chalk.dim('Recovery options:'));
        console.log(`  ${chalk.cyan(reassignAction.command)}  — ${reassignAction.description}`);
        console.log(`  ${chalk.cyan(mergeAction.command)}  — ${mergeAction.description}`);
        process.exit(1);
      }

      skipAssignment = true;
      console.log(chalk.yellow(`Resuming active turn: ${targetTurn.turn_id}`));
    } else if (activeCount >= maxConcurrent) {
      // At capacity — cannot assign more
      if (activeCount === 1) {
        const turn = Object.values(activeTurns)[0];
        console.log(chalk.yellow('A turn is already active:'));
        console.log(`  Turn:  ${turn.turn_id}`);
        console.log(`  Role:  ${turn.assigned_role}`);
      } else {
        console.log(chalk.yellow(`${activeCount} turns are active (at capacity ${maxConcurrent}):`));
        for (const turn of Object.values(activeTurns)) {
          const statusLabel = turn.status === 'conflicted' ? chalk.red('conflicted') : turn.status;
          console.log(`  ${chalk.yellow('●')} ${turn.turn_id} — ${chalk.bold(turn.assigned_role)} (${statusLabel})`);
        }
      }
      console.log('');
      console.log(chalk.dim('Use agentxchain step --resume to continue waiting for an active turn.'));
      console.log(chalk.dim('Or run: agentxchain accept-turn / reject-turn'));
      process.exit(1);
    }
    // else: under capacity, fall through to assignment
  }

  if (!skipAssignment) {
    if (state.pending_phase_transition || state.pending_run_completion) {
      evaluateApprovalSlaReminders(root, config, state);
      printRecoverySummary(state, 'This run is awaiting approval.', config);
      process.exit(1);
    }

    if (state.status === 'blocked' && activeCount > 0) {
      if (!opts.resume) {
        printRecoverySummary(state, 'This run is blocked on a retained turn.', config);
        process.exit(1);
      }

      // Resolve target for blocked resume
      if (!targetTurn) {
        if (opts.turn) {
          targetTurn = activeTurns[opts.turn];
          if (!targetTurn) {
            console.log(chalk.red(`No active turn found for --turn ${opts.turn}`));
            process.exit(1);
          }
        } else if (activeCount > 1) {
          console.log(chalk.red('Multiple retained turns exist. Use --turn <id> to specify which to resume.'));
          for (const turn of Object.values(activeTurns)) {
            console.log(`  ${chalk.yellow('●')} ${turn.turn_id} — ${chalk.bold(turn.assigned_role)} (${turn.status})`);
          }
          console.log('');
          console.log(chalk.dim('Example: agentxchain step --resume --turn <turn_id>'));
          process.exit(1);
        } else {
          targetTurn = Object.values(activeTurns)[0];
        }
      }

      // If the target turn is conflicted, print recovery paths
      if (targetTurn.status === 'conflicted') {
        const [reassignAction, mergeAction] = deriveConflictedTurnResolutionActions(targetTurn.turn_id);
        console.log(chalk.yellow(`Turn ${targetTurn.turn_id} is conflicted. Resolve the conflict before resuming.`));
        console.log('');
        console.log(chalk.dim('Recovery options:'));
        console.log(`  ${chalk.cyan(reassignAction.command)}  — ${reassignAction.description}`);
        console.log(`  ${chalk.cyan(mergeAction.command)}  — ${mergeAction.description}`);
        process.exit(1);
      }

      // If the target turn failed acceptance, print recovery guidance (BUG-3 fix)
      if (targetTurn.status === 'failed_acceptance') {
        console.log(chalk.red(`Turn ${targetTurn.turn_id} (${targetTurn.assigned_role}) failed acceptance.`));
        console.log(chalk.dim(`Reason: ${targetTurn.failure_reason || 'unknown'}`));
        console.log('');
        console.log(chalk.dim('Recovery options:'));
        console.log(`  ${chalk.cyan(`agentxchain reject-turn --turn ${targetTurn.turn_id}`)}  — reject and retry`);
        console.log(`  ${chalk.cyan(`agentxchain accept-turn --turn ${targetTurn.turn_id}`)}  — re-attempt acceptance after fixing`);
        process.exit(1);
      }

      console.log(chalk.yellow(`Re-dispatching blocked turn: ${targetTurn.turn_id}`));
      const reactivated = reactivateGovernedRun(root, state, { via: 'step --resume', notificationConfig: config });
      if (!reactivated.ok) {
        console.log(chalk.red(`Failed to reactivate blocked run: ${reactivated.error}`));
        process.exit(1);
      }
      state = reactivated.state;
      skipAssignment = true;

      // BUG-1 fix: refresh baseline snapshot to capture files dirtied between assignment and dispatch
      refreshTurnBaselineSnapshot(root, targetTurn.turn_id);
      state = JSON.parse(readFileSync(join(root, '.agentxchain/state.json'), 'utf8'));

      const bundleResult = writeDispatchBundle(root, state, config);
      if (!bundleResult.ok) {
        console.log(chalk.red(`Failed to write dispatch bundle: ${bundleResult.error}`));
        process.exit(1);
      }
      bundleWritten = true;
      printDispatchBundleWarnings(bundleResult);
    }

    // Handle paused + failed/retrying turn → re-dispatch
    if (!skipAssignment && state.status === 'paused' && activeCount > 0) {
      const pausedTurn = targetTurn || Object.values(activeTurns)[0];
      const turnStatus = pausedTurn?.status;
      if (turnStatus === 'failed' || turnStatus === 'retrying') {
        console.log(chalk.yellow(`Re-dispatching failed turn: ${pausedTurn.turn_id}`));
        const reactivated = reactivateGovernedRun(root, state, { via: 'step --resume', notificationConfig: config });
        if (!reactivated.ok) {
          console.log(chalk.red(`Failed to reactivate run: ${reactivated.error}`));
          process.exit(1);
        }
        state = reactivated.state;
        skipAssignment = true;

        // BUG-1 fix: refresh baseline snapshot to capture files dirtied between assignment and dispatch
        refreshTurnBaselineSnapshot(root, pausedTurn.turn_id);
        state = JSON.parse(readFileSync(join(root, '.agentxchain/state.json'), 'utf8'));

        const bundleResult = writeDispatchBundle(root, state, config);
        if (!bundleResult.ok) {
          console.log(chalk.red(`Failed to write dispatch bundle: ${bundleResult.error}`));
          process.exit(1);
        }
        bundleWritten = true;
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
    if (!skipAssignment && state.status === 'blocked' && state.run_id) {
      const reactivated = reactivateGovernedRun(root, state, { via: 'step', notificationConfig: config });
      if (!reactivated.ok) {
        console.log(chalk.red(`Failed to reactivate blocked run: ${reactivated.error}`));
        process.exit(1);
      }
      state = reactivated.state;
      console.log(chalk.green(`Resumed blocked run: ${state.run_id}`));
    }

    if (!skipAssignment && state.status === 'paused' && state.run_id) {
      const reactivated = reactivateGovernedRun(root, state, { via: 'step', notificationConfig: config });
      if (!reactivated.ok) {
        console.log(chalk.red(`Failed to reactivate run: ${reactivated.error}`));
        process.exit(1);
      }
      state = reactivated.state;
      console.log(chalk.green(`Resumed governed run: ${state.run_id}`));
    }

    // Assign the turn
    if (!skipAssignment) {
      const roleId = resolveTargetRole(opts, state, config);
      if (!roleId) {
        process.exit(1);
      }

      const shouldBindIntent = opts.intent !== false;
      const consumed = shouldBindIntent ? consumeNextApprovedIntent(root, { role: roleId }) : { ok: false };
      if (consumed.ok) {
        state = loadProjectState(root, config);
        if (!state) {
          console.log(chalk.red('Failed to reload governed state after intake binding.'));
          process.exit(1);
        }
      } else {
        const assignResult = assignGovernedTurn(root, config, roleId);
        if (!assignResult.ok) {
          if (assignResult.error_code?.startsWith('hook_') || assignResult.error_code === 'hook_blocked') {
            printAssignmentHookFailure(assignResult, roleId, config);
          }
          console.log(chalk.red(`Failed to assign turn: ${assignResult.error}`));
          process.exit(1);
        }
        printAssignmentWarnings(assignResult);
        state = assignResult.state;
      }

      const bundleResult = writeDispatchBundle(root, state, config);
      if (!bundleResult.ok) {
        console.log(chalk.red(`Failed to write dispatch bundle: ${bundleResult.error}`));
        process.exit(1);
      }
      bundleWritten = true;
      printDispatchBundleWarnings(bundleResult);
    }
  } else {
    const bundleResult = writeDispatchBundle(root, state, config);
    if (!bundleResult.ok) {
      console.log(chalk.red(`Failed to write dispatch bundle: ${bundleResult.error}`));
      process.exit(1);
    }
    bundleWritten = true;
    printDispatchBundleWarnings(bundleResult);
  }

  // ── Phase 2: Dispatch — adapter-specific ──────────────────────────────────

  const turn = targetTurn || state.current_turn;
  const roleId = turn.assigned_role;
  const role = config.roles?.[roleId];
  const runtimeId = turn.runtime_id;
  const runtime = config.runtimes?.[runtimeId];
  const runtimeType = runtime?.type || role?.runtime_class || 'manual';
  const hooksConfig = config.hooks || {};

  printStepRunContext({ root, state, config });

  if (bundleWritten && hooksConfig.after_dispatch?.length > 0) {
    const afterDispatchHooks = runHooks(root, hooksConfig, 'after_dispatch', {
      turn_id: turn.turn_id,
      role_id: roleId,
      bundle_path: getDispatchTurnDir(turn.turn_id),
      bundle_files: ['ASSIGNMENT.json', 'PROMPT.md', 'CONTEXT.md'],
    }, {
      run_id: state.run_id,
      turn_id: turn.turn_id,
      protectedPaths: [
        getDispatchAssignmentPath(turn.turn_id),
        getDispatchPromptPath(turn.turn_id),
        getDispatchContextPath(turn.turn_id),
        getDispatchEffectiveContextPath(turn.turn_id),
      ],
    });

    if (!afterDispatchHooks.ok) {
      const blocked = blockStepForHookIssue(root, state, turn, {
        hookResults: afterDispatchHooks,
        phase: 'after_dispatch',
        defaultDetail: `after_dispatch hook blocked dispatch for turn ${turn.turn_id}`,
        config,
      });
      printLifecycleHookFailure('Dispatch Blocked By Hook', blocked.result, {
        turnId: turn.turn_id,
        roleId,
        action: `Fix or reconfigure the hook, then rerun agentxchain step --resume${turn.turn_id ? ` --turn ${turn.turn_id}` : ''}`,
        config,
      });
      process.exit(1);
    }
  }

  // ── Phase 2b: Finalize dispatch manifest ────────────────────────────────
  if (bundleWritten) {
    const manifestResult = finalizeDispatchManifest(root, turn.turn_id, {
      run_id: state.run_id,
      role: roleId,
    });
    if (!manifestResult.ok) {
      console.log(chalk.red(`Failed to finalize dispatch manifest: ${manifestResult.error}`));
      process.exit(1);
    }
  }

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
      verifyManifest: true,
    });

    if (!apiResult.ok) {
      const blocked = markRunBlocked(root, {
        blockedOn: `dispatch:${apiResult.classified?.error_class || 'api_proxy_failure'}`,
        category: 'dispatch_error',
        recovery: {
          typed_reason: 'dispatch_error',
          owner: 'human',
          recovery_action: 'Resolve the dispatch issue, then run agentxchain step --resume',
          turn_retained: true,
          detail: apiResult.classified?.recovery || apiResult.error,
        },
        turnId: turn.turn_id,
        hooksConfig,
        notificationConfig: config,
      });
      if (blocked.ok) {
        state = blocked.state;
      }

      console.log('');
      if (apiResult.attempts_made > 1) {
        console.log(chalk.red(`API proxy dispatch failed after ${apiResult.attempts_made} attempts: ${apiResult.error}`));
      } else {
        console.log(chalk.red(`API proxy dispatch failed: ${apiResult.error}`));
      }

      if (apiResult.classified) {
        const c = apiResult.classified;
        console.log(chalk.yellow(`  Error class: ${c.error_class}${c.retryable ? ' (retryable)' : ''}`));
        console.log(chalk.yellow(`  Recovery: ${c.recovery}`));
      }

      if (apiResult.preflight_artifacts) {
        console.log(chalk.dim(`  Token budget report: ${apiResult.preflight_artifacts.token_budget}`));
        console.log(chalk.dim(`  Effective context:   ${apiResult.preflight_artifacts.effective_context}`));
      }

      if (apiResult.retry_trace_path) {
        console.log(chalk.dim(`  Retry trace: ${apiResult.retry_trace_path}`));
      }

      if (shouldSuggestManualQaFallback({
        roleId,
        runtimeId,
        classified: apiResult.classified,
        config,
      })) {
        console.log(chalk.dim('  No-key QA fallback:'));
        console.log(chalk.dim('  - Edit agentxchain.json and change roles.qa.runtime from "api-qa" to "manual-qa"'));
        console.log(chalk.dim('  - Then rerun: agentxchain step --resume'));
        console.log(chalk.dim('  - Guide: https://agentxchain.dev/docs/getting-started'));
      }

      console.log(chalk.dim('The turn remains assigned. You can:'));
      console.log(chalk.dim('  - Fix the issue and retry: agentxchain step --resume'));
      console.log(chalk.dim('  - Complete manually: edit .agentxchain/staging/turn-result.json'));
      console.log(chalk.dim('  - Reject: agentxchain reject-turn --reason "api proxy failed"'));
      process.exit(1);
    }

    if (apiResult.attempts_made > 1) {
      console.log(chalk.green(`API proxy completed after ${apiResult.attempts_made} attempts. Staged result detected.`));
    } else {
      console.log(chalk.green('API proxy completed. Staged result detected.'));
    }
    if (apiResult.usage) {
      console.log(chalk.dim(`  Tokens: ${apiResult.usage.input_tokens || 0} in / ${apiResult.usage.output_tokens || 0} out`));
    }
    console.log('');
  } else if (runtimeType === 'mcp') {
    const mcpTransport = resolveMcpTransport(runtime);
    console.log(chalk.cyan(`Dispatching to MCP ${mcpTransport}: ${describeMcpRuntimeTarget(runtime)}`));
    console.log(chalk.dim(`Turn: ${turn.turn_id}  Role: ${roleId}  Phase: ${state.phase}  Tool: ${runtime?.tool_name || 'agentxchain_turn'}`));

    const mcpResult = await dispatchMcp(root, state, config, {
      signal: controller.signal,
      onStatus: (msg) => console.log(chalk.dim(`  ${msg}`)),
      onStderr: opts.verbose ? (text) => process.stderr.write(chalk.yellow(text)) : undefined,
      verifyManifest: true,
    });

    if (mcpResult.logs?.length) {
      saveDispatchLogs(root, turn.turn_id, mcpResult.logs);
    }

    if (mcpResult.aborted) {
      console.log('');
      console.log(chalk.yellow('Aborted. Turn remains assigned.'));
      console.log(chalk.dim('Resume later with: agentxchain step --resume'));
      console.log(chalk.dim('Or accept/reject manually: agentxchain accept-turn / reject-turn'));
      process.exit(0);
    }

    if (!mcpResult.ok) {
      const blocked = markRunBlocked(root, {
        blockedOn: 'dispatch:mcp_failure',
        category: 'dispatch_error',
        recovery: {
          typed_reason: 'dispatch_error',
          owner: 'human',
          recovery_action: 'Resolve the MCP dispatch issue, then run agentxchain step --resume',
          turn_retained: true,
          detail: mcpResult.error,
        },
        turnId: turn.turn_id,
        hooksConfig,
        notificationConfig: config,
      });
      if (blocked.ok) {
        state = blocked.state;
      }

      console.log('');
      console.log(chalk.red(`MCP dispatch failed: ${mcpResult.error}`));
      console.log(chalk.dim('The turn remains assigned. You can:'));
      console.log(chalk.dim('  - Fix the MCP server/runtime and retry: agentxchain step --resume'));
      console.log(chalk.dim('  - Complete manually: edit .agentxchain/staging/turn-result.json'));
      console.log(chalk.dim('  - Reject: agentxchain reject-turn --reason "mcp dispatch failed"'));
      process.exit(1);
    }

    console.log(chalk.green(`MCP tool completed${mcpResult.toolName ? ` (${mcpResult.toolName})` : ''}. Staged result detected.`));
    console.log('');
  } else if (runtimeType === 'remote_agent') {
    console.log(chalk.cyan(`Dispatching to remote agent: ${describeRemoteAgentTarget(runtime)}`));
    console.log(chalk.dim(`Turn: ${turn.turn_id}  Role: ${roleId}  Phase: ${state.phase}`));

    const remoteResult = await dispatchRemoteAgent(root, state, config, {
      signal: controller.signal,
      onStatus: (msg) => console.log(chalk.dim(`  ${msg}`)),
      verifyManifest: true,
    });

    if (remoteResult.logs?.length) {
      saveDispatchLogs(root, turn.turn_id, remoteResult.logs);
    }

    if (remoteResult.aborted) {
      console.log('');
      console.log(chalk.yellow('Aborted. Turn remains assigned.'));
      console.log(chalk.dim('Resume later with: agentxchain step --resume'));
      console.log(chalk.dim('Or accept/reject manually: agentxchain accept-turn / reject-turn'));
      process.exit(0);
    }

    if (!remoteResult.ok) {
      const blocked = markRunBlocked(root, {
        blockedOn: `dispatch:remote_agent_failure`,
        category: 'dispatch_error',
        recovery: {
          typed_reason: 'dispatch_error',
          owner: 'human',
          recovery_action: 'Resolve the remote agent dispatch issue, then run agentxchain step --resume',
          turn_retained: true,
          detail: remoteResult.error,
        },
        turnId: turn.turn_id,
        hooksConfig,
        notificationConfig: config,
      });
      if (blocked.ok) {
        state = blocked.state;
      }

      console.log('');
      console.log(chalk.red(`Remote agent dispatch failed: ${remoteResult.error}`));
      console.log(chalk.dim('The turn remains assigned. You can:'));
      console.log(chalk.dim('  - Fix the issue and retry: agentxchain step --resume'));
      console.log(chalk.dim('  - Complete manually: edit .agentxchain/staging/turn-result.json'));
      console.log(chalk.dim('  - Reject: agentxchain reject-turn --reason "remote agent failed"'));
      process.exit(1);
    }

    console.log(chalk.green('Remote agent completed. Staged result detected.'));
    console.log('');
  }

  // ── Phase 3: Wait for turn completion ─────────────────────────────────────

  if (runtimeType === 'api_proxy' || runtimeType === 'mcp' || runtimeType === 'remote_agent') {
    // api_proxy and mcp are synchronous — result already staged in Phase 2
  } else if (runtimeType === 'local_cli') {
    // ── Local CLI adapter: spawn subprocess ──
    const transport = runtime ? resolvePromptTransport(runtime) : 'dispatch_bundle_only';
    console.log(chalk.cyan(`Dispatching to local CLI: ${runtime?.command || '(default)'}`));
    console.log(chalk.dim(`Turn: ${turn.turn_id}  Role: ${roleId}  Phase: ${state.phase}  Transport: ${transport}`));
    if (transport === 'dispatch_bundle_only') {
      console.log(chalk.yellow('Warning: prompt_transport is "dispatch_bundle_only" — the prompt will NOT be delivered to the subprocess automatically.'));
      console.log(chalk.yellow(`The subprocess must independently read from .agentxchain/dispatch/turns/${turn.turn_id}/PROMPT.md`));
      console.log(chalk.dim('To enable automatic prompt delivery, set prompt_transport to "argv" or "stdin" in the runtime config.'));
    }
    // BUG-6: always show log file path so operators know where to watch
    const logPath = `.agentxchain/dispatch/turns/${turn.turn_id}/stdout.log`;
    console.log(chalk.dim(`Log: ${logPath}`));
    if (!opts.stream && !opts.verbose) {
      console.log(chalk.dim(`  Watch live: tail -f ${logPath}`));
    }
    console.log(chalk.dim('Press Ctrl+C to abort and leave the turn assigned.'));
    console.log('');

    // BUG-6: stream subprocess output by default (--stream or --verbose), suppress with --quiet
    const shouldStream = opts.stream || opts.verbose || false;
    const cliResult = await dispatchLocalCli(root, state, config, {
      signal: controller.signal,
      onStdout: shouldStream ? (text) => process.stdout.write(chalk.dim(text)) : undefined,
      onStderr: shouldStream ? (text) => process.stderr.write(chalk.yellow(text)) : undefined,
      verifyManifest: true,
    });

    // Save logs for auditability
    if (cliResult.logs?.length) {
      saveDispatchLogs(root, turn.turn_id, cliResult.logs);
    }

    if (cliResult.aborted) {
      console.log('');
      console.log(chalk.yellow('Aborted. Turn remains assigned.'));
      console.log(chalk.dim('Resume later with: agentxchain step --resume'));
      console.log(chalk.dim('Or accept/reject manually: agentxchain accept-turn / reject-turn'));
      process.exit(0);
    }

    if (cliResult.timedOut) {
      const blocked = markRunBlocked(root, {
        blockedOn: 'dispatch:timeout',
        category: 'dispatch_error',
        recovery: {
          typed_reason: 'dispatch_error',
          owner: 'human',
          recovery_action: 'Resolve the dispatch issue, then run agentxchain step --resume',
          turn_retained: true,
          detail: 'Subprocess timed out before staging a turn result.',
        },
        turnId: turn.turn_id,
        hooksConfig,
        notificationConfig: config,
      });
      if (blocked.ok) {
        state = blocked.state;
      }

      console.log('');
      console.log(chalk.red('Turn timed out. Subprocess was terminated.'));
      console.log(chalk.dim('The turn remains assigned. You can:'));
      console.log(chalk.dim('  - Re-dispatch: agentxchain step --resume'));
      console.log(chalk.dim('  - Reject and retry: agentxchain reject-turn --reason "timeout"'));
      process.exit(1);
    }

    if (!cliResult.ok) {
      const blocked = markRunBlocked(root, {
        blockedOn: `dispatch:${cliResult.exitCode != null ? `exit-${cliResult.exitCode}` : 'subprocess_failed'}`,
        category: 'dispatch_error',
        recovery: {
          typed_reason: 'dispatch_error',
          owner: 'human',
          recovery_action: 'Resolve the dispatch issue, then run agentxchain step --resume',
          turn_retained: true,
          detail: cliResult.error,
        },
        turnId: turn.turn_id,
        hooksConfig,
        notificationConfig: config,
      });
      if (blocked.ok) {
        state = blocked.state;
      }

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
    console.log(chalk.dim(`Polling: .agentxchain/staging/${turn.turn_id}/turn-result.json (every ${opts.poll || 2}s)`));
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
      turnId: turn.turn_id,
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
  state = loadProjectState(root, config);

  // Resolve staging path: prefer turn-scoped, fall back to flat
  const turnStaging = getTurnStagingResultPath(turn.turn_id);
  const resolvedStaging = existsSync(join(root, turnStaging)) ? turnStaging : undefined;
  const stagedTurn = loadHookStagedTurn(root, resolvedStaging || getTurnStagingResultPath(turn.turn_id));

  if (hooksConfig.before_validation?.length > 0) {
    const beforeValidationHooks = runHooks(root, hooksConfig, 'before_validation', {
      turn_id: turn.turn_id,
      role_id: roleId,
      staging_path: resolvedStaging || getTurnStagingResultPath(turn.turn_id),
      turn_result: stagedTurn.turnResult ?? null,
      ...(stagedTurn.parse_error ? { parse_error: stagedTurn.parse_error } : {}),
      ...(stagedTurn.read_error ? { read_error: stagedTurn.read_error } : {}),
    }, {
      run_id: state.run_id,
      turn_id: turn.turn_id,
    });

    if (!beforeValidationHooks.ok) {
      const blocked = blockStepForHookIssue(root, state, turn, {
        hookResults: beforeValidationHooks,
        phase: 'before_validation',
        defaultDetail: `before_validation hook blocked validation for turn ${turn.turn_id}`,
        config,
      });
      printLifecycleHookFailure('Validation Blocked By Hook', blocked.result, {
        turnId: turn.turn_id,
        roleId,
        action: `Fix or reconfigure the hook, then rerun agentxchain step --resume${turn.turn_id ? ` --turn ${turn.turn_id}` : ''}`,
        config,
      });
      process.exit(1);
    }
  }

  const validation = validateStagedTurnResult(root, state, config, resolvedStaging ? { stagingPath: resolvedStaging } : {});

  if (hooksConfig.after_validation?.length > 0) {
    const afterValidationHooks = runHooks(root, hooksConfig, 'after_validation', {
      turn_id: turn.turn_id,
      role_id: roleId,
      validation_ok: validation.ok,
      validation_stage: validation.stage,
      errors: validation.errors,
      warnings: validation.warnings,
      turn_result: validation.turnResult ?? stagedTurn.turnResult ?? null,
    }, {
      run_id: state.run_id,
      turn_id: turn.turn_id,
    });

    if (!afterValidationHooks.ok) {
      const blocked = blockStepForHookIssue(root, state, turn, {
        hookResults: afterValidationHooks,
        phase: 'after_validation',
        defaultDetail: `after_validation hook blocked acceptance for turn ${turn.turn_id}`,
        config,
      });
      printLifecycleHookFailure('Validation Blocked By Hook', blocked.result, {
        turnId: turn.turn_id,
        roleId,
        action: `Fix or reconfigure the hook, then rerun agentxchain step --resume${turn.turn_id ? ` --turn ${turn.turn_id}` : ''}`,
        config,
      });
      process.exit(1);
    }
  }

  if (validation.ok) {
    // Accept the turn
    const acceptResult = acceptGovernedTurn(root, config, { turnId: turn.turn_id });
    if (!acceptResult.ok) {
      if (acceptResult.accepted && acceptResult.error_code?.startsWith('hook_')) {
        printAcceptedHookFailure(acceptResult, config);
      } else {
        console.log(chalk.red(`Acceptance failed: ${acceptResult.error}`));
      }
      process.exit(1);
    }

    printAcceptSummary(acceptResult, config);
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
        printEscalationSummary(rejectResult, config);
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
      process.exit(1);
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function loadHookStagedTurn(root, stagingRel) {
  const stagingAbs = join(root, stagingRel);
  if (!existsSync(stagingAbs)) {
    return { turnResult: null };
  }

  let raw;
  try {
    raw = readFileSync(stagingAbs, 'utf8');
  } catch (err) {
    return { turnResult: null, read_error: err.message };
  }

  try {
    return { turnResult: JSON.parse(raw) };
  } catch (err) {
    return { turnResult: null, parse_error: err.message };
  }
}

function blockStepForHookIssue(root, state, turn, { hookResults, phase, defaultDetail, config }) {
  const hookName = hookResults.blocker?.hook_name
    || hookResults.results?.find((entry) => entry.hook_name)?.hook_name
    || 'unknown';
  const detail = hookResults.blocker?.message
    || hookResults.tamper?.message
    || defaultDetail;
  const errorCode = hookResults.tamper?.error_code || 'hook_blocked';
  const recoveryAction = deriveAfterDispatchHookRecoveryAction(state, config, {
    turnRetained: true,
    turnId: turn.turn_id,
  });
  const blocked = markRunBlocked(root, {
    blockedOn: `hook:${phase}:${hookName}`,
    category: phase === 'after_dispatch' ? 'dispatch_error' : 'validation_error',
    recovery: {
      typed_reason: hookResults.tamper ? 'hook_tamper' : 'hook_block',
      owner: 'human',
      recovery_action: recoveryAction,
      turn_retained: true,
      detail,
    },
    turnId: turn.turn_id,
    notificationConfig: config,
  });

  return {
    result: {
      ok: false,
      error: detail,
      error_code: errorCode,
      state: blocked.ok ? blocked.state : null,
      hookResults,
    },
    hookName,
  };
}

function printLifecycleHookFailure(title, result, { turnId, roleId, action, config }) {
  const recovery = deriveRecoveryDescriptor(result.state, config);
  const hookName = result.hookResults?.blocker?.hook_name
    || result.hookResults?.results?.find((entry) => entry.hook_name)?.hook_name
    || '(unknown)';

  console.log('');
  console.log(chalk.yellow(`  ${title}`));
  console.log(chalk.dim('  ' + '-'.repeat(44)));
  console.log('');
  console.log(`  ${chalk.dim('Turn:')}     ${turnId || '(unknown)'}`);
  console.log(`  ${chalk.dim('Role:')}     ${roleId || '(unknown)'}`);
  console.log(`  ${chalk.dim('Hook:')}     ${hookName}`);
  console.log(`  ${chalk.dim('Error:')}    ${result.error}`);
  if (recovery) {
    console.log(`  ${chalk.dim('Reason:')}   ${recovery.typed_reason}`);
    console.log(`  ${chalk.dim('Owner:')}    ${recovery.owner}`);
    console.log(`  ${chalk.dim('Action:')}   ${recovery.recovery_action}`);
    if (recovery.detail) {
      console.log(`  ${chalk.dim('Detail:')}   ${recovery.detail}`);
    }
  } else if (action) {
    console.log(`  ${chalk.dim('Action:')}   ${action}`);
  }
  console.log('');
}

function resolveTargetRole(opts, state, config) {
  const resolved = resolveGovernedRole({ override: opts.role || null, state, config });
  if (resolved.error) {
    console.log(chalk.red(resolved.error));
    if (resolved.availableRoles.length) {
      console.log(chalk.dim(`Available roles: ${resolved.availableRoles.join(', ')}`));
    }
    return null;
  }

  if (!opts.role && state.next_recommended_role && resolved.roleId === state.next_recommended_role) {
    console.log(chalk.dim(`Using recommended role: ${resolved.roleId} (from previous turn)`));
  }

  for (const warning of resolved.warnings) {
    console.log(chalk.yellow(`Warning: ${warning}`));
  }

  return resolved.roleId;
}

function printRecoverySummary(state, heading, config) {
  const recovery = deriveRecoveryDescriptor(state, config);
  console.log(chalk.yellow(heading));
  if (!recovery) {
    return;
  }
  console.log(`  ${chalk.dim('Reason:')} ${recovery.typed_reason}`);
  console.log(`  ${chalk.dim('Action:')} ${recovery.recovery_action}`);
  if (recovery.detail) {
    console.log(`  ${chalk.dim('Detail:')} ${recovery.detail}`);
  }
}

function printStepRunContext({ root, state, config }) {
  console.log('');
  console.log(chalk.cyan.bold('agentxchain step'));
  console.log(`  ${chalk.dim('Run:')}      ${state?.run_id || '(uninitialized)'}`);
  console.log(`  ${chalk.dim('Phase:')}    ${state?.phase || '(unknown)'}`);

  const provenanceSummary = summarizeRunProvenance(state?.provenance);
  if (provenanceSummary) {
    console.log(`  ${chalk.dim('Origin:')}   ${chalk.magenta(provenanceSummary)}`);
  }

  if (state?.inherited_context?.parent_run_id) {
    console.log(
      `  ${chalk.dim('Inherits:')} ${chalk.magenta(
        `parent ${state.inherited_context.parent_run_id} (${state.inherited_context.parent_status || 'unknown'})`
      )}`
    );
  }

  const activeGate = config?.routing?.[state?.phase]?.exit_gate || null;
  if (activeGate) {
    const gateStatus = state?.phase_gate_status?.[activeGate] || 'pending';
    console.log(`  ${chalk.dim('Gate:')}     ${activeGate} (${gateStatus})`);

    if (gateStatus !== 'passed') {
      const gateDef = config?.gates?.[activeGate];
      if (Array.isArray(gateDef?.requires_files) && gateDef.requires_files.length > 0) {
        const fileChecks = gateDef.requires_files.map((filePath) => {
          const exists = existsSync(join(root, filePath));
          const shortPath = filePath.replace(/^\.planning\//, '');
          return exists ? chalk.green(shortPath) : chalk.red(shortPath);
        });
        console.log(`  ${chalk.dim('Files:')}    ${fileChecks.join(chalk.dim(', '))}`);
      }

      const requirements = [];
      if (gateDef?.requires_human_approval) requirements.push('human approval');
      if (gateDef?.requires_verification_pass) requirements.push('verification pass');
      if (requirements.length > 0) {
        console.log(`  ${chalk.dim('Needs:')}    ${requirements.join(', ')}`);
      }
    }
  }

  console.log('');
}

function printDispatchBundleWarnings(bundleResult) {
  for (const warning of bundleResult.warnings || []) {
    console.log(chalk.yellow(`Dispatch bundle warning: ${warning}`));
  }
}

function printAssignmentWarnings(assignResult) {
  for (const warning of assignResult.warnings || []) {
    console.log(chalk.yellow(`Warning: ${warning}`));
  }
}

function printAssignmentHookFailure(result, roleId, config) {
  const recovery = deriveRecoveryDescriptor(result.state, config);
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
    console.log(`  ${chalk.dim('Action:')}   Fix or reconfigure hook "${hookName}", then rerun agentxchain step --role ${roleId}`);
  }
  console.log('');
}

function printAcceptedHookFailure(result, config) {
  const recovery = deriveRecoveryDescriptor(result.state, config);
  const hookName = result.hookResults?.results?.find((entry) => entry.hook_name)?.hook_name || '(unknown)';

  console.log('');
  console.log(chalk.yellow('  Turn Accepted, Hook Failure Detected'));
  console.log(chalk.dim('  ' + '-'.repeat(44)));
  console.log('');
  console.log(`  ${chalk.dim('Turn:')}     ${result.accepted?.turn_id || '(unknown)'}`);
  console.log(`  ${chalk.dim('Role:')}     ${result.accepted?.role || '(unknown)'}`);
  console.log(`  ${chalk.dim('Status:')}   ${result.accepted?.status || '(unknown)'}`);
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
}

function printAcceptSummary(result, config) {
  const accepted = result.accepted;
  const recovery = deriveRecoveryDescriptor(result.state, config);
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
  if (accepted?.verification_replay) {
    const verifiedAt = accepted.verification_replay.verified_at
      ? ` at ${accepted.verification_replay.verified_at}`
      : '';
    console.log(`  ${chalk.dim('Replay:')}   ${accepted.verification_replay.overall} (${accepted.verification_replay.matched_commands}/${accepted.verification_replay.replayed_commands})${verifiedAt}`);
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

function printEscalationSummary(result, config) {
  const recovery = deriveRecoveryDescriptor(result.state, config);
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
