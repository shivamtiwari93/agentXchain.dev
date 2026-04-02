/**
 * Coordinator-scoped hook execution.
 *
 * Four phases, distinct from repo-local hook phases:
 *   - before_assignment (blocking): can prevent dispatch
 *   - after_acceptance (advisory): notification after projection
 *   - before_gate (blocking): can prevent phase/completion approval
 *   - on_escalation (advisory): fires when coordinator enters blocked
 *
 * Design rules:
 *   - Coordinator hooks NEVER write to repo-local state, history, or bundles
 *   - Coordinator hooks are defined in agentxchain-multi.json under "hooks"
 *   - Reuses the repo-local hook-runner for process execution
 *   - Hook payloads include coordinator context (super_run_id, workstreams, barriers)
 */

import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { runHooks } from './hook-runner.js';
import { readBarriers } from './coordinator-state.js';

// ── Phase Definitions ───────────────────────────────────────────────────────

const COORDINATOR_HOOK_PHASES = [
  'before_assignment',
  'after_acceptance',
  'before_gate',
  'on_escalation',
];

const BLOCKING_PHASES = new Set(['before_assignment', 'before_gate']);
const REPO_LOCAL_PROTECTED_FILES = [
  '.agentxchain/state.json',
  '.agentxchain/history.jsonl',
  '.agentxchain/decision-ledger.jsonl',
];

function summarizePendingBarriers(barriers) {
  return Object.entries(barriers)
    .filter(([, barrier]) => barrier?.status === 'pending' || barrier?.status === 'partially_satisfied')
    .map(([barrierId, barrier]) => ({
      barrier_id: barrierId,
      workstream_id: barrier.workstream_id ?? null,
      type: barrier.type ?? null,
      status: barrier.status ?? null,
      required_repos: Array.isArray(barrier.required_repos) ? [...barrier.required_repos] : [],
      satisfied_repos: Array.isArray(barrier.satisfied_repos) ? [...barrier.satisfied_repos] : [],
    }));
}

function walkFiles(rootPath) {
  if (!existsSync(rootPath)) {
    return [];
  }

  const entries = readdirSync(rootPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absPath = join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(absPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(absPath);
    }
  }
  return files;
}

function collectRepoProtectedPaths(workspacePath, config) {
  const protectedPaths = [];

  for (const repo of Object.values(config.repos || {})) {
    if (!repo?.resolved_path) {
      continue;
    }

    for (const relPath of REPO_LOCAL_PROTECTED_FILES) {
      protectedPaths.push(relative(workspacePath, join(repo.resolved_path, relPath)));
    }

    const dispatchRoot = join(repo.resolved_path, '.agentxchain', 'dispatch');
    for (const filePath of walkFiles(dispatchRoot)) {
      protectedPaths.push(relative(workspacePath, filePath));
    }
  }

  return protectedPaths;
}

// ── Core API ────────────────────────────────────────────────────────────────

/**
 * Fire coordinator-scoped hooks for a given phase.
 *
 * @param {string} workspacePath - coordinator workspace root
 * @param {object} config - normalized coordinator config
 * @param {string} phase - one of the four coordinator hook phases
 * @param {object} payload - phase-specific payload data
 * @param {object} [options] - additional options
 * @param {string} [options.super_run_id] - current super run ID
 * @returns {{ ok: boolean, blocked: boolean, verdicts: object[] }}
 */
export function fireCoordinatorHook(workspacePath, config, phase, payload, options = {}) {
  if (!COORDINATOR_HOOK_PHASES.includes(phase)) {
    return { ok: false, blocked: false, verdicts: [], error: `Invalid coordinator hook phase: "${phase}"` };
  }

  const hooksConfig = config.hooks;
  if (!hooksConfig || !hooksConfig[phase] || !Array.isArray(hooksConfig[phase]) || hooksConfig[phase].length === 0) {
    return { ok: true, blocked: false, verdicts: [] };
  }

  // Build coordinator-scoped payload
  const barriers = readBarriers(workspacePath);
  const coordinatorPayload = {
    ...payload,
    super_run_id: options.super_run_id || null,
    pending_barriers: summarizePendingBarriers(barriers),
    pending_gate: payload.pending_gate ?? null,
    coordinator_workspace: workspacePath,
    barriers: Object.fromEntries(
      Object.entries(barriers).map(([id, b]) => [id, { status: b.status, type: b.type }])
    ),
  };

  // Coordinator hooks protect coordinator state files, not repo-local ones
  const protectedPaths = [
    '.agentxchain/multirepo/state.json',
    '.agentxchain/multirepo/history.jsonl',
    '.agentxchain/multirepo/barriers.json',
    '.agentxchain/multirepo/barrier-ledger.jsonl',
    ...collectRepoProtectedPaths(workspacePath, config),
  ];

  const auditDir = join(workspacePath, '.agentxchain', 'multirepo');

  const result = runHooks(workspacePath, hooksConfig, phase, coordinatorPayload, {
    run_id: options.super_run_id || '',
    protectedPaths,
    auditDir,
  });

  const verdicts = (result.results || []).map(r => ({
    hook_name: r.hook_name,
    verdict: r.verdict,
    message: r.message,
    orchestrator_action: r.orchestrator_action,
  }));

  // For blocking phases, check if any hook blocked
  const blocked = BLOCKING_PHASES.has(phase) && result.blocked === true;

  return {
    ok: result.ok !== false,
    blocked,
    verdicts,
    tamper: result.tamper || null,
    error: result.tamper?.message || result.blocker?.message || null,
  };
}

/**
 * Build the payload for a before_assignment hook.
 */
export function buildAssignmentPayload(assignment, state) {
  return {
    phase: 'before_assignment',
    workstream_id: assignment.workstream_id,
    repo_id: assignment.repo_id,
    repo_run_id: state.repo_runs?.[assignment.repo_id]?.run_id ?? null,
    role: assignment.role,
    coordinator_status: state.status,
    coordinator_phase: state.phase,
    pending_gate: state.pending_gate || null,
  };
}

/**
 * Build the payload for an after_acceptance hook.
 */
export function buildAcceptancePayload(projectionResult, repoId, workstreamId, state) {
  return {
    phase: 'after_acceptance',
    workstream_id: workstreamId,
    repo_id: repoId,
    repo_run_id: state.repo_runs?.[repoId]?.run_id ?? null,
    projection_ref: projectionResult.projection_ref,
    repo_turn_id: projectionResult.repo_turn_id ?? null,
    summary: projectionResult.summary ?? '',
    files_changed: projectionResult.files_changed || [],
    decisions: projectionResult.decisions || [],
    verification: projectionResult.verification ?? null,
    barrier_effects: projectionResult.barrier_effects || [],
    context_invalidations: projectionResult.context_invalidations || [],
    coordinator_status: state.status,
    coordinator_phase: state.phase,
    pending_gate: state.pending_gate || null,
  };
}

/**
 * Build the payload for a before_gate hook.
 */
export function buildGatePayload(pendingGate, state) {
  return {
    phase: 'before_gate',
    workstream_id: pendingGate.workstream_id || null,
    repo_id: null,
    repo_run_id: null,
    gate_type: pendingGate.gate_type,
    gate: pendingGate.gate,
    from_phase: pendingGate.from || null,
    to_phase: pendingGate.to || null,
    required_repos: pendingGate.required_repos || [],
    human_barriers: pendingGate.human_barriers || [],
    coordinator_status: state.status,
    coordinator_phase: state.phase,
    pending_gate: pendingGate,
  };
}

/**
 * Build the payload for an on_escalation hook.
 */
export function buildEscalationPayload(blockedReason, state) {
  return {
    phase: 'on_escalation',
    workstream_id: null,
    repo_id: null,
    repo_run_id: null,
    blocked_reason: blockedReason,
    coordinator_status: state.status,
    coordinator_phase: state.phase,
    pending_gate: state.pending_gate || null,
    repo_runs: state.repo_runs || {},
  };
}
