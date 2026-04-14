/**
 * Coordinator acceptance projection & barrier evaluation.
 *
 * After a repo-local turn is accepted, this module:
 *   1. Projects the accepted turn into coordinator history (without mutating repo-local state)
 *   2. Evaluates barrier effects from the acceptance
 *   3. Records barrier transitions in both snapshot and audit ledger
 *   4. Detects context invalidations for downstream re-dispatch
 *
 * Design rules:
 *   - Coordinator NEVER writes to repo-local .agentxchain/ (DEC-MR-IMPL-004)
 *   - Projections are derived artifacts, not authoritative — repo-local history is truth
 *   - Barrier evaluation is deterministic given the current state
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { isAbsolute, join, dirname, relative, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readBarriers, readCoordinatorHistory, saveCoordinatorState } from './coordinator-state.js';
import {
  computeBarrierStatus as computeCoordinatorBarrierStatus,
  getAcceptedReposForWorkstream,
  getAlignedReposForBarrier,
} from './coordinator-barriers.js';

// ── Paths ───────────────────────────────────────────────────────────────────

const MULTIREPO_DIR = '.agentxchain/multirepo';

function multiDir(ws) {
  return join(ws, MULTIREPO_DIR);
}

function historyPath(ws) {
  return join(multiDir(ws), 'history.jsonl');
}

function barriersPath(ws) {
  return join(multiDir(ws), 'barriers.json');
}

function barrierLedgerPath(ws) {
  return join(multiDir(ws), 'barrier-ledger.jsonl');
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function appendJsonl(filePath, entry) {
  mkdirSync(dirname(filePath), { recursive: true });
  appendFileSync(filePath, JSON.stringify(entry) + '\n');
}

function generateProjectionRef(repoId, workstreamId) {
  const rand = randomBytes(4).toString('hex');
  return `proj_${workstreamId}_${repoId}_${rand}`;
}

/**
 * Read repo-local history without mutating it.
 */
function readRepoLocalHistory(repoPath) {
  const file = join(repoPath, '.agentxchain/history.jsonl');
  if (!existsSync(file)) return [];
  try {
    const content = readFileSync(file, 'utf8').trim();
    if (!content) return [];
    return content.split('\n').map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

// ── Projection ──────────────────────────────────────────────────────────────

/**
 * Project a repo-local accepted turn into coordinator state.
 *
 * Reads the accepted turn from repo-local history, creates a derived projection,
 * appends it to coordinator history, then evaluates barrier effects.
 *
 * @param {string} workspacePath - coordinator workspace
 * @param {object} state - current coordinator state
 * @param {object} config - normalized coordinator config
 * @param {string} repoId - the repo whose turn was accepted
 * @param {object} acceptedTurn - the accepted turn result from repo-local acceptance
 * @param {string} workstreamId - the workstream this acceptance belongs to
 * @returns {{ ok: boolean, projection_ref?: string, barrier_effects?: object[], context_invalidations?: string[], error?: string }}
 */
export function projectRepoAcceptance(workspacePath, state, config, repoId, acceptedTurn, workstreamId) {
  // Validate inputs
  if (!config.repos?.[repoId]) {
    return { ok: false, error: `Unknown repo "${repoId}"` };
  }
  if (!config.workstreams?.[workstreamId]) {
    return { ok: false, error: `Unknown workstream "${workstreamId}"` };
  }
  if (!acceptedTurn || !acceptedTurn.turn_id) {
    return { ok: false, error: 'acceptedTurn must include turn_id' };
  }

  // Validate cross-repo write constraint (AT-CA-006)
  if (Array.isArray(acceptedTurn.files_changed)) {
    const repo = config.repos[repoId];
    for (const filePath of acceptedTurn.files_changed) {
      const resolvedFilePath = isAbsolute(filePath)
        ? resolve(filePath)
        : resolve(repo.resolved_path, filePath);
      const repoRelativePath = relative(repo.resolved_path, resolvedFilePath);
      const insideTargetRepo = repoRelativePath === ''
        || (!repoRelativePath.startsWith('..') && !isAbsolute(repoRelativePath));

      if (insideTargetRepo) {
        continue;
      }

      const otherRepoId = config.repo_order.find((candidateRepoId) => {
        if (candidateRepoId === repoId) return false;
        const candidateRepo = config.repos[candidateRepoId];
        if (!candidateRepo?.resolved_path) return false;
        const candidateRelativePath = relative(candidateRepo.resolved_path, resolvedFilePath);
        return candidateRelativePath === ''
          || (!candidateRelativePath.startsWith('..') && !isAbsolute(candidateRelativePath));
      });

      return {
        ok: false,
        error: otherRepoId
          ? `Cross-repo write violation: file "${filePath}" belongs to repo "${otherRepoId}", not "${repoId}"`
          : `Cross-repo write violation: file "${filePath}" resolves outside repo "${repoId}"`,
      };
    }
  }

  const projectionRef = generateProjectionRef(repoId, workstreamId);
  const now = new Date().toISOString();

  // Create the projection entry
  const projection = {
    type: 'acceptance_projection',
    timestamp: now,
    super_run_id: state.super_run_id,
    projection_ref: projectionRef,
    workstream_id: workstreamId,
    repo_id: repoId,
    repo_run_id: state.repo_runs?.[repoId]?.run_id ?? null,
    repo_turn_id: acceptedTurn.turn_id,
    summary: acceptedTurn.summary ?? '',
    files_changed: acceptedTurn.files_changed ?? [],
    decisions: acceptedTurn.decisions ?? [],
    verification: acceptedTurn.verification ?? null,
  };

  // Append to coordinator history (NOT repo-local history)
  appendJsonl(historyPath(workspacePath), projection);

  // Evaluate barrier effects
  const barrierEffects = evaluateBarrierEffects(workspacePath, state, config, repoId, workstreamId);

  // Check for context invalidations
  const contextInvalidations = detectContextInvalidations(workspacePath, config, repoId, workstreamId);

  return {
    ok: true,
    projection_ref: projectionRef,
    barrier_effects: barrierEffects,
    context_invalidations: contextInvalidations,
  };
}

// ── Barrier Evaluation ──────────────────────────────────────────────────────

/**
 * Evaluate all barriers against current coordinator state.
 *
 * Scans each barrier and determines if it should transition based on
 * the projections currently in coordinator history.
 *
 * @param {string} workspacePath
 * @param {object} state
 * @param {object} config
 * @returns {{ barriers: object, changes: object[] }}
 */
export function evaluateBarriers(workspacePath, state, config) {
  const barriers = readBarriers(workspacePath);
  const history = readCoordinatorHistory(workspacePath);
  const changes = [];

  for (const [barrierId, barrier] of Object.entries(barriers)) {
    if (barrier.status === 'satisfied') continue;

    const newStatus = computeBarrierStatus(barrier, history, config);
    if (newStatus !== barrier.status) {
      const previousStatus = barrier.status;
      barrier.status = newStatus;

      // Update satisfied_repos for tracking
      if (barrier.type === 'all_repos_accepted') {
        barrier.satisfied_repos = getAcceptedReposForWorkstream(history, barrier.workstream_id, barrier.required_repos);
      }

      changes.push({
        barrier_id: barrierId,
        previous_status: previousStatus,
        new_status: newStatus,
        workstream_id: barrier.workstream_id,
        type: barrier.type,
      });

      // Record in audit ledger
      recordBarrierTransition(workspacePath, barrierId, previousStatus, newStatus, {
        super_run_id: state.super_run_id,
        workstream_id: barrier.workstream_id,
        barrier_type: barrier.type,
      });
    }
  }

  // Persist updated barriers snapshot
  if (changes.length > 0) {
    writeFileSync(barriersPath(workspacePath), JSON.stringify(barriers, null, 2) + '\n');
  }

  return { barriers, changes };
}

/**
 * Record a barrier transition in the barrier-ledger.jsonl.
 *
 * @param {string} workspacePath
 * @param {string} barrierId
 * @param {string} previousStatus
 * @param {string} newStatus
 * @param {object} causation - metadata about why the transition occurred
 */
export function recordBarrierTransition(workspacePath, barrierId, previousStatus, newStatus, causation) {
  appendJsonl(barrierLedgerPath(workspacePath), {
    type: 'barrier_transition',
    timestamp: new Date().toISOString(),
    barrier_id: barrierId,
    previous_status: previousStatus,
    new_status: newStatus,
    causation,
  });
}

function computeBarrierStatus(barrier, history, config) {
  return computeCoordinatorBarrierStatus(barrier, history, config);
}

// ── Barrier effects from a single acceptance ────────────────────────────────

function evaluateBarrierEffects(workspacePath, state, config, repoId, workstreamId) {
  const barriers = readBarriers(workspacePath);
  const history = readCoordinatorHistory(workspacePath);
  const effects = [];
  let snapshotChanged = false;

  for (const [barrierId, barrier] of Object.entries(barriers)) {
    if (barrier.status === 'satisfied') continue;
    if (barrier.workstream_id !== workstreamId) continue;

    const newStatus = computeBarrierStatus(barrier, history, config);
    if (barrier.type === 'all_repos_accepted') {
      const satisfiedRepos = getAcceptedReposForWorkstream(history, workstreamId, barrier.required_repos);
      if (JSON.stringify(barrier.satisfied_repos || []) !== JSON.stringify(satisfiedRepos)) {
        barrier.satisfied_repos = satisfiedRepos;
        snapshotChanged = true;
      }
    }
    if (barrier.type === 'interface_alignment' || barrier.type === 'named_decisions') {
      const satisfiedRepos = getAlignedReposForBarrier(barrier, history);
      if (JSON.stringify(barrier.satisfied_repos || []) !== JSON.stringify(satisfiedRepos)) {
        barrier.satisfied_repos = satisfiedRepos;
        snapshotChanged = true;
      }
    }

    if (newStatus !== barrier.status) {
      const previousStatus = barrier.status;
      barrier.status = newStatus;
      snapshotChanged = true;

      effects.push({
        barrier_id: barrierId,
        previous_status: previousStatus,
        new_status: newStatus,
      });

      recordBarrierTransition(workspacePath, barrierId, previousStatus, newStatus, {
        super_run_id: state.super_run_id,
        workstream_id: workstreamId,
        repo_id: repoId,
        barrier_type: barrier.type,
      });
    }
  }

  // Persist updated barrier snapshot
  if (snapshotChanged) {
    writeFileSync(barriersPath(workspacePath), JSON.stringify(barriers, null, 2) + '\n');
  }

  return effects;
}

// ── Context invalidation detection ──────────────────────────────────────────

function detectContextInvalidations(workspacePath, config, repoId, workstreamId) {
  const history = readCoordinatorHistory(workspacePath);
  const invalidations = [];

  // Find all dispatched turns in the same workstream for OTHER repos
  // that were dispatched BEFORE this acceptance — their context is now stale
  for (const entry of history) {
    if (entry?.type !== 'turn_dispatched') continue;
    if (entry.workstream_id !== workstreamId) continue;
    if (entry.repo_id === repoId) continue;

    // Check if this dispatched turn has NOT been projected yet (still pending)
    const hasProjection = history.some(
      e => e?.type === 'acceptance_projection'
        && e.workstream_id === workstreamId
        && e.repo_id === entry.repo_id
        && e.repo_turn_id === entry.repo_turn_id
    );

    if (!hasProjection) {
      invalidations.push(entry.repo_turn_id);
    }
  }

  // Also check downstream workstreams that depend on this one
  for (const [wsId, ws] of Object.entries(config.workstreams)) {
    if (!ws.depends_on?.includes(workstreamId)) continue;

    for (const entry of history) {
      if (entry?.type !== 'turn_dispatched') continue;
      if (entry.workstream_id !== wsId) continue;

      const hasProjection = history.some(
        e => e?.type === 'acceptance_projection'
          && e.workstream_id === wsId
          && e.repo_id === entry.repo_id
          && e.repo_turn_id === entry.repo_turn_id
      );

      if (!hasProjection) {
        invalidations.push(entry.repo_turn_id);
      }
    }
  }

  return [...new Set(invalidations)];
}
