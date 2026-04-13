/**
 * Governed state writers — the accept/reject turn cycle.
 *
 * These are library primitives, not CLI commands. They implement the
 * orchestrator-owned write path from the frozen spec (§39):
 *
 *   - initializeGovernedRun()  — create a run envelope from idle state
 *   - assignGovernedTurn()     — assign a turn to a role
 *   - acceptGovernedTurn()     — validate staged result, promote to accepted state
 *   - rejectGovernedTurn()     — preserve rejected artifact, increment retry or escalate
 *
 * Design rules:
 *   - Only these functions may mutate state.json, history.jsonl, decision-ledger.jsonl
 *   - Accept does NOT auto-assign the next turn (§39.1)
 *   - Reject does NOT append to history or decision ledger (§39.2)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync, readdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { randomBytes, createHash } from 'crypto';
import { safeWriteJson } from './safe-write.js';
import { validateStagedTurnResult } from './turn-result-validator.js';
import { evaluatePhaseExit, evaluateRunCompletion, getNextPhase } from './gate-evaluator.js';
import { evaluateApprovalPolicy } from './approval-policy.js';
import { evaluatePolicies } from './policy-evaluator.js';
import { buildTimeoutBlockedReason, evaluateTimeouts } from './timeout-evaluator.js';
import {
  captureBaseline,
  observeChanges,
  attributeObservedChangesToTurn,
  buildConflictCandidateFiles,
  classifyObservedChanges,
  buildObservedArtifact,
  normalizeVerification,
  compareDeclaredVsObserved,
  deriveAcceptedRef,
  checkCleanBaseline,
} from './repo-observer.js';
import { getMaxConcurrentTurns } from './normalized-config.js';
import { getTurnStagingResultPath, getTurnStagingDir, getDispatchTurnDir, getReviewArtifactPath } from './turn-paths.js';
import { runHooks } from './hook-runner.js';
import { emitNotifications } from './notification-runner.js';
import { emitRunEvent } from './run-events.js';
import { writeSessionCheckpoint } from './session-checkpoint.js';
import { recordRunHistory } from './run-history.js';
import { buildDefaultRunProvenance } from './run-provenance.js';
import {
  replayVerificationMachineEvidence,
  summarizeVerificationReplay,
} from './verification-replay.js';

// ── Constants ────────────────────────────────────────────────────────────────

const STATE_PATH = '.agentxchain/state.json';
const HISTORY_PATH = '.agentxchain/history.jsonl';
const LEDGER_PATH = '.agentxchain/decision-ledger.jsonl';
const STAGING_PATH = '.agentxchain/staging/turn-result.json';
const TALK_PATH = 'TALK.md';
const ACCEPTANCE_LOCK_PATH = '.agentxchain/locks/accept-turn.lock';
const ACCEPTANCE_JOURNAL_DIR = '.agentxchain/transactions/accept';
const STALE_LOCK_TIMEOUT_MS = 30_000;
const GOVERNED_SCHEMA_VERSION = '1.1';

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateId(prefix) {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

function getInitialPhase(config) {
  return Object.keys(config?.routing || {})[0] || 'planning';
}

function buildInitialPhaseGateStatus(config) {
  return Object.fromEntries(
    [...new Set(
      Object.values(config?.routing || {})
        .map((route) => route?.exit_gate)
        .filter(Boolean)
    )].map((gateId) => [gateId, 'pending'])
  );
}

function buildFreshIdleStateForNewRun(state, config) {
  return {
    schema_version: state?.schema_version || GOVERNED_SCHEMA_VERSION,
    run_id: null,
    project_id: state?.project_id || config?.project?.id || null,
    status: 'idle',
    phase: getInitialPhase(config),
    accepted_integration_ref: null,
    active_turns: {},
    turn_sequence: 0,
    last_completed_turn_id: null,
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
    pending_phase_transition: null,
    pending_run_completion: null,
    queued_phase_transition: null,
    queued_run_completion: null,
    last_gate_failure: null,
    phase_gate_status: buildInitialPhaseGateStatus(config),
    budget_reservations: {},
    budget_status: {
      spent_usd: 0,
      remaining_usd: config?.budget?.per_run_max_usd ?? null,
    },
  };
}

function normalizeGateFailure(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return {
    gate_type: value.gate_type === 'run_completion' ? 'run_completion' : 'phase_transition',
    gate_id: typeof value.gate_id === 'string' && value.gate_id.length > 0 ? value.gate_id : null,
    phase: typeof value.phase === 'string' && value.phase.length > 0 ? value.phase : 'unknown',
    from_phase: typeof value.from_phase === 'string' && value.from_phase.length > 0 ? value.from_phase : null,
    to_phase: typeof value.to_phase === 'string' && value.to_phase.length > 0 ? value.to_phase : null,
    requested_by_turn: typeof value.requested_by_turn === 'string' && value.requested_by_turn.length > 0 ? value.requested_by_turn : null,
    failed_at: typeof value.failed_at === 'string' && value.failed_at.length > 0 ? value.failed_at : null,
    queued_request: value.queued_request === true,
    reasons: Array.isArray(value.reasons) ? value.reasons.filter((reason) => typeof reason === 'string' && reason.length > 0) : [],
    missing_files: Array.isArray(value.missing_files) ? value.missing_files.filter((path) => typeof path === 'string' && path.length > 0) : [],
    missing_verification: value.missing_verification === true,
  };
}

function buildGateFailureRecord({
  gateType,
  gateResult,
  phase,
  fromPhase = null,
  toPhase = null,
  requestedByTurn = null,
  failedAt,
  queuedRequest,
}) {
  return normalizeGateFailure({
    gate_type: gateType,
    gate_id: gateResult?.gate_id || null,
    phase,
    from_phase: fromPhase,
    to_phase: toPhase,
    requested_by_turn: requestedByTurn,
    failed_at: failedAt,
    queued_request: queuedRequest,
    reasons: Array.isArray(gateResult?.reasons) ? gateResult.reasons : [],
    missing_files: Array.isArray(gateResult?.missing_files) ? gateResult.missing_files : [],
    missing_verification: gateResult?.missing_verification === true,
  });
}

function emitBlockedNotification(root, config, state, details = {}, turn = null) {
  if (!config?.notifications?.webhooks?.length) {
    return;
  }

  const recovery = state?.blocked_reason?.recovery || details.recovery || null;
  emitNotifications(root, config, state, 'run_blocked', {
    category: state?.blocked_reason?.category || details.category || 'unknown_block',
    blocked_on: state?.blocked_on || details.blockedOn || null,
    typed_reason: recovery?.typed_reason || null,
    owner: recovery?.owner || null,
    recovery_action: recovery?.recovery_action || null,
    detail: recovery?.detail || null,
  }, turn);
}

function emitPendingLifecycleNotification(root, config, state, eventType, payload, turn = null) {
  if (!config?.notifications?.webhooks?.length) {
    return;
  }
  emitNotifications(root, config, state, eventType, payload, turn);
}

function normalizeDerivedReviewPath(turnResult) {
  const requestedPath = typeof turnResult?.artifact?.ref === 'string' ? turnResult.artifact.ref.trim() : '';
  if (requestedPath.startsWith('.agentxchain/reviews/')) {
    return requestedPath;
  }
  return getReviewArtifactPath(turnResult.turn_id, turnResult.role);
}

function renderDerivedReviewArtifact(turnResult, state) {
  const lines = [];
  lines.push(`# Review Artifact — ${turnResult.role}`);
  lines.push('');
  lines.push(`- **Run:** ${turnResult.run_id}`);
  lines.push(`- **Turn:** ${turnResult.turn_id}`);
  lines.push(`- **Phase:** ${state.phase}`);
  lines.push(`- **Status:** ${turnResult.status}`);
  lines.push(`- **Proposed next role:** ${turnResult.proposed_next_role || 'human'}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(turnResult.summary || 'No summary provided.');
  lines.push('');
  lines.push('## Decisions');
  lines.push('');
  if (Array.isArray(turnResult.decisions) && turnResult.decisions.length > 0) {
    for (const decision of turnResult.decisions) {
      lines.push(`- **${decision.id}** (${decision.category}): ${decision.statement}`);
      if (decision.rationale) {
        lines.push(`  - Rationale: ${decision.rationale}`);
      }
    }
  } else {
    lines.push('- None.');
  }
  lines.push('');
  lines.push('## Objections');
  lines.push('');
  if (Array.isArray(turnResult.objections) && turnResult.objections.length > 0) {
    for (const objection of turnResult.objections) {
      lines.push(`- **${objection.id}** (${objection.severity}): ${objection.statement}`);
      if (objection.status) {
        lines.push(`  - Status: ${objection.status}`);
      }
    }
  } else {
    lines.push('- None.');
  }
  lines.push('');
  lines.push('## Verification');
  lines.push('');
  lines.push(`- **Status:** ${turnResult.verification?.status || 'skipped'}`);
  if (turnResult.verification?.evidence_summary) {
    lines.push(`- **Summary:** ${turnResult.verification.evidence_summary}`);
  }
  if (turnResult.needs_human_reason) {
    lines.push(`- **Needs human reason:** ${turnResult.needs_human_reason}`);
  }
  lines.push('');
  return lines.join('\n') + '\n';
}

function materializeDerivedReviewArtifact(root, turnResult, state, runtimeType, baseline = null) {
  if (
    turnResult?.artifact?.type !== 'review'
    || (runtimeType !== 'api_proxy' && runtimeType !== 'remote_agent')
  ) {
    return null;
  }

  const reviewPath = normalizeDerivedReviewPath(turnResult);
  const absReviewPath = join(root, reviewPath);
  mkdirSync(dirname(absReviewPath), { recursive: true });

  if (!existsSync(absReviewPath)) {
    writeFileSync(absReviewPath, renderDerivedReviewArtifact(turnResult, state));
  }

  turnResult.artifact = { ...(turnResult.artifact || {}), ref: reviewPath };
  return reviewPath;
}

function materializeDerivedProposalArtifact(root, turnResult, state, runtimeType) {
  if (
    turnResult?.artifact?.type !== 'patch'
    || (runtimeType !== 'api_proxy' && runtimeType !== 'remote_agent')
  ) {
    return null;
  }
  if (!Array.isArray(turnResult.proposed_changes) || turnResult.proposed_changes.length === 0) {
    return null;
  }

  const proposalDir = `.agentxchain/proposed/${turnResult.turn_id}`;
  const absProposalDir = join(root, proposalDir);
  mkdirSync(absProposalDir, { recursive: true });

  // Write PROPOSAL.md summary
  const summaryLines = [
    `# Proposed Changes — ${turnResult.turn_id}`,
    '',
    `**Role:** ${turnResult.role}`,
    `**Runtime:** ${turnResult.runtime_id}`,
    `**Status:** ${turnResult.status}`,
    '',
    `## Summary`,
    '',
    turnResult.summary || '(no summary)',
    '',
    `## Files`,
    '',
  ];
  for (const change of turnResult.proposed_changes) {
    summaryLines.push(`- \`${change.path}\` — ${change.action}`);
  }
  if (turnResult.decisions?.length > 0) {
    summaryLines.push('', '## Decisions', '');
    for (const dec of turnResult.decisions) {
      summaryLines.push(`- **${dec.id}** (${dec.category}): ${dec.statement}`);
    }
  }
  summaryLines.push('');
  writeFileSync(join(absProposalDir, 'PROPOSAL.md'), summaryLines.join('\n'));
  writeFileSync(
    join(absProposalDir, 'SOURCE_SNAPSHOT.json'),
    JSON.stringify(captureProposalSourceSnapshot(root, turnResult.proposed_changes), null, 2) + '\n',
  );

  // Materialize each proposed file (create/modify only; delete just listed)
  for (const change of turnResult.proposed_changes) {
    if (change.action === 'delete') continue;
    if (typeof change.content !== 'string') continue;
    const absFilePath = join(absProposalDir, change.path);
    mkdirSync(dirname(absFilePath), { recursive: true });
    writeFileSync(absFilePath, change.content);
  }

  turnResult.artifact = { ...(turnResult.artifact || {}), ref: proposalDir };
  return proposalDir;
}

function captureProposalSourceSnapshot(root, proposedChanges) {
  return {
    captured_at: new Date().toISOString(),
    files: proposedChanges.map((change) => {
      const absFilePath = join(root, change.path);
      if (!existsSync(absFilePath)) {
        return {
          path: change.path,
          action: change.action,
          existed: false,
          sha256: null,
        };
      }

      const content = readFileSync(absFilePath);
      return {
        path: change.path,
        action: change.action,
        existed: true,
        sha256: `sha256:${createHash('sha256').update(content).digest('hex')}`,
      };
    }),
  };
}

function normalizeActiveTurns(activeTurns) {
  if (!activeTurns || typeof activeTurns !== 'object' || Array.isArray(activeTurns)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(activeTurns).filter(([, turn]) => turn && typeof turn === 'object' && !Array.isArray(turn)),
  );
}

function stripLegacyCurrentTurn(state) {
  if (!state || typeof state !== 'object') {
    return state;
  }

  const { current_turn, ...rest } = state;
  return {
    ...rest,
    active_turns: normalizeActiveTurns(rest.active_turns),
  };
}

export function getActiveTurns(state) {
  return normalizeActiveTurns(state?.active_turns);
}

export function getActiveTurnCount(state) {
  return Object.keys(getActiveTurns(state)).length;
}

export function getActiveTurn(state) {
  const turns = Object.values(getActiveTurns(state));
  return turns.length === 1 ? turns[0] : null;
}

function resolveRecoveryTurnId(state, preferredTurnId = null) {
  const activeTurns = getActiveTurns(state);
  if (preferredTurnId && activeTurns[preferredTurnId]) {
    return preferredTurnId;
  }

  const blockedTurnId = state?.blocked_reason?.turn_id;
  if (blockedTurnId && activeTurns[blockedTurnId]) {
    return blockedTurnId;
  }

  const escalationTurnId = state?.escalation?.from_turn_id;
  if (escalationTurnId && activeTurns[escalationTurnId]) {
    return escalationTurnId;
  }

  const turnIds = Object.keys(activeTurns);
  return turnIds.length === 1 ? turnIds[0] : null;
}

export function deriveRetainedTurnRecoveryCommand(state, config, options = {}) {
  const turnId = resolveRecoveryTurnId(state, options.turnId);
  if (!turnId) {
    return options.fallbackCommand || 'agentxchain step --resume';
  }

  const turn = getActiveTurns(state)[turnId];
  const runtimeType = config?.runtimes?.[turn?.runtime_id]?.type || 'manual';
  let command = runtimeType === 'manual'
    ? (options.manualCommand || 'agentxchain resume')
    : (options.automatedCommand || 'agentxchain step --resume');

  if (getActiveTurnCount(state) > 1) {
    command += ` --turn ${turnId}`;
  }

  return command;
}

export function deriveBlockedRecoveryCommand(state, config, options = {}) {
  const turnRetained = typeof options.turnRetained === 'boolean'
    ? options.turnRetained
    : getActiveTurnCount(state) > 0;
  if (!turnRetained) {
    return options.clearedCommand || 'agentxchain resume';
  }

  return deriveRetainedTurnRecoveryCommand(state, config, {
    turnId: options.turnId,
    fallbackCommand: options.fallbackCommand || 'agentxchain step --resume',
    manualCommand: options.manualCommand || 'agentxchain resume',
    automatedCommand: options.automatedCommand || 'agentxchain step --resume',
  });
}

export function deriveNeedsHumanRecoveryAction(state, config, options = {}) {
  const command = deriveBlockedRecoveryCommand(state, config, {
    turnRetained: options.turnRetained,
    turnId: options.turnId,
  });
  return `Resolve the stated issue, then run ${command}`;
}

export function deriveDispatchRecoveryAction(state, config, options = {}) {
  const command = deriveBlockedRecoveryCommand(state, config, {
    turnRetained: options.turnRetained,
    turnId: options.turnId,
  });
  return `Resolve the dispatch issue, then run ${command}`;
}

function normalizePolicyId(policyId) {
  if (typeof policyId !== 'string') {
    return null;
  }
  const trimmed = policyId.trim();
  return trimmed || null;
}

function getPolicyIdFromBlockedState(state) {
  if (typeof state?.blocked_on !== 'string' || !state.blocked_on.startsWith('policy:')) {
    return null;
  }
  return normalizePolicyId(state.blocked_on.slice('policy:'.length));
}

export function derivePolicyEscalationDetail(state, options = {}) {
  if (typeof options.detail === 'string' && options.detail.trim()) {
    return options.detail.trim();
  }

  if (typeof state?.blocked_reason === 'string' && state.blocked_reason.trim()) {
    return state.blocked_reason.trim();
  }

  const policyId = normalizePolicyId(options.policyId) || getPolicyIdFromBlockedState(state);
  return policyId ? `Policy "${policyId}" triggered` : (state?.blocked_on || 'Policy escalation');
}

export function derivePolicyEscalationRecoveryAction(state, config, options = {}) {
  const command = deriveBlockedRecoveryCommand(state, config, {
    turnRetained: options.turnRetained,
    turnId: options.turnId,
  });
  const policyId = normalizePolicyId(options.policyId) || getPolicyIdFromBlockedState(state);
  return policyId
    ? `Resolve policy "${policyId}" condition, then run ${command}`
    : `Resolve the policy condition, then run ${command}`;
}

export function readTurnCostUsd(turnResult) {
  if (!turnResult || typeof turnResult !== 'object') {
    return null;
  }
  if (typeof turnResult.cost?.usd === 'number') {
    return turnResult.cost.usd;
  }
  if (typeof turnResult.cost?.total_usd === 'number') {
    return turnResult.cost.total_usd;
  }
  return null;
}

export function deriveHookTamperRecoveryAction(state, config, options = {}) {
  const command = deriveBlockedRecoveryCommand(state, config, {
    turnRetained: options.turnRetained,
    turnId: options.turnId,
  });
  return `Disable or fix the hook, verify protected files, then run ${command}`;
}

export function deriveAfterDispatchHookRecoveryAction(state, config, options = {}) {
  const command = deriveBlockedRecoveryCommand(state, config, {
    turnRetained: options.turnRetained,
    turnId: options.turnId,
  });
  return `Fix or reconfigure the hook, then rerun ${command}`;
}

export function deriveConflictLoopRecoveryAction(turnId) {
  return turnId
    ? `Serialize the conflicting work, then run agentxchain reject-turn --turn ${turnId} --reassign`
    : 'Serialize the conflicting work, then run agentxchain reject-turn --reassign';
}

function isLegacyEscalationRecoveryAction(action) {
  return action === 'Resolve the escalation, then run agentxchain step --resume'
    || action === 'Resolve the escalation, then run agentxchain step';
}

export function deriveEscalationRecoveryAction(state, config, options = {}) {
  if (typeof options.overrideAction === 'string' && options.overrideAction.trim()) {
    return options.overrideAction.trim();
  }

  const turnRetained = typeof options.turnRetained === 'boolean'
    ? options.turnRetained
    : getActiveTurnCount(state) > 0;
  const command = turnRetained
    ? deriveRetainedTurnRecoveryCommand(state, config, {
      turnId: options.turnId,
      fallbackCommand: 'agentxchain step --resume',
    })
    : 'agentxchain resume';

  return `Resolve the escalation, then run ${command}`;
}

export function getActiveTurnOrThrow(state) {
  const turns = Object.values(getActiveTurns(state));
  if (turns.length === 0) {
    throw new Error('No active turn is available in governed state.');
  }
  if (turns.length > 1) {
    throw new Error('Multiple active turns are present; this command requires explicit turn targeting.');
  }
  return turns[0];
}

function attachLegacyCurrentTurnAlias(state) {
  if (!state || typeof state !== 'object') {
    return state;
  }

  const existing = Object.getOwnPropertyDescriptor(state, 'current_turn');
  if (existing && existing.enumerable === false) {
    return state;
  }

  Object.defineProperty(state, 'current_turn', {
    configurable: true,
    enumerable: false,
    get() {
      return getActiveTurn(state);
    },
  });

  return state;
}

function formatBudgetRecoveryAction(isReadyToResume) {
  return isReadyToResume
    ? 'Run agentxchain resume to assign the next turn'
    : 'Increase budget with agentxchain config --set budget.per_run_max_usd <usd>, then run agentxchain resume';
}

function formatBudgetRecoveryDetail(spentUsd, limitUsd, remainingUsd, isReadyToResume) {
  if (limitUsd == null) {
    return isReadyToResume
      ? `Budget recovery ready: spent $${spentUsd.toFixed(2)} with per_run_max_usd disabled`
      : `Run budget exhausted: spent $${spentUsd.toFixed(2)} with no configured per_run_max_usd limit`;
  }

  if (isReadyToResume) {
    return `Budget recovery ready: spent $${spentUsd.toFixed(2)} of $${limitUsd.toFixed(2)} limit ($${remainingUsd.toFixed(2)} remaining)`;
  }

  return `Run budget exhausted: spent $${spentUsd.toFixed(2)} of $${limitUsd.toFixed(2)} limit ($${Math.abs(remainingUsd).toFixed(2)} over)`;
}

export function reconcileBudgetStatusWithConfig(state, config) {
  if (!state || typeof state !== 'object') {
    return { state, changed: false };
  }

  const baseState = stripLegacyCurrentTurn(state);
  const budgetStatus = baseState.budget_status && typeof baseState.budget_status === 'object' && !Array.isArray(baseState.budget_status)
    ? baseState.budget_status
    : {};
  const spentUsd = Number.isFinite(budgetStatus.spent_usd) ? budgetStatus.spent_usd : 0;
  const limitUsd = Number.isFinite(config?.budget?.per_run_max_usd) ? config.budget.per_run_max_usd : null;
  const remainingUsd = limitUsd != null ? limitUsd - spentUsd : null;
  const nextBudgetStatus = {
    ...budgetStatus,
    spent_usd: spentUsd,
    remaining_usd: remainingUsd,
  };

  if (remainingUsd != null && remainingUsd <= 0) {
    nextBudgetStatus.exhausted = true;
    if (budgetStatus.exhausted_at) {
      nextBudgetStatus.exhausted_at = budgetStatus.exhausted_at;
    }
    if (budgetStatus.exhausted_after_turn) {
      nextBudgetStatus.exhausted_after_turn = budgetStatus.exhausted_after_turn;
    }
  } else {
    delete nextBudgetStatus.exhausted;
    delete nextBudgetStatus.exhausted_at;
    delete nextBudgetStatus.exhausted_after_turn;
  }

  let nextState = {
    ...baseState,
    budget_status: nextBudgetStatus,
  };

  const isBudgetBlocked = nextState.blocked_on === 'budget:exhausted' || nextState.blocked_reason?.category === 'budget_exhausted';
  if (isBudgetBlocked) {
    const isReadyToResume = remainingUsd == null || remainingUsd > 0;
    nextState = {
      ...nextState,
      blocked_on: 'budget:exhausted',
      blocked_reason: buildBlockedReason({
        category: 'budget_exhausted',
        recovery: {
          typed_reason: 'budget_exhausted',
          owner: 'human',
          recovery_action: formatBudgetRecoveryAction(isReadyToResume),
          turn_retained: false,
          detail: formatBudgetRecoveryDetail(spentUsd, limitUsd, remainingUsd, isReadyToResume),
        },
        turnId: nextState.blocked_reason?.turn_id ?? nextState.last_completed_turn_id ?? null,
        blockedAt: nextState.blocked_reason?.blocked_at,
      }),
    };
  }

  const changed = JSON.stringify(baseState) !== JSON.stringify(nextState);
  return {
    state: changed ? nextState : baseState,
    changed,
  };
}

function normalizeV1toV1_1(state) {
  const hadLegacyCurrentTurn = Object.prototype.hasOwnProperty.call(state, 'current_turn');
  const activeTurns = normalizeActiveTurns(state.active_turns);
  const legacyTurn = hadLegacyCurrentTurn ? state.current_turn : null;

  if (legacyTurn && typeof legacyTurn === 'object' && legacyTurn.turn_id && !activeTurns[legacyTurn.turn_id]) {
    activeTurns[legacyTurn.turn_id] = {
      ...legacyTurn,
      assigned_sequence: 1,
    };
  }

  let turnSequence = Number.isInteger(state.turn_sequence) && state.turn_sequence >= 0
    ? state.turn_sequence
    : Object.keys(activeTurns).length > 0 ? 1 : 0;

  if (Object.keys(activeTurns).length > 0 && turnSequence < 1) {
    turnSequence = 1;
  }

  const normalizedActiveTurns = Object.fromEntries(
    Object.entries(activeTurns).map(([turnId, turn]) => [
      turnId,
      {
        ...turn,
        assigned_sequence: Number.isInteger(turn.assigned_sequence) && turn.assigned_sequence >= 1
          ? turn.assigned_sequence
          : 1,
      },
    ]),
  );

  return {
    ...state,
    schema_version: GOVERNED_SCHEMA_VERSION,
    active_turns: normalizedActiveTurns,
    turn_sequence: turnSequence,
    budget_reservations:
      state.budget_reservations && typeof state.budget_reservations === 'object' && !Array.isArray(state.budget_reservations)
        ? state.budget_reservations
        : {},
    queued_phase_transition: state.queued_phase_transition ?? null,
    queued_run_completion: state.queued_run_completion ?? null,
    last_gate_failure: normalizeGateFailure(state.last_gate_failure),
  };
}

function readState(root) {
  const filePath = join(root, STATE_PATH);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    const { state, changed } = normalizeGovernedStateShape(parsed);
    if (changed) {
      safeWriteJson(filePath, stripLegacyCurrentTurn(state));
    }
    return attachLegacyCurrentTurnAlias(state);
  } catch {
    return null;
  }
}

function writeState(root, state) {
  safeWriteJson(join(root, STATE_PATH), stripLegacyCurrentTurn(state));
}

function appendJsonl(root, relPath, entry) {
  const filePath = join(root, relPath);
  mkdirSync(dirname(filePath), { recursive: true });
  const line = JSON.stringify(entry) + '\n';
  writeFileSync(filePath, line, { flag: 'a' });
}

function appendTalk(root, section) {
  const filePath = join(root, TALK_PATH);
  let existing = '';
  if (existsSync(filePath)) {
    existing = readFileSync(filePath, 'utf8');
  }
  const prefix = existing.endsWith('\n') || existing === '' ? '' : '\n';
  writeFileSync(filePath, existing + prefix + section + '\n');
}

function loadHookStagedTurn(root, stagingRel) {
  const stagingAbs = join(root, stagingRel);
  if (!existsSync(stagingAbs)) {
    return { turnResult: null };
  }

  let raw;
  try {
    raw = readFileSync(stagingAbs, 'utf8');
  } catch (err) {
    return { turnResult: null, read_error: err.message };
  }

  try {
    return { turnResult: JSON.parse(raw) };
  } catch (err) {
    return { turnResult: null, parse_error: err.message };
  }
}

function readJsonlEntries(root, relPath) {
  const filePath = join(root, relPath);
  if (!existsSync(filePath)) {
    return [];
  }

  const content = readFileSync(filePath, 'utf8').trim();
  if (!content) {
    return [];
  }

  return content
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      try {
        const entry = JSON.parse(line);
        const acceptedSequence = Number.isInteger(entry.accepted_sequence) && entry.accepted_sequence >= 1
          ? entry.accepted_sequence
          : index + 1;
        return {
          ...entry,
          accepted_sequence: acceptedSequence,
          assigned_sequence: Number.isInteger(entry.assigned_sequence) && entry.assigned_sequence >= 1
            ? entry.assigned_sequence
            : acceptedSequence,
          concurrent_with: Array.isArray(entry.concurrent_with) ? entry.concurrent_with : [],
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function getObservedFiles(entry) {
  if (Array.isArray(entry?.observed_artifact?.files_changed)) {
    return entry.observed_artifact.files_changed;
  }
  if (Array.isArray(entry?.files_changed)) {
    return entry.files_changed;
  }
  return [];
}

function resolveTurnTarget(state, turnId) {
  const activeTurns = getActiveTurns(state);

  if (turnId) {
    const turn = activeTurns[turnId];
    if (!turn) {
      return { ok: false, error: `No active turn found for --turn ${turnId}`, error_code: 'not_found' };
    }
    return { ok: true, turn };
  }

  const activeEntries = Object.values(activeTurns);
  if (activeEntries.length === 0) {
    return { ok: false, error: 'No active turn to accept', error_code: 'not_found' };
  }
  if (activeEntries.length > 1) {
    return {
      ok: false,
      error: 'Multiple active turns are present. Re-run with --turn <turn_id>.',
      error_code: 'target_required',
    };
  }

  return { ok: true, turn: activeEntries[0] };
}

// ── Acceptance Lock ─────────────────────────────────────────────────────────

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireAcceptanceLock(root) {
  const lockPath = join(root, ACCEPTANCE_LOCK_PATH);
  mkdirSync(dirname(lockPath), { recursive: true });

  if (existsSync(lockPath)) {
    try {
      const existing = JSON.parse(readFileSync(lockPath, 'utf8'));
      const acquiredAt = new Date(existing.acquired_at).getTime();
      const elapsed = Date.now() - acquiredAt;
      const ownerAlive = existing.owner_pid && isProcessRunning(existing.owner_pid);

      if (ownerAlive && elapsed < STALE_LOCK_TIMEOUT_MS) {
        return { ok: false, error: `Acceptance lock held by PID ${existing.owner_pid}`, error_code: 'lock_timeout' };
      }
      // Stale lock — reclaim it
    } catch {
      // Corrupt lock file — reclaim it
    }
  }

  const lock = {
    owner_pid: process.pid,
    acquired_at: new Date().toISOString(),
  };
  writeFileSync(lockPath, JSON.stringify(lock, null, 2));
  return { ok: true };
}

export function releaseAcceptanceLock(root) {
  const lockPath = join(root, ACCEPTANCE_LOCK_PATH);
  try {
    if (existsSync(lockPath)) {
      const existing = JSON.parse(readFileSync(lockPath, 'utf8'));
      if (existing.owner_pid === process.pid) {
        unlinkSync(lockPath);
      }
    }
  } catch {
    // Best-effort cleanup
  }
}

// ── Acceptance Transaction Journal ──────────────────────────────────────────

function writeAcceptanceJournal(root, journal) {
  const journalDir = join(root, ACCEPTANCE_JOURNAL_DIR);
  mkdirSync(journalDir, { recursive: true });
  const journalPath = join(journalDir, `${journal.transaction_id}.json`);
  safeWriteJson(journalPath, journal);
  return journalPath;
}

function commitAcceptanceJournal(root, transactionId) {
  const journalPath = join(root, ACCEPTANCE_JOURNAL_DIR, `${transactionId}.json`);
  try {
    if (existsSync(journalPath)) {
      unlinkSync(journalPath);
    }
  } catch {
    // Best-effort
  }
}

export function replayPreparedJournals(root) {
  const journalDir = join(root, ACCEPTANCE_JOURNAL_DIR);
  if (!existsSync(journalDir)) return [];

  const replayed = [];
  let files;
  try {
    files = readdirSync(journalDir).filter(f => f.endsWith('.json'));
  } catch {
    return [];
  }

  for (const file of files) {
    const journalPath = join(journalDir, file);
    let journal;
    try {
      journal = JSON.parse(readFileSync(journalPath, 'utf8'));
    } catch {
      continue;
    }

    if (journal.status !== 'prepared') continue;

    const state = readState(root);
    if (!state) continue;

    const activeTurns = getActiveTurns(state);
    const turnAlreadyRemoved = !activeTurns[journal.turn_id];
    const sequenceAlreadyApplied = (state.turn_sequence || 0) >= journal.accepted_sequence;

    if (turnAlreadyRemoved && sequenceAlreadyApplied) {
      // State commit succeeded but cleanup may be incomplete — finish cleanup
      cleanupTurnArtifacts(root, journal.turn_id);
      commitAcceptanceJournal(root, journal.transaction_id);
      replayed.push({ transaction_id: journal.transaction_id, action: 'cleanup_only' });
    } else {
      // State commit did not complete — replay from journal
      if (journal.history_entry) {
        appendJsonl(root, HISTORY_PATH, journal.history_entry);
      }
      if (journal.ledger_entries) {
        for (const entry of journal.ledger_entries) {
          appendJsonl(root, LEDGER_PATH, entry);
        }
      }
      if (journal.next_state) {
        writeState(root, journal.next_state);
      }
      cleanupTurnArtifacts(root, journal.turn_id);
      commitAcceptanceJournal(root, journal.transaction_id);
      replayed.push({ transaction_id: journal.transaction_id, action: 'full_replay' });
    }
  }
  return replayed;
}

function cleanupTurnArtifacts(root, turnId) {
  const stagingDir = join(root, getTurnStagingDir(turnId));
  const dispatchDir = join(root, getDispatchTurnDir(turnId));

  try {
    if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true });
  } catch { /* best-effort */ }
  try {
    if (existsSync(dispatchDir)) rmSync(dispatchDir, { recursive: true });
  } catch { /* best-effort */ }
}

function detectAcceptanceConflict(targetTurn, conflictFiles, historyEntries) {
  const observedFiles = [...new Set(Array.isArray(conflictFiles) ? conflictFiles : [])];
  if (observedFiles.length === 0) {
    return null;
  }

  const observedFileSet = new Set(observedFiles);
  const acceptedSince = [];
  const conflictingFiles = new Set();

  for (const entry of historyEntries) {
    if ((entry.accepted_sequence || 0) <= (targetTurn.assigned_sequence || 0)) {
      continue;
    }

    const overlap = [...new Set(getObservedFiles(entry).filter(file => observedFileSet.has(file)))];
    if (overlap.length === 0) {
      continue;
    }

    overlap.forEach(file => conflictingFiles.add(file));
    acceptedSince.push({
      turn_id: entry.turn_id,
      role: entry.role,
      accepted_sequence: entry.accepted_sequence,
      files_changed: overlap,
    });
  }

  if (acceptedSince.length === 0) {
    return null;
  }

  const conflicting = [...conflictingFiles];
  const overlapRatio = observedFiles.length > 0 ? conflicting.length / observedFiles.length : 0;

  return {
    type: 'file_conflict',
    conflicting_turn: {
      turn_id: targetTurn.turn_id,
      role: targetTurn.assigned_role,
      attempt: targetTurn.attempt,
      files_changed: observedFiles,
    },
    accepted_since: acceptedSince,
    conflicting_files: conflicting,
    non_conflicting_files: observedFiles.filter(file => !conflictingFiles.has(file)),
    overlap_ratio: overlapRatio,
    suggested_resolution: overlapRatio < 0.5 ? 'reject_and_reassign' : 'human_merge',
  };
}

function buildConflictContext(turn) {
  const conflictError = turn?.conflict_state?.conflict_error;
  if (!conflictError) {
    return null;
  }

  const acceptedTurnsSince = Array.isArray(conflictError.accepted_since)
    ? conflictError.accepted_since.map((entry) => ({
        turn_id: entry.turn_id,
        role: entry.role,
        files_changed: Array.isArray(entry.files_changed) ? entry.files_changed : [],
      }))
    : [];

  return {
    prior_attempt_turn_id: turn.turn_id,
    prior_attempt_number: turn.attempt,
    conflict_type: conflictError.type || 'file_conflict',
    conflicting_files: Array.isArray(conflictError.conflicting_files) ? conflictError.conflicting_files : [],
    accepted_turns_since: acceptedTurnsSince,
    non_conflicting_files_preserved: Array.isArray(conflictError.non_conflicting_files)
      ? conflictError.non_conflicting_files
      : [],
    guidance: 'Rebase the rejected work on top of the current workspace state and preserve non-conflicting changes.',
  };
}

function buildConflictDetail(conflict) {
  if (!conflict?.conflicting_files?.length) {
    return 'Resolve the retained file conflict, then resume the turn.';
  }
  return `Conflicting files: ${conflict.conflicting_files.join(', ')}`;
}

function hasBlockingActiveTurn(activeTurns) {
  return Object.values(activeTurns || {}).some((turn) => turn?.status === 'failed' || turn?.status === 'conflicted');
}

function findHistoryTurnRequest(historyEntries, turnId, kind) {
  if (!turnId) {
    return null;
  }

  const entry = [...historyEntries].reverse().find(item => item.turn_id === turnId);
  if (!entry) {
    return null;
  }

  if (kind === 'run_completion') {
    return { ...entry, run_completion_request: true };
  }

  if (kind === 'phase_transition') {
    return { ...entry, phase_transition_request: entry.phase_transition_request || null };
  }

  return entry;
}

function buildBlockedReason({ category, recovery, turnId, blockedAt = new Date().toISOString() }) {
  return {
    category,
    recovery,
    blocked_at: blockedAt,
    turn_id: turnId ?? null,
  };
}

function buildTimeoutLedgerEntry(timeoutResult, timestamp, turnId, phase, type = 'timeout') {
  return {
    type,
    scope: timeoutResult.scope,
    phase: timeoutResult.phase || phase || null,
    turn_id: turnId || null,
    limit_minutes: timeoutResult.limit_minutes,
    elapsed_minutes: timeoutResult.elapsed_minutes,
    exceeded_by_minutes: timeoutResult.exceeded_by_minutes,
    action: timeoutResult.action,
    timestamp,
  };
}

function attemptTimeoutPhaseSkip({ root, config, updatedState, nextHistoryEntries, historyEntry, timeoutResult, now }) {
  const currentPhase = updatedState.phase;
  const nextPhase = getNextPhase(currentPhase, config.routing || {});
  if (!nextPhase) {
    return {
      ok: false,
      error: `Phase "${currentPhase}" has no next phase to skip to`,
    };
  }

  const syntheticTurn = {
    ...historyEntry,
    verification: historyEntry.verification || {},
    phase_transition_request: nextPhase,
  };
  const postAcceptanceState = {
    ...updatedState,
    history: nextHistoryEntries,
  };
  const gateResult = evaluatePhaseExit({
    state: postAcceptanceState,
    config,
    acceptedTurn: syntheticTurn,
    root,
  });

  if (gateResult.action === 'advance') {
    return {
      ok: true,
      gateResult,
      updatedState: {
        ...updatedState,
        phase: gateResult.next_phase,
        phase_entered_at: now,
        last_gate_failure: null,
        phase_gate_status: {
          ...(updatedState.phase_gate_status || {}),
          [gateResult.gate_id || 'no_gate']: 'passed',
        },
      },
      ledgerEntry: {
        ...buildTimeoutLedgerEntry(timeoutResult, now, historyEntry.turn_id, currentPhase, 'timeout_skip'),
        from_phase: currentPhase,
        to_phase: gateResult.next_phase,
        gate_id: gateResult.gate_id || null,
      },
    };
  }

  const reasons = gateResult.action === 'awaiting_human_approval'
    ? [`Gate "${gateResult.gate_id || 'unknown'}" still requires human approval; timeout skip cannot auto-advance`]
    : Array.isArray(gateResult.reasons) && gateResult.reasons.length > 0
      ? gateResult.reasons
      : ['Timeout skip failed for an unknown reason'];
  const gateFailure = buildGateFailureRecord({
    gateType: 'phase_transition',
    gateResult: {
      ...gateResult,
      reasons,
    },
    phase: currentPhase,
    fromPhase: currentPhase,
    toPhase: nextPhase,
    requestedByTurn: historyEntry.turn_id,
    failedAt: now,
    queuedRequest: false,
  });

  return {
    ok: false,
    gateFailure,
    ledgerEntry: {
      ...buildTimeoutLedgerEntry(timeoutResult, now, historyEntry.turn_id, currentPhase, 'timeout_skip_failed'),
      from_phase: currentPhase,
      to_phase: nextPhase,
      gate_id: gateResult.gate_id || null,
      reasons,
    },
  };
}

function slugifyEscalationReason(reason) {
  if (typeof reason !== 'string') {
    return 'operator';
  }
  const slug = reason
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'operator';
}

function isOperatorEscalationBlockedOn(blockedOn) {
  return typeof blockedOn === 'string' && blockedOn.startsWith('escalation:operator:');
}

function canApprovePendingGate(state) {
  return state?.status === 'paused' || state?.status === 'blocked';
}

function deriveHookRecovery(state, { phase, hookName, detail, errorCode, turnId, turnRetained }) {
  const isTamper = errorCode?.includes('_tamper');
  const pendingPhaseTransition = state?.pending_phase_transition;
  const pendingRunCompletion = state?.pending_run_completion;

  if (phase === 'before_gate' && pendingPhaseTransition) {
    return {
      typed_reason: isTamper ? 'hook_tamper' : 'pending_phase_transition',
      owner: 'human',
      recovery_action: isTamper
        ? 'Disable or fix the hook, verify protected files, then rerun agentxchain approve-transition'
        : 'agentxchain approve-transition',
      turn_retained: false,
      detail: pendingPhaseTransition.gate || detail || hookName || phase,
    };
  }

  if (phase === 'before_gate' && pendingRunCompletion) {
    return {
      typed_reason: isTamper ? 'hook_tamper' : 'pending_run_completion',
      owner: 'human',
      recovery_action: isTamper
        ? 'Disable or fix the hook, verify protected files, then rerun agentxchain approve-completion'
        : 'agentxchain approve-completion',
      turn_retained: false,
      detail: pendingRunCompletion.gate || detail || hookName || phase,
    };
  }

  return {
    typed_reason: isTamper ? 'hook_tamper' : 'hook_block',
    owner: 'human',
    recovery_action: isTamper
      ? deriveHookTamperRecoveryAction(state, null, { turnRetained, turnId })
      : `Fix or reconfigure hook "${hookName}", then rerun agentxchain accept-turn${turnId ? ` --turn ${turnId}` : ''}`,
    turn_retained: Boolean(turnRetained),
    detail: detail || hookName || phase,
  };
}

function blockRunForHookIssue(root, state, { phase, turnId, hookName, detail, errorCode, turnRetained, notificationConfig }) {
  const blockedAt = new Date().toISOString();
  const typedReason = errorCode?.includes('_tamper') ? 'hook_tamper' : 'hook_block';
  const recovery = deriveHookRecovery(state, {
    phase,
    hookName,
    detail,
    errorCode,
    turnId,
    turnRetained,
  });
  const blockedState = {
    ...state,
    status: 'blocked',
    blocked_on: `hook:${phase}:${hookName || 'unknown'}`,
    blocked_reason: buildBlockedReason({
      category: typedReason,
      recovery,
      turnId,
      blockedAt,
    }),
  };
  writeState(root, blockedState);

  // DEC-RHTR-SPEC: Record blocked outcome in cross-run history (non-fatal)
  if (notificationConfig) {
    recordRunHistory(root, blockedState, notificationConfig, 'blocked');
  }

  emitBlockedNotification(root, notificationConfig, blockedState, {
    category: typedReason,
    blockedOn: blockedState.blocked_on,
    recovery,
  }, turnId ? getActiveTurns(blockedState)[turnId] || null : null);
  return attachLegacyCurrentTurnAlias(blockedState);
}

/**
 * Fire on_escalation hooks (advisory-only) after blocked state is persisted.
 * These hooks are for external notification (Slack, PagerDuty, etc.).
 * They cannot block or mutate state. Failures are logged to hook-audit.jsonl only.
 *
 * IMPORTANT: Do not call this from blockRunForHookIssue() — that would create
 * a circular invocation where a hook failure triggers another hook.
 */
function _fireOnEscalationHooks(root, hooksConfig, payload) {
  try {
    const hookResult = runHooks(root, hooksConfig, 'on_escalation', payload, {
      run_id: payload.run_id,
      turn_id: payload.failed_turn_id,
    });
    // Advisory-only: result is logged in hook-audit.jsonl by runHooks().
    // We do not act on the result — on_escalation cannot block.
    return hookResult;
  } catch (err) {
    // Swallow errors — on_escalation must not prevent the blocked state from
    // being returned to the caller. The error is already in hook-audit.jsonl
    // if runHooks got far enough to write it.
    return { ok: true, results: [], swallowed_error: err.message };
  }
}

function normalizeRecoveryDescriptor(recovery, turnRetained, detail) {
  if (!recovery || typeof recovery !== 'object') {
    return null;
  }

  return {
    typed_reason: typeof recovery.typed_reason === 'string' ? recovery.typed_reason : 'unknown_block',
    owner: typeof recovery.owner === 'string' ? recovery.owner : 'human',
    recovery_action: typeof recovery.recovery_action === 'string'
      ? recovery.recovery_action
      : 'Inspect state.json and resolve manually before rerunning agentxchain step',
    turn_retained: typeof recovery.turn_retained === 'boolean' ? recovery.turn_retained : Boolean(turnRetained),
    detail: recovery.detail ?? detail ?? null,
  };
}

function isLegacyNeedsHumanRecoveryAction(action) {
  return action === 'Resolve the stated issue, then run agentxchain step --resume';
}

function isLegacyHookTamperRecoveryAction(action) {
  return action === 'Disable or fix the hook, verify protected files, then run agentxchain step --resume';
}

function isLegacyAfterDispatchHookBlockRecoveryAction(action) {
  return action === 'Fix or reconfigure the hook, then rerun agentxchain resume';
}

function isLegacyConflictLoopRecoveryAction(action) {
  return typeof action === 'string' && action.startsWith('Serialize the conflicting work, then run agentxchain step --resume');
}

export function reconcileRecoveryActionsWithConfig(state, config) {
  if (!state || typeof state !== 'object' || state.status !== 'blocked' || !config) {
    return { state, changed: false };
  }

  const recovery = state.blocked_reason?.recovery;
  const typedReason = recovery?.typed_reason;
  const currentAction = recovery?.recovery_action || null;
  const turnRetained = typeof recovery?.turn_retained === 'boolean'
    ? recovery.turn_retained
    : getActiveTurnCount(state) > 0;
  const turnId = state.blocked_reason?.turn_id ?? state.escalation?.from_turn_id ?? null;

  let shouldRefresh = false;
  let nextAction = null;

  if (typedReason === 'operator_escalation' || typedReason === 'retries_exhausted') {
    shouldRefresh = typedReason === 'retries_exhausted' || isLegacyEscalationRecoveryAction(currentAction);
    if (shouldRefresh) {
      nextAction = deriveEscalationRecoveryAction(state, config, {
        turnRetained,
        turnId,
      });
    }
  } else if (typedReason === 'needs_human') {
    shouldRefresh = isLegacyNeedsHumanRecoveryAction(currentAction);
    if (shouldRefresh) {
      nextAction = deriveNeedsHumanRecoveryAction(state, config, {
        turnRetained,
        turnId,
      });
    }
  } else if (typedReason === 'hook_tamper') {
    shouldRefresh = isLegacyHookTamperRecoveryAction(currentAction);
    if (shouldRefresh) {
      nextAction = deriveHookTamperRecoveryAction(state, config, {
        turnRetained,
        turnId,
      });
    }
  } else if (typedReason === 'hook_block') {
    shouldRefresh = isLegacyAfterDispatchHookBlockRecoveryAction(currentAction);
    if (shouldRefresh) {
      nextAction = deriveAfterDispatchHookRecoveryAction(state, config, {
        turnRetained,
        turnId,
      });
    }
  } else if (typedReason === 'policy_escalation') {
    nextAction = derivePolicyEscalationRecoveryAction(state, config, {
      turnRetained,
      turnId,
      policyId: getPolicyIdFromBlockedState(state),
    });
    shouldRefresh = currentAction !== nextAction;
  } else if (typedReason === 'conflict_loop') {
    shouldRefresh = isLegacyConflictLoopRecoveryAction(currentAction);
    if (shouldRefresh) {
      nextAction = deriveConflictLoopRecoveryAction(turnId);
    }
  }

  if (!shouldRefresh || !nextAction) {
    return { state, changed: false };
  }

  let nextState = state;
  let changed = false;

  if (recovery && currentAction !== nextAction) {
    nextState = {
      ...nextState,
      blocked_reason: {
        ...nextState.blocked_reason,
        recovery: {
          ...recovery,
          recovery_action: nextAction,
        },
      },
    };
    changed = true;
  }

  if (
    nextState.escalation?.source === 'operator'
    && isLegacyEscalationRecoveryAction(nextState.escalation.recovery_action)
    && nextState.escalation.recovery_action !== nextAction
  ) {
    nextState = {
      ...nextState,
      escalation: {
        ...nextState.escalation,
        recovery_action: nextAction,
      },
    };
    changed = true;
  }

  return { state: nextState, changed };
}

function inferBlockedReasonFromState(state) {
  if (!state || typeof state !== 'object') {
    return null;
  }

  if (typeof state.blocked_on !== 'string' || !state.blocked_on.trim()) {
    return null;
  }

  const turnRetained = getActiveTurnCount(state) > 0;
  const activeTurn = getActiveTurn(state);

  if (state.blocked_on.startsWith('human:')) {
    const detail = state.blocked_on.slice('human:'.length) || null;
    return buildBlockedReason({
      category: 'needs_human',
      recovery: {
        typed_reason: 'needs_human',
        owner: 'human',
        recovery_action: deriveNeedsHumanRecoveryAction(state, null, {
          turnRetained,
          turnId: activeTurn?.turn_id ?? state.blocked_reason?.turn_id ?? null,
        }),
        turn_retained: turnRetained,
        detail,
      },
      turnId: activeTurn?.turn_id ?? state.last_completed_turn_id ?? null,
    });
  }

  if (state.blocked_on.startsWith('escalation:')) {
    const isOperatorEscalation = isOperatorEscalationBlockedOn(state.blocked_on) || state.escalation?.source === 'operator';
    const recoveryAction = deriveEscalationRecoveryAction(state, null, {
      turnRetained,
      turnId: activeTurn?.turn_id ?? state.escalation?.from_turn_id ?? null,
    });
    return buildBlockedReason({
      category: isOperatorEscalation ? 'operator_escalation' : 'retries_exhausted',
      recovery: {
        typed_reason: isOperatorEscalation ? 'operator_escalation' : 'retries_exhausted',
        owner: 'human',
        recovery_action: recoveryAction,
        turn_retained: turnRetained,
        detail: state.escalation?.detail || state.escalation?.reason || state.blocked_on,
      },
      turnId: activeTurn?.turn_id ?? null,
    });
  }

  if (state.blocked_on.startsWith('dispatch:')) {
    const detail = state.blocked_on.slice('dispatch:'.length) || null;
    return buildBlockedReason({
      category: 'dispatch_error',
      recovery: {
        typed_reason: 'dispatch_error',
        owner: 'human',
        recovery_action: deriveDispatchRecoveryAction(state, null, {
          turnRetained,
          turnId: activeTurn?.turn_id ?? state.blocked_reason?.turn_id ?? null,
        }),
        turn_retained: turnRetained,
        detail,
      },
      turnId: activeTurn?.turn_id ?? null,
    });
  }

  if (state.blocked_on.startsWith('policy:')) {
    const policyId = getPolicyIdFromBlockedState(state);
    return buildBlockedReason({
      category: 'policy_escalation',
      recovery: {
        typed_reason: 'policy_escalation',
        owner: 'human',
        recovery_action: derivePolicyEscalationRecoveryAction(state, null, {
          turnRetained,
          turnId: activeTurn?.turn_id ?? state.blocked_reason?.turn_id ?? null,
          policyId,
        }),
        turn_retained: turnRetained,
        detail: derivePolicyEscalationDetail(state, { policyId }),
      },
      turnId: activeTurn?.turn_id ?? state.blocked_reason?.turn_id ?? null,
    });
  }

  return null;
}

export function normalizeGovernedStateShape(state) {
  if (!state || typeof state !== 'object') {
    return { state, changed: false };
  }

  let nextState = state;
  let changed = false;

  if (nextState.schema_version !== GOVERNED_SCHEMA_VERSION || 'current_turn' in nextState || !('active_turns' in nextState)) {
    nextState = normalizeV1toV1_1(nextState);
    changed = true;
  }

  const hasApprovalPause = Boolean(state.pending_phase_transition || state.pending_run_completion);
  const legacyBlockedPause =
    state.status === 'paused' &&
    !hasApprovalPause &&
    typeof state.blocked_on === 'string' &&
    (state.blocked_on.startsWith('human:') || state.blocked_on.startsWith('escalation:'));

  if (legacyBlockedPause) {
    nextState = {
      ...nextState,
      status: 'blocked',
    };
    changed = true;
  }

  if (nextState.status === 'blocked') {
    const inferred = inferBlockedReasonFromState(nextState);
    const normalizedRecovery = normalizeRecoveryDescriptor(
      nextState.blocked_reason?.recovery,
      getActiveTurn(nextState),
      nextState.blocked_reason?.recovery?.detail ?? inferred?.recovery?.detail ?? nextState.blocked_on ?? null,
    );

    if (!nextState.blocked_reason && inferred) {
      nextState = {
        ...nextState,
        blocked_reason: inferred,
      };
      changed = true;
    } else if (
      nextState.blocked_reason &&
      normalizedRecovery &&
      JSON.stringify(nextState.blocked_reason.recovery) !== JSON.stringify(normalizedRecovery)
    ) {
      nextState = {
        ...nextState,
        blocked_reason: {
          ...nextState.blocked_reason,
          recovery: normalizedRecovery,
        },
      };
      changed = true;
    }
  }

  if (nextState.status !== 'blocked' && 'blocked_reason' in nextState && nextState.blocked_reason != null) {
    nextState = {
      ...nextState,
      blocked_reason: null,
    };
    changed = true;
  }

  const normalizedLastGateFailure = normalizeGateFailure(nextState.last_gate_failure);
  if (JSON.stringify(nextState.last_gate_failure ?? null) !== JSON.stringify(normalizedLastGateFailure)) {
    nextState = {
      ...nextState,
      last_gate_failure: normalizedLastGateFailure,
    };
    changed = true;
  }

  return { state: stripLegacyCurrentTurn(nextState), changed };
}

export function markRunBlocked(root, details) {
  const state = readState(root);
  if (!state) {
    return { ok: false, error: 'No governed state.json found' };
  }

  const blockedAt = details.blockedAt || new Date().toISOString();
  const turnId = details.turnId ?? getActiveTurn(state)?.turn_id ?? null;
  const blockedReason = buildBlockedReason({
    category: details.category,
    recovery: details.recovery,
    turnId,
    blockedAt,
  });

  const updatedState = {
    ...state,
    status: 'blocked',
    blocked_on: details.blockedOn,
    blocked_reason: blockedReason,
    escalation: details.escalation ?? state.escalation ?? null,
  };

  writeState(root, updatedState);

  // Session checkpoint — non-fatal, written after blocked state is persisted
  writeSessionCheckpoint(root, updatedState, 'blocked', {
    role: turnId ? (getActiveTurns(updatedState)[turnId]?.assigned_role || null) : null,
  });

  emitBlockedNotification(root, details.notificationConfig, updatedState, {
    category: details.category,
    blockedOn: details.blockedOn,
    recovery: details.recovery,
  }, turnId ? getActiveTurns(updatedState)[turnId] || null : null);

  // Fire on_escalation hooks (advisory-only) after blocked state is persisted.
  // Only fire for non-hook-caused blocks to prevent circular invocations.
  if (details.hooksConfig?.on_escalation?.length > 0) {
    const activeTurn = getActiveTurn(updatedState);
    _fireOnEscalationHooks(root, details.hooksConfig, {
      blocked_reason: details.category || 'unknown',
      recovery_action: details.recovery?.recovery_action || 'unknown',
      failed_turn_id: turnId || null,
      failed_role: activeTurn?.assigned_role || null,
      attempt_count: activeTurn?.attempt || 0,
      last_error: details.recovery?.detail || details.blockedOn || 'unknown',
      run_id: updatedState.run_id,
    });
  }

  return { ok: true, state: updatedState };
}

export function raiseOperatorEscalation(root, config, details) {
  const state = readState(root);
  if (!state) {
    return { ok: false, error: 'No governed state.json found' };
  }

  const reason = typeof details.reason === 'string' ? details.reason.trim() : '';
  if (!reason) {
    return { ok: false, error: 'Escalation reason is required.' };
  }

  if (state.status !== 'active') {
    return { ok: false, error: `Cannot escalate run: status is "${state.status}", expected "active"` };
  }

  const activeTurns = getActiveTurns(state);
  let targetTurn = null;
  if (details.turnId) {
    targetTurn = activeTurns[details.turnId] || null;
    if (!targetTurn) {
      return { ok: false, error: `No active turn found for --turn ${details.turnId}` };
    }
  } else {
    const turns = Object.values(activeTurns);
    if (turns.length > 1) {
      return { ok: false, error: 'Multiple active turns exist. Use --turn <id> to target the escalation.' };
    }
    targetTurn = turns[0] || null;
  }

  const turnRetained = Boolean(targetTurn);
  const recoveryAction = deriveEscalationRecoveryAction(state, config, {
    turnRetained,
    turnId: targetTurn?.turn_id || null,
    overrideAction: details.action,
  });
  const detail = typeof details.detail === 'string' && details.detail.trim()
    ? details.detail.trim()
    : reason;
  const blockedOn = `escalation:operator:${slugifyEscalationReason(reason)}`;
  const escalatedAt = new Date().toISOString();

  const escalation = {
    source: 'operator',
    raised_by: 'human',
    from_role: targetTurn?.assigned_role || null,
    from_turn_id: targetTurn?.turn_id || null,
    reason,
    detail,
    recovery_action: recoveryAction,
    escalated_at: escalatedAt,
  };

  const blocked = markRunBlocked(root, {
    blockedOn,
    category: 'operator_escalation',
    recovery: {
      typed_reason: 'operator_escalation',
      owner: 'human',
      recovery_action: recoveryAction,
      turn_retained: turnRetained,
      detail,
    },
    turnId: targetTurn?.turn_id || null,
    escalation,
    hooksConfig: config?.hooks || {},
    notificationConfig: config,
  });
  if (!blocked.ok) {
    return blocked;
  }

  appendJsonl(root, LEDGER_PATH, {
    timestamp: escalatedAt,
    decision: 'operator_escalated',
    run_id: blocked.state.run_id,
    phase: blocked.state.phase,
    blocked_on: blockedOn,
    escalation,
  });

  emitPendingLifecycleNotification(root, config, blocked.state, 'operator_escalation_raised', {
    source: 'operator',
    blocked_on: blockedOn,
    reason,
    detail,
    recovery_action: recoveryAction,
  }, targetTurn);
  emitRunEvent(root, 'escalation_raised', {
    run_id: blocked.state.run_id,
    phase: blocked.state.phase,
    status: 'blocked',
    payload: { source: 'operator', reason },
  });

  return {
    ok: true,
    state: attachLegacyCurrentTurnAlias(blocked.state),
    escalation,
  };
}

export function reactivateGovernedRun(root, state, details = {}) {
  if (!state || typeof state !== 'object') {
    return { ok: false, error: 'State is required.' };
  }
  if (state.status !== 'blocked' && state.status !== 'paused') {
    return { ok: false, error: `Cannot reactivate run: status is "${state.status}", expected "blocked" or "paused".` };
  }
  if (state.status === 'paused' && (state.pending_phase_transition || state.pending_run_completion)) {
    return { ok: false, error: 'Cannot reactivate run: this paused run is awaiting approval. Use approve-transition or approve-completion.' };
  }

  const now = new Date().toISOString();
  const wasEscalation = state.status === 'blocked' && typeof state.blocked_on === 'string' && state.blocked_on.startsWith('escalation:');
  const nextState = {
    ...state,
    status: 'active',
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
  };

  writeState(root, nextState);

  if (wasEscalation) {
    appendJsonl(root, LEDGER_PATH, {
      timestamp: now,
      decision: 'escalation_resolved',
      run_id: state.run_id,
      phase: state.phase,
      resolved_via: details.via || 'unknown',
      blocked_on: state.blocked_on,
      escalation: state.escalation || null,
      turn_id: state.escalation?.from_turn_id ?? getActiveTurn(state)?.turn_id ?? null,
      role: state.escalation?.from_role ?? getActiveTurn(state)?.assigned_role ?? null,
    });

    emitPendingLifecycleNotification(details.root || root, details.notificationConfig, nextState, 'escalation_resolved', {
      blocked_on: state.blocked_on,
      resolved_via: details.via || 'unknown',
      previous_escalation: state.escalation || null,
    }, state.escalation?.from_turn_id ? getActiveTurns(state)[state.escalation.from_turn_id] || getActiveTurn(state) : getActiveTurn(state));
    emitRunEvent(details.root || root, 'escalation_resolved', {
      run_id: nextState.run_id,
      phase: nextState.phase,
      status: nextState.status,
      payload: { resolved_via: details.via || 'unknown' },
    });
  }

  return { ok: true, state: attachLegacyCurrentTurnAlias(nextState) };
}

// ── Core Operations ──────────────────────────────────────────────────────────

/**
 * Initialize a governed run from bootstrap state.
 * Creates a run_id and sets status to 'active'.
 *
 * @param {string} root - project root directory
 * @param {object} config - normalized config
 * @returns {{ ok: boolean, error?: string, state?: object }}
 */
export function initializeGovernedRun(root, config, options = {}) {
  let state = readState(root);
  if (!state) {
    return { ok: false, error: 'No governed state.json found' };
  }
  const allowTerminalRestart = options.allow_terminal_restart === true
    && (state.status === 'completed' || state.status === 'blocked');
  if (state.status === 'completed' && !allowTerminalRestart) {
    return { ok: false, error: 'Cannot initialize run: this run is already completed. Start a new project or reset state.' };
  }
  const allowBlockedBootstrap = state.status === 'blocked' && state.run_id === null && getActiveTurnCount(state) === 0;
  if (state.status !== 'idle' && !allowBlockedBootstrap && !allowTerminalRestart) {
    return { ok: false, error: `Cannot initialize run: status is "${state.status}", expected "idle" or pre-run "blocked"` };
  }
  if (allowTerminalRestart) {
    state = buildFreshIdleStateForNewRun(state, config);
  }

  const runId = generateId('run');
  const now = new Date().toISOString();
  const provenance = buildDefaultRunProvenance(options.provenance);
  const updatedState = {
    ...state,
    run_id: runId,
    created_at: now,
    phase_entered_at: now,
    status: 'active',
    blocked_on: null,
    blocked_reason: null,
    budget_status: {
      spent_usd: 0,
      remaining_usd: config.budget?.per_run_max_usd ?? null
    },
    provenance,
    inherited_context: options.inherited_context || null,
  };

  writeState(root, updatedState);
  emitRunEvent(root, 'run_started', {
    run_id: runId,
    phase: updatedState.phase,
    status: 'active',
    payload: { provenance: provenance || {} },
  });
  return { ok: true, state: attachLegacyCurrentTurnAlias(updatedState) };
}

/**
 * Assign a turn to a role.
 * Supports parallel assignment up to max_concurrent_turns for the current phase.
 *
 * Guards (DEC-PARALLEL-006, DEC-PARALLEL-007, DEC-PARALLEL-011):
 *   - No assignment while run is blocked
 *   - Same role cannot hold two active turns
 *   - Concurrency limit per phase is respected
 *   - Budget reservation is created per turn
 *
 * @param {string} root - project root directory
 * @param {object} config - normalized config
 * @param {string} roleId - the role to assign
 * @returns {{ ok: boolean, error?: string, warnings?: string[], state?: object }}
 */
export function assignGovernedTurn(root, config, roleId) {
  let state = readState(root);
  if (!state) {
    return { ok: false, error: 'No governed state.json found' };
  }

  const reconciledBudget = reconcileBudgetStatusWithConfig(state, config);
  if (reconciledBudget.changed) {
    state = reconciledBudget.state;
    writeState(root, state);
  }

  // DEC-PARALLEL-007: No new assignment while run is blocked
  if (state.status === 'blocked') {
    return { ok: false, error: 'Cannot assign turn: run is blocked. Resolve the blocked state before assigning new turns.' };
  }
  if (state.status !== 'active') {
    return { ok: false, error: `Cannot assign turn: status is "${state.status}", expected "active"` };
  }

  const role = config.roles?.[roleId];
  if (!role) {
    return { ok: false, error: `Unknown role: "${roleId}"` };
  }
  const runtimeId = role.runtime_id || role.runtime;
  if (!runtimeId) {
    return { ok: false, error: `Role "${roleId}" has no runtime identifier` };
  }

  // Concurrency checks
  const activeTurns = getActiveTurns(state);
  const activeCount = Object.keys(activeTurns).length;
  const maxConcurrent = getMaxConcurrentTurns(config, state.phase);

  // When max_concurrent_turns = 1 (sequential mode), preserve backward-compatible
  // error message before any parallel-specific checks
  if (maxConcurrent === 1 && activeCount >= 1) {
    const existing = Object.values(activeTurns)[0];
    return { ok: false, error: `Turn already assigned: ${existing.turn_id} to ${existing.assigned_role}` };
  }

  // DEC-PARALLEL-006: One active turn per role at a time
  const existingRoleTurn = Object.values(activeTurns).find(t => t.assigned_role === roleId);
  if (existingRoleTurn) {
    return { ok: false, error: `Role "${roleId}" already has an active turn: ${existingRoleTurn.turn_id}` };
  }

  // Concurrency limit
  if (activeCount >= maxConcurrent) {
    return { ok: false, error: `Cannot assign turn: ${activeCount} active turn(s) already at capacity (max_concurrent_turns = ${maxConcurrent})` };
  }

  // DEC-PARALLEL-011: Budget reservation
  const warnings = [];

  // DEC-BUDGET-ENFORCE-001 + DEC-BUDGET-WARN-001: Pre-assignment budget exhaustion guard
  if (state.budget_status?.remaining_usd != null && state.budget_status.remaining_usd <= 0) {
    const onExceed = config.budget?.on_exceed || 'pause_and_escalate';
    if (onExceed === 'warn') {
      // Allow assignment but add a warning
      warnings.push(`Budget exhausted (spent $${(state.budget_status.spent_usd || 0).toFixed(2)} of $${((state.budget_status.spent_usd || 0) + state.budget_status.remaining_usd).toFixed(2)} limit). Run continues in warn mode per on_exceed policy.`);
    } else {
      return { ok: false, error: `Cannot assign turn: run budget exhausted (spent $${(state.budget_status.spent_usd || 0).toFixed(2)} of $${((state.budget_status.spent_usd || 0) + state.budget_status.remaining_usd).toFixed(2)} limit). Increase budget with agentxchain config --set budget.per_run_max_usd <usd>, then run agentxchain resume` };
    }
  }
  const reservations = { ...(state.budget_reservations || {}) };
  const turnId = generateId('turn');
  const estimatedCost = estimateTurnBudget(config, roleId);

  if (estimatedCost > 0 && state.budget_status?.remaining_usd != null) {
    const alreadyReserved = Object.values(reservations).reduce((sum, r) => sum + (r.reserved_usd || 0), 0);
    const available = state.budget_status.remaining_usd - alreadyReserved;
    const onExceedReserve = config.budget?.on_exceed || 'pause_and_escalate';
    if (estimatedCost > available && onExceedReserve !== 'warn') {
      return { ok: false, error: `Cannot assign turn: estimated cost $${estimatedCost.toFixed(2)} exceeds available budget $${available.toFixed(2)} (after reservations)` };
    }
    reservations[turnId] = {
      reserved_usd: estimatedCost,
      role_id: roleId,
      created_at: new Date().toISOString(),
    };
  }

  // DEC-PARALLEL-008: Advisory overlap warning (declared_file_scope)
  if (role.declared_file_scope && activeCount > 0) {
    const roleScope = new Set(Array.isArray(role.declared_file_scope) ? role.declared_file_scope : []);
    for (const existingTurn of Object.values(activeTurns)) {
      const existingRole = config.roles?.[existingTurn.assigned_role];
      if (existingRole?.declared_file_scope) {
        const existingScope = new Set(Array.isArray(existingRole.declared_file_scope) ? existingRole.declared_file_scope : []);
        const overlap = [...roleScope].filter(f => existingScope.has(f));
        if (overlap.length > 0) {
          warnings.push(`Advisory: declared_file_scope overlap with turn ${existingTurn.turn_id} (${existingTurn.assigned_role}): ${overlap.join(', ')}`);
        }
      }
    }
  }

  // v1 clean-baseline rule: authoritative/proposed turns require a clean working tree
  const writeAuthority = role.write_authority || 'review_only';
  const cleanCheck = checkCleanBaseline(root, writeAuthority);
  if (!cleanCheck.clean) {
    return { ok: false, error: cleanCheck.reason };
  }

  const hooksConfig = config.hooks || {};
  if (hooksConfig.before_assignment && hooksConfig.before_assignment.length > 0) {
    const historyLength = readJsonlEntries(root, HISTORY_PATH).length;
    const beforeAssignmentPayload = {
      role_id: roleId,
      role_config: role,
      phase: state.phase,
      active_turns: Object.values(activeTurns).map((turn) => ({
        turn_id: turn.turn_id,
        role_id: turn.assigned_role,
        status: turn.status,
        attempt: turn.attempt,
      })),
      history_length: historyLength,
    };
    const beforeAssignmentHooks = runHooks(root, hooksConfig, 'before_assignment', beforeAssignmentPayload, {
      run_id: state.run_id,
    });

    if (!beforeAssignmentHooks.ok) {
      const hookName = beforeAssignmentHooks.blocker?.hook_name
        || beforeAssignmentHooks.results?.find((entry) => entry.hook_name)?.hook_name
        || 'unknown';
      const detail = beforeAssignmentHooks.blocker?.message
        || beforeAssignmentHooks.tamper?.message
        || `before_assignment hook "${hookName}" halted assignment`;

      if (beforeAssignmentHooks.tamper) {
        const blockedState = blockRunForHookIssue(root, state, {
          phase: 'before_assignment',
          turnId: null,
          hookName,
          detail,
          errorCode: beforeAssignmentHooks.tamper.error_code,
          turnRetained: activeCount > 0,
          notificationConfig: config,
        });
        return {
          ok: false,
          error: detail,
          error_code: beforeAssignmentHooks.tamper.error_code,
          state: blockedState,
          hookResults: beforeAssignmentHooks,
        };
      }

      return {
        ok: false,
        error: detail,
        error_code: 'hook_blocked',
        state: attachLegacyCurrentTurnAlias(state),
        hookResults: beforeAssignmentHooks,
      };
    }
  }

  // Capture baseline snapshot for observed diff at acceptance time
  const baseline = captureBaseline(root);

  const now = new Date().toISOString();
  const timeoutMinutes = 20;
  const nextSequence = (state.turn_sequence || 0) + 1;

  // Record which turns are concurrent siblings (for conflict detection context)
  const concurrentWith = Object.keys(activeTurns);

  const updatedState = {
    ...state,
    turn_sequence: nextSequence,
    budget_reservations: reservations,
    active_turns: {
      ...activeTurns,
      [turnId]: {
        turn_id: turnId,
        assigned_role: roleId,
        status: 'running',
        attempt: 1,
        started_at: now,
        deadline_at: new Date(Date.now() + timeoutMinutes * 60 * 1000).toISOString(),
        runtime_id: runtimeId,
        baseline,
        assigned_sequence: nextSequence,
        concurrent_with: concurrentWith,
      },
    },
  };

  writeState(root, updatedState);

  emitRunEvent(root, 'turn_dispatched', {
    run_id: updatedState.run_id,
    phase: updatedState.phase,
    status: updatedState.status,
    turn: { turn_id: turnId, role_id: roleId },
  });

  // Session checkpoint — non-fatal, written after every successful turn assignment
  writeSessionCheckpoint(root, updatedState, 'turn_assigned', {
    role: roleId,
    dispatch_dir: `.agentxchain/dispatch/turns/${turnId}`,
  });

  const assignedTurn = updatedState.active_turns[turnId];
  const result = { ok: true, state: attachLegacyCurrentTurnAlias(updatedState), turn: assignedTurn };
  if (warnings.length > 0) {
    result.warnings = warnings;
  }
  return result;
}

/**
 * Estimate the budget for a single turn based on role/runtime configuration.
 * Used for DEC-PARALLEL-011 budget reservation.
 *
 * @param {object} config - normalized config
 * @param {string} roleId - the role being assigned
 * @returns {number} estimated cost in USD (0 if not estimable)
 */
function estimateTurnBudget(config, roleId) {
  // Use per_turn_max_usd as the reservation estimate
  if (config.budget?.per_turn_max_usd != null && config.budget.per_turn_max_usd > 0) {
    return config.budget.per_turn_max_usd;
  }
  return 0;
}

/**
 * Accept a governed turn.
 *
 * 1. Load current state
 * 2. Validate .agentxchain/staging/turn-result.json
 * 3. Append accepted entry to history.jsonl
 * 4. Append decisions to decision-ledger.jsonl
 * 5. Append prose section to TALK.md
 * 6. Update state.json
 * 7. Clear staging file
 *
 * Does NOT auto-assign the next turn.
 *
 * @param {string} root - project root directory
 * @param {object} config - normalized config
 * @param {object} [opts]
 * @param {string} [opts.turnId] - explicit target turn when multiple turns are active
 * @returns {{ ok: boolean, error?: string, error_code?: string, validation?: object, state?: object }}
 */
export function acceptGovernedTurn(root, config, opts = {}) {
  // Replay any prepared journals from previous crashes before starting
  replayPreparedJournals(root);

  // Pre-lock target resolution (quick fail for obviously invalid requests)
  const preState = readState(root);
  if (!preState) {
    return { ok: false, error: 'No governed state.json found' };
  }
  const preResolution = resolveTurnTarget(preState, opts.turnId);
  if (!preResolution.ok) {
    return preResolution;
  }

  // Acquire acceptance lock — serializes concurrent acceptance attempts
  const lockResult = acquireAcceptanceLock(root);
  if (!lockResult.ok) {
    return lockResult;
  }

  try {
    return _acceptGovernedTurnLocked(root, config, opts);
  } finally {
    releaseAcceptanceLock(root);
  }
}

function _acceptGovernedTurnLocked(root, config, opts) {
  // Re-read state under lock (a sibling acceptance may have committed)
  let state = readState(root);
  if (!state) {
    return { ok: false, error: 'No governed state.json found' };
  }

  const targetResolution = resolveTurnTarget(state, opts.turnId);
  if (!targetResolution.ok) {
    return targetResolution;
  }
  let currentTurn = targetResolution.turn;

  const resolutionMode = opts.resolutionMode || 'standard';
  if (resolutionMode !== 'standard' && resolutionMode !== 'human_merge') {
    return {
      ok: false,
      error: `Unknown resolution mode "${resolutionMode}"`,
      error_code: 'protocol_error',
    };
  }

  if (resolutionMode === 'human_merge') {
    if (!currentTurn.conflict_state) {
      return {
        ok: false,
        error: 'human_merge resolution requires a conflicted active turn.',
        error_code: 'protocol_error',
      };
    }

    if (currentTurn.conflict_state.status !== 'human_merging') {
      appendJsonl(root, LEDGER_PATH, {
        timestamp: new Date().toISOString(),
        decision: 'conflict_resolution_selected',
        turn_id: currentTurn.turn_id,
        attempt: currentTurn.attempt,
        role: currentTurn.assigned_role,
        phase: state.phase,
        conflict: {
          conflicting_files: currentTurn.conflict_state.conflict_error?.conflicting_files || [],
          accepted_since_turn_ids: (currentTurn.conflict_state.conflict_error?.accepted_since || []).map((entry) => entry.turn_id),
          overlap_ratio: currentTurn.conflict_state.conflict_error?.overlap_ratio ?? 0,
        },
        resolution_chosen: 'human_merge',
      });

      state = {
        ...state,
        active_turns: {
          ...getActiveTurns(state),
          [currentTurn.turn_id]: {
            ...currentTurn,
            status: 'conflicted',
            conflict_state: {
              ...currentTurn.conflict_state,
              status: 'human_merging',
            },
          },
        },
      };
      writeState(root, state);
      currentTurn = state.active_turns[currentTurn.turn_id];
    }
  }

  const turnStagingPath = getTurnStagingResultPath(currentTurn.turn_id);
  const resolvedStagingPath = existsSync(join(root, turnStagingPath)) ? turnStagingPath : STAGING_PATH;
  const stagedTurn = loadHookStagedTurn(root, resolvedStagingPath);
  const validationState = attachLegacyCurrentTurnAlias({
    ...state,
    active_turns: {
      [currentTurn.turn_id]: currentTurn,
    },
  });
  const hooksConfig = config.hooks || {};

  if (hooksConfig.before_validation && hooksConfig.before_validation.length > 0) {
    const beforeValidationPayload = {
      turn_id: currentTurn.turn_id,
      role_id: currentTurn.assigned_role,
      staging_path: resolvedStagingPath,
      turn_result: stagedTurn.turnResult ?? null,
      ...(stagedTurn.parse_error ? { parse_error: stagedTurn.parse_error } : {}),
      ...(stagedTurn.read_error ? { read_error: stagedTurn.read_error } : {}),
    };
    const beforeValidationHooks = runHooks(root, hooksConfig, 'before_validation', beforeValidationPayload, {
      run_id: state.run_id,
      turn_id: currentTurn.turn_id,
    });

    if (!beforeValidationHooks.ok) {
      const hookName = beforeValidationHooks.blocker?.hook_name
        || beforeValidationHooks.results?.find((entry) => entry.hook_name)?.hook_name
        || 'unknown';
      const detail = beforeValidationHooks.blocker?.message
        || beforeValidationHooks.tamper?.message
        || `before_validation hook "${hookName}" halted acceptance`;
      const blockedState = blockRunForHookIssue(root, state, {
        phase: 'before_validation',
        turnId: currentTurn.turn_id,
        hookName,
        detail,
        errorCode: beforeValidationHooks.tamper?.error_code || 'hook_blocked',
        turnRetained: true,
        notificationConfig: config,
      });
      return {
        ok: false,
        error: detail,
        error_code: beforeValidationHooks.tamper?.error_code || 'hook_blocked',
        state: blockedState,
        hookResults: beforeValidationHooks,
      };
    }
  }

  const validation = validateStagedTurnResult(root, validationState, config, { stagingPath: resolvedStagingPath });
  if (hooksConfig.after_validation && hooksConfig.after_validation.length > 0) {
    const afterValidationPayload = {
      turn_id: currentTurn.turn_id,
      role_id: currentTurn.assigned_role,
      validation_ok: validation.ok,
      validation_stage: validation.stage,
      errors: validation.errors,
      warnings: validation.warnings,
      turn_result: validation.turnResult ?? stagedTurn.turnResult ?? null,
    };
    const afterValidationHooks = runHooks(root, hooksConfig, 'after_validation', afterValidationPayload, {
      run_id: state.run_id,
      turn_id: currentTurn.turn_id,
    });

    if (!afterValidationHooks.ok) {
      const hookName = afterValidationHooks.blocker?.hook_name
        || afterValidationHooks.results?.find((entry) => entry.hook_name)?.hook_name
        || 'unknown';
      const detail = afterValidationHooks.blocker?.message
        || afterValidationHooks.tamper?.message
        || `after_validation hook "${hookName}" halted acceptance`;
      const blockedState = blockRunForHookIssue(root, state, {
        phase: 'after_validation',
        turnId: currentTurn.turn_id,
        hookName,
        detail,
        errorCode: afterValidationHooks.tamper?.error_code || 'hook_blocked',
        turnRetained: true,
        notificationConfig: config,
      });
      return {
        ok: false,
        error: detail,
        error_code: afterValidationHooks.tamper?.error_code || 'hook_blocked',
        state: blockedState,
        hookResults: afterValidationHooks,
      };
    }
  }

  if (!validation.ok) {
    return {
      ok: false,
      error: `Validation failed at stage ${validation.stage}: ${validation.errors.join('; ')}`,
      validation,
    };
  }

  const turnResult = validation.turnResult;
  const stagingFile = join(root, resolvedStagingPath);
  const now = new Date().toISOString();
  const baseline = currentTurn.baseline || null;
  const rawObservation = observeChanges(root, baseline);
  const historyEntries = readJsonlEntries(root, HISTORY_PATH);
  const observation = attributeObservedChangesToTurn(rawObservation, currentTurn, historyEntries);
  const role = config.roles?.[turnResult.role];
  const runtimeId = turnResult.runtime_id;
  const runtime = config.runtimes?.[runtimeId];
  const runtimeType = runtime?.type || 'manual';
  materializeDerivedReviewArtifact(root, turnResult, state, runtimeType, baseline);
  materializeDerivedProposalArtifact(root, turnResult, state, runtimeType);
  const writeAuthority = role?.write_authority || 'review_only';
  const diffComparison = compareDeclaredVsObserved(
    turnResult.files_changed || [],
    observation.files_changed,
    writeAuthority,
    { observation_available: observation.observation_available },
  );
  if (diffComparison.errors.length > 0) {
    return {
      ok: false,
      error: `Observed artifact mismatch: ${diffComparison.errors.join('; ')}`,
      validation: {
        ...validation,
        ok: false,
        stage: 'artifact_observation',
        error_class: 'artifact_error',
        errors: diffComparison.errors,
        warnings: diffComparison.warnings,
      },
    };
  }

  const observedArtifact = buildObservedArtifact(observation, baseline);
  const normalizedVerification = normalizeVerification(turnResult.verification, runtimeType);
  const artifactType = turnResult.artifact?.type || 'review';
  const derivedRef = deriveAcceptedRef(observation, artifactType, state.accepted_integration_ref);
  const verificationReplay = (config.policies || []).some((policy) => policy?.rule === 'require_reproducible_verification')
    ? replayVerificationMachineEvidence({ root, verification: turnResult.verification })
    : null;

  // Policy evaluation — declarative governance rules (spec: POLICY_ENGINE_SPEC.md)
  const policyResult = evaluatePolicies(config.policies || [], {
    currentPhase: state.phase,
    turnRole: turnResult.role,
    turnStatus: turnResult.status,
    turnCostUsd: readTurnCostUsd(turnResult),
    history: historyEntries,
    verificationReplay,
  });

  if (policyResult.blocks.length > 0) {
    const blockMessages = policyResult.blocks.map((v) => v.message);
    return {
      ok: false,
      error: `Policy violation: ${blockMessages.join('; ')}`,
      error_code: 'policy_violation',
      policy_violations: policyResult.violations,
    };
  }

  if (policyResult.escalations.length > 0) {
    const escalationMessages = policyResult.escalations.map((v) => v.message);
    const policyId = policyResult.escalations[0].policy_id;
    const turnRetained = getActiveTurnCount(state) > 0;
    const recovery = {
      typed_reason: 'policy_escalation',
      owner: 'human',
      recovery_action: derivePolicyEscalationRecoveryAction(state, config, {
        turnRetained,
        turnId: currentTurn.turn_id,
        policyId,
      }),
      turn_retained: turnRetained,
      detail: derivePolicyEscalationDetail(state, {
        policyId,
        detail: escalationMessages.join('; '),
      }),
    };
    const blockedState = {
      ...state,
      status: 'blocked',
      blocked_on: `policy:${policyId}`,
      blocked_reason: buildBlockedReason({
        category: 'policy_escalation',
        recovery,
        turnId: currentTurn.turn_id,
        blockedAt: now,
      }),
    };
    writeState(root, blockedState);
    recordRunHistory(root, blockedState, config, 'blocked');
    emitBlockedNotification(root, config, blockedState, {
      category: 'policy_escalation',
      blockedOn: blockedState.blocked_on,
      recovery,
    }, currentTurn);
    appendJsonl(root, LEDGER_PATH, {
      timestamp: now,
      decision: 'policy_escalation',
      turn_id: currentTurn.turn_id,
      role: turnResult.role,
      phase: state.phase,
      violations: policyResult.escalations.map((v) => ({
        policy_id: v.policy_id,
        rule: v.rule,
        message: v.message,
      })),
    });
    return {
      ok: false,
      error: `Policy escalation: ${escalationMessages.join('; ')}`,
      error_code: 'policy_escalation',
      state: attachLegacyCurrentTurnAlias(blockedState),
      policy_violations: policyResult.violations,
    };
  }

  const conflict = detectAcceptanceConflict(
    currentTurn,
    buildConflictCandidateFiles(rawObservation, observation, turnResult.files_changed || []),
    historyEntries,
  );

  if (conflict) {
    const detectionCount = (currentTurn.conflict_state?.detection_count || 0) + 1;
    const conflictState = {
      detected_at: now,
      detection_count: detectionCount,
      status: 'pending_operator',
      conflict_error: conflict,
    };
    const updatedState = {
      ...state,
      active_turns: {
        ...getActiveTurns(state),
        [currentTurn.turn_id]: {
          ...currentTurn,
          status: 'conflicted',
          conflict_state: conflictState,
        },
      },
    };

    if (detectionCount >= 3) {
      updatedState.status = 'blocked';
      updatedState.blocked_on = `human:conflict_loop:${currentTurn.turn_id}`;
      updatedState.blocked_reason = buildBlockedReason({
        category: 'conflict_loop',
        recovery: {
          typed_reason: 'conflict_loop',
          owner: 'human',
          recovery_action: deriveConflictLoopRecoveryAction(currentTurn.turn_id),
          turn_retained: true,
          detail: buildConflictDetail(conflict),
        },
        turnId: currentTurn.turn_id,
        blockedAt: now,
      });
    }

    appendJsonl(root, LEDGER_PATH, {
      timestamp: now,
      decision: 'conflict_detected',
      turn_id: currentTurn.turn_id,
      attempt: currentTurn.attempt,
      role: currentTurn.assigned_role,
      phase: state.phase,
      conflict: {
        conflicting_files: conflict.conflicting_files,
        accepted_since_turn_ids: conflict.accepted_since.map(entry => entry.turn_id),
        overlap_ratio: conflict.overlap_ratio,
      },
    });

    writeState(root, updatedState);

    // DEC-RHTR-SPEC: Record conflict_loop blocked outcome in cross-run history (non-fatal)
    if (updatedState.status === 'blocked') {
      recordRunHistory(root, updatedState, config, 'blocked');
    }

    return {
      ok: false,
      error: `Acceptance conflict detected for turn ${currentTurn.turn_id}`,
      error_code: 'conflict',
      state: attachLegacyCurrentTurnAlias(updatedState),
      conflict,
    };
  }

  if (hooksConfig.before_acceptance && hooksConfig.before_acceptance.length > 0) {
    const classified = classifyObservedChanges(root, observation, baseline);
    const beforeAcceptancePayload = {
      turn_id: currentTurn.turn_id,
      role_id: currentTurn.assigned_role,
      turn_result: turnResult,
      observed_changes: classified,
      conflict_detected: false,
    };
    const beforeAcceptanceHooks = runHooks(root, hooksConfig, 'before_acceptance', beforeAcceptancePayload, {
      run_id: state.run_id,
      turn_id: currentTurn.turn_id,
    });

    if (!beforeAcceptanceHooks.ok) {
      const hookName = beforeAcceptanceHooks.blocker?.hook_name
        || beforeAcceptanceHooks.results?.find((entry) => entry.hook_name)?.hook_name
        || 'unknown';
      const detail = beforeAcceptanceHooks.blocker?.message
        || beforeAcceptanceHooks.tamper?.message
        || `before_acceptance hook "${hookName}" halted acceptance`;
      const blockedState = blockRunForHookIssue(root, state, {
        phase: 'before_acceptance',
        turnId: currentTurn.turn_id,
        hookName,
        detail,
        errorCode: beforeAcceptanceHooks.tamper?.error_code || 'hook_blocked',
        turnRetained: true,
        notificationConfig: config,
      });
      return {
        ok: false,
        error: detail,
        error_code: beforeAcceptanceHooks.tamper?.error_code || 'hook_blocked',
        state: blockedState,
        hookResults: beforeAcceptanceHooks,
      };
    }
  }

  const acceptedSequence = (state.turn_sequence || 0) + 1;
  const historyEntry = {
    turn_id: turnResult.turn_id,
    run_id: turnResult.run_id,
    role: turnResult.role,
    phase: state.phase,
    runtime_id: turnResult.runtime_id,
    status: turnResult.status,
    summary: turnResult.summary,
    decisions: turnResult.decisions || [],
    objections: turnResult.objections || [],
    files_changed: turnResult.files_changed || [],
    artifacts_created: turnResult.artifacts_created || [],
    verification: turnResult.verification || {},
    normalized_verification: normalizedVerification,
    ...(verificationReplay ? { verification_replay: summarizeVerificationReplay(verificationReplay) } : {}),
    artifact: turnResult.artifact || {},
    observed_artifact: observedArtifact,
    proposed_next_role: turnResult.proposed_next_role,
    phase_transition_request: turnResult.phase_transition_request,
    run_completion_request: Boolean(turnResult.run_completion_request),
    assigned_sequence: Number.isInteger(currentTurn.assigned_sequence) ? currentTurn.assigned_sequence : acceptedSequence,
    accepted_sequence: acceptedSequence,
    concurrent_with: Array.isArray(currentTurn.concurrent_with) ? currentTurn.concurrent_with : [],
    cost: turnResult.cost || {},
    ...(currentTurn.started_at ? { started_at: currentTurn.started_at } : {}),
    accepted_at: now,
    ...(currentTurn.started_at ? { duration_ms: Math.max(0, new Date(now).getTime() - new Date(currentTurn.started_at).getTime()) } : {}),
  };
  const nextHistoryEntries = [...historyEntries, historyEntry];
  // Build ledger entries for the journal
  const ledgerEntries = [];
  if (turnResult.decisions && turnResult.decisions.length > 0) {
    for (const decision of turnResult.decisions) {
      ledgerEntries.push({
        id: decision.id,
        turn_id: turnResult.turn_id,
        role: turnResult.role,
        phase: state.phase,
        category: decision.category,
        statement: decision.statement,
        rationale: decision.rationale,
        objections_against: [],
        status: 'accepted',
        overridden_by: null,
        created_at: now,
      });
    }
  }

  const turnNumber = turnResult.turn_id.replace(/^turn_/, '').slice(0, 8);
  const talkSection = `## Turn ${turnNumber} — ${turnResult.role} (${state.phase})\n\n- **Status:** ${turnResult.status}\n- **Summary:** ${turnResult.summary}\n${turnResult.decisions?.length ? turnResult.decisions.map(d => `- **Decision ${d.id}:** ${d.statement}`).join('\n') + '\n' : ''}${turnResult.objections?.length ? turnResult.objections.map(o => `- **Objection ${o.id} (${o.severity}):** ${o.statement}`).join('\n') + '\n' : ''}- **Proposed next:** ${turnResult.proposed_next_role || 'human'}\n\n---\n`;

  const remainingTurns = { ...getActiveTurns(state) };
  delete remainingTurns[currentTurn.turn_id];
  const remainingReservations = { ...(state.budget_reservations || {}) };
  delete remainingReservations[currentTurn.turn_id];
  const costUsd = turnResult.cost?.usd || 0;
  const updatedState = {
    ...state,
    turn_sequence: acceptedSequence,
    last_completed_turn_id: currentTurn.turn_id,
    active_turns: remainingTurns,
    budget_reservations: remainingReservations,
    blocked_on: turnResult.status === 'needs_human' ? `human:${turnResult.needs_human_reason || 'unspecified'}` : null,
    blocked_reason: null,
    escalation: null,
    accepted_integration_ref: derivedRef,
    next_recommended_role: deriveNextRecommendedRole(turnResult, state, config),
    budget_status: {
      ...(state.budget_status || {}),
      spent_usd: (state.budget_status?.spent_usd || 0) + costUsd,
      remaining_usd: state.budget_status?.remaining_usd != null
        ? state.budget_status.remaining_usd - costUsd
        : null,
    },
  };

  if (updatedState.status === 'blocked' && !hasBlockingActiveTurn(remainingTurns)) {
    updatedState.status = 'active';
    updatedState.blocked_on = null;
    updatedState.blocked_reason = null;
    updatedState.escalation = null;
  }

  if (turnResult.status === 'needs_human') {
    updatedState.status = 'blocked';
    updatedState.blocked_reason = buildBlockedReason({
      category: 'needs_human',
      recovery: {
        typed_reason: 'needs_human',
        owner: 'human',
        recovery_action: deriveNeedsHumanRecoveryAction(updatedState, config, {
          turnRetained: false,
          turnId: turnResult.turn_id,
        }),
        turn_retained: false,
        detail: turnResult.needs_human_reason || 'unspecified',
      },
      turnId: turnResult.turn_id,
      blockedAt: now,
    });
  }

  // DEC-BUDGET-ENFORCE-001: Post-acceptance budget exhaustion check
  // Per-turn overrun warning (advisory only)
  let budgetWarning = null;
  const turnReservation = state.budget_reservations?.[currentTurn.turn_id];
  if (turnReservation && costUsd > turnReservation.reserved_usd) {
    budgetWarning = `Actual cost $${costUsd.toFixed(2)} exceeded reservation $${turnReservation.reserved_usd.toFixed(2)} for this turn`;
  }
  // Budget exhaustion enforcement (DEC-BUDGET-ENFORCE-001 + DEC-BUDGET-WARN-001)
  if (
    updatedState.budget_status.remaining_usd != null &&
    updatedState.budget_status.remaining_usd <= 0 &&
    updatedState.status !== 'blocked' &&
    updatedState.status !== 'completed'
  ) {
    const onExceed = config.budget?.on_exceed || 'pause_and_escalate';
    const limit = (updatedState.budget_status.spent_usd + updatedState.budget_status.remaining_usd);
    const overBy = Math.abs(updatedState.budget_status.remaining_usd);
    if (onExceed === 'pause_and_escalate') {
      updatedState.status = 'blocked';
      updatedState.blocked_on = 'budget:exhausted';
      updatedState.blocked_reason = buildBlockedReason({
        category: 'budget_exhausted',
        recovery: {
          typed_reason: 'budget_exhausted',
          owner: 'human',
          recovery_action: 'Increase budget with agentxchain config --set budget.per_run_max_usd <usd>, then run agentxchain resume',
          turn_retained: false,
          detail: `Run budget exhausted: spent $${updatedState.budget_status.spent_usd.toFixed(2)} of $${limit.toFixed(2)} limit ($${overBy.toFixed(2)} over)`,
        },
        turnId: currentTurn.turn_id,
        blockedAt: now,
      });
      updatedState.budget_status.exhausted = true;
      updatedState.budget_status.exhausted_at = now;
      updatedState.budget_status.exhausted_after_turn = currentTurn.turn_id;
    } else if (onExceed === 'warn') {
      // DEC-BUDGET-WARN-001: Do not block — mark exhaustion and emit warning
      if (!updatedState.budget_status.exhausted) {
        updatedState.budget_status.exhausted = true;
        updatedState.budget_status.exhausted_at = now;
        updatedState.budget_status.exhausted_after_turn = currentTurn.turn_id;
      }
      updatedState.budget_status.warn_mode = true;
      budgetWarning = `Budget exhausted: spent $${updatedState.budget_status.spent_usd.toFixed(2)} of $${limit.toFixed(2)} limit ($${overBy.toFixed(2)} over). Run continues in warn mode.`;
    }
  }

  let gateResult = null;
  let completionResult = null;
  let timeoutResult = null;
  const hasRemainingTurns = Object.keys(remainingTurns).length > 0;
  if (turnResult.status !== 'needs_human') {
    if (hasRemainingTurns) {
      if (turnResult.run_completion_request && !updatedState.queued_run_completion) {
        updatedState.queued_run_completion = {
          requested_by_turn: turnResult.turn_id,
          requested_at: now,
        };
      }
      if (turnResult.phase_transition_request && !updatedState.queued_phase_transition) {
        updatedState.queued_phase_transition = {
          from: state.phase,
          to: turnResult.phase_transition_request,
          requested_by_turn: turnResult.turn_id,
          requested_at: now,
        };
      }
    } else {
      const postAcceptanceState = {
        ...state,
        active_turns: remainingTurns,
        turn_sequence: acceptedSequence,
        history: nextHistoryEntries,
      };
      const completionSource = turnResult.run_completion_request
        ? turnResult
        : findHistoryTurnRequest(nextHistoryEntries, state.queued_run_completion?.requested_by_turn, 'run_completion');

      if (completionSource?.run_completion_request) {
        completionResult = evaluateRunCompletion({
          state: postAcceptanceState,
          config,
          acceptedTurn: completionSource,
          root,
        });

        if (completionResult.action === 'complete') {
          updatedState.status = 'completed';
          updatedState.completed_at = now;
          updatedState.last_gate_failure = null;
          if (completionResult.gate_id) {
            updatedState.phase_gate_status = {
              ...(updatedState.phase_gate_status || {}),
              [completionResult.gate_id]: 'passed',
            };
          }
          updatedState.queued_run_completion = null;
          updatedState.queued_phase_transition = null;
        } else if (completionResult.action === 'awaiting_human_approval') {
          // Evaluate approval policy — may auto-approve
          const approvalResult = evaluateApprovalPolicy({
            gateResult: completionResult,
            gateType: 'run_completion',
            state: { ...updatedState, history: nextHistoryEntries },
            config,
          });

          if (approvalResult.action === 'auto_approve') {
            updatedState.status = 'completed';
            updatedState.completed_at = now;
            updatedState.last_gate_failure = null;
            if (completionResult.gate_id) {
              updatedState.phase_gate_status = {
                ...(updatedState.phase_gate_status || {}),
                [completionResult.gate_id]: 'passed',
              };
            }
            updatedState.queued_run_completion = null;
            updatedState.queued_phase_transition = null;
            ledgerEntries.push({
              type: 'approval_policy',
              gate_type: 'run_completion',
              action: 'auto_approve',
              matched_rule: approvalResult.matched_rule,
              reason: approvalResult.reason,
              gate_id: completionResult.gate_id,
              timestamp: now,
            });
          } else {
            updatedState.status = 'paused';
            updatedState.blocked_on = `human_approval:${completionResult.gate_id}`;
            updatedState.blocked_reason = null;
            updatedState.last_gate_failure = null;
            updatedState.pending_run_completion = {
              gate: completionResult.gate_id,
              requested_by_turn: completionSource.turn_id,
              requested_at: now,
            };
            updatedState.queued_run_completion = null;
            updatedState.queued_phase_transition = null;
          }
        } else if (completionResult.action === 'gate_failed') {
          const gateFailure = buildGateFailureRecord({
            gateType: 'run_completion',
            gateResult: completionResult,
            phase: state.phase,
            fromPhase: state.phase,
            toPhase: null,
            requestedByTurn: completionSource?.turn_id || state.queued_run_completion?.requested_by_turn || null,
            failedAt: now,
            queuedRequest: Boolean(state.queued_run_completion && !turnResult.run_completion_request),
          });
          updatedState.last_gate_failure = gateFailure;
          if (completionResult.gate_id) {
            updatedState.phase_gate_status = {
              ...(updatedState.phase_gate_status || {}),
              [completionResult.gate_id]: 'failed',
            };
          }
          updatedState.queued_run_completion = null;
          ledgerEntries.push({
            type: 'gate_failure',
            ...gateFailure,
          });
        } else if (state.queued_run_completion) {
          updatedState.queued_run_completion = null;
        }
      }

      if (updatedState.status !== 'blocked' && updatedState.status !== 'paused' && updatedState.status !== 'completed') {
        const phaseSource = turnResult.phase_transition_request
          ? turnResult
          : findHistoryTurnRequest(nextHistoryEntries, state.queued_phase_transition?.requested_by_turn, 'phase_transition');

        // Always evaluate phase exit when the run drains — even without a request,
        // evaluatePhaseExit returns { action: 'no_request' } which callers depend on.
        gateResult = evaluatePhaseExit({
          state: postAcceptanceState,
          config,
          acceptedTurn: phaseSource || turnResult,
          root,
        });

        if (gateResult.action === 'advance') {
          const prevPhase = updatedState.phase;
          updatedState.phase = gateResult.next_phase;
          updatedState.phase_entered_at = now;
          updatedState.last_gate_failure = null;
          updatedState.phase_gate_status = {
            ...(updatedState.phase_gate_status || {}),
            [gateResult.gate_id || 'no_gate']: 'passed',
          };
          updatedState.queued_phase_transition = null;
          emitRunEvent(root, 'phase_entered', {
            run_id: updatedState.run_id,
            phase: updatedState.phase,
            status: updatedState.status,
            turn: { turn_id: currentTurn.turn_id, role_id: currentTurn.assigned_role },
            payload: {
              from: prevPhase,
              to: gateResult.next_phase,
              gate_id: gateResult.gate_id || 'no_gate',
              trigger: 'auto',
            },
          });
        } else if (gateResult.action === 'awaiting_human_approval') {
          // Evaluate approval policy — may auto-approve
          const approvalResult = evaluateApprovalPolicy({
            gateResult,
            gateType: 'phase_transition',
            state: { ...updatedState, history: nextHistoryEntries },
            config,
          });

          if (approvalResult.action === 'auto_approve') {
            const prevPhase = updatedState.phase;
            updatedState.phase = gateResult.next_phase;
            updatedState.phase_entered_at = now;
            updatedState.last_gate_failure = null;
            updatedState.phase_gate_status = {
              ...(updatedState.phase_gate_status || {}),
              [gateResult.gate_id || 'no_gate']: 'passed',
            };
            updatedState.queued_phase_transition = null;
            ledgerEntries.push({
              type: 'approval_policy',
              gate_type: 'phase_transition',
              action: 'auto_approve',
              matched_rule: approvalResult.matched_rule,
              from_phase: state.phase,
              to_phase: gateResult.next_phase,
              reason: approvalResult.reason,
              gate_id: gateResult.gate_id,
              timestamp: now,
            });
            emitRunEvent(root, 'phase_entered', {
              run_id: updatedState.run_id,
              phase: updatedState.phase,
              status: updatedState.status,
              turn: { turn_id: currentTurn.turn_id, role_id: currentTurn.assigned_role },
              payload: {
                from: prevPhase,
                to: gateResult.next_phase,
                gate_id: gateResult.gate_id || 'no_gate',
                trigger: 'auto_approved',
              },
            });
          } else {
            updatedState.status = 'paused';
            updatedState.blocked_on = `human_approval:${gateResult.gate_id}`;
            updatedState.blocked_reason = null;
            updatedState.last_gate_failure = null;
            updatedState.pending_phase_transition = {
              from: state.phase,
              to: gateResult.next_phase,
              gate: gateResult.gate_id,
              requested_by_turn: phaseSource.turn_id,
            };
            updatedState.queued_phase_transition = null;
          }
        } else if (gateResult.action === 'gate_failed') {
          const gateFailure = buildGateFailureRecord({
            gateType: 'phase_transition',
            gateResult,
            phase: state.phase,
            fromPhase: state.phase,
            toPhase: gateResult.transition_request || state.queued_phase_transition?.to || null,
            requestedByTurn: phaseSource?.turn_id || state.queued_phase_transition?.requested_by_turn || null,
            failedAt: now,
            queuedRequest: Boolean(state.queued_phase_transition && !turnResult.phase_transition_request),
          });
          updatedState.last_gate_failure = gateFailure;
          if (gateResult.gate_id) {
            updatedState.phase_gate_status = {
              ...(updatedState.phase_gate_status || {}),
              [gateResult.gate_id]: 'failed',
            };
          }
          updatedState.queued_phase_transition = null;
          ledgerEntries.push({
            type: 'gate_failure',
            ...gateFailure,
          });
          emitRunEvent(root, 'gate_failed', {
            run_id: updatedState.run_id,
            phase: updatedState.phase,
            status: updatedState.status,
            turn: { turn_id: currentTurn.turn_id, role_id: currentTurn.assigned_role },
            payload: {
              gate_id: gateResult.gate_id || 'no_gate',
              from_phase: state.phase,
              to_phase: gateResult.transition_request || state.queued_phase_transition?.to || null,
              reasons: gateFailure.reasons || [],
            },
          });
        } else if (state.queued_phase_transition) {
          updatedState.queued_phase_transition = null;
        }
      }
    }
  }

  const timeoutEvaluation = evaluateTimeouts({
    config,
    state: updatedState,
    turn: currentTurn,
    turnResult,
    now,
  });
  for (const warning of timeoutEvaluation.warnings) {
    ledgerEntries.push(buildTimeoutLedgerEntry(warning, now, currentTurn.turn_id, updatedState.phase, 'timeout_warning'));
  }

  if (updatedState.status === 'active' && timeoutEvaluation.exceeded.length > 0) {
    timeoutResult = timeoutEvaluation.exceeded[0];

    if (timeoutResult.action === 'skip_phase' && timeoutResult.scope === 'phase') {
      const skipAttempt = attemptTimeoutPhaseSkip({
        root,
        config,
        updatedState,
        nextHistoryEntries,
        historyEntry,
        timeoutResult,
        now,
      });

      if (skipAttempt.ok) {
        updatedState.phase = skipAttempt.updatedState.phase;
        updatedState.phase_entered_at = skipAttempt.updatedState.phase_entered_at;
        updatedState.last_gate_failure = skipAttempt.updatedState.last_gate_failure;
        updatedState.phase_gate_status = skipAttempt.updatedState.phase_gate_status;
        ledgerEntries.push(skipAttempt.ledgerEntry);
      } else {
        const escalatedTimeout = { ...timeoutResult, action: 'escalate' };
        timeoutResult = escalatedTimeout;
        updatedState.status = 'blocked';
        updatedState.blocked_on = `timeout:${escalatedTimeout.scope}`;
        updatedState.blocked_reason = buildBlockedReason({
          ...buildTimeoutBlockedReason(escalatedTimeout, {
            turnRetained: Object.keys(getActiveTurns(updatedState)).length > 0,
          }),
          turnId: currentTurn.turn_id,
          blockedAt: now,
        });
        updatedState.last_gate_failure = skipAttempt.gateFailure || null;
        if (skipAttempt.gateFailure?.gate_id) {
          updatedState.phase_gate_status = {
            ...(updatedState.phase_gate_status || {}),
            [skipAttempt.gateFailure.gate_id]: 'failed',
          };
          ledgerEntries.push({
            type: 'gate_failure',
            ...skipAttempt.gateFailure,
          });
        }
        ledgerEntries.push(skipAttempt.ledgerEntry);
        ledgerEntries.push(buildTimeoutLedgerEntry(escalatedTimeout, now, currentTurn.turn_id, updatedState.phase));
      }
    } else if (timeoutResult.action === 'escalate') {
      updatedState.status = 'blocked';
      updatedState.blocked_on = `timeout:${timeoutResult.scope}`;
      updatedState.blocked_reason = buildBlockedReason({
        ...buildTimeoutBlockedReason(timeoutResult, {
          turnRetained: Object.keys(getActiveTurns(updatedState)).length > 0,
        }),
        turnId: currentTurn.turn_id,
        blockedAt: now,
      });
      ledgerEntries.push(buildTimeoutLedgerEntry(timeoutResult, now, currentTurn.turn_id, updatedState.phase));
    }
  }

  // ── Transaction journal: prepare before committing writes ──────────────
  const transactionId = generateId('txn');
  const journal = {
    transaction_id: transactionId,
    kind: 'accept_turn',
    run_id: state.run_id,
    turn_id: currentTurn.turn_id,
    phase: state.phase,
    status: 'prepared',
    prepared_at: now,
    accepted_sequence: acceptedSequence,
    history_entry: historyEntry,
    ledger_entries: ledgerEntries,
    next_state: stripLegacyCurrentTurn(updatedState),
  };
  writeAcceptanceJournal(root, journal);

  // ── Commit order: history → ledger → talk → state → cleanup → journal ─
  appendJsonl(root, HISTORY_PATH, historyEntry);
  for (const entry of ledgerEntries) {
    appendJsonl(root, LEDGER_PATH, entry);
  }
  appendTalk(root, talkSection);
  writeState(root, updatedState);

  // Cleanup turn-scoped artifacts
  cleanupTurnArtifacts(root, currentTurn.turn_id);
  try {
    unlinkSync(stagingFile);
  } catch {}

  // Journal committed — remove it
  commitAcceptanceJournal(root, transactionId);

  // ── Post-acceptance hooks (advisory only — cannot block) ──────────────
  let hookResults = null;
  if (hooksConfig.after_acceptance && hooksConfig.after_acceptance.length > 0) {
    const hookPayload = {
      turn_id: currentTurn.turn_id,
      role_id: currentTurn.assigned_role,
      history_entry_index: acceptedSequence - 1,
      accepted_integration_ref: derivedRef,
      decisions_count: (turnResult.decisions || []).length,
      objections_count: (turnResult.objections || []).length,
      run_status: updatedState.status,
      phase: updatedState.phase,
    };
    hookResults = runHooks(root, hooksConfig, 'after_acceptance', hookPayload, {
      run_id: state.run_id,
      turn_id: currentTurn.turn_id,
    });

    if (!hookResults.ok) {
      const hookName = hookResults.results?.find((entry) => entry.hook_name)?.hook_name || 'unknown';
      const detail = hookResults.tamper?.message || `after_acceptance hook "${hookName}" failed after commit`;
      const blockedState = blockRunForHookIssue(root, updatedState, {
        phase: 'after_acceptance',
        turnId: currentTurn.turn_id,
        hookName,
        detail,
        errorCode: hookResults.tamper?.error_code || 'hook_post_commit_error',
        turnRetained: Object.keys(getActiveTurns(updatedState)).length > 0,
        notificationConfig: config,
      });
      return {
        ok: false,
        error: `Turn accepted, but post-commit hook handling failed: ${detail}`,
        error_code: hookResults.tamper?.error_code || 'hook_post_commit_error',
        state: blockedState,
        validation,
        accepted: historyEntry,
        gateResult,
        completionResult,
        hookResults,
      };
    }
  }

  // Emit turn_accepted event to local log.
  const turnAcceptedPayload = {};
  if (currentTurn.started_at) {
    turnAcceptedPayload.started_at = currentTurn.started_at;
    turnAcceptedPayload.duration_ms = Math.max(0, new Date(now).getTime() - new Date(currentTurn.started_at).getTime());
  }
  emitRunEvent(root, 'turn_accepted', {
    run_id: updatedState.run_id,
    phase: updatedState.phase,
    status: updatedState.status,
    turn: { turn_id: currentTurn.turn_id, role_id: currentTurn.assigned_role },
    payload: turnAcceptedPayload,
  });

  if (updatedState.status === 'blocked') {
    // DEC-RHTR-SPEC: Record blocked outcome in cross-run history (non-fatal)
    // Covers needs_human, budget:exhausted, and any other non-hook blocked states
    recordRunHistory(root, updatedState, config, 'blocked');

    emitBlockedNotification(root, config, updatedState, {
      category: updatedState.blocked_reason?.category || 'needs_human',
      blockedOn: updatedState.blocked_on,
      recovery: updatedState.blocked_reason?.recovery || null,
    }, currentTurn);
    emitRunEvent(root, 'run_blocked', {
      run_id: updatedState.run_id,
      phase: updatedState.phase,
      status: 'blocked',
      turn: { turn_id: currentTurn.turn_id, role_id: currentTurn.assigned_role },
      payload: { category: updatedState.blocked_reason?.category || 'needs_human' },
    });
  }

  // DEC-BUDGET-WARN-001: Emit budget_exceeded_warn event when warn mode triggers
  if (updatedState.budget_status?.warn_mode && budgetWarning) {
    emitRunEvent(root, 'budget_exceeded_warn', {
      run_id: updatedState.run_id,
      phase: updatedState.phase,
      status: updatedState.status,
      turn: { turn_id: currentTurn.turn_id, role_id: currentTurn.assigned_role },
      payload: {
        spent_usd: updatedState.budget_status.spent_usd,
        limit_usd: updatedState.budget_status.spent_usd + updatedState.budget_status.remaining_usd,
        remaining_usd: updatedState.budget_status.remaining_usd,
        warning: budgetWarning,
      },
    });
  }

  if (updatedState.pending_phase_transition) {
    emitPendingLifecycleNotification(root, config, updatedState, 'phase_transition_pending', {
      from: updatedState.pending_phase_transition.from,
      to: updatedState.pending_phase_transition.to,
      gate: updatedState.pending_phase_transition.gate,
      requested_by_turn: updatedState.pending_phase_transition.requested_by_turn,
    }, currentTurn);
    emitRunEvent(root, 'gate_pending', {
      run_id: updatedState.run_id,
      phase: updatedState.phase,
      status: updatedState.status,
      payload: {
        gate_type: 'phase_transition',
        from: updatedState.pending_phase_transition.from,
        to: updatedState.pending_phase_transition.to,
      },
    });
  }

  if (updatedState.pending_run_completion) {
    emitPendingLifecycleNotification(root, config, updatedState, 'run_completion_pending', {
      gate: updatedState.pending_run_completion.gate,
      requested_by_turn: updatedState.pending_run_completion.requested_by_turn,
      requested_at: updatedState.pending_run_completion.requested_at,
    }, currentTurn);
    emitRunEvent(root, 'gate_pending', {
      run_id: updatedState.run_id,
      phase: updatedState.phase,
      status: updatedState.status,
      payload: { gate_type: 'run_completion' },
    });
  }

  if (updatedState.status === 'completed') {
    emitPendingLifecycleNotification(root, config, updatedState, 'run_completed', {
      completed_at: updatedState.completed_at || now,
      completed_via: completionResult?.action === 'complete' ? 'accept_turn' : 'accept_turn_direct',
      requested_by_turn: completionResult?.requested_by_turn || turnResult.turn_id,
    }, currentTurn);
    emitRunEvent(root, 'run_completed', {
      run_id: updatedState.run_id,
      phase: updatedState.phase,
      status: 'completed',
      payload: { completed_at: updatedState.completed_at || now },
    });
  }

  // Session checkpoint — non-fatal, written after every successful acceptance
  writeSessionCheckpoint(root, updatedState, 'turn_accepted', {
    role: historyEntry?.role,
  });

  return {
    ok: true,
    state: attachLegacyCurrentTurnAlias(updatedState),
    validation,
    accepted: historyEntry,
    gateResult,
    completionResult,
    hookResults,
    ...(budgetWarning ? { budget_warning: budgetWarning } : {}),
    ...(policyResult.warnings.length > 0 ? { policy_warnings: policyResult.warnings } : {}),
    ...(verificationReplay ? { verification_replay: summarizeVerificationReplay(verificationReplay) } : {}),
  };
}

/**
 * Reject a governed turn.
 *
 * 1. Preserve the invalid staged artifact under .agentxchain/dispatch/rejected/
 * 2. Increment current_turn.attempt or escalate if retries exhausted
 * 3. Clear staging file
 *
 * Does NOT append to history.jsonl or decision-ledger.jsonl.
 *
 * @param {string} root - project root directory
 * @param {object} config - normalized config
 * @param {object} validationResult - validation failure details. Accepts either
 *                                    `{ failed_stage, errors }` or the raw
 *                                    validator shape `{ stage, errors }`.
 * @param {string} [reason] - human-readable rejection reason
 * @returns {{ ok: boolean, error?: string, state?: object, escalated?: boolean }}
 */
export function rejectGovernedTurn(root, config, validationResult, reasonOrOptions, opts = {}) {
  const state = readState(root);
  if (!state) {
    return { ok: false, error: 'No governed state.json found' };
  }
  const normalizedOpts = typeof reasonOrOptions === 'object' && reasonOrOptions !== null && !Array.isArray(reasonOrOptions)
    ? reasonOrOptions
    : { ...opts, reason: reasonOrOptions };
  const targetResolution = resolveTurnTarget(state, normalizedOpts.turnId);
  if (!targetResolution.ok) {
    return targetResolution.error_code === 'target_required'
      ? {
          ok: false,
          error: 'Multiple active turns are present. Re-run reject-turn with --turn <turn_id>.',
          error_code: 'target_required',
        }
      : targetResolution;
  }
  const currentTurn = targetResolution.turn;

  const maxRetries = config.rules?.max_turn_retries ?? 2;
  const currentAttempt = currentTurn.attempt || 1;
  const canRetry = currentAttempt < maxRetries;
  const conflictContext = buildConflictContext(currentTurn);
  const isConflictReject = Boolean(conflictContext);

  // Preserve rejected artifact
  const rejectedDir = join(root, '.agentxchain', 'dispatch', 'rejected');
  mkdirSync(rejectedDir, { recursive: true });

  // Resolve staging path: prefer turn-scoped, fall back to flat
  const turnStagingRej = getTurnStagingResultPath(currentTurn.turn_id);
  const resolvedStagingRej = existsSync(join(root, turnStagingRej)) ? turnStagingRej : STAGING_PATH;
  const stagingFile = join(root, resolvedStagingRej);
  if (existsSync(stagingFile)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rejectedFile = join(rejectedDir, `${currentTurn.turn_id}-attempt-${currentAttempt}-${timestamp}.json`);
    try {
      const content = readFileSync(stagingFile, 'utf8');
      writeFileSync(rejectedFile, content);
    } catch {}
    try { unlinkSync(stagingFile); } catch {}
  }

  // Write rejection context for the next retry
  const rejectionContext = {
    turn_id: currentTurn.turn_id,
    attempt: currentAttempt,
    rejected_at: new Date().toISOString(),
    reason: normalizedOpts.reason || (isConflictReject ? 'file_conflict' : 'Validation failed'),
    validation_errors: validationResult?.errors || [],
    failed_stage: validationResult?.failed_stage || validationResult?.stage || (isConflictReject ? 'conflict' : 'unknown'),
  };

  if (conflictContext) {
    rejectionContext.conflict_context = conflictContext;
  }

  if (isConflictReject) {
    appendJsonl(root, LEDGER_PATH, {
      timestamp: rejectionContext.rejected_at,
      decision: 'conflict_rejected',
      turn_id: currentTurn.turn_id,
      attempt: currentAttempt,
      role: currentTurn.assigned_role,
      phase: state.phase,
      conflict: {
        conflicting_files: currentTurn.conflict_state.conflict_error?.conflicting_files || [],
        accepted_since_turn_ids: (currentTurn.conflict_state.conflict_error?.accepted_since || []).map((entry) => entry.turn_id),
        overlap_ratio: currentTurn.conflict_state.conflict_error?.overlap_ratio ?? 0,
      },
      resolution_chosen: 'reject_and_reassign',
      operator_reason: normalizedOpts.reason || null,
    });
  }

  if (canRetry) {
    const retryTurn = {
      ...currentTurn,
      attempt: currentAttempt + 1,
      status: 'retrying',
      last_rejection: rejectionContext,
      conflict_state: null,
      conflict_context: conflictContext,
    };

    if (isConflictReject) {
      const retryStartedAt = new Date().toISOString();
      retryTurn.baseline = captureBaseline(root);
      retryTurn.assigned_sequence = Math.max(
        state.turn_sequence || 0,
        currentTurn.assigned_sequence || 0,
      );
      retryTurn.started_at = retryStartedAt;
      retryTurn.deadline_at = new Date(Date.now() + 20 * 60 * 1000).toISOString();
      retryTurn.concurrent_with = Object.keys(getActiveTurns(state)).filter((turnId) => turnId !== currentTurn.turn_id);
    }

    // Increment attempt and keep the turn assigned
    const updatedState = {
      ...state,
      queued_phase_transition:
        isConflictReject && state.queued_phase_transition?.requested_by_turn === currentTurn.turn_id
          ? null
          : state.queued_phase_transition,
      active_turns: {
        ...getActiveTurns(state),
        [currentTurn.turn_id]: retryTurn,
      },
    };

    writeState(root, updatedState);
    emitRunEvent(root, 'turn_rejected', {
      run_id: updatedState.run_id,
      phase: updatedState.phase,
      status: updatedState.status,
      turn: { turn_id: currentTurn.turn_id, role_id: currentTurn.assigned_role },
      payload: {
        attempt: currentAttempt,
        retrying: true,
        reason: rejectionContext.reason,
        failed_stage: rejectionContext.failed_stage,
        ...(rejectionContext.validation_errors?.length ? { validation_errors: rejectionContext.validation_errors } : {}),
      },
    });
    return {
      ok: true,
      state: attachLegacyCurrentTurnAlias(updatedState),
      escalated: false,
      turn: updatedState.active_turns[currentTurn.turn_id],
    };
  }

  // Retries exhausted — escalate
  const exhaustedEscalationState = {
    ...state,
    status: 'blocked',
    active_turns: {
      ...getActiveTurns(state),
      [currentTurn.turn_id]: {
        ...currentTurn,
        status: 'failed',
        last_rejection: rejectionContext,
        conflict_state: null,
        conflict_context: conflictContext,
      },
    },
    blocked_on: `escalation:retries-exhausted:${currentTurn.assigned_role}`,
  };

  const updatedState = {
    ...exhaustedEscalationState,
    blocked_reason: buildBlockedReason({
      category: 'retries_exhausted',
      recovery: {
        typed_reason: 'retries_exhausted',
        owner: 'human',
        recovery_action: deriveEscalationRecoveryAction(exhaustedEscalationState, config, {
          turnRetained: true,
          turnId: currentTurn.turn_id,
        }),
        turn_retained: true,
        detail: `escalation:retries-exhausted:${currentTurn.assigned_role}`,
      },
      turnId: currentTurn.turn_id,
    }),
    escalation: {
      from_role: currentTurn.assigned_role,
      from_turn_id: currentTurn.turn_id,
      reason: `Turn rejected ${currentAttempt} times. Retries exhausted.`,
      validation_errors: validationResult?.errors || [],
      escalated_at: new Date().toISOString()
    }
  };

  writeState(root, updatedState);

  // DEC-RHTR-SPEC: Record retries-exhausted blocked outcome in cross-run history (non-fatal)
  recordRunHistory(root, updatedState, config, 'blocked');

  emitBlockedNotification(root, config, updatedState, {
    category: 'retries_exhausted',
    blockedOn: updatedState.blocked_on,
    recovery: updatedState.blocked_reason?.recovery || null,
  }, updatedState.active_turns[currentTurn.turn_id]);
  emitRunEvent(root, 'turn_rejected', {
    run_id: updatedState.run_id,
    phase: updatedState.phase,
    status: 'blocked',
    turn: { turn_id: currentTurn.turn_id, role_id: currentTurn.assigned_role },
    payload: {
      attempt: currentAttempt,
      retrying: false,
      escalated: true,
      reason: rejectionContext.reason,
      failed_stage: rejectionContext.failed_stage,
      ...(rejectionContext.validation_errors?.length ? { validation_errors: rejectionContext.validation_errors } : {}),
    },
  });
  emitRunEvent(root, 'run_blocked', {
    run_id: updatedState.run_id,
    phase: updatedState.phase,
    status: 'blocked',
    payload: { category: 'retries_exhausted' },
  });

  // Fire on_escalation hooks (advisory-only) after blocked state is persisted.
  const hooksConfig = config?.hooks || {};
  if (hooksConfig.on_escalation?.length > 0) {
    _fireOnEscalationHooks(root, hooksConfig, {
      blocked_reason: 'retries_exhausted',
      recovery_action: deriveEscalationRecoveryAction(updatedState, config, {
        turnRetained: true,
        turnId: currentTurn.turn_id,
      }),
      failed_turn_id: currentTurn.turn_id,
      failed_role: currentTurn.assigned_role,
      attempt_count: currentAttempt,
      last_error: validationResult?.errors?.[0] || 'retries_exhausted',
      run_id: updatedState.run_id,
    });
  }

  return {
    ok: true,
    state: attachLegacyCurrentTurnAlias(updatedState),
    escalated: true,
    turn: updatedState.active_turns[currentTurn.turn_id],
  };
}

/**
 * Approve a pending phase transition.
 *
 * When a gate with requires_human_approval passes structurally,
 * the run pauses with a pending_phase_transition. This function
 * advances the phase after explicit human approval.
 *
 * Runs `before_gate` hooks when config is provided. A blocking hook
 * or tamper detection aborts the approval and blocks the run.
 *
 * @param {string} root - project root directory
 * @param {object} [config] - normalized config (optional; required for hook support)
 * @returns {{ ok: boolean, error?: string, error_code?: string, state?: object, transition?: object, hookResults?: object }}
 */
export function approvePhaseTransition(root, config) {
  const state = readState(root);
  if (!state) {
    return { ok: false, error: 'No governed state.json found' };
  }
  if (!state.pending_phase_transition) {
    return { ok: false, error: 'No pending phase transition to approve' };
  }
  if (!canApprovePendingGate(state)) {
    return { ok: false, error: `Cannot approve transition: status is "${state.status}", expected "paused" or "blocked"` };
  }

  const transition = state.pending_phase_transition;

  // ── before_gate hooks ──────────────────────────────────────────────
  const hooksConfig = config?.hooks || {};
  if (hooksConfig.before_gate && hooksConfig.before_gate.length > 0) {
    const historyLength = readJsonlEntries(root, HISTORY_PATH).length;
    const gatePayload = {
      gate_type: 'phase_transition',
      current_phase: transition.from,
      target_phase: transition.to,
      gate_config: transition,
      history_length: historyLength,
    };
    const gateHooks = runHooks(root, hooksConfig, 'before_gate', gatePayload, {
      run_id: state.run_id,
    });

    if (!gateHooks.ok) {
      const hookName = gateHooks.blocker?.hook_name
        || gateHooks.results?.find((entry) => entry.hook_name)?.hook_name
        || 'unknown';
      const detail = gateHooks.blocker?.message
        || gateHooks.tamper?.message
        || `before_gate hook "${hookName}" blocked phase transition`;
      const blockedState = blockRunForHookIssue(root, state, {
        phase: 'before_gate',
        turnId: transition.requested_by_turn || null,
        hookName,
        detail,
        errorCode: gateHooks.tamper?.error_code || 'hook_blocked',
        turnRetained: false,
        notificationConfig: config,
      });
      return {
        ok: false,
        error: detail,
        error_code: gateHooks.tamper?.error_code || 'hook_blocked',
        state: blockedState,
        hookResults: gateHooks,
      };
    }
  }

  const updatedState = {
    ...state,
    phase: transition.to,
    phase_entered_at: new Date().toISOString(),
    status: 'active',
    blocked_on: null,
    blocked_reason: null,
    last_gate_failure: null,
    pending_phase_transition: null,
    phase_gate_status: {
      ...(state.phase_gate_status || {}),
      [transition.gate]: 'passed',
    },
  };

  writeState(root, updatedState);
  emitRunEvent(root, 'gate_approved', {
    run_id: updatedState.run_id,
    phase: updatedState.phase,
    status: 'active',
    payload: { gate_type: 'phase_transition', from: transition.from, to: transition.to },
  });
  emitRunEvent(root, 'phase_entered', {
    run_id: updatedState.run_id,
    phase: updatedState.phase,
    status: 'active',
    payload: {
      from: transition.from,
      to: transition.to,
      gate_id: transition.gate || 'no_gate',
      trigger: 'human_approved',
    },
  });

  // Session checkpoint — non-fatal
  writeSessionCheckpoint(root, updatedState, 'phase_approved');

  return {
    ok: true,
    state: attachLegacyCurrentTurnAlias(updatedState),
    transition,
  };
}

/**
 * Approve a pending run completion.
 *
 * When the final phase gate with requires_human_approval passes structurally,
 * the run pauses with a pending_run_completion. This function marks the run
 * as completed after explicit human approval.
 *
 * Runs `before_gate` hooks when config is provided. A blocking hook
 * or tamper detection aborts the approval and blocks the run.
 *
 * @param {string} root - project root directory
 * @param {object} [config] - normalized config (optional; required for hook support)
 * @returns {{ ok: boolean, error?: string, error_code?: string, state?: object, completion?: object, hookResults?: object }}
 */
export function approveRunCompletion(root, config) {
  const state = readState(root);
  if (!state) {
    return { ok: false, error: 'No governed state.json found' };
  }
  if (!state.pending_run_completion) {
    return { ok: false, error: 'No pending run completion to approve' };
  }
  if (!canApprovePendingGate(state)) {
    return { ok: false, error: `Cannot approve completion: status is "${state.status}", expected "paused" or "blocked"` };
  }

  const completion = state.pending_run_completion;

  // ── before_gate hooks ──────────────────────────────────────────────
  const hooksConfig = config?.hooks || {};
  if (hooksConfig.before_gate && hooksConfig.before_gate.length > 0) {
    const historyLength = readJsonlEntries(root, HISTORY_PATH).length;
    const gatePayload = {
      gate_type: 'run_completion',
      current_phase: state.phase,
      target_phase: null,
      gate_config: completion,
      history_length: historyLength,
    };
    const gateHooks = runHooks(root, hooksConfig, 'before_gate', gatePayload, {
      run_id: state.run_id,
    });

    if (!gateHooks.ok) {
      const hookName = gateHooks.blocker?.hook_name
        || gateHooks.results?.find((entry) => entry.hook_name)?.hook_name
        || 'unknown';
      const detail = gateHooks.blocker?.message
        || gateHooks.tamper?.message
        || `before_gate hook "${hookName}" blocked run completion`;
      const blockedState = blockRunForHookIssue(root, state, {
        phase: 'before_gate',
        turnId: completion.requested_by_turn || null,
        hookName,
        detail,
        errorCode: gateHooks.tamper?.error_code || 'hook_blocked',
        turnRetained: false,
        notificationConfig: config,
      });
      return {
        ok: false,
        error: detail,
        error_code: gateHooks.tamper?.error_code || 'hook_blocked',
        state: blockedState,
        hookResults: gateHooks,
      };
    }
  }

  const updatedState = {
    ...state,
    status: 'completed',
    completed_at: new Date().toISOString(),
    blocked_on: null,
    blocked_reason: null,
    last_gate_failure: null,
    pending_run_completion: null,
    phase_gate_status: {
      ...(state.phase_gate_status || {}),
      [completion.gate]: 'passed',
    },
  };

  writeState(root, updatedState);

  emitPendingLifecycleNotification(root, config, updatedState, 'run_completed', {
    completed_at: updatedState.completed_at,
    completed_via: 'approve_run_completion',
    gate: completion.gate,
    requested_by_turn: completion.requested_by_turn || null,
  }, completion.requested_by_turn ? getActiveTurns(state)[completion.requested_by_turn] || null : null);
  emitRunEvent(root, 'gate_approved', {
    run_id: updatedState.run_id,
    phase: updatedState.phase,
    status: 'completed',
    payload: { gate_type: 'run_completion' },
  });
  emitRunEvent(root, 'run_completed', {
    run_id: updatedState.run_id,
    phase: updatedState.phase,
    status: 'completed',
    payload: { completed_at: updatedState.completed_at },
  });

  // Session checkpoint — non-fatal
  writeSessionCheckpoint(root, updatedState, 'run_completed');

  // Run history — non-fatal
  recordRunHistory(root, updatedState, config, 'completed');

  return {
    ok: true,
    state: attachLegacyCurrentTurnAlias(updatedState),
    completion,
  };
}

// ── Routing Helpers ─────────────────────────────────────────────────────────

/**
 * Derive the next recommended role after an accepted turn.
 *
 * Rules:
 *   - If proposed_next_role is routing-legal for the current phase and not 'human', use it
 *   - Otherwise, use the current phase entry_role
 *   - After escalation or human pause, clear recommendation (returns null)
 *
 * @param {object} turnResult — the accepted turn result
 * @param {object} state — the current state
 * @param {object} config — normalized config
 * @returns {string|null}
 */
function deriveNextRecommendedRole(turnResult, state, config) {
  if (turnResult.status === 'needs_human' || turnResult.status === 'blocked') {
    return null;
  }

  const proposed = turnResult.proposed_next_role;
  if (!proposed || proposed === 'human') return null;

  // Check if proposed is routing-legal for the current phase
  const phase = state.phase;
  const routing = config.routing?.[phase];
  if (routing?.allowed_next_roles) {
    if (routing.allowed_next_roles.includes(proposed)) {
      return proposed;
    }
  }

  // Fall back to phase entry_role
  return routing?.entry_role || null;
}

export {
  STATE_PATH,
  HISTORY_PATH,
  LEDGER_PATH,
  STAGING_PATH,
  TALK_PATH,
};
