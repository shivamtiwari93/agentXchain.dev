/**
 * Timeline view — renders the governed run state + turn history.
 *
 * Pure render function: takes data, returns HTML string. Testable in Node.js.
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

function getRole(entry) {
  return entry?.assigned_role || entry?.role || entry?.agent || 'unknown';
}

function getFiles(entry) {
  if (Array.isArray(entry?.observed_artifact?.files_changed) && entry.observed_artifact.files_changed.length > 0) {
    return entry.observed_artifact.files_changed;
  }
  return Array.isArray(entry?.files_changed) ? entry.files_changed : [];
}

function formatItem(item, type) {
  if (typeof item === 'string') {
    return item;
  }
  if (!item || typeof item !== 'object') {
    return '';
  }

  if (type === 'decision') {
    const label = item.id ? `${item.id}: ` : '';
    return `${label}${item.statement || item.summary || ''}`.trim();
  }

  if (type === 'objection') {
    const prefix = item.id ? `${item.id}` : 'Objection';
    const severity = item.severity ? ` (${item.severity})` : '';
    return `${prefix}${severity}: ${item.statement || item.summary || ''}`.trim();
  }

  return item.statement || item.summary || item.detail || '';
}

function renderList(items, type) {
  return items
    .map((item) => formatItem(item, type))
    .filter(Boolean)
    .map((item) => `<li>${esc(item)}</li>`)
    .join('');
}

function statusBadge(status) {
  const colors = {
    running: 'var(--green)',
    assigned: 'var(--green)',
    retrying: 'var(--yellow)',
    conflicted: 'var(--red)',
    paused: 'var(--yellow)',
    blocked: 'var(--red)',
    completed: 'var(--accent)',
    idle: 'var(--text-dim)',
  };
  const color = colors[status] || 'var(--text-dim)';
  return `<span class="badge" style="color:${color};border-color:${color}">${esc(status)}</span>`;
}

function roleBadge(role) {
  const colors = {
    pm: '#a78bfa',
    dev: '#38bdf8',
    qa: '#f472b6',
    'eng-director': '#fb923c',
  };
  const color = colors[role] || 'var(--text-dim)';
  return `<span class="badge" style="color:${color};border-color:${color}">${esc(role)}</span>`;
}

function renderTurnDetailPanel(turnId, annotations, audit) {
  const turnAnnotations = Array.isArray(annotations)
    ? annotations.filter((a) => a.turn_id === turnId)
    : [];
  const turnAudit = Array.isArray(audit)
    ? audit.filter((a) => a.turn_id === turnId)
    : [];

  if (turnAnnotations.length === 0 && turnAudit.length === 0) {
    return `<div class="turn-detail-panel"><p class="turn-detail">No hook evidence for this turn.</p></div>`;
  }

  let html = `<div class="turn-detail-panel">`;

  if (turnAudit.length > 0) {
    html += `<div class="turn-detail"><span class="detail-label">Hook Audit (${turnAudit.length}):</span>
      <table class="data-table">
        <thead><tr><th>Phase</th><th>Hook</th><th>Verdict</th></tr></thead>
        <tbody>`;
    for (const entry of turnAudit) {
      const phase = entry.hook_phase || entry.phase || '';
      const hook = entry.hook_name || entry.hook || entry.name || '';
      html += `<tr>
        <td class="mono">${esc(phase)}</td>
        <td>${esc(hook)}</td>
        <td>${esc(entry.verdict || '')}</td>
      </tr>`;
    }
    html += `</tbody></table></div>`;
  }

  if (turnAnnotations.length > 0) {
    html += `<div class="turn-detail"><span class="detail-label">Annotations (${turnAnnotations.length}):</span><ul>`;
    for (const ann of turnAnnotations) {
      const hookName = ann.hook_name || ann.hook || ann.name || '';
      if (Array.isArray(ann.annotations)) {
        for (const a of ann.annotations) {
          html += `<li>${esc(hookName)}: ${esc(a.key || '')} = ${esc(a.value || '')}</li>`;
        }
      } else {
        const text = ann.annotation || ann.message || '';
        html += `<li>${esc(hookName)}: ${esc(text)}</li>`;
      }
    }
    html += `</ul></div>`;
  }

  html += `</div>`;
  return html;
}

function renderContinuityPanel(continuity) {
  if (!continuity) return '';

  const checkpoint = continuity.checkpoint;
  const checkpointSummary = checkpoint?.last_checkpoint_at
    ? `${checkpoint.checkpoint_reason || 'unknown'} at ${checkpoint.last_checkpoint_at}`
    : (checkpoint?.checkpoint_reason || 'No session checkpoint recorded');

  let html = `<div class="section continuity-section"><h3>Continuity</h3><div class="turn-card">`;

  if (checkpoint) {
    html += `<div class="turn-detail"><span class="detail-label">Session:</span> <span class="mono">${esc(checkpoint.session_id || 'unknown')}</span></div>`;
    html += `<div class="turn-detail"><span class="detail-label">Checkpoint:</span> ${esc(checkpointSummary)}</div>`;
    html += `<div class="turn-detail"><span class="detail-label">Last turn:</span> <span class="mono">${esc(checkpoint.last_turn_id || 'none')}</span></div>`;
    html += `<div class="turn-detail"><span class="detail-label">Last role:</span> ${esc(checkpoint.last_role || 'unknown')}</div>`;
    if (continuity.stale_checkpoint) {
      html += `<div class="turn-detail risks"><span class="detail-label">Warning:</span> checkpoint tracks <span class="mono">${esc(checkpoint.run_id || 'unknown')}</span>, but state.json remains source of truth.</div>`;
    }
  } else {
    html += `<div class="turn-detail"><span class="detail-label">Checkpoint:</span> No session checkpoint recorded</div>`;
  }

  if (continuity.restart_recommended) {
    html += `<div class="turn-detail"><span class="detail-label">Restart:</span> <span class="mono">agentxchain restart</span></div>`;
  }

  if (continuity.recovery_report_path) {
    html += `<div class="turn-detail"><span class="detail-label">Report:</span> <span class="mono">${esc(continuity.recovery_report_path)}</span></div>`;
  }

  html += `</div></div>`;
  return html;
}

export function render({ state, continuity, history, annotations, audit }) {
  if (!state) {
    return `<div class="placeholder"><h2>No Run</h2><p>No governed run found. Start one with <code class="mono">agentxchain init --governed</code></p></div>`;
  }

  const turnCount = Array.isArray(history) ? history.length : 0;
  const activeTurns = state.active_turns ? Object.values(state.active_turns) : [];

  let html = `<div class="timeline-view">`;

  // Run header
  html += `<div class="run-header">
    <div class="run-meta">
      <span class="mono run-id">${esc(state.run_id)}</span>
      ${statusBadge(state.status)}
      <span class="phase-label">Phase: <strong>${esc(state.phase)}</strong></span>
      <span class="turn-count">${turnCount} turn${turnCount !== 1 ? 's' : ''} completed</span>
    </div>
  </div>`;

  html += renderContinuityPanel(continuity);

  // Active turns
  if (activeTurns.length > 0) {
    html += `<div class="section"><h3>Active Turns</h3><div class="turn-list">`;
    for (const turn of activeTurns) {
      html += `<div class="turn-card active">
        <div class="turn-header">
          ${roleBadge(getRole(turn))}
          <span class="mono">${esc(turn.turn_id)}</span>
          <span class="turn-status">${esc(turn.status || 'assigned')}</span>
        </div>
      </div>`;
    }
    html += `</div></div>`;
  }

  // Completed turns (from history, newest first)
  if (turnCount > 0) {
    html += `<div class="section"><h3>Turn History</h3><div class="turn-list">`;
    const reversed = [...history].reverse();
    for (const entry of reversed) {
      const files = getFiles(entry);
      const decisions = Array.isArray(entry.decisions) ? entry.decisions : [];
      const objections = Array.isArray(entry.objections) ? entry.objections : [];
      const risks = Array.isArray(entry.risks) ? entry.risks : [];
      const verificationSummary = entry.normalized_verification?.evidence_summary
        || entry.verification?.evidence_summary
        || null;

      html += `<div class="turn-card" data-turn-expand="${esc(entry.turn_id)}">
        <div class="turn-header">
          ${roleBadge(getRole(entry))}
          <span class="mono">${esc(entry.turn_id)}</span>
        </div>`;

      if (entry.summary) {
        html += `<div class="turn-summary">${esc(entry.summary)}</div>`;
      }

      if (files.length > 0) {
        html += `<div class="turn-detail"><span class="detail-label">Files:</span> <span class="mono">${files.map(f => esc(f)).join(', ')}</span></div>`;
      }

      if (decisions.length > 0) {
        html += `<div class="turn-detail"><span class="detail-label">Decisions:</span><ul>${renderList(decisions, 'decision')}</ul></div>`;
      }

      if (objections.length > 0) {
        html += `<div class="turn-detail objections"><span class="detail-label">Objections:</span><ul>${renderList(objections, 'objection')}</ul></div>`;
      }

      if (risks.length > 0) {
        html += `<div class="turn-detail risks"><span class="detail-label">Risks:</span><ul>${renderList(risks, 'risk')}</ul></div>`;
      }

      if (verificationSummary) {
        html += `<div class="turn-detail"><span class="detail-label">Verification:</span> ${esc(verificationSummary)}</div>`;
      }

      html += renderTurnDetailPanel(entry.turn_id, annotations, audit);

      html += `</div>`;
    }
    html += `</div></div>`;
  }

  html += `</div>`;
  return html;
}
