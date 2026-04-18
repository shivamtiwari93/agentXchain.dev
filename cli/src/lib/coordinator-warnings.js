import { readRunEvents } from './run-events.js';

function normalizeCoordinatorWarning(event) {
  return {
    event_id: event.event_id,
    timestamp: event.timestamp,
    run_id: event.run_id || null,
    workstream_id: event.payload?.workstream_id || null,
    repo_id: event.payload?.repo_id || null,
    reissued_turn_id: event.payload?.reissued_turn_id || null,
    warning_code: event.payload?.warning_code || 'coordinator_acceptance_projection_incomplete',
    warning_message: event.payload?.warning_message || null,
  };
}

export function readCoordinatorWarnings(root, { runId = null } = {}) {
  const events = readRunEvents(root, { type: 'coordinator_retry_projection_warning' });
  const filtered = runId
    ? events.filter((event) => event.run_id === runId)
    : events;

  if (filtered.length === 0) {
    return { count: 0, reconciliation_required: false, warnings: [] };
  }

  return {
    count: filtered.length,
    reconciliation_required: true,
    warnings: filtered.map(normalizeCoordinatorWarning),
  };
}
