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

function statusColor(status) {
  const colors = {
    active: 'var(--green)',
    running: 'var(--green)',
    paused: 'var(--yellow)',
    blocked: 'var(--red)',
    completed: 'var(--accent)',
    linked: 'var(--text-dim)',
    initialized: 'var(--accent)',
    satisfied: 'var(--green)',
    partially_satisfied: 'var(--yellow)',
    pending: 'var(--text-dim)',
  };
  return colors[status] || 'var(--text-dim)';
}

function summarizeBarriers(barriers) {
  const counts = { pending: 0, partially_satisfied: 0, satisfied: 0, other: 0 };
  for (const barrier of Object.values(barriers || {})) {
    const key = counts[barrier?.status] != null ? barrier.status : 'other';
    counts[key] += 1;
  }
  return counts;
}

function renderCoordinatorAttentionSnapshot(coordinatorBlockers) {
  if (!coordinatorBlockers || coordinatorBlockers.ok === false) {
    return '';
  }

  const active = coordinatorBlockers.active || {};
  const blockers = Array.isArray(active.blockers)
    ? active.blockers.filter((blocker) => blocker?.code !== 'no_next_phase')
    : [];
  const hasBlockers = blockers.length > 0;
  const title = coordinatorBlockers.mode === 'pending_gate' ? 'Approval Snapshot' : 'Blocker Snapshot';

  let html = `<div class="gate-card">
    <h3>${title}</h3>
    <dl class="detail-list">`;
  if (coordinatorBlockers.mode) {
    html += `<dt>Mode</dt><dd>${esc(coordinatorBlockers.mode)}</dd>`;
  }
  if (active.gate_type) {
    html += `<dt>Type</dt><dd>${esc(active.gate_type)}</dd>`;
  }
  if (active.gate_id) {
    html += `<dt>Gate</dt><dd class="mono">${esc(active.gate_id)}</dd>`;
  }
  if (active.current_phase) {
    html += `<dt>Current</dt><dd>${esc(active.current_phase)}</dd>`;
  }
  if (active.target_phase) {
    html += `<dt>Target</dt><dd>${esc(active.target_phase)}</dd>`;
  }
  if (hasBlockers) {
    html += `<dt>Blockers</dt><dd>${blockers.length}</dd>`;
  }
  html += `</dl>`;

  if (coordinatorBlockers.mode === 'pending_gate') {
    html += `<p class="turn-summary">All coordinator prerequisites are satisfied. Human approval is the remaining action.</p>`;
  } else if (hasBlockers) {
    html += `<div class="turn-list">`;
    for (const blocker of blockers) {
      html += `<div class="turn-card">
        <div class="turn-header"><span class="mono">${esc(blocker.code || 'unknown')}</span></div>`;
      if (blocker.message) {
        html += `<div class="turn-summary">${esc(blocker.message)}</div>`;
      }
      if (blocker.repo_id || blocker.expected_run_id || blocker.actual_run_id) {
        html += `<dl class="detail-list">`;
        if (blocker.repo_id) html += `<dt>Repo</dt><dd class="mono">${esc(blocker.repo_id)}</dd>`;
        if (blocker.expected_run_id) html += `<dt>Expected</dt><dd class="mono">${esc(blocker.expected_run_id)}</dd>`;
        if (blocker.actual_run_id) html += `<dt>Actual</dt><dd class="mono">${esc(blocker.actual_run_id)}</dd>`;
        if (blocker.current_phase) html += `<dt>Current Phase</dt><dd>${esc(blocker.current_phase)}</dd>`;
        if (blocker.required_phase) html += `<dt>Required Phase</dt><dd>${esc(blocker.required_phase)}</dd>`;
        html += `</dl>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
  } else if (coordinatorBlockers.blocked_reason) {
    html += `<p class="turn-summary">${esc(
      typeof coordinatorBlockers.blocked_reason === 'string'
        ? coordinatorBlockers.blocked_reason
        : JSON.stringify(coordinatorBlockers.blocked_reason)
    )}</p>`;
  }

  html += `<div class="gate-action">
    <p>Inspect full diagnostics:</p>
    <p><a href="#blockers">Open Blockers view</a></p>
  </div>
</div>`;

  return html;
}

export function render({
  coordinatorState,
  coordinatorBarriers = {},
  barrierLedger = [],
  coordinatorBlockers = null,
}) {
  if (!coordinatorState) {
    return `<div class="placeholder"><h2>No Initiative</h2><p>No coordinator run found. Start one with <code class="mono">agentxchain multi init</code></p></div>`;
  }

  const repoRuns = Object.entries(coordinatorState.repo_runs || {});
  const barriers = Object.entries(coordinatorBarriers || {});
  const pendingGate = coordinatorState.pending_gate || null;
  const barrierCounts = summarizeBarriers(coordinatorBarriers);
  const recentBarrierTransitions = Array.isArray(barrierLedger)
    ? barrierLedger.slice(-5).reverse()
    : [];

  let html = `<div class="initiative-view">`;
  html += `<div class="run-header">
    <div class="run-meta">
      <span class="mono run-id">${esc(coordinatorState.super_run_id)}</span>
      ${badge(coordinatorState.status || 'unknown', statusColor(coordinatorState.status))}
      <span class="phase-label">Phase: <strong>${esc(coordinatorState.phase || 'unknown')}</strong></span>
      <span class="turn-count">${repoRuns.length} repo${repoRuns.length !== 1 ? 's' : ''}</span>
    </div>
  </div>`;

  if (pendingGate || coordinatorState.blocked_reason) {
    html += `<div class="section"><h3>Coordinator Attention</h3><div class="initiative-grid">`;
    if (pendingGate) {
      html += `<div class="gate-card">
        <h3>Pending Gate</h3>
        <dl class="detail-list">
          <dt>Type</dt><dd>${esc(pendingGate.gate_type)}</dd>
          <dt>Gate</dt><dd class="mono">${esc(pendingGate.gate)}</dd>`;
      if (pendingGate.from) html += `<dt>From</dt><dd>${esc(pendingGate.from)}</dd>`;
      if (pendingGate.to) html += `<dt>To</dt><dd>${esc(pendingGate.to)}</dd>`;
      if (Array.isArray(pendingGate.required_repos) && pendingGate.required_repos.length > 0) {
        html += `<dt>Repos</dt><dd>${esc(pendingGate.required_repos.join(', '))}</dd>`;
      }
      html += `</dl>
        <div class="gate-action">
          <p>Approve with:</p>
          <pre class="recovery-command mono" data-copy="agentxchain multi approve-gate">agentxchain multi approve-gate</pre>
        </div>
      </div>`;
    }
    const blockerSnapshot = renderCoordinatorAttentionSnapshot(coordinatorBlockers);
    if (blockerSnapshot) {
      html += blockerSnapshot;
    } else if (coordinatorState.blocked_reason) {
      html += `<div class="gate-card">
        <h3>Blocked State</h3>
        <p class="turn-summary">${esc(
          typeof coordinatorState.blocked_reason === 'string'
            ? coordinatorState.blocked_reason
            : JSON.stringify(coordinatorState.blocked_reason)
        )}</p>
      </div>`;
    }
    html += `</div></div>`;
  }

  html += `<div class="section"><h3>Repo Runs</h3><table class="data-table">
    <thead><tr><th>Repo</th><th>Run</th><th>Status</th><th>Phase</th></tr></thead><tbody>`;
  for (const [repoId, repoRun] of repoRuns) {
    html += `<tr>
      <td class="mono">${esc(repoId)}</td>
      <td class="mono">${esc(repoRun.run_id || '-')}</td>
      <td>${badge(repoRun.status || 'unknown', statusColor(repoRun.status))}</td>
      <td>${esc(repoRun.phase || '-')}</td>
    </tr>`;
  }
  html += `</tbody></table></div>`;

  html += `<div class="section"><h3>Barrier Snapshot</h3>
    <p class="section-subtitle">Pending ${barrierCounts.pending}, partial ${barrierCounts.partially_satisfied}, satisfied ${barrierCounts.satisfied}</p>`;
  if (barriers.length === 0) {
    html += `<div class="placeholder compact"><p>No barriers recorded.</p></div>`;
  } else {
    html += `<div class="turn-list">`;
    for (const [barrierId, barrier] of barriers) {
      html += `<div class="turn-card">
        <div class="turn-header">
          <span class="mono">${esc(barrierId)}</span>
          ${badge(barrier.status || 'unknown', statusColor(barrier.status))}
        </div>
        <div class="turn-detail"><span class="detail-label">Workstream:</span> ${esc(barrier.workstream_id || '-')}</div>
        <div class="turn-detail"><span class="detail-label">Type:</span> ${esc(barrier.type || '-')}</div>`;
      if (Array.isArray(barrier.required_repos) && barrier.required_repos.length > 0) {
        html += `<div class="turn-detail"><span class="detail-label">Required Repos:</span> ${esc(barrier.required_repos.join(', '))}</div>`;
      }
      if (Array.isArray(barrier.satisfied_repos) && barrier.satisfied_repos.length > 0) {
        html += `<div class="turn-detail"><span class="detail-label">Satisfied Repos:</span> ${esc(barrier.satisfied_repos.join(', '))}</div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
  }
  html += `</div>`;

  if (recentBarrierTransitions.length > 0) {
    html += `<div class="section"><h3>Recent Barrier Transitions</h3><div class="annotation-list">`;
    for (const entry of recentBarrierTransitions) {
      html += `<div class="annotation-card">
        <span class="mono">${esc(entry.barrier_id || '-')}</span>
        <span>${esc(`${entry.previous_status || 'unknown'} -> ${entry.new_status || 'unknown'}`)}</span>
      </div>`;
    }
    html += `</div></div>`;
  }

  html += `</div>`;
  return html;
}
