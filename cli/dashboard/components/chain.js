/**
 * Chain view — renders run-chaining visibility from /api/chain-reports.
 *
 * Pure render function: takes snapshot data from the bridge server and returns
 * HTML for latest-chain lineage plus recent chain-session history.
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

function formatStatus(status) {
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

function formatTerminalReason(reason) {
  switch (reason) {
    case 'chain_limit_reached':
      return badge('chain limit reached', '#38bdf8');
    case 'non_chainable_status':
      return badge('non-chainable status', 'var(--yellow)');
    case 'operator_abort':
      return badge('operator abort', 'var(--red)');
    case 'parent_validation_failed':
      return badge('parent validation failed', 'var(--red)');
    default:
      return badge(reason || 'unknown', 'var(--text-dim)');
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

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const date = new Date(iso);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      + ' ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return esc(iso);
  }
}

function truncateId(value, len = 12) {
  if (!value) return '—';
  return value.length > len ? `${value.slice(0, len)}…` : value;
}

function formatContextSummary(summary) {
  if (!summary) return '—';

  const parts = [];
  if (Array.isArray(summary.parent_roles_used) && summary.parent_roles_used.length > 0) {
    parts.push(`${summary.parent_roles_used.length} roles`);
  }
  if (summary.parent_phases_completed_count > 0) {
    parts.push(`${summary.parent_phases_completed_count} phases`);
  }
  if (summary.recent_decisions_count > 0) {
    parts.push(`${summary.recent_decisions_count} decisions`);
  }
  if (summary.recent_accepted_turns_count > 0) {
    parts.push(`${summary.recent_accepted_turns_count} turns`);
  }

  return parts.length > 0 ? esc(parts.join(', ')) : '—';
}

function renderLatestRunsTable(report) {
  if (!Array.isArray(report?.runs) || report.runs.length === 0) {
    return `<p class="section-subtitle">No runs recorded for this chain.</p>`;
  }

  let html = `<div class="section"><h3>Latest Chain Lineage</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Run ID</th>
          <th>Status</th>
          <th>Trigger</th>
          <th>Turns</th>
          <th>Duration</th>
          <th>Parent</th>
          <th>Inherited Context</th>
        </tr>
      </thead>
      <tbody>`;

  report.runs.forEach((run, index) => {
    html += `<tr>
      <td style="color:var(--text-dim)">${index + 1}</td>
      <td class="mono" title="${esc(run.run_id || '')}">${esc(truncateId(run.run_id))}</td>
      <td>${formatStatus(run.status)}</td>
      <td>${esc(run.provenance_trigger || '—')}</td>
      <td>${run.turns ?? '—'}</td>
      <td>${formatDuration(run.duration_ms)}</td>
      <td class="mono" title="${esc(run.parent_run_id || '')}">${esc(truncateId(run.parent_run_id))}</td>
      <td>${formatContextSummary(run.inherited_context_summary)}</td>
    </tr>`;
  });

  html += '</tbody></table></div>';
  return html;
}

function renderRecentChainsTable(reports) {
  let html = `<div class="section"><h3>Recent Chain Sessions</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Chain ID</th>
          <th>Runs</th>
          <th>Turns</th>
          <th>Terminal</th>
          <th>Duration</th>
          <th>Started</th>
        </tr>
      </thead>
      <tbody>`;

  reports.forEach((report, index) => {
    html += `<tr>
      <td style="color:var(--text-dim)">${index + 1}</td>
      <td class="mono" title="${esc(report.chain_id || '')}">${esc(truncateId(report.chain_id, 14))}</td>
      <td>${report.runs?.length || 0}</td>
      <td>${report.total_turns ?? '—'}</td>
      <td>${formatTerminalReason(report.terminal_reason)}</td>
      <td>${formatDuration(report.total_duration_ms)}</td>
      <td>${formatDate(report.started_at)}</td>
    </tr>`;
  });

  html += '</tbody></table></div>';
  return html;
}

export function render({ chainReports }) {
  if (!chainReports || typeof chainReports !== 'object') {
    return `<div class="placeholder"><h2>Chain</h2><p>No chain data available. Run a chained governed session to populate this view.</p></div>`;
  }

  const reports = Array.isArray(chainReports.reports) ? chainReports.reports : [];
  const latest = chainReports.latest || reports[0] || null;

  if (!latest || reports.length === 0) {
    return `<div class="placeholder"><h2>Chain</h2><p>No chain reports found. Run <code>agentxchain run --chain</code> to record automatic continuation lineage.</p></div>`;
  }

  let html = `<div class="chain-view"><div class="run-header"><div class="run-meta">`;
  html += `<span class="turn-count">latest chain ${esc(latest.chain_id || '—')}</span>`;
  html += badge(`${latest.runs?.length || 0} runs`, '#38bdf8');
  html += badge(`${latest.total_turns || 0} turns`, 'var(--green)');
  html += formatTerminalReason(latest.terminal_reason);
  html += `</div></div>`;

  html += `<div class="section"><h3>Latest Chain Summary</h3><dl class="detail-list">`;
  html += `<dt>Started</dt><dd>${esc(latest.started_at || '—')}</dd>`;
  html += `<dt>Completed</dt><dd>${esc(latest.completed_at || '—')}</dd>`;
  html += `<dt>Total Duration</dt><dd>${formatDuration(latest.total_duration_ms)}</dd>`;
  html += `<dt>Total Turns</dt><dd>${latest.total_turns ?? '—'}</dd>`;
  html += `<dt>Terminal Reason</dt><dd>${esc(latest.terminal_reason || '—')}</dd>`;
  html += `</dl></div>`;

  html += renderLatestRunsTable(latest);
  html += renderRecentChainsTable(reports);
  html += '</div>';
  return html;
}
