/**
 * Mission decomposition — plan artifact CRUD and schema validation.
 *
 * Plans are advisory repo-local artifacts under `.agentxchain/missions/plans/<mission_id>/`.
 * They contain dependency-ordered workstreams derived from a mission goal.
 * Plans are NOT protocol-normative.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// ── Plan artifact directory ──────────────────────────────────────────────────

export function getPlansDir(root, missionId) {
  return join(root, '.agentxchain', 'missions', 'plans', missionId);
}

// ── Plan ID generation ───────────────────────────────────────────────────────

export function generatePlanId() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', 'Z');
  const suffix = Math.random().toString(36).slice(2, 8);
  return `plan-${ts}-${suffix}`;
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
  const plansDir = getPlansDir(root, missionId);
  mkdirSync(plansDir, { recursive: true });

  // Check for existing approved plan to set supersedes_plan_id
  const existingPlans = loadAllPlans(root, missionId);
  const latestApproved = existingPlans.find((p) => p.status === 'approved');
  const latestProposed = existingPlans.find((p) => p.status === 'proposed');
  const supersedes = latestApproved || latestProposed || null;

  const planId = generatePlanId();
  const now = new Date().toISOString();

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

  writeFileSync(join(plansDir, `${planId}.json`), JSON.stringify(plan, null, 2));
  return { ok: true, plan };
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
  const exactPath = join(plansDir, `${planId}.json`);
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
