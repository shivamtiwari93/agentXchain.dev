import {
  getCoordinatorBlockerDetails,
  summarizeCoordinatorAttention,
} from '../../src/lib/coordinator-blocker-presentation.js';
import { getCoordinatorPendingGateDetails } from '../../src/lib/coordinator-pending-gate-presentation.js';

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

function summarizeDecisionConstraints(barriers) {
  const entries = Object.entries(barriers || {});
  const pendingRequirementSets = [];
  let barrierCount = 0;
  let repoRequirementCount = 0;
  let requiredDecisionCount = 0;
  let satisfiedRequirementCount = 0;

  for (const [barrierId, barrier] of entries) {
    const decisionIdsByRepo = barrier?.required_decision_ids_by_repo || barrier?.alignment_decision_ids || null;
    if (!decisionIdsByRepo || typeof decisionIdsByRepo !== 'object' || Array.isArray(decisionIdsByRepo)) {
      continue;
    }

    const repoEntries = Object.entries(decisionIdsByRepo)
      .filter(([, ids]) => Array.isArray(ids) && ids.length > 0);
    if (repoEntries.length === 0) {
      continue;
    }

    barrierCount += 1;
    const satisfiedRepos = new Set(Array.isArray(barrier?.satisfied_repos) ? barrier.satisfied_repos : []);
    for (const [repoId, ids] of repoEntries) {
      repoRequirementCount += 1;
      requiredDecisionCount += ids.length;
      if (satisfiedRepos.has(repoId)) {
        satisfiedRequirementCount += 1;
      } else {
        pendingRequirementSets.push({ barrierId, repoId, decisionIds: ids });
      }
    }
  }

  if (barrierCount === 0) {
    return null;
  }

  return {
    barrier_count: barrierCount,
    repo_requirement_count: repoRequirementCount,
    required_decision_count: requiredDecisionCount,
    satisfied_requirement_count: satisfiedRequirementCount,
    pending_requirement_count: pendingRequirementSets.length,
    first_pending_requirement: pendingRequirementSets[0] || null,
    additional_pending_requirement_count: Math.max(0, pendingRequirementSets.length - 1),
  };
}

function renderPrimaryAction(action) {
  if (!action || typeof action !== 'object') {
    return '';
  }

  let html = `<div class="turn-card">
    <div class="turn-header"><span>Primary Action</span></div>`;
  if (action.reason) {
    html += `<div class="turn-summary">${esc(action.reason)}</div>`;
  }
  if (action.command) {
    html += `<pre class="recovery-command mono" data-copy="${esc(action.command)}">${esc(action.command)}</pre>`;
  }
  html += `</div>`;
  return html;
}

function renderDetailRows(details) {
  if (!Array.isArray(details) || details.length === 0) {
    return '';
  }

  let html = '';
  for (const detail of details) {
    html += `<dt>${esc(detail.label)}</dt><dd${detail.mono ? ' class="mono"' : ''}>${esc(detail.value)}</dd>`;
  }
  return html;
}

function renderCoordinatorAttentionSnapshot(coordinatorBlockers) {
  const summary = summarizeCoordinatorAttention(coordinatorBlockers);
  if (!summary) {
    return '';
  }

  const { active, blockers, nextActions, primaryBlocker, primaryAction } = summary;
  const hasBlockers = blockers.length > 0;
  const blockerDetails = getCoordinatorBlockerDetails(primaryBlocker);

  let html = `<div class="gate-card">
    <h3>${summary.title}</h3>
    <p class="section-subtitle">First-glance coordinator attention only. Full blocker diagnostics stay in the Blockers view.</p>
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
  if (primaryBlocker?.code) {
    html += `<dt>Primary Blocker</dt><dd class="mono">${esc(primaryBlocker.code)}</dd>`;
  }
  html += `</dl>`;

  if (coordinatorBlockers.mode === 'pending_gate') {
    html += `<p class="turn-summary">All coordinator prerequisites are satisfied. Human approval is the remaining action.</p>`;
  } else if (primaryBlocker) {
    html += `<div class="turn-card">
      <div class="turn-header"><span class="mono">${esc(primaryBlocker.code || 'unknown')}</span></div>`;
    if (primaryBlocker.message) {
      html += `<div class="turn-summary">${esc(primaryBlocker.message)}</div>`;
    }
    if (blockerDetails.length > 0) {
      html += `<dl class="detail-list">`;
      for (const detail of blockerDetails) {
        html += `<dt>${esc(detail.label)}</dt><dd${detail.mono ? ' class="mono"' : ''}>${esc(detail.value)}</dd>`;
      }
      html += `</dl>`;
    }
    html += `</div>`;
    if (summary.additionalBlockerCount > 0) {
      html += `<p class="turn-detail">${summary.additionalBlockerCount} additional blocker${summary.additionalBlockerCount !== 1 ? 's are' : ' is'} summarized in <a href="#blockers">Blockers</a>.</p>`;
    }
  } else if (coordinatorBlockers.blocked_reason) {
    html += `<p class="turn-summary">${esc(
      typeof coordinatorBlockers.blocked_reason === 'string'
        ? coordinatorBlockers.blocked_reason
        : JSON.stringify(coordinatorBlockers.blocked_reason)
    )}</p>`;
  }

  if (primaryAction) {
    html += `<div class="section" style="margin-top:12px">${renderPrimaryAction(primaryAction)}`;
    if (summary.additionalActionCount > 0) {
      html += `<p class="turn-detail">${summary.additionalActionCount} additional action${summary.additionalActionCount !== 1 ? 's remain' : ' remains'} in <a href="#blockers">Blockers</a>.</p>`;
    }
    html += `</div>`;
  }

  html += `<div class="gate-action">
    <p>Inspect full blocker diagnostics and ordered recovery steps:</p>
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
  const decisionConstraintSummary = summarizeDecisionConstraints(coordinatorBarriers);
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
    const blockerSnapshot = renderCoordinatorAttentionSnapshot(coordinatorBlockers);
    if (pendingGate) {
      const pendingGateDetails = getCoordinatorPendingGateDetails({ pendingGate });
      html += `<div class="gate-card">
        <h3>Pending Gate</h3>
        <p class="section-subtitle">Approval is the only remaining action. Detailed gate diagnostics stay in the Gates and Blockers views.</p>
        <dl class="detail-list">${renderDetailRows(pendingGateDetails)}</dl>`;
      if (!blockerSnapshot) {
        html += `<div class="gate-action">
          <p>Ordered coordinator actions are sourced from the Blockers contract.</p>
          <p><a href="#blockers">Open Blockers view</a></p>
        </div>`;
      }
      html += `</div>`;
    }
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

  if (decisionConstraintSummary) {
    html += `<div class="section"><h3>Cross-Run Constraints</h3><div class="initiative-grid">`;
    html += `<div class="gate-card">
      <h3>Decision Constraints</h3>
      <p class="section-subtitle">First-glance coordinator carryover only. Full per-barrier decision requirements stay in Barrier Snapshot.</p>
      <dl class="detail-list">
        <dt>Barriers</dt><dd>${decisionConstraintSummary.barrier_count}</dd>
        <dt>Repo Requirements</dt><dd>${decisionConstraintSummary.repo_requirement_count}</dd>
        <dt>Required IDs</dt><dd>${decisionConstraintSummary.required_decision_count}</dd>
        <dt>Pending</dt><dd>${decisionConstraintSummary.pending_requirement_count}</dd>
      </dl>`;

    if (decisionConstraintSummary.first_pending_requirement) {
      const pending = decisionConstraintSummary.first_pending_requirement;
      html += `<div class="turn-card">
        <div class="turn-header"><span>Next Pending Requirement</span></div>
        <div class="turn-detail"><span class="detail-label">Barrier:</span> <span class="mono">${esc(pending.barrierId)}</span></div>
        <div class="turn-detail"><span class="detail-label">Repo:</span> <span class="mono">${esc(pending.repoId)}</span></div>
        <div class="turn-detail"><span class="detail-label">Decision IDs:</span> <span class="mono">${esc(pending.decisionIds.join(', '))}</span></div>
      </div>`;
      if (decisionConstraintSummary.additional_pending_requirement_count > 0) {
        html += `<p class="turn-detail">${decisionConstraintSummary.additional_pending_requirement_count} additional pending requirement${decisionConstraintSummary.additional_pending_requirement_count !== 1 ? 's remain' : ' remains'} in Barrier Snapshot.</p>`;
      }
    } else {
      html += `<p class="turn-summary">All declared coordinator decision requirements are currently satisfied.</p>`;
    }

    html += `</div></div></div>`;
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
      const decisionIds = barrier.required_decision_ids_by_repo || barrier.alignment_decision_ids || null;
      if (decisionIds && typeof decisionIds === 'object' && !Array.isArray(decisionIds)) {
        const satisfiedSet = new Set(Array.isArray(barrier.satisfied_repos) ? barrier.satisfied_repos : []);
        html += `<div class="turn-detail"><span class="detail-label">Decision Requirements:</span></div>`;
        html += `<div class="decision-req-list" style="margin-left:1.2em;margin-top:0.3em">`;
        for (const [repo, ids] of Object.entries(decisionIds)) {
          if (!Array.isArray(ids) || ids.length === 0) continue;
          const repoSatisfied = satisfiedSet.has(repo);
          const idBadges = ids.map((id) =>
            repoSatisfied
              ? badge(`${id} ✓`, 'var(--green)')
              : badge(id, 'var(--text-dim)')
          ).join(' ');
          html += `<div style="margin-bottom:0.2em"><span class="mono" style="margin-right:0.5em">${esc(repo)}:</span>${idBadges}</div>`;
        }
        html += `</div>`;
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
