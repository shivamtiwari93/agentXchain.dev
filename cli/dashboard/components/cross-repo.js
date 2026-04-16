import { renderLiveStatus } from './live-status.js';
import { summarizeCoordinatorEvent } from '../../src/lib/coordinator-event-narrative.js';

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hashColor(seed) {
  const palette = ['#38bdf8', '#fb7185', '#34d399', '#f59e0b', '#a78bfa', '#f97316'];
  let hash = 0;
  for (const char of String(seed || 'repo')) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  return palette[Math.abs(hash) % palette.length];
}

function badge(label, color) {
  return `<span class="badge" style="color:${color};border-color:${color}">${esc(label)}</span>`;
}

function describeEvent(entry) {
  switch (entry?.type) {
    case 'run_initialized':
      return {
        title: 'Coordinator Initialized',
        detail: summarizeCoordinatorEvent(entry),
      };
    case 'turn_dispatched':
      return {
        title: 'Turn Dispatched',
        detail: summarizeCoordinatorEvent(entry),
      };
    case 'acceptance_projection':
      return {
        title: 'Acceptance Projected',
        detail: summarizeCoordinatorEvent(entry),
      };
    case 'context_generated':
      return {
        title: 'Context Generated',
        detail: summarizeCoordinatorEvent(entry),
      };
    case 'phase_transition_requested':
      return {
        title: 'Phase Gate Requested',
        detail: summarizeCoordinatorEvent(entry),
      };
    case 'phase_transition_approved':
      return {
        title: 'Phase Gate Approved',
        detail: summarizeCoordinatorEvent(entry),
      };
    case 'run_completion_requested':
      return {
        title: 'Completion Gate Requested',
        detail: summarizeCoordinatorEvent(entry),
      };
    case 'run_completed':
      return {
        title: 'Initiative Completed',
        detail: summarizeCoordinatorEvent(entry),
      };
    case 'state_resynced':
      return {
        title: 'Coordinator Resynced',
        detail: summarizeCoordinatorEvent(entry),
      };
    default:
      return {
        title: entry?.type || 'Unknown Event',
        detail: summarizeCoordinatorEvent(entry),
      };
  }
}

export function render({ coordinatorState, coordinatorHistory = [], liveMeta = null }) {
  if (!coordinatorState) {
    return `<div class="placeholder"><h2>No Cross-Repo Timeline</h2><p>No coordinator run found. Start one with <code class="mono">agentxchain multi init</code></p></div>`;
  }

  const events = Array.isArray(coordinatorHistory) ? [...coordinatorHistory].reverse() : [];
  if (events.length === 0) {
    return `<div class="placeholder"><h2>Cross-Repo Timeline</h2><p>No coordinator history recorded yet.</p></div>`;
  }

  let html = `<div class="timeline-view">`;
  html += renderLiveStatus(liveMeta);
  html += `<div class="section"><h3>Cross-Repo Timeline</h3><div class="turn-list">`;
  for (const entry of events) {
    const event = describeEvent(entry);
    const repoId = entry.repo_id || entry.target_repo_id || null;
    const workstreamId = entry.workstream_id || null;
    const repoColor = hashColor(repoId || workstreamId || entry.type);

    html += `<div class="turn-card">
      <div class="turn-header">
        <strong>${esc(event.title)}</strong>`;
    if (repoId) {
      html += badge(repoId, repoColor);
    }
    if (workstreamId) {
      html += badge(workstreamId, 'var(--accent)');
    }
    if (entry.timestamp) {
      html += `<span class="turn-status mono">${esc(entry.timestamp)}</span>`;
    }
    html += `</div>
      <div class="turn-summary">${esc(event.detail)}</div>`;

    if (entry.repo_turn_id) {
      html += `<div class="turn-detail"><span class="detail-label">Repo Turn:</span> <span class="mono">${esc(entry.repo_turn_id)}</span></div>`;
    }
    if (entry.context_ref) {
      html += `<div class="turn-detail"><span class="detail-label">Context Ref:</span> <span class="mono">${esc(entry.context_ref)}</span></div>`;
    }
    if (Array.isArray(entry.barrier_changes) && entry.barrier_changes.length > 0) {
      html += `<div class="turn-detail"><span class="detail-label">Barrier Changes:</span><ul>${entry.barrier_changes.map((change) => (
        `<li>${esc(`${change.barrier_id}: ${change.previous_status} -> ${change.new_status}`)}</li>`
      )).join('')}</ul></div>`;
    }
    html += `</div>`;
  }
  html += `</div></div></div>`;
  return html;
}
