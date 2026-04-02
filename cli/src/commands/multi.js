/**
 * CLI commands for multi-repo coordinator orchestration (Slice 6).
 *
 * Subcommands:
 *   multi init         — bootstrap a multi-repo coordinator run
 *   multi status       — show coordinator status and repo-run snapshots
 *   multi step         — reconcile repo truth, then dispatch or request the next coordinator gate
 *   multi approve-gate — approve a pending phase transition or completion gate
 *   multi resync       — detect divergence and rebuild coordinator state from repo authority
 */

import { loadCoordinatorConfig } from '../lib/coordinator-config.js';
import {
  initializeCoordinatorRun,
  loadCoordinatorState,
  getCoordinatorStatus,
  readBarriers,
} from '../lib/coordinator-state.js';
import { selectNextAssignment, dispatchCoordinatorTurn } from '../lib/coordinator-dispatch.js';
import {
  evaluateCompletionGate,
  evaluatePhaseGate,
  approveCoordinatorPhaseTransition,
  approveCoordinatorCompletion,
  requestCoordinatorCompletion,
  requestPhaseTransition,
} from '../lib/coordinator-gates.js';
import { detectDivergence, resyncFromRepoAuthority } from '../lib/coordinator-recovery.js';

// ── multi init ─────────────────────────────────────────────────────────────

export async function multiInitCommand(options) {
  const workspacePath = process.cwd();
  const configResult = loadCoordinatorConfig(workspacePath);

  if (!configResult.ok) {
    console.error('Coordinator config error:');
    for (const err of configResult.errors || []) {
      console.error(`  - ${typeof err === 'string' ? err : err.message || JSON.stringify(err)}`);
    }
    process.exitCode = 1;
    return;
  }

  const result = initializeCoordinatorRun(workspacePath, configResult.config);

  if (!result.ok) {
    console.error('Failed to initialize coordinator run:');
    for (const err of result.errors || []) {
      console.error(`  - ${err}`);
    }
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    console.log(JSON.stringify({
      super_run_id: result.super_run_id,
      repo_runs: result.repo_runs,
    }, null, 2));
    return;
  }

  console.log(`Coordinator run initialized: ${result.super_run_id}`);
  console.log('');
  for (const [repoId, info] of Object.entries(result.repo_runs || {})) {
    const label = info.initialized_by_coordinator ? 'initialized' : 'linked';
    console.log(`  ${repoId}: ${info.run_id} (${label})`);
  }
}

// ── multi status ───────────────────────────────────────────────────────────

export async function multiStatusCommand(options) {
  const workspacePath = process.cwd();
  const state = loadCoordinatorState(workspacePath);

  if (!state) {
    console.error('No coordinator state found. Run `agentxchain multi init` first.');
    process.exitCode = 1;
    return;
  }

  const status = getCoordinatorStatus(workspacePath);
  const barriers = readBarriers(workspacePath);

  if (options.json) {
    console.log(JSON.stringify({ ...status, barriers }, null, 2));
    return;
  }

  console.log(`Super Run:    ${status.super_run_id}`);
  console.log(`Status:       ${status.status}`);
  console.log(`Phase:        ${status.phase}`);

  if (status.pending_gate) {
    console.log(`Pending Gate: ${status.pending_gate.gate} (${status.pending_gate.gate_type})`);
  }

  console.log('');
  console.log('Repos:');
  for (const [repoId, info] of Object.entries(status.repo_runs || {})) {
    const phase = info.phase ? ` [${info.phase}]` : '';
    console.log(`  ${repoId}: ${info.status || 'unknown'}${phase} (run: ${info.run_id})`);
  }

  const barrierEntries = Object.entries(barriers || {});
  if (barrierEntries.length > 0) {
    console.log('');
    console.log('Barriers:');
    for (const [barrierId, barrier] of barrierEntries) {
      console.log(`  ${barrierId}: ${barrier.status} (${barrier.type})`);
    }
  }
}

// ── multi step ─────────────────────────────────────────────────────────────

export async function multiStepCommand(options) {
  const workspacePath = process.cwd();
  const configResult = loadCoordinatorConfig(workspacePath);

  if (!configResult.ok) {
    console.error('Coordinator config error:');
    for (const err of configResult.errors || []) {
      console.error(`  - ${typeof err === 'string' ? err : err.message || JSON.stringify(err)}`);
    }
    process.exitCode = 1;
    return;
  }

  let state = loadCoordinatorState(workspacePath);
  if (!state) {
    console.error('No coordinator state found. Run `agentxchain multi init` first.');
    process.exitCode = 1;
    return;
  }

  if (state.status === 'completed') {
    console.log('Coordinator run is already completed.');
    return;
  }

  if (state.status === 'blocked') {
    console.error(`Coordinator is blocked: ${state.blocked_reason || 'unknown reason'}`);
    console.error('Resolve the blocked state before stepping.');
    process.exitCode = 1;
    return;
  }

  if (state.pending_gate) {
    console.error(`Coordinator has a pending gate: ${state.pending_gate.gate}`);
    console.error('Approve the gate with `agentxchain multi approve-gate` before stepping.');
    process.exitCode = 1;
    return;
  }

  const divergence = detectDivergence(workspacePath, state, configResult.config);
  if (divergence.diverged) {
    const resync = resyncFromRepoAuthority(workspacePath, state, configResult.config);
    state = loadCoordinatorState(workspacePath) || state;

    if (!resync.ok) {
      console.error(`Coordinator resync entered blocked state: ${resync.blocked_reason || 'unknown reason'}`);
      process.exitCode = 1;
      return;
    }
  }

  // Select next assignment
  const assignment = selectNextAssignment(workspacePath, state, configResult.config);

  if (!assignment.ok) {
    const gate = maybeRequestCoordinatorGate(workspacePath, state, configResult.config);
    if (gate.ok) {
      if (options.json) {
        console.log(JSON.stringify(gate.payload, null, 2));
        return;
      }

      if (gate.type === 'phase_transition') {
        console.log(`Phase gate requested: ${gate.payload.gate}`);
        console.log(`  Transition: ${gate.payload.from} → ${gate.payload.to}`);
      } else {
        console.log(`Completion gate requested: ${gate.payload.gate}`);
      }
      console.log('Approve the gate with `agentxchain multi approve-gate` to continue.');
      return;
    }

    console.error(`No assignable workstream: ${assignment.reason}`);
    if (assignment.detail) {
      console.error(`  ${assignment.detail}`);
    }
    if (gate.blockers.length > 0) {
      console.error(`Coordinator ${gate.type === 'phase_transition' ? 'phase' : 'completion'} gate is not ready:`);
      for (const blocker of gate.blockers) {
        console.error(`  - ${blocker.message}`);
      }
    }
    process.exitCode = 1;
    return;
  }

  // Dispatch the turn
  const dispatch = dispatchCoordinatorTurn(workspacePath, state, configResult.config, assignment);

  if (!dispatch.ok) {
    console.error(`Dispatch failed: ${dispatch.error}`);
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    console.log(JSON.stringify({
      repo_id: dispatch.repo_id,
      turn_id: dispatch.turn_id,
      workstream_id: assignment.workstream_id,
      role: assignment.role,
      bundle_path: dispatch.bundle_path,
    }, null, 2));
    return;
  }

  console.log(`Dispatched turn to ${dispatch.repo_id}:`);
  console.log(`  Turn ID:    ${dispatch.turn_id}`);
  console.log(`  Workstream: ${assignment.workstream_id}`);
  console.log(`  Role:       ${assignment.role}`);
  console.log(`  Bundle:     ${dispatch.bundle_path}`);
  console.log('');
  console.log('The agent turn is now active in the target repo.');
  console.log('Use `agentxchain step` in the target repo to execute the agent, then');
  console.log('use `agentxchain accept-turn` or `agentxchain reject-turn` to complete the turn.');
}

function maybeRequestCoordinatorGate(workspacePath, state, config) {
  const phaseEvaluation = evaluatePhaseGate(workspacePath, state, config);
  if (phaseEvaluation.ready) {
    const request = requestPhaseTransition(workspacePath, state, config, phaseEvaluation.target_phase);
    if (request.ok) {
      return {
        ok: true,
        type: 'phase_transition',
        payload: {
          action: 'phase_transition_requested',
          gate: request.gate.gate,
          gate_type: request.gate.gate_type,
          from: request.gate.from,
          to: request.gate.to,
        },
      };
    }
  }

  const phaseIsFinal = phaseEvaluation.blockers.some((blocker) => blocker.code === 'no_next_phase');
  if (!phaseIsFinal) {
    return { ok: false, type: 'phase_transition', blockers: phaseEvaluation.blockers };
  }

  const completionEvaluation = evaluateCompletionGate(workspacePath, state, config);
  if (completionEvaluation.ready) {
    const request = requestCoordinatorCompletion(workspacePath, state, config);
    if (request.ok) {
      return {
        ok: true,
        type: 'run_completion',
        payload: {
          action: 'run_completion_requested',
          gate: request.gate.gate,
          gate_type: request.gate.gate_type,
        },
      };
    }
  }

  return { ok: false, type: 'run_completion', blockers: completionEvaluation.blockers };
}

// ── multi approve-gate ─────────────────────────────────────────────────────

export async function multiApproveGateCommand(options) {
  const workspacePath = process.cwd();
  const configResult = loadCoordinatorConfig(workspacePath);

  if (!configResult.ok) {
    console.error('Coordinator config error:');
    for (const err of configResult.errors || []) {
      console.error(`  - ${typeof err === 'string' ? err : err.message || JSON.stringify(err)}`);
    }
    process.exitCode = 1;
    return;
  }

  const state = loadCoordinatorState(workspacePath);
  if (!state) {
    console.error('No coordinator state found. Run `agentxchain multi init` first.');
    process.exitCode = 1;
    return;
  }

  if (!state.pending_gate) {
    console.error('No pending gate to approve.');
    process.exitCode = 1;
    return;
  }

  const gateType = state.pending_gate.gate_type;
  let result;

  if (gateType === 'phase_transition') {
    result = approveCoordinatorPhaseTransition(workspacePath, state, configResult.config);
  } else if (gateType === 'run_completion') {
    result = approveCoordinatorCompletion(workspacePath, state, configResult.config);
  } else {
    console.error(`Unknown gate type: "${gateType}"`);
    process.exitCode = 1;
    return;
  }

  if (!result.ok) {
    console.error(`Gate approval failed: ${result.error}`);
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (gateType === 'phase_transition') {
    console.log(`Phase transition approved: ${result.transition?.from} → ${result.transition?.to}`);
  } else {
    console.log('Run completion approved. Coordinator run is now complete.');
  }
}

// ── multi resync ───────────────────────────────────────────────────────────

export async function multiResyncCommand(options) {
  const workspacePath = process.cwd();
  const configResult = loadCoordinatorConfig(workspacePath);

  if (!configResult.ok) {
    console.error('Coordinator config error:');
    for (const err of configResult.errors || []) {
      console.error(`  - ${typeof err === 'string' ? err : err.message || JSON.stringify(err)}`);
    }
    process.exitCode = 1;
    return;
  }

  const state = loadCoordinatorState(workspacePath);
  if (!state) {
    console.error('No coordinator state found. Run `agentxchain multi init` first.');
    process.exitCode = 1;
    return;
  }

  // Step 1: Detect divergence
  const divergence = detectDivergence(workspacePath, state, configResult.config);

  if (!divergence.diverged) {
    if (options.json) {
      console.log(JSON.stringify({ diverged: false, mismatches: [] }, null, 2));
    } else {
      console.log('No divergence detected. Coordinator state is consistent with repos.');
    }
    return;
  }

  if (options.dryRun) {
    if (options.json) {
      console.log(JSON.stringify({ diverged: true, mismatches: divergence.mismatches }, null, 2));
    } else {
      console.log(`Divergence detected (${divergence.mismatches.length} mismatch(es)):`);
      for (const m of divergence.mismatches) {
        console.log(`  [${m.type}] ${m.detail}`);
      }
      console.log('');
      console.log('Run without --dry-run to resync.');
    }
    return;
  }

  // Step 2: Resync
  const result = resyncFromRepoAuthority(workspacePath, state, configResult.config);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.ok) {
    console.log('Resync complete.');
    if (result.resynced_repos.length > 0) {
      console.log(`  Repos resynced: ${result.resynced_repos.join(', ')}`);
    }
    if (result.barrier_changes.length > 0) {
      console.log('  Barrier changes:');
      for (const bc of result.barrier_changes) {
        console.log(`    ${bc.barrier_id}: ${bc.previous_status} → ${bc.new_status}`);
      }
    }
  } else {
    console.error('Resync completed with blocked state:');
    console.error(`  Reason: ${result.blocked_reason}`);
    process.exitCode = 1;
  }
}
