import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadAllChainReports, loadChainReport, loadLatestChainReport } from './chain-reports.js';
import { buildPlanProgressSummary, loadLatestPlan } from './mission-plans.js';
import { getActiveRepoDecisions } from './repo-decisions.js';

const MISSION_ATTENTION_TERMINALS = new Set(['operator_abort', 'parent_validation_failed']);
const MISSION_ATTENTION_RUN_STATUSES = new Set(['blocked', 'failed']);

export function getMissionsDir(root) {
  return join(root, '.agentxchain', 'missions');
}

export function buildMissionId(input) {
  const slug = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  const base = slug || 'untitled';
  return base.startsWith('mission-') ? base : `mission-${base}`;
}

export function createMission(root, { missionId, title, goal }) {
  const normalizedId = buildMissionId(missionId || title);
  const filePath = join(getMissionsDir(root), `${normalizedId}.json`);
  if (existsSync(filePath)) {
    return { ok: false, error: `Mission already exists: ${normalizedId}` };
  }

  const now = new Date().toISOString();
  const artifact = {
    mission_id: normalizedId,
    title,
    goal,
    status: 'active',
    created_at: now,
    updated_at: now,
    chain_ids: [],
  };

  mkdirSync(getMissionsDir(root), { recursive: true });
  writeFileSync(filePath, JSON.stringify(artifact, null, 2));
  return { ok: true, mission: artifact };
}

export function loadAllMissionArtifacts(root) {
  const missionsDir = getMissionsDir(root);
  if (!existsSync(missionsDir)) return [];

  const missions = [];
  for (const file of readdirSync(missionsDir).filter((entry) => entry.endsWith('.json')).sort()) {
    try {
      const parsed = JSON.parse(readFileSync(join(missionsDir, file), 'utf8'));
      if (parsed && parsed.mission_id) {
        missions.push(parsed);
      }
    } catch {
      // Advisory surface only. Skip malformed mission files.
    }
  }

  missions.sort((left, right) => {
    const leftTime = new Date(left.updated_at || left.created_at || 0).getTime();
    const rightTime = new Date(right.updated_at || right.created_at || 0).getTime();
    return rightTime - leftTime;
  });

  return missions;
}

export function loadMissionArtifact(root, missionId) {
  const filePath = join(getMissionsDir(root), `${missionId}.json`);
  if (existsSync(filePath)) {
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
      if (parsed?.mission_id) return parsed;
    } catch {
      return null;
    }
  }

  return loadAllMissionArtifacts(root).find((mission) => mission.mission_id === missionId) || null;
}

export function loadLatestMissionArtifact(root) {
  const missions = loadAllMissionArtifacts(root);
  return missions.length > 0 ? missions[0] : null;
}

export function attachChainToMission(root, missionId, chainRef = 'latest') {
  const mission = loadMissionArtifact(root, missionId);
  if (!mission) {
    return { ok: false, error: `Mission not found: ${missionId}` };
  }

  const chain = chainRef === 'latest'
    ? loadLatestChainReport(root)
    : loadChainReport(root, chainRef);
  if (!chain) {
    return { ok: false, error: chainRef === 'latest' ? 'No chain reports found.' : `Chain report not found: ${chainRef}` };
  }

  const nextChainIds = Array.isArray(mission.chain_ids) ? [...mission.chain_ids] : [];
  if (!nextChainIds.includes(chain.chain_id)) {
    nextChainIds.push(chain.chain_id);
  }

  const updated = {
    ...mission,
    chain_ids: nextChainIds,
    updated_at: new Date().toISOString(),
  };

  mkdirSync(getMissionsDir(root), { recursive: true });
  writeFileSync(join(getMissionsDir(root), `${updated.mission_id}.json`), JSON.stringify(updated, null, 2));
  return { ok: true, mission: updated, chain };
}

export function buildMissionSnapshot(root, missionArtifact) {
  const chainIds = Array.isArray(missionArtifact.chain_ids) ? missionArtifact.chain_ids : [];
  const chains = [];
  const missingChainIds = [];

  for (const chainId of chainIds) {
    const report = loadChainReport(root, chainId);
    if (report) {
      chains.push(report);
    } else {
      missingChainIds.push(chainId);
    }
  }

  chains.sort((left, right) => {
    const leftTime = new Date(left.started_at || 0).getTime();
    const rightTime = new Date(right.started_at || 0).getTime();
    return rightTime - leftTime;
  });

  const totalRuns = chains.reduce((sum, chain) => sum + (chain.runs?.length || 0), 0);
  const totalTurns = chains.reduce((sum, chain) => sum + (chain.total_turns || 0), 0);
  const latestChain = chains[0] || null;
  const latestPlan = loadLatestPlan(root, missionArtifact.mission_id);
  const activeRepoDecisions = getActiveRepoDecisions(root);

  return {
    ...missionArtifact,
    derived_status: deriveMissionStatus(missionArtifact, chains, missingChainIds),
    chain_count: chainIds.length,
    attached_chain_count: chains.length,
    missing_chain_ids: missingChainIds,
    total_runs: totalRuns,
    total_turns: totalTurns,
    latest_chain_id: latestChain?.chain_id || null,
    latest_terminal_reason: latestChain?.terminal_reason || null,
    latest_plan: buildPlanProgressSummary(latestPlan),
    active_repo_decisions_count: activeRepoDecisions.length,
    chains,
  };
}

export function loadAllMissionSnapshots(root) {
  return loadAllMissionArtifacts(root).map((mission) => buildMissionSnapshot(root, mission));
}

function deriveMissionStatus(missionArtifact, chains, missingChainIds) {
  if (missionArtifact.status && missionArtifact.status !== 'active') {
    return missionArtifact.status;
  }
  if (missingChainIds.length > 0) return 'degraded';
  if (chains.length === 0) return 'planned';
  if (chains.some((chain) => (
    MISSION_ATTENTION_TERMINALS.has(chain.terminal_reason)
    || (chain.runs || []).some((run) => MISSION_ATTENTION_RUN_STATUSES.has(run.status))
  ))) {
    return 'needs_attention';
  }
  return 'progressing';
}

export function loadLatestMissionSnapshot(root) {
  const artifact = loadLatestMissionArtifact(root);
  return artifact ? buildMissionSnapshot(root, artifact) : null;
}

export function loadMissionSnapshot(root, missionId) {
  const artifact = loadMissionArtifact(root, missionId);
  return artifact ? buildMissionSnapshot(root, artifact) : null;
}

export function buildMissionListSummary(root, limit = 20) {
  return loadAllMissionSnapshots(root).slice(0, limit);
}

export function loadMissionAttachmentTarget(root, missionId) {
  if (missionId) return loadMissionArtifact(root, missionId);
  return loadLatestMissionArtifact(root);
}
