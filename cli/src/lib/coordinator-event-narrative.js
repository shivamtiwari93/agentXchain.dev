function countLabel(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function summarizeCoordinatorEvent(entry) {
  const type = entry?.type || 'unknown';
  const ts = entry?.timestamp || '';

  switch (type) {
    case 'run_initialized': {
      const repoCount = entry?.repo_runs ? Object.keys(entry.repo_runs).length : 0;
      return `Coordinator run initialized with ${countLabel(repoCount, 'repo')}`;
    }
    case 'turn_dispatched':
      return `Dispatched turn to ${entry?.repo_id || 'unknown'} (${entry?.role || '?'}) in workstream ${entry?.workstream_id || 'unknown'}`;
    case 'acceptance_projection': {
      const turnRef = entry?.repo_turn_id ? ` (turn ${entry.repo_turn_id})` : '';
      const summaryText = entry?.summary ? ` — ${entry.summary}` : '';
      return `Projected acceptance from ${entry?.repo_id || 'unknown'}${turnRef}${summaryText}`;
    }
    case 'context_generated': {
      const upstreamCount = Array.isArray(entry?.upstream_repo_ids) ? entry.upstream_repo_ids.length : 0;
      return `Generated cross-repo context for ${entry?.target_repo_id || 'unknown'} from ${countLabel(upstreamCount, 'upstream repo')}`;
    }
    case 'phase_transition_requested':
      return `Requested phase transition: ${entry?.from || '?'} → ${entry?.to || '?'}`;
    case 'phase_transition_approved':
      return `Phase transition approved: ${entry?.from || '?'} → ${entry?.to || '?'}`;
    case 'run_completion_requested':
      return `Requested run completion (gate: ${entry?.gate || 'unknown'})`;
    case 'run_completed':
      return 'Coordinator run completed';
    case 'state_resynced': {
      const resyncedCount = Array.isArray(entry?.resynced_repos) ? entry.resynced_repos.length : 0;
      const barrierChangeCount = Array.isArray(entry?.barrier_changes) ? entry.barrier_changes.length : 0;
      return `Resynced state for ${countLabel(resyncedCount, 'repo')}, ${countLabel(barrierChangeCount, 'barrier change')}`;
    }
    case 'blocked_resolved':
      return `Blocked state resolved: ${entry?.from || '?'} → ${entry?.to || '?'}`;
    default:
      return `${type} event${ts ? ` at ${ts}` : ''}`;
  }
}
