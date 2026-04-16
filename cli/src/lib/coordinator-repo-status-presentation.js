import { collectCoordinatorRepoSnapshots } from './coordinator-repo-snapshots.js';

export function normalizeCoordinatorRepoStatus(status) {
  if (status === 'linked' || status === 'initialized') {
    return 'active';
  }
  return status || null;
}

function resolveCoordinatorRepoOrder({ config, coordinatorRepoRuns, repoSnapshots }) {
  if (Array.isArray(config?.repo_order) && config.repo_order.length > 0) {
    return config.repo_order;
  }

  const repoOrder = [];
  const seen = new Set();

  for (const repoId of Object.keys(coordinatorRepoRuns || {})) {
    if (!seen.has(repoId)) {
      seen.add(repoId);
      repoOrder.push(repoId);
    }
  }

  for (const snapshot of Array.isArray(repoSnapshots) ? repoSnapshots : []) {
    const repoId = snapshot?.repo_id;
    if (typeof repoId === 'string' && repoId.length > 0 && !seen.has(repoId)) {
      seen.add(repoId);
      repoOrder.push(repoId);
    }
  }

  return repoOrder;
}

export function buildCoordinatorRepoStatusEntries({
  config,
  coordinatorRepoRuns,
  repoSnapshots,
}) {
  const resolvedRepoSnapshots = Array.isArray(repoSnapshots)
    ? repoSnapshots
    : (config ? collectCoordinatorRepoSnapshots(config) : []);
  const repoOrder = resolveCoordinatorRepoOrder({
    config,
    coordinatorRepoRuns,
    repoSnapshots: resolvedRepoSnapshots,
  });
  const snapshotByRepoId = new Map(
    resolvedRepoSnapshots
      .filter((entry) => typeof entry?.repo_id === 'string' && entry.repo_id.length > 0)
      .map((entry) => [entry.repo_id, entry]),
  );

  return repoOrder.map((repoId) => {
    const coordinatorRepoRun = coordinatorRepoRuns?.[repoId] || {};
    const repoSnapshot = snapshotByRepoId.get(repoId) || null;
    const repoAuthorityAvailable = repoSnapshot?.ok === true;
    const coordinatorStatus = coordinatorRepoRun.status || null;
    const normalizedCoordinatorStatus = normalizeCoordinatorRepoStatus(coordinatorStatus);
    const repoAuthorityStatus = repoAuthorityAvailable ? (repoSnapshot.status || null) : null;
    const repoAuthorityRunId = repoAuthorityAvailable ? (repoSnapshot.run_id ?? null) : null;
    const runIdMismatch = (
      repoAuthorityAvailable
      && coordinatorRepoRun.run_id
      && repoAuthorityRunId
      && coordinatorRepoRun.run_id !== repoAuthorityRunId
    )
      ? {
        repo_id: repoId,
        expected_run_id: coordinatorRepoRun.run_id,
        actual_run_id: repoAuthorityRunId,
      }
      : null;
    const statusDrift = (
      repoAuthorityAvailable
      && normalizedCoordinatorStatus
      && repoAuthorityStatus
      && normalizedCoordinatorStatus !== repoAuthorityStatus
    )
      ? {
        repo_id: repoId,
        coordinator_status: coordinatorStatus,
        repo_status: repoAuthorityStatus,
      }
      : null;
    const details = [];

    if (coordinatorStatus === 'linked' || coordinatorStatus === 'initialized') {
      details.push({
        label: 'coordinator',
        value: coordinatorStatus,
      });
    }

    if (runIdMismatch) {
      details.push({
        label: 'expected run',
        value: runIdMismatch.expected_run_id,
        mono: true,
      });
    }

    return {
      repo_id: repoId,
      run_id: repoAuthorityAvailable
        ? (repoAuthorityRunId ?? coordinatorRepoRun.run_id ?? null)
        : (coordinatorRepoRun.run_id ?? null),
      status: repoAuthorityAvailable
        ? (repoAuthorityStatus || 'unknown')
        : (normalizedCoordinatorStatus || 'unknown'),
      phase: repoAuthorityAvailable
        ? (repoSnapshot.phase ?? coordinatorRepoRun.phase ?? null)
        : (coordinatorRepoRun.phase ?? null),
      details,
      coordinator_status: coordinatorStatus,
      normalized_coordinator_status: normalizedCoordinatorStatus,
      repo_authority_available: repoAuthorityAvailable,
      run_id_mismatch: runIdMismatch,
      status_drift: statusDrift,
    };
  });
}

export function buildCoordinatorRepoStatusRows({ config, coordinatorRepoRuns, repoSnapshots }) {
  return buildCoordinatorRepoStatusEntries({ config, coordinatorRepoRuns, repoSnapshots })
    .map((entry) => ({
      repo_id: entry.repo_id,
      run_id: entry.run_id,
      status: entry.status,
      phase: entry.phase,
      details: entry.details,
    }));
}
