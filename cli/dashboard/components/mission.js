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

function formatPlanStatus(status) {
  switch (status) {
    case 'proposed':
      return badge('proposed', '#38bdf8');
    case 'approved':
      return badge('approved', 'var(--green)');
    case 'superseded':
      return badge('superseded', 'var(--text-dim)');
    case 'needs_attention':
      return badge('needs attention', 'var(--yellow)');
    default:
      return badge(status || 'unknown', 'var(--text-dim)');
  }
}

function formatLaunchStatus(status) {
  switch (status) {
    case 'ready':
      return badge('ready', 'var(--green)');
    case 'blocked':
      return badge('blocked', 'var(--red)');
    case 'launched':
      return badge('launched', '#38bdf8');
    case 'completed':
      return badge('completed', 'var(--green)');
    case 'needs_attention':
      return badge('needs attention', 'var(--yellow)');
    default:
      return badge(status || 'unknown', 'var(--text-dim)');
  }
}

function renderLatestPlan(plan) {
  if (!plan) {
    return `<div class="section"><h3>Latest Plan</h3><p class="section-subtitle">No decomposition plan found. Run <code>agentxchain mission plan &lt;mission_id&gt;</code> to generate one.</p></div>`;
  }

  const workstreams = Array.isArray(plan.workstreams) ? plan.workstreams : [];
  const launchRecords = Array.isArray(plan.launch_records) ? plan.launch_records : [];
  const statusCounts = plan.workstream_status_counts || {};

  let html = `<div class="section"><h3>Latest Plan</h3><dl class="detail-list">`;
  html += `<dt>Plan ID</dt><dd class="mono" title="${esc(plan.plan_id || '')}">${esc(truncateId(plan.plan_id, 30))}</dd>`;
  html += `<dt>Status</dt><dd>${formatPlanStatus(plan.status)}</dd>`;
  html += `<dt>Mission</dt><dd class="mono">${esc(plan.mission_id || '—')}</dd>`;
  html += `<dt>Created</dt><dd>${formatDate(plan.created_at)}</dd>`;
  if (plan.approved_at) {
    html += `<dt>Approved</dt><dd>${formatDate(plan.approved_at)}</dd>`;
  }
  html += `<dt>Workstreams</dt><dd>${plan.workstream_count || 0}</dd>`;
  html += `<dt>Launched</dt><dd>${plan.launch_record_count || 0}</dd>`;
  if (Object.keys(statusCounts).length > 0) {
    const countsStr = Object.entries(statusCounts).map(([k, v]) => `${k}: ${v}`).join(', ');
    html += `<dt>Status Breakdown</dt><dd>${esc(countsStr)}</dd>`;
  }
  if (plan.supersedes_plan_id) {
    html += `<dt>Supersedes</dt><dd class="mono">${esc(truncateId(plan.supersedes_plan_id, 30))}</dd>`;
  }
  html += `</dl></div>`;

  // Workstreams table
  if (workstreams.length > 0) {
    html += `<div class="section"><h3>Workstreams</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>ID</th>
            <th>Title</th>
            <th>Status</th>
            <th>Roles</th>
            <th>Phases</th>
            <th>Dependencies</th>
          </tr>
        </thead>
        <tbody>`;

    workstreams.forEach((ws, index) => {
      const roles = Array.isArray(ws.roles) ? ws.roles.join(', ') : '—';
      const phases = Array.isArray(ws.phases) ? ws.phases.join(', ') : '—';
      const deps = Array.isArray(ws.depends_on) && ws.depends_on.length > 0 ? ws.depends_on.join(', ') : 'none';

      html += `<tr>
        <td style="color:var(--text-dim)">${index + 1}</td>
        <td class="mono">${esc(ws.workstream_id || '—')}</td>
        <td>${esc(ws.title || '—')}</td>
        <td>${formatLaunchStatus(ws.launch_status)}</td>
        <td>${esc(roles)}</td>
        <td>${esc(phases)}</td>
        <td class="mono">${esc(deps)}</td>
      </tr>`;
    });

    html += '</tbody></table></div>';
  }

  // Launch records table
  if (launchRecords.length > 0) {
    html += `<div class="section"><h3>Launch Records</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Workstream</th>
            <th>Chain ID</th>
            <th>Status</th>
            <th>Terminal</th>
            <th>Launched</th>
            <th>Completed</th>
          </tr>
        </thead>
        <tbody>`;

    launchRecords.forEach((lr, index) => {
      html += `<tr>
        <td style="color:var(--text-dim)">${index + 1}</td>
        <td class="mono">${esc(lr.workstream_id || '—')}</td>
        <td class="mono" title="${esc(lr.chain_id || '')}">${esc(truncateId(lr.chain_id))}</td>
        <td>${formatLaunchStatus(lr.status)}</td>
        <td>${esc(lr.terminal_reason || '—')}</td>
        <td>${formatDate(lr.launched_at)}</td>
        <td>${formatDate(lr.completed_at)}</td>
      </tr>`;
    });

    html += '</tbody></table></div>';
  }

  return html;
}

function renderRecentPlans(plans) {
  if (!Array.isArray(plans) || plans.length <= 1) {
    return '';
  }

  // Skip the first (latest) since it's rendered in detail above
  const olderPlans = plans.slice(1);
  if (olderPlans.length === 0) return '';

  let html = `<div class="section"><h3>Previous Plans</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Plan ID</th>
          <th>Mission</th>
          <th>Status</th>
          <th>Workstreams</th>
          <th>Launched</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>`;

  olderPlans.forEach((plan, index) => {
    html += `<tr>
      <td style="color:var(--text-dim)">${index + 1}</td>
      <td class="mono" title="${esc(plan.plan_id || '')}">${esc(truncateId(plan.plan_id, 20))}</td>
      <td class="mono">${esc(truncateId(plan.mission_id, 18))}</td>
      <td>${formatPlanStatus(plan.status)}</td>
      <td>${plan.workstream_count || 0}</td>
      <td>${plan.launch_record_count || 0}</td>
      <td>${formatDate(plan.created_at)}</td>
    </tr>`;
  });

  html += '</tbody></table></div>';
  return html;
}

export function render({ missions, plans }) {
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

  // Plan visibility
  const planData = plans && typeof plans === 'object' ? plans : null;
  const latestPlan = planData?.latest || null;
  const allPlans = Array.isArray(planData?.plans) ? planData.plans : [];
  html += renderLatestPlan(latestPlan);
  html += renderRecentPlans(allPlans);

  html += renderRecentMissions(missionList);
  html += '</div>';
  return html;
}
