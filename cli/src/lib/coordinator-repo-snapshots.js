import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

function readRepoStateSnapshot(repo) {
  const statePath = join(repo.resolved_path, '.agentxchain', 'state.json');
  if (!existsSync(statePath)) {
    return {
      repo_id: repo.repo_id,
      ok: false,
      status: null,
      run_id: null,
      phase: null,
    };
  }

  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    return {
      repo_id: repo.repo_id,
      ok: true,
      status: state?.status ?? null,
      run_id: state?.run_id ?? null,
      phase: state?.phase ?? null,
    };
  } catch {
    return {
      repo_id: repo.repo_id,
      ok: false,
      status: null,
      run_id: null,
      phase: null,
    };
  }
}

export function collectCoordinatorRepoSnapshots(config) {
  return (config?.repo_order || []).map((repoId) => {
    const repo = config?.repos?.[repoId];
    if (!repo?.resolved_path) {
      return {
        repo_id: repoId,
        ok: false,
        status: null,
        run_id: null,
        phase: null,
      };
    }
    return readRepoStateSnapshot({
      repo_id: repoId,
      resolved_path: repo.resolved_path,
    });
  });
}
