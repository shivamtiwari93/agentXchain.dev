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

function formatMissionStatus(status) {
  switch (status) {
    case 'progressing':
      return badge('progressing', 'var(--green)');
    case 'planned':
      return badge('planned', '#38bdf8');
    case 'needs_attention':
      return badge('needs attention', 'var(--yellow)');
    case 'degraded':
      return badge('degraded', 'var(--red)');
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
    case 'completed':
      return badge('completed', 'var(--green)');
    default:
      return badge(reason || 'none', 'var(--text-dim)');
  }
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

function truncateId(value, len = 14) {
  if (!value) return '—';
  return value.length > len ? `${value.slice(0, len)}…` : value;
}

function renderAttachedChains(latest) {
  if (!Array.isArray(latest?.chains) || latest.chains.length === 0) {
    return `<div class="section"><h3>Attached Chains</h3><p class="section-subtitle">No chain reports are attached to this mission yet.</p></div>`;
  }

  let html = `<div class="section"><h3>Attached Chains</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Chain ID</th>
          <th>Runs</th>
          <th>Turns</th>
          <th>Terminal</th>
          <th>Started</th>
        </tr>
      </thead>
      <tbody>`;

  latest.chains.forEach((chain, index) => {
    html += `<tr>
      <td style="color:var(--text-dim)">${index + 1}</td>
      <td class="mono" title="${esc(chain.chain_id || '')}">${esc(truncateId(chain.chain_id))}</td>
      <td>${chain.runs?.length || 0}</td>
      <td>${chain.total_turns ?? '—'}</td>
      <td>${formatTerminalReason(chain.terminal_reason)}</td>
      <td>${formatDate(chain.started_at)}</td>
    </tr>`;
  });

  html += '</tbody></table></div>';
  return html;
}

function renderRecentMissions(missions) {
  let html = `<div class="section"><h3>Recent Missions</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Mission ID</th>
          <th>Status</th>
          <th>Chains</th>
          <th>Runs</th>
          <th>Turns</th>
          <th>Repo Decisions</th>
          <th>Latest Terminal</th>
          <th>Updated</th>
          <th>Title</th>
        </tr>
      </thead>
      <tbody>`;

  missions.forEach((mission, index) => {
    html += `<tr>
      <td style="color:var(--text-dim)">${index + 1}</td>
      <td class="mono" title="${esc(mission.mission_id || '')}">${esc(truncateId(mission.mission_id, 18))}</td>
      <td>${formatMissionStatus(mission.derived_status)}</td>
      <td>${mission.chain_count ?? 0}</td>
      <td>${mission.total_runs ?? 0}</td>
      <td>${mission.total_turns ?? 0}</td>
      <td>${mission.active_repo_decisions_count ?? 0}</td>
      <td>${formatTerminalReason(mission.latest_terminal_reason)}</td>
      <td>${formatDate(mission.updated_at || mission.created_at)}</td>
      <td>${esc(mission.title || '—')}</td>
    </tr>`;
  });

  html += '</tbody></table></div>';
  return html;
}

export function render({ missions }) {
  if (!missions || typeof missions !== 'object') {
    return `<div class="placeholder"><h2>Mission</h2><p>No mission data available. Create a mission and bind a chain to populate this view.</p></div>`;
  }

  const missionList = Array.isArray(missions.missions) ? missions.missions : [];
  const latest = missions.latest || missionList[0] || null;

  if (!latest || missionList.length === 0) {
    return `<div class="placeholder"><h2>Mission</h2><p>No missions found. Run <code>agentxchain mission start --title "..." --goal "..."</code> and then <code>agentxchain run --chain --mission latest</code> to track long-horizon work here.</p></div>`;
  }

  const missingChains = Array.isArray(latest.missing_chain_ids) ? latest.missing_chain_ids : [];

  let html = `<div class="mission-view"><div class="run-header"><div class="run-meta">`;
  html += `<span class="turn-count">latest mission ${esc(latest.mission_id || '—')}</span>`;
  html += formatMissionStatus(latest.derived_status);
  html += badge(`${latest.chain_count || 0} chains`, '#38bdf8');
  html += badge(`${latest.total_turns || 0} turns`, 'var(--green)');
  html += badge(`${latest.active_repo_decisions_count || 0} repo decisions`, 'var(--yellow)');
  html += `</div></div>`;

  html += `<div class="section"><h3>Latest Mission Summary</h3><dl class="detail-list">`;
  html += `<dt>Title</dt><dd>${esc(latest.title || '—')}</dd>`;
  html += `<dt>Goal</dt><dd>${esc(latest.goal || '—')}</dd>`;
  html += `<dt>Updated</dt><dd>${esc(latest.updated_at || latest.created_at || '—')}</dd>`;
  html += `<dt>Latest Chain</dt><dd class="mono">${esc(latest.latest_chain_id || '—')}</dd>`;
  html += `<dt>Latest Terminal</dt><dd>${esc(latest.latest_terminal_reason || '—')}</dd>`;
  html += `<dt>Total Runs</dt><dd>${latest.total_runs ?? 0}</dd>`;
  html += `<dt>Attached Chains</dt><dd>${latest.attached_chain_count ?? 0}</dd>`;
  html += `<dt>Missing Chains</dt><dd>${missingChains.length}</dd>`;
  html += `<dt>Active Repo Decisions</dt><dd>${latest.active_repo_decisions_count ?? 0}</dd>`;
  html += `</dl></div>`;

  if (missingChains.length > 0) {
    html += `<div class="section"><h3>Missing Chain References</h3><p class="section-subtitle">This mission is degraded until the missing chain reports are restored.</p><p class="mono">${esc(missingChains.join(', '))}</p></div>`;
  }

  html += renderAttachedChains(latest);
  html += renderRecentMissions(missionList);
  html += '</div>';
  return html;
}
