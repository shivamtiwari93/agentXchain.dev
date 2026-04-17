import { buildMissionListSummary, loadLatestMissionSnapshot } from '../missions.js';

export function readMissionSnapshot(workspacePath, { limit } = {}) {
  const missions = buildMissionListSummary(workspacePath, limit);

  return {
    ok: true,
    status: 200,
    body: {
      latest: loadLatestMissionSnapshot(workspacePath),
      missions,
    },
  };
}
