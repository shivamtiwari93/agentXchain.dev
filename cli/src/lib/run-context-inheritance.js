/**
 * Run Context Inheritance — read-only summary bridge from parent to child run.
 *
 * When a child run uses `--inherit-context` with `--continue-from` or
 * `--recover-from`, this module extracts a read-only summary from the
 * selected parent run-history record and attaches it to the child's
 * governed state.
 *
 * The inherited summary is:
 *   - read-only (never mutated by the child run)
 *   - a summary (not a full replay of the parent)
 *   - observable in status --json, report, export, and CONTEXT.md
 *
 * DEC-RUN-CONTEXT-INHERIT-001
 * Spec: .planning/RUN_CONTEXT_INHERITANCE_SPEC.md
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const RUN_HISTORY_PATH = '.agentxchain/run-history.jsonl';

/**
 * Build an inherited context summary from a parent run.
 *
 * @param {string} root - project root directory
 * @param {string} parentRunId - the parent run_id
 * @returns {{ ok: boolean, inherited_context?: object, warnings?: string[] }}
 */
export function buildInheritedContext(root, parentRunId) {
  const warnings = [];

  // 1. Read parent run-history entry
  const parentEntry = findRunHistoryEntry(root, parentRunId);
  if (!parentEntry) {
    warnings.push(`Parent run ${parentRunId} not found in run-history.jsonl`);
    return {
      ok: true,
      inherited_context: buildPartialContext(parentRunId, null, [], [], warnings),
      warnings,
    };
  }

  const snapshot = parentEntry.inheritance_snapshot;
  const recentDecisions = Array.isArray(snapshot?.recent_decisions) ? snapshot.recent_decisions : [];
  const acceptedTurns = Array.isArray(snapshot?.recent_accepted_turns) ? snapshot.recent_accepted_turns : [];

  if (!snapshot) {
    warnings.push('Parent run has no inheritance snapshot in run-history.jsonl — inherited context is metadata only');
  }

  const inherited_context = {
    schema_version: '0.1',
    parent_run_id: parentRunId,
    parent_status: parentEntry.status,
    parent_completed_at: parentEntry.completed_at || null,
    parent_phases_completed: parentEntry.phases_completed || [],
    parent_roles_used: parentEntry.roles_used || [],
    parent_blocked_reason: parentEntry.blocked_reason || null,
    recent_decisions: recentDecisions,
    recent_accepted_turns: acceptedTurns,
    inherited_at: new Date().toISOString(),
    warnings: warnings.length > 0 ? warnings : undefined,
  };

  return { ok: true, inherited_context, warnings };
}

/**
 * Render the inherited context as a markdown section for CONTEXT.md.
 */
export function renderInheritedContextMarkdown(inheritedContext, compact = false) {
  if (!inheritedContext) return '';

  const lines = [];
  lines.push('## Inherited Run Context');
  lines.push('');
  lines.push('> **This is a fresh run, not a resumed parent.** The context below is a read-only summary from the parent run to provide continuity.');
  lines.push('');
  lines.push(`- **Parent run:** ${inheritedContext.parent_run_id}`);
  lines.push(`- **Parent status:** ${inheritedContext.parent_status || 'unknown'}`);
  if (inheritedContext.parent_completed_at) {
    lines.push(`- **Completed at:** ${inheritedContext.parent_completed_at}`);
  }
  if (inheritedContext.parent_blocked_reason) {
    lines.push(`- **Blocked reason:** ${inheritedContext.parent_blocked_reason}`);
  }
  if (inheritedContext.parent_phases_completed?.length) {
    lines.push(`- **Phases completed:** ${inheritedContext.parent_phases_completed.join(', ')}`);
  }
  if (inheritedContext.parent_roles_used?.length) {
    lines.push(`- **Roles used:** ${inheritedContext.parent_roles_used.join(', ')}`);
  }
  lines.push('');

  if (!compact && inheritedContext.recent_decisions?.length) {
    lines.push('### Recent Decisions');
    lines.push('');
    for (const d of inheritedContext.recent_decisions) {
      const id = d.id || '(no id)';
      const stmt = d.statement || '(no statement)';
      lines.push(`- **${id}:** ${stmt}`);
    }
    lines.push('');
  }

  if (!compact && inheritedContext.recent_accepted_turns?.length) {
    lines.push('### Recent Accepted Turns');
    lines.push('');
    for (const t of inheritedContext.recent_accepted_turns) {
      const role = t.role || '(unknown)';
      const summary = t.summary || '(no summary)';
      lines.push(`- **${role}** (${t.turn_id || '?'}): ${summary}`);
    }
    lines.push('');
  }

  if (inheritedContext.warnings?.length) {
    lines.push('### Inheritance Warnings');
    lines.push('');
    for (const w of inheritedContext.warnings) {
      lines.push(`- ⚠ ${w}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Internal ────────────────────────────────────────────────────────────────

function findRunHistoryEntry(root, runId) {
  const filePath = join(root, RUN_HISTORY_PATH);
  if (!existsSync(filePath)) return null;
  try {
    const content = readFileSync(filePath, 'utf8').trim();
    if (!content) return null;
    const entries = content.split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
    return entries.find(e => e.run_id === runId) || null;
  } catch {
    return null;
  }
}

function buildPartialContext(parentRunId, parentEntry, decisions, turns, warnings) {
  return {
    schema_version: '0.1',
    parent_run_id: parentRunId,
    parent_status: parentEntry?.status || null,
    parent_completed_at: parentEntry?.completed_at || null,
    parent_phases_completed: parentEntry?.phases_completed || [],
    parent_roles_used: parentEntry?.roles_used || [],
    parent_blocked_reason: parentEntry?.blocked_reason || null,
    recent_decisions: decisions,
    recent_accepted_turns: turns,
    inherited_at: new Date().toISOString(),
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
