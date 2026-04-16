import { getCoordinatorPendingGateDetails } from '../../src/lib/coordinator-pending-gate-presentation.js';
import { buildCoordinatorRepoStatusRows } from '../../src/lib/coordinator-repo-status-presentation.js';

/**
 * Blocked State view — renders current blocked state with recovery info.
 *
 * Pure render function: takes data, returns HTML string. Testable in Node.js.
 * Per DEC-DASH-002: read-only. Shows copyable CLI recovery commands, no write actions.
 */

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getHookPhase(entry) {
  return entry?.hook_phase || entry?.phase || '';
}

function getHookName(entry) {
  return entry?.hook_name || entry?.hook || entry?.name || '';
}

function renderDetailRows(details) {
  if (!Array.isArray(details) || details.length === 0) {
    return '';
  }

  let html = '';
  for (const detail of details) {
    html += `<dt>${esc(detail.label)}</dt><dd${detail.mono ? ' class="mono"' : ''}>${esc(detail.value)}</dd>`;
  }
  return html;
}

function selectRelevantAuditEntries(state, audit) {
  if (!Array.isArray(audit) || audit.length === 0) {
    return [];
  }

  const blocked = state?.blocked_reason || state?.blocked_state || {};
  const blockedOn = String(state?.blocked_on || '');
  const hookMatch = blockedOn.match(/^hook:([^:]+):(.+)$/);

  if (hookMatch) {
    const [, hookPhase, hookName] = hookMatch;
    const matchingEntries = audit.filter((entry) => (
      getHookPhase(entry) === hookPhase && getHookName(entry) === hookName
    ));
    if (matchingEntries.length > 0) {
      return matchingEntries.slice(-3);
    }
  }

  const category = String(blocked.category || blocked.reason || '').toLowerCase();
  if (category.includes('validation') || blockedOn.startsWith('validator:')) {
    const validationEntries = audit.filter((entry) => (
      getHookPhase(entry).includes('validation')
    ));
    if (validationEntries.length > 0) {
      return validationEntries.slice(-3);
    }
  }

  return audit.slice(-3);
}

function getCoordinatorRepoRows(coordinatorState, coordinatorRepoStatusRows) {
  if (Array.isArray(coordinatorRepoStatusRows) && coordinatorRepoStatusRows.length > 0) {
    return coordinatorRepoStatusRows;
  }

  return buildCoordinatorRepoStatusRows({
    config: null,
    coordinatorRepoRuns: coordinatorState?.repo_runs || {},
  });
}

function formatCoordinatorRepoCardMeta(row) {
  const parts = [];
  if (row?.run_id) {
    parts.push(`run ${row.run_id}`);
  }
  for (const detail of Array.isArray(row?.details) ? row.details : []) {
    parts.push(`${detail.label}: ${detail.value}`);
  }
  return parts.join(' | ') || '-';
}

export function render({
  state,
  audit = [],
  coordinatorState = null,
  coordinatorAudit = [],
  coordinatorBlockers = null,
  coordinatorRepoStatusRows = null,
}) {
  const activeState = state?.status === 'blocked' ? state : coordinatorState;
  const activeAudit = activeState === state ? audit : coordinatorAudit;
  const isCoordinator = activeState === coordinatorState;

  if (!activeState || activeState.status !== 'blocked') {
    return `<div class="placeholder"><h2>Blocked State</h2><p>Run is not currently blocked.</p></div>`;
  }

  const blocked = activeState.blocked_reason || activeState.blocked_state || {};
  const recovery = blocked.recovery || {};
  const reason = blocked.category || blocked.reason || activeState.blocked_on || blocked || 'Unknown';
  const detail = recovery.detail || blocked.detail || null;
  const recoveryAction = recovery.recovery_action || blocked.recovery_action || blocked.recovery_command || null;
  const blockedBy = activeState.blocked_on || blocked.blocked_by || blocked.source || null;
  const turnId = blocked.turn_id || null;
  const owner = recovery.owner || null;
  const typedReason = recovery.typed_reason || null;
  const turnRetained = typeof recovery.turn_retained === 'boolean' ? recovery.turn_retained : null;
  const blockedAt = blocked.blocked_at || null;
  const runtimeGuidance = Array.isArray(activeState.runtime_guidance) ? activeState.runtime_guidance : [];
  const coordinatorNextActions = coordinatorBlockers?.ok === false
    ? []
    : Array.isArray(coordinatorBlockers?.next_actions)
      ? coordinatorBlockers.next_actions
      : [];
  const nextActions = isCoordinator
    ? coordinatorNextActions
    : Array.isArray(activeState.next_actions)
      ? activeState.next_actions
      : [];
  const coordinatorPendingGateDetails = isCoordinator
    ? getCoordinatorPendingGateDetails({
      pendingGate: activeState.pending_gate,
      active: coordinatorBlockers?.active,
    })
    : [];
  const coordinatorRepoRows = isCoordinator
    ? getCoordinatorRepoRows(coordinatorState, coordinatorRepoStatusRows)
    : [];
  const relevantAudit = selectRelevantAuditEntries(activeState, activeAudit);

  let html = `<div class="blocked-view">
    <div class="blocked-banner">
      <div class="blocked-icon">BLOCKED</div>
      <div class="blocked-reason">${esc(reason)}</div>
    </div>`;

  // Metadata
  html += `<div class="section"><h3>Block Details</h3><dl class="detail-list">`;
  if (blockedBy) html += `<dt>Blocked By</dt><dd>${esc(blockedBy)}</dd>`;
  if (typedReason) html += `<dt>Recovery Type</dt><dd>${esc(typedReason)}</dd>`;
  if (owner) html += `<dt>Owner</dt><dd>${esc(owner)}</dd>`;
  if (turnId) html += `<dt>Turn</dt><dd class="mono">${esc(turnId)}</dd>`;
  if (blocked.phase) html += `<dt>Phase</dt><dd>${esc(blocked.phase)}</dd>`;
  if (blocked.hook) html += `<dt>Hook</dt><dd class="mono">${esc(blocked.hook)}</dd>`;
  if (detail) html += `<dt>Detail</dt><dd>${esc(detail)}</dd>`;
  if (turnRetained != null) html += `<dt>Turn Retained</dt><dd>${turnRetained ? 'yes' : 'no'}</dd>`;
  if (blockedAt) html += `<dt>Blocked At</dt><dd class="mono">${esc(blockedAt)}</dd>`;
  html += `</dl></div>`;

  // Recovery command
  if (recoveryAction) {
    html += `<div class="section"><h3>Recovery</h3>
      <p class="recovery-hint">Run this command to recover:</p>
      <pre class="recovery-command mono" data-copy="${esc(recoveryAction)}">${esc(recoveryAction)}</pre>
    </div>`;
  }

  if (runtimeGuidance.length > 0) {
    html += `<div class="section"><h3>Runtime Guidance</h3><div class="annotation-list">`;
    for (const entry of runtimeGuidance) {
      html += `<div class="annotation-card">
        <span class="mono">${esc(entry.code || '-')}</span>
        <span class="mono">${esc(entry.command || '-')}</span>
        <span>${esc(entry.reason || '-')}</span>
      </div>`;
    }
    html += `</div></div>`;
  }

  if (nextActions.length > 0) {
    html += `<div class="section"><h3>Next Actions</h3><div class="annotation-list">`;
    for (const action of nextActions) {
      html += `<div class="annotation-card">
        <span class="mono">${esc(action.command || '-')}</span>
        <span>${esc(action.reason || '-')}</span>
      </div>`;
    }
    html += `</div></div>`;
  }

  if (isCoordinator && coordinatorPendingGateDetails.length > 0) {
    html += `<div class="section"><h3>Pending Gate</h3>
      <dl class="detail-list">${renderDetailRows(coordinatorPendingGateDetails)}</dl>
    </div>`;
  }

  if (isCoordinator && coordinatorRepoRows.length > 0) {
    html += `<div class="section"><h3>Repo Status</h3><div class="annotation-list">`;
    for (const row of coordinatorRepoRows) {
      html += `<div class="annotation-card">
        <span class="mono">${esc(row.repo_id || '-')}</span>
        <span>${esc(`${row.status || 'unknown'}${row.phase ? ` [${row.phase}]` : ''}`)}</span>
        <span>${esc(formatCoordinatorRepoCardMeta(row))}</span>
      </div>`;
    }
    html += `</div></div>`;
  }

  if (relevantAudit.length > 0) {
    html += `<div class="section"><h3>Recent Audit Context</h3><div class="annotation-list">`;
    for (const entry of relevantAudit) {
      const duration = entry.duration_ms != null ? `${entry.duration_ms}ms` : '-';
      const verdict = entry.verdict || 'unknown';
      const action = entry.orchestrator_action || entry.action || 'continued';
      html += `<div class="annotation-card">
        <span class="mono">${esc(getHookPhase(entry) || '-')}</span>
        <span class="mono">${esc(getHookName(entry) || '-')}</span>
        <span>${esc(`${verdict} -> ${action} (${duration})`)}</span>
      </div>`;
    }
    html += `</div></div>`;
  }

  html += `</div>`;
  return html;
}
