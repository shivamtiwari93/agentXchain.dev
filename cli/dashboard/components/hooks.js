/**
 * Hook Audit view — renders hook-audit.jsonl entries.
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

function getHookPhase(entry) {
  return entry?.hook_phase || entry?.phase || '';
}

function getHookName(entry) {
  return entry?.hook_name || entry?.hook || entry?.name || '';
}

function formatAnnotations(entry) {
  if (Array.isArray(entry?.annotations) && entry.annotations.length > 0) {
    return entry.annotations
      .map((annotation) => annotation && typeof annotation === 'object'
        ? `${annotation.key}: ${annotation.value}`
        : null)
      .filter(Boolean)
      .join(', ');
  }

  return entry?.annotation || entry?.message || '';
}

function verdictBadge(verdict) {
  const colors = {
    allow: 'var(--green)',
    warn: 'var(--yellow)',
    block: 'var(--red)',
  };
  const color = colors[verdict] || 'var(--text-dim)';
  return `<span class="badge" style="color:${color};border-color:${color}">${esc(verdict)}</span>`;
}

export function render({ audit, annotations }) {
  const hasAudit = Array.isArray(audit) && audit.length > 0;
  const hasAnnotations = Array.isArray(annotations) && annotations.length > 0;

  if (!hasAudit && !hasAnnotations) {
    return `<div class="placeholder"><h2>Hook Audit</h2><p>No hook activity recorded.</p></div>`;
  }

  let html = `<div class="hooks-view">`;

  if (hasAudit) {
    html += `<div class="section"><h3>Hook Audit Log</h3>
      <p class="section-subtitle">${audit.length} hook execution${audit.length !== 1 ? 's' : ''}</p>
      <table class="data-table">
        <thead><tr><th>Time</th><th>Phase</th><th>Hook</th><th>Verdict</th><th>Action</th><th>Duration</th></tr></thead>
        <tbody>`;

    for (const entry of audit) {
      const duration = entry.duration_ms != null ? `${entry.duration_ms}ms` : '-';
      const action = entry.orchestrator_action || entry.action || 'continued';
      html += `<tr>
        <td class="mono">${esc(entry.timestamp || '-')}</td>
        <td class="mono">${esc(getHookPhase(entry))}</td>
        <td>${esc(getHookName(entry))}</td>
        <td>${verdictBadge(entry.verdict)}</td>
        <td class="mono">${esc(action)}</td>
        <td class="mono">${esc(duration)}</td>
      </tr>`;
    }

    html += `</tbody></table></div>`;
  }

  if (hasAnnotations) {
    html += `<div class="section"><h3>Hook Annotations</h3>
      <p class="section-subtitle">${annotations.length} annotation${annotations.length !== 1 ? 's' : ''}</p>
      <div class="annotation-list">`;

    for (const entry of annotations) {
      const annotationText = formatAnnotations(entry);
      html += `<div class="annotation-card">
        <span class="mono">${esc(entry.turn_id || '-')}</span>
        <span class="mono">${esc(getHookName(entry))}</span>
        <span>${esc(annotationText || JSON.stringify(entry))}</span>
      </div>`;
    }

    html += `</div></div>`;
  }

  html += `</div>`;
  return html;
}
