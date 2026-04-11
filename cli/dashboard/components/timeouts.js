/**
 * Timeouts view — renders live timeout pressure and persisted timeout events.
 *
 * Pure render function: takes data from /api/timeouts, returns HTML.
 * All evaluation is server-side. This view renders the snapshot.
 *
 * See: TIMEOUT_DASHBOARD_SURFACE_SPEC.md
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
  return badge(action || '—', 'var(--text-dim)');
}

function typeLabel(type) {
  if (type === 'timeout') return badge('exceeded', 'var(--red)');
  if (type === 'timeout_warning') return badge('warning', 'var(--yellow)');
  if (type === 'timeout_skip') return badge('skipped', 'var(--accent)');
  if (type === 'timeout_skip_failed') return badge('skip failed', 'var(--red)');
  return badge(type || '—');
}

function formatTime(ts) {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return esc(ts);
  }
}

function renderConfigTable(config) {
  let html = `<div class="section"><h3>Timeout Configuration</h3>
    <table class="data-table">
      <thead><tr><th>Scope</th><th>Limit</th><th>Action</th></tr></thead>
      <tbody>`;

  if (config.per_turn_minutes) {
    html += `<tr><td>Per-Turn</td><td>${config.per_turn_minutes}m</td><td>${actionBadge(config.action)}</td></tr>`;
  }
  if (config.per_phase_minutes) {
    html += `<tr><td>Per-Phase (global)</td><td>${config.per_phase_minutes}m</td><td>${actionBadge(config.action)}</td></tr>`;
  }
  if (config.per_run_minutes) {
    html += `<tr><td>Per-Run</td><td>${config.per_run_minutes}m</td><td>${actionBadge(config.action)}</td></tr>`;
  }

  if (Array.isArray(config.phase_overrides)) {
    for (const override of config.phase_overrides) {
      const limitStr = override.limit_minutes ? `${override.limit_minutes}m` : '<span style="color:var(--text-dim)">inherit</span>';
      const actionStr = override.action ? actionBadge(override.action) : '<span style="color:var(--text-dim)">inherit</span>';
      html += `<tr><td>Phase: <strong>${esc(override.phase)}</strong></td><td>${limitStr}</td><td>${actionStr}</td></tr>`;
    }
  }

  html += `</tbody></table></div>`;
  return html;
}

function renderLivePressure(live) {
  const hasExceeded = live.exceeded && live.exceeded.length > 0;
  const hasWarnings = live.warnings && live.warnings.length > 0;

  if (!hasExceeded && !hasWarnings) {
    return `<div class="section"><h3>Live Pressure</h3><p style="color:var(--green)">No timeouts exceeded or approaching limits.</p></div>`;
  }

  let html = `<div class="section"><h3>Live Pressure</h3>
    <table class="data-table">
      <thead><tr><th>Status</th><th>Scope</th><th>Turn</th><th>Phase</th><th>Elapsed</th><th>Limit</th><th>Exceeded By</th><th>Action</th></tr></thead>
      <tbody>`;

  for (const item of (live.exceeded || [])) {
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

  for (const item of (live.warnings || [])) {
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

  html += `</tbody></table></div>`;
  return html;
}

function renderEvents(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return `<div class="section"><h3>Timeout Events</h3><p style="color:var(--text-dim)">No timeout events recorded in the decision ledger.</p></div>`;
  }

  let html = `<div class="section"><h3>Timeout Events</h3>
    <table class="data-table">
      <thead><tr><th>Type</th><th>Scope</th><th>Phase</th><th>Turn</th><th>Elapsed</th><th>Limit</th><th>Action</th><th>Timestamp</th></tr></thead>
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
      <td>${formatTime(event.timestamp)}</td>
    </tr>`;
  }

  html += `</tbody></table></div>`;
  return html;
}

export function render({ timeouts }) {
  if (!timeouts) {
    return `<div class="placeholder"><h2>Timeouts</h2><p>No timeout data available. Ensure a governed run is active.</p></div>`;
  }

  if (timeouts.ok === false) {
    const hint = timeouts.code === 'config_missing' || timeouts.code === 'state_missing'
      ? ' Run <code>agentxchain init --governed</code> to get started.'
      : '';
    return `<div class="placeholder"><h2>Timeouts</h2><p>${esc(timeouts.error || 'Failed to load timeout data.')}${hint}</p></div>`;
  }

  if (!timeouts.configured) {
    return `<div class="placeholder"><h2>Timeouts</h2><p>No <code>timeouts</code> configured in <code>agentxchain.json</code>. Add a <code>timeouts</code> section to enable time-limit enforcement.</p></div>`;
  }

  let html = `<div class="timeouts-view">`;

  // Header
  html += `<div class="run-header"><div class="run-meta">`;
  html += `<span class="phase-label"><strong>Timeouts</strong></span>`;
  html += badge('configured', 'var(--green)');
  const eventCount = Array.isArray(timeouts.events) ? timeouts.events.length : 0;
  if (eventCount > 0) {
    html += `<span class="turn-count">${eventCount} event${eventCount !== 1 ? 's' : ''} recorded</span>`;
  }
  html += `</div></div>`;

  // Config summary
  html += renderConfigTable(timeouts.config);

  // Live pressure
  if (timeouts.live) {
    html += renderLivePressure(timeouts.live);
  }

  // Persisted events
  html += renderEvents(timeouts.events);

  html += `</div>`;
  return html;
}
