function normalizeCoordinatorRepoStatus(status) {
  if (status === 'linked' || status === 'initialized') {
    return 'active';
  }
  return status || null;
}

export function detectCoordinatorRunIdMismatches(repos, coordinatorRepoRuns) {
  const mismatches = [];
  for (const repo of Array.isArray(repos) ? repos : []) {
    if (!repo?.ok) continue;
    const expectedRunId = coordinatorRepoRuns?.[repo.repo_id]?.run_id ?? null;
    const actualRunId = repo.run_id ?? null;
    if (expectedRunId && expectedRunId !== actualRunId) {
      mismatches.push({
        repo_id: repo.repo_id,
        expected_run_id: expectedRunId,
        actual_run_id: actualRunId,
      });
    }
  }
  return mismatches;
}

export function detectCoordinatorRepoStatusDrift(repos, coordinatorRepoRuns) {
  return (Array.isArray(repos) ? repos : [])
    .filter((repo) => repo?.ok)
    .filter((repo) => {
      const coordinatorStatus = normalizeCoordinatorRepoStatus(
        coordinatorRepoRuns?.[repo.repo_id]?.status || null,
      );
      return coordinatorStatus && repo.status && coordinatorStatus !== repo.status;
    })
    .map((repo) => ({
      repo_id: repo.repo_id,
      coordinator_status: coordinatorRepoRuns?.[repo.repo_id]?.status || null,
      repo_status: repo.status || null,
    }));
}

export function deriveCoordinatorNextActions({
  status,
  blockedReason,
  pendingGate,
  repos,
  coordinatorRepoRuns,
  runIdMismatches,
}) {
  const nextActions = [];
  const mismatches = Array.isArray(runIdMismatches)
    ? runIdMismatches
    : detectCoordinatorRunIdMismatches(repos, coordinatorRepoRuns);
  const statusDrift = detectCoordinatorRepoStatusDrift(repos, coordinatorRepoRuns);

  if (mismatches.length > 0) {
    nextActions.push({
      code: 'repo_run_id_mismatch',
      command: 'agentxchain multi resume',
      reason: `Coordinator run identity drift detected${blockedReason ? `: ${blockedReason}` : ''}. Resume after reconciling the affected child repos.`,
    });
    for (const mismatch of mismatches) {
      nextActions.push({
        code: 'repo_run_id_mismatch',
        command: 'agentxchain multi resume',
        reason: `Repo "${mismatch.repo_id}" run identity drifted: coordinator expects "${mismatch.expected_run_id}" but repo has "${mismatch.actual_run_id}". Re-link the correct child run, then resume.`,
      });
    }
    if (pendingGate) {
      nextActions.push({
        code: 'pending_gate',
        command: 'agentxchain multi approve-gate',
        reason: `After resume succeeds, approve pending gate "${pendingGate.gate}" (${pendingGate.gate_type}).`,
      });
    }
    return nextActions;
  }

  if (statusDrift.length > 0) {
    nextActions.push({
      code: 'resync',
      command: 'agentxchain multi resync',
      reason: `Coordinator state disagrees with repo authority for: ${statusDrift.map((entry) => entry.repo_id).join(', ')}.`,
    });
    if (pendingGate) {
      nextActions.push({
        code: 'pending_gate',
        command: 'agentxchain multi approve-gate',
        reason: `If resync preserves gate "${pendingGate.gate}", approve it afterward.`,
      });
    }
    return nextActions;
  }

  if (status === 'blocked') {
    nextActions.push({
      code: 'resume',
      command: 'agentxchain multi resume',
      reason: `Coordinator is blocked${blockedReason ? `: ${blockedReason}` : ''}. Resume after fixing the underlying issue.`,
    });
    if (pendingGate) {
      nextActions.push({
        code: 'pending_gate',
        command: 'agentxchain multi approve-gate',
        reason: `After resume succeeds, approve pending gate "${pendingGate.gate}" (${pendingGate.gate_type}).`,
      });
    }
    return nextActions;
  }

  if (pendingGate) {
    nextActions.push({
      code: 'pending_gate',
      command: 'agentxchain multi approve-gate',
      reason: `Coordinator is waiting on pending gate "${pendingGate.gate}" (${pendingGate.gate_type}).`,
    });
    return nextActions;
  }

  if (status === 'active' || status === 'paused') {
    nextActions.push({
      code: 'step',
      command: 'agentxchain multi step',
      reason: 'Coordinator has no blocked state or pending gate and can continue.',
    });
  }

  return nextActions;
}
