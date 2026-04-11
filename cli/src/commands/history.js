/**
 * agentxchain history — cross-run operator observability.
 *
 * Shows a persistent history of governed runs in the current project.
 */

import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import chalk from 'chalk';
import { queryRunHistory, queryRunLineage, isInheritable } from '../lib/run-history.js';
import { getRunTriggerLabel, summarizeRunProvenance } from '../lib/run-provenance.js';

/**
 * @param {object} opts - { json?: boolean, limit?: number, status?: string, dir?: string }
 */
export async function historyCommand(opts) {
  const root = findProjectRoot(opts.dir || process.cwd());
  if (!root) {
    console.error(chalk.red('No AgentXchain project found. Run this inside a governed project.'));
    process.exit(1);
  }

  // ── Lineage mode ─────────────────────────────────────────────────────────
  if (opts.lineage) {
    const result = queryRunLineage(root, opts.lineage);
    if (!result.ok) {
      console.error(chalk.red(result.error));
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(result.chain, null, 2));
      return;
    }

    console.log(chalk.bold(`Run Lineage for ${opts.lineage}:`));
    result.chain.forEach((entry, i) => {
      if (entry.broken_link) {
        const prefix = i === 0 ? '  ' : '  └─ ';
        console.log(chalk.red(`${prefix}[broken link: ${entry.missing_run_id}]`));
        return;
      }
      const runId = (entry.run_id || '—').slice(0, 12);
      const status = formatStatus(entry.status);
      const phases = (entry.phases_completed || []).join(',') || '—';
      const turns = `${entry.total_turns || 0} turns`;
      const cost = entry.total_cost_usd != null ? `$${entry.total_cost_usd.toFixed(2)}` : '';
      const trigger = getRunTriggerLabel(entry.provenance);
      const ctxMarker = isInheritable(entry) ? ' [ctx]' : '';
      const parentNote = entry.provenance?.parent_run_id
        ? ` from ${entry.provenance.parent_run_id.slice(0, 12)}`
        : '';
      const headline = entry.retrospective?.headline
        ? `  ${formatHeadline(entry.retrospective.headline)}`
        : '';
      const prefix = i === 0 ? '  ' : '  └─ ';
      console.log(`${prefix}${runId}  ${status}  ${pad(phases, 20)}  ${pad(turns, 10)}  ${pad(cost, 8)}  (${trigger}${parentNote})${ctxMarker}${headline}`);
    });
    return;
  }

  // ── Standard history view ────────────────────────────────────────────────
  const limit = opts.limit ? parseInt(opts.limit, 10) : 20;
  const entries = queryRunHistory(root, {
    limit,
    status: opts.status || undefined,
  });

  if (opts.json) {
    const enriched = entries.map(e => ({ ...e, inheritable: isInheritable(e) }));
    console.log(JSON.stringify(enriched, null, 2));
    return;
  }

  if (entries.length === 0) {
    console.log(chalk.dim('No run history found.'));
    if (opts.status) {
      console.log(chalk.dim(`  (filtered by status: ${opts.status})`));
    }
    return;
  }

  // Table header
  const header = [
    pad('#', 4),
    pad('Run ID', 14),
    pad('Status', 11),
    pad('Trigger', 14),
    pad('Ctx', 4),
    pad('Phases', 8),
    pad('Turns', 6),
    pad('Cost', 10),
    pad('Duration', 10),
    pad('Date', 20),
    pad('Headline', 42),
  ].join(' ');

  console.log(chalk.bold(header));
  console.log(chalk.dim('─'.repeat(header.length)));

  entries.forEach((entry, i) => {
    const idx = String(i + 1);
    const runId = (entry.run_id || '—').slice(0, 12);
    const status = formatStatus(entry.status);
    const trigger = getRunTriggerLabel(entry.provenance);
    const ctx = isInheritable(entry) ? '✓' : '—';
    const phases = String(entry.phases_completed?.length || 0);
    const turns = String(entry.total_turns || 0);
    const cost = entry.total_cost_usd != null
      ? `$${entry.total_cost_usd.toFixed(4)}`
      : '—';
    const duration = entry.duration_ms != null
      ? formatDuration(entry.duration_ms)
      : '—';
    const date = entry.recorded_at
      ? new Date(entry.recorded_at).toLocaleString()
      : '—';
    const headline = formatHeadline(entry.retrospective?.headline);

    console.log([
      pad(idx, 4),
      pad(runId, 14),
      pad(status, 11),
      pad(trigger, 14),
      pad(ctx, 4),
      pad(phases, 8),
      pad(turns, 6),
      pad(cost, 10),
      pad(duration, 10),
      pad(date, 20),
      pad(headline, 42),
    ].join(' '));
  });

  console.log(chalk.dim(`\n${entries.length} run(s) shown`));
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function findProjectRoot(startDir) {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(resolve(dir, 'agentxchain.json'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) return null;
    dir = parent;
  }
}

function pad(str, width) {
  return String(str).padEnd(width);
}

function formatStatus(status) {
  if (status === 'completed') return chalk.green('completed');
  if (status === 'blocked') return chalk.yellow('blocked');
  if (status === 'failed') return chalk.red('failed');
  return status || '—';
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remainSecs}s`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hrs}h ${remainMins}m`;
}

function formatHeadline(headline) {
  if (!headline) return '—';
  const normalized = String(headline).replace(/\s+/g, ' ').trim();
  if (normalized.length <= 40) return normalized;
  return `${normalized.slice(0, 39)}…`;
}
