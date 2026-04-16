/**
 * agentxchain chain — operator-facing read surface for chain reports.
 *
 * Surfaces chain report metadata so operators can inspect lights-out
 * run-chaining history without opening raw JSON files.
 */

import chalk from 'chalk';
import { findProjectRoot } from '../lib/config.js';
import {
  loadAllChainReports,
  loadChainReport,
  loadLatestChainReport,
} from '../lib/chain-reports.js';

/**
 * agentxchain chain latest — show the most recent chain report.
 *
 * @param {object} opts - { json?: boolean, dir?: string }
 */
export async function chainLatestCommand(opts) {
  const root = findProjectRoot(opts.dir || process.cwd());
  if (!root) {
    console.error(chalk.red('No AgentXchain project found. Run this inside a governed project.'));
    process.exit(1);
  }

  const report = loadLatestChainReport(root);
  if (!report) {
    console.log(chalk.dim('No chain reports found.'));
    console.log(chalk.dim('  Run `agentxchain run --chain` to enable auto-chaining.'));
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  renderChainReport(report);
}

/**
 * agentxchain chain list — list all chain reports.
 *
 * @param {object} opts - { json?: boolean, limit?: number, dir?: string }
 */
export async function chainListCommand(opts) {
  const root = findProjectRoot(opts.dir || process.cwd());
  if (!root) {
    console.error(chalk.red('No AgentXchain project found. Run this inside a governed project.'));
    process.exit(1);
  }

  const reports = loadAllChainReports(root);
  const limit = opts.limit ? parseInt(opts.limit, 10) : 20;
  const limited = reports.slice(0, limit);

  if (opts.json) {
    console.log(JSON.stringify(limited, null, 2));
    return;
  }

  if (limited.length === 0) {
    console.log(chalk.dim('No chain reports found.'));
    console.log(chalk.dim('  Run `agentxchain run --chain` to enable auto-chaining.'));
    return;
  }

  // Table header
  const header = [
    pad('#', 4),
    pad('Chain ID', 16),
    pad('Runs', 6),
    pad('Turns', 7),
    pad('Terminal Reason', 28),
    pad('Duration', 12),
    pad('Started', 22),
  ].join(' ');

  console.log(chalk.bold(header));
  console.log(chalk.dim('─'.repeat(header.length)));

  limited.forEach((report, i) => {
    const idx = String(i + 1);
    const chainId = report.chain_id || '—';
    const runs = String(report.runs?.length || 0);
    const turns = String(report.total_turns || 0);
    const terminal = formatTerminalReason(report.terminal_reason);
    const duration = report.total_duration_ms != null
      ? formatDuration(report.total_duration_ms)
      : '—';
    const started = report.started_at
      ? new Date(report.started_at).toLocaleString()
      : '—';

    console.log([
      pad(idx, 4),
      pad(chainId, 16),
      pad(runs, 6),
      pad(turns, 7),
      pad(terminal, 28),
      pad(duration, 12),
      pad(started, 22),
    ].join(' '));
  });

  console.log(chalk.dim(`\n${limited.length} chain(s) shown${reports.length > limit ? ` (${reports.length} total)` : ''}`));
}

/**
 * agentxchain chain show <chain_id> — show a specific chain report.
 *
 * @param {string} chainId
 * @param {object} opts - { json?: boolean, dir?: string }
 */
export async function chainShowCommand(chainId, opts) {
  const root = findProjectRoot(opts.dir || process.cwd());
  if (!root) {
    console.error(chalk.red('No AgentXchain project found. Run this inside a governed project.'));
    process.exit(1);
  }

  const report = loadChainReport(root, chainId);
  if (!report) {
    console.error(chalk.red(`Chain report not found: ${chainId}`));
    console.log(chalk.dim('  Use `agentxchain chain list` to see available chain reports.'));
    process.exit(1);
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  renderChainReport(report);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderChainReport(report) {
  console.log(chalk.bold(`Chain Report: ${report.chain_id}`));
  console.log('');
  console.log(`  Total runs:     ${report.runs?.length || 0}`);
  console.log(`  Total turns:    ${report.total_turns || 0}`);
  console.log(`  Duration:       ${formatDuration(report.total_duration_ms || 0)}`);
  console.log(`  Terminal:       ${formatTerminalReason(report.terminal_reason)}`);
  console.log(`  Started:        ${report.started_at || '—'}`);
  console.log(`  Completed:      ${report.completed_at || '—'}`);
  console.log('');

  if (!report.runs || report.runs.length === 0) {
    console.log(chalk.dim('  No runs recorded.'));
    return;
  }

  // Run table header
  const runHeader = [
    pad('#', 4),
    pad('Run ID', 14),
    pad('Status', 12),
    pad('Trigger', 14),
    pad('Turns', 7),
    pad('Duration', 12),
    pad('Parent', 14),
    pad('Ctx', 40),
  ].join(' ');

  console.log(chalk.bold('  Runs:'));
  console.log(`  ${chalk.dim(runHeader)}`);
  console.log(`  ${chalk.dim('─'.repeat(runHeader.length))}`);

  report.runs.forEach((run, i) => {
    const idx = String(i + 1);
    const runId = (run.run_id || '—').slice(0, 12);
    const status = formatStatus(run.status);
    const trigger = run.provenance_trigger || '—';
    const turns = String(run.turns || 0);
    const duration = run.duration_ms != null ? formatDuration(run.duration_ms) : '—';
    const parent = run.parent_run_id ? run.parent_run_id.slice(0, 12) : '—';
    const ctx = formatInheritedContextSummary(run.inherited_context_summary);

    console.log(`  ${[
      pad(idx, 4),
      pad(runId, 14),
      pad(status, 12),
      pad(trigger, 14),
      pad(turns, 7),
      pad(duration, 12),
      pad(parent, 14),
      pad(ctx, 40),
    ].join(' ')}`);
  });
}

function formatInheritedContextSummary(summary) {
  if (!summary) return '—';

  const parts = [];
  if (summary.parent_roles_used?.length) {
    parts.push(`${summary.parent_roles_used.length} roles`);
  }
  if (summary.parent_phases_completed_count > 0) {
    parts.push(`${summary.parent_phases_completed_count} phases`);
  }
  if (summary.recent_decisions_count > 0) {
    parts.push(`${summary.recent_decisions_count} decisions`);
  }
  if (summary.recent_accepted_turns_count > 0) {
    parts.push(`${summary.recent_accepted_turns_count} turns`);
  }

  return parts.length > 0 ? parts.join(', ') : '—';
}

function formatTerminalReason(reason) {
  if (!reason) return '—';
  switch (reason) {
    case 'chain_limit_reached': return chalk.cyan('chain limit reached');
    case 'non_chainable_status': return chalk.yellow('non-chainable status');
    case 'operator_abort': return chalk.red('operator abort');
    case 'parent_validation_failed': return chalk.red('parent validation failed');
    case 'completed': return chalk.green('completed');
    case 'blocked': return chalk.yellow('blocked');
    default: return reason;
  }
}

function formatStatus(status) {
  if (status === 'completed') return chalk.green('completed');
  if (status === 'blocked') return chalk.yellow('blocked');
  if (status === 'failed') return chalk.red('failed');
  return status || '—';
}

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

function pad(str, width) {
  return String(str).padEnd(width);
}

// ── Data Loading ──────────────────────────────────────────────────────────────
