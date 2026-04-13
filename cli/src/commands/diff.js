import chalk from 'chalk';

import { findProjectRoot } from '../lib/config.js';
import { buildRunDiff, resolveRunHistoryReference } from '../lib/run-diff.js';

export async function diffCommand(leftRef, rightRef, opts) {
  const root = findProjectRoot(opts.dir || process.cwd());
  if (!root) {
    console.error(chalk.red('No AgentXchain project found. Run this inside a governed project.'));
    process.exit(1);
  }

  const leftResult = resolveRunHistoryReference(root, leftRef);
  if (!leftResult.ok) {
    console.error(chalk.red(leftResult.error));
    process.exit(1);
  }

  const rightResult = resolveRunHistoryReference(root, rightRef);
  if (!rightResult.ok) {
    console.error(chalk.red(rightResult.error));
    process.exit(1);
  }

  const diff = buildRunDiff(leftResult.entry, rightResult.entry);
  if (opts.json) {
    console.log(JSON.stringify(diff, null, 2));
    return;
  }

  console.log(formatRunDiffText(diff));
}

function formatRunDiffText(diff) {
  const lines = [];
  lines.push(chalk.bold('Run Diff'));
  lines.push(`${chalk.dim('Left:')}  ${formatRunHeader(diff.left)}`);
  lines.push(`${chalk.dim('Right:')} ${formatRunHeader(diff.right)}`);

  if (!diff.changed) {
    lines.push('');
    lines.push(chalk.green('No differences.'));
    return lines.join('\n');
  }

  appendChangedSection(lines, 'Changed fields', Object.values(diff.scalar_changes)
    .filter((entry) => entry.changed)
    .map((entry) => `${entry.label}: ${formatValue(entry.left, entry.label)} -> ${formatValue(entry.right, entry.label)}`));

  appendChangedSection(lines, 'Numeric deltas', Object.values(diff.numeric_changes)
    .filter((entry) => entry.changed)
    .map((entry) => `${entry.label}: ${formatValue(entry.left, entry.label)} -> ${formatValue(entry.right, entry.label)}${formatDelta(entry.delta, entry.label)}`));

  appendChangedSection(lines, 'List changes', Object.values(diff.list_changes)
    .filter((entry) => entry.changed)
    .flatMap((entry) => {
      const items = [];
      if (entry.added.length > 0) {
        items.push(`${entry.label} added: ${entry.added.join(', ')}`);
      }
      if (entry.removed.length > 0) {
        items.push(`${entry.label} removed: ${entry.removed.join(', ')}`);
      }
      return items;
    }));

  appendChangedSection(lines, 'Gate changes', diff.gate_changes
    .filter((entry) => entry.changed)
    .map((entry) => `${entry.gate_id}: ${formatValue(entry.left)} -> ${formatValue(entry.right)}`));

  return lines.join('\n');
}

function appendChangedSection(lines, heading, items) {
  if (items.length === 0) return;
  lines.push('');
  lines.push(chalk.bold(heading));
  for (const item of items) {
    lines.push(`- ${item}`);
  }
}

function formatRunHeader(entry) {
  const status = entry.status || '—';
  const trigger = entry.trigger || 'legacy';
  const recordedAt = entry.recorded_at
    ? new Date(entry.recorded_at).toLocaleString()
    : 'unknown date';
  return `${entry.run_id} (${status}, ${trigger}, ${recordedAt})`;
}

function formatValue(value, label = '') {
  if (value == null) return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (label === 'Cost' || label === 'Budget') return `$${value.toFixed(4)}`;
  if (label === 'Duration') return formatDuration(value);
  return String(value);
}

function formatDelta(delta, label) {
  if (delta == null || delta === 0) return '';
  if (label === 'Cost' || label === 'Budget') {
    return ` (${delta > 0 ? '+' : ''}$${delta.toFixed(4)})`;
  }
  if (label === 'Duration') {
    return ` (${delta > 0 ? '+' : ''}${formatDuration(delta)})`;
  }
  return ` (${delta > 0 ? '+' : ''}${delta})`;
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
