import chalk from 'chalk';

import { findProjectRoot } from '../lib/config.js';
import { buildExportDiff, resolveExportArtifact } from '../lib/export-diff.js';
import { buildRunDiff, resolveRunHistoryReference } from '../lib/run-diff.js';

export async function diffCommand(leftRef, rightRef, opts) {
  if (opts.export) {
    const leftExport = resolveExportArtifact(leftRef);
    if (!leftExport.ok) {
      console.error(chalk.red(leftExport.error));
      process.exit(1);
    }

    const rightExport = resolveExportArtifact(rightRef);
    if (!rightExport.ok) {
      console.error(chalk.red(rightExport.error));
      process.exit(1);
    }

    const exportDiff = buildExportDiff(leftExport.artifact, rightExport.artifact, {
      left_ref: leftExport.resolved_ref,
      right_ref: rightExport.resolved_ref,
    });
    if (!exportDiff.ok) {
      console.error(chalk.red(exportDiff.error));
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(exportDiff.diff, null, 2));
      return;
    }

    console.log(formatExportDiffText(exportDiff.diff));
    return;
  }

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
    .flatMap((entry) => listChangeItems(entry)));

  appendChangedSection(lines, 'Gate changes', diff.gate_changes
    .filter((entry) => entry.changed)
    .map((entry) => `${entry.gate_id}: ${formatValue(entry.left)} -> ${formatValue(entry.right)}`));

  return lines.join('\n');
}

function formatExportDiffText(diff) {
  const lines = [];
  lines.push(chalk.bold('Export Diff'));
  lines.push(`${chalk.dim('Left:')}  ${formatExportHeader(diff.left_ref, diff.left)}`);
  lines.push(`${chalk.dim('Right:')} ${formatExportHeader(diff.right_ref, diff.right)}`);

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
    .flatMap((entry) => listChangeItems(entry)));

  if (diff.subject_kind === 'coordinator') {
    appendChangedSection(lines, 'Repo status changes', diff.repo_status_changes
      .filter((entry) => entry.changed)
      .map((entry) => `${entry.key}: ${formatValue(entry.left)} -> ${formatValue(entry.right)}`));

    appendChangedSection(lines, 'Repo export changes', diff.repo_export_changes
      .filter((entry) => entry.changed)
      .map((entry) => `${entry.key}: ${formatValue(entry.left)} -> ${formatValue(entry.right)}`));

    appendChangedSection(lines, 'Event type deltas', diff.event_type_changes
      .filter((entry) => entry.changed)
      .map((entry) => `${entry.key}: ${formatValue(entry.left)} -> ${formatValue(entry.right)}${formatDelta(entry.delta, entry.label)}`));
  }

  appendRegressionSection(lines, diff.regressions);

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

function appendRegressionSection(lines, regressions) {
  if (!regressions || regressions.length === 0) return;
  lines.push('');
  lines.push(chalk.bold.red('Governance Regressions:'));
  for (const reg of regressions) {
    const severityTag = reg.severity === 'error'
      ? chalk.red(`[${reg.severity}]`)
      : chalk.yellow(`[${reg.severity}]`);
    lines.push(`${severityTag} ${reg.id}: ${reg.message}`);
  }
}

function listChangeItems(entry) {
  const items = [];
  if (entry.added.length > 0) {
    items.push(`${entry.label} added: ${entry.added.join(', ')}`);
  }
  if (entry.removed.length > 0) {
    items.push(`${entry.label} removed: ${entry.removed.join(', ')}`);
  }
  return items;
}

function formatRunHeader(entry) {
  const status = entry.status || '—';
  const trigger = entry.trigger || 'legacy';
  const recordedAt = entry.recorded_at
    ? new Date(entry.recorded_at).toLocaleString()
    : 'unknown date';
  return `${entry.run_id} (${status}, ${trigger}, ${recordedAt})`;
}

function formatExportHeader(ref, entry) {
  const exportKind = entry.export_kind === 'agentxchain_coordinator_export'
    ? 'coordinator export'
    : 'run export';
  const status = entry.status || '—';
  const identity = entry.run_id || entry.super_run_id || 'unknown run';
  return `${ref} (${exportKind}, ${status}, ${identity})`;
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
