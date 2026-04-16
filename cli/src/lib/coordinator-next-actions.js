import { buildCoordinatorRepoStatusEntries } from './coordinator-repo-status-presentation.js';

function collectCoordinatorRunIdMismatches(repoStatusEntries) {
  return repoStatusEntries
    .filter((entry) => entry?.run_id_mismatch)
    .map((entry) => entry.run_id_mismatch);
}

function collectCoordinatorStatusDrift(repoStatusEntries) {
  return repoStatusEntries
    .filter((entry) => entry?.status_drift)
    .map((entry) => entry.status_drift);
}

export function detectCoordinatorRunIdMismatches(repos, coordinatorRepoRuns) {
  return collectCoordinatorRunIdMismatches(
    buildCoordinatorRepoStatusEntries({
      coordinatorRepoRuns,
      repoSnapshots: repos,
    }),
  );
}

export function detectCoordinatorRepoStatusDrift(repos, coordinatorRepoRuns) {
  return collectCoordinatorStatusDrift(
    buildCoordinatorRepoStatusEntries({
      coordinatorRepoRuns,
      repoSnapshots: repos,
    }),
  );
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
  if (status === 'completed') {
    return nextActions;
  }

  const repoStatusEntries = buildCoordinatorRepoStatusEntries({
    coordinatorRepoRuns,
    repoSnapshots: repos,
  });
  const mismatches = Array.isArray(runIdMismatches)
    ? runIdMismatches
    : collectCoordinatorRunIdMismatches(repoStatusEntries);
  const statusDrift = collectCoordinatorStatusDrift(repoStatusEntries);

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
