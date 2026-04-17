/**
 * Run Chain — auto-chaining governed runs for lights-out operation.
 *
 * When a governed run completes (or reaches another chainable terminal status),
 * this module automatically starts a new run that inherits context from the
 * previous one. Removes the manual `--continue-from` step and enables
 * continuous governed delivery.
 *
 * Spec: .planning/RUN_CHAIN_SPEC.md
 */

import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { recordRunHistory, validateParentRun } from './run-history.js';
import { loadMissionArtifact, loadLatestMissionArtifact, attachChainToMission } from './missions.js';

const DEFAULT_MAX_CHAINS = 5;
const DEFAULT_CHAIN_ON = ['completed'];
const DEFAULT_COOLDOWN_SECONDS = 5;

/**
 * Resolve chain options from CLI flags and config, with CLI flags taking precedence.
 *
 * @param {object} opts - CLI options
 * @param {object} config - agentxchain.json config
 * @returns {{ enabled: boolean, maxChains: number, chainOn: string[], cooldownSeconds: number, mission: string|null, chainId?: string|null }}
 */
export function resolveChainOptions(opts, config) {
  const configChain = config?.run_loop?.chain || {};

  const enabled = opts.chain ?? configChain.enabled ?? false;
  const maxChains = opts.maxChains ?? configChain.max_chains ?? DEFAULT_MAX_CHAINS;
  const cooldownSeconds = opts.chainCooldown ?? configChain.cooldown_seconds ?? DEFAULT_COOLDOWN_SECONDS;

  let chainOn;
  if (opts.chainOn) {
    chainOn = typeof opts.chainOn === 'string'
      ? opts.chainOn.split(',').map(s => s.trim()).filter(Boolean)
      : opts.chainOn;
  } else if (Array.isArray(configChain.chain_on)) {
    chainOn = configChain.chain_on;
  } else {
    chainOn = DEFAULT_CHAIN_ON;
  }

  const mission = opts.mission ?? configChain.mission ?? null;

  const chainId = opts.chainId ?? null;

  return { enabled, maxChains, chainOn, cooldownSeconds, mission, chainId };
}

/**
 * Execute a chained sequence of governed runs.
 *
 * @param {object} context - { root, config }
 * @param {object} opts - CLI options (passed to executeGovernedRun)
 * @param {object} chainOpts - resolved chain options
 * @param {Function} executeGovernedRun - the run executor function
 * @param {Function} [log] - logging function
 * @returns {Promise<{ exitCode: number, chainReport: object }>}
 */
export async function executeChainedRun(context, opts, chainOpts, executeGovernedRun, log = console.log) {
  const chainId = chainOpts.chainId || `chain-${randomUUID().slice(0, 8)}`;
  const chainOnSet = new Set(chainOpts.chainOn);
  const maxRuns = chainOpts.maxChains + 1; // initial + continuations
  const startedAt = new Date().toISOString();

  // ── Mission binding validation ─────────────────────────────────────────
  let missionTarget = null;
  if (chainOpts.mission) {
    const missionId = chainOpts.mission;
    if (missionId === 'latest') {
      missionTarget = loadLatestMissionArtifact(context.root);
      if (!missionTarget) {
        log(`  ⚠ --mission latest: no missions found. Chain will not be attached.`);
      }
    } else {
      missionTarget = loadMissionArtifact(context.root, missionId);
      if (!missionTarget) {
        log(`  Mission not found: ${missionId}. Aborting chain.`);
        return { exitCode: 1, chainReport: null };
      }
    }
    if (missionTarget) {
      log(`  Mission: ${missionTarget.mission_id} — "${missionTarget.title}"`);
    }
  }

  const chainReport = {
    chain_id: chainId,
    started_at: startedAt,
    runs: [],
    total_turns: 0,
    total_duration_ms: 0,
    terminal_reason: null,
  };

  let previousRunId = null;
  let lastExitCode = 0;
  let aborted = false;

  // Capture SIGINT to prevent chaining after current run
  const onSigint = () => { aborted = true; };
  process.on('SIGINT', onSigint);

  try {
    for (let i = 0; i < maxRuns; i++) {
      const runNumber = i + 1;
      log('');
      log(`  \u2500\u2500 Chain run ${runNumber}/${maxRuns} ${'─'.repeat(50)}`);

      // Build continuation options for runs after the first
      const runOpts = { ...opts };
      if (previousRunId) {
        runOpts.continueFrom = previousRunId;
        runOpts.inheritContext = true;
      }

      const runStart = Date.now();
      const execution = await executeGovernedRun(context, runOpts);
      const runDuration = Date.now() - runStart;

      const runId = execution.result?.state?.run_id || `unknown-${i}`;
      const stopReason = execution.result?.stop_reason || (execution.result?.ok ? 'completed' : 'unknown');
      const turnsExecuted = execution.result?.turns_executed || 0;

      chainReport.runs.push(buildRunReportEntry(execution, runDuration, {
        fallbackRunId: runId,
        fallbackStatus: stopReason,
        fallbackTurns: turnsExecuted,
      }));
      chainReport.total_turns += turnsExecuted;
      chainReport.total_duration_ms += runDuration;

      lastExitCode = execution.exitCode;
      previousRunId = runId;

      // Check abort
      if (aborted) {
        chainReport.terminal_reason = 'operator_abort';
        break;
      }

      // Check if this is the last possible run
      if (i === maxRuns - 1) {
        chainReport.terminal_reason = 'chain_limit_reached';
        break;
      }

      // Check if terminal status is chainable
      if (!chainOnSet.has(stopReason)) {
        chainReport.terminal_reason = 'non_chainable_status';
        break;
      }

      // Validate parent run exists for continuation
      let validation = validateParentRun(context.root, runId);
      if (!validation.ok && execution.result?.state && (stopReason === 'completed' || stopReason === 'blocked')) {
        const repair = recordRunHistory(context.root, execution.result.state, context.config, stopReason);
        if (repair.ok) {
          validation = validateParentRun(context.root, runId);
        }
      }
      if (!validation.ok) {
        log(`  Chain: cannot continue — ${validation.error}`);
        chainReport.terminal_reason = 'parent_validation_failed';
        break;
      }

      // Cooldown
      const continuationsRemaining = Math.max(0, maxRuns - (runNumber + 1));
      log('');
      log(`  Chain: run ${stopReason} \u2192 starting continuation (${continuationsRemaining} remaining)...`);
      if (chainOpts.cooldownSeconds > 0) {
        log(`  Waiting ${chainOpts.cooldownSeconds}s...`);
        await sleep(chainOpts.cooldownSeconds * 1000);
      }

      // Check abort again after cooldown
      if (aborted) {
        chainReport.terminal_reason = 'operator_abort';
        break;
      }
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
  }

  // If terminal_reason not set, derive from last run
  if (!chainReport.terminal_reason) {
    const lastRun = chainReport.runs[chainReport.runs.length - 1];
    chainReport.terminal_reason = lastRun?.status || 'unknown';
  }

  chainReport.completed_at = new Date().toISOString();

  // Write chain report
  writeChainReport(context.root, chainReport);

  // Auto-attach to mission if binding is active
  if (missionTarget) {
    const attachResult = attachChainToMission(context.root, missionTarget.mission_id, chainReport.chain_id);
    if (attachResult.ok) {
      log(`  Chain attached to mission: ${missionTarget.mission_id}`);
    } else {
      log(`  ⚠ Mission attachment failed: ${attachResult.error}`);
    }
  }

  // Print chain summary
  printChainSummary(chainReport, log);

  return { exitCode: lastExitCode, chainReport };
}

/**
 * Write chain report to .agentxchain/reports/.
 */
function writeChainReport(root, report) {
  try {
    const reportsDir = join(root, '.agentxchain', 'reports');
    mkdirSync(reportsDir, { recursive: true });
    const reportPath = join(reportsDir, `${report.chain_id}.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
  } catch {
    // Non-fatal — chain report is advisory
  }
}

/**
 * Print chain summary to terminal.
 */
function printChainSummary(report, log) {
  log('');
  log('  \u2500\u2500\u2500 Chain Summary \u2500\u2500\u2500');
  log(`  Total runs:   ${report.runs.length}`);
  log(`  Total turns:  ${report.total_turns}`);
  log(`  Duration:     ${formatDuration(report.total_duration_ms)}`);
  log(`  Terminal:     ${report.terminal_reason}`);
}

/**
 * Format milliseconds to a human-readable duration.
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildRunReportEntry(execution, runDuration, fallback = {}) {
  const state = execution?.result?.state || null;
  const provenance = state?.provenance || null;

  return {
    run_id: state?.run_id || fallback.fallbackRunId || 'unknown',
    status: execution?.result?.stop_reason || fallback.fallbackStatus || 'unknown',
    turns: execution?.result?.turns_executed || fallback.fallbackTurns || 0,
    duration_ms: runDuration,
    provenance_trigger: provenance?.trigger || null,
    parent_run_id: provenance?.parent_run_id || null,
    inherited_context_summary: summarizeInheritedContext(state?.inherited_context || null),
  };
}

function summarizeInheritedContext(inheritedContext) {
  if (!inheritedContext) return null;

  return {
    parent_run_id: inheritedContext.parent_run_id || null,
    parent_status: inheritedContext.parent_status || null,
    inherited_at: inheritedContext.inherited_at || null,
    parent_roles_used: Array.isArray(inheritedContext.parent_roles_used)
      ? inheritedContext.parent_roles_used
      : [],
    parent_phases_completed_count: Array.isArray(inheritedContext.parent_phases_completed)
      ? inheritedContext.parent_phases_completed.length
      : 0,
    recent_decisions_count: Array.isArray(inheritedContext.recent_decisions)
      ? inheritedContext.recent_decisions.length
      : 0,
    recent_accepted_turns_count: Array.isArray(inheritedContext.recent_accepted_turns)
      ? inheritedContext.recent_accepted_turns.length
      : 0,
  };
}
