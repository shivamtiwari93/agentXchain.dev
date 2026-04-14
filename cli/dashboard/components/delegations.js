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

function statusColor(status) {
  const colors = {
    pending: 'var(--text-dim)',
    active: 'var(--yellow)',
    completed: 'var(--green)',
    failed: 'var(--red)',
    review_pending: 'var(--yellow)',
    reviewed: 'var(--accent)',
    unknown: 'var(--text-dim)',
  };
  return colors[status] || 'var(--text-dim)';
}

function summarizeReview(results) {
  const counts = { completed: 0, failed: 0, other: 0 };
  for (const result of results || []) {
    if (result?.status === 'completed') counts.completed += 1;
    else if (result?.status === 'failed') counts.failed += 1;
    else counts.other += 1;
  }
  return counts;
}

function normalizeDelegationChain(parentEntry, state, history) {
  const issued = Array.isArray(parentEntry?.delegations_issued) ? parentEntry.delegations_issued : [];
  const pendingQueue = Array.isArray(state?.delegation_queue)
    ? state.delegation_queue.filter((entry) => entry.parent_turn_id === parentEntry.turn_id)
    : [];
  const pendingReview = state?.pending_delegation_review?.parent_turn_id === parentEntry.turn_id
    ? state.pending_delegation_review
    : null;
  const reviewEntry = Array.isArray(history)
    ? history.find((entry) => entry?.delegation_review?.parent_turn_id === parentEntry.turn_id)
    : null;

  const delegations = issued.map((item) => {
    const queueEntry = pendingQueue.find((entry) => entry.delegation_id === item.id) || null;
    const reviewResult = Array.isArray(pendingReview?.delegation_results)
      ? pendingReview.delegation_results.find((entry) => entry.delegation_id === item.id)
      : null;
    const reviewHistoryResult = Array.isArray(reviewEntry?.delegation_review?.results)
      ? reviewEntry.delegation_review.results.find((entry) => entry.delegation_id === item.id)
      : null;
    const childTurn = Array.isArray(history)
      ? history.find((entry) => entry?.delegation_context?.delegation_id === item.id)
      : null;

    return {
      delegation_id: item.id,
      to_role: item.to_role,
      charter: item.charter,
      acceptance_contract: Array.isArray(item.acceptance_contract) ? item.acceptance_contract : [],
      status: queueEntry?.status
        || reviewResult?.status
        || reviewHistoryResult?.status
        || childTurn?.status
        || 'unknown',
      child_turn_id: queueEntry?.child_turn_id
        || reviewResult?.child_turn_id
        || reviewHistoryResult?.child_turn_id
        || childTurn?.turn_id
        || null,
      summary: reviewResult?.summary
        || reviewHistoryResult?.summary
        || childTurn?.summary
        || null,
      files_changed: reviewResult?.files_changed
        || reviewHistoryResult?.files_changed
        || childTurn?.files_changed
        || [],
    };
  });

  let chainStatus = 'unknown';
  if (pendingReview) chainStatus = 'review_pending';
  else if (pendingQueue.length > 0) chainStatus = delegations.some((entry) => entry.status === 'active') ? 'active' : 'pending';
  else if (reviewEntry) chainStatus = 'reviewed';
  else if (delegations.length > 0) chainStatus = delegations.every((entry) => entry.status === 'completed' || entry.status === 'failed') ? 'reviewed' : 'unknown';

  return {
    parent_turn_id: parentEntry.turn_id,
    parent_role: parentEntry.role,
    parent_summary: parentEntry.summary || '(no summary)',
    accepted_at: parentEntry.accepted_at || null,
    status: chainStatus,
    delegations,
    pending_review: pendingReview,
    review_entry: reviewEntry,
  };
}

function renderAcceptanceContract(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<span class="turn-detail">No acceptance contract recorded.</span>';
  }
  return `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`;
}

function renderChainCard(chain) {
  const reviewResults = chain.pending_review?.delegation_results
    || chain.review_entry?.delegation_review?.results
    || [];
  const reviewCounts = summarizeReview(reviewResults);

  let html = `<div class="turn-card">
    <div class="turn-header">
      ${badge(chain.parent_role || 'unknown', '#fb923c')}
      <span class="mono">${esc(chain.parent_turn_id)}</span>
      ${badge(chain.status.replace(/_/g, ' '), statusColor(chain.status))}
    </div>
    <div class="turn-summary">${esc(chain.parent_summary)}</div>`;

  if (chain.accepted_at) {
    html += `<div class="turn-detail"><span class="detail-label">Accepted:</span> ${esc(chain.accepted_at)}</div>`;
  }

  html += `<div class="turn-detail"><span class="detail-label">Delegations:</span> ${esc(chain.delegations.length)}</div>`;

  if (chain.delegations.length > 0) {
    html += `<div class="turn-list">`;
    for (const delegation of chain.delegations) {
      html += `<div class="turn-card">
        <div class="turn-header">
          <span class="mono">${esc(delegation.delegation_id)}</span>
          ${badge(delegation.to_role || 'unknown', '#38bdf8')}
          ${badge(delegation.status, statusColor(delegation.status))}
        </div>
        <div class="turn-detail"><span class="detail-label">Charter:</span> ${esc(delegation.charter || '(none)')}</div>
        <div class="turn-detail"><span class="detail-label">Acceptance Contract:</span>${renderAcceptanceContract(delegation.acceptance_contract)}</div>`;
      if (delegation.child_turn_id) {
        html += `<div class="turn-detail"><span class="detail-label">Child Turn:</span> <span class="mono">${esc(delegation.child_turn_id)}</span></div>`;
      }
      if (delegation.summary) {
        html += `<div class="turn-detail"><span class="detail-label">Outcome:</span> ${esc(delegation.summary)}</div>`;
      }
      if (Array.isArray(delegation.files_changed) && delegation.files_changed.length > 0) {
        html += `<div class="turn-detail"><span class="detail-label">Files:</span> <span class="mono">${delegation.files_changed.map((item) => esc(item)).join(', ')}</span></div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
  }

  if (chain.pending_review) {
    html += `<div class="turn-detail"><span class="detail-label">Review Pending:</span> ${esc(chain.pending_review.parent_role)} is reviewing ${reviewResults.length} delegated result${reviewResults.length === 1 ? '' : 's'}.</div>`;
  } else if (chain.review_entry) {
    html += `<div class="turn-detail"><span class="detail-label">Review Turn:</span> <span class="mono">${esc(chain.review_entry.turn_id)}</span></div>`;
  }

  if (reviewResults.length > 0) {
    html += `<div class="turn-detail"><span class="detail-label">Review Summary:</span> ${reviewCounts.completed} completed, ${reviewCounts.failed} failed</div>`;
  }

  html += `</div>`;
  return html;
}

export function render({ state, history }) {
  if (!state) {
    return `<div class="placeholder"><h2>No Run</h2><p>No governed run found. Start one with <code class="mono">agentxchain init --governed</code></p></div>`;
  }

  const historyEntries = Array.isArray(history) ? history : [];
  const parentTurns = historyEntries
    .filter((entry) => Array.isArray(entry?.delegations_issued) && entry.delegations_issued.length > 0)
    .reverse();
  const chains = parentTurns.map((entry) => normalizeDelegationChain(entry, state, historyEntries));
  const queue = Array.isArray(state.delegation_queue) ? state.delegation_queue : [];
  const pendingReview = state.pending_delegation_review || null;

  if (chains.length === 0 && queue.length === 0 && !pendingReview) {
    return `<div class="placeholder"><h2>No Delegations</h2><p>This run has no delegation chains yet. Delegation state will appear here once a turn emits a <code class="mono">delegations</code> array.</p></div>`;
  }

  let html = `<div class="delegations-view">`;

  html += `<div class="run-header">
    <div class="run-meta">
      <span class="mono run-id">${esc(state.run_id || 'unknown')}</span>
      ${badge(state.status || 'unknown', statusColor(state.status || 'unknown'))}
      <span class="phase-label">Phase: <strong>${esc(state.phase || 'unknown')}</strong></span>
      <span class="turn-count">${chains.length} chain${chains.length === 1 ? '' : 's'} recorded</span>
    </div>
  </div>`;

  if (queue.length > 0 || pendingReview) {
    html += `<div class="section"><h3>Live Delegation State</h3><div class="turn-list">`;
    if (queue.length > 0) {
      html += `<div class="turn-card">
        <div class="turn-header">
          <span class="mono">delegation_queue</span>
          ${badge(`${queue.length} item${queue.length === 1 ? '' : 's'}`, statusColor('pending'))}
        </div>`;
      for (const entry of queue) {
        html += `<div class="turn-detail"><span class="detail-label">${esc(entry.delegation_id)}:</span> ${esc(entry.parent_role || 'unknown')} → ${esc(entry.to_role || 'unknown')} (${esc(entry.status || 'unknown')})</div>`;
      }
      html += `</div>`;
    }
    if (pendingReview) {
      const counts = summarizeReview(pendingReview.delegation_results);
      html += `<div class="turn-card">
        <div class="turn-header">
          <span class="mono">${esc(pendingReview.parent_turn_id)}</span>
          ${badge('review pending', statusColor('review_pending'))}
        </div>
        <div class="turn-detail"><span class="detail-label">Parent Role:</span> ${esc(pendingReview.parent_role || 'unknown')}</div>
        <div class="turn-detail"><span class="detail-label">Results:</span> ${counts.completed} completed, ${counts.failed} failed</div>
      </div>`;
    }
    html += `</div></div>`;
  }

  html += `<div class="section"><h3>Delegation Chains</h3>`;
  if (chains.length === 0) {
    html += `<div class="placeholder compact"><p>No completed delegation chains recorded yet.</p></div>`;
  } else {
    html += `<div class="turn-list">${chains.map((chain) => renderChainCard(chain)).join('')}</div>`;
  }
  html += `</div>`;

  html += `</div>`;
  return html;
}
