/**
 * Mission decomposition — plan artifact CRUD and schema validation.
 *
 * Plans are advisory repo-local artifacts under `.agentxchain/missions/plans/<mission_id>/`.
 * They contain dependency-ordered workstreams derived from a mission goal.
 * Plans are NOT protocol-normative.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { loadChainReport } from './chain-reports.js';
import { loadMissionArtifact } from './missions.js';

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

/**
 * Create a plan artifact from validated planner output.
 *
 * @param {string} root - project root
 * @param {object} mission - mission artifact (must have mission_id, goal)
 * @param {object} options - { constraints, roleHints, plannerOutput }
 * @returns {{ ok: boolean, plan?: object, errors?: string[] }}
 */
export function createPlanArtifact(root, mission, { constraints = [], roleHints = [], plannerOutput }) {
  const validation = validatePlannerOutput(plannerOutput);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
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

// ── Workstream launch ───────────────────────────────────────────────────────

/**
 * Check whether a workstream's dependencies are satisfied.
 * A dependency is satisfied when its launch_record exists AND its chain completed.
 *
 * @returns {string[]} list of unsatisfied dependency workstream IDs
 */
export function checkDependencySatisfaction(plan, workstream, root) {
  const unsatisfied = [];
  if (!Array.isArray(workstream.depends_on)) return unsatisfied;

  for (const depId of workstream.depends_on) {
    const depRecord = (plan.launch_records || []).find((r) => r.workstream_id === depId);
    if (!depRecord) {
      unsatisfied.push(depId);
      continue;
    }
    // Check that the dependency chain actually completed
    const chainReport = loadChainReport(root, depRecord.chain_id);
    if (!chainReport || chainReport.terminal_reason !== 'completed') {
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
 * Attaches the chain to the parent mission.
 *
 * @returns {{ ok: boolean, plan?: object, workstream?: object, chainId?: string, launchRecord?: object, error?: string }}
 */
export function launchWorkstream(root, missionId, planId, workstreamId) {
  const plan = loadPlan(root, missionId, planId);
  if (!plan) {
    return { ok: false, error: `Plan not found: ${planId}` };
  }
  if (plan.status !== 'approved') {
    return { ok: false, error: `Plan ${planId} is not approved (status: "${plan.status}"). Approve the plan before launching workstreams.` };
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
  const chainId = `chain-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const launchRecord = {
    workstream_id: workstreamId,
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

  // Directly attach chain_id to mission artifact.
  // We cannot use attachChainToMission() here because that function requires
  // the chain report to exist on disk, but execution hasn't started yet.
  const mission = loadMissionArtifact(root, missionId);
  if (mission) {
    const chainIds = Array.isArray(mission.chain_ids) ? [...mission.chain_ids] : [];
    if (!chainIds.includes(chainId)) {
      chainIds.push(chainId);
    }
    const updatedMission = { ...mission, chain_ids: chainIds, updated_at: now };
    const missionsDir = join(root, '.agentxchain', 'missions');
    mkdirSync(missionsDir, { recursive: true });
    writeFileSync(join(missionsDir, `${missionId}.json`), JSON.stringify(updatedMission, null, 2));
  }

  return { ok: true, plan, workstream: ws, chainId, launchRecord };
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
  } else {
    ws.launch_status = 'needs_attention';
    plan.status = 'needs_attention';
  }

  plan.updated_at = now;
  writePlanArtifact(root, missionId, plan);

  return { ok: true, plan, workstream: ws };
}

// ── LLM planner prompt ──────────────────────────────────────────────────────

/**
 * Build the system+user prompt for the mission planner LLM call.
 */
export function buildPlannerPrompt(mission, constraints, roleHints) {
  const systemPrompt = `You are a mission decomposition planner for AgentXchain, a governed multi-agent software delivery system.

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
- Use concrete, testable acceptance checks.

Respond with ONLY valid JSON. No markdown, no explanation.`;

  const parts = [`Mission goal: ${mission.goal}`];
  if (constraints.length > 0) {
    parts.push(`Constraints:\n${constraints.map((c) => `- ${c}`).join('\n')}`);
  }
  if (roleHints.length > 0) {
    parts.push(`Available roles: ${roleHints.join(', ')}`);
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
