/**
 * agentxchain events — repo-local run event stream reader.
 *
 * Reads and optionally follows the `.agentxchain/events.jsonl` log,
 * giving operators structured visibility into governed run lifecycle
 * without requiring webhooks or a dashboard.
 */

import { resolve } from 'path';
import { existsSync, watchFile, unwatchFile } from 'fs';
import { readFileSync } from 'fs';
import chalk from 'chalk';
import { readRunEvents, RUN_EVENTS_PATH, VALID_RUN_EVENTS } from '../lib/run-events.js';

/**
 * @param {object} opts
 * @param {boolean} [opts.follow]  - Stream events as they arrive
 * @param {string}  [opts.type]    - Comma-separated event types
 * @param {string}  [opts.since]   - ISO-8601 timestamp filter
 * @param {boolean} [opts.json]    - Raw JSONL output
 * @param {number}  [opts.limit]   - Max events to show (default 50)
 * @param {string}  [opts.dir]     - Project directory
 */
export async function eventsCommand(opts) {
  const root = findProjectRoot(opts.dir || process.cwd());
  if (!root) {
    console.error(chalk.red('No AgentXchain project found. Run this inside a governed project.'));
    process.exit(1);
  }

  const limit = opts.limit != null ? parseInt(opts.limit, 10) : 50;
  const events = readRunEvents(root, {
    type: opts.type,
    since: opts.since,
    limit: limit === 0 ? undefined : limit,
  });

  if (opts.json) {
    for (const evt of events) {
      console.log(JSON.stringify(evt));
    }
  } else {
    if (events.length === 0 && !opts.follow) {
      console.log(chalk.dim('No events found.'));
      if (opts.type) console.log(chalk.dim(`  (filtered by type: ${opts.type})`));
      return;
    }
    for (const evt of events) {
      printEvent(evt);
    }
  }

  if (opts.follow) {
    return followEvents(root, opts);
  }
}

function printEvent(evt) {
  const ts = evt.timestamp ? new Date(evt.timestamp).toLocaleTimeString() : '—';
  const type = colorEventType(evt.event_type);
  const runId = evt.run_id ? evt.run_id.slice(0, 12) : '—';
  const phase = evt.phase || '—';
  const turnInfo = evt.turn?.role_id ? ` [${evt.turn.role_id}]` : '';
  const conflictDetail = evt.event_type === 'turn_conflicted'
    ? ` — ${formatConflictDetail(evt)}`
    : '';
  const rejectionDetail = evt.event_type === 'turn_rejected' && evt.payload?.reason
    ? ` — ${evt.payload.reason}${evt.payload.failed_stage ? ` (${evt.payload.failed_stage})` : ''}`
    : '';
  const acceptanceFailedDetail = evt.event_type === 'acceptance_failed' && evt.payload?.reason
    ? ` — ${evt.payload.reason}${evt.payload.stage ? ` (${evt.payload.stage})` : ''}`
    : '';
  const phaseTransitionDetail = evt.event_type === 'phase_entered' && evt.payload?.from && evt.payload?.to
    ? ` ${evt.payload.from} → ${evt.payload.to}${evt.payload.trigger ? ` (${evt.payload.trigger})` : ''}`
    : '';
  const gateFailedDetail = evt.event_type === 'gate_failed' && evt.payload?.from_phase
    ? ` ${evt.payload.from_phase} → ${evt.payload.to_phase || '?'}${evt.payload.reasons?.length ? ` — ${evt.payload.reasons[0]}` : ''}${evt.payload.gate_id ? ` (${evt.payload.gate_id})` : ''}`
    : '';
  const humanEscalationDetail = evt.event_type === 'human_escalation_raised' && evt.payload?.escalation_id
    ? ` ${evt.payload.escalation_id} [${evt.payload.type || '?'}]${evt.payload.service ? ` (${evt.payload.service})` : ''}`
    : evt.event_type === 'human_escalation_resolved' && evt.payload?.escalation_id
      ? ` ${evt.payload.escalation_id} via ${evt.payload.resolved_via || '?'}`
      : '';
  console.log(`${chalk.dim(ts)}  ${type}  ${chalk.cyan(runId)}  ${phase}${turnInfo}${conflictDetail}${rejectionDetail}${acceptanceFailedDetail}${phaseTransitionDetail}${gateFailedDetail}${humanEscalationDetail}`);
}

function formatConflictDetail(evt) {
  const payload = evt.payload || {};
  const fileSummary = summarizeList(payload.conflicting_files, 3) || 'unknown files';
  const overlapRatio = typeof payload.overlap_ratio === 'number'
    ? `${Math.round(payload.overlap_ratio * 100)}% overlap`
    : null;
  const detectionCount = Number.isInteger(payload.detection_count)
    ? `detection ${payload.detection_count}`
    : null;
  const turnSummary = summarizeList(payload.accepted_since_turn_ids, 2);
  const parts = [fileSummary, overlapRatio, detectionCount];
  if (turnSummary) {
    parts.push(`accepted since ${turnSummary}`);
  }
  if (evt.status === 'blocked') {
    parts.push('run blocked');
  }
  return parts.filter(Boolean).join(' | ');
}

function summarizeList(items, limit) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const shown = items.slice(0, limit).join(', ');
  if (items.length <= limit) return shown;
  return `${shown} +${items.length - limit} more`;
}

function colorEventType(type) {
  const colors = {
    run_started: chalk.green,
    run_completed: chalk.green.bold,
    run_blocked: chalk.red,
    turn_dispatched: chalk.blue,
    turn_accepted: chalk.green,
    turn_rejected: chalk.yellow,
    acceptance_failed: chalk.red.bold,
    turn_reissued: chalk.cyan,
    turn_conflicted: chalk.redBright,
    phase_entered: chalk.magenta,
    escalation_raised: chalk.red.bold,
    escalation_resolved: chalk.green,
    human_escalation_raised: chalk.red.bold,
    human_escalation_resolved: chalk.green,
    gate_pending: chalk.yellow,
    gate_approved: chalk.green,
    gate_failed: chalk.red,
    budget_exceeded_warn: chalk.yellowBright,
  };
  const colorFn = colors[type] || chalk.white;
  return colorFn(pad(type, 22));
}

function pad(str, len) {
  return (str || '').padEnd(len);
}

function followEvents(root, opts) {
  const filePath = resolve(root, RUN_EVENTS_PATH);
  let lastSize = 0;

  try {
    if (existsSync(filePath)) {
      lastSize = readFileSync(filePath).length;
    }
  } catch {}

  console.log(chalk.dim('Watching for events... (Ctrl+C to stop)'));

  return new Promise(() => {
    const checkForNewEvents = () => {
      try {
        if (!existsSync(filePath)) return;
        const content = readFileSync(filePath, 'utf8');
        if (content.length <= lastSize) return;

        const newContent = content.slice(lastSize);
        lastSize = content.length;

        const lines = newContent.split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const evt = JSON.parse(line);
            if (opts.type) {
              const types = new Set(opts.type.split(',').map(t => t.trim()));
              if (!types.has(evt.event_type)) continue;
            }
            if (opts.json) {
              console.log(JSON.stringify(evt));
            } else {
              printEvent(evt);
            }
          } catch {}
        }
      } catch {}
    };

    watchFile(filePath, { interval: 200 }, checkForNewEvents);

    process.on('SIGINT', () => {
      unwatchFile(filePath, checkForNewEvents);
      process.exit(0);
    });
  });
}

/**
 * Walk up to find the nearest directory containing agentxchain.json.
 */
function findProjectRoot(start) {
  let dir = resolve(start);
  while (true) {
    if (existsSync(resolve(dir, 'agentxchain.json'))) return dir;
    if (existsSync(resolve(dir, '.agentxchain', 'state.json'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) return null;
    dir = parent;
  }
}
