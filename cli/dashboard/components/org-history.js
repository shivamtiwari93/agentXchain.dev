/**
 * Org Run History component — renders full-fidelity cross-project run history.
 *
 * Pure render function: takes data from /v1/org/history, returns HTML string.
 * Follows run-history.js patterns for badges, duration, cost formatting.
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

function statusBadge(status) {
  switch (status) {
    case 'completed': return badge('completed', 'var(--green)');
    case 'blocked': return badge('blocked', 'var(--yellow)');
    case 'failed': return badge('failed', 'var(--red)');
    default: return badge(status || 'unknown', 'var(--text-dim)');
  }
}

function formatDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function formatCost(usd) {
  if (usd == null) return '—';
  return `$${Number(usd).toFixed(2)}`;
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return esc(iso);
  }
}

function truncateId(id, len = 16) {
  if (!id) return '—';
  return id.length > len ? id.slice(0, len) + '…' : id;
}

function renderGateResults(gateResults) {
  if (!gateResults || typeof gateResults !== 'object') return '';
  const entries = Object.entries(gateResults);
  if (entries.length === 0) return '';
  return entries.map(([gate, status]) => {
    const icon = status === 'passed' ? '✓' : 'pending';
    const color = status === 'passed' ? 'var(--green)' : 'var(--text-dim)';
    return `<span style="color:${color};margin-right:8px">${esc(gate)} ${icon}</span>`;
  }).join('');
}

function renderRunCard(entry) {
  const phases = Array.isArray(entry.phases_completed) && entry.phases_completed.length > 0
    ? entry.phases_completed.map(p => esc(p)).join(' → ')
    : '—';

  const headline = entry.retrospective?.headline
    ? `<div style="font-style:italic;color:var(--text-dim);margin-top:4px;font-size:12px">"${esc(entry.retrospective.headline)}"</div>`
    : '';

  const gates = renderGateResults(entry.gate_results);
  const gatesRow = gates
    ? `<div style="margin-top:4px;font-size:12px">Gates: ${gates}</div>`
    : '';

  const borderColor = entry.status === 'blocked' ? 'var(--yellow)' : entry.status === 'completed' ? 'var(--border)' : 'var(--border)';

  return `<div class="turn-card" style="border-left:3px solid ${borderColor}">
    <div class="turn-header">
      <span class="mono" style="font-size:12px;color:var(--text-dim)" title="${esc(entry.run_id)}">${esc(truncateId(entry.run_id))}</span>
      <span style="color:var(--accent);font-size:12px">${esc(entry.project_name)}</span>
      ${statusBadge(entry.status)}
      <span style="font-size:12px;color:var(--text-dim)">${formatDuration(entry.duration_ms)}</span>
      <span style="font-size:12px;color:var(--text-dim)">${formatCost(entry.total_cost_usd)}</span>
    </div>
    <div style="font-size:12px;color:var(--text-dim);margin-top:4px">Phases: ${phases}</div>
    ${headline}
    ${gatesRow}
  </div>`;
}

/**
 * @param {{ orgHistory: { data: object[], total: number }, liveMeta: object }} data
 * @returns {string} HTML string
 */
export function render(data) {
  const historyData = data?.orgHistory;
  const records = historyData?.data || [];
  const total = historyData?.total ?? records.length;

  if (!records.length) {
    return `<div class="placeholder">
      <h2>Org Run History</h2>
      <p>No cross-project run history available. Complete governed runs to see full-fidelity history.</p>
    </div>`;
  }

  const completed = records.filter(r => r.status === 'completed').length;
  const blocked = records.filter(r => r.status === 'blocked').length;

  let html = `<div class="section">`;
  html += `<h3>Org Run History</h3>`;
  html += `<div class="run-header"><div class="run-meta">`;
  html += `<span class="turn-count">Total: ${total} run${total !== 1 ? 's' : ''}</span>`;
  if (completed > 0) html += badge(`${completed} completed`, 'var(--green)');
  if (blocked > 0) html += badge(`${blocked} blocked`, 'var(--yellow)');
  html += `</div></div>`;

  html += `<div class="turn-list">`;
  for (const entry of records) {
    html += renderRunCard(entry);
  }
  html += `</div>`;
  html += `</div>`;
  return html;
}
