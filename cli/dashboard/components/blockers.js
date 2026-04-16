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

import {
  getCoordinatorAttentionStatusCard,
  getCoordinatorBlockerDetails,
} from '../../src/lib/coordinator-blocker-presentation.js';
import { buildCoordinatorGateEvaluationPresentation } from '../../src/lib/coordinator-gate-evaluation-presentation.js';
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
  const evaluationPresentation = active.pending === true
    ? null
    : buildCoordinatorGateEvaluationPresentation({
        gateType: active.gate_type,
        evaluation: active,
        includeReady: true,
        includeBlockerCount: false,
      });
  let html = `<div class="gate-card">
    <h3>Active Gate</h3>
    <dl class="detail-list">`;
  if (pendingGateDetails.length > 0) {
    html += renderDetailRows(pendingGateDetails);
  } else {
    html += `<dt>Type</dt><dd>${esc(active.gate_type)}</dd>`;
    html += renderDetailRows(evaluationPresentation?.details || []);
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
  const statusCard = getCoordinatorAttentionStatusCard(data);

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
  if (!hasBlockers && statusCard) {
    html += `<div class="gate-card"><h3>${esc(statusCard.title)}</h3>
      <p class="turn-summary">${esc(statusCard.message)}</p></div>`;
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
      const phasePresentation = buildCoordinatorGateEvaluationPresentation({
        gateType: 'phase_transition',
        evaluation: phase_transition,
      });
      html += `<div class="turn-card" data-turn-expand>
        <div class="turn-header">
          <span>${esc(phasePresentation.title)}</span>
          ${badge(phasePresentation.statusLabel, phase_transition.ready ? 'var(--green)' : 'var(--yellow)')}
        </div>
        <div class="turn-detail-panel">
          <dl class="detail-list">${renderDetailRows(phasePresentation.details)}</dl>`;
      if (phasePresentation.blockers.length > 0) {
        html += `<div class="annotation-list" style="margin-top:8px">`;
        for (const b of phasePresentation.blockers) {
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
      const completionPresentation = buildCoordinatorGateEvaluationPresentation({
        gateType: 'run_completion',
        evaluation: run_completion,
      });
      html += `<div class="turn-card" data-turn-expand>
        <div class="turn-header">
          <span>${esc(completionPresentation.title)}</span>
          ${badge(completionPresentation.statusLabel, run_completion.ready ? 'var(--green)' : 'var(--yellow)')}
        </div>
        <div class="turn-detail-panel">
          <dl class="detail-list">${renderDetailRows(completionPresentation.details)}</dl>`;
      if (completionPresentation.blockers.length > 0) {
        html += `<div class="annotation-list" style="margin-top:8px">`;
        for (const b of completionPresentation.blockers) {
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
