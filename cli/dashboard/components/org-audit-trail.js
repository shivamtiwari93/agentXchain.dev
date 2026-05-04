/**
 * Org Audit Trail component — renders unified governance audit trail timeline.
 *
 * Pure render function: takes data from /v1/org/audit-trail, returns HTML string.
 * Follows ledger.js and hooks.js patterns for filter bars and severity badges.
 */

function esc(str) {
  if (str == null) return '';
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

function severityBadge(severity) {
  switch (severity) {
    case 'high': return badge('HIGH', 'var(--red)');
    case 'medium': return badge('MED', 'var(--yellow)');
    case 'low': return badge('LOW', 'var(--text-dim)');
    default: return badge(severity || '?', 'var(--text-dim)');
  }
}

function sourceBadge(source) {
  switch (source) {
    case 'decision_ledger': return badge('ledger', 'var(--accent)');
    case 'hook_audit': return badge('hook', '#38bdf8');
    case 'events': return badge('event', 'var(--text-dim)');
    default: return badge(source || '?', 'var(--text-dim)');
  }
}

function formatTimestamp(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      + ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return esc(iso);
  }
}

function severityBorderColor(severity) {
  switch (severity) {
    case 'high': return 'var(--red)';
    case 'medium': return 'var(--yellow)';
    default: return 'var(--text-dim)';
  }
}

function renderFilterBar(events, filter) {
  const projectSet = new Set(events.map(e => e.project_name).filter(Boolean));
  const projectOptions = ['all', ...Array.from(projectSet).sort()];
  const severityOptions = ['all', 'high', 'medium', 'low'];
  const sourceOptions = ['all', 'decision_ledger', 'hook_audit', 'events'];

  function options(list, selected) {
    return list.map(v =>
      `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v)}</option>`
    ).join('');
  }

  return `<div class="filter-bar">
    <label class="filter-control">
      Project
      <select data-view-control="audit-trail-project">
        ${options(projectOptions, filter?.project || 'all')}
      </select>
    </label>
    <label class="filter-control">
      Severity
      <select data-view-control="audit-trail-severity">
        ${options(severityOptions, filter?.severity || 'all')}
      </select>
    </label>
    <label class="filter-control">
      Source
      <select data-view-control="audit-trail-source">
        ${options(sourceOptions, filter?.source || 'all')}
      </select>
    </label>
  </div>`;
}

function applyFilter(events, filter) {
  let filtered = events;
  if (filter?.project && filter.project !== 'all') {
    filtered = filtered.filter(e => e.project_name === filter.project);
  }
  if (filter?.severity && filter.severity !== 'all') {
    filtered = filtered.filter(e => e.severity === filter.severity);
  }
  if (filter?.source && filter.source !== 'all') {
    filtered = filtered.filter(e => e.source === filter.source);
  }
  return filtered;
}

function renderEventEntry(event) {
  const borderColor = severityBorderColor(event.severity);
  const contextParts = [];
  if (event.phase) contextParts.push(`Phase: ${esc(event.phase)}`);
  if (event.role) contextParts.push(`Role: ${esc(event.role)}`);
  if (event.run_id) contextParts.push(`Run: ${esc(event.run_id.length > 16 ? event.run_id.slice(0, 16) + '…' : event.run_id)}`);
  const contextLine = contextParts.length > 0
    ? `<div style="font-size:11px;color:var(--text-dim);margin-top:2px">${contextParts.join('  ')}</div>`
    : '';

  return `<div class="turn-card" style="border-left:3px solid ${borderColor};padding:10px 14px">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      ${severityBadge(event.severity)}
      ${badge(event.event_type, 'var(--text-dim)')}
      <span style="font-size:12px;color:var(--accent)">${esc(event.project_name)}</span>
      <span style="font-size:11px;color:var(--text-dim);margin-left:auto">${formatTimestamp(event.timestamp)}</span>
    </div>
    <div style="font-size:13px;color:var(--text);margin-top:4px">${esc(event.summary)}</div>
    ${contextLine}
  </div>`;
}

/**
 * @param {{ orgAuditTrail: { data: object[], total: number }, liveMeta: object, filter?: object }} data
 * @returns {string} HTML string
 */
export function render(data) {
  const auditData = data?.orgAuditTrail;
  const events = auditData?.data || [];
  const total = auditData?.total ?? events.length;
  const filter = data?.filter || {};

  if (!events.length && !filter.project && !filter.severity && !filter.source) {
    return `<div class="placeholder">
      <h2>Governance Audit Trail</h2>
      <p>No governance events found across registered projects. Events appear when policy violations, hook blocks, escalations, or gate transitions occur.</p>
    </div>`;
  }

  const filtered = applyFilter(events, filter);

  let html = `<div class="section">`;
  html += `<h3>Governance Audit Trail (${total} events)</h3>`;
  html += renderFilterBar(events, filter);
  html += `<div class="turn-list">`;
  for (const event of filtered) {
    html += renderEventEntry(event);
  }
  if (filtered.length === 0) {
    html += `<div style="text-align:center;color:var(--text-dim);padding:20px">No events match filters</div>`;
  }
  html += `</div>`;
  html += `</div>`;
  return html;
}
