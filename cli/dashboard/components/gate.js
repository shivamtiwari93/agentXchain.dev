/**
 * Gate Review view — renders pending phase transitions and run completion gates.
 *
 * Pure render function: takes data, returns HTML string. Testable in Node.js.
 * Shows a narrow local approve action plus the exact CLI fallback command.
 */

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

function isPhaseBoundaryEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return false;
  }

  if (entry.phase_transition === true) {
    return true;
  }

  return typeof entry.phase_transition_request === 'string' && entry.phase_transition_request.trim().length > 0;
}

function findPostGateTurns(history, requestedByTurn) {
  if (!Array.isArray(history) || history.length === 0) {
    return [];
  }

  if (!requestedByTurn) {
    return history.slice();
  }

  const requestedIdx = history.findIndex((entry) => entry.turn_id === requestedByTurn);
  if (requestedIdx === -1) {
    return history.slice();
  }

  // Include the requesting turn and all turns after the most recent accepted
  // phase-transition request. history.jsonl persists phase_transition_request,
  // not a synthetic phase_transition marker.
  let startIdx = 0;
  for (let i = requestedIdx - 1; i >= 0; i--) {
    if (isPhaseBoundaryEntry(history[i])) {
      startIdx = i + 1;
      break;
    }
  }

  return history.slice(startIdx, requestedIdx + 1);
}

function aggregateEvidence(turns) {
  const summaries = [];
  const allObjections = [];
  const allRisks = [];
  const allDecisions = [];
  const allFiles = [];

  for (const turn of turns) {
    if (turn.summary) {
      const role = turn.assigned_role || turn.role || turn.agent || 'agent';
      summaries.push({ role, summary: turn.summary, turn_id: turn.turn_id });
    }
    if (Array.isArray(turn.objections)) {
      for (const obj of turn.objections) {
        allObjections.push(obj);
      }
    }
    if (Array.isArray(turn.risks)) {
      for (const risk of turn.risks) {
        allRisks.push(risk);
      }
    }
    if (Array.isArray(turn.decisions)) {
      for (const dec of turn.decisions) {
        allDecisions.push(dec);
      }
    }
    const observed = turn.observed_artifact?.files_changed;
    const files = (Array.isArray(observed) && observed.length > 0) ? observed : (turn.files_changed || []);
    for (const f of files) {
      if (!allFiles.includes(f)) {
        allFiles.push(f);
      }
    }
  }

  return { summaries, objections: allObjections, risks: allRisks, decisions: allDecisions, files: allFiles };
}

function renderList(title, items, formatter = (item) => item) {
  if (!Array.isArray(items) || items.length === 0) {
    return '';
  }

  const rows = items
    .map((item) => formatter(item))
    .filter(Boolean)
    .map((item) => `<li>${esc(item)}</li>`)
    .join('');

  if (!rows) {
    return '';
  }

  return `<div class="gate-support">
    <p><strong>${esc(title)}:</strong></p>
    <ul>${rows}</ul>
  </div>`;
}

function renderApproveControls({ buttonLabel, cliCommand }) {
  return `
      <div class="gate-controls">
        <button class="gate-button" type="button" data-dashboard-action="approve-gate" data-action-label="${esc(buttonLabel)}">${esc(buttonLabel)}</button>
      </div>
      <div class="gate-action">
        <p>CLI fallback:</p>
        <pre class="recovery-command mono" data-copy="${esc(cliCommand)}">${esc(cliCommand)}</pre>
      </div>`;
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

export { findPostGateTurns, aggregateEvidence };

function findCoordinatorGateRequest(history, pendingGate) {
  if (!Array.isArray(history) || !pendingGate?.gate) {
    return null;
  }

  const requestedType = pendingGate.gate_type === 'phase_transition'
    ? 'phase_transition_requested'
    : 'run_completion_requested';

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];
    if (entry?.type === requestedType && entry.gate === pendingGate.gate) {
      return { entry, index: i };
    }
  }

  return null;
}

function findCoordinatorGateEvidence(history, pendingGate) {
  if (!Array.isArray(history) || history.length === 0 || !pendingGate) {
    return [];
  }

  const gateRequest = findCoordinatorGateRequest(history, pendingGate);
  const endIndex = gateRequest ? gateRequest.index : history.length;
  let startIndex = 0;

  for (let i = endIndex - 1; i >= 0; i -= 1) {
    if (history[i]?.type === 'phase_transition_approved') {
      startIndex = i + 1;
      break;
    }
  }

  return history
    .slice(startIndex, endIndex)
    .filter((entry) => entry?.type === 'acceptance_projection');
}

function aggregateCoordinatorEvidence(entries) {
  const summaries = [];
  const decisions = [];
  const files = [];

  for (const entry of entries) {
    summaries.push({
      role: entry.repo_id || 'repo',
      summary: entry.summary || 'Accepted turn projected',
      turn_id: entry.repo_turn_id || entry.projection_ref || '-',
    });

    if (Array.isArray(entry.decisions)) {
      for (const decision of entry.decisions) {
        decisions.push(decision);
      }
    }

    for (const file of entry.files_changed || []) {
      if (!files.includes(file)) {
        files.push(file);
      }
    }
  }

  return { summaries, decisions, objections: [], risks: [], files };
}

function renderGateActionsSection(gateActions) {
  if (!gateActions) return '';

  const configured = Array.isArray(gateActions.configured) ? gateActions.configured : [];
  const attempt = gateActions.latest_attempt || null;

  if (configured.length === 0 && !attempt) return '';

  let html = `<div class="gate-support"><p><strong>Gate Actions:</strong></p>`;

  if (configured.length > 0) {
    html += `<ul>`;
    for (const action of configured) {
      const label = action.label || action.run || `action ${action.index || '?'}`;
      html += `<li><span class="mono">${esc(String(action.index || '?'))}.</span> ${esc(label)}</li>`;
    }
    html += `</ul>`;
  }

  if (attempt) {
    const statusLabel = attempt.status === 'failed' ? '❌ Failed' : '✅ Succeeded';
    html += `<p><strong>Last Attempt:</strong> ${esc(statusLabel)} at ${esc(attempt.attempted_at || 'unknown')}</p>`;
    if (Array.isArray(attempt.actions) && attempt.actions.length > 0) {
      html += `<ul>`;
      for (const a of attempt.actions) {
        const aLabel = a.action_label || a.command || `action ${a.action_index || '?'}`;
        const outcome = a.status === 'failed' ? '❌' : '✅';
        const exitStr = a.exit_code != null ? ` (exit ${a.exit_code})` : '';
        html += `<li>${outcome} ${esc(aLabel)}${esc(exitStr)}</li>`;
      }
      html += `</ul>`;
    }
  }

  html += `</div>`;
  return html;
}

export function render({
  state,
  history = [],
  coordinatorState = null,
  coordinatorHistory = [],
  coordinatorBarriers = {},
  gateActions = null,
}) {
  const repoPendingTransition = state?.pending_phase_transition || null;
  const repoPendingCompletion = state?.pending_run_completion || null;
  const coordinatorPendingGate = coordinatorState?.pending_gate || null;
  const pendingTransition = repoPendingTransition || (coordinatorPendingGate?.gate_type === 'phase_transition' ? coordinatorPendingGate : null);
  const pendingCompletion = repoPendingCompletion || (coordinatorPendingGate?.gate_type === 'run_completion' ? coordinatorPendingGate : null);
  const isCoordinator = Boolean(!repoPendingTransition && !repoPendingCompletion && coordinatorPendingGate);

  if (!pendingTransition && !pendingCompletion) {
    const status = state?.status || coordinatorState?.status || 'unknown';
    if (status === 'paused') {
      return `<div class="placeholder"><h2>Gate Review</h2><p>Run is paused. A human gate approval may be pending. Check <code class="mono">agentxchain status</code> for details.</p></div>`;
    }
    return `<div class="placeholder"><h2>Gate Review</h2><p>No pending gates. The run will pause when a human approval is required.</p></div>`;
  }

  let html = `<div class="gate-view">`;

  if (pendingTransition) {
    const postGateTurns = isCoordinator
      ? findCoordinatorGateEvidence(coordinatorHistory, pendingTransition)
      : findPostGateTurns(history, pendingTransition.requested_by_turn);
    const evidence = isCoordinator
      ? aggregateCoordinatorEvidence(postGateTurns)
      : aggregateEvidence(postGateTurns);
    const coordinatorDetails = isCoordinator
      ? getCoordinatorPendingGateDetails({ pendingGate: pendingTransition, includeHumanBarriers: false })
      : [];
    html += `<div class="gate-card">
      <h3>Phase Transition Gate</h3>
      <dl class="detail-list">`;
    if (isCoordinator) {
      html += renderDetailRows(coordinatorDetails);
    } else {
      html += `<dt>From</dt><dd>${esc(pendingTransition.from || state?.phase || coordinatorState?.phase)}</dd>
        <dt>To</dt><dd>${esc(pendingTransition.to)}</dd>`;
      if (pendingTransition.gate) {
        html += `<dt>Gate</dt><dd class="mono">${esc(pendingTransition.gate)}</dd>`;
      }
    }
    if (pendingTransition.requested_by_turn) {
      html += `<dt>Requested By</dt><dd class="mono">${esc(pendingTransition.requested_by_turn)}</dd>`;
    }
    if (postGateTurns.length > 0) {
      html += `<dt>Evidence Turns</dt><dd>${postGateTurns.length} turn${postGateTurns.length !== 1 ? 's' : ''}</dd>`;
    }
    html += `</dl>`;
    if (evidence.summaries.length > 0) {
      html += `<div class="gate-evidence"><h4>Agent Summaries</h4><ul>`;
      for (const s of evidence.summaries) {
        html += `<li><strong>${esc(s.role)}</strong> (${esc(s.turn_id)}): ${esc(s.summary)}</li>`;
      }
      html += `</ul></div>`;
    }
    html += renderList('Objections', evidence.objections, (item) => item?.statement || item);
    html += renderList('Risks', evidence.risks, (item) => item?.statement || item);
    html += renderList('Decisions', evidence.decisions, (item) => item?.statement || item);
    if (evidence.files.length > 0) {
      html += `<div class="gate-support"><p><strong>Files Changed:</strong></p><ul>${evidence.files.map(f => `<li class="mono">${esc(f)}</li>`).join('')}</ul></div>`;
    }
    if (isCoordinator) {
      const pendingBarriers = Object.entries(coordinatorBarriers || {}).filter(([, barrier]) => barrier?.status !== 'satisfied');
      if (pendingBarriers.length > 0) {
        html += `<div class="gate-support"><p><strong>Coordinator Barriers:</strong></p><ul>${pendingBarriers.map(([barrierId, barrier]) => (
          `<li>${esc(`${barrierId}: ${barrier.status}`)}</li>`
        )).join('')}</ul></div>`;
      }
    }
    if (!isCoordinator) {
      html += renderGateActionsSection(gateActions);
    }
    html += renderApproveControls({
      buttonLabel: isCoordinator ? 'Approve Coordinator Gate' : 'Approve Transition',
      cliCommand: isCoordinator ? 'agentxchain multi approve-gate' : 'agentxchain approve-transition',
    });
    html += `</div>`;
  }

  if (pendingCompletion) {
    const postGateTurns = isCoordinator
      ? findCoordinatorGateEvidence(coordinatorHistory, pendingCompletion)
      : findPostGateTurns(history, pendingCompletion.requested_by_turn);
    const evidence = isCoordinator
      ? aggregateCoordinatorEvidence(postGateTurns)
      : aggregateEvidence(postGateTurns);
    const coordinatorDetails = isCoordinator
      ? getCoordinatorPendingGateDetails({ pendingGate: pendingCompletion, includeHumanBarriers: false })
      : [];
    html += `<div class="gate-card">
      <h3>Run Completion Gate</h3>
      <dl class="detail-list">`;
    if (isCoordinator) {
      html += renderDetailRows(coordinatorDetails);
    } else if (pendingCompletion.gate) {
      html += `<dt>Gate</dt><dd class="mono">${esc(pendingCompletion.gate)}</dd>`;
    }
    if (pendingCompletion.requested_by_turn) {
      html += `<dt>Requested By</dt><dd class="mono">${esc(pendingCompletion.requested_by_turn)}</dd>`;
    }
    if (postGateTurns.length > 0) {
      html += `<dt>Evidence Turns</dt><dd>${postGateTurns.length} turn${postGateTurns.length !== 1 ? 's' : ''}</dd>`;
    }
    html += `</dl>`;
    if (evidence.summaries.length > 0) {
      html += `<div class="gate-evidence"><h4>Agent Summaries</h4><ul>`;
      for (const s of evidence.summaries) {
        html += `<li><strong>${esc(s.role)}</strong> (${esc(s.turn_id)}): ${esc(s.summary)}</li>`;
      }
      html += `</ul></div>`;
    }
    html += renderList('Objections', evidence.objections, (item) => item?.statement || item);
    html += renderList('Risks', evidence.risks, (item) => item?.statement || item);
    html += renderList('Decisions', evidence.decisions, (item) => item?.statement || item);
    if (evidence.files.length > 0) {
      html += `<div class="gate-support"><p><strong>Files Changed:</strong></p><ul>${evidence.files.map(f => `<li class="mono">${esc(f)}</li>`).join('')}</ul></div>`;
    }
    if (!isCoordinator) {
      html += renderGateActionsSection(gateActions);
    }
    html += renderApproveControls({
      buttonLabel: isCoordinator ? 'Approve Coordinator Gate' : 'Approve Completion',
      cliCommand: isCoordinator ? 'agentxchain multi approve-gate' : 'agentxchain approve-completion',
    });
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}
