/**
 * Org Runs component — renders cross-project run list as a filterable data table.
 *
 * Pure render function: takes data, returns HTML string.
 * Follows the same pattern as ledger.js filter bar and run-history.js table.
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
    case 'active': return badge('active', 'var(--green)');
    case 'blocked': return badge('blocked', 'var(--yellow)');
    case 'completed': return badge('completed', 'var(--green)');
    case 'failed': return badge('failed', 'var(--red)');
    default: return badge(status || 'unknown', 'var(--text-dim)');
  }
}

function phaseBadge(phase) {
  switch (phase) {
    case 'planning': return badge('planning', 'var(--accent)');
    case 'implementation': return badge('implementation', '#38bdf8');
    case 'qa': return badge('qa', 'var(--yellow)');
    default: return badge(phase || 'unknown', 'var(--text-dim)');
  }
}

function formatUsd(amount) {
  return '$' + (amount || 0).toFixed(2);
}

function relativeTime(isoString) {
  if (!isoString) return '—';
  try {
    const dt = new Date(isoString);
    const now = Date.now();
    const diffMs = now - dt.getTime();
    if (diffMs < 0) return esc(isoString);
    const seconds = Math.floor(diffMs / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return esc(isoString);
  }
}

function truncateRunId(runId) {
  if (!runId) return '—';
  return runId.length > 20 ? runId.slice(0, 20) + '...' : runId;
}

function renderFilterBar(runs, filter) {
  const projectSet = new Set(runs.map(r => r.project_name));
  const projectOptions = ['all', ...Array.from(projectSet).sort()];
  const phaseOptions = ['all', 'planning', 'implementation', 'qa'];
  const statusOptions = ['all', 'active', 'blocked', 'completed', 'failed'];

  function options(list, selected) {
    return list.map(v =>
      `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v)}</option>`
    ).join('');
  }

  return `<div class="filter-bar">
    <label class="filter-control">
      Project
      <select data-view-control="org-runs-project">
        ${options(projectOptions, filter?.project || 'all')}
      </select>
    </label>
    <label class="filter-control">
      Phase
      <select data-view-control="org-runs-phase">
        ${options(phaseOptions, filter?.phase || 'all')}
      </select>
    </label>
    <label class="filter-control">
      Status
      <select data-view-control="org-runs-status">
        ${options(statusOptions, filter?.status || 'all')}
      </select>
    </label>
  </div>`;
}

function applyFilter(runs, filter) {
  let filtered = runs;
  if (filter?.project && filter.project !== 'all') {
    filtered = filtered.filter(r => r.project_name === filter.project);
  }
  if (filter?.phase && filter.phase !== 'all') {
    filtered = filtered.filter(r => r.phase === filter.phase);
  }
  if (filter?.status && filter.status !== 'all') {
    filtered = filtered.filter(r => r.status === filter.status);
  }
  return filtered;
}

/**
 * @param {{ orgRuns: object, liveMeta: object, filter?: object }} data
 * @returns {string} HTML string
 */
export function render(data) {
  const runsData = data?.orgRuns?.data || data?.orgRuns || null;
  const runs = Array.isArray(runsData) ? runsData : (runsData?.data || []);
  const filter = data?.filter || {};

  if (!runs.length && !filter.project && !filter.phase && !filter.status) {
    return `<div class="placeholder">
      <h2>Org Runs</h2>
      <p>No cross-project runs available. Register projects and start governed runs.</p>
    </div>`;
  }

  const filtered = applyFilter(runs, filter);

  const tableRows = filtered.map(r => `<tr>
    <td>${esc(r.project_name)}</td>
    <td class="mono">${esc(truncateRunId(r.run_id))}</td>
    <td>${phaseBadge(r.phase)}</td>
    <td>${statusBadge(r.status)}</td>
    <td>${r.turns_completed || 0}</td>
    <td>${formatUsd(r.cost_usd)}</td>
    <td>${relativeTime(r.started_at)}</td>
    <td>${relativeTime(r.updated_at)}</td>
  </tr>`).join('');

  return `<div class="section">
  <h3>Org Runs (${filtered.length})</h3>
  ${renderFilterBar(runs, filter)}
  <table class="data-table">
    <thead>
      <tr>
        <th>Project</th>
        <th>Run ID</th>
        <th>Phase</th>
        <th>Status</th>
        <th>Turns</th>
        <th>Cost</th>
        <th>Started</th>
        <th>Updated</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows || '<tr><td colspan="8" style="text-align:center;color:var(--text-dim)">No runs match filters</td></tr>'}
    </tbody>
  </table>
</div>`;
}
