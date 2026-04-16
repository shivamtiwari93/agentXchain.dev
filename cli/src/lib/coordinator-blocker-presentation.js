function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pushDetail(details, label, value, options = {}) {
  if (value == null || value === '') {
    return;
  }

  details.push({
    label,
    value: String(value),
    mono: options.mono === true,
  });
}

export function getCoordinatorBlockerDetails(blocker) {
  if (!isObject(blocker)) {
    return [];
  }

  const details = [];
  switch (blocker.code) {
    case 'repo_run_id_mismatch':
      pushDetail(details, 'Repo', blocker.repo_id, { mono: true });
      pushDetail(details, 'Expected', blocker.expected_run_id, { mono: true });
      pushDetail(details, 'Actual', blocker.actual_run_id, { mono: true });
      break;
    case 'repo_not_ready':
      pushDetail(details, 'Repo', blocker.repo_id, { mono: true });
      pushDetail(details, 'Current Phase', blocker.current_phase);
      pushDetail(details, 'Required Phase', blocker.required_phase);
      break;
    default:
      break;
  }

  return details;
}

export function summarizeCoordinatorAttention(coordinatorBlockers) {
  if (!isObject(coordinatorBlockers) || coordinatorBlockers.ok === false) {
    return null;
  }

  const active = isObject(coordinatorBlockers.active) ? coordinatorBlockers.active : {};
  const blockers = Array.isArray(active.blockers)
    ? active.blockers.filter((blocker) => isObject(blocker) && blocker.code !== 'no_next_phase')
    : [];
  const nextActions = Array.isArray(coordinatorBlockers.next_actions)
    ? coordinatorBlockers.next_actions.filter((action) => isObject(action))
    : [];

  return {
    title: coordinatorBlockers.mode === 'pending_gate' ? 'Approval Snapshot' : 'Blocker Snapshot',
    active,
    blockers,
    nextActions,
    primaryBlocker: blockers[0] || null,
    primaryAction: nextActions[0] || null,
    additionalBlockerCount: Math.max(0, blockers.length - 1),
    additionalActionCount: Math.max(0, nextActions.length - 1),
  };
}
