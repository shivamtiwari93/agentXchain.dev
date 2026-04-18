import chalk from 'chalk';
import { readFileSync } from 'fs';
import { existsSync } from 'fs';
import { join } from 'path';
import { findProjectRoot, loadConfig, loadLock, loadProjectContext, loadProjectState, loadState } from '../lib/config.js';
import {
  deriveGovernedRunNextActions,
  deriveRecoveryDescriptor,
  deriveRuntimeBlockedGuidance,
} from '../lib/blocked-state.js';
import { getActiveTurn, getActiveTurnCount, getActiveTurns, detectActiveTurnBindingDrift } from '../lib/governed-state.js';
import { getContinuityStatus } from '../lib/continuity-status.js';
import { getConnectorHealth } from '../lib/connector-health.js';
import { readRepoDecisions, summarizeRepoDecisions } from '../lib/repo-decisions.js';
import { deriveWorkflowKitArtifacts } from '../lib/workflow-kit-artifacts.js';
import { evaluateTimeouts, computeTimeoutBudget } from '../lib/timeout-evaluator.js';
import { evaluateApprovalSlaReminders } from '../lib/notification-runner.js';
import { summarizeRunProvenance } from '../lib/run-provenance.js';
import { readRecentRunEventSummary } from '../lib/recent-event-summary.js';
import { deriveConflictedTurnResolutionActions } from '../lib/conflict-actions.js';
import { summarizeLatestGateActionAttempt } from '../lib/gate-actions.js';
import { findCurrentHumanEscalation } from '../lib/human-escalations.js';
import { getDashboardPid, getDashboardSession } from './dashboard.js';
import { readPreemptionMarker, findPendingApprovedIntents } from '../lib/intake.js';
import { readContinuousSession } from '../lib/continuous-run.js';
import { readAllDispatchProgress } from '../lib/dispatch-progress.js';

export async function statusCommand(opts) {
  const context = loadStatusContext();
  if (!context) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  if (context.config.protocol_mode === 'governed') {
    return renderGovernedStatus(context, opts);
  }

  const result = loadConfig();
  const { root, config } = result;
  const lock = loadLock(root);
  const state = loadState(root);

  if (opts.json) {
    console.log(JSON.stringify({ config, lock, state }, null, 2));
    return;
  }

  console.log('');
  console.log(chalk.bold('  AgentXchain Status'));
  console.log(chalk.dim('  ' + '─'.repeat(44)));
  console.log('');

  console.log(`  ${chalk.dim('Project:')}  ${config.project}`);
  console.log(`  ${chalk.dim('Phase:')}    ${state ? formatPhase(state.phase) : chalk.dim('unknown')}`);
  if (state?.blocked) {
    console.log(`  ${chalk.dim('Blocked:')}  ${chalk.red('YES')} — ${state.blocked_on || 'unknown reason'}`);
  }
  console.log('');

  if (lock) {
    if (lock.holder === 'human') {
      console.log(`  ${chalk.dim('Lock:')}     ${chalk.magenta('HUMAN')} — you hold the lock`);
    } else if (lock.holder) {
      const agentName = config.agents[lock.holder]?.name || lock.holder;
      console.log(`  ${chalk.dim('Lock:')}     ${chalk.yellow('CLAIMED')} by ${chalk.bold(lock.holder)} (${agentName})`);
      if (lock.claimed_at) {
        console.log(`  ${chalk.dim('Claimed:')}  ${timeSince(lock.claimed_at)} ago`);
      }
    } else {
      console.log(`  ${chalk.dim('Lock:')}     ${chalk.green('FREE')} — any agent can claim`);
    }
    console.log(`  ${chalk.dim('Turn:')}     ${lock.turn_number}`);
    if (lock.last_released_by) {
      console.log(`  ${chalk.dim('Last:')}     ${lock.last_released_by}`);
    }
  }
  console.log('');

  console.log(`  ${chalk.dim('Agents:')}   ${Object.keys(config.agents).length}`);

  for (const [id, agent] of Object.entries(config.agents)) {
    const isHolder = lock?.holder === id;
    const marker = isHolder ? chalk.yellow('●') : chalk.dim('○');
    const label = isHolder ? chalk.bold(id) : id;
    console.log(`    ${marker} ${label} — ${agent.name}`);
  }

  if (lock?.holder === 'human') {
    console.log(`    ${chalk.magenta('●')} ${chalk.bold('human')} — You`);
  }

  console.log('');
}

function loadStatusContext(dir = process.cwd()) {
  const context = loadProjectContext(dir);
  if (context) return context;

  const root = findProjectRoot(dir);
  if (!root) return null;

  let rawConfig;
  try {
    rawConfig = JSON.parse(readFileSync(join(root, 'agentxchain.json'), 'utf8'));
  } catch {
    return null;
  }

  if (rawConfig?.protocol_mode !== 'governed') {
    return null;
  }

  return {
    root,
    rawConfig,
    config: rawConfig,
    version: 4,
  };
}

function renderGovernedStatus(context, opts) {
  const { root, config, version } = context;
  const state = loadProjectState(root, config);
  const continuity = getContinuityStatus(root, state);
  const connectorHealth = getConnectorHealth(root, config, state);
  const recovery = deriveRecoveryDescriptor(state, config);
  const runtimeGuidance = deriveRuntimeBlockedGuidance(state, config);
  const nextActions = deriveGovernedRunNextActions(state, config);
  const recentEventSummary = readRecentRunEventSummary(root);
  const repoDecisionSummary = summarizeRepoDecisions(readRepoDecisions(root), config);

  const workflowKitArtifacts = deriveWorkflowKitArtifacts(root, config, state);
  const humanEscalation = findCurrentHumanEscalation(root, state);
  const preemptionMarker = readPreemptionMarker(root);
  const pendingIntents = findPendingApprovedIntents(root);
  const continuousSession = readContinuousSession(root);
  const gateActionAttempt = state?.pending_phase_transition
    ? summarizeLatestGateActionAttempt(root, 'phase_transition', state.pending_phase_transition.gate)
    : state?.pending_run_completion
      ? summarizeLatestGateActionAttempt(root, 'run_completion', state.pending_run_completion.gate)
      : null;

  // Fire approval SLA reminders as a side effect (webhook-only, no CLI output)
  evaluateApprovalSlaReminders(root, config, state);

  const activeTurns = getActiveTurns(state);
  const dispatchProgress = filterDispatchProgressForActiveTurns(readAllDispatchProgress(root), activeTurns);

  if (opts.json) {
    const dashPid = getDashboardPid(root);
    const dashSession = getDashboardSession(root);
    const dashboardSessionObj = dashPid
      ? { status: 'running', pid: dashPid, url: dashSession?.url || null, started_at: dashSession?.started_at || null }
      : dashSession
        ? { status: 'stale', pid: dashSession.pid || null, url: dashSession.url || null, started_at: dashSession.started_at || null }
        : { status: 'not_running', pid: null, url: null, started_at: null };

    console.log(JSON.stringify({
      version,
      protocol_mode: config.protocol_mode,
      template: config.template || 'generic',
      project_goal: config.project?.goal || null,
      config,
      state,
      provenance: state?.provenance || null,
      inherited_context: state?.inherited_context || null,
      repo_decisions: state?.repo_decisions || null,
      repo_decision_summary: repoDecisionSummary,
      continuity,
      recovery,
      runtime_guidance: runtimeGuidance,
      next_actions: nextActions,
      connector_health: connectorHealth,
      recent_event_summary: recentEventSummary,
      dispatch_progress: dispatchProgress,
      human_escalation: humanEscalation,
      preemption_marker: preemptionMarker,
      pending_intents: pendingIntents,
      continuous_session: continuousSession,
      gate_action_attempt: gateActionAttempt,
      workflow_kit_artifacts: workflowKitArtifacts,
      dashboard_session: dashboardSessionObj,
      binding_drift: detectActiveTurnBindingDrift(state, config),
    }, null, 2));
    return;
  }

  console.log('');
  console.log(chalk.bold('  AgentXchain Status'));
  console.log(chalk.dim('  ' + '─'.repeat(44)));
  console.log('');

  // Priority injection banner — above all other status
  if (preemptionMarker) {
    console.log(chalk.red.bold('  ⚡ Priority injection pending'));
    console.log(chalk.dim(`  Intent:      ${preemptionMarker.intent_id}`));
    console.log(`  Priority:    ${chalk.red.bold(preemptionMarker.priority)}`);
    if (preemptionMarker.description) {
      console.log(chalk.dim(`  Description: ${preemptionMarker.description}`));
    }
    if (preemptionMarker.injected_at) {
      console.log(chalk.dim(`  Injected at: ${preemptionMarker.injected_at}`));
    }
    console.log(chalk.dim('  Effect:      Will preempt current workstream after this turn completes'));
    console.log(chalk.dim('  ' + '─'.repeat(44)));
    console.log('');
  }

  // Pending injected intents (BUG-15)
  if (pendingIntents.length > 0) {
    console.log(chalk.yellow.bold('  📋 Pending injected intents (will drive next turn):'));
    for (const pi of pendingIntents) {
      const priorityColor = pi.priority === 'p0' ? chalk.red.bold : pi.priority === 'p1' ? chalk.yellow.bold : chalk.dim;
      const charterSnippet = pi.charter
        ? (pi.charter.length > 60 ? pi.charter.slice(0, 57) + '...' : pi.charter)
        : '(no charter)';
      console.log(`    ${priorityColor(`[${pi.priority}]`)} ${chalk.dim(pi.intent_id)} — ${charterSnippet}`);
      console.log(chalk.dim(`         Acceptance: ${pi.acceptance_count} item${pi.acceptance_count !== 1 ? 's' : ''}`));
    }
    console.log(chalk.dim('  ' + '─'.repeat(44)));
    console.log('');
  }

  // Continuous session banner
  if (continuousSession) {
    console.log(chalk.cyan.bold('  🔄 Continuous Vision-Driven Session'));
    console.log(chalk.dim(`  Session:     ${continuousSession.session_id}`));
    console.log(chalk.dim(`  Vision:      ${continuousSession.vision_path}`));
    console.log(`  Status:      ${chalk.cyan(continuousSession.status || 'unknown')}`);
    console.log(`  Runs:        ${continuousSession.runs_completed || 0}/${continuousSession.max_runs || '?'}`);
    if (continuousSession.owner_type === 'schedule') {
      console.log(chalk.dim(`  Owner:       schedule:${continuousSession.owner_id}`));
    }
    if (continuousSession.current_vision_objective) {
      console.log(`  Objective:   ${chalk.yellow(continuousSession.current_vision_objective)}`);
    }
    if (continuousSession.idle_cycles > 0) {
      console.log(chalk.dim(`  Idle cycles: ${continuousSession.idle_cycles}/${continuousSession.max_idle_cycles}`));
    }
    if (continuousSession.per_session_max_usd != null) {
      const spent = (continuousSession.cumulative_spent_usd || 0).toFixed(2);
      const limit = continuousSession.per_session_max_usd.toFixed(2);
      const pct = continuousSession.per_session_max_usd > 0
        ? ((continuousSession.cumulative_spent_usd || 0) / continuousSession.per_session_max_usd * 100).toFixed(1)
        : '0.0';
      const budgetStr = continuousSession.budget_exhausted
        ? chalk.red(`$${spent} / $${limit} (${pct}%) [EXHAUSTED]`)
        : `$${spent} / $${limit} (${pct}%)`;
      console.log(`  Budget:      ${budgetStr}`);
    }
    console.log(chalk.dim('  ' + '─'.repeat(44)));
    console.log('');
  }

  console.log(`  ${chalk.dim('Project:')}  ${config.project.name}`);
  if (config.project.goal) {
    console.log(`  ${chalk.dim('Goal:')}     ${config.project.goal}`);
  }
  console.log(`  ${chalk.dim('Protocol:')} ${chalk.cyan(`governed (v${version})`)}`);
  console.log(`  ${chalk.dim('Template:')} ${config.template || 'generic'}`);
  console.log(`  ${chalk.dim('Phase:')}    ${state?.phase ? formatGovernedPhase(state.phase) : chalk.dim('unknown')}`);
  console.log(`  ${chalk.dim('Run:')}      ${formatRunStatus(state?.status)}`);
  const provenanceSummary = summarizeRunProvenance(state?.provenance);
  if (provenanceSummary) {
    console.log(`  ${chalk.dim('Origin:')}   ${chalk.magenta(provenanceSummary)}`);
  }
  if (state?.inherited_context?.parent_run_id) {
    console.log(`  ${chalk.dim('Inherits:')} ${chalk.magenta(`parent ${state.inherited_context.parent_run_id} (${state.inherited_context.parent_status || 'unknown'})`)}`);
  }
  if (repoDecisionSummary) {
    console.log(`  ${chalk.dim('Repo decisions:')} ${chalk.yellow(formatRepoDecisionHeadline(repoDecisionSummary))}`);
    const carryoverDetail = formatRepoDecisionCarryover(repoDecisionSummary);
    if (carryoverDetail) {
      console.log(`  ${chalk.dim('Carryover:')} ${carryoverDetail}`);
    }
  }
  if (state?.accepted_integration_ref) {
    console.log(`  ${chalk.dim('Accepted:')} ${state.accepted_integration_ref}`);
  }
  console.log('');

  renderContinuityStatus(continuity, state);
  renderConnectorHealthStatus(connectorHealth);
  renderRecentEventSummary(recentEventSummary);

  const activeTurnCount = getActiveTurnCount(state);
  const singleActiveTurn = getActiveTurn(state);
  const approvalPending = Boolean(state?.pending_phase_transition || state?.pending_run_completion);
  if (activeTurnCount > 1) {
    console.log(`  ${chalk.dim('Turns:')}    ${activeTurnCount} active`);
    for (const turn of Object.values(activeTurns)) {
      const marker = (turn.status === 'conflicted' || turn.status === 'failed_acceptance')
        ? chalk.red('✗')
        : chalk.yellow('●');
      const statusLabel = turn.status === 'conflicted'
        ? chalk.red('conflicted')
        : turn.status === 'failed_acceptance'
          ? chalk.red('failed_acceptance')
          : turn.status;
      let elapsedTag = '';
      if (turn.started_at) {
        const elMs = Date.now() - new Date(turn.started_at).getTime();
        if (elMs >= 0) {
          const s = Math.floor(elMs / 1000);
          const m = Math.floor(s / 60);
          elapsedTag = m > 0 ? ` — ${m}m ${s % 60}s` : ` — ${s}s`;
        }
      }
      let budgetTag = '';
      if (config.timeouts?.per_turn_minutes && turn.started_at) {
        const tb = computeTimeoutBudget({ config, state, turn, now: new Date() });
        const tBudget = tb.find((b) => b.scope === 'turn');
        if (tBudget) {
          if (tBudget.exceeded) {
            budgetTag = ` ${chalk.red('[TIMEOUT]')}`;
          } else {
            budgetTag = ` ${chalk.dim(`[${tBudget.remaining_minutes}m left]`)}`;
          }
        }
      }
      console.log(`    ${marker} ${turn.turn_id} — ${chalk.bold(turn.assigned_role)} (${statusLabel}) [attempt ${turn.attempt}]${elapsedTag}${budgetTag}`);
      const activityLine = formatDispatchActivityLine(dispatchProgress[turn.turn_id]);
      if (activityLine) {
        console.log(`      ${chalk.dim('Activity:')} ${activityLine}`);
      }
      if (turn.status === 'conflicted' && turn.conflict_state) {
        const cs = turn.conflict_state;
        const files = cs.conflict_error?.conflicting_files || [];
        const count = cs.detection_count || 1;
        const [reassignAction, mergeAction] = deriveConflictedTurnResolutionActions(turn.turn_id);
        console.log(`      ${chalk.dim('Conflict:')}  ${files.length} file(s) — detection #${count}`);
        if (cs.conflict_error?.overlap_ratio != null) {
          console.log(`      ${chalk.dim('Overlap:')}   ${(cs.conflict_error.overlap_ratio * 100).toFixed(0)}%`);
        }
        const suggestion = cs.conflict_error?.suggested_resolution || 'reject_and_reassign';
        console.log(`      ${chalk.dim('Suggested:')} ${suggestion}`);
        console.log(`      ${chalk.dim('Resolve:')}   ${chalk.cyan(reassignAction.command)}`);
        console.log(`      ${chalk.dim('     or:')}   ${chalk.cyan(mergeAction.command)}`);
      }
      if (turn.status === 'failed_acceptance') {
        console.log(`      ${chalk.dim('Reason:')}  ${turn.failure_reason || 'unknown'}`);
        console.log(`      ${chalk.dim('Recover:')} ${chalk.cyan(`agentxchain reject-turn --turn ${turn.turn_id}`)} — reject and retry`);
        console.log(`      ${chalk.dim('     or:')} ${chalk.cyan(`agentxchain accept-turn --turn ${turn.turn_id}`)} — re-attempt acceptance`);
      }
    }
  } else if (singleActiveTurn) {
    console.log(`  ${chalk.dim('Turn:')}     ${singleActiveTurn.turn_id}`);
    console.log(`  ${chalk.dim('Role:')}     ${chalk.bold(singleActiveTurn.assigned_role)} (${singleActiveTurn.status})`);
    console.log(`  ${chalk.dim('Runtime:')}  ${singleActiveTurn.runtime_id}`);
    console.log(`  ${chalk.dim('Attempt:')}  ${singleActiveTurn.attempt}`);
    if (singleActiveTurn.started_at) {
      const elapsedMs = Date.now() - new Date(singleActiveTurn.started_at).getTime();
      if (elapsedMs >= 0) {
        const secs = Math.floor(elapsedMs / 1000);
        const mins = Math.floor(secs / 60);
        const remainSecs = secs % 60;
        const elapsed = mins > 0 ? `${mins}m ${remainSecs}s` : `${remainSecs}s`;
        console.log(`  ${chalk.dim('Elapsed:')}  ${elapsed}`);
      }
    }
    // Turn-level timeout budget inline with turn info
    if (config.timeouts?.per_turn_minutes && singleActiveTurn.started_at) {
      const turnBudgets = computeTimeoutBudget({ config, state, turn: singleActiveTurn, now: new Date() });
      const turnBudget = turnBudgets.find((b) => b.scope === 'turn');
      if (turnBudget) {
        if (turnBudget.exceeded) {
          console.log(`  ${chalk.dim('Budget:')}   ${chalk.red(`EXCEEDED — was ${turnBudget.limit_minutes}m, over by ${turnBudget.elapsed_minutes - turnBudget.limit_minutes}m`)}`);
        } else {
          const remMins = Math.floor(turnBudget.remaining_seconds / 60);
          const remSecs = turnBudget.remaining_seconds % 60;
          const remLabel = remMins > 0 ? `${remMins}m ${remSecs}s` : `${remSecs}s`;
          console.log(`  ${chalk.dim('Budget:')}   ${chalk.green(`${remLabel} remaining`)} of ${turnBudget.limit_minutes}m (deadline ${new Date(turnBudget.deadline_iso).toLocaleTimeString()})`);
        }
      }
    }
    // Dispatch progress activity line (DEC-DISPATCH-PROGRESS-001)
    const activityLine = formatDispatchActivityLine(dispatchProgress[singleActiveTurn.turn_id]);
    if (activityLine) {
      console.log(`  ${chalk.dim('Activity:')} ${activityLine}`);
    }
    if (singleActiveTurn.status === 'conflicted' && singleActiveTurn.conflict_state) {
      const cs = singleActiveTurn.conflict_state;
      const files = cs.conflict_error?.conflicting_files || [];
      const count = cs.detection_count || 1;
      const [reassignAction, mergeAction] = deriveConflictedTurnResolutionActions(singleActiveTurn.turn_id);
      console.log(`  ${chalk.dim('Conflict:')} ${chalk.red(`${files.length} file(s) conflicting`)} — detection #${count}`);
      if (cs.conflict_error?.overlap_ratio != null) {
        console.log(`  ${chalk.dim('Overlap:')}  ${(cs.conflict_error.overlap_ratio * 100).toFixed(0)}%`);
      }
      const suggestion = cs.conflict_error?.suggested_resolution || 'reject_and_reassign';
      console.log(`  ${chalk.dim('Suggest:')}  ${suggestion}`);
      console.log(`  ${chalk.dim('Resolve:')}  ${chalk.cyan(reassignAction.command)}`);
      console.log(`  ${chalk.dim('     or:')}  ${chalk.cyan(mergeAction.command)}`);
    }
  } else {
    console.log(`  ${chalk.dim('Turn:')}     ${chalk.yellow('No active turn')}`);
  }

  // Runtime/authority binding drift detection (B-7)
  const bindingDrifts = detectActiveTurnBindingDrift(state, config);
  if (bindingDrifts.length > 0) {
    console.log('');
    console.log(`  ${chalk.red.bold('⚠ Stale binding detected')}`);
    for (const drift of bindingDrifts) {
      if (drift.runtime_changed) {
        console.log(`  ${chalk.dim('Turn:')}     ${drift.turn_id} (${drift.role_id})`);
        console.log(`  ${chalk.dim('Runtime:')}  ${chalk.yellow(drift.old_runtime)} → ${chalk.green(drift.new_runtime)} (config changed)`);
      }
      if (drift.authority_changed) {
        console.log(`  ${chalk.dim('Authority:')} ${chalk.yellow(drift.old_authority)} → ${chalk.green(drift.new_authority)} (config changed)`);
      }
      console.log(`  ${chalk.dim('Recover:')}  ${chalk.cyan(drift.recovery_command)}`);
    }
  }

  // Queued phase/completion requests
  if (state?.queued_phase_transition) {
    const qt = state.queued_phase_transition;
    console.log('');
    console.log(`  ${chalk.dim('Queued:')}   Phase transition ${formatGovernedPhase(qt.from)} → ${formatGovernedPhase(qt.to)} (awaiting drain)`);
  }
  if (state?.queued_run_completion) {
    console.log('');
    console.log(`  ${chalk.dim('Queued:')}   Run completion (awaiting drain)`);
  }

  // Per-turn budget reservations
  if (state?.budget_reservations && Object.keys(state.budget_reservations).length > 0) {
    console.log('');
    console.log(`  ${chalk.dim('Budget reservations:')}`);
    for (const [turnId, reservation] of Object.entries(state.budget_reservations)) {
      const amt = reservation.reserved_usd != null ? `$${formatUsd(reservation.reserved_usd)}` : '(unknown)';
      console.log(`    ${chalk.dim('●')} ${turnId}: ${amt}`);
    }
  }

  if (state?.blocked_on) {
    console.log('');
    if (state.status === 'blocked') {
      const detail = recovery?.detail || state.blocked_on;
      console.log(`  ${chalk.dim('Blocked:')}  ${chalk.red.bold('BLOCKED')} — ${detail}`);
    } else if (state.blocked_on.startsWith('human_approval:')) {
      const gate = state.blocked_on.replace('human_approval:', '');
      console.log(`  ${chalk.dim('Blocked:')}  ${chalk.yellow('AWAITING HUMAN APPROVAL')} — gate: ${chalk.bold(gate)}`);
    } else {
      console.log(`  ${chalk.dim('Blocked:')}  ${chalk.red(state.blocked_on)}`);
    }
  }

  if (state?.last_gate_failure) {
    renderLastGateFailure(state.last_gate_failure, config);
  }

  if (recovery) {
    console.log('');
    console.log(`  ${chalk.dim('Reason:')}   ${recovery.typed_reason}`);
    console.log(`  ${chalk.dim('Owner:')}    ${recovery.owner}`);
    console.log(`  ${chalk.dim('Action:')}   ${recovery.recovery_action}`);
    console.log(`  ${chalk.dim('Turn:')}     ${recovery.turn_retained ? 'retained' : 'cleared'}`);
    if (recovery.detail) {
      console.log(`  ${chalk.dim('Detail:')}   ${recovery.detail}`);
    }
  }

  if (humanEscalation) {
    console.log('');
    console.log(`  ${chalk.dim('Human task:')} ${chalk.yellow(humanEscalation.escalation_id)}${humanEscalation.service ? ` (${humanEscalation.service})` : ''}`);
    console.log(`  ${chalk.dim('Type:')}     ${humanEscalation.type}`);
    console.log(`  ${chalk.dim('Unblock:')}  ${chalk.cyan(humanEscalation.resolution_command)}`);
    if (humanEscalation.action) {
      console.log(`  ${chalk.dim('Task:')}     ${humanEscalation.action}`);
    }
  }

  if (runtimeGuidance.length > 0) {
    console.log('');
    console.log(`  ${chalk.dim('Runtime guidance:')}`);
    for (const entry of runtimeGuidance) {
      console.log(`    ${chalk.yellow('•')} ${entry.code} — ${chalk.cyan(entry.command)}`);
      console.log(`      ${chalk.dim(`${entry.role_id} owns ${entry.artifact_path} at ${entry.phase}/${entry.gate_id}`)}`);
      console.log(`      ${chalk.dim(entry.reason)}`);
    }
  }

  if (state?.pending_phase_transition) {
    const pt = state.pending_phase_transition;
    console.log(`  ${chalk.dim('Pending:')}  ${formatGovernedPhase(pt.from)} → ${formatGovernedPhase(pt.to)}`);
    console.log(`  ${chalk.dim('Gate:')}     ${pt.gate} (requires human approval)`);
    if (pt.requested_at) {
      console.log(`  ${chalk.dim('Requested:')} ${pt.requested_at} (${timeSince(pt.requested_at)} ago)`);
    }
  }

  if (state?.pending_run_completion) {
    const pc = state.pending_run_completion;
    console.log(`  ${chalk.dim('Pending:')}  ${chalk.bold('Run Completion')}`);
    console.log(`  ${chalk.dim('Gate:')}     ${pc.gate} (requires human approval)`);
    if (pc.requested_at) {
      console.log(`  ${chalk.dim('Requested:')} ${pc.requested_at} (${timeSince(pc.requested_at)} ago)`);
    }
  }

  if (gateActionAttempt) {
    console.log(`  ${chalk.dim('Gate actions:')} ${gateActionAttempt.status} at ${gateActionAttempt.attempted_at || 'unknown time'}`);
    for (const action of gateActionAttempt.actions) {
      const label = action.action_label || action.command || `action ${action.action_index || '?'}`;
      const outcome = action.status === 'failed'
        ? (action.timed_out ? chalk.red(`timed out after ${action.timeout_ms}ms`) : chalk.red('failed'))
        : chalk.green('succeeded');
      const exit = action.timed_out ? '' : (action.exit_code == null ? '' : ` (exit ${action.exit_code})`);
      console.log(`    ${action.action_index || '?'}. ${label} — ${outcome}${exit}`);
      if (action.status === 'failed' && action.stderr_tail) {
        console.log(`      ${chalk.dim(action.stderr_tail)}`);
      }
    }
  }

  if (state?.status === 'completed') {
    console.log('');
    console.log(`  ${chalk.green.bold('✓ Run completed')}`);
    if (state.completed_at) {
      console.log(`  ${chalk.dim('Completed:')} ${state.completed_at}`);
    }
  }

  if (state?.phase_gate_status) {
    console.log('');
    console.log(`  ${chalk.dim('Gates:')}`);
    const activePhase = state.phase;
    const activeRouting = config.routing?.[activePhase];
    const activeExitGate = activeRouting?.exit_gate || null;
    for (const [gate, status] of Object.entries(state.phase_gate_status)) {
      const icon = status === 'passed' ? chalk.green('✓') : chalk.dim('○');
      console.log(`    ${icon} ${gate}: ${status}`);
      if (status !== 'passed' && gate === activeExitGate && config.gates?.[gate]) {
        const gateDef = config.gates[gate];
        if (Array.isArray(gateDef.requires_files) && gateDef.requires_files.length > 0) {
          const fileChecks = gateDef.requires_files.map(f => {
            const exists = existsSync(join(root, f));
            const short = f.replace(/^\.planning\//, '');
            return exists ? chalk.green(short) : chalk.red(short);
          });
          console.log(`      ${chalk.dim('Files:')} ${fileChecks.join(chalk.dim(', '))}`);
        }
        const reqs = [];
        if (gateDef.requires_human_approval) reqs.push('human approval');
        if (gateDef.requires_verification_pass) reqs.push('verification pass');
        if (reqs.length > 0) {
          console.log(`      ${chalk.dim('Needs:')} ${reqs.join(', ')}`);
        }
      }
    }
  }

  renderWorkflowKitArtifactsSection(workflowKitArtifacts);

  if (config.timeouts && (state?.status === 'active' || approvalPending)) {
    const nowDate = new Date();
    const activeTurn = state?.status === 'active' ? getActiveTurn(state) : null;
    const turnResult = activeTurn ? { role: activeTurn.assigned_role } : undefined;
    const timeoutEval = evaluateTimeouts({ config, state, turn: activeTurn, turnResult, now: nowDate.toISOString() });
    const allItems = [...timeoutEval.exceeded, ...timeoutEval.warnings];
    // Compute full budget for phase/run scopes (turn budget is shown inline with turn info above)
    const budgets = computeTimeoutBudget({ config, state, turn: activeTurn, now: nowDate })
      .filter((b) => b.scope !== 'turn'); // turn budget already shown inline

    if (allItems.length > 0 || budgets.length > 0 || approvalPending) {
      console.log('');
      console.log(`  ${chalk.dim('Timeouts:')}`);
      if (approvalPending) {
        console.log(`    ${chalk.yellow('◷')} approval wait does not mutate timeout state; phase/run clocks keep ticking until the next accepted turn`);
      }
      // Show exceeded/warned items
      for (const item of allItems) {
        const isExceeded = timeoutEval.exceeded.includes(item);
        const elapsed = item.elapsed_minutes != null ? `${item.elapsed_minutes}m` : '?';
        const limit = item.limit_minutes != null ? `${item.limit_minutes}m` : '?';
        const icon = isExceeded ? chalk.red('⚠') : chalk.yellow('◷');
        const label = isExceeded ? chalk.red(`EXCEEDED ${item.scope}`) : chalk.yellow(`${item.scope}`);
        console.log(`    ${icon} ${label}: ${elapsed}/${limit} (action: ${item.action || 'n/a'})`);
      }
      // Show remaining budget for non-exceeded phase/run scopes
      const exceededScopes = new Set(allItems.map((i) => `${i.scope}:${i.phase || ''}`));
      for (const b of budgets) {
        const key = `${b.scope}:${b.phase || ''}`;
        if (exceededScopes.has(key)) continue; // already shown as exceeded above
        const scopeLabel = b.scope === 'phase' ? `phase (${b.phase})` : b.scope;
        console.log(`    ${chalk.green('✓')} ${scopeLabel}: ${b.elapsed_minutes}m/${b.limit_minutes}m — ${chalk.green(`${b.remaining_minutes}m remaining`)}`);
      }
      if (approvalPending && allItems.length === 0 && budgets.length === 0) {
        console.log(`    ${chalk.dim('No current phase/run timeout pressure.')}`);
      }
    }
  }

  if (state?.budget_status) {
    console.log('');
    const budgetLabel = state.budget_status.warn_mode
      ? `spent $${formatUsd(state.budget_status.spent_usd)} / remaining $${formatUsd(state.budget_status.remaining_usd)} ${chalk.yellow('[OVER BUDGET]')}`
      : `spent $${formatUsd(state.budget_status.spent_usd)} / remaining $${formatUsd(state.budget_status.remaining_usd)}`;
    console.log(`  ${chalk.dim('Budget:')}   ${budgetLabel}`);
  }

  console.log('');
  console.log(`  ${chalk.dim('Roles:')}    ${Object.keys(config.roles).length}`);
  for (const [id, role] of Object.entries(config.roles)) {
    const isAssigned = Object.values(getActiveTurns(state)).some(turn => turn.assigned_role === id);
    const marker = isAssigned ? chalk.yellow('●') : chalk.dim('○');
    const label = isAssigned ? chalk.bold(id) : id;
    console.log(`    ${marker} ${label} — ${role.title} [${role.write_authority}]`);
  }
  console.log('');
}

function renderConnectorHealthStatus(connectorHealth) {
  const connectors = Array.isArray(connectorHealth?.connectors)
    ? connectorHealth.connectors
    : [];
  if (connectors.length === 0) {
    return;
  }

  console.log(`  ${chalk.dim('Connectors:')}`);
  for (const connector of connectors) {
    const stateLabel = formatConnectorState(connector.state);
    console.log(`    ${stateLabel} ${chalk.bold(connector.runtime_id)} — ${connector.type} (${connector.target})`);

    if (connector.active_turn_ids.length > 0) {
      console.log(`      ${chalk.dim('Active turns:')} ${connector.active_turn_ids.join(', ')}`);
    }

    if (connector.last_error) {
      console.log(`      ${chalk.dim('Last error:')} ${connector.last_error}`);
    } else if (connector.last_success_at) {
      console.log(`      ${chalk.dim('Last success:')} ${connector.last_success_at}`);
    } else if (connector.last_attempt_at) {
      console.log(`      ${chalk.dim('Last attempt:')} ${connector.last_attempt_at}`);
    }
  }
  console.log('');
}

function formatConnectorState(state) {
  switch (state) {
    case 'healthy':
      return chalk.green('● healthy');
    case 'failing':
      return chalk.red('✗ failing');
    case 'active':
      return chalk.yellow('● active');
    case 'never_used':
    default:
      return chalk.dim('○ never_used');
  }
}

function renderContinuityStatus(continuity, state) {
  if (!continuity) return;

  console.log(`  ${chalk.dim('Continuity:')}`);

  if (continuity.checkpoint) {
    const checkpoint = continuity.checkpoint;
    const checkpointSummary = checkpoint.last_checkpoint_at
      ? `${checkpoint.checkpoint_reason || 'unknown'} at ${checkpoint.last_checkpoint_at}`
      : (checkpoint.checkpoint_reason || 'unknown');
    console.log(`  ${chalk.dim('Session:')}  ${checkpoint.session_id || chalk.dim('unknown')}`);
    console.log(`  ${chalk.dim('Checkpoint:')} ${checkpointSummary}`);
    console.log(`  ${chalk.dim('Last turn:')} ${checkpoint.last_turn_id || chalk.dim('none')}`);
    console.log(`  ${chalk.dim('Last role:')} ${checkpoint.last_role || chalk.dim('unknown')}`);
    if (continuity.stale_checkpoint) {
      console.log(
        `  ${chalk.dim('Warning:')} ${chalk.yellow(
          `session checkpoint tracks ${checkpoint.run_id}, but state.json tracks ${state?.run_id || 'unknown'}; state.json remains source of truth`
        )}`
      );
    }
  } else {
    console.log(`  ${chalk.dim('Checkpoint:')} ${chalk.yellow('No session checkpoint recorded')}`);
  }

  if (continuity.drift_detected === true) {
    const [firstWarning, ...remainingWarnings] = continuity.drift_warnings || [];
    if (firstWarning) {
      console.log(`  ${chalk.dim('Drift:')}    ${chalk.yellow(firstWarning)}`);
    }
    for (const warning of remainingWarnings) {
      console.log(`  ${chalk.dim('         ')} ${chalk.yellow(warning)}`);
    }
  } else if (continuity.drift_detected === false) {
    console.log(`  ${chalk.dim('Drift:')}    ${chalk.green('none detected since checkpoint')}`);
  }

  if (continuity.recommended_command) {
    const detail = continuity.recommended_detail ? ` (${continuity.recommended_detail})` : '';
    console.log(`  ${chalk.dim('Action:')}   ${chalk.cyan(continuity.recommended_command)}${chalk.dim(detail)}`);
  }

  if (continuity.recovery_report_path) {
    console.log(`  ${chalk.dim('Report:')}   ${continuity.recovery_report_path}`);
  }

  console.log('');
}

function renderWorkflowKitArtifactsSection(wkData) {
  if (!wkData || !wkData.artifacts || wkData.artifacts.length === 0) return;

  const artifacts = wkData.artifacts;
  console.log('');
  console.log(`  ${chalk.dim('Artifacts:')} (${wkData.phase})`);
  for (const a of artifacts) {
    const icon = a.exists ? chalk.green('✓') : (a.required ? chalk.red('✗') : chalk.yellow('○'));
    const reqLabel = a.required ? '' : chalk.dim(' (optional)');
    const ownerLabel = a.owned_by
      ? chalk.dim(` [${a.owned_by}${a.owner_resolution === 'entry_role' ? '*' : ''}]`)
      : '';
    console.log(`    ${icon} ${a.path}${ownerLabel}${reqLabel}`);
  }
  if (artifacts.some(a => a.owner_resolution === 'entry_role')) {
    console.log(`    ${chalk.dim('* = ownership inferred from entry_role')}`);
  }
}

function renderRecentEventSummary(summary) {
  if (!summary) return;

  const label = summary.freshness === 'recent'
    ? chalk.green('recent')
    : summary.freshness === 'quiet'
      ? chalk.yellow('quiet')
      : summary.freshness === 'unknown'
        ? chalk.yellow('unknown timing')
        : chalk.dim('none recorded');
  const countLabel = summary.freshness === 'no_events'
    ? null
    : `${summary.recent_count || 0} in last ${summary.window_minutes || 15}m`;

  console.log(`  ${chalk.dim('Recent events:')} ${label}${countLabel ? chalk.dim(` (${countLabel})`) : ''}`);
  if (summary.latest_event) {
    console.log(`  ${chalk.dim('Latest:')}   ${summary.latest_event.summary || summary.latest_event.event_type || 'unknown_event'}`);
    console.log(`  ${chalk.dim('When:')}     ${summary.latest_event.timestamp || 'unknown'}`);
  }
  console.log('');
}

function formatRepoDecisionHeadline(summary) {
  if (!summary) return 'none';
  const parts = [`${summary.active_count} active`];
  if (summary.overridden_count > 0) {
    parts.push(`${summary.overridden_count} overridden`);
  }
  return parts.join(', ');
}

function formatRepoDecisionCarryover(summary) {
  if (!summary?.operator_summary) {
    return '';
  }

  const { operator_summary: operatorSummary, active_count: activeCount } = summary;
  const parts = [];

  if (activeCount === 0) {
    parts.push('no active cross-run constraints remain');
  } else if (Array.isArray(operatorSummary.active_categories) && operatorSummary.active_categories.length > 0) {
    parts.push(`categories: ${operatorSummary.active_categories.join(', ')}`);
  }

  if (typeof operatorSummary.highest_active_authority_level === 'number') {
    const roleLabel = operatorSummary.highest_active_authority_role
      ? ` (${operatorSummary.highest_active_authority_role})`
      : '';
    parts.push(`highest authority: ${operatorSummary.highest_active_authority_level}${roleLabel}`);
  }

  if (operatorSummary.superseding_active_count > 0) {
    parts.push(pluralizeRepoDecisionCount(
      operatorSummary.superseding_active_count,
      'active superseding earlier decision',
      'active superseding earlier decisions',
    ));
  }

  if (operatorSummary.overridden_with_successor_count > 0) {
    parts.push(pluralizeRepoDecisionCount(
      operatorSummary.overridden_with_successor_count,
      'overridden with recorded successor',
      'overridden with recorded successors',
    ));
  }

  return parts.join('; ');
}

function pluralizeRepoDecisionCount(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function filterDispatchProgressForActiveTurns(progressByTurn, activeTurns) {
  const filtered = {};
  if (!progressByTurn || typeof progressByTurn !== 'object') {
    return filtered;
  }
  for (const turn of Object.values(activeTurns || {})) {
    const turnId = turn?.turn_id;
    if (turnId && progressByTurn[turnId]) {
      filtered[turnId] = progressByTurn[turnId];
    }
  }
  return filtered;
}

function formatDispatchActivityLine(progress) {
  if (!progress || typeof progress !== 'object') return null;
  const lastAct = progress.last_activity_at ? new Date(progress.last_activity_at) : null;
  const agoSec = lastAct && !Number.isNaN(lastAct.getTime())
    ? Math.round((Date.now() - lastAct.getTime()) / 1000)
    : null;

  if (progress.activity_type === 'silent') {
    const silentAt = progress.silent_since ? new Date(progress.silent_since) : null;
    const silentSec = silentAt && !Number.isNaN(silentAt.getTime())
      ? Math.round((Date.now() - silentAt.getTime()) / 1000)
      : agoSec;
    return chalk.yellow(`Silent for ${silentSec}s`) +
      ` (${progress.output_lines || 0} lines total, last output ${agoSec ?? 0}s ago)`;
  }
  if (progress.activity_type === 'request') {
    return chalk.cyan('API request in flight') + ` (${agoSec ?? 0}s ago)`;
  }
  if (progress.activity_type === 'response') {
    return chalk.green('API response received');
  }
  const agoLabel = agoSec != null && agoSec > 0 ? `, last ${agoSec}s ago` : '';
  return chalk.green('Producing output') + ` (${progress.output_lines || 0} lines${agoLabel})`;
}

function renderLastGateFailure(failure, config) {
  const entryRole = config?.routing?.[failure.phase]?.entry_role || null;
  const suggestedCommand = entryRole ? `agentxchain step --role ${entryRole}` : 'agentxchain step --role <role>';
  const requestLabel = failure.gate_type === 'run_completion'
    ? 'Run completion'
    : `${failure.from_phase || failure.phase} -> ${failure.to_phase || 'unknown'}`;

  console.log('');
  console.log(`  ${chalk.dim('Gate fail:')} ${chalk.red.bold(failure.gate_type === 'run_completion' ? 'RUN COMPLETION' : 'PHASE TRANSITION')}`);
  console.log(`  ${chalk.dim('Gate:')}     ${failure.gate_id || 'unknown'}`);
  console.log(`  ${chalk.dim('Request:')}  ${requestLabel}`);
  console.log(`  ${chalk.dim('Source:')}   ${failure.queued_request ? 'queued drain request' : 'direct request'}`);
  console.log(`  ${chalk.dim('When:')}     ${failure.failed_at || 'unknown'}`);
  if (failure.requested_by_turn) {
    console.log(`  ${chalk.dim('Turn:')}     ${failure.requested_by_turn}`);
  }
  if (Array.isArray(failure.reasons) && failure.reasons.length > 0) {
    console.log(`  ${chalk.dim('Reasons:')}`);
    for (const reason of failure.reasons) {
      console.log(`    ${chalk.red('•')} ${reason}`);
    }
  }
  console.log(`  ${chalk.dim('Action:')}   ${chalk.cyan(suggestedCommand)} to keep working in ${failure.phase}`);
}

function formatPhase(phase) {
  const colors = { discovery: chalk.blue, build: chalk.green, qa: chalk.yellow, deploy: chalk.magenta, blocked: chalk.red };
  return (colors[phase] || chalk.white)(phase);
}

function formatGovernedPhase(phase) {
  const colors = { planning: chalk.blue, implementation: chalk.green, qa: chalk.yellow, paused: chalk.magenta, failed: chalk.red };
  return (colors[phase] || chalk.white)(phase);
}

function formatRunStatus(status) {
  if (status === 'blocked') return chalk.red.bold('BLOCKED');
  if (status === 'paused') return chalk.yellow.bold('PAUSED');
  if (status === 'completed') return chalk.green.bold('COMPLETED');
  if (status === 'active') return chalk.cyan('active');
  if (status === 'idle') return chalk.dim('idle');
  return status || chalk.dim('unknown');
}

function timeSince(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '0s';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function formatUsd(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '0.00';
  return value.toFixed(2);
}
