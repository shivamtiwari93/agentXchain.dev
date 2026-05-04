/**
 * Org Overview component — renders organization-level metrics and project cards.
 *
 * Pure render function: takes data, returns HTML string.
 * Follows the same pattern as timeline.js and run-history.js.
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
    default: return badge(status || 'none', 'var(--text-dim)');
  }
}

function phaseBadge(phase) {
  switch (phase) {
    case 'planning': return badge('planning', 'var(--accent)');
    case 'implementation': return badge('implementation', '#38bdf8');
    case 'qa': return badge('qa', 'var(--yellow)');
    default: return badge(phase || 'none', 'var(--text-dim)');
  }
}

function formatUsd(amount) {
  return '$' + (amount || 0).toFixed(2);
}

function renderMetricCard(value, label) {
  return `<div class="org-metric-card">
    <div class="org-metric-value">${esc(String(value))}</div>
    <div class="org-metric-label">${esc(label)}</div>
  </div>`;
}

function renderProjectCard(project) {
  const s = project.state || {};
  const hasRun = s.run_id != null;
  const gateList = (project.pending_gates || []).map(g => esc(g)).join(', ');

  return `<div class="turn-card${s.status === 'active' ? ' active' : ''}">
    <div class="turn-header">
      <strong>${esc(project.name)}</strong>
      ${s.status ? statusBadge(s.status) : ''}
      ${s.phase ? phaseBadge(s.phase) : ''}
    </div>
    ${hasRun
      ? `<div class="turn-status">
          <span class="mono">${esc(s.run_id)}</span>
        </div>
        <div class="turn-detail">
          <span class="detail-label">Turns:</span> ${s.active_turns || 0}
          &nbsp;&middot;&nbsp;
          <span class="detail-label">Cost:</span> ${formatUsd(s.budget_spent_usd)}
        </div>`
      : `<div class="turn-status">No active run</div>`
    }
    ${gateList
      ? `<div class="turn-detail"><span class="detail-label">Pending gates:</span> ${gateList}</div>`
      : ''
    }
    ${project.error
      ? `<div class="turn-detail risks">${esc(project.error)}</div>`
      : ''
    }
  </div>`;
}

/**
 * @param {{ orgOverview: object, liveMeta: object }} data
 * @returns {string} HTML string
 */
export function render(data) {
  const overview = data?.orgOverview?.data || data?.orgOverview || null;

  if (!overview) {
    return `<div class="placeholder">
      <h2>Org Overview</h2>
      <p>No organization data available. Start the hosted runner with <code>--projects</code> to register multiple projects.</p>
    </div>`;
  }

  const projects = overview.projects || [];

  const css = `<style>
.org-metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}
.org-metric-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 16px;
  text-align: center;
}
.org-metric-value { font-size: 24px; font-weight: 700; color: var(--text); }
.org-metric-label { font-size: 12px; color: var(--text-dim); margin-top: 4px; }
.org-projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}
</style>`;

  const metricsHtml = `<div class="org-metrics">
    ${renderMetricCard(overview.total_projects, 'Projects')}
    ${renderMetricCard(overview.active_runs, 'Active Runs')}
    ${renderMetricCard(overview.pending_gates, 'Pending Gates')}
    ${renderMetricCard(overview.total_decisions, 'Total Decisions')}
    ${renderMetricCard(formatUsd(overview.total_cost_usd), 'Total Cost')}
  </div>`;

  const projectsHtml = projects.length > 0
    ? `<div class="org-projects-grid">${projects.map(renderProjectCard).join('')}</div>`
    : `<div class="placeholder compact"><p>No projects registered.</p></div>`;

  return `${css}
<div class="section">
  <h3>Org Overview</h3>
  ${metricsHtml}
</div>
<div class="section">
  <h3>Projects (${projects.length})</h3>
  ${projectsHtml}
</div>`;
}
