import chalk from 'chalk';
import { loadProjectContext } from '../lib/config.js';
import {
  SCHEDULE_STATE_PATH,
  DAEMON_STATE_PATH,
  listSchedules,
  updateScheduleState,
  evaluateScheduleLaunchEligibility,
  findContinuableScheduleRun,
  readDaemonState,
  writeDaemonState,
  updateDaemonHeartbeat,
  createDaemonState,
  evaluateDaemonStatus,
} from '../lib/run-schedule.js';
import { consumePreemptionMarker } from '../lib/intake.js';
import { executeGovernedRun } from './run.js';
import {
  readContinuousSession,
  writeContinuousSession,
  advanceContinuousRunOnce,
  resolveContinuousOptions,
} from '../lib/continuous-run.js';
import { resolveVisionPath } from '../lib/vision-reader.js';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

function loadScheduleContext() {
  const context = loadProjectContext();
  if (!context) {
    console.error(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exitCode = 1;
    return null;
  }
  if (context.config.protocol_mode !== 'governed') {
    console.error(chalk.red('The schedule command is only available for governed projects.'));
    process.exitCode = 1;
    return null;
  }
  return context;
}

function resolveScheduleEntries(context, scheduleId, at) {
  const entries = listSchedules(context.root, context.config, { at });
  if (!scheduleId) {
    return { ok: true, entries };
  }

  const matched = entries.find((entry) => entry.id === scheduleId);
  if (!matched) {
    return { ok: false, error: `Unknown schedule: ${scheduleId}` };
  }

  return { ok: true, entries: [matched] };
}

function printScheduleTable(entries) {
  if (entries.length === 0) {
    console.log(chalk.dim('No schedules configured.'));
    return;
  }

  const header = [
    pad('Schedule', 24),
    pad('Enabled', 8),
    pad('Every', 8),
    pad('Due', 6),
    pad('Next Due', 24),
    pad('Last Status', 18),
    pad('Last Run', 14),
  ].join(' ');
  console.log(chalk.bold(header));
  console.log(chalk.dim('─'.repeat(header.length)));

  for (const entry of entries) {
    console.log([
      pad(entry.id, 24),
      pad(entry.enabled ? 'yes' : 'no', 8),
      pad(`${entry.every_minutes}m`, 8),
      pad(entry.due ? 'yes' : 'no', 6),
      pad(entry.next_due_at || '—', 24),
      pad(entry.last_status || entry.last_skip_reason || '—', 18),
      pad((entry.last_run_id || '—').slice(0, 12), 14),
    ].join(' '));
  }
}

function pad(value, width) {
  return String(value || '').padEnd(width);
}

function buildScheduleProvenance(entry) {
  return {
    trigger: 'schedule',
    created_by: 'operator',
    trigger_reason: entry.trigger_reason || `schedule:${entry.id}`,
  };
}

function buildScheduleExecutionResult(entryId, execution, fallbackState, action = 'ran') {
  const state = execution.result?.state || fallbackState || null;
  return {
    id: entryId,
    action,
    run_id: state?.run_id || null,
    stop_reason: execution.result?.stop_reason || null,
    exit_code: execution.exitCode,
  };
}

function recordScheduleExecution(context, entryId, execution, fallbackState, nowIso, action = 'ran') {
  const state = execution.result?.state || fallbackState || null;
  const runId = state?.run_id || null;
  const startedAt = state?.created_at || nowIso;

  updateScheduleState(context.root, context.config, entryId, (record) => ({
    ...record,
    last_started_at: startedAt,
    last_finished_at: new Date().toISOString(),
    last_run_id: runId,
    last_status: execution.result?.stop_reason || (execution.exitCode === 0 ? 'completed' : 'launch_failed'),
    last_skip_at: null,
    last_skip_reason: null,
  }));

  return buildScheduleExecutionResult(entryId, execution, fallbackState, action);
}

function consumeScheduledPriorityPreemption(context, scheduleId, schedule, execution, fallbackState, at) {
  const scheduleResult = recordScheduleExecution(
    context,
    scheduleId,
    execution,
    fallbackState,
    at || new Date().toISOString(),
    'preempted',
  );
  const consumed = consumePreemptionMarker(context.root, {
    role: schedule.initial_role || undefined,
  });

  if (!consumed.ok) {
    return {
      ok: false,
      exitCode: 1,
      result: {
        ...scheduleResult,
        action: 'preemption_failed',
        error: consumed.error,
        injected_intent_id: execution.result?.preempted_by || null,
      },
    };
  }

  return {
    ok: true,
    exitCode: 0,
    result: {
      ...scheduleResult,
      action: 'preempted',
      injected_intent_id: consumed.intent_id,
      injected_turn_id: consumed.turn_id,
      injected_role: consumed.role,
    },
  };
}

async function continueActiveScheduledRun(context, opts = {}) {
  const continuation = findContinuableScheduleRun(context.root, context.config, {
    scheduleId: opts.schedule || null,
  });
  if (!continuation.ok) {
    return { matched: false, reason: continuation.reason };
  }

  const { schedule_id: scheduleId, schedule, state } = continuation;

  if (!opts.json) {
    console.log(chalk.cyan(`Continuing active scheduled run: ${scheduleId}`));
  }

  const execution = await executeGovernedRun(context, {
    maxTurns: schedule.max_turns,
    autoApprove: schedule.auto_approve !== false,
    report: true,
    log: opts.json ? () => {} : console.log,
  });

  if (execution.result?.stop_reason === 'priority_preempted') {
    const promoted = consumeScheduledPriorityPreemption(context, scheduleId, schedule, execution, state, opts.at);
    return {
      matched: true,
      ok: promoted.ok,
      exitCode: promoted.exitCode,
      result: promoted.result,
    };
  }

  const blocked = execution.result?.stop_reason === 'blocked';
  const action = blocked && opts.tolerateBlockedRun ? 'blocked' : 'continued';
  const result = recordScheduleExecution(context, scheduleId, execution, state, opts.at || new Date().toISOString(), action);

  if (execution.exitCode !== 0 && !(opts.tolerateBlockedRun && blocked)) {
    return {
      matched: true,
      ok: false,
      exitCode: execution.exitCode,
      result,
    };
  }

  return {
    matched: true,
    ok: true,
    exitCode: 0,
    result,
  };
}

async function runDueSchedules(context, opts = {}) {
  if (opts.continueActiveScheduleRuns) {
    const continuation = await continueActiveScheduledRun(context, opts);
    if (continuation.matched) {
      return continuation.ok
        ? { ok: true, exitCode: continuation.exitCode, results: [continuation.result] }
        : { ok: false, exitCode: continuation.exitCode, results: [continuation.result], error: 'Scheduled run failed' };
    }
  }

  const resolved = resolveScheduleEntries(context, opts.schedule, opts.at);
  if (!resolved.ok) {
    return { ok: false, exitCode: 1, error: resolved.error, results: [] };
  }

  const nowIso = opts.at || new Date().toISOString();
  const results = [];
  const excludedSchedules = new Set(opts.excludeSchedules || []);

  for (const entry of resolved.entries) {
    // Skip entries handled by the continuous session manager.
    if ((opts.excludeSchedule && entry.id === opts.excludeSchedule)
      || excludedSchedules.has(entry.id)) {
      continue;
    }
    if (!entry.enabled) {
      results.push({ id: entry.id, action: 'disabled' });
      continue;
    }
    if (!entry.due) {
      results.push({ id: entry.id, action: 'not_due', next_due_at: entry.next_due_at });
      continue;
    }

    const eligibility = evaluateScheduleLaunchEligibility(context.root, context.config);
    if (!eligibility.ok) {
      updateScheduleState(context.root, context.config, entry.id, (record) => ({
        ...record,
        last_skip_at: nowIso,
        last_skip_reason: eligibility.reason,
      }));
      results.push({
        id: entry.id,
        action: 'skipped',
        reason: eligibility.reason,
        project_status: eligibility.status,
      });
      continue;
    }

    if (!opts.json) {
      console.log(chalk.cyan(`Schedule due: ${entry.id}`));
    }
    const execution = await executeGovernedRun(context, {
      provenance: buildScheduleProvenance(entry),
      maxTurns: entry.max_turns,
      autoApprove: entry.auto_approve,
      role: entry.initial_role || undefined,
      report: true,
      allowBlockedRestart: false,
      requireFreshStart: true,
      allowedFreshStatuses: ['idle', 'completed'],
      log: opts.json ? () => {} : console.log,
    });

    if (execution.skipped) {
      updateScheduleState(context.root, context.config, entry.id, (record) => ({
        ...record,
        last_skip_at: nowIso,
        last_skip_reason: execution.skipReason,
      }));
      results.push({
        id: entry.id,
        action: 'skipped',
        reason: execution.skipReason,
      });
      continue;
    }

    if (execution.result?.stop_reason === 'priority_preempted') {
      const promoted = consumeScheduledPriorityPreemption(context, entry.id, entry, execution, execution.result?.state || null, nowIso);
      results.push(promoted.result);
      if (!promoted.ok) {
        return { ok: false, exitCode: promoted.exitCode, results };
      }
      continue;
    }

    const blocked = execution.result?.stop_reason === 'blocked';
    results.push(recordScheduleExecution(
      context,
      entry.id,
      execution,
      execution.result?.state || null,
      nowIso,
      blocked && opts.tolerateBlockedRun ? 'blocked' : 'ran',
    ));

    if (execution.exitCode !== 0) {
      if (opts.tolerateBlockedRun && blocked) {
        continue;
      }
      return { ok: false, exitCode: execution.exitCode, results };
    }
  }

  return { ok: true, exitCode: 0, results };
}

// ---------------------------------------------------------------------------
// Schedule-owned continuous session management
// ---------------------------------------------------------------------------

function isSessionTerminal(session) {
  return ['completed', 'idle_exit', 'failed', 'stopped'].includes(session?.status);
}

function getContinuousEnabledScheduleIds(config) {
  return Object.entries(config?.schedules || {})
    .filter(([, schedule]) => schedule?.continuous?.enabled === true)
    .map(([id]) => id);
}

export function selectContinuousScheduleEntry(root, config, opts = {}) {
  const entries = listSchedules(root, config, { at: opts.at });
  const continuousEntries = entries.filter((entry) => config?.schedules?.[entry.id]?.continuous?.enabled === true);

  if (continuousEntries.length === 0) {
    return null;
  }

  if (opts.scheduleId) {
    const selected = continuousEntries.find((entry) => entry.id === opts.scheduleId);
    return selected
      ? { id: selected.id, schedule: config.schedules[selected.id], due: selected.due }
      : null;
  }

  const activeSession = readContinuousSession(root);
  if (activeSession && !isSessionTerminal(activeSession) && activeSession.owner_type === 'schedule') {
    const ownerEntry = continuousEntries.find((entry) => entry.id === activeSession.owner_id);
    if (!ownerEntry) {
      return {
        id: activeSession.owner_id,
        error: `active continuous session owned by unknown schedule "${activeSession.owner_id}"`,
      };
    }
    return { id: ownerEntry.id, schedule: config.schedules[ownerEntry.id], due: ownerEntry.due };
  }

  const dueEntry = continuousEntries.find((entry) => entry.due);
  if (!dueEntry) {
    return null;
  }

  return { id: dueEntry.id, schedule: config.schedules[dueEntry.id], due: dueEntry.due };
}

function createScheduleOwnedSession(schedule, scheduleId) {
  return {
    session_id: `cont-${randomUUID().slice(0, 8)}`,
    started_at: new Date().toISOString(),
    vision_path: schedule.continuous.vision_path,
    runs_completed: 0,
    max_runs: schedule.continuous.max_runs,
    idle_cycles: 0,
    max_idle_cycles: schedule.continuous.max_idle_cycles,
    current_run_id: null,
    current_vision_objective: null,
    status: 'running',
    owner_type: 'schedule',
    owner_id: scheduleId,
    per_session_max_usd: schedule.continuous.per_session_max_usd || null,
    cumulative_spent_usd: 0,
    budget_exhausted: false,
  };
}

async function advanceScheduleContinuousSession(context, entry, opts = {}) {
  const { root, config } = context;
  const scheduleId = entry.id;
  const schedule = entry.schedule;
  const contConfig = schedule.continuous;
  const log = opts.json ? () => {} : console.log;

  // Read existing session
  let session = readContinuousSession(root);

  // If there's an active session owned by a different schedule, fail closed
  if (session && !isSessionTerminal(session) && session.owner_type === 'schedule' && session.owner_id !== scheduleId) {
    return {
      ok: false,
      action: 'skipped',
      reason: `continuous session owned by schedule "${session.owner_id}"`,
    };
  }

  // Determine if we need a new session
  const needsNewSession = !session || isSessionTerminal(session) || session.owner_id !== scheduleId;

  if (needsNewSession) {
    // Only start a new session if the schedule is due
    if (!opts.isDue) {
      return { ok: true, action: 'not_due', reason: 'waiting_interval' };
    }

    // Check launch eligibility
    const eligibility = evaluateScheduleLaunchEligibility(root, config);
    if (!eligibility.ok) {
      return { ok: false, action: 'skipped', reason: eligibility.reason };
    }

    // Validate vision path
    const absVision = resolveVisionPath(root, contConfig.vision_path);
    if (!existsSync(absVision)) {
      return { ok: false, action: 'failed', reason: `VISION.md not found at ${absVision}` };
    }

    session = createScheduleOwnedSession(schedule, scheduleId);
    writeContinuousSession(root, session);
    log(chalk.cyan(`Started schedule-owned continuous session: ${session.session_id} (schedule: ${scheduleId})`));

    // Record schedule start
    updateScheduleState(root, config, scheduleId, (record) => ({
      ...record,
      last_started_at: new Date().toISOString(),
      last_status: 'continuous_running',
      last_continuous_session_id: session.session_id,
    }));
  }

  // Build contOpts from schedule continuous config
  const contOpts = {
    visionPath: contConfig.vision_path,
    maxRuns: contConfig.max_runs,
    maxIdleCycles: contConfig.max_idle_cycles,
    triageApproval: contConfig.triage_approval,
    perSessionMaxUsd: contConfig.per_session_max_usd || null,
  };

  // Advance one step
  const step = await advanceContinuousRunOnce(context, session, contOpts, executeGovernedRun, log);

  // Update schedule state based on step result
  const statusMap = {
    completed: 'continuous_completed',
    idle_exit: 'continuous_idle_exit',
    failed: 'continuous_failed',
    blocked: 'continuous_blocked',
    running: 'continuous_running',
  };
  let schedStatus = statusMap[step.status] || 'continuous_running';
  if (step.action === 'session_budget_exhausted') {
    schedStatus = 'continuous_session_budget_exhausted';
  }

  updateScheduleState(root, config, scheduleId, (record) => ({
    ...record,
    last_finished_at: new Date().toISOString(),
    last_status: schedStatus,
    last_run_id: step.run_id || record.last_run_id,
    last_continuous_session_id: session.session_id,
  }));

  return {
    ok: step.ok,
    action: step.action,
    status: step.status,
    session_id: session.session_id,
    run_id: step.run_id || null,
    intent_id: step.intent_id || null,
    runs_completed: session.runs_completed,
  };
}

export async function scheduleListCommand(opts) {
  const context = loadScheduleContext();
  if (!context) return;

  const resolved = resolveScheduleEntries(context, opts.schedule, opts.at);
  if (!resolved.ok) {
    console.error(chalk.red(resolved.error));
    process.exitCode = 1;
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify({
      schedules: resolved.entries,
      state_file: SCHEDULE_STATE_PATH,
    }, null, 2));
    return;
  }

  printScheduleTable(resolved.entries);
}

export async function scheduleRunDueCommand(opts) {
  const context = loadScheduleContext();
  if (!context) return;

  const result = await runDueSchedules(context, opts);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!result.ok) {
    console.error(chalk.red(result.error || 'Scheduled run failed'));
  } else if (result.results.length === 0) {
    console.log(chalk.dim('No schedules configured.'));
  } else {
    for (const entry of result.results) {
      if (entry.action === 'ran') {
        console.log(chalk.green(`Schedule ran: ${entry.id} (${entry.run_id || 'no run id'})`));
      } else if (entry.action === 'continued') {
        console.log(chalk.green(`Schedule continued: ${entry.id} (${entry.run_id || 'no run id'})`));
      } else if (entry.action === 'preempted') {
        console.log(chalk.yellow(`Schedule preempted by injected priority: ${entry.id} (${entry.injected_intent_id || 'unknown intent'})`));
      } else if (entry.action === 'preemption_failed') {
        console.log(chalk.red(`Schedule preemption failed: ${entry.id} (${entry.error || 'unknown error'})`));
      } else if (entry.action === 'blocked') {
        console.log(chalk.yellow(`Schedule waiting on unblock: ${entry.id}`));
      } else if (entry.action === 'skipped') {
        console.log(chalk.yellow(`Schedule skipped: ${entry.id} (${entry.reason})`));
      } else if (entry.action === 'not_due') {
        console.log(chalk.dim(`Schedule not due: ${entry.id}`));
      } else if (entry.action === 'disabled') {
        console.log(chalk.dim(`Schedule disabled: ${entry.id}`));
      }
    }
  }

  process.exitCode = result.exitCode;
}

export async function scheduleStatusCommand(opts) {
  const context = loadScheduleContext();
  if (!context) return;

  const raw = readDaemonState(context.root);
  const evaluation = evaluateDaemonStatus(raw);

  if (opts.json) {
    const output = {
      ok: evaluation.status === 'running' || evaluation.status === 'never_started',
      state_file: DAEMON_STATE_PATH,
      daemon: {
        status: evaluation.status,
        pid: raw?.pid ?? null,
        started_at: raw?.started_at ?? null,
        last_heartbeat_at: raw?.last_heartbeat_at ?? null,
        last_cycle_result: raw?.last_cycle_result ?? null,
        poll_seconds: raw?.poll_seconds ?? null,
        stale_after_seconds: evaluation.stale_after_seconds ?? null,
        last_error: raw?.last_error ?? null,
      },
    };
    if (evaluation.warning) output.daemon.warning = evaluation.warning;
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // Human-readable output
  const statusColors = {
    running: chalk.green,
    stale: chalk.yellow,
    not_running: chalk.red,
    never_started: chalk.dim,
  };
  const colorFn = statusColors[evaluation.status] || chalk.white;

  console.log(chalk.bold('Schedule Daemon Status'));
  console.log(`  State:     ${colorFn(evaluation.status)}`);

  if (evaluation.status === 'never_started') {
    console.log(chalk.dim('  No daemon state file found. Run `agentxchain schedule daemon` to start.'));
    return;
  }

  if (evaluation.warning) {
    console.log(chalk.yellow(`  Warning:   ${evaluation.warning}`));
  }

  if (raw?.pid != null) {
    console.log(`  PID:       ${raw.pid}`);
  }
  if (raw?.started_at) {
    console.log(`  Started:   ${raw.started_at}`);
  }
  if (raw?.last_heartbeat_at) {
    console.log(`  Heartbeat: ${raw.last_heartbeat_at}`);
  }
  if (raw?.last_cycle_result) {
    const resultColor = raw.last_cycle_result === 'ok' ? chalk.green : chalk.red;
    console.log(`  Last cycle: ${resultColor(raw.last_cycle_result)}`);
  }
  if (raw?.poll_seconds != null) {
    console.log(`  Poll:      ${raw.poll_seconds}s`);
  }
  if (evaluation.status === 'stale') {
    console.log(chalk.yellow(`  ⚠ Heartbeat is ${evaluation.heartbeat_age_seconds}s old (stale after ${evaluation.stale_after_seconds}s)`));
  }
  if (raw?.last_error) {
    console.log(chalk.red(`  Last error: ${raw.last_error}`));
  }
}

export async function scheduleDaemonCommand(opts) {
  const context = loadScheduleContext();
  if (!context) return;

  const pollSeconds = Number.parseInt(opts.pollSeconds ?? '60', 10);
  const maxCycles = opts.maxCycles != null ? Number.parseInt(opts.maxCycles, 10) : null;
  if (!Number.isInteger(pollSeconds) || pollSeconds < 1) {
    console.error(chalk.red('--poll-seconds must be an integer >= 1'));
    process.exitCode = 1;
    return;
  }
  if (maxCycles !== null && (!Number.isInteger(maxCycles) || maxCycles < 1)) {
    console.error(chalk.red('--max-cycles must be an integer >= 1'));
    process.exitCode = 1;
    return;
  }

  let cycle = 0;
  const daemonState = createDaemonState(process.pid, pollSeconds, opts.schedule || null, maxCycles);

  try {
    writeDaemonState(context.root, daemonState);
  } catch (err) {
    console.error(chalk.red(`Cannot write daemon state: ${err.message}`));
    process.exitCode = 1;
    return;
  }

  if (!opts.json) {
    console.log(chalk.bold('AgentXchain Schedule Daemon'));
    console.log(chalk.dim(`  Poll: ${pollSeconds}s`));
    console.log(chalk.dim(`  State: ${SCHEDULE_STATE_PATH}`));
    console.log(chalk.dim(`  Health: ${DAEMON_STATE_PATH}`));
    console.log('');
  }

  while (true) {
    cycle += 1;
    daemonState.last_cycle_started_at = new Date().toISOString();
    const continuousScheduleIds = getContinuousEnabledScheduleIds(context.config);

    // Check for continuous schedule entries first
    const contEntry = selectContinuousScheduleEntry(context.root, context.config, {
      scheduleId: opts.schedule || null,
      at: opts.at,
    });
    let result;

    if (contEntry?.error) {
      result = {
        ok: false,
        exitCode: 1,
        results: [{
          id: contEntry.id,
          action: 'failed',
          continuous: true,
          reason: contEntry.error,
        }],
      };
    } else if (contEntry) {
      const isDue = contEntry.due ?? false;

      const contResult = await advanceScheduleContinuousSession(context, contEntry, {
        isDue,
        json: opts.json,
        at: opts.at,
      });

      // Run non-continuous schedules normally alongside
      const nonContResult = await runDueSchedules(context, {
        ...opts,
        continueActiveScheduleRuns: true,
        tolerateBlockedRun: true,
        excludeSchedules: continuousScheduleIds,
      });

      // Merge results
      const contResultEntry = {
        id: contEntry.id,
        action: contResult.action,
        continuous: true,
        session_id: contResult.session_id || null,
        status: contResult.status || null,
        run_id: contResult.run_id || null,
        runs_completed: contResult.runs_completed ?? null,
      };
      if (contResult.reason) contResultEntry.reason = contResult.reason;

      result = {
        ok: contResult.ok !== false && nonContResult.ok,
        exitCode: (contResult.ok === false || !nonContResult.ok) ? 1 : 0,
        results: [contResultEntry, ...nonContResult.results],
      };
    } else {
      result = await runDueSchedules(context, {
        ...opts,
        continueActiveScheduleRuns: true,
        tolerateBlockedRun: true,
        excludeSchedules: continuousScheduleIds,
      });
    }

    updateDaemonHeartbeat(context.root, daemonState, result);

    if (opts.json) {
      console.log(JSON.stringify({ cycle, ...result }));
    }
    if (!result.ok) {
      process.exitCode = result.exitCode;
      return;
    }
    if (maxCycles !== null && cycle >= maxCycles) {
      process.exitCode = 0;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollSeconds * 1000));
  }
}
