/**
 * agentxchain run — drive a governed run to completion.
 *
 * Thin CLI surface over the runLoop library. Wires runLoop callbacks to:
 *   - Existing adapter system (api_proxy, local_cli, mcp, remote_agent)
 *   - Interactive gate prompting (stdin) or auto-approve mode
 *   - Terminal output via chalk
 *
 * Does NOT support manual adapter — use `agentxchain step` for that.
 * Does NOT call assignTurn/acceptTurn/rejectTurn directly — runLoop owns the state machine.
 *
 * See .planning/AGENTXCHAIN_RUN_SPEC.md for the full specification.
 */

import chalk from 'chalk';
import { createInterface } from 'readline';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadProjectContext, loadProjectState } from '../lib/config.js';
import { runLoop } from '../lib/run-loop.js';
import { transitionActiveTurnLifecycle } from '../lib/runner-interface.js';
import { buildRunExport } from '../lib/export.js';
import { buildGovernanceReport, formatGovernanceReportMarkdown } from '../lib/report.js';
import { validateParentRun } from '../lib/run-history.js';
import { dispatchApiProxy } from '../lib/adapters/api-proxy-adapter.js';
import {
  dispatchLocalCli,
  resolveStartupWatchdogMs,
  saveDispatchLogs,
  resolvePromptTransport,
} from '../lib/adapters/local-cli-adapter.js';
import { dispatchMcp, resolveMcpTransport, describeMcpRuntimeTarget } from '../lib/adapters/mcp-adapter.js';
import { dispatchRemoteAgent, describeRemoteAgentTarget } from '../lib/adapters/remote-agent-adapter.js';
import { runHooks } from '../lib/hook-runner.js';
import { finalizeDispatchManifest } from '../lib/dispatch-manifest.js';
import { deriveRecoveryDescriptor } from '../lib/blocked-state.js';
import { summarizeRunProvenance } from '../lib/run-provenance.js';
import { resolveGovernedRole } from '../lib/role-resolution.js';
import { buildInheritedContext } from '../lib/run-context-inheritance.js';
import { shouldSuggestManualQaFallback } from '../lib/manual-qa-fallback.js';
import {
  getDispatchAssignmentPath,
  getDispatchContextPath,
  getDispatchEffectiveContextPath,
  getDispatchPromptPath,
  getDispatchTurnDir,
  getTurnStagingResultPath,
} from '../lib/turn-paths.js';
import { resolveChainOptions, executeChainedRun } from '../lib/run-chain.js';
import { resolveContinuousOptions, executeContinuousRun } from '../lib/continuous-run.js';
import { createDispatchProgressTracker } from '../lib/dispatch-progress.js';
import { emitRunEvent } from '../lib/run-events.js';
import { checkpointAcceptedTurn } from '../lib/turn-checkpoint.js';
import { failTurnStartup } from '../lib/stale-turn-watchdog.js';
import { hasMinimumTurnResultShape } from '../lib/turn-result-shape.js';
import { isKnownTurnRunningProofStream } from '../lib/dispatch-streams.js';

export async function runCommand(opts) {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  // Continuous vision-driven mode
  const contOpts = resolveContinuousOptions(opts, context.config);
  if (contOpts.enabled) {
    if (contOpts.perSessionMaxUsd != null && (!Number.isFinite(contOpts.perSessionMaxUsd) || contOpts.perSessionMaxUsd <= 0)) {
      console.log(chalk.red('--session-budget must be a finite number greater than 0'));
      process.exit(1);
    }
    console.log(chalk.cyan.bold('agentxchain run --continuous'));
    console.log(chalk.dim(`  Vision: ${contOpts.visionPath}`));
    console.log(chalk.dim(`  Max runs: ${contOpts.maxRuns}, Poll: ${contOpts.pollSeconds}s, Idle limit: ${contOpts.maxIdleCycles}`));
    console.log(chalk.dim(`  Triage approval: ${contOpts.triageApproval}`));
    if (contOpts.perSessionMaxUsd != null) {
      console.log(chalk.dim(`  Session budget: $${contOpts.perSessionMaxUsd.toFixed(2)}`));
    }
    console.log('');
    const { exitCode } = await executeContinuousRun(context, contOpts, executeGovernedRun);
    process.exit(exitCode);
  }

  const chainOpts = resolveChainOptions(opts, context.config);
  if (chainOpts.enabled) {
    console.log(chalk.cyan.bold('agentxchain run --chain'));
    const chainParts = [`max ${chainOpts.maxChains} continuations`, `on: ${chainOpts.chainOn.join(',')}`, `cooldown: ${chainOpts.cooldownSeconds}s`];
    if (chainOpts.mission) chainParts.push(`mission: ${chainOpts.mission}`);
    console.log(chalk.dim(`  Chain mode: enabled (${chainParts.join(', ')})`));
    const { exitCode } = await executeChainedRun(context, opts, chainOpts, executeGovernedRun);
    process.exit(exitCode);
  }

  const execution = await executeGovernedRun(context, opts);
  process.exit(execution.exitCode);
}

export async function executeGovernedRun(context, opts = {}) {
  const { root, config } = context;
  const log = opts.log || console.log;

  if (config.protocol_mode !== 'governed') {
    log(chalk.red('The run command is only available for governed projects.'));
    log(chalk.dim('Legacy projects use: agentxchain start'));
    return { exitCode: 1, result: null };
  }

  // ── Provenance flag validation ──────────────────────────────────────────
  const continueFrom = opts.continueFrom;
  const recoverFrom = opts.recoverFrom;

  if (continueFrom && recoverFrom) {
    log(chalk.red('Cannot specify both --continue-from and --recover-from'));
    return { exitCode: 1, result: null };
  }

  let provenance = opts.provenance;
  if (continueFrom || recoverFrom) {
    if (provenance) {
      log(chalk.red('Cannot combine internal provenance overrides with --continue-from or --recover-from'));
      return { exitCode: 1, result: null };
    }
    const parentId = continueFrom || recoverFrom;
    const validation = validateParentRun(root, parentId);
    if (!validation.ok) {
      log(chalk.red(validation.error));
      return { exitCode: 1, result: null };
    }
    provenance = {
      trigger: continueFrom ? 'continuation' : 'recovery',
      parent_run_id: parentId,
      created_by: 'operator',
    };
  }

  // ── Inherit-context validation ─────────────────────────────────────────
  const inheritContext = !!opts.inheritContext;
  let inheritedContext = null;
  if (inheritContext) {
    if (!continueFrom && !recoverFrom) {
      log(chalk.red('--inherit-context requires --continue-from or --recover-from'));
      log(chalk.dim('Usage: agentxchain run --continue-from <run_id> --inherit-context'));
      return { exitCode: 1, result: null };
    }
    const parentId = continueFrom || recoverFrom;
    const inheritance = buildInheritedContext(root, parentId);
    inheritedContext = inheritance.inherited_context;
    if (inheritance.warnings?.length) {
      for (const w of inheritance.warnings) {
        log(chalk.yellow(`  ⚠ Inheritance: ${w}`));
      }
    }
  }

  const maxTurns = opts.maxTurns || 50;
  const autoApprove = !!opts.autoApprove;
  const autoCheckpoint = opts.autoCheckpoint === true;
  const verbose = !!opts.verbose;
  const overrideResolution = opts.role
    ? resolveGovernedRole({ override: opts.role, state: null, config })
    : null;

  if (overrideResolution?.error) {
    log(chalk.red(overrideResolution.error));
    if (overrideResolution.availableRoles.length) {
      log(chalk.dim(`Available roles: ${overrideResolution.availableRoles.join(', ')}`));
    }
    return { exitCode: 1, result: null };
  }

  if (opts.requireFreshStart) {
    const state = loadProjectState(root, config);
    const allowedStatuses = new Set(opts.allowedFreshStatuses || ['idle', 'completed']);
    const currentStatus = state?.status || 'missing';
    if (currentStatus !== 'missing' && !allowedStatuses.has(currentStatus)) {
      return {
        exitCode: 0,
        skipped: true,
        skipReason: `state_${currentStatus}`,
        state,
        result: null,
      };
    }
  }

  // ── Dry run ───────────────────────────────────────────────────────────────
  if (opts.dryRun) {
    const dryRunState = loadProjectState(root, config);
    const roleId = overrideResolution?.roleId || resolveRole(null, dryRunState, config);
    log(chalk.cyan('Dry run — no execution'));
    log(`  First role:   ${roleId || chalk.dim('(unresolved)')}`);
    log(`  Max turns:    ${maxTurns}`);
    log(`  Gate mode:    ${autoApprove ? 'auto-approve' : 'interactive'}`);
    const roleIds = Object.keys(config.roles || {});
    for (const rid of roleIds) {
      const role = config.roles[rid];
      const rtId = role.runtime;
      const rt = config.runtimes?.[rtId];
      const rtType = rt?.type || role.runtime_class || 'manual';
      const supported = rtType !== 'manual';
      log(`  ${supported ? chalk.green('✓') : chalk.red('✗')} ${rid} → ${rtType}${supported ? '' : ' (not supported in run mode)'}`);
    }
    // Warn if the first-dispatched role in the current phase is manual
    if (roleId) {
      const firstRole = config.roles?.[roleId];
      const firstRtId = firstRole?.runtime;
      const firstRt = config.runtimes?.[firstRtId];
      const firstRtType = firstRt?.type || firstRole?.runtime_class || 'manual';
      if (firstRtType === 'manual') {
        log('');
        log(chalk.yellow(`  ⚠ The current phase's first role (${roleId}) is manual.`));
        log(chalk.yellow(`    "run" will block immediately. Complete manual turns via "agentxchain step" first,`));
        log(chalk.yellow(`    or configure ${roleId} with an automatable runtime.`));
      }
    }
    return { exitCode: 0, result: null };
  }

  // ── SIGINT handling ─────────────────────────────────────────────────────
  let aborted = false;
  let sigintCount = 0;
  const controller = new AbortController();
  const onSigint = () => {
    sigintCount++;
    if (sigintCount >= 2) {
      controller.abort();
      process.exit(130);
    }
    aborted = true;
    log(chalk.yellow('\nSIGINT received — finishing current turn, then stopping.'));
  };
  process.on('SIGINT', onSigint);

  try {
    // ── Run header ──────────────────────────────────────────────────────────
    log(chalk.cyan.bold('agentxchain run'));
    log(chalk.dim(`  Max turns: ${maxTurns}  Gate mode: ${autoApprove ? 'auto-approve' : 'interactive'}`));
    if (provenance) {
      const provenanceSummary = summarizeRunProvenance(provenance);
      if (provenanceSummary) {
        log(`  ${chalk.dim('Origin:')}    ${chalk.magenta(provenanceSummary)}`);
      }
    }
    if (inheritedContext) {
      const ic = inheritedContext;
      const phasesCount = ic.parent_phases_completed?.length || 0;
      const decisionsCount = ic.recent_decisions?.length || 0;
      const turnsCount = ic.recent_accepted_turns?.length || 0;
      const parts = [];
      if (phasesCount) parts.push(`${phasesCount} phase${phasesCount !== 1 ? 's' : ''}`);
      if (decisionsCount) parts.push(`${decisionsCount} decision${decisionsCount !== 1 ? 's' : ''}`);
      if (turnsCount) parts.push(`${turnsCount} turn${turnsCount !== 1 ? 's' : ''}`);
      const detail = parts.length ? ` — ${parts.join(', ')}` : '';
      log(`  ${chalk.dim('Inherits:')} ${chalk.magenta(`parent ${ic.parent_run_id} (${ic.parent_status || 'unknown'})${detail}`)}`);
    }
    log('');

    // ── Track first-call for --role override ────────────────────────────────
    let firstSelectRole = true;
    let qaMissingCredentialsFallback = null;
    const acceptedTurnResults = [];

    // ── Callbacks ───────────────────────────────────────────────────────────
    const callbacks = {
    selectRole(state, cfg) {
      if (aborted) return null;

      if (firstSelectRole && opts.role) {
        firstSelectRole = false;
        return overrideResolution.roleId;
      }
      firstSelectRole = false;
      return resolveRole(null, state, cfg);
    },

    async dispatch(ctx) {
      const { turn, state, config: cfg, root: projectRoot } = ctx;
      const roleId = turn.assigned_role;
      const role = cfg.roles?.[roleId];
      const runtimeId = turn.runtime_id;
      const runtime = cfg.runtimes?.[runtimeId];
      const runtimeType = runtime?.type || role?.runtime_class || 'manual';
      const hooksConfig = cfg.hooks || {};
      qaMissingCredentialsFallback = null;

      // Manual adapter is not supported in run mode
      if (runtimeType === 'manual') {
        log(chalk.yellow(`Skipping manual role "${roleId}" — use agentxchain step for manual dispatch.`));
        return { accept: false, reason: 'manual adapter is not supported in run mode — use agentxchain step' };
      }

      // ── after_dispatch hooks ──────────────────────────────────────────
      if (hooksConfig.after_dispatch?.length > 0) {
        const hookResult = runHooks(projectRoot, hooksConfig, 'after_dispatch', {
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

        if (!hookResult.ok) {
          return { accept: false, reason: `after_dispatch hook blocked: ${hookResult.error || 'hook failure'}` };
        }
      }

      // ── Finalize dispatch manifest ────────────────────────────────────
      const manifestResult = finalizeDispatchManifest(projectRoot, turn.turn_id, {
        run_id: state.run_id,
        role: roleId,
      });
      if (!manifestResult.ok) {
        return { accept: false, reason: `dispatch manifest failed: ${manifestResult.error}` };
      }
      transitionActiveTurnLifecycle(projectRoot, turn.turn_id, 'dispatched');

      // ── Route to adapter ──────────────────────────────────────────────
      const tracker = createDispatchProgressTracker(projectRoot, turn, {
        adapter_type: runtimeType,
      });
      let startupStarted = false;
      let runningMarked = false;

      const ensureStartingState = (pid = null, at = new Date().toISOString()) => {
        if (startupStarted) return;
        startupStarted = true;
        transitionActiveTurnLifecycle(projectRoot, turn.turn_id, 'starting', { pid, at });
        tracker.start();
        if (pid != null) {
          tracker.setPid(pid);
        }
        emitRunEvent(projectRoot, 'dispatch_progress', {
          run_id: state.run_id,
          phase: state.phase,
          status: state.status,
          turn: { turn_id: turn.turn_id, assigned_role: roleId },
          payload: { milestone: 'started', output_lines: 0, elapsed_seconds: 0, silent_seconds: 0 },
        });
      };

      const ensureRunningState = (stream = null, at = new Date().toISOString()) => {
        if (stream != null && !isKnownTurnRunningProofStream(stream)) {
          return;
        }
        if (runningMarked) return;
        runningMarked = true;
        transitionActiveTurnLifecycle(projectRoot, turn.turn_id, 'running', { stream, at });
      };

      const adapterOpts = {
        signal: combineAbortSignals(controller.signal, ctx.dispatchAbortSignal),
        onStatus: (msg) => log(chalk.dim(`  ${msg}`)),
        verifyManifest: true,
        turnId: turn.turn_id,
        onSpawnAttached: ({ pid, at }) => ensureStartingState(pid, at),
        onFirstOutput: ({ at, stream }) => ensureRunningState(stream, at),
      };

      const recordOutputActivity = (stream, text) => {
        // DEC-BUG54-STDERR-IS-NOT-STARTUP-PROOF-002 (Turn 88) extended to the
        // run-command lifecycle in Turn 89: stderr activity must NOT promote a
        // turn from `starting` to `running`. stdout (or the adapter's
        // onFirstOutput callback, which is stdout/staged_result only post-Turn
        // 88) is the only signal that satisfies the lifecycle transition.
        // stderr is still tracked by the progress tracker for silence detection
        // and operator diagnostics.
        if (stream != null && isKnownTurnRunningProofStream(stream)) {
          ensureRunningState(stream);
        }
        const lines = text.split('\n').length - 1 || 1;
        const wasSilent = tracker.onOutput(stream, lines);
        if (wasSilent) {
          const progressState = tracker.getState();
          emitRunEvent(projectRoot, 'dispatch_progress', {
            run_id: state.run_id,
            phase: state.phase,
            status: state.status,
            turn: { turn_id: turn.turn_id, assigned_role: roleId },
            payload: {
              milestone: 'output_resumed',
              output_lines: progressState.output_lines,
              elapsed_seconds: Math.round((Date.now() - new Date(progressState.started_at)) / 1000),
              silent_seconds: 0,
            },
          });
        }
      };

      if (verbose) {
        adapterOpts.onStdout = (text) => {
          process.stdout.write(chalk.dim(text));
          recordOutputActivity('stdout', text);
        };
        adapterOpts.onStderr = (text) => {
          process.stderr.write(chalk.yellow(text));
          recordOutputActivity('stderr', text);
        };
      } else {
        // Even in non-verbose mode, track output activity for progress visibility
        adapterOpts.onStdout = (text) => {
          recordOutputActivity('stdout', text);
        };
        adapterOpts.onStderr = (text) => {
          recordOutputActivity('stderr', text);
        };
      }

      let adapterResult;

      try {
        if (runtimeType === 'api_proxy') {
          ensureStartingState(null);
          ensureRunningState('request');
          log(chalk.dim(`  Dispatching to API proxy: ${runtime?.provider || '?'} / ${runtime?.model || '?'}`));
          tracker.requestStarted();
          adapterResult = await dispatchApiProxy(projectRoot, state, cfg, adapterOpts);
          if (adapterResult.ok) tracker.responseReceived();
        } else if (runtimeType === 'mcp') {
          ensureStartingState(null);
          ensureRunningState('request');
          const transport = resolveMcpTransport(runtime);
          log(chalk.dim(`  Dispatching to MCP ${transport}: ${describeMcpRuntimeTarget(runtime)}`));
          tracker.requestStarted();
          adapterResult = await dispatchMcp(projectRoot, state, cfg, adapterOpts);
          if (adapterResult.ok) tracker.responseReceived();
        } else if (runtimeType === 'local_cli') {
          const transport = runtime ? resolvePromptTransport(runtime) : 'dispatch_bundle_only';
          log(chalk.dim(`  Dispatching to local CLI: ${runtime?.command || '(default)'}  transport: ${transport}`));
          adapterResult = await dispatchLocalCli(projectRoot, state, cfg, adapterOpts);
        } else if (runtimeType === 'remote_agent') {
          ensureStartingState(null);
          ensureRunningState('request');
          log(chalk.dim(`  Dispatching to remote agent: ${describeRemoteAgentTarget(runtime)}`));
          tracker.requestStarted();
          adapterResult = await dispatchRemoteAgent(projectRoot, state, cfg, adapterOpts);
          if (adapterResult.ok) tracker.responseReceived();
        } else {
          tracker.fail();
          return { accept: false, reason: `unknown runtime type "${runtimeType}"` };
        }
      } catch (err) {
        tracker.fail();
        emitRunEvent(projectRoot, 'dispatch_progress', {
          run_id: state.run_id, phase: state.phase, status: state.status,
          turn: { turn_id: turn.turn_id, assigned_role: roleId },
          payload: { milestone: 'failed', output_lines: tracker.getState().output_lines, elapsed_seconds: Math.round((Date.now() - new Date(tracker.getState().started_at)) / 1000), silent_seconds: 0 },
        });
        throw err;
      }

      if (adapterResult.ok && runtimeType === 'local_cli' && !runningMarked) {
        ensureRunningState('staged_result', adapterResult.firstOutputAt || new Date().toISOString());
      }

      // Emit completion/failure progress event and clean up tracker
      const progressState = tracker.getState();
      const elapsedSec = Math.round((Date.now() - new Date(progressState.started_at)) / 1000);
      const milestone = adapterResult.ok ? 'completed' : (adapterResult.timedOut ? 'timed_out' : 'failed');
      if (adapterResult.ok) { tracker.complete(); } else { tracker.fail(); }
      emitRunEvent(projectRoot, 'dispatch_progress', {
        run_id: state.run_id, phase: state.phase, status: state.status,
        turn: { turn_id: turn.turn_id, assigned_role: roleId },
        payload: { milestone, output_lines: progressState.output_lines, elapsed_seconds: elapsedSec, silent_seconds: progressState.silent_since ? Math.round((Date.now() - new Date(progressState.silent_since)) / 1000) : 0 },
      });

      // Save adapter logs
      if (adapterResult.logs?.length) {
        saveDispatchLogs(projectRoot, turn.turn_id, adapterResult.logs);
      }

      // Aborted
      if (adapterResult.aborted) {
        return { accept: false, reason: 'dispatch aborted by operator' };
      }

      // Timed out
      if (adapterResult.timedOut) {
        return { accept: false, reason: 'dispatch timed out' };
      }

      if (adapterResult.startupFailure) {
        const freshState = loadProjectState(projectRoot, cfg) || state;
        const startupThresholdMs = resolveStartupWatchdogMs(cfg, runtime);
        failTurnStartup(projectRoot, freshState, cfg, turn.turn_id, {
          failure_type: adapterResult.startupFailureType || 'no_subprocess_output',
          threshold_ms: startupThresholdMs,
          running_ms: freshState?.active_turns?.[turn.turn_id]?.started_at
            ? Math.max(0, Date.now() - new Date(freshState.active_turns[turn.turn_id].started_at).getTime())
            : 0,
          recommendation: `Turn ${turn.turn_id} failed to start within the startup watchdog window. Run \`agentxchain reissue-turn --turn ${turn.turn_id} --reason ghost\` to recover.`,
        });
        return { accept: false, blocked: true, reason: adapterResult.error || 'turn startup failed' };
      }

      // Adapter failure
      if (!adapterResult.ok) {
        if (shouldSuggestManualQaFallback({
          roleId,
          runtimeId,
          classified: adapterResult.classified,
          config: cfg,
        })) {
          qaMissingCredentialsFallback = {
            roleId,
            runtimeId,
            errorClass: adapterResult.classified.error_class,
          };
        }
        const errorDetail = adapterResult.classified
          ? `${adapterResult.classified.error_class}: ${adapterResult.classified.recovery}`
          : adapterResult.error;
        return { accept: false, reason: errorDetail || 'adapter dispatch failed' };
      }

      // ── Read staged result ────────────────────────────────────────────
      const stagingFile = join(projectRoot, getTurnStagingResultPath(turn.turn_id));
      if (!existsSync(stagingFile)) {
        return { accept: false, reason: 'adapter completed but no staged result found' };
      }

      let turnResult;
      try {
        turnResult = JSON.parse(readFileSync(stagingFile, 'utf8'));
      } catch (err) {
        return { accept: false, reason: `failed to parse staged result: ${err.message}` };
      }

      // Per DEC-MINIMUM-TURN-RESULT-SHAPE-001: the staged-result read shortcut
      // must refuse payloads that lack the minimum governed envelope. Adapter
      // pre-stage guards already reject these, but this is the final boundary
      // before acceptance projection — fail closed on tampered or legacy
      // adapter output rather than trust upstream.
      if (!hasMinimumTurnResultShape(turnResult)) {
        return {
          accept: false,
          reason: 'staged result missing minimum governed envelope (schema_version + identity + lifecycle fields)',
        };
      }

      return { accept: true, turnResult };
    },

    async approveGate(gateType, state) {
      if (autoApprove) {
        log(chalk.yellow(`  Auto-approved ${gateType} gate`));
        return true;
      }

      // Non-TTY → fail-closed
      if (!process.stdin.isTTY) {
        log(chalk.yellow(`  Gate pause: ${gateType} — stdin is not a TTY, failing closed.`));
        log(chalk.dim('  Use --auto-approve for non-interactive mode.'));
        return false;
      }

      const target = gateType === 'phase_transition'
        ? state.pending_phase_transition?.target || '(next phase)'
        : 'run completion';

      log('');
      log(chalk.yellow.bold(`Gate pause: ${gateType}`));
      log(chalk.dim(`  Phase: ${state.phase} → ${target}`));

      const answer = await promptUser(`  Approve? [y/N] `);
      const approved = /^y(es)?$/i.test(answer.trim());
      return approved;
    },

    async afterAccept({ turn, acceptResult }) {
      if (acceptResult) {
        acceptedTurnResults.push({
          turn_id: turn.turn_id,
          accepted: acceptResult.accepted || null,
          turn_result: acceptResult.validation?.turnResult || null,
          state: acceptResult.state || null,
        });
      }
      if (!autoCheckpoint) {
        return { ok: true };
      }
      const checkpoint = checkpointAcceptedTurn(root, { turnId: turn.turn_id });
      if (!checkpoint.ok) {
        return { ok: false, error: checkpoint.error || `checkpoint failed for ${turn.turn_id}` };
      }
      return { ok: true };
    },

    onEvent(event) {
      switch (event.type) {
        case 'turn_assigned':
          log(chalk.cyan(`Turn assigned: ${event.turn?.turn_id} → ${event.role}`));
          break;
        case 'turn_accepted':
          log(chalk.green(`Turn accepted: ${event.turn?.turn_id}`));
          break;
        case 'turn_rejected':
          log(chalk.yellow(`Turn rejected: ${event.turn?.turn_id} — ${event.reason || 'no reason'}`));
          break;
        case 'gate_paused':
          log(chalk.yellow(`Gate paused: ${event.gateType}`));
          break;
        case 'gate_approved':
          log(chalk.green(`Gate approved: ${event.gateType}`));
          break;
        case 'gate_held':
          log(chalk.yellow(`Gate held: ${event.gateType} — run paused`));
          break;
        case 'blocked':
          log(chalk.red(`Run blocked`));
          break;
        case 'completed':
          log(chalk.green.bold('Run completed'));
          break;
        case 'caller_stopped':
          log(chalk.yellow('Run stopped by caller'));
          break;
      }
    },
    };

    // ── Execute ─────────────────────────────────────────────────────────────
    const runLoopOpts = {
      maxTurns,
      startNewRunFromCompleted: true,
      startNewRunFromBlocked: opts.allowBlockedRestart ?? Boolean(provenance),
    };
    if (provenance) runLoopOpts.provenance = provenance;
    if (inheritedContext) runLoopOpts.inheritedContext = inheritedContext;
    const result = await runLoop(root, config, callbacks, runLoopOpts);

    // ── Summary ─────────────────────────────────────────────────────────────
    log('');
    log(chalk.dim('─── Run Summary ───'));
    log(`  Status:  ${result.ok ? chalk.green('completed') : chalk.yellow(result.stop_reason)}`);
    log(`  Turns:   ${result.turns_executed}`);
    log(`  Gates:   ${result.gates_approved} approved`);
    log(`  Errors:  ${result.errors.length ? chalk.red(result.errors.length) : 'none'}`);

    if (result.errors.length) {
      for (const err of result.errors) {
        log(chalk.red(`    ${err}`));
      }
    }

    if (qaMissingCredentialsFallback) {
      printManualQaFallback(log);
    }

    // Recovery guidance for blocked/rejected states
    if (result.state && (result.stop_reason === 'blocked' || result.stop_reason === 'reject_exhausted' || result.stop_reason === 'dispatch_error')) {
      const recovery = deriveRecoveryDescriptor(result.state, config);
      if (recovery) {
        log('');
        log(chalk.yellow(`  Recovery: ${recovery.typed_reason}`));
        log(chalk.dim(`  Action:   ${recovery.recovery_action}`));
        if (recovery.detail) {
          log(chalk.dim(`  Detail:   ${recovery.detail}`));
        }
      }
    }

    // ── Auto governance report ──────────────────────────────────────────────
    if (opts.report !== false && result.state) {
      try {
        const reportsDir = join(root, '.agentxchain', 'reports');
        mkdirSync(reportsDir, { recursive: true });

        const exportResult = buildRunExport(root, { maxJsonlEntries: 1000, maxBase64Bytes: 1024 * 1024 });
        if (exportResult.ok) {
          const runId = result.state.run_id || 'unknown';
          const exportPath = join(reportsDir, `export-${runId}.json`);

          // Write export JSON — compact format to avoid string-length overflow (BUG-84)
          try {
            writeFileSync(exportPath, JSON.stringify(exportResult.export));
          } catch (exportWriteErr) {
            log(chalk.dim(`  Governance export write failed: ${exportWriteErr.message}`));
          }

          // Generate markdown report separately so export-write failure doesn't block it
          try {
            const reportResult = buildGovernanceReport(exportResult.export, { input: exportPath });
            const reportPath = join(reportsDir, `report-${runId}.md`);
            writeFileSync(reportPath, formatGovernanceReportMarkdown(reportResult.report));

            log('');
            log(chalk.dim(`  Governance report: .agentxchain/reports/report-${runId}.md`));
          } catch (reportErr) {
            log(chalk.dim(`  Governance report failed: ${reportErr.message}`));
          }
        } else {
          log(chalk.dim(`  Governance report skipped: ${exportResult.error}`));
        }
      } catch (err) {
        log(chalk.dim(`  Governance report failed: ${err.message}`));
      }
    }

    // ── Exit code ───────────────────────────────────────────────────────────
    const successReasons = new Set(['completed', 'gate_held', 'caller_stopped', 'max_turns_reached']);
    return {
      exitCode: result.ok || successReasons.has(result.stop_reason) ? 0 : 1,
      result: {
        ...result,
        accepted_turn_results: acceptedTurnResults,
      },
      skipped: false,
      skipReason: null,
      provenance: provenance || null,
    };
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Resolve the target role for the next turn.
 * Same routing contract as step.js resolveTargetRole, minus interactive logging.
 */
function resolveRole(override, state, config) {
  const resolved = resolveGovernedRole({ override, state, config });
  return resolved.error ? null : resolved.roleId;
}

/**
 * Prompt the user via stdin readline.
 */
function promptUser(question) {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
    rl.on('close', () => resolve(''));
  });
}

function printManualQaFallback(log = console.log) {
  log('');
  log(chalk.dim('  No-key QA fallback:'));
  log(chalk.dim('  - Edit agentxchain.json and change roles.qa.runtime from "api-qa" to "manual-qa"'));
  log(chalk.dim('  - Then recover the retained QA turn with: agentxchain step --resume'));
  log(chalk.dim('  - Guide: https://agentxchain.dev/docs/getting-started'));
}

function combineAbortSignals(primarySignal, secondarySignal) {
  if (!secondarySignal) {
    return primarySignal;
  }
  if (!primarySignal) {
    return secondarySignal;
  }
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([primarySignal, secondarySignal]);
  }

  const combined = new AbortController();
  const forward = (signal) => {
    if (!signal) return;
    if (signal.aborted) {
      combined.abort(signal.reason);
      return;
    }
    signal.addEventListener('abort', () => combined.abort(signal.reason), { once: true });
  };
  forward(primarySignal);
  forward(secondarySignal);
  return combined.signal;
}
