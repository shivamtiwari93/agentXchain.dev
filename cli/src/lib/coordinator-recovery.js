/**
 * Coordinator divergence detection and state recovery.
 *
 * Compares coordinator expectations against repo-local authority and
 * rebuilds coordinator state from explicit event contracts only.
 *
 * Design rules:
 *   - Repo-local state is always authoritative (DEC-MR-IMPL-004)
 *   - Recovery NEVER writes to repo-local .agentxchain/
 *   - Rebuild uses only explicit coordinator history event types
 *   - Ambiguous state forces blocked status, not silent repair
 *   - Pending gates survive safe resync; ambiguous gates force blocked
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadCoordinatorState,
  saveCoordinatorState,
  readCoordinatorHistory,
  readBarriers,
} from './coordinator-state.js';
import { safeWriteJson } from './safe-write.js';

// ── Paths ───────────────────────────────────────────────────────────────────

const MULTIREPO_DIR = '.agentxchain/multirepo';

function barriersPath(ws) {
  return join(ws, MULTIREPO_DIR, 'barriers.json');
}

function historyPath(ws) {
  return join(ws, MULTIREPO_DIR, 'history.jsonl');
}

function barrierLedgerPath(ws) {
  return join(ws, MULTIREPO_DIR, 'barrier-ledger.jsonl');
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function appendJsonl(filePath, entry) {
  appendFileSync(filePath, JSON.stringify(entry) + '\n');
}

function readRepoLocalState(repoPath) {
  const stateFile = join(repoPath, '.agentxchain/state.json');
  if (!existsSync(stateFile)) return null;
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {
    return null;
  }
}

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

// ── Divergence Detection ────────────────────────────────────────────────────

/**
 * Detect divergence between coordinator expectations and repo-local authority.
 *
 * Compares:
 *   - Coordinator repo_runs status vs actual repo-local state
 *   - Dispatched turns expected active vs repo-local acceptance/rejection
 *   - Coordinator phase expectations vs repo-local phase
 *
 * @param {string} workspacePath
 * @param {object} state - current coordinator state
 * @param {object} config - normalized coordinator config
 * @returns {{ diverged: boolean, mismatches: object[] }}
 */
export function detectDivergence(workspacePath, state, config) {
  const mismatches = [];
  const history = readCoordinatorHistory(workspacePath);

  for (const [repoId, repoRun] of Object.entries(state.repo_runs || {})) {
    const repo = config.repos?.[repoId];
    if (!repo?.resolved_path) {
      mismatches.push({
        type: 'repo_config_missing',
        repo_id: repoId,
        detail: `Repo "${repoId}" has no resolved_path in config`,
      });
      continue;
    }

    const repoState = readRepoLocalState(repo.resolved_path);
    if (!repoState) {
      mismatches.push({
        type: 'repo_state_missing',
        repo_id: repoId,
        detail: `Repo "${repoId}" has no .agentxchain/state.json`,
      });
      continue;
    }

    // Run ID mismatch
    if (repoRun.run_id && repoState.run_id && repoRun.run_id !== repoState.run_id) {
      mismatches.push({
        type: 'run_id_mismatch',
        repo_id: repoId,
        coordinator_run_id: repoRun.run_id,
        repo_run_id: repoState.run_id,
        detail: `Coordinator expects run "${repoRun.run_id}" but repo has "${repoState.run_id}"`,
      });
    }

    // Repo completed but coordinator thinks it's active
    if (repoState.status === 'completed' && repoRun.status !== 'completed') {
      mismatches.push({
        type: 'repo_completed_unexpectedly',
        repo_id: repoId,
        coordinator_status: repoRun.status,
        repo_status: repoState.status,
        detail: `Coordinator expects repo "${repoId}" as "${repoRun.status}" but repo is completed`,
      });
    }

    // Repo blocked but coordinator doesn't know
    if (repoState.status === 'blocked' && repoRun.status !== 'blocked') {
      mismatches.push({
        type: 'repo_blocked_unexpectedly',
        repo_id: repoId,
        coordinator_status: repoRun.status,
        repo_status: repoState.status,
        detail: `Coordinator expects repo "${repoId}" as "${repoRun.status}" but repo is blocked`,
      });
    }
  }

  // Check dispatched turns that coordinator thinks are active but repo has already accepted/rejected
  const dispatchedTurns = history.filter(e => e?.type === 'turn_dispatched');
  const projectedTurnIds = new Set(
    history
      .filter(e => e?.type === 'acceptance_projection')
      .map(e => e.repo_turn_id)
  );

  for (const dispatch of dispatchedTurns) {
    if (projectedTurnIds.has(dispatch.repo_turn_id)) continue; // Already projected

    const repo = config.repos?.[dispatch.repo_id];
    if (!repo?.resolved_path) continue;

    const repoState = readRepoLocalState(repo.resolved_path);
    if (!repoState) continue;

    // Check if the turn is still active in the repo
    const activeTurns = repoState.active_turns || {};
    const turnStillActive = Object.keys(activeTurns).includes(dispatch.repo_turn_id);

    if (!turnStillActive) {
      // Turn is no longer active but coordinator hasn't projected it
      // Read repo-local history to determine what happened
      const repoHistory = readRepoLocalHistory(repo.resolved_path);
      const turnAccepted = repoHistory.some(
        e => e?.turn_id === dispatch.repo_turn_id && e?.status === 'accepted'
      );
      const turnRejected = repoHistory.some(
        e => e?.turn_id === dispatch.repo_turn_id && e?.status === 'rejected'
      );

      mismatches.push({
        type: turnAccepted ? 'turn_accepted_unprojected' : turnRejected ? 'turn_rejected_unprojected' : 'turn_disappeared',
        repo_id: dispatch.repo_id,
        turn_id: dispatch.repo_turn_id,
        workstream_id: dispatch.workstream_id,
        detail: turnAccepted
          ? `Turn "${dispatch.repo_turn_id}" accepted in repo "${dispatch.repo_id}" but not projected in coordinator`
          : turnRejected
            ? `Turn "${dispatch.repo_turn_id}" rejected in repo "${dispatch.repo_id}" but coordinator has no record`
            : `Turn "${dispatch.repo_turn_id}" no longer active in repo "${dispatch.repo_id}" for unknown reason`,
      });
    }
  }

  return {
    diverged: mismatches.length > 0,
    mismatches,
  };
}

// ── Resync ──────────────────────────────────────────────────────────────────

/**
 * Rebuild coordinator state from repo-local authority.
 *
 * Reads repo-local state and history, rebuilds coordinator projections
 * and barriers from explicit event contracts only. Preserves pending
 * gates when they are still coherent with repo state.
 *
 * Event contracts used for rebuild:
 *   - acceptance_projection (from coordinator history — kept if repo confirms)
 *   - turn_dispatched (from coordinator history — kept as-is)
 *   - phase_transition_requested / phase_transition_approved
 *   - run_completion_requested / run_completed
 *   - barrier_transition (from barrier-ledger.jsonl)
 *
 * @param {string} workspacePath
 * @param {object} state - current coordinator state
 * @param {object} config - normalized coordinator config
 * @returns {{ ok: boolean, resynced_repos: string[], barrier_changes: object[], errors: string[], blocked_reason?: string }}
 */
export function resyncFromRepoAuthority(workspacePath, state, config) {
  const errors = [];
  const resyncedRepos = [];
  const barrierChanges = [];

  // Step 1: Refresh repo_runs from repo-local authority
  const updatedRepoRuns = { ...state.repo_runs };

  for (const [repoId, repoRun] of Object.entries(state.repo_runs || {})) {
    const repo = config.repos?.[repoId];
    if (!repo?.resolved_path) {
      errors.push(`Repo "${repoId}" has no resolved_path in config`);
      continue;
    }

    const repoState = readRepoLocalState(repo.resolved_path);
    if (!repoState) {
      errors.push(`Repo "${repoId}" state unreadable`);
      continue;
    }

    const changes = {};

    // Update run_id if it changed (e.g., repo was re-initialized outside coordinator)
    if (repoState.run_id && repoState.run_id !== repoRun.run_id) {
      changes.run_id = repoState.run_id;
    }

    // Update status from repo-local authority
    if (repoState.status === 'completed' && repoRun.status !== 'completed') {
      changes.status = 'completed';
    } else if (repoState.status === 'blocked') {
      changes.status = 'blocked';
    } else if (repoState.status === 'active') {
      changes.status = repoRun.initialized_by_coordinator ? 'initialized' : 'linked';
    }

    // Update phase
    if (repoState.phase && repoState.phase !== repoRun.phase) {
      changes.phase = repoState.phase;
    }

    if (Object.keys(changes).length > 0) {
      updatedRepoRuns[repoId] = { ...repoRun, ...changes };
      resyncedRepos.push(repoId);
    }
  }

  // Step 2: Rebuild projections for unprojected accepted turns
  const history = readCoordinatorHistory(workspacePath);
  const projectedTurnIds = new Set(
    history
      .filter(e => e?.type === 'acceptance_projection')
      .map(e => e.repo_turn_id)
  );
  const dispatchedTurns = history.filter(e => e?.type === 'turn_dispatched');

  for (const dispatch of dispatchedTurns) {
    if (projectedTurnIds.has(dispatch.repo_turn_id)) continue;

    const repo = config.repos?.[dispatch.repo_id];
    if (!repo?.resolved_path) continue;

    const repoHistory = readRepoLocalHistory(repo.resolved_path);
    const acceptedEntry = repoHistory.find(
      e => e?.turn_id === dispatch.repo_turn_id && e?.status === 'accepted'
    );

    if (acceptedEntry) {
      // Create a recovery projection
      const projection = {
        type: 'acceptance_projection',
        timestamp: new Date().toISOString(),
        super_run_id: state.super_run_id,
        projection_ref: `proj_recovery_${dispatch.repo_id}_${Date.now()}`,
        workstream_id: dispatch.workstream_id,
        repo_id: dispatch.repo_id,
        repo_run_id: dispatch.repo_run_id,
        repo_turn_id: dispatch.repo_turn_id,
        summary: acceptedEntry.summary ?? '',
        files_changed: acceptedEntry.files_changed ?? [],
        decisions: acceptedEntry.decisions ?? [],
        verification: acceptedEntry.verification ?? null,
        recovery: true,
      };

      appendJsonl(historyPath(workspacePath), projection);
      resyncedRepos.push(dispatch.repo_id);
    }
  }

  // Step 3: Rebuild barrier snapshot from coordinator history (including new recovery projections)
  const fullHistory = readCoordinatorHistory(workspacePath); // Re-read after appending
  const barriers = readBarriers(workspacePath);
  let barriersChanged = false;

  for (const [barrierId, barrier] of Object.entries(barriers)) {
    if (barrier.status === 'satisfied') continue;
    if (barrier.type === 'shared_human_gate') continue; // Never auto-transition

    const newStatus = recomputeBarrierStatus(barrier, fullHistory, config);
    if (newStatus !== barrier.status) {
      const previousStatus = barrier.status;
      barrierChanges.push({
        barrier_id: barrierId,
        previous_status: previousStatus,
        new_status: newStatus,
      });

      barrier.status = newStatus;

      // Update satisfied_repos for tracking
      if (barrier.type === 'all_repos_accepted') {
        barrier.satisfied_repos = getAcceptedReposForWorkstream(
          fullHistory, barrier.workstream_id, barrier.required_repos
        );
      }

      barriersChanged = true;

      appendJsonl(barrierLedgerPath(workspacePath), {
        type: 'barrier_transition',
        timestamp: new Date().toISOString(),
        barrier_id: barrierId,
        previous_status: previousStatus,
        new_status: newStatus,
        causation: {
          super_run_id: state.super_run_id,
          trigger: 'resync',
        },
      });
    }
  }

  if (barriersChanged) {
    safeWriteJson(barriersPath(workspacePath), barriers);
  }

  // Step 4: Validate pending_gate coherence
  let blockedReason = null;
  const pendingGate = state.pending_gate;

  if (pendingGate) {
    const gateCoherent = validatePendingGateCoherence(pendingGate, updatedRepoRuns, config);
    if (!gateCoherent.ok) {
      blockedReason = gateCoherent.reason;
    }
  }

  // Step 5: Update coordinator state
  const newStatus = blockedReason ? 'blocked' : state.status;
  const updatedState = {
    ...state,
    repo_runs: updatedRepoRuns,
    status: newStatus,
    blocked_reason: blockedReason || undefined,
  };

  // Clean up blocked_reason if no longer blocked
  if (!blockedReason && updatedState.blocked_reason) {
    delete updatedState.blocked_reason;
  }

  saveCoordinatorState(workspacePath, updatedState);

  // Step 6: Append resync event to history
  appendJsonl(historyPath(workspacePath), {
    type: 'state_resynced',
    timestamp: new Date().toISOString(),
    super_run_id: state.super_run_id,
    resynced_repos: resyncedRepos,
    barrier_changes: barrierChanges,
    blocked_reason: blockedReason || null,
  });

  return {
    ok: !blockedReason,
    resynced_repos: [...new Set(resyncedRepos)],
    barrier_changes: barrierChanges,
    errors,
    blocked_reason: blockedReason || undefined,
  };
}

// ── Internal helpers ────────────────────────────────────────────────────────

function getAcceptedReposForWorkstream(history, workstreamId, requiredRepos) {
  const accepted = new Set();
  for (const entry of history) {
    if (entry?.type === 'acceptance_projection' && entry.workstream_id === workstreamId) {
      if (requiredRepos.includes(entry.repo_id)) {
        accepted.add(entry.repo_id);
      }
    }
  }
  return [...accepted];
}

function recomputeBarrierStatus(barrier, history, config) {
  switch (barrier.type) {
    case 'all_repos_accepted': {
      const required = new Set(barrier.required_repos);
      const satisfied = new Set();
      for (const entry of history) {
        if (entry?.type === 'acceptance_projection' && entry.workstream_id === barrier.workstream_id) {
          if (required.has(entry.repo_id)) {
            satisfied.add(entry.repo_id);
          }
        }
      }
      if (satisfied.size === required.size) return 'satisfied';
      if (satisfied.size > 0) return 'partially_satisfied';
      return 'pending';
    }

    case 'ordered_repo_sequence': {
      const workstream = config.workstreams?.[barrier.workstream_id];
      if (!workstream) return barrier.status;
      const entryRepo = workstream.entry_repo;
      const hasUpstream = history.some(
        e => e?.type === 'acceptance_projection'
          && e.workstream_id === barrier.workstream_id
          && e.repo_id === entryRepo
      );
      if (hasUpstream) return 'satisfied';
      const anyDownstream = history.some(
        e => e?.type === 'acceptance_projection'
          && e.workstream_id === barrier.workstream_id
          && e.repo_id !== entryRepo
      );
      if (anyDownstream) return 'partially_satisfied';
      return 'pending';
    }

    case 'interface_alignment': {
      const required = new Set(barrier.required_repos);
      const acceptedRepos = new Set();
      for (const entry of history) {
        if (entry?.type === 'acceptance_projection' && entry.workstream_id === barrier.workstream_id) {
          if (required.has(entry.repo_id)) acceptedRepos.add(entry.repo_id);
        }
      }
      if (acceptedRepos.size === 0) return 'pending';
      if (acceptedRepos.size < required.size) return 'partially_satisfied';
      return 'satisfied';
    }

    case 'shared_human_gate':
      return barrier.status; // Never auto-transition

    default:
      return barrier.status;
  }
}

/**
 * Validate that a pending gate is still coherent with repo state.
 *
 * For phase transitions: all required repos must still exist and not have
 * moved to an unexpected state.
 *
 * For completion: all required repos must still be completion-ready.
 */
function validatePendingGateCoherence(pendingGate, repoRuns, config) {
  if (pendingGate.gate_type === 'phase_transition') {
    // Check that required repos haven't entered a state that invalidates the gate
    for (const repoId of pendingGate.required_repos || []) {
      const repoRun = repoRuns[repoId];
      if (!repoRun) {
        return { ok: false, reason: `Phase gate "${pendingGate.gate}" invalid: repo "${repoId}" missing from coordinator state` };
      }
      // A repo going blocked during a pending gate makes the gate ambiguous
      if (repoRun.status === 'blocked') {
        return { ok: false, reason: `Phase gate "${pendingGate.gate}" ambiguous: repo "${repoId}" is now blocked` };
      }
    }
    return { ok: true };
  }

  if (pendingGate.gate_type === 'run_completion') {
    for (const repoId of pendingGate.required_repos || []) {
      const repoRun = repoRuns[repoId];
      if (!repoRun) {
        return { ok: false, reason: `Completion gate invalid: repo "${repoId}" missing from coordinator state` };
      }
      if (repoRun.status === 'blocked') {
        return { ok: false, reason: `Completion gate ambiguous: repo "${repoId}" is now blocked` };
      }
    }
    return { ok: true };
  }

  return { ok: true };
}
