/**
 * Mission decomposition — plan artifact CRUD and schema validation.
 *
 * Plans are advisory repo-local artifacts under `.agentxchain/missions/plans/<mission_id>/`.
 * They contain dependency-ordered workstreams derived from a mission goal.
 * Plans are NOT protocol-normative.
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { loadChainReport } from './chain-reports.js';
import { writeDispatchBundle } from './dispatch-bundle.js';
import { loadProjectContext, loadProjectState } from './config.js';
import { reactivateGovernedRun, reissueTurn } from './governed-state.js';
import { emitRunEvent } from './run-events.js';
import { readBarriers, readCoordinatorHistory, recordCoordinatorDecision } from './coordinator-state.js';
import { loadCoordinatorConfig } from './coordinator-config.js';

// ── Plan artifact directory ──────────────────────────────────────────────────

export function getPlansDir(root, missionId) {
  return join(root, '.agentxchain', 'missions', 'plans', missionId);
}

export function getPlanPath(root, missionId, planId) {
  return join(getPlansDir(root, missionId), `${planId}.json`);
}

function writePlanArtifact(root, missionId, plan) {
  mkdirSync(getPlansDir(root, missionId), { recursive: true });
  writeFileSync(getPlanPath(root, missionId, plan.plan_id), JSON.stringify(plan, null, 2));
}

// ── Plan ID generation ───────────────────────────────────────────────────────

export function generatePlanId(now = new Date()) {
  const iso = now.toISOString().replace(/[:.]/g, '-').replace('Z', 'Z');
  const epochMs = String(now.getTime()).padStart(13, '0');
  const monotonic = process.hrtime.bigint().toString().slice(-10).padStart(10, '0');
  return `plan-${iso}-${epochMs}-${monotonic}`;
}

// ── Schema validation ────────────────────────────────────────────────────────

const REQUIRED_WORKSTREAM_FIELDS = [
  'workstream_id',
  'title',
  'goal',
  'roles',
  'phases',
  'depends_on',
  'acceptance_checks',
];

/**
 * Validate planner output against the plan schema.
 * Returns { ok: true, workstreams } or { ok: false, errors: string[] }.
 */
export function validatePlannerOutput(output) {
  const errors = [];

  if (!output || typeof output !== 'object') {
    return { ok: false, errors: ['Planner output must be a non-null object.'] };
  }

  if (!Array.isArray(output.workstreams)) {
    return { ok: false, errors: ['Planner output must contain a "workstreams" array.'] };
  }

  if (output.workstreams.length === 0) {
    return { ok: false, errors: ['Planner output must contain at least one workstream.'] };
  }

  const seenIds = new Set();
  for (let i = 0; i < output.workstreams.length; i++) {
    const ws = output.workstreams[i];
    const prefix = `workstreams[${i}]`;

    if (!ws || typeof ws !== 'object') {
      errors.push(`${prefix}: must be an object.`);
      continue;
    }

    for (const field of REQUIRED_WORKSTREAM_FIELDS) {
      if (ws[field] === undefined || ws[field] === null) {
        errors.push(`${prefix}: missing required field "${field}".`);
      }
    }

    if (typeof ws.workstream_id === 'string') {
      if (seenIds.has(ws.workstream_id)) {
        errors.push(`${prefix}: duplicate workstream_id "${ws.workstream_id}".`);
      }
      seenIds.add(ws.workstream_id);
    } else if (ws.workstream_id !== undefined) {
      errors.push(`${prefix}: workstream_id must be a string.`);
    }

    if (ws.title !== undefined && typeof ws.title !== 'string') {
      errors.push(`${prefix}: title must be a string.`);
    }
    if (ws.goal !== undefined && typeof ws.goal !== 'string') {
      errors.push(`${prefix}: goal must be a string.`);
    }
    if (ws.roles !== undefined && !Array.isArray(ws.roles)) {
      errors.push(`${prefix}: roles must be an array.`);
    }
    if (ws.phases !== undefined && !Array.isArray(ws.phases)) {
      errors.push(`${prefix}: phases must be an array.`);
    }
    if (ws.depends_on !== undefined && !Array.isArray(ws.depends_on)) {
      errors.push(`${prefix}: depends_on must be an array.`);
    }
    if (ws.acceptance_checks !== undefined && !Array.isArray(ws.acceptance_checks)) {
      errors.push(`${prefix}: acceptance_checks must be an array.`);
    }

    // Validate no pre-allocated chain_id
    if (ws.chain_id !== undefined) {
      errors.push(`${prefix}: workstreams must not contain pre-allocated "chain_id". Chain IDs are runtime artifacts.`);
    }
  }

  // Validate dependency references
  if (errors.length === 0) {
    const allIds = new Set(output.workstreams.map((ws) => ws.workstream_id));
    for (let i = 0; i < output.workstreams.length; i++) {
      const ws = output.workstreams[i];
      if (Array.isArray(ws.depends_on)) {
        for (const dep of ws.depends_on) {
          if (!allIds.has(dep)) {
            errors.push(`workstreams[${i}]: depends_on references unknown workstream_id "${dep}".`);
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, workstreams: output.workstreams };
}

// ── Plan artifact creation ───────────────────────────────────────────────────

// ── Coordinator phase alignment ─────────────────────────────────────────────

/**
 * Validate that plan workstream phases align with coordinator config phases.
 * Returns { ok: true } or { ok: false, errors: string[] }.
 */
export function validatePlanCoordinatorPhaseAlignment(workstreams, coordinatorConfig) {
  if (!coordinatorConfig) return { ok: true };

  const errors = [];
  const coordinatorPhases = coordinatorConfig.routing
    ? new Set(Object.keys(coordinatorConfig.routing))
    : new Set(['planning', 'implementation', 'qa']);

  for (let i = 0; i < workstreams.length; i++) {
    const ws = workstreams[i];
    if (!Array.isArray(ws.phases)) continue;
    for (const phase of ws.phases) {
      if (!coordinatorPhases.has(phase)) {
        errors.push(
          `workstreams[${i}] ("${ws.workstream_id}"): phase "${phase}" is not defined in coordinator config. ` +
          `Valid phases: ${[...coordinatorPhases].join(', ')}`,
        );
      }
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/**
 * Build coordinator_scope metadata for a plan artifact.
 */
function buildCoordinatorScope(mission, coordinatorConfig) {
  if (!mission.coordinator || !coordinatorConfig) return null;

  const repoIds = coordinatorConfig.repos ? Object.keys(coordinatorConfig.repos) : [];
  const phases = coordinatorConfig.routing
    ? Object.keys(coordinatorConfig.routing)
    : ['planning', 'implementation', 'qa'];
  const coordinatorWorkstreams = coordinatorConfig.workstreams
    ? Object.keys(coordinatorConfig.workstreams)
    : [];

  return {
    super_run_id: mission.coordinator.super_run_id || null,
    repo_ids: repoIds,
    phases,
    coordinator_workstream_ids: coordinatorWorkstreams,
    bound_at: new Date().toISOString(),
  };
}

/**
 * Create a plan artifact from validated planner output.
 *
 * @param {string} root - project root
 * @param {object} mission - mission artifact (must have mission_id, goal)
 * @param {object} options - { constraints, roleHints, plannerOutput, coordinatorConfig }
 * @returns {{ ok: boolean, plan?: object, errors?: string[] }}
 */
export function createPlanArtifact(root, mission, { constraints = [], roleHints = [], plannerOutput, coordinatorConfig = null }) {
  const validation = validatePlannerOutput(plannerOutput);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }

  // Validate phase alignment with coordinator when mission is coordinator-bound
  if (coordinatorConfig) {
    const phaseCheck = validatePlanCoordinatorPhaseAlignment(validation.workstreams, coordinatorConfig);
    if (!phaseCheck.ok) {
      return { ok: false, errors: phaseCheck.errors };
    }
  }

  const missionId = mission.mission_id;
  const existingPlans = loadAllPlans(root, missionId);
  const supersedes = existingPlans[0] || null;

  const createdAt = new Date();
  const planId = generatePlanId(createdAt);
  const now = createdAt.toISOString();

  const workstreams = validation.workstreams.map((ws) => ({
    workstream_id: ws.workstream_id,
    title: ws.title,
    goal: ws.goal,
    roles: ws.roles,
    phases: ws.phases,
    depends_on: ws.depends_on,
    acceptance_checks: ws.acceptance_checks,
    launch_status: Array.isArray(ws.depends_on) && ws.depends_on.length > 0 ? 'blocked' : 'ready',
  }));

  const coordinatorScope = buildCoordinatorScope(mission, coordinatorConfig);

  const plan = {
    plan_id: planId,
    mission_id: missionId,
    status: 'proposed',
    supersedes_plan_id: supersedes ? supersedes.plan_id : null,
    created_at: now,
    updated_at: now,
    input: {
      goal: mission.goal,
      constraints,
      role_hints: roleHints,
    },
    planner: {
      mode: 'llm_one_shot',
      model: 'configured mission planner',
    },
    ...(coordinatorScope ? { coordinator_scope: coordinatorScope } : {}),
    workstreams,
    launch_records: [],
  };

  writePlanArtifact(root, missionId, plan);
  return { ok: true, plan };
}

export function approvePlanArtifact(root, missionId, planId) {
  const plans = loadAllPlans(root, missionId);
  if (plans.length === 0) {
    return { ok: false, error: `No plans found for mission ${missionId}.` };
  }

  const target = plans.find((plan) => plan.plan_id === planId);
  if (!target) {
    return { ok: false, error: `Plan not found: ${planId}` };
  }

  if (target.status === 'approved') {
    return { ok: false, error: `Plan ${planId} is already approved.` };
  }

  if (target.status !== 'proposed') {
    return { ok: false, error: `Plan ${planId} cannot be approved from status "${target.status}".` };
  }

  const latestPlan = plans[0];
  if (latestPlan?.plan_id !== target.plan_id) {
    return {
      ok: false,
      error: `Plan ${planId} has been superseded by newer plan ${latestPlan.plan_id}. Approve the latest plan instead.`,
    };
  }

  const now = new Date().toISOString();
  const supersededPlanIds = [];
  let approvedPlan = null;

  for (const plan of plans) {
    if (plan.plan_id === target.plan_id) {
      const { superseded_by_plan_id, ...rest } = plan;
      approvedPlan = {
        ...rest,
        status: 'approved',
        approved_at: now,
        updated_at: now,
      };
      writePlanArtifact(root, missionId, approvedPlan);
      continue;
    }

    if (plan.status === 'approved' || plan.status === 'proposed') {
      const nextPlan = {
        ...plan,
        status: 'superseded',
        superseded_by_plan_id: target.plan_id,
        updated_at: now,
      };
      supersededPlanIds.push(plan.plan_id);
      writePlanArtifact(root, missionId, nextPlan);
    }
  }

  return { ok: true, plan: approvedPlan, supersededPlanIds };
}

// ── Plan artifact loading ────────────────────────────────────────────────────

export function loadAllPlans(root, missionId) {
  const plansDir = getPlansDir(root, missionId);
  if (!existsSync(plansDir)) return [];

  const plans = [];
  for (const file of readdirSync(plansDir).filter((f) => f.endsWith('.json')).sort()) {
    try {
      const parsed = JSON.parse(readFileSync(join(plansDir, file), 'utf8'));
      if (parsed && parsed.plan_id) {
        plans.push(parsed);
      }
    } catch {
      // Advisory surface only. Skip malformed plan files.
    }
  }

  // Newest first by created_at, then by plan_id descending as tiebreaker
  plans.sort((a, b) => {
    const aTime = new Date(a.created_at || 0).getTime();
    const bTime = new Date(b.created_at || 0).getTime();
    if (bTime !== aTime) return bTime - aTime;
    return (b.plan_id || '').localeCompare(a.plan_id || '');
  });

  return plans;
}

export function loadLatestPlan(root, missionId) {
  const plans = loadAllPlans(root, missionId);
  return plans.length > 0 ? plans[0] : null;
}

export function loadPlan(root, missionId, planId) {
  const plansDir = getPlansDir(root, missionId);
  const exactPath = getPlanPath(root, missionId, planId);
  if (existsSync(exactPath)) {
    try {
      return JSON.parse(readFileSync(exactPath, 'utf8'));
    } catch {
      return null;
    }
  }

  // Scan for matching plan_id
  const plans = loadAllPlans(root, missionId);
  return plans.find((p) => p.plan_id === planId) || null;
}

export function buildPlanProgressSummary(plan) {
  if (!plan || typeof plan !== 'object') return null;

  const workstreams = Array.isArray(plan.workstreams) ? plan.workstreams : [];
  const launchRecords = Array.isArray(plan.launch_records) ? plan.launch_records : [];
  const workstreamStatusCounts = getWorkstreamStatusSummary(plan);
  const completedCount = workstreamStatusCounts.completed || 0;

  const summary = {
    plan_id: plan.plan_id,
    mission_id: plan.mission_id,
    status: plan.status,
    created_at: plan.created_at,
    updated_at: plan.updated_at,
    approved_at: plan.approved_at || null,
    supersedes_plan_id: plan.supersedes_plan_id || null,
    superseded_by_plan_id: plan.superseded_by_plan_id || null,
    input_goal: plan.input?.goal || null,
    workstream_count: workstreams.length,
    launch_record_count: launchRecords.length,
    workstream_status_counts: workstreamStatusCounts,
    ready_count: workstreamStatusCounts.ready || 0,
    blocked_count: workstreamStatusCounts.blocked || 0,
    launched_count: workstreamStatusCounts.launched || 0,
    completed_count: completedCount,
    needs_attention_count: workstreamStatusCounts.needs_attention || 0,
    completion_percentage: workstreams.length === 0
      ? 0
      : Math.round((completedCount / workstreams.length) * 100),
  };

  if (plan.coordinator_scope) {
    summary.coordinator_bound = true;
    summary.coordinator_repo_count = (plan.coordinator_scope.repo_ids || []).length;
    summary.coordinator_phases = plan.coordinator_scope.phases || [];
  }

  return summary;
}

// ── Workstream launch ───────────────────────────────────────────────────────

export function didChainFinishSuccessfully(chainReport) {
  if (!chainReport || !Array.isArray(chainReport.runs) || chainReport.runs.length === 0) {
    return false;
  }

  const lastRun = chainReport.runs[chainReport.runs.length - 1];
  return lastRun?.status === 'completed';
}

function getCoordinatorCompletionBarrierId(workstreamId) {
  return `${workstreamId}_completion`;
}

function getAcceptedRepoIdsFromHistory(history, workstreamId) {
  return [
    ...new Set(
      history
        .filter((entry) => entry?.type === 'acceptance_projection' && entry.workstream_id === workstreamId && entry.repo_id)
        .map((entry) => entry.repo_id),
    ),
  ];
}

function getLatestLaunchRecord(plan, workstreamId) {
  const records = Array.isArray(plan.launch_records) ? plan.launch_records : [];
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i]?.workstream_id === workstreamId) {
      return records[i];
    }
  }
  return null;
}

function getLatestCoordinatorLaunchRecord(plan, workstreamId) {
  const records = Array.isArray(plan.launch_records) ? plan.launch_records : [];
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i]?.workstream_id === workstreamId && records[i]?.dispatch_mode === 'coordinator') {
      return records[i];
    }
  }
  return null;
}

function clonePlan(plan) {
  return JSON.parse(JSON.stringify(plan));
}

function readRepoLocalState(repoPath) {
  if (!repoPath) return null;
  try {
    return JSON.parse(readFileSync(join(repoPath, '.agentxchain', 'state.json'), 'utf8'));
  } catch {
    return null;
  }
}

function readRepoLocalHistory(repoPath) {
  if (!repoPath) return [];
  try {
    const content = readFileSync(join(repoPath, '.agentxchain', 'history.jsonl'), 'utf8').trim();
    if (!content) return [];
    return content.split('\n').map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function isAcceptedRepoHistoryEntry(entry) {
  return Boolean(entry?.accepted_at) || entry?.status === 'accepted';
}

const REPO_FAILURE_STATUSES = new Set(['failed_acceptance', 'failed', 'rejected', 'retrying', 'conflicted']);
const RETRYABLE_COORDINATOR_FAILURE_STATUSES = new Set(['failed', 'failed_acceptance']);

function getLatestRepoDispatches(launchRecord) {
  const latestByRepo = new Map();
  for (const dispatch of launchRecord?.repo_dispatches || []) {
    if (dispatch?.repo_id) {
      latestByRepo.set(dispatch.repo_id, dispatch);
    }
  }
  return [...latestByRepo.values()];
}

function classifyRepoDispatchOutcome(repoPath, repoTurnId) {
  const repoState = readRepoLocalState(repoPath);
  const activeTurn = repoState?.active_turns?.[repoTurnId] || null;
  if (activeTurn) {
    if (REPO_FAILURE_STATUSES.has(activeTurn.status)) {
      return {
        status: 'failed',
        source: 'repo_state',
        failure_status: activeTurn.status,
        failure_reason: activeTurn.failure_reason || activeTurn.last_rejection?.reason || null,
      };
    }
    return { status: 'in_flight', source: 'repo_state', failure_status: null, failure_reason: null };
  }

  const repoHistory = readRepoLocalHistory(repoPath);
  const matchingEntries = repoHistory.filter((entry) => entry?.turn_id === repoTurnId);
  if (matchingEntries.some((entry) => isAcceptedRepoHistoryEntry(entry))) {
    return { status: 'accepted', source: 'repo_history', failure_status: null, failure_reason: null };
  }

  for (let i = matchingEntries.length - 1; i >= 0; i--) {
    const entry = matchingEntries[i];
    if (REPO_FAILURE_STATUSES.has(entry?.status)) {
      return {
        status: 'failed',
        source: 'repo_history',
        failure_status: entry.status,
        failure_reason: entry.failure_reason || entry.reason || entry.summary || null,
      };
    }
  }

  return { status: 'unknown', source: 'repo_state', failure_status: null, failure_reason: null };
}

function buildCoordinatorRepoFailures(coordinatorConfig, launchRecord) {
  const failures = [];
  for (const dispatch of getLatestRepoDispatches(launchRecord)) {
    const repoPath = coordinatorConfig?.repos?.[dispatch.repo_id]?.resolved_path || null;
    const outcome = classifyRepoDispatchOutcome(repoPath, dispatch.repo_turn_id);
    if (outcome.status !== 'failed') {
      continue;
    }

    failures.push({
      repo_id: dispatch.repo_id,
      repo_turn_id: dispatch.repo_turn_id,
      role: dispatch.role || null,
      failure_status: outcome.failure_status,
      failure_reason: outcome.failure_reason,
      detected_from: outcome.source,
    });
  }
  return failures;
}

function appendCoordinatorHistoryEntry(workspacePath, entry) {
  const historyPath = join(workspacePath, '.agentxchain', 'multirepo', 'history.jsonl');
  mkdirSync(join(workspacePath, '.agentxchain', 'multirepo'), { recursive: true });
  appendFileSync(historyPath, `${JSON.stringify(entry)}\n`);
}

function findDependentDispatchAfter(plan, workstreamId, timestamp) {
  const since = new Date(timestamp || 0).getTime();
  if (Number.isNaN(since)) return null;

  for (const candidate of plan.workstreams || []) {
    if (!Array.isArray(candidate.depends_on) || !candidate.depends_on.includes(workstreamId)) {
      continue;
    }

    for (const record of plan.launch_records || []) {
      if (record?.workstream_id !== candidate.workstream_id) {
        continue;
      }

      if (record.dispatch_mode === 'coordinator') {
        for (const dispatch of record.repo_dispatches || []) {
          const dispatchedAt = new Date(dispatch?.dispatched_at || 0).getTime();
          if (!Number.isNaN(dispatchedAt) && dispatchedAt > since) {
            return {
              workstream_id: candidate.workstream_id,
              repo_id: dispatch.repo_id || null,
              dispatched_at: dispatch.dispatched_at || null,
            };
          }
        }
        continue;
      }

      const launchedAt = new Date(record.launched_at || 0).getTime();
      if (!Number.isNaN(launchedAt) && launchedAt > since) {
        return {
          workstream_id: candidate.workstream_id,
          repo_id: null,
          dispatched_at: record.launched_at || null,
        };
      }
    }
  }

  return null;
}

function loadRepoTurnForRetry(repoPath, repoTurnId) {
  const context = loadProjectContext(repoPath);
  if (!context) {
    return { ok: false, error: `Repo at "${repoPath}" is not a loadable governed project.` };
  }

  const state = loadProjectState(context.root, context.config);
  if (!state) {
    return { ok: false, error: `Repo at "${repoPath}" has no governed state.` };
  }

  const activeTurn = state.active_turns?.[repoTurnId] || null;
  if (!activeTurn) {
    return {
      ok: false,
      error: `Repo turn "${repoTurnId}" is no longer active. Use repo-local recovery instead of coordinator --retry.`,
    };
  }

  return { ok: true, root: context.root, config: context.config, state, activeTurn };
}

function buildCoordinatorWorkstreamProgress(coordinatorConfig, history, barriers, workstreamId) {
  const coordinatorWorkstream = coordinatorConfig?.workstreams?.[workstreamId];
  if (!coordinatorWorkstream) {
    return null;
  }

  const acceptedRepoIds = getAcceptedRepoIdsFromHistory(history, workstreamId);
  const allRepos = Array.isArray(coordinatorWorkstream.repos) ? coordinatorWorkstream.repos : [];
  const pendingRepoIds = allRepos.filter((repoId) => !acceptedRepoIds.includes(repoId));
  const barrierId = getCoordinatorCompletionBarrierId(workstreamId);
  const barrier = barriers?.[barrierId] || null;

  return {
    repo_ids: allRepos,
    repo_count: allRepos.length,
    accepted_repo_ids: acceptedRepoIds,
    accepted_repo_count: acceptedRepoIds.length,
    pending_repo_ids: pendingRepoIds,
    completion_barrier_id: barrierId,
    completion_barrier_type: coordinatorWorkstream.completion_barrier || barrier?.type || null,
    completion_barrier_status: barrier?.status || (pendingRepoIds.length === 0 ? 'satisfied' : 'pending'),
  };
}

function synchronizeCoordinatorWorkstreamStatuses(root, plan, coordinatorConfig, history, barriers) {
  let changed = false;

  for (const ws of plan.workstreams || []) {
    const progress = buildCoordinatorWorkstreamProgress(coordinatorConfig, history, barriers, ws.workstream_id);
    if (!progress) {
      continue;
    }

    const launchRecord = getLatestCoordinatorLaunchRecord(plan, ws.workstream_id);
    const repoFailures = launchRecord
      ? buildCoordinatorRepoFailures(coordinatorConfig, launchRecord)
      : [];
    if (launchRecord) {
      launchRecord.accepted_repo_ids = [...progress.accepted_repo_ids];
      launchRecord.pending_repo_ids = [...progress.pending_repo_ids];
      launchRecord.repo_count = progress.repo_count;
      launchRecord.accepted_repo_count = progress.accepted_repo_count;
      launchRecord.repo_failures = repoFailures;
      launchRecord.completion_barrier = {
        barrier_id: progress.completion_barrier_id,
        type: progress.completion_barrier_type,
        status: progress.completion_barrier_status,
      };
    }

    if (progress.completion_barrier_status === 'satisfied') {
      if (ws.launch_status !== 'completed') {
        ws.launch_status = 'completed';
        changed = true;
      }
      if (launchRecord && launchRecord.status !== 'completed') {
        launchRecord.status = 'completed';
        launchRecord.completed_at = launchRecord.completed_at || new Date().toISOString();
        changed = true;
      }
      continue;
    }

    if (repoFailures.length > 0) {
      if (ws.launch_status !== 'needs_attention') {
        ws.launch_status = 'needs_attention';
        changed = true;
      }
      if (launchRecord && launchRecord.status !== 'needs_attention') {
        launchRecord.status = 'needs_attention';
        changed = true;
      }
      if (plan.status !== 'needs_attention') {
        plan.status = 'needs_attention';
        changed = true;
      }
      continue;
    }

    if ((launchRecord?.repo_dispatches?.length || 0) > 0 || progress.accepted_repo_count > 0) {
      if (ws.launch_status !== 'launched') {
        ws.launch_status = 'launched';
        changed = true;
      }
      if (launchRecord && launchRecord.status !== 'launched') {
        launchRecord.status = 'launched';
        changed = true;
      }
    }
  }

  for (const ws of plan.workstreams || []) {
    if (ws.launch_status !== 'blocked') {
      continue;
    }
    const stillBlocked = checkDependencySatisfaction(plan, ws, root);
    if (stillBlocked.length === 0) {
      ws.launch_status = 'ready';
      changed = true;
    }
  }

  const allCompleted = Array.isArray(plan.workstreams) && plan.workstreams.length > 0
    && plan.workstreams.every((ws) => ws.launch_status === 'completed');
  if (allCompleted && plan.status !== 'completed') {
    plan.status = 'completed';
    changed = true;
  } else if (plan.status === 'needs_attention' && !(plan.workstreams || []).some((ws) => ws.launch_status === 'needs_attention')) {
    plan.status = 'approved';
    changed = true;
  }

  if (changed) {
    plan.updated_at = new Date().toISOString();
  }

  return changed;
}

export function synchronizeCoordinatorPlanState(root, mission, plan) {
  if (!mission?.coordinator?.workspace_path || !plan?.coordinator_scope) {
    return { ok: true, plan };
  }

  const workspacePath = mission.coordinator.workspace_path;
  const history = readCoordinatorHistory(workspacePath);
  const barriers = readBarriers(workspacePath);
  const coordinatorConfigResult = loadCoordinatorConfig(workspacePath);
  if (!coordinatorConfigResult.ok) {
    return { ok: false, error: `Coordinator config validation failed at ${workspacePath}: ${(coordinatorConfigResult.errors || []).join('; ')}` };
  }
  const coordinatorConfig = coordinatorConfigResult.config;

  const persistedPlan = clonePlan(plan);
  const changed = synchronizeCoordinatorWorkstreamStatuses(root, persistedPlan, coordinatorConfig, history, barriers);
  if (changed) {
    writePlanArtifact(root, mission.mission_id, persistedPlan);
  }

  const enrichedPlan = clonePlan(persistedPlan);
  for (const ws of enrichedPlan.workstreams || []) {
    const progress = buildCoordinatorWorkstreamProgress(coordinatorConfig, history, barriers, ws.workstream_id);
    if (!progress) {
      continue;
    }
    const launchRecord = getLatestCoordinatorLaunchRecord(enrichedPlan, ws.workstream_id);
    const repoFailures = launchRecord?.repo_failures || [];
    ws.coordinator_progress = progress;
    ws.coordinator_progress.failed_repo_ids = repoFailures.map((failure) => failure.repo_id);
    ws.coordinator_progress.repo_failure_count = repoFailures.length;
    if (repoFailures.length > 0) {
      ws.coordinator_progress.repo_failures = repoFailures;
    }
    if (launchRecord) {
      launchRecord.coordinator_progress = progress;
      launchRecord.coordinator_progress.failed_repo_ids = ws.coordinator_progress.failed_repo_ids;
      launchRecord.coordinator_progress.repo_failure_count = repoFailures.length;
      if (repoFailures.length > 0) {
        launchRecord.coordinator_progress.repo_failures = repoFailures;
      }
    }
  }

  return { ok: true, plan: enrichedPlan, changed };
}

/**
 * Check whether a workstream's dependencies are satisfied.
 * A dependency is satisfied when its launch_record exists AND the bound chain's
 * most recent run completed successfully.
 *
 * @returns {string[]} list of unsatisfied dependency workstream IDs
 */
export function checkDependencySatisfaction(plan, workstream, root) {
  const unsatisfied = [];
  if (!Array.isArray(workstream.depends_on)) return unsatisfied;

  for (const depId of workstream.depends_on) {
    const dependencyWorkstream = (plan.workstreams || []).find((candidate) => candidate.workstream_id === depId);
    if (dependencyWorkstream?.launch_status === 'completed') {
      continue;
    }

    const depRecord = (plan.launch_records || []).find((r) => r.workstream_id === depId);
    if (!depRecord) {
      unsatisfied.push(depId);
      continue;
    }
    if (depRecord.dispatch_mode === 'coordinator') {
      if (depRecord.status !== 'completed') {
        unsatisfied.push(depId);
      }
      continue;
    }
    // Check that the dependency chain actually completed
    const chainReport = loadChainReport(root, depRecord.chain_id);
    if (!didChainFinishSuccessfully(chainReport)) {
      unsatisfied.push(depId);
    }
  }
  return unsatisfied;
}

/**
 * Launch a single workstream from an approved plan.
 *
 * Validates plan approval, workstream existence, dependency satisfaction.
 * Records launch_record with workstream_id → chain_id binding.
 * The actual chain report attachment happens through the existing mission/chain
 * surface after execution writes the chain report.
 *
 * @returns {{ ok: boolean, plan?: object, workstream?: object, chainId?: string, launchRecord?: object, error?: string }}
 */
export function launchWorkstream(root, missionId, planId, workstreamId, options = {}) {
  const plan = loadPlan(root, missionId, planId);
  if (!plan) {
    return { ok: false, error: `Plan not found: ${planId}` };
  }
  const allowNeedsAttention = options.allowNeedsAttention === true;
  if (plan.status !== 'approved' && !(allowNeedsAttention && plan.status === 'needs_attention')) {
    return {
      ok: false,
      error: `Plan ${planId} is not approved (status: "${plan.status}"). Approve the plan before launching workstreams.`,
    };
  }

  const ws = plan.workstreams.find((w) => w.workstream_id === workstreamId);
  if (!ws) {
    return { ok: false, error: `Workstream not found: ${workstreamId}` };
  }

  if (ws.launch_status === 'launched' || ws.launch_status === 'completed') {
    return { ok: false, error: `Workstream ${workstreamId} has already been launched (status: "${ws.launch_status}").` };
  }

  // Check dependency satisfaction
  const unsatisfied = checkDependencySatisfaction(plan, ws, root);
  if (unsatisfied.length > 0) {
    return {
      ok: false,
      error: `Workstream ${workstreamId} has unsatisfied dependencies: ${unsatisfied.join(', ')}. Launch and complete those workstreams first.`,
    };
  }

  // Generate chain ID and record launch
  const chainId = options.chainId || `chain-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const launchRecord = {
    workstream_id: workstreamId,
    dispatch_mode: 'chain',
    chain_id: chainId,
    launched_at: now,
    status: 'launched',
  };

  if (!Array.isArray(plan.launch_records)) {
    plan.launch_records = [];
  }
  plan.launch_records.push(launchRecord);
  ws.launch_status = 'launched';
  plan.updated_at = now;

  writePlanArtifact(root, missionId, plan);

  return { ok: true, plan, workstream: ws, chainId, launchRecord };
}

export function launchCoordinatorWorkstream(root, mission, planId, workstreamId, dispatchResult, coordinatorConfig) {
  const plan = loadPlan(root, mission.mission_id, planId);
  if (!plan) {
    return { ok: false, error: `Plan not found: ${planId}` };
  }
  if (!mission?.coordinator?.super_run_id) {
    return { ok: false, error: 'Mission is not bound to a coordinator run.' };
  }

  const allowNeedsAttention = dispatchResult?.allowNeedsAttention === true;
  if (plan.status !== 'approved' && !(allowNeedsAttention && plan.status === 'needs_attention')) {
    return {
      ok: false,
      error: `Plan ${planId} is not approved (status: "${plan.status}"). Approve the plan before launching workstreams.`,
    };
  }

  const ws = plan.workstreams.find((candidate) => candidate.workstream_id === workstreamId);
  if (!ws) {
    return { ok: false, error: `Workstream not found: ${workstreamId}` };
  }
  if (ws.launch_status === 'completed') {
    return { ok: false, error: `Workstream ${workstreamId} is already completed.` };
  }

  const coordinatorWorkstream = coordinatorConfig?.workstreams?.[workstreamId];
  if (!coordinatorWorkstream) {
    return { ok: false, error: `Coordinator config does not declare workstream ${workstreamId}.` };
  }

  const unsatisfied = checkDependencySatisfaction(plan, ws, root);
  if (unsatisfied.length > 0) {
    return {
      ok: false,
      error: `Workstream ${workstreamId} has unsatisfied dependencies: ${unsatisfied.join(', ')}. Launch and complete those workstreams first.`,
    };
  }

  const now = new Date().toISOString();
  let launchRecord = getLatestCoordinatorLaunchRecord(plan, workstreamId);
  if (!launchRecord || launchRecord.status === 'completed' || launchRecord.status === 'failed') {
    launchRecord = {
      workstream_id: workstreamId,
      dispatch_mode: 'coordinator',
      super_run_id: mission.coordinator.super_run_id,
      launched_at: now,
      status: 'launched',
      completion_barrier: {
        barrier_id: getCoordinatorCompletionBarrierId(workstreamId),
        type: coordinatorWorkstream.completion_barrier || null,
      },
      repo_dispatches: [],
    };
    if (!Array.isArray(plan.launch_records)) {
      plan.launch_records = [];
    }
    plan.launch_records.push(launchRecord);
  }

  launchRecord.status = 'launched';
  if (!Array.isArray(launchRecord.repo_dispatches)) {
    launchRecord.repo_dispatches = [];
  }
  launchRecord.repo_dispatches.push({
    repo_id: dispatchResult.repo_id,
    repo_turn_id: dispatchResult.turn_id,
    role: dispatchResult.role,
    dispatched_at: now,
    bundle_path: dispatchResult.bundle_path,
    context_ref: dispatchResult.context_ref || null,
  });

  ws.launch_status = 'launched';
  if (plan.status === 'needs_attention') {
    plan.status = 'approved';
  }
  plan.updated_at = now;
  writePlanArtifact(root, mission.mission_id, plan);

  const synced = synchronizeCoordinatorPlanState(root, mission, plan);
  return { ok: true, plan: synced.ok ? synced.plan : plan, workstream: ws, launchRecord };
}

export function retryCoordinatorWorkstream(root, mission, planId, workstreamId, coordinatorConfig, options = {}) {
  const plan = loadPlan(root, mission.mission_id, planId);
  if (!plan) {
    return { ok: false, error: `Plan not found: ${planId}` };
  }
  if (!mission?.coordinator?.workspace_path || !mission?.coordinator?.super_run_id) {
    return { ok: false, error: 'Mission is not bound to a coordinator run.' };
  }

  const synced = synchronizeCoordinatorPlanState(root, mission, plan);
  const workingPlan = synced.ok ? synced.plan : plan;
  const ws = workingPlan.workstreams.find((candidate) => candidate.workstream_id === workstreamId);
  if (!ws) {
    return { ok: false, error: `Workstream not found: ${workstreamId}` };
  }
  if (ws.launch_status !== 'needs_attention') {
    return {
      ok: false,
      error: `Workstream ${workstreamId} is not in needs_attention state. Nothing to retry.`,
    };
  }

  const launchRecord = getLatestCoordinatorLaunchRecord(workingPlan, workstreamId);
  if (!launchRecord) {
    return { ok: false, error: `No coordinator launch record found for workstream ${workstreamId}.` };
  }

  const latestDispatchesByRepo = new Map(
    getLatestRepoDispatches(launchRecord).map((dispatch) => [dispatch.repo_id, dispatch]),
  );
  const repoFailures = buildCoordinatorRepoFailures(coordinatorConfig, launchRecord);
  launchRecord.repo_failures = repoFailures;

  if (repoFailures.length === 0) {
    return { ok: false, error: `Workstream ${workstreamId} has no retryable repo failures.` };
  }

  const retryableFailures = [];
  const blockedFailures = [];

  for (const failure of repoFailures) {
    if (!RETRYABLE_COORDINATOR_FAILURE_STATUSES.has(failure.failure_status)) {
      blockedFailures.push(`${failure.repo_id} (${failure.failure_status})`);
      continue;
    }
    retryableFailures.push(failure);
  }

  if (retryableFailures.length === 0) {
    return {
      ok: false,
      error: `No retryable repo failures in workstream ${workstreamId}. Manual intervention required: ${blockedFailures.join(', ')}`,
    };
  }

  if (retryableFailures.length > 1) {
    return {
      ok: false,
      error: `Workstream ${workstreamId} has multiple retryable repo failures. Recover them repo-locally one at a time before relaunching the coordinator workstream.`,
    };
  }

  const failure = retryableFailures[0];
  const failedDispatch = latestDispatchesByRepo.get(failure.repo_id);
  if (!failedDispatch) {
    return { ok: false, error: `Missing launch metadata for failed repo ${failure.repo_id}.` };
  }

  const downstreamBlocker = findDependentDispatchAfter(workingPlan, workstreamId, failedDispatch.dispatched_at);
  if (downstreamBlocker) {
    return {
      ok: false,
      error: `Cannot retry workstream ${workstreamId}: dependent workstream "${downstreamBlocker.workstream_id}" has already dispatched since the failed repo turn.`,
    };
  }

  const repoPath = coordinatorConfig?.repos?.[failure.repo_id]?.resolved_path;
  if (!repoPath) {
    return { ok: false, error: `Coordinator config has no resolved_path for repo "${failure.repo_id}".` };
  }

  const repoTurn = loadRepoTurnForRetry(repoPath, failure.repo_turn_id);
  if (!repoTurn.ok) {
    return repoTurn;
  }

  const reason = options.reason || `coordinator retry: ${workstreamId}/${failure.repo_id}`;
  const reissued = reissueTurn(repoTurn.root, repoTurn.config, {
    turnId: failure.repo_turn_id,
    reason,
  });
  if (!reissued.ok) {
    return { ok: false, error: reissued.error };
  }

  let repoStateForBundle = reissued.state;
  if (reissued.state?.status === 'blocked' || reissued.state?.status === 'paused') {
    const reactivated = reactivateGovernedRun(repoTurn.root, reissued.state, {
      via: 'mission plan launch --retry',
      notificationConfig: repoTurn.config,
    });
    if (!reactivated.ok) {
      return { ok: false, error: `Turn reissued but blocked run could not be reactivated: ${reactivated.error}` };
    }
    repoStateForBundle = reactivated.state;
  }

  const bundleResult = writeDispatchBundle(repoTurn.root, repoStateForBundle, repoTurn.config, {
    turnId: reissued.newTurn.turn_id,
  });
  if (!bundleResult.ok) {
    return { ok: false, error: `Turn reissued but dispatch bundle failed: ${bundleResult.error}` };
  }

  const now = new Date().toISOString();
  failedDispatch.retried_at = now;
  failedDispatch.retry_reason = failure.failure_status;
  launchRecord.repo_dispatches.push({
    repo_id: failure.repo_id,
    repo_turn_id: reissued.newTurn.turn_id,
    role: reissued.newTurn.assigned_role,
    dispatched_at: now,
    bundle_path: bundleResult.bundlePath,
    context_ref: failedDispatch.context_ref || null,
    is_retry: true,
    retry_of: failure.repo_turn_id,
  });
  launchRecord.status = 'launched';
  launchRecord.repo_failures = [];
  ws.launch_status = 'launched';

  const otherNeedsAttention = (workingPlan.workstreams || []).some(
    (candidate) => candidate.workstream_id !== workstreamId && candidate.launch_status === 'needs_attention',
  );
  workingPlan.status = otherNeedsAttention ? 'needs_attention' : 'approved';
  workingPlan.updated_at = now;
  writePlanArtifact(root, mission.mission_id, workingPlan);

  appendCoordinatorHistoryEntry(mission.coordinator.workspace_path, {
    type: 'coordinator_retry',
    timestamp: now,
    super_run_id: mission.coordinator.super_run_id,
    workstream_id: workstreamId,
    repo_id: failure.repo_id,
    failed_turn_id: failure.repo_turn_id,
    reissued_turn_id: reissued.newTurn.turn_id,
    retry_reason: failure.failure_status,
  });
  recordCoordinatorDecision(mission.coordinator.workspace_path, {
    super_run_id: mission.coordinator.super_run_id,
    phase: coordinatorConfig?.workstreams?.[workstreamId]?.phase || null,
  }, {
    category: 'retry',
    statement: `Retried ${failure.repo_id} for workstream ${workstreamId}`,
    repo_id: failure.repo_id,
    repo_turn_id: reissued.newTurn.turn_id,
    workstream_id: workstreamId,
    reason: failure.failure_status,
    context_ref: failedDispatch.context_ref || null,
  });
  emitRunEvent(mission.coordinator.workspace_path, 'coordinator_retry', {
    run_id: mission.coordinator.super_run_id,
    phase: coordinatorConfig?.workstreams?.[workstreamId]?.phase || null,
    status: 'active',
    turn: { turn_id: reissued.newTurn.turn_id, role_id: reissued.newTurn.assigned_role },
    payload: {
      workstream_id: workstreamId,
      repo_id: failure.repo_id,
      failed_turn_id: failure.repo_turn_id,
      reissued_turn_id: reissued.newTurn.turn_id,
      retry_reason: failure.failure_status,
      retry_count: launchRecord.repo_dispatches.filter((dispatch) => dispatch.repo_id === failure.repo_id && dispatch.is_retry).length,
    },
  });

  const afterRetry = synchronizeCoordinatorPlanState(root, mission, workingPlan);
  return {
    ok: true,
    plan: afterRetry.ok ? afterRetry.plan : workingPlan,
    workstream: ws,
    launchRecord,
    retryResult: {
      repo_id: failure.repo_id,
      failed_turn_id: failure.repo_turn_id,
      reissued_turn_id: reissued.newTurn.turn_id,
      role: reissued.newTurn.assigned_role,
      repo_path: repoTurn.root,
      bundle_path: bundleResult.bundlePath,
      context_ref: failedDispatch.context_ref || null,
      retry_reason: failure.failure_status,
    },
  };
}

/**
 * Record the outcome of a launched workstream after its chain completes.
 *
 * Updates launch_record with terminal reason, updates workstream launch_status,
 * and recalculates dependency-blocked workstreams.
 *
 * @returns {{ ok: boolean, plan?: object, workstream?: object, error?: string }}
 */
export function markWorkstreamOutcome(root, missionId, planId, workstreamId, { terminalReason, completedAt }) {
  const plan = loadPlan(root, missionId, planId);
  if (!plan) {
    return { ok: false, error: `Plan not found: ${planId}` };
  }

  const ws = plan.workstreams.find((w) => w.workstream_id === workstreamId);
  if (!ws) {
    return { ok: false, error: `Workstream not found: ${workstreamId}` };
  }

  const record = (plan.launch_records || []).find((r) => r.workstream_id === workstreamId);
  if (!record) {
    return { ok: false, error: `No launch record found for workstream ${workstreamId}.` };
  }

  const now = completedAt || new Date().toISOString();
  record.terminal_reason = terminalReason;
  record.completed_at = now;
  record.status = terminalReason === 'completed' ? 'completed' : 'failed';

  if (terminalReason === 'completed') {
    ws.launch_status = 'completed';

    // Recalculate blocked dependents — some may now be ready
    for (const depWs of plan.workstreams) {
      if (depWs.launch_status === 'blocked' && Array.isArray(depWs.depends_on) && depWs.depends_on.includes(workstreamId)) {
        const stillBlocked = checkDependencySatisfaction(plan, depWs, root);
        if (stillBlocked.length === 0) {
          depWs.launch_status = 'ready';
        }
      }
    }

    // Auto-complete plan when all workstreams are completed
    const allCompleted = plan.workstreams.every((w) => w.launch_status === 'completed');
    if (allCompleted) {
      plan.status = 'completed';
    }
  } else {
    ws.launch_status = 'needs_attention';
    plan.status = 'needs_attention';
  }

  plan.updated_at = now;
  writePlanArtifact(root, missionId, plan);

  return { ok: true, plan, workstream: ws };
}

/**
 * Retry a failed workstream by resetting its status and creating a new launch record.
 *
 * Only workstreams with launch_status === 'needs_attention' can be retried.
 * The old launch record is preserved for audit. A new launch record with a new
 * chain_id is created. If the plan was in 'needs_attention' status, it returns
 * to 'approved' since the retry represents a new attempt.
 *
 * @returns {{ ok: boolean, plan?: object, workstream?: object, chainId?: string, launchRecord?: object, error?: string }}
 */
export function retryWorkstream(root, missionId, planId, workstreamId, options = {}) {
  const plan = loadPlan(root, missionId, planId);
  if (!plan) {
    return { ok: false, error: `Plan not found: ${planId}` };
  }

  const ws = plan.workstreams.find((w) => w.workstream_id === workstreamId);
  if (!ws) {
    return { ok: false, error: `Workstream not found: ${workstreamId}` };
  }

  if (ws.launch_status !== 'needs_attention') {
    return {
      ok: false,
      error: `Workstream ${workstreamId} cannot be retried (status: "${ws.launch_status}"). Only "needs_attention" workstreams can be retried.`,
    };
  }

  // Generate new chain ID for the retry
  const chainId = options.chainId || `chain-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const launchRecord = {
    workstream_id: workstreamId,
    dispatch_mode: 'chain',
    chain_id: chainId,
    launched_at: now,
    status: 'launched',
    retry: true,
  };

  if (!Array.isArray(plan.launch_records)) {
    plan.launch_records = [];
  }
  plan.launch_records.push(launchRecord);
  ws.launch_status = 'launched';

  // Restore plan status from needs_attention to approved (retry in progress)
  if (plan.status === 'needs_attention') {
    plan.status = 'approved';
  }

  plan.updated_at = now;
  writePlanArtifact(root, missionId, plan);

  return { ok: true, plan, workstream: ws, chainId, launchRecord };
}

// ── Batch launch helpers ───────────────────────────────────────────────────

/**
 * Return all workstreams with launch_status === 'ready', in plan order.
 */
export function getReadyWorkstreams(plan) {
  if (!plan || !Array.isArray(plan.workstreams)) return [];
  return plan.workstreams.filter((ws) => ws.launch_status === 'ready');
}

/**
 * Return a summary of workstream status distribution for operator messaging.
 */
export function getWorkstreamStatusSummary(plan) {
  if (!plan || !Array.isArray(plan.workstreams)) return {};
  const summary = {};
  for (const ws of plan.workstreams) {
    const status = ws.launch_status || 'unknown';
    summary[status] = (summary[status] || 0) + 1;
  }
  return summary;
}

// ── LLM planner prompt ──────────────────────────────────────────────────────

/**
 * Build the system+user prompt for the mission planner LLM call.
 *
 * @param {object} mission - mission artifact
 * @param {string[]} constraints - user constraints
 * @param {string[]} roleHints - available role names
 * @param {object} [coordinatorConfig] - coordinator config when mission is multi-repo
 */
export function buildPlannerPrompt(mission, constraints, roleHints, coordinatorConfig = null) {
  const isMultiRepo = !!coordinatorConfig;

  let systemPrompt = `You are a mission decomposition planner for AgentXchain, a governed multi-agent software delivery system.

Given a mission goal, optional constraints, and optional role hints, produce a JSON object with a single "workstreams" array.

Each workstream must have:
- workstream_id: a short kebab-case identifier starting with "ws-"
- title: a human-readable title
- goal: what this workstream should accomplish
- roles: array of role names needed
- phases: array of workflow phase names
- depends_on: array of workstream_ids this depends on (empty array if none)
- acceptance_checks: array of pass/fail acceptance criteria strings

Rules:
- Order workstreams so dependencies come before dependents.
- Do NOT include chain_id — chain IDs are runtime artifacts.
- Keep workstream count between 2 and 8.
- Each workstream should be a meaningful delivery slice, not a single task.
- Use concrete, testable acceptance checks.`;

  if (isMultiRepo) {
    const validPhases = coordinatorConfig.routing
      ? Object.keys(coordinatorConfig.routing)
      : ['planning', 'implementation', 'qa'];
    const repoIds = coordinatorConfig.repos ? Object.keys(coordinatorConfig.repos) : [];

    systemPrompt += `

Multi-repo coordinator context:
- This mission spans multiple repositories: ${repoIds.join(', ')}.
- Valid phases are: ${validPhases.join(', ')}. Use ONLY these phases in workstream phase arrays.
- Workstreams should account for cross-repo coordination needs (interface alignment, shared decisions, phased rollout).
- Prefer workstreams that map cleanly to coordinator barrier types (all_repos_accepted, interface_alignment, named_decisions).`;
  }

  systemPrompt += `

Respond with ONLY valid JSON. No markdown, no explanation.`;

  const parts = [`Mission goal: ${mission.goal}`];
  if (constraints.length > 0) {
    parts.push(`Constraints:\n${constraints.map((c) => `- ${c}`).join('\n')}`);
  }
  if (roleHints.length > 0) {
    parts.push(`Available roles: ${roleHints.join(', ')}`);
  }

  if (isMultiRepo) {
    const repoEntries = Object.entries(coordinatorConfig.repos || {});
    if (repoEntries.length > 0) {
      const repoLines = repoEntries.map(([id, repo]) => `- ${id}: ${repo.path || id}`);
      parts.push(`Repos in coordinator scope:\n${repoLines.join('\n')}`);
    }
    const wsEntries = Object.entries(coordinatorConfig.workstreams || {});
    if (wsEntries.length > 0) {
      const wsLines = wsEntries.map(([id, ws]) => `- ${id} (phase: ${ws.phase}, repos: ${(ws.repos || []).join(', ')})`);
      parts.push(`Coordinator workstreams (reference — plan workstreams may differ):\n${wsLines.join('\n')}`);
    }
  }

  const userPrompt = parts.join('\n\n');
  return { systemPrompt, userPrompt };
}

/**
 * Parse raw planner response text into a structured object.
 * Handles JSON extraction from markdown fences or raw text.
 */
export function parsePlannerResponse(responseText) {
  if (!responseText || typeof responseText !== 'string') {
    return { ok: false, error: 'Empty or non-string planner response.' };
  }

  let text = responseText.trim();

  // Strip markdown JSON fences if present
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(text);
    return { ok: true, data: parsed };
  } catch (err) {
    return { ok: false, error: `Failed to parse planner response as JSON: ${err.message}` };
  }
}
