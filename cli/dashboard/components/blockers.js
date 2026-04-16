/**
 * Coordinator Blockers view — renders computed coordinator gate blockers.
 *
 * Pure render function: takes data from /api/coordinator/blockers, returns HTML.
 * All blocker semantics are server-side (coordinator-blockers.js). This view
 * renders the snapshot without reimplementing gate logic.
 *
 * Per DEC-DASH-COORD-BLOCKERS-002: blocker evaluation must come from the same
 * server-side gate evaluators used by `multi step` and `multi approve-gate`.
 */

import { getCoordinatorBlockerDetails } from '../../src/lib/coordinator-blocker-presentation.js';
import { getCoordinatorPendingGateDetails } from '../../src/lib/coordinator-pending-gate-presentation.js';

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function badge(label, color = 'var(--text-dim)') {
  return `<span class="badge" style="color:${color};border-color:${color}">${esc(label)}</span>`;
}

function modeColor(mode) {
  const colors = {
    pending_gate: 'var(--yellow)',
    phase_transition: 'var(--accent)',
    run_completion: 'var(--green)',
  };
  return colors[mode] || 'var(--text-dim)';
}

function blockerColor(code) {
  if (code === 'repo_run_id_mismatch') return 'var(--red)';
  if (code === 'no_next_phase') return 'var(--text-dim)';
  return 'var(--yellow)';
}

function renderBlockerRow(blocker) {
  const code = blocker.code || 'unknown';
  const color = blockerColor(code);
  const details = getCoordinatorBlockerDetails(blocker);
  let html = `<div class="turn-card" style="border-left: 3px solid ${color}">
    <div class="turn-header">
      ${badge(code, color)}
    </div>`;

  if (blocker.message) {
    html += `<div class="turn-summary">${esc(blocker.message)}</div>`;
  }

  if (details.length > 0) {
    html += `<dl class="detail-list">`;
    for (const detail of details) {
      html += `<dt>${esc(detail.label)}</dt><dd${detail.mono ? ' class="mono"' : ''}>${esc(detail.value)}</dd>`;
    }
    html += `</dl>`;
  }

  html += `</div>`;
  return html;
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

function renderActiveGate(active, coordinatorBlockers = null) {
  if (!active) return '';

  const pendingGateDetails = active.pending === true
    ? getCoordinatorPendingGateDetails({
        pendingGate: coordinatorBlockers?.pending_gate,
        active,
      })
    : [];
  let html = `<div class="gate-card">
    <h3>Active Gate</h3>
    <dl class="detail-list">`;
  if (pendingGateDetails.length > 0) {
    html += renderDetailRows(pendingGateDetails);
  } else {
    html += `<dt>Type</dt><dd>${esc(active.gate_type)}</dd>`;
    if (active.gate_id) {
      html += `<dt>Gate</dt><dd class="mono">${esc(active.gate_id)}</dd>`;
    }
    if (active.current_phase) {
      html += `<dt>Current Phase</dt><dd>${esc(active.current_phase)}</dd>`;
    }
    if (active.target_phase) {
      html += `<dt>Target Phase</dt><dd>${esc(active.target_phase)}</dd>`;
    }
    if (Array.isArray(active.required_repos) && active.required_repos.length > 0) {
      html += `<dt>Required Repos</dt><dd>${esc(active.required_repos.join(', '))}</dd>`;
    }
    if (Array.isArray(active.human_barriers) && active.human_barriers.length > 0) {
      html += `<dt>Human Barriers</dt><dd>${esc(active.human_barriers.join(', '))}</dd>`;
    }
  }
  if (typeof active.ready === 'boolean') {
    html += `<dt>Ready</dt><dd>${active.ready ? 'Yes' : 'No'}</dd>`;
  }

  html += `</dl>`;

  if (Array.isArray(active.blockers) && active.blockers.length > 0) {
    html += `<div class="section" style="margin-top:12px"><h3>Blockers (${active.blockers.length})</h3>
      <div class="turn-list">`;
    for (const blocker of active.blockers) {
      html += renderBlockerRow(blocker);
    }
    html += `</div></div>`;
  }

  html += `</div>`;
  return html;
}

function renderRecoveryCommand(data) {
  const nextActions = Array.isArray(data.next_actions) ? data.next_actions : [];
  if (nextActions.length === 0) {
    return '';
  }

  let html = `<div class="section"><h3>Next Actions</h3><ol class="action-list">`;
  for (const action of nextActions) {
    html += `<li class="turn-card">
      <div class="turn-header">
        <span class="mono">${esc(action.command || 'n/a')}</span>
      </div>`;
    if (action.reason) {
      html += `<div class="turn-summary">${esc(action.reason)}</div>`;
    }
    if (action.command) {
      html += `<pre class="recovery-command mono" data-copy="${esc(action.command)}">${esc(action.command)}</pre>`;
    }
    html += `</li>`;
  }
  html += `</ol></div>`;
  return html;
}

export function render({ coordinatorBlockers }) {
  if (!coordinatorBlockers) {
    return `<div class="placeholder"><h2>Coordinator Blockers</h2><p>No coordinator blocker data available. Ensure a coordinator run is active.</p></div>`;
  }

  if (coordinatorBlockers.ok === false) {
    return `<div class="placeholder"><h2>Coordinator Blockers</h2><p>${esc(coordinatorBlockers.error || 'Failed to load coordinator blockers.')}</p></div>`;
  }

  const data = coordinatorBlockers;
  const blockers = data.active?.blockers || [];
  const hasBlockers = blockers.length > 0 && !blockers.every(b => b.code === 'no_next_phase');

  let html = `<div class="blockers-view">`;

  // Header
  html += `<div class="run-header">
    <div class="run-meta">`;
  if (data.super_run_id) {
    html += `<span class="mono run-id">${esc(data.super_run_id)}</span>`;
  }
  if (data.status) {
    const statusColors = { active: 'var(--green)', blocked: 'var(--red)', completed: 'var(--accent)', paused: 'var(--yellow)' };
    html += badge(data.status, statusColors[data.status] || 'var(--text-dim)');
  }
  html += `${badge(data.mode, modeColor(data.mode))}`;
  if (data.phase) {
    html += `<span class="phase-label">Phase: <strong>${esc(data.phase)}</strong></span>`;
  }
  html += `</div></div>`;

  // Blocked reason
  if (data.blocked_reason) {
    html += `<div class="blocked-banner">
      <div class="blocked-icon">BLOCKED</div>
      <div class="blocked-reason">${esc(
        typeof data.blocked_reason === 'string'
          ? data.blocked_reason
          : JSON.stringify(data.blocked_reason)
      )}</div>
    </div>`;
  }

  // Status summary
  if (!hasBlockers && data.mode === 'pending_gate') {
    html += `<div class="gate-card"><h3>Awaiting Approval</h3>
      <p class="turn-summary">All prerequisites are satisfied. The coordinator is waiting for human gate approval.</p></div>`;
  } else if (!hasBlockers) {
    html += `<div class="gate-card"><h3>No Blockers</h3>
      <p class="turn-summary">The coordinator gate has no outstanding blockers.</p></div>`;
  }

  // Active gate detail
  html += renderActiveGate(data.active, data);

  // Recovery
  html += renderRecoveryCommand(data);

  // Evaluations summary (collapsed detail for deeper inspection)
  if (data.evaluations) {
    html += `<div class="section"><h3>Gate Evaluations</h3>`;
    const { phase_transition, run_completion } = data.evaluations;

    if (phase_transition) {
      html += `<div class="turn-card" data-turn-expand>
        <div class="turn-header">
          <span>Phase Transition</span>
          ${badge(phase_transition.ready ? 'ready' : 'not ready', phase_transition.ready ? 'var(--green)' : 'var(--yellow)')}
        </div>
        <div class="turn-detail-panel">
          <dl class="detail-list">`;
      if (phase_transition.current_phase) html += `<dt>Current</dt><dd>${esc(phase_transition.current_phase)}</dd>`;
      if (phase_transition.target_phase) html += `<dt>Target</dt><dd>${esc(phase_transition.target_phase)}</dd>`;
      if (phase_transition.gate_id) html += `<dt>Gate</dt><dd class="mono">${esc(phase_transition.gate_id)}</dd>`;
      html += `<dt>Blockers</dt><dd>${phase_transition.blockers?.length || 0}</dd>`;
      html += `</dl>`;
      if (phase_transition.blockers?.length > 0) {
        html += `<div class="annotation-list" style="margin-top:8px">`;
        for (const b of phase_transition.blockers) {
          html += `<div class="annotation-card">
            <span class="mono">${esc(b.code || 'unknown')}</span>
            <span>${esc(b.message || '')}</span>
          </div>`;
        }
        html += `</div>`;
      }
      html += `</div></div>`;
    }

    if (run_completion) {
      html += `<div class="turn-card" data-turn-expand>
        <div class="turn-header">
          <span>Run Completion</span>
          ${badge(run_completion.ready ? 'ready' : 'not ready', run_completion.ready ? 'var(--green)' : 'var(--yellow)')}
        </div>
        <div class="turn-detail-panel">
          <dl class="detail-list">`;
      if (run_completion.gate_id) html += `<dt>Gate</dt><dd class="mono">${esc(run_completion.gate_id)}</dd>`;
      html += `<dt>Blockers</dt><dd>${run_completion.blockers?.length || 0}</dd>`;
      if (typeof run_completion.requires_human_approval === 'boolean') {
        html += `<dt>Human Approval</dt><dd>${run_completion.requires_human_approval ? 'Required' : 'Not required'}</dd>`;
      }
      html += `</dl>`;
      if (run_completion.blockers?.length > 0) {
        html += `<div class="annotation-list" style="margin-top:8px">`;
        for (const b of run_completion.blockers) {
          html += `<div class="annotation-card">
            <span class="mono">${esc(b.code || 'unknown')}</span>
            <span>${esc(b.message || '')}</span>
          </div>`;
        }
        html += `</div>`;
      }
      html += `</div></div>`;
    }

    html += `</div>`;
  }

  html += `</div>`;
  return html;
}
