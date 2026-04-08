/**
 * Gate evaluator — pure library for phase exit gate evaluation.
 *
 * Implements the frozen spec (§40-§43):
 *
 *   - evaluatePhaseExit() is a pure function: (state, config, acceptedTurn, root) → GateResult
 *   - Phase advancement happens only on accepted turns
 *   - phase_transition_request must be explicitly present in the turn result
 *   - Human-approval gates pause the run instead of auto-advancing
 *
 * Rules from §43:
 *   Rule 1: No phase_transition_request → stay in current phase
 *   Rule 2: Unknown target phase → gate_error
 *   Rule 3: Request present but gate fails → accept turn, stay in phase
 *   Rule 4: Request present + gate passes (no human approval) → advance immediately
 *   Rule 5: Request present + gate passes + requires_human_approval → pause with pending_phase_transition
 *   Rule 6: Acceptance never auto-assigns the next turn
 */

import { existsSync } from 'fs';
import { join } from 'path';
import {
  evaluateArtifactSemantics,
  evaluateWorkflowGateSemantics,
  getSemanticIdForPath,
} from './workflow-gate-semantics.js';

function getWorkflowArtifactsForPhase(config, phase) {
  const artifacts = config?.workflow_kit?.phases?.[phase]?.artifacts;
  return Array.isArray(artifacts) ? artifacts : [];
}

function buildEffectiveGateArtifacts(config, gateDef, phase) {
  const byPath = new Map();

  if (Array.isArray(gateDef?.requires_files)) {
    for (const filePath of gateDef.requires_files) {
      byPath.set(filePath, {
        path: filePath,
        required: true,
        useLegacySemantics: true,
        semanticChecks: [],
      });
    }
  }

  for (const artifact of getWorkflowArtifactsForPhase(config, phase)) {
    if (!artifact?.path) {
      continue;
    }

    const existing = byPath.get(artifact.path) || {
      path: artifact.path,
      required: false,
      useLegacySemantics: false,
      semanticChecks: [],
      owned_by: null,
    };

    existing.required = existing.required || artifact.required !== false;

    if (artifact.owned_by && typeof artifact.owned_by === 'string') {
      existing.owned_by = artifact.owned_by;
    }

    if (artifact.semantics) {
      const legacySemanticId = existing.useLegacySemantics ? getSemanticIdForPath(artifact.path) : null;
      if (artifact.semantics !== legacySemanticId) {
        existing.semanticChecks.push({
          semantics: artifact.semantics,
          semantics_config: artifact.semantics_config || null,
        });
      }
    }

    byPath.set(artifact.path, existing);
  }

  return [...byPath.values()];
}

function addMissingFile(result, filePath) {
  if (!result.missing_files.includes(filePath)) {
    result.missing_files.push(filePath);
  }
}

function prefixSemanticReason(filePath, reason) {
  if (!reason || reason.includes(filePath)) {
    return reason;
  }
  return `${filePath}: ${reason}`;
}

function hasRoleParticipationInPhase(state, phase, roleId) {
  const history = state?.history;
  if (!Array.isArray(history)) {
    return false;
  }
  return history.some(
    turn => turn.phase === phase && turn.role === roleId && turn.status === 'accepted',
  );
}

function evaluateGateArtifacts({ root, config, gateDef, phase, result, state }) {
  const failures = [];
  const artifacts = buildEffectiveGateArtifacts(config, gateDef, phase);

  for (const artifact of artifacts) {
    const absPath = join(root, artifact.path);
    if (!existsSync(absPath)) {
      if (artifact.required) {
        addMissingFile(result, artifact.path);
        failures.push(`Required file missing: ${artifact.path}`);
      }
      continue;
    }

    if (artifact.useLegacySemantics) {
      const semanticCheck = evaluateWorkflowGateSemantics(root, artifact.path);
      if (semanticCheck && !semanticCheck.ok) {
        failures.push(semanticCheck.reason);
      }
    }

    for (const semantic of artifact.semanticChecks) {
      const semanticCheck = evaluateArtifactSemantics(root, {
        path: artifact.path,
        semantics: semantic.semantics,
        semantics_config: semantic.semantics_config,
      });
      if (semanticCheck && !semanticCheck.ok) {
        failures.push(prefixSemanticReason(artifact.path, semanticCheck.reason));
      }
    }

    // Charter enforcement: verify owning role participated in this phase
    if (artifact.owned_by && !hasRoleParticipationInPhase(state, phase, artifact.owned_by)) {
      failures.push(
        `"${artifact.path}" requires participation from role "${artifact.owned_by}" in phase "${phase}", but no accepted turn from that role was found`,
      );
    }
  }

  return failures;
}

/**
 * Evaluate whether the current phase exit gate is satisfied.
 *
 * @param {object} params
 * @param {object} params.state - current run state (post-acceptance)
 * @param {object} params.config - normalized config
 * @param {object} params.acceptedTurn - the accepted turn result
 * @param {string} params.root - project root directory
 * @returns {GateResult}
 *
 * @typedef {object} GateResult
 * @property {string|null} gate_id - the gate that was evaluated, or null if no gate
 * @property {boolean} passed - whether all predicates passed
 * @property {boolean} blocked_by_human_approval - gate passed structurally but needs human sign-off
 * @property {string[]} reasons - human-readable failure reasons
 * @property {string[]} missing_files - files required by gate but not found
 * @property {boolean} missing_verification - verification required but not passed
 * @property {string|null} next_phase - the target phase if transition was requested and gate passed
 * @property {string|null} transition_request - the raw phase_transition_request value
 * @property {'no_request'|'unknown_phase'|'gate_failed'|'advance'|'awaiting_human_approval'|'no_gate'} action
 */
export function evaluatePhaseExit({ state, config, acceptedTurn, root }) {
  const currentPhase = state.phase;
  const transitionRequest = acceptedTurn.phase_transition_request || null;

  const baseResult = {
    gate_id: null,
    passed: false,
    blocked_by_human_approval: false,
    reasons: [],
    missing_files: [],
    missing_verification: false,
    next_phase: null,
    transition_request: transitionRequest,
    action: 'no_request',
  };

  // Rule 1: No phase_transition_request → stay in current phase
  if (!transitionRequest) {
    return { ...baseResult, action: 'no_request' };
  }

  // Rule 2: Unknown target phase → error
  const routing = config.routing || {};
  if (!routing[transitionRequest]) {
    return {
      ...baseResult,
      action: 'unknown_phase',
      reasons: [`Requested phase "${transitionRequest}" does not exist in routing config`],
    };
  }

  const invalidOrderReason = getInvalidPhaseTransitionReason(currentPhase, transitionRequest, routing);
  if (invalidOrderReason) {
    return {
      ...baseResult,
      action: 'gate_failed',
      reasons: [invalidOrderReason],
    };
  }

  // Find the exit gate for the current phase
  const currentRouting = routing[currentPhase];
  if (!currentRouting || !currentRouting.exit_gate) {
    // No gate defined for current phase → auto-advance
    return {
      ...baseResult,
      passed: true,
      next_phase: transitionRequest,
      action: 'advance',
    };
  }

  const gateId = currentRouting.exit_gate;
  const gateDef = (config.gates || {})[gateId];

  if (!gateDef) {
    // Gate referenced but not defined → treat as no gate (advance)
    return {
      ...baseResult,
      gate_id: gateId,
      passed: true,
      next_phase: transitionRequest,
      action: 'advance',
      reasons: [`Gate "${gateId}" referenced by routing but not defined in gates config — treated as open`],
    };
  }

  // Evaluate gate predicates
  const result = {
    ...baseResult,
    gate_id: gateId,
  };

  const failures = [];

  // Predicate: requires_files + ownership
  failures.push(...evaluateGateArtifacts({
    root,
    config,
    gateDef,
    phase: currentPhase,
    result,
    state,
  }));

  // Predicate: requires_verification_pass
  if (gateDef.requires_verification_pass) {
    const verificationStatus = acceptedTurn.verification?.status;
    if (verificationStatus !== 'pass' && verificationStatus !== 'attested_pass') {
      result.missing_verification = true;
      failures.push(`Verification status is "${verificationStatus || 'missing'}", requires "pass" or "attested_pass"`);
    }
  }

  if (failures.length > 0) {
    // Rule 3: Gate fails → accept turn but stay in phase
    result.passed = false;
    result.reasons = failures;
    result.action = 'gate_failed';
    return result;
  }

  // All structural predicates passed
  result.passed = true;
  result.next_phase = transitionRequest;

  // Rule 5: requires_human_approval → pause instead of advancing
  if (gateDef.requires_human_approval) {
    result.blocked_by_human_approval = true;
    result.action = 'awaiting_human_approval';
    return result;
  }

  // Rule 4: Gate passes, no human approval needed → advance
  result.action = 'advance';
  return result;
}

/**
 * Evaluate whether a run should complete (terminal state).
 *
 * Called when a turn result contains `run_completion_request: true` in the
 * final phase. Uses the same gate predicate system as phase transitions.
 *
 * @param {object} params
 * @param {object} params.state - current run state (post-acceptance)
 * @param {object} params.config - normalized config
 * @param {object} params.acceptedTurn - the accepted turn result
 * @param {string} params.root - project root directory
 * @returns {RunCompletionResult}
 *
 * @typedef {object} RunCompletionResult
 * @property {string|null} gate_id - the gate evaluated, or null
 * @property {boolean} passed - whether all predicates passed
 * @property {boolean} blocked_by_human_approval - gate passed structurally but needs human sign-off
 * @property {string[]} reasons - human-readable failure reasons
 * @property {string[]} missing_files - files required by gate but not found
 * @property {boolean} missing_verification - verification required but not passed
 * @property {'no_request'|'not_final_phase'|'gate_failed'|'complete'|'awaiting_human_approval'} action
 */
export function evaluateRunCompletion({ state, config, acceptedTurn, root }) {
  const baseResult = {
    gate_id: null,
    passed: false,
    blocked_by_human_approval: false,
    reasons: [],
    missing_files: [],
    missing_verification: false,
    action: 'no_request',
  };

  // Must have explicit run_completion_request
  if (!acceptedTurn.run_completion_request) {
    return { ...baseResult, action: 'no_request' };
  }

  // Must be in the final phase
  const phases = getPhaseOrder(config.routing || {});
  const currentPhase = state.phase;
  if (phases.length > 0 && phases[phases.length - 1] !== currentPhase) {
    return {
      ...baseResult,
      action: 'not_final_phase',
      reasons: [`Run completion requested but current phase "${currentPhase}" is not the final phase "${phases[phases.length - 1]}"`],
    };
  }

  // Find the exit gate for the current (final) phase
  const currentRouting = (config.routing || {})[currentPhase];
  if (!currentRouting || !currentRouting.exit_gate) {
    // No gate → auto-complete
    return { ...baseResult, passed: true, action: 'complete' };
  }

  const gateId = currentRouting.exit_gate;
  const gateDef = (config.gates || {})[gateId];

  if (!gateDef) {
    // Gate referenced but not defined → complete
    return {
      ...baseResult,
      gate_id: gateId,
      passed: true,
      action: 'complete',
      reasons: [`Gate "${gateId}" referenced but not defined — treated as open`],
    };
  }

  // Evaluate gate predicates (same logic as phase exit)
  const result = { ...baseResult, gate_id: gateId };
  const failures = [];

  failures.push(...evaluateGateArtifacts({
    root,
    config,
    gateDef,
    phase: currentPhase,
    result,
    state,
  }));

  if (gateDef.requires_verification_pass) {
    const verificationStatus = acceptedTurn.verification?.status;
    if (verificationStatus !== 'pass' && verificationStatus !== 'attested_pass') {
      result.missing_verification = true;
      failures.push(`Verification status is "${verificationStatus || 'missing'}", requires "pass" or "attested_pass"`);
    }
  }

  if (failures.length > 0) {
    result.passed = false;
    result.reasons = failures;
    result.action = 'gate_failed';
    return result;
  }

  // All structural predicates passed
  result.passed = true;

  if (gateDef.requires_human_approval) {
    result.blocked_by_human_approval = true;
    result.action = 'awaiting_human_approval';
    return result;
  }

  result.action = 'complete';
  return result;
}

/**
 * Determine the phase ordering from routing config.
 * Returns the list of phase names in declaration order.
 *
 * @param {object} routing - routing config object
 * @returns {string[]}
 */
export function getPhaseOrder(routing) {
  return Object.keys(routing || {});
}

/**
 * Return the next declared phase after the current phase, or null when the
 * current phase is final or not part of the routing config.
 *
 * @param {string} currentPhase
 * @param {object} routing
 * @returns {string|null}
 */
export function getNextPhase(currentPhase, routing) {
  const phases = getPhaseOrder(routing || {});
  const currentIndex = phases.indexOf(currentPhase);
  if (currentIndex === -1 || currentIndex >= phases.length - 1) {
    return null;
  }
  return phases[currentIndex + 1];
}

/**
 * Validate that a requested phase transition follows the declared routing
 * order. Returns null when the request is valid.
 *
 * @param {string} currentPhase
 * @param {string} requestedPhase
 * @param {object} routing
 * @returns {string|null}
 */
export function getInvalidPhaseTransitionReason(currentPhase, requestedPhase, routing) {
  const nextPhase = getNextPhase(currentPhase, routing);
  if (!nextPhase) {
    return `phase_transition_request "${requestedPhase}" is invalid in final phase "${currentPhase}"; use run_completion_request instead.`;
  }
  if (requestedPhase !== nextPhase) {
    return `phase_transition_request "${requestedPhase}" is invalid from phase "${currentPhase}"; next phase is "${nextPhase}".`;
  }
  return null;
}

/**
 * Check if a phase is the final phase in the routing config.
 *
 * @param {string} phase - the phase to check
 * @param {object} routing - routing config object
 * @returns {boolean}
 */
export function isFinalPhase(phase, routing) {
  const phases = getPhaseOrder(routing || {});
  return phases.length > 0 && phases[phases.length - 1] === phase;
}
