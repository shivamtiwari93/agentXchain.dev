import { collectCoordinatorRepoSnapshots } from './coordinator-repo-snapshots.js';

export function normalizeCoordinatorRepoStatus(status) {
  if (status === 'linked' || status === 'initialized') {
    return 'active';
  }
  return status || null;
}

export function buildCoordinatorRepoStatusRows({ config, coordinatorRepoRuns }) {
  const repoOrder = Array.isArray(config?.repo_order) && config.repo_order.length > 0
    ? config.repo_order
    : Object.keys(coordinatorRepoRuns || {});
  const repoSnapshots = config ? collectCoordinatorRepoSnapshots(config) : [];
  const snapshotByRepoId = new Map(repoSnapshots.map((entry) => [entry.repo_id, entry]));

  return repoOrder.map((repoId) => {
    const coordinatorRepoRun = coordinatorRepoRuns?.[repoId] || {};
    const repoSnapshot = snapshotByRepoId.get(repoId) || null;
    const repoAuthorityAvailable = repoSnapshot?.ok === true;
    const coordinatorStatus = coordinatorRepoRun.status || null;
    const displayStatus = repoAuthorityAvailable
      ? (repoSnapshot.status || 'unknown')
      : (normalizeCoordinatorRepoStatus(coordinatorStatus) || 'unknown');
    const displayPhase = repoAuthorityAvailable
      ? (repoSnapshot.phase ?? coordinatorRepoRun.phase ?? null)
      : (coordinatorRepoRun.phase ?? null);
    const displayRunId = repoAuthorityAvailable
      ? (repoSnapshot.run_id ?? coordinatorRepoRun.run_id ?? null)
      : (coordinatorRepoRun.run_id ?? null);
    const details = [];

    if (coordinatorStatus === 'linked' || coordinatorStatus === 'initialized') {
      details.push({
        label: 'coordinator',
        value: coordinatorStatus,
      });
    }

    if (
      repoAuthorityAvailable
      && coordinatorRepoRun.run_id
      && repoSnapshot.run_id
      && coordinatorRepoRun.run_id !== repoSnapshot.run_id
    ) {
      details.push({
        label: 'expected run',
        value: coordinatorRepoRun.run_id,
      });
    }

    return {
      repo_id: repoId,
      run_id: displayRunId,
      status: displayStatus,
      phase: displayPhase,
      details,
    };
  });
}
