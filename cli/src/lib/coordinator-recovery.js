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
  recordCoordinatorDecision,
} from './coordinator-state.js';
import { evaluateRecoveryReport, scaffoldRecoveryReport } from './workflow-gate-semantics.js';
import { safeWriteJson } from './safe-write.js';
import {
  computeBarrierStatus as computeCoordinatorBarrierStatus,
  getAcceptedReposForWorkstream,
  getAlignedReposForBarrier,
} from './coordinator-barriers.js';

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

function isAcceptedRepoHistoryEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return false;
  }

  // Real governed history records the turn outcome in `status` and acceptance
  // via `accepted_at`. Older coordinator fixtures used `status: "accepted"`.
  return Boolean(entry.accepted_at) || entry.status === 'accepted';
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
        e => e?.turn_id === dispatch.repo_turn_id && isAcceptedRepoHistoryEntry(e)
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
 * @returns {{ ok: boolean, resynced_repos: string[], projected_acceptances: object[], barrier_changes: object[], errors: string[], blocked_reason?: string }}
 */
export function resyncFromRepoAuthority(workspacePath, state, config) {
  const errors = [];
  const resyncedRepos = [];
  const projectedAcceptances = [];
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
      e => e?.turn_id === dispatch.repo_turn_id && isAcceptedRepoHistoryEntry(e)
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
      projectedAcceptances.push({
        repo_id: dispatch.repo_id,
        repo_turn_id: dispatch.repo_turn_id,
        workstream_id: dispatch.workstream_id,
        projection_ref: projection.projection_ref,
        summary: acceptedEntry.summary ?? '',
        files_changed: acceptedEntry.files_changed ?? [],
        decisions: acceptedEntry.decisions ?? [],
        verification: acceptedEntry.verification ?? null,
      });
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
    if (barrier.type === 'all_repos_accepted') {
      const satisfiedRepos = getAcceptedReposForWorkstream(
        fullHistory, barrier.workstream_id, barrier.required_repos
      );
      if (JSON.stringify(barrier.satisfied_repos || []) !== JSON.stringify(satisfiedRepos)) {
        barrier.satisfied_repos = satisfiedRepos;
        barriersChanged = true;
      }
    }
    if (barrier.type === 'interface_alignment') {
      const satisfiedRepos = getAlignedReposForBarrier(barrier, fullHistory);
      if (JSON.stringify(barrier.satisfied_repos || []) !== JSON.stringify(satisfiedRepos)) {
        barrier.satisfied_repos = satisfiedRepos;
        barriersChanged = true;
      }
    }

    if (newStatus !== barrier.status) {
      const previousStatus = barrier.status;
      barrierChanges.push({
        barrier_id: barrierId,
        previous_status: previousStatus,
        new_status: newStatus,
        workstream_id: barrier.workstream_id,
        type: barrier.type,
      });

      barrier.status = newStatus;

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
  if (blockedReason) {
    scaffoldRecoveryReport(workspacePath, blockedReason);
  }

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
    projected_acceptances: projectedAcceptances,
    barrier_changes: barrierChanges,
    errors,
    blocked_reason: blockedReason || undefined,
  };
}

/**
 * Clear a coordinator blocked state after the operator resolves the cause.
 *
 * Recovery always begins with repo-authority resync, then restores the
 * coordinator to `active` or `paused` based on whether a pending gate still
 * exists. It never mutates repo-local governed state.
 *
 * @param {string} workspacePath
 * @param {object} state
 * @param {object} config
 * @returns {{ ok: boolean, state?: object, resumed_status?: string, blocked_reason?: string, blocked_repos?: string[], resync?: object, error?: string }}
 */
export function resumeCoordinatorFromBlockedState(workspacePath, state, config) {
  if (!state || state.status !== 'blocked') {
    return {
      ok: false,
      error: `Cannot resume coordinator: status is "${state?.status || 'missing'}", expected "blocked"`,
    };
  }

  const previousBlockedReason = state.blocked_reason || 'unknown blocked reason';

  // Require a recovery report before allowing resume
  const reportResult = evaluateRecoveryReport(workspacePath);
  if (reportResult === null) {
    return {
      ok: false,
      error: 'Recovery report required before resume. Create .agentxchain/multirepo/RECOVERY_REPORT.md with ## Trigger, ## Impact, and ## Mitigation sections.',
    };
  }
  if (!reportResult.ok) {
    return {
      ok: false,
      error: reportResult.reason,
    };
  }

  const expectedSuperRunId = state.super_run_id;
  const resync = resyncFromRepoAuthority(workspacePath, state, config);
  const refreshedState = loadCoordinatorState(workspacePath);

  if (!refreshedState) {
    return {
      ok: false,
      error: 'Coordinator state could not be reloaded after resync',
      blocked_reason: previousBlockedReason,
      resync,
    };
  }

  if (refreshedState.super_run_id !== expectedSuperRunId) {
    return {
      ok: false,
      error: `Cannot resume coordinator: super_run_id changed from "${expectedSuperRunId}" to "${refreshedState.super_run_id}"`,
      blocked_reason: previousBlockedReason,
      resync,
    };
  }

  if (!resync.ok) {
    return {
      ok: false,
      error: `Coordinator remains blocked: ${resync.blocked_reason || refreshedState.blocked_reason || previousBlockedReason}`,
      blocked_reason: resync.blocked_reason || refreshedState.blocked_reason || previousBlockedReason,
      resync,
      state: refreshedState,
    };
  }

  const blockedRepos = Object.entries(refreshedState.repo_runs || {})
    .filter(([, repoRun]) => repoRun?.status === 'blocked')
    .map(([repoId]) => repoId);

  if (blockedRepos.length > 0) {
    const blockedReason = `child repos remain blocked: ${blockedRepos.join(', ')}`;
    const blockedState = {
      ...refreshedState,
      status: 'blocked',
      blocked_reason: blockedReason,
    };
    saveCoordinatorState(workspacePath, blockedState);
    return {
      ok: false,
      error: `Cannot resume coordinator: ${blockedReason}`,
      blocked_reason: blockedReason,
      blocked_repos: blockedRepos,
      resync,
      state: blockedState,
    };
  }

  const resumedStatus = refreshedState.pending_gate ? 'paused' : 'active';
  const resumedState = {
    ...refreshedState,
    status: resumedStatus,
  };
  delete resumedState.blocked_reason;

  saveCoordinatorState(workspacePath, resumedState);
  appendJsonl(historyPath(workspacePath), {
    type: 'blocked_resolved',
    timestamp: new Date().toISOString(),
    super_run_id: refreshedState.super_run_id,
    from: 'blocked',
    to: resumedStatus,
    blocked_reason: previousBlockedReason,
    pending_gate: refreshedState.pending_gate
      ? {
        gate: refreshedState.pending_gate.gate,
        gate_type: refreshedState.pending_gate.gate_type,
      }
      : null,
  });
  recordCoordinatorDecision(workspacePath, resumedState, {
    category: 'recovery',
    from: 'blocked',
    to: resumedStatus,
    reason: typeof previousBlockedReason === 'string'
      ? previousBlockedReason
      : JSON.stringify(previousBlockedReason),
    statement: `Resumed coordinator from blocked to ${resumedStatus}`,
  });

  return {
    ok: true,
    state: resumedState,
    resumed_status: resumedStatus,
    blocked_reason: previousBlockedReason,
    resync,
  };
}

function recomputeBarrierStatus(barrier, history, config) {
  return computeCoordinatorBarrierStatus(barrier, history, config);
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
