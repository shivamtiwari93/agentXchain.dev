/**
 * Run History view — renders cross-run history from /api/run-history.
 *
 * Pure render function: takes data from the bridge server, returns HTML.
 * No business logic — just table rendering with status-colored rows.
 *
 * See: RUN_HISTORY_TERMINAL_RECORDING_SPEC.md
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

function badge(label, color = 'var(--text-dim)') {
  return `<span class="badge" style="color:${color};border-color:${color}">${esc(label)}</span>`;
}

function statusBadge(status) {
  switch (status) {
    case 'completed':
      return badge('completed', 'var(--green)');
    case 'blocked':
      return badge('blocked', 'var(--yellow)');
    case 'failed':
      return badge('failed', 'var(--red)');
    default:
      return badge(status || 'unknown', 'var(--text-dim)');
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

function truncateId(id, len = 12) {
  if (!id) return '—';
  return id.length > len ? id.slice(0, len) + '…' : id;
}

function truncateHeadline(headline, len = 40) {
  if (!headline) return '—';
  const normalized = String(headline).replace(/\s+/g, ' ').trim();
  if (normalized.length <= len) return normalized;
  return normalized.slice(0, len - 1) + '…';
}

function isInheritable(entry) {
  const snap = entry?.inheritance_snapshot;
  if (!snap) return false;
  const hasDecisions = Array.isArray(snap.recent_decisions) && snap.recent_decisions.length > 0;
  const hasTurns = Array.isArray(snap.recent_accepted_turns) && snap.recent_accepted_turns.length > 0;
  return hasDecisions || hasTurns;
}

function renderRow(entry, index) {
  const rowClass = entry.status === 'blocked'
    ? ' style="border-left:3px solid var(--yellow)"'
    : entry.status === 'failed'
      ? ' style="border-left:3px solid var(--red)"'
      : '';

  const phases = Array.isArray(entry.phases_completed) && entry.phases_completed.length > 0
    ? entry.phases_completed.map(p => esc(p)).join(' → ')
    : '—';

  const blockedInfo = entry.status === 'blocked' && entry.blocked_reason
    ? `<div class="blocked-hint" style="font-size:0.85em;color:var(--yellow);margin-top:2px">${esc(typeof entry.blocked_reason === 'string' ? entry.blocked_reason : entry.blocked_reason?.detail || entry.blocked_reason?.category || '')}</div>`
    : '';

  const ctxIndicator = isInheritable(entry)
    ? `<span title="Has inheritance snapshot — usable by child runs" style="color:var(--green)">✓</span>`
    : `<span style="color:var(--text-dim)">—</span>`;

  return `<tr${rowClass}>
    <td style="color:var(--text-dim)">${index + 1}</td>
    <td class="mono" title="${esc(entry.run_id)}">${esc(truncateId(entry.run_id))}</td>
    <td>${statusBadge(entry.status)}${blockedInfo}</td>
    <td>${ctxIndicator}</td>
    <td>${phases}</td>
    <td>${entry.total_turns ?? '—'}</td>
    <td>${formatCost(entry.total_cost_usd)}</td>
    <td>${formatDuration(entry.duration_ms)}</td>
    <td>${formatDate(entry.recorded_at || entry.completed_at)}</td>
    <td title="${esc(entry.retrospective?.headline || '')}">${esc(truncateHeadline(entry.retrospective?.headline))}</td>
  </tr>`;
}

export function render({ runHistory }) {
  if (!runHistory) {
    return `<div class="placeholder"><h2>Run History</h2><p>No run history data available. Complete a governed run to see cross-run history.</p></div>`;
  }

  if (!Array.isArray(runHistory) || runHistory.length === 0) {
    return `<div class="placeholder"><h2>Run History</h2><p>No runs recorded yet. Run history is populated when governed runs reach a terminal state (completed or blocked).</p></div>`;
  }

  const total = runHistory.length;
  const completed = runHistory.filter(e => e.status === 'completed').length;
  const blocked = runHistory.filter(e => e.status === 'blocked').length;

  let html = `<div class="run-history-view">`;

  // Header summary
  html += `<div class="run-header"><div class="run-meta">`;
  html += `<span class="turn-count">${total} run${total !== 1 ? 's' : ''} recorded</span>`;
  if (completed > 0) html += badge(`${completed} completed`, 'var(--green)');
  if (blocked > 0) html += badge(`${blocked} blocked`, 'var(--yellow)');
  html += `</div></div>`;

  // Table
  html += `<div class="section"><h3>Cross-Run History</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Run ID</th>
          <th>Status</th>
          <th>Ctx</th>
          <th>Phases</th>
          <th>Turns</th>
          <th>Cost</th>
          <th>Duration</th>
          <th>Date</th>
          <th>Headline</th>
        </tr>
      </thead>
      <tbody>`;

  runHistory.forEach((entry, index) => {
    html += renderRow(entry, index);
  });

  html += `</tbody></table></div>`;
  html += `</div>`;
  return html;
}
