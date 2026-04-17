/**
 * Plan reader — reads mission plan artifacts for the dashboard bridge.
 *
 * Provides a snapshot of all plans across all missions for the dashboard.
 * Plans are advisory repo-local artifacts; this reader is not protocol-normative.
 */

import { buildPlanProgressSummary, loadAllPlans } from '../mission-plans.js';
import { loadAllMissionArtifacts } from '../missions.js';

/**
 * Build a dashboard-ready plan snapshot across all missions.
 *
 * Returns newest-first plans with per-workstream launch_status and launch_records.
 * If missionId is provided, returns plans for that mission only.
 *
 * @param {string} workspacePath - project root
 * @param {{ limit?: number, missionId?: string }} options
 * @returns {{ ok: boolean, status: number, body: object }}
 */
export function readPlanSnapshot(workspacePath, { limit, missionId } = {}) {
  const allPlans = [];

  if (missionId) {
    const plans = loadAllPlans(workspacePath, missionId);
    allPlans.push(...plans);
  } else {
    const missions = loadAllMissionArtifacts(workspacePath);
    for (const mission of missions) {
      const plans = loadAllPlans(workspacePath, mission.mission_id);
      allPlans.push(...plans);
    }
  }

  // Sort newest-first across all missions
  allPlans.sort((a, b) => {
    const aTime = new Date(a.created_at || 0).getTime();
    const bTime = new Date(b.created_at || 0).getTime();
    if (bTime !== aTime) return bTime - aTime;
    return (b.plan_id || '').localeCompare(a.plan_id || '');
  });

  const plans = limit ? allPlans.slice(0, limit) : allPlans;

  // Derive summary for the latest plan
  const latest = plans[0] || null;
  let latestSummary = null;
  if (latest) {
    latestSummary = buildPlanSummary(latest);
  }

  return {
    ok: true,
    status: 200,
    body: {
      latest: latestSummary,
      plans: plans.map(buildPlanSummary),
    },
  };
}

/**
 * Build a dashboard-ready summary for a single plan.
 */
function buildPlanSummary(plan) {
  const summary = buildPlanProgressSummary(plan);
  const workstreams = Array.isArray(plan.workstreams) ? plan.workstreams : [];
  const launchRecords = Array.isArray(plan.launch_records) ? plan.launch_records : [];

  return {
    ...summary,
    workstreams: workstreams.map((ws) => ({
      workstream_id: ws.workstream_id,
      title: ws.title,
      goal: ws.goal,
      roles: ws.roles,
      phases: ws.phases,
      depends_on: ws.depends_on,
      launch_status: ws.launch_status,
    })),
    launch_records: launchRecords.map((lr) => ({
      workstream_id: lr.workstream_id,
      chain_id: lr.chain_id,
      launched_at: lr.launched_at,
      completed_at: lr.completed_at || null,
      status: lr.status,
      terminal_reason: lr.terminal_reason || null,
    })),
  };
}
