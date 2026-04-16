/**
 * CLI commands for multi-repo coordinator orchestration (Slice 6).
 *
 * Subcommands:
 *   multi init         — bootstrap a multi-repo coordinator run
 *   multi status       — show coordinator status and repo-run snapshots
 *   multi step         — reconcile repo truth, then dispatch or request the next coordinator gate
 *   multi resume       — clear coordinator blocked state after operator recovery
 *   multi approve-gate — approve a pending phase transition or completion gate
 *   multi resync       — detect divergence and rebuild coordinator state from repo authority
 */

import chalk from 'chalk';
import { normalizeCoordinatorGateApprovalFailure } from '../lib/coordinator-gate-approval.js';
import { loadCoordinatorConfig } from '../lib/coordinator-config.js';
import { deriveCoordinatorNextActions } from '../lib/coordinator-next-actions.js';
import { getCoordinatorPendingGateDetails } from '../lib/coordinator-pending-gate-presentation.js';
import { collectCoordinatorRepoSnapshots } from '../lib/coordinator-repo-snapshots.js';
import {
  initializeCoordinatorRun,
  loadCoordinatorState,
  getCoordinatorStatus,
  readBarriers,
  saveCoordinatorState,
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
import {
  detectDivergence,
  resyncFromRepoAuthority,
  resumeCoordinatorFromBlockedState,
} from '../lib/coordinator-recovery.js';
import {
  fireCoordinatorHook,
  buildAssignmentPayload,
  buildAcceptancePayload,
  buildGatePayload,
  buildEscalationPayload,
} from '../lib/coordinator-hooks.js';
import { computeContextInvalidations } from '../lib/cross-repo-context.js';
import { scaffoldRecoveryReport } from '../lib/workflow-gate-semantics.js';

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
  const configResult = loadCoordinatorConfig(workspacePath);
  const nextActions = deriveCoordinatorCliNextActions(
    status,
    configResult.ok ? configResult.config : null,
  );

  if (options.json) {
    console.log(JSON.stringify({ ...status, barriers, next_actions: nextActions }, null, 2));
    return;
  }

  console.log(`Super Run:    ${status.super_run_id}`);
  console.log(`Status:       ${formatCoordinatorStatus(status.status)}`);
  console.log(`Phase:        ${status.phase}`);

  // Elapsed time for active runs
  if (status.created_at && status.status === 'active') {
    const elapsedMs = Date.now() - new Date(status.created_at).getTime();
    if (elapsedMs >= 0) {
      const secs = Math.floor(elapsedMs / 1000);
      const mins = Math.floor(secs / 60);
      const remainSecs = secs % 60;
      const elapsed = mins > 0 ? `${mins}m ${remainSecs}s` : `${remainSecs}s`;
      console.log(`Elapsed:      ${elapsed}`);
    }
  }

  // Blocked state with reason
  if (status.status === 'blocked') {
    const reason = (typeof status.blocked_reason === 'string' && status.blocked_reason.trim())
      ? status.blocked_reason.trim()
      : 'unknown reason';
    console.log(`Blocked:      ${chalk.red.bold('BLOCKED')} — ${reason}`);
  }

  // Pending gate details
  if (status.pending_gate) {
    printCoordinatorPendingGate(status.pending_gate);
  }

  printCoordinatorNextActions(nextActions);

  // Completed state
  if (status.status === 'completed') {
    console.log('');
    console.log(`  ${chalk.green.bold('✓ Coordinator run completed')}`);
    if (status.updated_at) {
      console.log(`  ${chalk.dim('Completed:')} ${status.updated_at}`);
    }
  }

  console.log('');
  console.log('Repos:');
  for (const [repoId, info] of Object.entries(status.repo_runs || {})) {
    const phase = info.phase ? ` [${info.phase}]` : '';
    console.log(`  ${repoId}: ${info.status || 'unknown'}${phase} (run: ${info.run_id})`);
  }

  // Phase gate status
  const gateEntries = Object.entries(status.phase_gate_status || {});
  if (gateEntries.length > 0) {
    console.log('');
    console.log('Gates:');
    for (const [gate, gateStatus] of gateEntries) {
      const icon = gateStatus === 'passed' ? chalk.green('✓') : chalk.dim('○');
      console.log(`  ${icon} ${gate}: ${gateStatus}`);
    }
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

function formatCoordinatorStatus(status) {
  switch (status) {
    case 'active': return chalk.green(status);
    case 'blocked': return chalk.red.bold(status);
    case 'completed': return chalk.cyan(status);
    default: return status;
  }
}

function deriveCoordinatorCliNextActions(statusLike, config) {
  const repos = config ? collectCoordinatorRepoSnapshots(config) : [];
  return deriveCoordinatorNextActions({
    status: statusLike?.status ?? null,
    blockedReason: statusLike?.blocked_reason ?? null,
    pendingGate: statusLike?.pending_gate ?? null,
    repos,
    coordinatorRepoRuns: statusLike?.repo_runs || {},
  });
}

function printCoordinatorNextActions(nextActions, write = console.log) {
  if (!Array.isArray(nextActions) || nextActions.length === 0) {
    return;
  }

  write('');
  write('Next Actions:');
  for (const [index, action] of nextActions.entries()) {
    write(`  ${index + 1}. ${action.command}`);
    if (action.reason) {
      write(`     ${action.reason}`);
    }
  }
}

function printCoordinatorPendingGate(pendingGate, write = console.log) {
  const details = getCoordinatorPendingGateDetails({ pendingGate });
  if (details.length === 0) {
    return;
  }

  write('Pending Gate:');
  for (const detail of details) {
    write(`  ${detail.label}: ${detail.value}`);
  }
}

function printCoordinatorGateApprovalFailure(failure, write = console.error) {
  write('');
  write('Coordinator Gate Approval Failed');
  write('');
  if (failure.gate_type) {
    write(`  Gate Type: ${failure.gate_type}`);
  }
  if (failure.gate) {
    write(`  Gate:      ${failure.gate}`);
  }
  if (failure.hook_name) {
    write(`  Hook:      ${failure.hook_name}`);
  } else if (failure.hook_phase) {
    write(`  Hook:      ${failure.hook_phase}`);
  }
  write(`  Error:     ${failure.error || 'Coordinator gate approval failed'}`);
  if (failure.recovery_summary?.typed_reason) {
    write(`  Reason:    ${failure.recovery_summary.typed_reason}`);
  }
  if (failure.recovery_summary?.owner) {
    write(`  Owner:     ${failure.recovery_summary.owner}`);
  }
  if (failure.recovery_summary?.recovery_action) {
    write(`  Action:    ${failure.recovery_summary.recovery_action}`);
  }
  if (failure.recovery_summary?.detail) {
    write(`  Detail:    ${failure.recovery_summary.detail}`);
  }
  printCoordinatorNextActions(failure.next_actions, write);
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
    // Fire on_escalation hook (advisory — cannot block, only notifies)
    fireEscalationHook(workspacePath, configResult.config, state, state.blocked_reason || 'unknown reason');
    console.error(`Coordinator is blocked: ${state.blocked_reason || 'unknown reason'}`);
    printCoordinatorNextActions(
      deriveCoordinatorCliNextActions(state, configResult.config),
      console.error,
    );
    process.exitCode = 1;
    return;
  }

  if (state.pending_gate) {
    console.error('Coordinator has a pending gate.');
    printCoordinatorPendingGate(state.pending_gate, console.error);
    printCoordinatorNextActions(
      deriveCoordinatorCliNextActions(state, configResult.config),
      console.error,
    );
    process.exitCode = 1;
    return;
  }

  const divergence = detectDivergence(workspacePath, state, configResult.config);
  if (divergence.diverged) {
    const resync = resyncFromRepoAuthority(workspacePath, state, configResult.config);
    state = loadCoordinatorState(workspacePath) || state;

    if (!resync.ok) {
      // Fire on_escalation for the blocked resync
      fireEscalationHook(workspacePath, configResult.config, state, resync.blocked_reason || 'resync failure');
      console.error(`Coordinator resync entered blocked state: ${resync.blocked_reason || 'unknown reason'}`);
      for (const mismatch of resync.mismatch_details || []) {
        const codeTag = mismatch.code ? `[${mismatch.code}] ` : '';
        console.error(`  - ${codeTag}${mismatch.message}`);
        if (mismatch.code === 'repo_run_id_mismatch') {
          console.error(`    expected: ${mismatch.expected_run_id}`);
          console.error(`    actual:   ${mismatch.actual_run_id}`);
        }
      }
      process.exitCode = 1;
      return;
    }

    // Fire after_acceptance hooks only for newly projected acceptances.
    if ((resync.projected_acceptances || []).length > 0) {
      for (const projection of resync.projected_acceptances) {
        // Compute real context invalidation signals for this acceptance
        const contextInvalidations = computeContextInvalidations(
          workspacePath,
          projection.repo_id,
          projection.workstream_id,
          projection.files_changed || [],
        );

        const acceptancePayload = buildAcceptancePayload(
          {
            projection_ref: projection.projection_ref,
            repo_turn_id: projection.repo_turn_id,
            summary: projection.summary,
            files_changed: projection.files_changed || [],
            decisions: projection.decisions || [],
            verification: projection.verification ?? null,
            barrier_effects: resync.barrier_changes.filter(
              (change) => change.workstream_id === projection.workstream_id,
            ),
            context_invalidations: contextInvalidations,
          },
          projection.repo_id,
          projection.workstream_id,
          state,
        );
        const acceptanceHook = fireCoordinatorHook(workspacePath, configResult.config, 'after_acceptance', acceptancePayload, {
          super_run_id: state.super_run_id,
        });

        if (!acceptanceHook.ok) {
          const reason = acceptanceHook.error || `after_acceptance hook failed for repo "${projection.repo_id}"`;
          const blockedState = blockCoordinator(workspacePath, state, `coordinator_hook_violation: ${reason}`);
          fireEscalationHook(workspacePath, configResult.config, blockedState, blockedState.blocked_reason);
          console.error(`Coordinator blocked by after_acceptance hook: ${reason}`);
          process.exitCode = 1;
          return;
        }
      }
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
      const updatedState = loadCoordinatorState(workspacePath) || state;
      printCoordinatorNextActions(
        deriveCoordinatorCliNextActions(updatedState, configResult.config),
      );
      return;
    }

    console.error(`No assignable workstream: ${assignment.reason}`);
    if (assignment.detail) {
      console.error(`  ${assignment.detail}`);
    }
    if (gate.blockers.length > 0) {
      console.error(`Coordinator ${gate.type === 'phase_transition' ? 'phase' : 'completion'} gate is not ready:`);
      for (const blocker of gate.blockers) {
        const codeTag = blocker.code ? `[${blocker.code}] ` : '';
        console.error(`  - ${codeTag}${blocker.message}`);
        if (blocker.code === 'repo_run_id_mismatch') {
          console.error(`    expected: ${blocker.expected_run_id}`);
          console.error(`    actual:   ${blocker.actual_run_id}`);
        }
      }
    }
    process.exitCode = 1;
    return;
  }

  // Fire before_assignment hook (blocking — can prevent dispatch)
  const assignmentPayload = buildAssignmentPayload(assignment, state);
  const assignmentHook = fireCoordinatorHook(workspacePath, configResult.config, 'before_assignment', assignmentPayload, {
    super_run_id: state.super_run_id,
  });

  if (assignmentHook.blocked) {
    const blocker = assignmentHook.verdicts.find(v => v.verdict === 'block');
    const reason = blocker?.message || 'before_assignment hook blocked dispatch';
    console.error(`Assignment blocked by hook: ${reason}`);
    if (options.json) {
      console.log(JSON.stringify({ blocked: true, hook_phase: 'before_assignment', reason }, null, 2));
    }
    process.exitCode = 1;
    return;
  }

  if (!assignmentHook.ok) {
    console.error(`Assignment hook failed: ${assignmentHook.error || 'unknown hook failure'}`);
    if (options.json) {
      console.log(JSON.stringify({
        blocked: true,
        hook_phase: 'before_assignment',
        reason: assignmentHook.error || 'unknown hook failure',
      }, null, 2));
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

// ── multi resume ───────────────────────────────────────────────────────────

export async function multiResumeCommand(options) {
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

  const result = resumeCoordinatorFromBlockedState(workspacePath, state, configResult.config);

  if (!result.ok) {
    console.error(result.error || 'Coordinator recovery failed.');
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    console.log(JSON.stringify({
      ok: true,
      previous_status: 'blocked',
      resumed_status: result.resumed_status,
      blocked_reason: result.blocked_reason,
      pending_gate: result.state?.pending_gate || null,
      resync: result.resync,
    }, null, 2));
    return;
  }

  console.log(`Coordinator resumed: ${result.resumed_status}`);
  console.log(`Previous block: ${result.blocked_reason}`);
  printCoordinatorNextActions(
    deriveCoordinatorCliNextActions(result.state, configResult.config),
  );
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

  // Fire before_gate hook (blocking — can prevent gate approval)
  const gatePayload = buildGatePayload(state.pending_gate, state);
  const gateHook = fireCoordinatorHook(workspacePath, configResult.config, 'before_gate', gatePayload, {
    super_run_id: state.super_run_id,
  });

  if (gateHook.blocked) {
    const blocker = gateHook.verdicts.find(v => v.verdict === 'block');
    const reason = blocker?.message || 'before_gate hook blocked approval';
    const failure = normalizeCoordinatorGateApprovalFailure({
      state,
      config: configResult.config,
      code: 'hook_blocked',
      error: reason,
      hookName: blocker?.hook_name || null,
      hookPhase: 'before_gate',
    });
    printCoordinatorGateApprovalFailure(failure);
    if (options.json) {
      console.log(JSON.stringify(failure, null, 2));
    }
    process.exitCode = 1;
    return;
  }

  if (!gateHook.ok) {
    const failure = normalizeCoordinatorGateApprovalFailure({
      state,
      config: configResult.config,
      code: 'hook_failed',
      error: gateHook.error || 'unknown hook failure',
      hookName: gateHook.results?.find((entry) => entry?.hook_name)?.hook_name || null,
      hookPhase: 'before_gate',
    });
    printCoordinatorGateApprovalFailure(failure);
    if (options.json) {
      console.log(JSON.stringify(failure, null, 2));
    }
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
    const failure = normalizeCoordinatorGateApprovalFailure({
      state,
      config: configResult.config,
      code: 'approval_failed',
      error: result.error || 'Coordinator gate approval failed',
    });
    printCoordinatorGateApprovalFailure(failure);
    if (options.json) {
      console.log(JSON.stringify(failure, null, 2));
    }
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

// ── Hook helpers ──────────────────────────────────────────────────────────

/**
 * Fire the on_escalation coordinator hook (advisory — never blocks).
 * Used when the coordinator enters a blocked state from any path.
 */
function fireEscalationHook(workspacePath, config, state, blockedReason) {
  const payload = buildEscalationPayload(blockedReason, state);
  return fireCoordinatorHook(workspacePath, config, 'on_escalation', payload, {
    super_run_id: state.super_run_id,
  });
}

function blockCoordinator(workspacePath, state, blockedReason) {
  const blockedState = {
    ...state,
    status: 'blocked',
    blocked_reason: blockedReason,
  };
  saveCoordinatorState(workspacePath, blockedState);
  scaffoldRecoveryReport(workspacePath, blockedReason);
  return blockedState;
}
