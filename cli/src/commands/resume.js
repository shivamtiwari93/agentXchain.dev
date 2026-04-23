/**
 * agentxchain resume — governed-only command.
 *
 * Transitions a governed project from idle/paused into an assigned turn
 * with a concrete dispatch bundle. Per §44-§47 of the frozen spec:
 *
 *   - governed-only (rejects legacy projects)
 *   - resolves target role from routing or --role override
 *   - if idle + no run_id → initializeGovernedRun() + assign
 *   - if paused + run_id exists → resume same run + assign
 *   - if blocked + retained active turn with failed status → re-dispatch same turn
 *   - if active + an active turn already exists → reject (no double assignment)
 *   - materializes a turn-scoped dispatch bundle under .agentxchain/dispatch/turns/<turn_id>/
 *   - exits without waiting for turn completion
 */

import chalk from 'chalk';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { loadProjectContext, loadProjectState } from '../lib/config.js';
import {
  initializeGovernedRun,
  assignGovernedTurn,
  deriveAfterDispatchHookRecoveryAction,
  markRunBlocked,
  getActiveTurns,
  getActiveTurnCount,
  reactivateGovernedRun,
  reconcilePhaseAdvanceBeforeDispatch,
  transitionActiveTurnLifecycle,
  STATE_PATH,
} from '../lib/governed-state.js';
import { writeDispatchBundle, getDispatchTurnDir, getTurnStagingResultPath } from '../lib/dispatch-bundle.js';
import { finalizeDispatchManifest } from '../lib/dispatch-manifest.js';
import {
  getDispatchAssignmentPath,
  getDispatchContextPath,
  getDispatchEffectiveContextPath,
  getDispatchPromptPath,
} from '../lib/turn-paths.js';
import { deriveRecoveryDescriptor } from '../lib/blocked-state.js';
import { runHooks } from '../lib/hook-runner.js';
import { summarizeRunProvenance } from '../lib/run-provenance.js';
import { consumeNextApprovedIntent } from '../lib/intake.js';
import { reconcileStaleTurns } from '../lib/stale-turn-watchdog.js';

function hasStandingPendingExitGate(state, config) {
  const phase = state?.phase;
  const gateId = phase ? config?.routing?.[phase]?.exit_gate : null;
  return Boolean(gateId && (state?.phase_gate_status || {})[gateId] === 'pending');
}

function getStandingPendingExitGate(state, config) {
  const phase = state?.phase;
  const gateId = phase ? config?.routing?.[phase]?.exit_gate : null;
  if (!gateId || (state?.phase_gate_status || {})[gateId] !== 'pending') {
    return null;
  }
  return config?.gates?.[gateId] || null;
}

function entrySatisfiesSyntheticGateVerification(gate, entry) {
  if (!gate?.requires_verification_pass) return true;
  const verificationStatus = entry?.verification?.status;
  return verificationStatus === 'pass' || verificationStatus === 'attested_pass';
}

function evaluateHumanApprovalGateArtifacts(root, state, config, entry) {
  // Returns the artifact readiness shape for a human-required phase exit gate.
  // A turn can be a valid standing-gate source either by producing one of the
  // required files, or by re-verifying already-complete gate artifacts as the
  // phase entry role before escalating to the human reviewer.
  const phase = state?.phase;
  const gateId = phase ? config?.routing?.[phase]?.exit_gate : null;
  if (!gateId) return { ready: false, contributed: false, entryRole: false };
  const gate = config?.gates?.[gateId];
  if (!gate || !Array.isArray(gate.requires_files) || gate.requires_files.length === 0) {
    return { ready: false, contributed: false, entryRole: false };
  }
  if (!gate.requires_human_approval) return { ready: false, contributed: false, entryRole: false };
  const filesChanged = Array.isArray(entry?.files_changed) ? entry.files_changed : [];
  const required = gate.requires_files.filter((p) => typeof p === 'string' && p.trim());
  if (required.length === 0) return { ready: false, contributed: false, entryRole: false };
  const changedSet = new Set(filesChanged.filter((p) => typeof p === 'string'));
  const contributed = required.some((relPath) => changedSet.has(relPath));
  const ready = required.every((relPath) => existsSync(join(root, relPath)));
  const entryRole = Boolean(config?.routing?.[phase]?.entry_role)
    && (entry?.role === config.routing[phase].entry_role || entry?.assigned_role === config.routing[phase].entry_role);
  return { ready, contributed, entryRole };
}

function turnCanApproveHumanGateFromEscalation(root, state, config, entry, proposed) {
  const artifacts = evaluateHumanApprovalGateArtifacts(root, state, config, entry);
  if (!artifacts.ready) return false;
  if (artifacts.contributed) return true;
  const phase = state?.phase;
  const gateId = phase ? config?.routing?.[phase]?.exit_gate : null;
  const gateApprovalText = [
    entry?.summary,
    entry?.needs_human_reason,
    entry?.verification?.evidence_summary,
    state?.blocked_on,
    state?.blocked_reason?.recovery?.detail,
    ...(Array.isArray(entry?.decisions)
      ? entry.decisions.flatMap((decision) => [decision?.statement, decision?.rationale])
      : []),
  ]
    .filter((value) => typeof value === 'string' && value.trim())
    .join('\n')
    .toLowerCase();
  const referencesHumanGateApproval = Boolean(gateId)
    && (
      gateApprovalText.includes(gateId.toLowerCase())
      || (gateApprovalText.includes('gate') && gateApprovalText.includes('human approval'))
      || (gateApprovalText.includes('gate') && gateApprovalText.includes('human-required'))
    );
  // tusq.dev BUG-52 real shape: PM re-verified already-complete planning
  // artifacts, changed no files by design, and escalated to human because the
  // gate requires human approval. The human unblock is the gate approval.
  return proposed === 'human' && artifacts.entryRole && referencesHumanGateApproval;
}

function latestCompletedTurnWantsPhaseContinuation(root, state, config, opts = {}) {
  const turnId = opts?.turnId || state?.last_completed_turn_id || state?.blocked_reason?.turn_id || null;
  if (!turnId) return false;
  const historyPath = join(root, config?.files?.history || '.agentxchain/history.jsonl');
  if (!existsSync(historyPath)) return false;
  const lines = readFileSync(historyPath, 'utf8').trim().split('\n').filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let entry = null;
    try {
      entry = JSON.parse(lines[index]);
    } catch {
      continue;
    }
    if (entry?.turn_id !== turnId) continue;
    if (entry.phase_transition_request) return true;
    const standingGate = getStandingPendingExitGate(state, config);
    const proposed = typeof entry.proposed_next_role === 'string' ? entry.proposed_next_role.trim() : '';
    if (proposed && proposed !== 'human') {
      return entrySatisfiesSyntheticGateVerification(standingGate, entry);
    }
    // Turn 205 extension (refines DEC-BUG52-UNBLOCK-STANDING-GATE-DISCRIMINATOR-001):
    // The realistic BUG-52 third-variant PM shape sets `status: 'needs_human'`,
    // `phase_transition_request: null`, and `proposed_next_role: 'human'` — the
    // PM is escalating specifically for the phase exit gate's human-approval
    // check and has already written the gate's required artifacts to disk.
    // When the current phase's exit gate requires human approval, all of its
    // `requires_files` are present on disk, and any gate-level verification
    // predicate was satisfied by the accepted turn, an `unblock` on that
    // escalation IS the final gate approval and must run the standing-gate
    // reconcile.
    //
    // Distinguished from generic schedule-daemon `needs_decision` escalations
    // (which block BEFORE the agent writes gate artifacts, so `requires_files`
    // are not yet on disk) — those correctly continue to re-dispatch the
    // in-phase role rather than force-advancing the phase.
    if (
      entry.status === 'needs_human'
      && entrySatisfiesSyntheticGateVerification(standingGate, entry)
      && turnCanApproveHumanGateFromEscalation(root, state, config, entry, proposed)
    ) {
      return true;
    }
    return false;
  }
  return false;
}

export async function resumeCommand(opts) {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config } = context;

  if (config.protocol_mode !== 'governed') {
    console.log(chalk.red('The resume command is only available for governed projects.'));
    console.log(chalk.dim('Legacy projects use: agentxchain start'));
    process.exit(1);
  }

  // Load governed state
  const statePath = join(root, STATE_PATH);
  if (!existsSync(statePath)) {
    console.log(chalk.red('No governed state.json found. Run `agentxchain init --governed` first.'));
    process.exit(1);
  }

  let state = loadProjectState(root, config);
  if (!state) {
    let parseError = 'Failed to parse state.json';
    try {
      JSON.parse(readFileSync(statePath, 'utf8'));
    } catch (err) {
      parseError = `Failed to parse state.json: ${err.message}`;
    }
    console.log(chalk.red(parseError));
    process.exit(1);
  }

  const staleReconciliation = reconcileStaleTurns(root, state, config);
  state = staleReconciliation.state || state;
  if (staleReconciliation.ghost_turns.length > 0) {
    printGhostTurnRecovery(staleReconciliation.ghost_turns);
    process.exit(1);
  }
  if (staleReconciliation.stale_turns.length > 0) {
    printStaleTurnRecovery(staleReconciliation.stale_turns);
    process.exit(1);
  }

  // §47: active + turns present → reject (resume assigns new turns, not re-dispatches)
  const activeCount = getActiveTurnCount(state);
  const activeTurns = getActiveTurns(state);
  const resumeVia = opts?._via || 'resume';
  const turnResumeVia = opts?._via || 'resume --turn';
  let skipRetainedRedispatch = false;

  if (state.status === 'active' && activeCount > 0) {
    if (activeCount === 1) {
      const turn = Object.values(activeTurns)[0];
      console.log(chalk.yellow('A turn is already active:'));
      console.log(`  Turn:  ${turn.turn_id}`);
      console.log(`  Role:  ${turn.assigned_role}`);
      console.log(`  Phase: ${state.phase}`);
      console.log('');
      console.log(chalk.dim(`The dispatch bundle is at: ${getDispatchTurnDir(turn.turn_id)}/`));
    } else {
      console.log(chalk.yellow(`${activeCount} turns are already active:`));
      for (const turn of Object.values(activeTurns)) {
        const statusLabel = turn.status === 'conflicted' ? chalk.red('conflicted') : turn.status;
        console.log(`  ${chalk.yellow('●')} ${turn.turn_id} — ${chalk.bold(turn.assigned_role)} (${statusLabel})`);
      }
      console.log('');
    }
    console.log(chalk.dim('Complete or accept/reject active turns before resuming.'));
    console.log(chalk.dim('Use agentxchain step --resume to continue waiting for an active turn.'));
    process.exit(1);
  }

  if (state.pending_phase_transition || state.pending_run_completion) {
    printRecoverySummary(state, 'This run is awaiting approval.', config);
    process.exit(1);
  }

  // Removed (Turn 25): the §47 `paused + retained turn → re-dispatch failed/retrying`
  // branch is provably unreachable under the current schema and migration contract:
  //
  //   1. `cli/src/lib/schema.js:184` rejects `status: 'paused'` unless
  //      `pending_phase_transition` or `pending_run_completion` is set.
  //   2. The guard above (line 119) short-circuits with `printRecoverySummary`
  //      whenever either pending field is set — so any schema-valid paused state
  //      exits before reaching this point.
  //   3. Legacy on-disk shapes that pre-date the schema constraint (paused +
  //      `blocked_on: 'human:...'` / `blocked_on: 'escalation:...'` with no
  //      pending approval) are auto-migrated to `status: 'blocked'` by
  //      `normalizeStateForRead` in `governed-state.js:2191-2204` before
  //      `loadProjectState` returns.
  //
  // The reachable retained-turn re-dispatch path is the `blocked + activeCount > 0`
  // branch immediately below, which legacy paused-pause shapes are migrated into.
  // Per `DEC-UNREACHABLE-BRANCH-COVERAGE-001`, dead branches are removed (not
  // patched defensively) once the schema citation + migration citation are
  // documented in code and the coverage matrix.

  // BUG-52 third variant (Turn 203/204): operator_unblock must run the
  // standing-gate reconcile path regardless of `activeCount`, but only when the
  // current phase actually has a standing pending exit gate and the blocked
  // turn was trying to continue into a non-human phase role. The tester's
  // v2.151.0 lights-out repro on `tusq.dev` left `active_turns: {}` with
  // `phase_gate_status.planning_signoff: "pending"`, so the old
  // `activeCount > 0` guard skipped the only path that could synthesize the
  // missing transition source. Non-gate human escalations (OAuth, external
  // decisions, schedule recovery with `proposed_next_role: "human"`) must keep
  // the normal unblock/resume behavior instead of being forced through a
  // phase-transition materialization check.
  if (
    state.status === 'blocked'
    && resumeVia === 'operator_unblock'
    && hasStandingPendingExitGate(state, config)
    && latestCompletedTurnWantsPhaseContinuation(root, state, config, { turnId: opts.turn || null })
  ) {
    const reactivated = reactivateGovernedRun(root, state, { via: resumeVia, notificationConfig: config });
    if (!reactivated.ok) {
      console.log(chalk.red(`Failed to reactivate blocked run: ${reactivated.error}`));
      process.exit(1);
    }
    state = reactivated.state;
    console.log(chalk.green(`Resumed blocked run: ${state.run_id}`));
    if (reactivated.migration_notice) {
      console.log(chalk.yellow(reactivated.migration_notice));
    }
    if (reactivated.phantom_notice) {
      console.log(chalk.yellow(reactivated.phantom_notice));
    }

    const phaseReconciliation = reconcilePhaseAdvanceBeforeDispatch(root, config, state, {
      allow_active_turn_cleanup: true,
      allow_standing_gate: true,
      standing_gate_turn_id: opts.turn || null,
    });
    if (!phaseReconciliation.ok && !phaseReconciliation.state) {
      console.log(chalk.red(`Failed to reconcile phase gate before dispatch: ${phaseReconciliation.error}`));
      process.exit(1);
    }
    state = phaseReconciliation.state || state;
    if (phaseReconciliation.advanced) {
      console.log(chalk.green(`Advanced phase before dispatch: ${phaseReconciliation.from_phase} → ${phaseReconciliation.to_phase}`));
      skipRetainedRedispatch = true;
    } else {
      markRunBlocked(root, {
        category: 'needs_human',
        blockedOn: state.blocked_on || 'human:unblock_reconcile_failed',
        recovery: {
          typed_reason: 'needs_human',
          owner: 'human',
          recovery_action: 'agentxchain approve-transition or agentxchain gate show <gate>',
          turn_retained: true,
          detail: 'Operator unblock resolved the escalation, but no phase transition could be materialized from the current gate state.',
        },
        turnId: opts.turn || null,
        notificationConfig: config,
      });
      console.log(chalk.red('Unblock did not materialize a phase transition; leaving the run blocked for manual recovery.'));
      process.exit(1);
    }
  }

  if (state.status === 'blocked' && activeCount > 0 && !skipRetainedRedispatch) {
    let retainedTurn = null;
    if (opts.turn) {
      retainedTurn = activeTurns[opts.turn];
      if (!retainedTurn) {
        console.log(chalk.red(`No active turn found for --turn ${opts.turn}`));
        process.exit(1);
      }
    } else if (activeCount > 1) {
      console.log(chalk.red('Multiple retained turns exist. Use --turn <id> to specify which to re-dispatch.'));
      for (const turn of Object.values(activeTurns)) {
        console.log(`  ${chalk.yellow('●')} ${turn.turn_id} — ${chalk.bold(turn.assigned_role)} (${turn.status})`);
      }
      console.log('');
      console.log(chalk.dim('Example: agentxchain resume --turn <turn_id>'));
      process.exit(1);
    } else {
      retainedTurn = Object.values(activeTurns)[0];
    }

    if (retainedTurn.status === 'conflicted') {
      console.log(chalk.red(`Turn ${retainedTurn.turn_id} is conflicted. Resolve the conflict before resuming.`));
      process.exit(1);
    }

    printResumeRunContext({ root, state, config });
    console.log(chalk.yellow(`Re-dispatching blocked turn: ${retainedTurn.turn_id}`));
    console.log(`  Role:    ${retainedTurn.assigned_role}`);
    console.log(`  Attempt: ${retainedTurn.attempt}`);
    console.log('');

    const reactivated = reactivateGovernedRun(root, state, { via: turnResumeVia, notificationConfig: config });
    if (!reactivated.ok) {
      console.log(chalk.red(`Failed to reactivate blocked run: ${reactivated.error}`));
      process.exit(1);
    }
    state = reactivated.state;
    if (reactivated.migration_notice) {
      console.log(chalk.yellow(reactivated.migration_notice));
    }
    if (reactivated.phantom_notice) {
      console.log(chalk.yellow(reactivated.phantom_notice));
    }

    const bundleResult = writeDispatchBundle(root, state, config, { turnId: retainedTurn.turn_id });
    if (!bundleResult.ok) {
      console.log(chalk.red(`Failed to write dispatch bundle: ${bundleResult.error}`));
      process.exit(1);
    }
    printDispatchBundleWarnings(bundleResult);

    const hooksConfig = config.hooks || {};
    if (hooksConfig.after_dispatch?.length > 0) {
      const afterDispatchResult = runAfterDispatchHooks(root, hooksConfig, state, retainedTurn, config);
      if (!afterDispatchResult.ok) {
        process.exit(1);
      }
    }

    // BUG-51 follow-up: see comment in paused/failed retained-turn branch.
    // The blocked re-dispatch path has the same watchdog/manifest invariant.
    const manifestResult = finalizeDispatchManifest(root, retainedTurn.turn_id, {
      run_id: state.run_id,
      role: retainedTurn.assigned_role,
    });
    if (!manifestResult.ok) {
      console.log(chalk.red(`Failed to finalize dispatch manifest: ${manifestResult.error}`));
      process.exit(1);
    }
    const dispatched = transitionActiveTurnLifecycle(root, retainedTurn.turn_id, 'dispatched');
    if (dispatched.ok) {
      state = dispatched.state;
    }

    printDispatchSummary(state, config, retainedTurn);
    return;
  }

  // §47: idle + no run_id → initialize new run
  if (state.status === 'idle' && !state.run_id) {
    const initResult = initializeGovernedRun(root, config);
    if (!initResult.ok) {
      console.log(chalk.red(`Failed to initialize run: ${initResult.error}`));
      process.exit(1);
    }
    state = initResult.state;
    console.log(chalk.green(`Initialized governed run: ${state.run_id}`));
    if (initResult.migration_notice) {
      console.log(chalk.yellow(initResult.migration_notice));
    }
    if (initResult.phantom_notice) {
      console.log(chalk.yellow(initResult.phantom_notice));
    }
  }

  // §47: paused + run_id exists → resume same run
  if (state.status === 'blocked' && state.run_id) {
    const reactivated = reactivateGovernedRun(root, state, { via: resumeVia, notificationConfig: config });
    if (!reactivated.ok) {
      console.log(chalk.red(`Failed to reactivate blocked run: ${reactivated.error}`));
      process.exit(1);
    }
    state = reactivated.state;
    console.log(chalk.green(`Resumed blocked run: ${state.run_id}`));
    if (reactivated.migration_notice) {
      console.log(chalk.yellow(reactivated.migration_notice));
    }
    if (reactivated.phantom_notice) {
      console.log(chalk.yellow(reactivated.phantom_notice));
    }
  }

  // §47: paused + run_id exists → resume same run
  if (state.status === 'paused' && state.run_id) {
    const reactivated = reactivateGovernedRun(root, state, { via: resumeVia, notificationConfig: config });
    if (!reactivated.ok) {
      console.log(chalk.red(`Failed to reactivate run: ${reactivated.error}`));
      process.exit(1);
    }
    state = reactivated.state;
    console.log(chalk.green(`Resumed governed run: ${state.run_id}`));
    if (reactivated.migration_notice) {
      console.log(chalk.yellow(reactivated.migration_notice));
    }
    if (reactivated.phantom_notice) {
      console.log(chalk.yellow(reactivated.phantom_notice));
    }
  }

  const phaseReconciliation = reconcilePhaseAdvanceBeforeDispatch(root, config, state);
  if (!phaseReconciliation.ok && !phaseReconciliation.state) {
    console.log(chalk.red(`Failed to reconcile phase gate before dispatch: ${phaseReconciliation.error}`));
    process.exit(1);
  }
  state = phaseReconciliation.state || state;
  if (phaseReconciliation.advanced) {
    console.log(chalk.green(`Advanced phase before dispatch: ${phaseReconciliation.from_phase} → ${phaseReconciliation.to_phase}`));
  }
  if (state.pending_phase_transition || state.pending_run_completion) {
    printRecoverySummary(state, 'This run is awaiting approval.', config);
    process.exit(1);
  }
  if (state.status === 'blocked') {
    printRecoverySummary(state, 'This run is blocked.', config);
    process.exit(1);
  }

  // Print run-context header before dispatch
  printResumeRunContext({ root, state, config });

  // Resolve target role
  const roleId = resolveTargetRole(opts, state, config);
  if (!roleId) {
    process.exit(1);
  }

  const shouldBindIntent = opts.intent !== false;
  const consumed = shouldBindIntent
    ? consumeNextApprovedIntent(root, { role: roleId, run_id: state?.run_id || null })
    : { ok: false };
  if (consumed.ok) {
    state = loadProjectState(root, config);
    if (!state) {
      console.log(chalk.red('Failed to reload governed state after intake binding.'));
      process.exit(1);
    }
    console.log(chalk.green(`Bound approved intent to next turn: ${consumed.intentId}`));
  } else {
    const assignResult = assignGovernedTurn(root, config, roleId);
    if (!assignResult.ok) {
      if (assignResult.error_code?.startsWith('hook_') || assignResult.error_code === 'hook_blocked') {
        printAssignmentHookFailure(assignResult, roleId, config);
      }
      console.log(chalk.red(`Failed to assign turn: ${assignResult.error}`));
      process.exit(1);
    }
    printAssignmentWarnings(assignResult);
    state = assignResult.state;
  }

  // Write dispatch bundle
  const bundleResult = writeDispatchBundle(root, state, config);
  if (!bundleResult.ok) {
    console.log(chalk.red(`Failed to write dispatch bundle: ${bundleResult.error}`));
    process.exit(1);
  }
  printDispatchBundleWarnings(bundleResult);

  // after_dispatch hooks with bundle-core tamper protection
  const hooksConfig = config.hooks || {};
  const turn = state.current_turn;
  if (hooksConfig.after_dispatch?.length > 0) {
    const afterDispatchResult = runAfterDispatchHooks(root, hooksConfig, state, turn, config);
    if (!afterDispatchResult.ok) {
      process.exit(1);
    }
  }

  // Finalize dispatch manifest (seals bundle after hooks)
  const manifestResult = finalizeDispatchManifest(root, turn.turn_id, {
    run_id: state.run_id,
    role: turn.assigned_role,
  });
  if (!manifestResult.ok) {
    console.log(chalk.red(`Failed to finalize dispatch manifest: ${manifestResult.error}`));
    process.exit(1);
  }

  const dispatched = transitionActiveTurnLifecycle(root, turn.turn_id, 'dispatched');
  if (dispatched.ok) {
    state = dispatched.state;
  }

  printDispatchSummary(state, config);
}

function printGhostTurnRecovery(ghostTurns) {
  console.log(chalk.red.bold('Ghost turn detected — subprocess never started.'));
  console.log('');
  for (const ghost of ghostTurns) {
    const secs = Math.floor(ghost.running_ms / 1000);
    console.log(`  Turn:    ${ghost.turn_id} (${ghost.role})`);
    console.log(`  Runtime: ${ghost.runtime_id}`);
    console.log(`  Age:     ${secs}s with no subprocess output`);
    console.log(`  Recover: ${chalk.cyan(`agentxchain reissue-turn --turn ${ghost.turn_id} --reason ghost`)}`);
    console.log('');
  }
}

function printStaleTurnRecovery(staleTurns) {
  console.log(chalk.red.bold('Stale turn detected.'));
  console.log('');
  for (const stale of staleTurns) {
    const mins = Math.floor(stale.running_ms / 60000);
    console.log(`  Turn:    ${stale.turn_id} (${stale.role})`);
    console.log(`  Runtime: ${stale.runtime_id}`);
    console.log(`  Age:     ${mins}m with no output`);
    console.log(`  Recover: ${chalk.cyan(`agentxchain reissue-turn --turn ${stale.turn_id} --reason stale`)}`);
    console.log('');
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function printResumeRunContext({ root, state, config }) {
  console.log('');
  console.log(chalk.cyan.bold('agentxchain resume'));
  console.log(`  ${chalk.dim('Run:')}      ${state?.run_id || '(uninitialized)'}`);
  console.log(`  ${chalk.dim('Phase:')}    ${state?.phase || '(unknown)'}`);

  const provenanceSummary = summarizeRunProvenance(state?.provenance);
  if (provenanceSummary) {
    console.log(`  ${chalk.dim('Origin:')}   ${chalk.magenta(provenanceSummary)}`);
  }

  if (state?.inherited_context?.parent_run_id) {
    console.log(
      `  ${chalk.dim('Inherits:')} ${chalk.magenta(
        `parent ${state.inherited_context.parent_run_id} (${state.inherited_context.parent_status || 'unknown'})`
      )}`
    );
  }

  const activeGate = config?.routing?.[state?.phase]?.exit_gate || null;
  if (activeGate) {
    const gateStatus = state?.phase_gate_status?.[activeGate] || 'pending';
    console.log(`  ${chalk.dim('Gate:')}     ${activeGate} (${gateStatus})`);

    if (gateStatus !== 'passed') {
      const gateDef = config?.gates?.[activeGate];
      if (Array.isArray(gateDef?.requires_files) && gateDef.requires_files.length > 0) {
        const fileChecks = gateDef.requires_files.map((filePath) => {
          const exists = existsSync(join(root, filePath));
          const shortPath = filePath.replace(/^\.planning\//, '');
          return exists ? chalk.green(shortPath) : chalk.red(shortPath);
        });
        console.log(`  ${chalk.dim('Files:')}    ${fileChecks.join(chalk.dim(', '))}`);
      }

      const requirements = [];
      if (gateDef?.requires_human_approval) requirements.push('human approval');
      if (gateDef?.requires_verification_pass) requirements.push('verification pass');
      if (requirements.length > 0) {
        console.log(`  ${chalk.dim('Needs:')}    ${requirements.join(', ')}`);
      }
    }
  }

  console.log('');
}

function resolveTargetRole(opts, state, config) {
  const phase = state.phase;
  const routing = config.routing?.[phase];

  if (opts.role) {
    // Validate the override
    if (!config.roles?.[opts.role]) {
      console.log(chalk.red(`Unknown role: "${opts.role}"`));
      console.log(chalk.dim(`Available roles: ${Object.keys(config.roles || {}).join(', ')}`));
      return null;
    }
    if (routing?.allowed_next_roles && !routing.allowed_next_roles.includes(opts.role) && opts.role !== 'human') {
      console.log(chalk.yellow(`Warning: role "${opts.role}" is not in allowed_next_roles for phase "${phase}".`));
      console.log(chalk.dim(`Allowed: ${routing.allowed_next_roles.join(', ')}`));
      // Allow it as an override, but warn
    }
    return opts.role;
  }

  // Default: use the phase's entry_role
  if (routing?.entry_role) {
    return routing.entry_role;
  }

  // Fallback: first role in config
  const roles = Object.keys(config.roles || {});
  if (roles.length > 0) {
    console.log(chalk.yellow(`No entry_role for phase "${phase}". Defaulting to "${roles[0]}".`));
    return roles[0];
  }

  console.log(chalk.red('No roles defined in config.'));
  return null;
}

function runAfterDispatchHooks(root, hooksConfig, state, turn, config) {
  const turnId = turn.turn_id;
  const roleId = turn.assigned_role;

  const afterDispatchHooks = runHooks(root, hooksConfig, 'after_dispatch', {
    turn_id: turnId,
    role_id: roleId,
    bundle_path: getDispatchTurnDir(turnId),
    bundle_files: ['ASSIGNMENT.json', 'PROMPT.md', 'CONTEXT.md'],
  }, {
    run_id: state.run_id,
    turn_id: turnId,
    protectedPaths: [
      getDispatchAssignmentPath(turnId),
      getDispatchPromptPath(turnId),
      getDispatchContextPath(turnId),
      getDispatchEffectiveContextPath(turnId),
    ],
  });

  if (!afterDispatchHooks.ok) {
    const hookName = afterDispatchHooks.blocker?.hook_name
      || afterDispatchHooks.tamper?.file
      || afterDispatchHooks.results?.find((e) => e.hook_name)?.hook_name
      || 'unknown';
    const detail = afterDispatchHooks.blocker?.message
      || afterDispatchHooks.tamper?.message
      || `after_dispatch hook blocked dispatch for turn ${turnId}`;
    const errorCode = afterDispatchHooks.tamper?.error_code || 'hook_blocked';

    const recoveryAction = deriveAfterDispatchHookRecoveryAction(state, config, {
      turnRetained: true,
      turnId,
    });
    markRunBlocked(root, {
      blockedOn: `hook:after_dispatch:${hookName}`,
      category: 'dispatch_error',
      recovery: {
        typed_reason: afterDispatchHooks.tamper ? 'hook_tamper' : 'hook_block',
        owner: 'human',
        recovery_action: recoveryAction,
        turn_retained: true,
        detail,
      },
      turnId,
      notificationConfig: config,
    });

    printDispatchHookFailure({
      turnId,
      roleId,
      hookName,
      error: detail,
      errorCode,
      recoveryAction,
      hookResults: afterDispatchHooks,
    });

    return { ok: false };
  }

  return { ok: true };
}

function printDispatchHookFailure({ turnId, roleId, hookName, error, hookResults, recoveryAction }) {
  const isTamper = hookResults?.tamper;
  console.log('');
  console.log(chalk.yellow('  Dispatch Blocked By Hook'));
  console.log(chalk.dim('  ' + '-'.repeat(44)));
  console.log('');
  console.log(`  ${chalk.dim('Turn:')}     ${turnId || '(unknown)'}`);
  console.log(`  ${chalk.dim('Role:')}     ${roleId || '(unknown)'}`);
  console.log(`  ${chalk.dim('Hook:')}     ${hookName}`);
  console.log(`  ${chalk.dim('Error:')}    ${error}`);
  console.log(`  ${chalk.dim('Reason:')}   ${isTamper ? 'hook_tamper' : 'hook_block'}`);
  console.log(`  ${chalk.dim('Owner:')}    human`);
  console.log(`  ${chalk.dim('Action:')}   ${recoveryAction}`);
  console.log('');
}

function printDispatchBundleWarnings(bundleResult) {
  for (const warning of bundleResult.warnings || []) {
    console.log(chalk.yellow(`Dispatch bundle warning: ${warning}`));
  }
}

function printAssignmentWarnings(assignResult) {
  for (const warning of assignResult.warnings || []) {
    console.log(chalk.yellow(`Warning: ${warning}`));
  }
}

function printRecoverySummary(state, heading, config) {
  const recovery = deriveRecoveryDescriptor(state, config);
  console.log(chalk.yellow(heading));
  if (!recovery) {
    return;
  }
  console.log(`  ${chalk.dim('Reason:')} ${recovery.typed_reason}`);
  console.log(`  ${chalk.dim('Action:')} ${recovery.recovery_action}`);
  if (recovery.detail) {
    console.log(`  ${chalk.dim('Detail:')} ${recovery.detail}`);
  }
}

function printAssignmentHookFailure(result, roleId, config) {
  const recovery = deriveRecoveryDescriptor(result.state, config);
  const hookName = result.hookResults?.blocker?.hook_name
    || result.hookResults?.results?.find((entry) => entry.hook_name)?.hook_name
    || '(unknown)';

  console.log('');
  console.log(chalk.yellow('  Turn Assignment Blocked By Hook'));
  console.log(chalk.dim('  ' + '-'.repeat(44)));
  console.log('');
  console.log(`  ${chalk.dim('Role:')}     ${roleId || '(unknown)'}`);
  console.log(`  ${chalk.dim('Phase:')}    ${result.state?.phase || '(unknown)'}`);
  console.log(`  ${chalk.dim('Hook:')}     ${hookName}`);
  console.log(`  ${chalk.dim('Error:')}    ${result.error}`);
  if (recovery) {
    console.log(`  ${chalk.dim('Reason:')}   ${recovery.typed_reason}`);
    console.log(`  ${chalk.dim('Owner:')}    ${recovery.owner}`);
    console.log(`  ${chalk.dim('Action:')}   ${recovery.recovery_action}`);
    if (recovery.detail) {
      console.log(`  ${chalk.dim('Detail:')}   ${recovery.detail}`);
    }
  } else {
    console.log(`  ${chalk.dim('Action:')}   Fix or reconfigure hook "${hookName}", then rerun agentxchain resume --role ${roleId}`);
  }
  console.log('');
}

function printDispatchSummary(state, config, explicitTurn) {
  const turn = explicitTurn || state.current_turn;
  const role = config.roles?.[turn.assigned_role];

  console.log('');
  console.log(chalk.bold('  Turn Assigned'));
  console.log(chalk.dim('  ' + '─'.repeat(44)));
  console.log('');
  console.log(`  ${chalk.dim('Turn:')}     ${turn.turn_id}`);
  console.log(`  ${chalk.dim('Role:')}     ${role?.title || turn.assigned_role}`);
  console.log(`  ${chalk.dim('Phase:')}    ${state.phase}`);
  console.log(`  ${chalk.dim('Runtime:')}  ${turn.runtime_id}`);
  console.log(`  ${chalk.dim('Attempt:')}  ${turn.attempt}`);
  console.log('');
  console.log(`  ${chalk.dim('Dispatch bundle:')} ${getDispatchTurnDir(turn.turn_id)}/`);
  console.log(`  ${chalk.dim('Prompt:')}           ${getDispatchTurnDir(turn.turn_id)}/PROMPT.md`);
  console.log(`  ${chalk.dim('Submit result to:')} ${getTurnStagingResultPath(turn.turn_id)}`);
  console.log('');
  console.log(chalk.dim('  When done, run: agentxchain validate --mode turn'));
  console.log('');
}
