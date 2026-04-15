/**
 * Timeline view — renders the governed run state + turn history.
 *
 * Pure render function: takes data, returns HTML string. Testable in Node.js.
 */

import { renderLiveStatus } from './live-status.js';

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

function formatDuration(ms) {
  if (ms == null || ms < 0 || !Number.isFinite(ms)) return null;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function computeElapsed(startedAt) {
  if (!startedAt) return null;
  try {
    const start = new Date(startedAt).getTime();
    if (Number.isNaN(start)) return null;
    return Math.max(0, Date.now() - start);
  } catch {
    return null;
  }
}

function formatTimestamp(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString();
  } catch {
    return null;
  }
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

function renderAuditSection(title, auditEntries) {
  if (auditEntries.length === 0) return '';
  let html = `<div class="turn-detail"><span class="detail-label">${esc(title)} (${auditEntries.length}):</span>
    <table class="data-table">
      <thead><tr><th>Phase</th><th>Hook</th><th>Verdict</th></tr></thead>
      <tbody>`;
  for (const entry of auditEntries) {
    const phase = entry.hook_phase || entry.phase || '';
    const hook = entry.hook_name || entry.hook || entry.name || '';
    html += `<tr>
      <td class="mono">${esc(phase)}</td>
      <td>${esc(hook)}</td>
      <td>${esc(entry.verdict || '')}</td>
    </tr>`;
  }
  html += `</tbody></table></div>`;
  return html;
}

function renderAnnotationSection(title, annotationEntries) {
  if (annotationEntries.length === 0) return '';
  let html = `<div class="turn-detail"><span class="detail-label">${esc(title)} (${annotationEntries.length}):</span><ul>`;
  for (const ann of annotationEntries) {
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
  return html;
}

function renderTurnDetailPanel(turnId, annotations, audit, coordinatorAnnotations, coordinatorAudit) {
  const turnAnnotations = Array.isArray(annotations)
    ? annotations.filter((a) => a.turn_id === turnId)
    : [];
  const turnAudit = Array.isArray(audit)
    ? audit.filter((a) => a.turn_id === turnId)
    : [];
  const turnCoordAnnotations = Array.isArray(coordinatorAnnotations)
    ? coordinatorAnnotations.filter((a) => a.turn_id === turnId)
    : [];
  const turnCoordAudit = Array.isArray(coordinatorAudit)
    ? coordinatorAudit.filter((a) => a.turn_id === turnId)
    : [];

  const hasRepo = turnAnnotations.length > 0 || turnAudit.length > 0;
  const hasCoord = turnCoordAnnotations.length > 0 || turnCoordAudit.length > 0;

  if (!hasRepo && !hasCoord) {
    return `<div class="turn-detail-panel"><p class="turn-detail">No hook evidence for this turn.</p></div>`;
  }

  const dual = hasRepo && hasCoord;
  let html = `<div class="turn-detail-panel">`;

  // Repo-local hook evidence
  html += renderAuditSection(dual ? 'Repo Hook Audit Log' : 'Hook Audit Log', turnAudit);
  html += renderAnnotationSection(dual ? 'Repo Hook Annotations' : 'Hook Annotations', turnAnnotations);

  // Coordinator hook evidence
  html += renderAuditSection(dual ? 'Coordinator Hook Audit Log' : 'Hook Audit Log', turnCoordAudit);
  html += renderAnnotationSection(dual ? 'Coordinator Hook Annotations' : 'Hook Annotations', turnCoordAnnotations);

  html += `</div>`;
  return html;
}

function renderDelegationIssued(entry) {
  const issued = Array.isArray(entry?.delegations_issued) ? entry.delegations_issued : [];
  if (issued.length === 0) return '';
  return `<div class="turn-detail"><span class="detail-label">Delegated:</span> ${issued.map((item) => `${esc(item.id)} → ${esc(item.to_role)}`).join(', ')}</div>`;
}

function renderDelegationContext(context) {
  if (!context) return '';
  return `<div class="turn-detail"><span class="detail-label">Delegation:</span> <span class="mono">${esc(context.delegation_id)}</span> from ${esc(context.parent_role || 'unknown')} — ${esc(context.charter || '(no charter)')}</div>`;
}

function renderDelegationReview(review) {
  if (!review) return '';
  const resultCount = Array.isArray(review.results) ? review.results.length : 0;
  return `<div class="turn-detail"><span class="detail-label">Delegation Review:</span> <span class="mono">${esc(review.parent_turn_id || 'unknown')}</span> with ${esc(resultCount)} result${resultCount === 1 ? '' : 's'}</div>`;
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

  if (continuity.drift_detected === true && Array.isArray(continuity.drift_warnings) && continuity.drift_warnings.length > 0) {
    html += `<div class="turn-detail risks"><span class="detail-label">Drift:</span><ul>`;
    for (const warning of continuity.drift_warnings) {
      html += `<li>${esc(warning)}</li>`;
    }
    html += `</ul></div>`;
  } else if (continuity.drift_detected === false) {
    html += `<div class="turn-detail"><span class="detail-label">Drift:</span> none detected since checkpoint</div>`;
  }

  if (continuity.recommended_command) {
    const detail = continuity.recommended_detail ? ` (${continuity.recommended_detail})` : '';
    html += `<div class="turn-detail"><span class="detail-label">Action:</span> <span class="mono">${esc(continuity.recommended_command)}</span>${esc(detail)}</div>`;
  }

  if (continuity.recovery_report_path) {
    html += `<div class="turn-detail"><span class="detail-label">Report:</span> <span class="mono">${esc(continuity.recovery_report_path)}</span></div>`;
  }

  html += `</div></div>`;
  return html;
}

function connectorBadge(state) {
  const colors = {
    healthy: 'var(--green)',
    failing: 'var(--red)',
    active: 'var(--yellow)',
    never_used: 'var(--text-dim)',
  };
  const color = colors[state] || 'var(--text-dim)';
  return `<span class="badge" style="color:${color};border-color:${color}">${esc(state || 'unknown')}</span>`;
}

function renderConnectorHealthPanel(connectorsPayload) {
  const connectors = Array.isArray(connectorsPayload?.connectors)
    ? connectorsPayload.connectors
    : [];
  if (connectors.length === 0) return '';

  let html = `<div class="section"><h3>Connector Health</h3><div class="turn-list">`;
  for (const connector of connectors) {
    html += `<div class="turn-card">
      <div class="turn-header">
        <span class="mono">${esc(connector.runtime_id)}</span>
        ${connectorBadge(connector.state)}
      </div>
      <div class="turn-detail"><span class="detail-label">Type:</span> ${esc(connector.type || 'unknown')}</div>
      <div class="turn-detail"><span class="detail-label">Target:</span> <span class="mono">${esc(connector.target || 'unknown')}</span></div>
      <div class="turn-detail"><span class="detail-label">Reachable:</span> ${esc(connector.reachable || 'unknown')}</div>`;

    if (Array.isArray(connector.active_turn_ids) && connector.active_turn_ids.length > 0) {
      html += `<div class="turn-detail"><span class="detail-label">Active turns:</span> <span class="mono">${esc(connector.active_turn_ids.join(', '))}</span></div>`;
    }

    if (connector.last_success_at) {
      html += `<div class="turn-detail"><span class="detail-label">Last success:</span> ${esc(connector.last_success_at)}</div>`;
    }
    if (connector.last_failure_at) {
      html += `<div class="turn-detail"><span class="detail-label">Last failure:</span> ${esc(connector.last_failure_at)}</div>`;
    }
    if (connector.last_error) {
      html += `<div class="turn-detail risks"><span class="detail-label">Last error:</span> ${esc(connector.last_error)}</div>`;
    }
    if (connector.attempts_made != null || connector.latency_ms != null) {
      const attempts = connector.attempts_made != null ? connector.attempts_made : 'n/a';
      const latency = connector.latency_ms != null ? `${connector.latency_ms}ms` : 'n/a';
      html += `<div class="turn-detail"><span class="detail-label">Attempt telemetry:</span> attempts ${esc(attempts)} / latency ${esc(latency)}</div>`;
    }

    html += `</div>`;
  }
  html += `</div></div>`;
  return html;
}

export { formatDuration, computeElapsed, formatTimestamp };

export function render({ state, continuity, history, annotations, audit, connectors, coordinatorAudit = null, coordinatorAnnotations = null, liveMeta = null }) {
  if (!state) {
    return `<div class="placeholder"><h2>No Run</h2><p>No governed run found. Start one with <code class="mono">agentxchain init --governed</code></p></div>`;
  }

  const turnCount = Array.isArray(history) ? history.length : 0;
  const activeTurns = state.active_turns ? Object.values(state.active_turns) : [];

  let html = `<div class="timeline-view">`;

  html += renderLiveStatus(liveMeta);

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
  html += renderConnectorHealthPanel(connectors);

  // Active turns
  if (activeTurns.length > 0) {
    html += `<div class="section"><h3>Active Turns</h3><div class="turn-list">`;
    for (const turn of activeTurns) {
      const elapsedMs = computeElapsed(turn.started_at);
      const elapsedStr = formatDuration(elapsedMs);
      html += `<div class="turn-card active">
        <div class="turn-header">
          ${roleBadge(getRole(turn))}
          <span class="mono">${esc(turn.turn_id)}</span>
          <span class="turn-status">${esc(turn.status || 'assigned')}</span>
          ${elapsedStr ? `<span class="turn-timing">Elapsed: ${esc(elapsedStr)}</span>` : ''}
        </div>
        ${renderDelegationContext(turn.delegation_context)}
        ${renderDelegationReview(turn.delegation_review)}
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

      const durationStr = formatDuration(entry.duration_ms);
      const acceptedStr = formatTimestamp(entry.accepted_at);
      html += `<div class="turn-card" data-turn-expand="${esc(entry.turn_id)}">
        <div class="turn-header">
          ${roleBadge(getRole(entry))}
          <span class="mono">${esc(entry.turn_id)}</span>
          ${durationStr ? `<span class="turn-timing">${esc(durationStr)}</span>` : ''}
          ${acceptedStr ? `<span class="turn-timestamp">${esc(acceptedStr)}</span>` : ''}
        </div>`;

      if (entry.summary) {
        html += `<div class="turn-summary">${esc(entry.summary)}</div>`;
      }

      html += renderDelegationIssued(entry);
      html += renderDelegationContext(entry.delegation_context);
      html += renderDelegationReview(entry.delegation_review);

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

      html += renderTurnDetailPanel(entry.turn_id, annotations, audit, coordinatorAnnotations, coordinatorAudit);

      html += `</div>`;
    }
    html += `</div></div>`;
  }

  html += `</div>`;
  return html;
}
