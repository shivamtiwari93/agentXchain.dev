import chalk from 'chalk';
import { loadProjectContext } from '../lib/config.js';
import {
  SCHEDULE_STATE_PATH,
  listSchedules,
  updateScheduleState,
  evaluateScheduleLaunchEligibility,
} from '../lib/run-schedule.js';
import { executeGovernedRun } from './run.js';

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

async function runDueSchedules(context, opts = {}) {
  const resolved = resolveScheduleEntries(context, opts.schedule, opts.at);
  if (!resolved.ok) {
    return { ok: false, exitCode: 1, error: resolved.error, results: [] };
  }

  const nowIso = opts.at || new Date().toISOString();
  const results = [];

  for (const entry of resolved.entries) {
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

    const runId = execution.result?.state?.run_id || null;
    const startedAt = execution.result?.state?.created_at || nowIso;
    updateScheduleState(context.root, context.config, entry.id, (record) => ({
      ...record,
      last_started_at: startedAt,
      last_finished_at: new Date().toISOString(),
      last_run_id: runId,
      last_status: execution.result?.stop_reason || (execution.exitCode === 0 ? 'completed' : 'launch_failed'),
      last_skip_at: null,
      last_skip_reason: null,
    }));
    results.push({
      id: entry.id,
      action: 'ran',
      run_id: runId,
      stop_reason: execution.result?.stop_reason || null,
      exit_code: execution.exitCode,
    });

    if (execution.exitCode !== 0) {
      return { ok: false, exitCode: execution.exitCode, results };
    }
  }

  return { ok: true, exitCode: 0, results };
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
  if (!opts.json) {
    console.log(chalk.bold('AgentXchain Schedule Daemon'));
    console.log(chalk.dim(`  Poll: ${pollSeconds}s`));
    console.log(chalk.dim(`  State: ${SCHEDULE_STATE_PATH}`));
    console.log('');
  }

  while (true) {
    cycle += 1;
    const result = await runDueSchedules(context, opts);
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
