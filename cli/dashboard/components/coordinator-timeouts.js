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

function scopeLabel(scope) {
  if (scope === 'turn') return 'Per-Turn';
  if (scope === 'phase') return 'Per-Phase';
  if (scope === 'run') return 'Per-Run';
  return esc(scope || '—');
}

function actionBadge(action) {
  if (action === 'escalate') return badge('escalate', 'var(--red)');
  if (action === 'warn') return badge('warn', 'var(--yellow)');
  if (action === 'skip_phase') return badge('skip_phase', 'var(--accent)');
  return badge(action || '—');
}

function typeLabel(type) {
  if (type === 'timeout') return badge('exceeded', 'var(--red)');
  if (type === 'timeout_warning') return badge('warning', 'var(--yellow)');
  if (type === 'timeout_skip') return badge('skipped', 'var(--accent)');
  if (type === 'timeout_skip_failed') return badge('skip failed', 'var(--red)');
  return badge(type || '—');
}

function statusColor(status) {
  const colors = {
    active: 'var(--green)',
    blocked: 'var(--red)',
    paused: 'var(--yellow)',
    completed: 'var(--accent)',
    idle: 'var(--text-dim)',
    initialized: 'var(--accent)',
    linked: 'var(--green)',
  };
  return colors[status] || 'var(--text-dim)';
}

function renderSummary(summary) {
  return `<div class="gate-card"><h3>Summary</h3>
    <dl class="detail-list">
      <dt>Repos</dt><dd>${summary.repo_count}</dd>
      <dt>Timeout Configured</dt><dd>${summary.configured_repo_count}</dd>
      <dt>Live Exceeded</dt><dd>${summary.repos_with_live_exceeded}</dd>
      <dt>Live Warnings</dt><dd>${summary.repos_with_live_warnings}</dd>
      <dt>Repo Events</dt><dd>${summary.repo_event_count}</dd>
      <dt>Coordinator Events</dt><dd>${summary.coordinator_event_count}</dd>
    </dl>
  </div>`;
}

function renderConfigTable(config) {
  if (!config) {
    return `<p style="color:var(--text-dim)">No <code>timeouts</code> configured in this repo.</p>`;
  }

  let html = `<table class="data-table">
    <thead><tr><th>Scope</th><th>Limit</th><th>Action</th></tr></thead>
    <tbody>`;
  if (config.per_turn_minutes) {
    html += `<tr><td>Per-Turn</td><td>${config.per_turn_minutes}m</td><td>${actionBadge(config.action)}</td></tr>`;
  }
  if (config.per_phase_minutes) {
    html += `<tr><td>Per-Phase</td><td>${config.per_phase_minutes}m</td><td>${actionBadge(config.action)}</td></tr>`;
  }
  if (config.per_run_minutes) {
    html += `<tr><td>Per-Run</td><td>${config.per_run_minutes}m</td><td>${actionBadge(config.action)}</td></tr>`;
  }
  for (const override of (config.phase_overrides || [])) {
    html += `<tr><td>Phase: <strong>${esc(override.phase)}</strong></td><td>${override.limit_minutes ? `${override.limit_minutes}m` : 'inherit'}</td><td>${override.action ? actionBadge(override.action) : 'inherit'}</td></tr>`;
  }
  html += `</tbody></table>`;
  return html;
}

function renderLiveTable(live) {
  const exceeded = live?.exceeded || [];
  const warnings = live?.warnings || [];
  if (exceeded.length === 0 && warnings.length === 0) {
    return `<p style="color:var(--green)">No live timeout pressure.</p>`;
  }

  let html = `<table class="data-table">
    <thead><tr><th>Status</th><th>Scope</th><th>Turn</th><th>Phase</th><th>Elapsed</th><th>Limit</th><th>Exceeded By</th><th>Action</th></tr></thead>
    <tbody>`;
  for (const item of exceeded) {
    const turnLabel = item.turn_id
      ? `<span class="mono">${esc(item.turn_id)}</span>${item.role_id ? ` <span style="color:var(--text-dim)">(${esc(item.role_id)})</span>` : ''}`
      : '—';
    html += `<tr style="border-left:3px solid var(--red)">
      <td>${badge('EXCEEDED', 'var(--red)')}</td>
      <td>${scopeLabel(item.scope)}</td>
      <td>${turnLabel}</td>
      <td>${item.phase ? esc(item.phase) : '—'}</td>
      <td>${item.elapsed_minutes}m</td>
      <td>${item.limit_minutes}m</td>
      <td style="color:var(--red)">${item.exceeded_by_minutes}m</td>
      <td>${actionBadge(item.action)}</td>
    </tr>`;
  }
  for (const item of warnings) {
    const turnLabel = item.turn_id
      ? `<span class="mono">${esc(item.turn_id)}</span>${item.role_id ? ` <span style="color:var(--text-dim)">(${esc(item.role_id)})</span>` : ''}`
      : '—';
    html += `<tr style="border-left:3px solid var(--yellow)">
      <td>${badge('WARNING', 'var(--yellow)')}</td>
      <td>${scopeLabel(item.scope)}</td>
      <td>${turnLabel}</td>
      <td>${item.phase ? esc(item.phase) : '—'}</td>
      <td>${item.elapsed_minutes}m</td>
      <td>${item.limit_minutes}m</td>
      <td>${item.exceeded_by_minutes}m</td>
      <td>${actionBadge(item.action)}</td>
    </tr>`;
  }
  html += `</tbody></table>`;
  return html;
}

function renderEventTable(events, title) {
  if (!Array.isArray(events) || events.length === 0) {
    return `<div class="section"><h3>${title}</h3><p style="color:var(--text-dim)">No timeout events recorded.</p></div>`;
  }

  let html = `<div class="section"><h3>${title}</h3>
    <table class="data-table">
      <thead><tr><th>Type</th><th>Scope</th><th>Phase</th><th>Turn</th><th>Elapsed</th><th>Limit</th><th>Action</th></tr></thead>
      <tbody>`;
  for (const event of events) {
    html += `<tr>
      <td>${typeLabel(event.type)}</td>
      <td>${scopeLabel(event.scope)}</td>
      <td>${event.phase ? esc(event.phase) : '—'}</td>
      <td class="mono">${event.turn_id ? esc(event.turn_id) : '—'}</td>
      <td>${event.elapsed_minutes != null ? `${event.elapsed_minutes}m` : '—'}</td>
      <td>${event.limit_minutes != null ? `${event.limit_minutes}m` : '—'}</td>
      <td>${actionBadge(event.action)}</td>
    </tr>`;
  }
  html += `</tbody></table></div>`;
  return html;
}

function renderRepoCard(repo) {
  let html = `<div class="turn-card">
    <div class="turn-header">
      <span class="mono">${esc(repo.repo_id)}</span>
      ${repo.status ? badge(repo.status, statusColor(repo.status)) : ''}
      ${repo.configured ? badge('timeouts configured', 'var(--green)') : badge('no timeouts', 'var(--text-dim)')}
    </div>`;

  html += `<dl class="detail-list">
    <dt>Path</dt><dd class="mono">${esc(repo.path)}</dd>`;
  if (repo.run_id) {
    html += `<dt>Run</dt><dd class="mono">${esc(repo.run_id)}</dd>`;
  }
  if (repo.phase) {
    html += `<dt>Phase</dt><dd>${esc(repo.phase)}</dd>`;
  }
  html += `</dl>`;

  if (repo.error) {
    html += `<p style="color:var(--red)">${esc(repo.error.error)}</p></div>`;
    return html;
  }

  html += `<div class="section"><h3>Configuration</h3>${renderConfigTable(repo.config)}</div>`;
  if (repo.live) {
    html += `<div class="section"><h3>Live Pressure</h3>${renderLiveTable(repo.live)}</div>`;
  }
  html += renderEventTable(repo.events, 'Repo Events');
  html += `</div>`;
  return html;
}

export function render({ coordinatorTimeouts }) {
  if (!coordinatorTimeouts) {
    return `<div class="placeholder"><h2>Coordinator Timeouts</h2><p>No coordinator timeout data available. Ensure a coordinator run is active.</p></div>`;
  }

  if (coordinatorTimeouts.ok === false) {
    return `<div class="placeholder"><h2>Coordinator Timeouts</h2><p>${esc(coordinatorTimeouts.error || 'Failed to load coordinator timeout data.')}</p></div>`;
  }

  let html = `<div class="timeouts-view"><div class="run-header"><div class="run-meta">`;
  if (coordinatorTimeouts.super_run_id) {
    html += `<span class="mono run-id">${esc(coordinatorTimeouts.super_run_id)}</span>`;
  }
  if (coordinatorTimeouts.status) {
    html += badge(coordinatorTimeouts.status, statusColor(coordinatorTimeouts.status));
  }
  if (coordinatorTimeouts.phase) {
    html += `<span class="phase-label">Phase: <strong>${esc(coordinatorTimeouts.phase)}</strong></span>`;
  }
  html += `${badge('coordinator timeout view', 'var(--accent)')}</div></div>`;

  if (coordinatorTimeouts.blocked_reason) {
    html += `<div class="blocked-banner"><div class="blocked-icon">BLOCKED</div><div class="blocked-reason">${esc(typeof coordinatorTimeouts.blocked_reason === 'string' ? coordinatorTimeouts.blocked_reason : JSON.stringify(coordinatorTimeouts.blocked_reason))}</div></div>`;
  }

  html += renderSummary(coordinatorTimeouts.summary);
  html += renderEventTable(coordinatorTimeouts.coordinator_events, 'Coordinator Events');
  html += `<div class="section"><h3>Repo Timeout Status</h3><div class="turn-list">`;
  for (const repo of (coordinatorTimeouts.repos || [])) {
    html += renderRepoCard(repo);
  }
  html += `</div></div></div>`;
  return html;
}
