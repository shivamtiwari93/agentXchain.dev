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

function classify(record) {
  if (Array.isArray(record?.errors) && record.errors.length > 0) return 'error';
  if (record?.deduplicated === true) return 'deduplicated';
  if (record?.route?.started === true) return 'started';
  if (record?.route?.planned === true) return 'planned';
  if (record?.route?.approved === true) return 'approved';
  if (record?.route?.triaged === true) return 'triaged';
  if (record?.route?.matched === false) return 'unrouted';
  return 'detected';
}

function statusBadge(record) {
  const status = classify(record);
  const colors = {
    error: 'var(--red)',
    deduplicated: 'var(--yellow)',
    started: 'var(--green)',
    planned: 'var(--accent)',
    approved: 'var(--accent)',
    triaged: 'var(--text)',
    unrouted: 'var(--text-dim)',
    detected: 'var(--text-dim)',
  };
  return badge(status, colors[status] || 'var(--text-dim)');
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function renderResultRow(record) {
  const payload = record.payload || {};
  const route = record.route || {};
  const errors = Array.isArray(record.errors) ? record.errors : [];
  const routeDetail = route.matched === false
    ? 'No route'
    : [
        route.run_id ? `run ${route.run_id}` : null,
        route.role ? `role ${route.role}` : null,
        route.preferred_role ? `hint ${route.preferred_role}` : null,
      ].filter(Boolean).join(' · ') || 'Route matched';

  return `<tr${errors.length > 0 ? ' style="border-left:3px solid var(--red)"' : ''}>
    <td>
      <div class="mono">${esc(record.result_id || '—')}</div>
      <div class="turn-status">${esc(formatTime(record.timestamp))}</div>
    </td>
    <td>${statusBadge(record)}</td>
    <td>
      <div class="mono">${esc(payload.category || 'unknown')}</div>
      <div class="turn-status">${esc(payload.repo || '—')}${payload.ref ? ` · ${esc(payload.ref)}` : ''}</div>
    </td>
    <td>
      <div>${esc(routeDetail)}</div>
      <div class="turn-status">Intent ${esc(record.intent_id || '—')} · Event ${esc(record.event_id || '—')}</div>
    </td>
    <td class="mono">${esc(record.delivery_id || '—')}</td>
    <td>${errors.length > 0 ? esc(errors.join(' | ')) : '—'}</td>
  </tr>`;
}

export function render({ watchResults }) {
  if (!watchResults) {
    return `<div class="placeholder"><h2>Watch</h2><p>No watch result data available.</p></div>`;
  }

  if (watchResults.ok === false) {
    return `<div class="placeholder"><h2>Watch</h2><p>${esc(watchResults.error || 'Failed to load watch results.')}</p></div>`;
  }

  const recent = Array.isArray(watchResults.recent) ? watchResults.recent : [];
  const summary = watchResults.summary || {};
  const byStatus = summary.by_status || {};

  if ((watchResults.total || 0) === 0 && (watchResults.corrupt || 0) === 0) {
    return `<div class="placeholder"><h2>Watch</h2><p>No watch intake results yet. Use <code>agentxchain watch --listen</code>, <code>--event-file</code>, or <code>--event-dir</code> to ingest events.</p></div>`;
  }

  let html = `<div class="watch-view"><div class="run-header"><div class="run-meta">`;
  html += badge(`${watchResults.total || 0} results`, 'var(--accent)');
  html += badge(`${summary.routed || 0} routed`, 'var(--green)');
  html += badge(`${summary.unrouted || 0} unrouted`, summary.unrouted ? 'var(--yellow)' : 'var(--text-dim)');
  html += badge(`${summary.deduplicated || 0} deduped`, summary.deduplicated ? 'var(--yellow)' : 'var(--text-dim)');
  html += badge(`${summary.errored || 0} errors`, summary.errored ? 'var(--red)' : 'var(--text-dim)');
  if (watchResults.corrupt) html += badge(`${watchResults.corrupt} corrupt`, 'var(--red)');
  html += `</div></div>`;

  html += `<div class="section"><h3>Intake Summary</h3>
    <p class="section-subtitle">Last result: ${esc(formatTime(summary.last_timestamp))}</p>
    <table class="data-table">
      <thead><tr><th>Status</th><th>Count</th></tr></thead>
      <tbody>${Object.keys(byStatus).sort().map((status) => `<tr><td>${esc(status)}</td><td>${esc(byStatus[status])}</td></tr>`).join('')}</tbody>
    </table>
  </div>`;

  html += `<div class="section"><h3>Recent Watch Results</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>Result</th>
          <th>Status</th>
          <th>Payload</th>
          <th>Route</th>
          <th>Delivery</th>
          <th>Errors</th>
        </tr>
      </thead>
      <tbody>${recent.map(renderResultRow).join('')}</tbody>
    </table>
  </div>`;

  html += `</div>`;
  return html;
}
