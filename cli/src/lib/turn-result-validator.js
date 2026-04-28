/**
 * Staged turn-result validator — the acceptance boundary for governed mode.
 *
 * Implements the 5-stage validation pipeline from the frozen spec (§9):
 *   A. Schema validation — structural JSON correctness
 *   B. Assignment validation — identity fields match current state
 *   C. Artifact validation — write authority / file-change consistency
 *   D. Verification validation — evidence consistency
 *   E. Protocol compliance — challenge requirement, routing legality
 *
 * Each stage returns a typed error (§10 error taxonomy) or passes.
 * The pipeline short-circuits on the first stage failure.
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { getActiveTurn } from './governed-state.js';
import { getInvalidPhaseTransitionReason } from './gate-evaluator.js';
import { validateIdleExpansionTurnResult } from './idle-expansion-result-validator.js';

// ── Constants ────────────────────────────────────────────────────────────────

const STAGING_PATH = '.agentxchain/staging/turn-result.json';

const VALID_STATUSES = ['completed', 'blocked', 'needs_human', 'failed'];
const VALID_SEVERITIES = ['low', 'medium', 'high', 'blocking'];
const VALID_CATEGORIES = ['implementation', 'architecture', 'scope', 'process', 'quality', 'release'];
const VALID_ARTIFACT_TYPES = ['workspace', 'patch', 'commit', 'review'];
const VALID_VERIFICATION_STATUSES = ['pass', 'fail', 'skipped'];
const VALID_OBJECTION_STATUSES = ['raised', 'acknowledged', 'resolved', 'escalated', 'resolved_by_human', 'resolved_by_director'];

const RESERVED_PATHS = [
  '.agentxchain/state.json',
  '.agentxchain/history.jsonl',
  '.agentxchain/decision-ledger.jsonl',
  '.agentxchain/lock.json',
];

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Validate a staged turn result against state and config.
 *
 * @param {string} root          — project root directory
 * @param {object} state         — parsed .agentxchain/state.json
 * @param {object} config        — normalized config (from loadNormalizedConfig)
 * @param {object} [opts]
 * @param {string} [opts.stagingPath] — override the default staging path
 * @returns {{ ok: boolean, stage: string|null, error_class: string|null, errors: string[], warnings: string[] }}
 */
export function validateStagedTurnResult(root, state, config, opts = {}) {
  const stagingRel = opts.stagingPath || STAGING_PATH;
  const stagingAbs = join(root, stagingRel);

  // ── Read the staged file ───────────────────────────────────────────────
  if (!existsSync(stagingAbs)) {
    return result('schema', 'schema_error', [`Staged turn result not found: ${stagingRel}`]);
  }

  let raw;
  try {
    raw = readFileSync(stagingAbs, 'utf8');
  } catch (err) {
    return result('schema', 'schema_error', [`Cannot read ${stagingRel}: ${err.message}`]);
  }

  let turnResult;
  try {
    turnResult = JSON.parse(raw);
  } catch (err) {
    return result('schema', 'schema_error', [`Invalid JSON in ${stagingRel}: ${err.message}`]);
  }

  const activeTurn = getActiveTurn(state) || state?.current_turn || null;

  // ── Pre-validation normalization ───────────────────────────────────────
  // Build context for role/phase-aware normalization rules
  const normContext = {};
  if (state) {
    normContext.phase = state.phase;
    if (state.run_id) {
      normContext.runId = state.run_id;
    }
    // Prefer active_turns (the persisted schema field); fall back to the
    // current_turn compatibility alias for callers that pass a state shape
    // built outside loadProjectState() (e.g. raw fixtures). Both surfaces are
    // live per DEC-CURRENT-TURN-COMPAT-ALIAS-001 — current_turn is not legacy.
    if (activeTurn) {
      const roleKey = activeTurn.assigned_role || activeTurn.role;
      normContext.assignedRole = roleKey;
      if (activeTurn.turn_id) {
        normContext.turnId = activeTurn.turn_id;
      }
      if (activeTurn.run_id) {
        normContext.activeTurnRunId = activeTurn.run_id;
      }
      if (activeTurn.runtime_id) {
        normContext.runtimeId = activeTurn.runtime_id;
      }
      const roleConfig = config?.roles?.[roleKey];
      if (roleConfig) {
        normContext.writeAuthority = roleConfig.write_authority;
      }
    }
  }
  if (opts.normalizeArtifactType === 'review') {
    normContext.forceReviewArtifact = true;
  }
  const { normalized, corrections, normalizationEvents } = normalizeTurnResult(turnResult, config, normContext);
  turnResult = normalized;
  const sidecarResult = maybeAttachIdleExpansionSidecar(
    root,
    stagingRel,
    turnResult,
    buildIdleExpansionValidationContext(state, opts, activeTurn),
  );
  turnResult = sidecarResult.turnResult;
  const normWarnings = [
    ...corrections.map((c) => `[normalized] ${c}`),
    ...sidecarResult.warnings,
  ];

  // ── Stage A: Schema Validation ─────────────────────────────────────────
  const schemaErrors = validateSchema(turnResult);
  if (schemaErrors.length > 0) {
    return result('schema', 'schema_error', schemaErrors);
  }

  const idleExpansionResult = validateIdleExpansionTurnResult(turnResult, buildIdleExpansionValidationContext(state, opts, activeTurn));
  if (idleExpansionResult.errors.length > 0) {
    return result('schema', 'schema_error', idleExpansionResult.errors, idleExpansionResult.warnings);
  }

  // ── Stage B: Assignment Validation ─────────────────────────────────────
  const assignmentErrors = validateAssignment(turnResult, state);
  if (assignmentErrors.length > 0) {
    return result('assignment', 'assignment_error', assignmentErrors);
  }

  // ── Stage C: Artifact Validation ───────────────────────────────────────
  const artifactResult = validateArtifact(turnResult, config);
  if (artifactResult.errors.length > 0) {
    return result('artifact', 'artifact_error', artifactResult.errors, artifactResult.warnings);
  }

  // ── Stage D: Verification Validation ───────────────────────────────────
  const verificationResult = validateVerification(turnResult);
  if (verificationResult.errors.length > 0) {
    return result('verification', 'verification_error', verificationResult.errors, verificationResult.warnings);
  }

  // ── Stage E: Protocol Compliance ───────────────────────────────────────
  const protocolResult = validateProtocol(turnResult, state, config);
  if (protocolResult.errors.length > 0) {
    return result('protocol', 'protocol_error', protocolResult.errors, protocolResult.warnings);
  }

  // ── All stages passed ──────────────────────────────────────────────────
  const allWarnings = [
    ...normWarnings,
    ...artifactResult.warnings,
    ...verificationResult.warnings,
    ...protocolResult.warnings,
  ];

  return {
    ok: true,
    stage: null,
    error_class: null,
    errors: [],
    warnings: allWarnings,
    turnResult,
    normalizations: corrections,
    normalization_events: normalizationEvents,
  };
}

// ── Stage A: Schema Validation ───────────────────────────────────────────────

function validateSchema(tr) {
  const errors = [];

  if (tr === null || typeof tr !== 'object' || Array.isArray(tr)) {
    return ['Turn result must be a JSON object.'];
  }

  // Required top-level fields
  const required = [
    'schema_version', 'run_id', 'turn_id', 'role', 'runtime_id',
    'status', 'summary', 'decisions', 'objections', 'files_changed',
    'verification', 'artifact', 'proposed_next_role',
  ];
  for (const field of required) {
    if (!(field in tr)) {
      errors.push(`Missing required field: ${field}`);
    }
  }
  if (errors.length > 0) return errors; // can't validate further without required fields

  // Type and enum checks
  if (tr.schema_version !== '1.0') {
    errors.push(`schema_version must be "1.0", got "${tr.schema_version}".`);
  }
  if (typeof tr.run_id !== 'string' || !tr.run_id.trim()) {
    errors.push('run_id must be a non-empty string.');
  }
  if (typeof tr.turn_id !== 'string' || !tr.turn_id.trim()) {
    errors.push('turn_id must be a non-empty string.');
  }
  if (typeof tr.role !== 'string' || !/^[a-z0-9_-]+$/.test(tr.role)) {
    errors.push('role must match pattern ^[a-z0-9_-]+$.');
  }
  if (typeof tr.runtime_id !== 'string' || !tr.runtime_id.trim()) {
    errors.push('runtime_id must be a non-empty string.');
  }
  if (!VALID_STATUSES.includes(tr.status)) {
    errors.push(`status must be one of: ${VALID_STATUSES.join(', ')}. Got "${tr.status}".`);
  }
  if (typeof tr.summary !== 'string' || !tr.summary.trim()) {
    errors.push('summary must be a non-empty string.');
  }
  if (typeof tr.proposed_next_role !== 'string' || !/^[a-z0-9_-]+$|^human$/.test(tr.proposed_next_role)) {
    errors.push('proposed_next_role must match ^[a-z0-9_-]+$ or be "human".');
  }

  // Arrays
  if (!Array.isArray(tr.decisions)) {
    errors.push('decisions must be an array.');
  } else {
    for (let i = 0; i < tr.decisions.length; i++) {
      errors.push(...validateDecision(tr.decisions[i], i));
    }
  }

  if (!Array.isArray(tr.objections)) {
    errors.push('objections must be an array.');
  } else {
    for (let i = 0; i < tr.objections.length; i++) {
      errors.push(...validateObjection(tr.objections[i], i));
    }
  }

  if (!Array.isArray(tr.files_changed)) {
    errors.push('files_changed must be an array.');
  } else {
    for (let i = 0; i < tr.files_changed.length; i++) {
      if (typeof tr.files_changed[i] !== 'string') {
        errors.push(`files_changed[${i}] must be a string.`);
      }
    }
  }

  if ('artifacts_created' in tr) {
    if (!Array.isArray(tr.artifacts_created)) {
      errors.push('artifacts_created must be an array.');
    } else {
      for (let i = 0; i < tr.artifacts_created.length; i++) {
        if (typeof tr.artifacts_created[i] !== 'string') {
          errors.push(`artifacts_created[${i}] must be a string.`);
        }
      }
    }
  }

  // Verification object
  if (tr.verification === null || typeof tr.verification !== 'object' || Array.isArray(tr.verification)) {
    errors.push('verification must be an object.');
  } else {
    if (!('status' in tr.verification)) {
      errors.push('verification.status is required.');
    } else if (!VALID_VERIFICATION_STATUSES.includes(tr.verification.status)) {
      errors.push(`verification.status must be one of: ${VALID_VERIFICATION_STATUSES.join(', ')}.`);
    }
  }

  // Artifact object
  if (tr.artifact === null || typeof tr.artifact !== 'object' || Array.isArray(tr.artifact)) {
    errors.push('artifact must be an object.');
  } else {
    if (!('type' in tr.artifact)) {
      errors.push('artifact.type is required.');
    } else if (!VALID_ARTIFACT_TYPES.includes(tr.artifact.type)) {
      errors.push(`artifact.type must be one of: ${VALID_ARTIFACT_TYPES.join(', ')}.`);
    }
  }

  // Optional fields type checks
  if ('phase_transition_request' in tr && tr.phase_transition_request !== null && typeof tr.phase_transition_request !== 'string') {
    errors.push('phase_transition_request must be a string or null.');
  }
  if ('run_completion_request' in tr && tr.run_completion_request !== null && typeof tr.run_completion_request !== 'boolean') {
    errors.push('run_completion_request must be a boolean or null.');
  }
  if ('needs_human_reason' in tr && tr.needs_human_reason !== null && typeof tr.needs_human_reason !== 'string') {
    errors.push('needs_human_reason must be a string or null.');
  }
  if ('cost' in tr && tr.cost !== null) {
    if (typeof tr.cost !== 'object' || Array.isArray(tr.cost)) {
      errors.push('cost must be an object.');
    }
  }

  if ('delegations' in tr) {
    if (!Array.isArray(tr.delegations)) {
      errors.push('delegations must be an array.');
    } else {
      for (let i = 0; i < tr.delegations.length; i++) {
        errors.push(...validateDelegation(tr.delegations[i], i));
      }
    }
  }

  errors.push(...collectUnfilledTemplatePlaceholderErrors(tr));

  return errors;
}

function collectUnfilledTemplatePlaceholderErrors(tr) {
  const errors = [];

  checkPlaceholder(errors, 'summary', tr.summary);
  checkPlaceholder(errors, 'proposed_next_role', tr.proposed_next_role);

  if (Array.isArray(tr.decisions)) {
    for (let i = 0; i < tr.decisions.length; i++) {
      const decision = tr.decisions[i];
      checkPlaceholder(errors, `decisions[${i}].statement`, decision?.statement);
      checkPlaceholder(errors, `decisions[${i}].rationale`, decision?.rationale);
    }
  }

  if (Array.isArray(tr.objections)) {
    for (let i = 0; i < tr.objections.length; i++) {
      const objection = tr.objections[i];
      checkPlaceholder(errors, `objections[${i}].against_turn_id`, objection?.against_turn_id);
      checkPlaceholder(errors, `objections[${i}].statement`, objection?.statement);
    }
  }

  if (Array.isArray(tr.files_changed)) {
    for (let i = 0; i < tr.files_changed.length; i++) {
      checkPlaceholder(errors, `files_changed[${i}]`, tr.files_changed[i]);
    }
  }

  const verification = tr.verification;
  if (verification && typeof verification === 'object' && !Array.isArray(verification)) {
    if (Array.isArray(verification.commands)) {
      for (let i = 0; i < verification.commands.length; i++) {
        checkPlaceholder(errors, `verification.commands[${i}]`, verification.commands[i]);
      }
    }
    checkPlaceholder(errors, 'verification.evidence_summary', verification.evidence_summary);

    if (Array.isArray(verification.machine_evidence)) {
      for (let i = 0; i < verification.machine_evidence.length; i++) {
        checkPlaceholder(
          errors,
          `verification.machine_evidence[${i}].command`,
          verification.machine_evidence[i]?.command
        );
      }
    }
  }

  return errors;
}

function checkPlaceholder(errors, fieldPath, value) {
  if (typeof value === 'string' && /^<[^>]+>$/.test(value)) {
    errors.push(`${fieldPath} contains an unfilled template placeholder: "${value}".`);
  }
}

const VALID_DURABILITIES = ['run', 'repo'];

function validateDecision(dec, index) {
  const errors = [];
  const prefix = `decisions[${index}]`;

  if (dec === null || typeof dec !== 'object') {
    return [`${prefix} must be an object.`];
  }
  if (typeof dec.id !== 'string' || !/^DEC-\d+$/.test(dec.id)) {
    errors.push(`${prefix}.id must match pattern DEC-NNN.`);
  }
  if (!VALID_CATEGORIES.includes(dec.category)) {
    errors.push(`${prefix}.category must be one of: ${VALID_CATEGORIES.join(', ')}.`);
  }
  if (typeof dec.statement !== 'string' || !dec.statement.trim()) {
    errors.push(`${prefix}.statement must be a non-empty string.`);
  }
  if (typeof dec.rationale !== 'string' || !dec.rationale.trim()) {
    errors.push(`${prefix}.rationale must be a non-empty string.`);
  }
  if (dec.durability !== undefined && !VALID_DURABILITIES.includes(dec.durability)) {
    errors.push(`${prefix}.durability must be one of: ${VALID_DURABILITIES.join(', ')}.`);
  }
  if (dec.overrides !== undefined) {
    if (typeof dec.overrides !== 'string' || !/^DEC-\d+$/.test(dec.overrides)) {
      errors.push(`${prefix}.overrides must match pattern DEC-NNN.`);
    }
    if (dec.overrides === dec.id) {
      errors.push(`${prefix}.overrides cannot reference itself.`);
    }
  }
  return errors;
}

function validateObjection(obj, index) {
  const errors = [];
  const prefix = `objections[${index}]`;

  if (obj === null || typeof obj !== 'object') {
    return [`${prefix} must be an object.`];
  }
  if (typeof obj.id !== 'string' || !/^OBJ-\d+$/.test(obj.id)) {
    errors.push(`${prefix}.id must match pattern OBJ-NNN.`);
  }
  if (!VALID_SEVERITIES.includes(obj.severity)) {
    errors.push(`${prefix}.severity must be one of: ${VALID_SEVERITIES.join(', ')}.`);
  }
  if (typeof obj.statement !== 'string' || !obj.statement.trim()) {
    errors.push(`${prefix}.statement must be a non-empty string.`);
  }
  if ('status' in obj && !VALID_OBJECTION_STATUSES.includes(obj.status)) {
    errors.push(`${prefix}.status must be one of: ${VALID_OBJECTION_STATUSES.join(', ')}.`);
  }
  return errors;
}

function validateDelegation(del, index) {
  const errors = [];
  const prefix = `delegations[${index}]`;

  if (del === null || typeof del !== 'object' || Array.isArray(del)) {
    return [`${prefix} must be an object.`];
  }
  if (typeof del.id !== 'string' || !/^del-\d{3}$/.test(del.id)) {
    errors.push(`${prefix}.id must match pattern del-NNN.`);
  }
  if (typeof del.to_role !== 'string' || !/^[a-z0-9_-]+$/.test(del.to_role)) {
    errors.push(`${prefix}.to_role must match pattern ^[a-z0-9_-]+$.`);
  }
  if (typeof del.charter !== 'string' || !del.charter.trim()) {
    errors.push(`${prefix}.charter must be a non-empty string.`);
  }
  if (!Array.isArray(del.acceptance_contract) || del.acceptance_contract.length === 0) {
    errors.push(`${prefix}.acceptance_contract must be a non-empty array.`);
  } else {
    for (let i = 0; i < del.acceptance_contract.length; i++) {
      if (typeof del.acceptance_contract[i] !== 'string' || !del.acceptance_contract[i].trim()) {
        errors.push(`${prefix}.acceptance_contract[${i}] must be a non-empty string.`);
      }
    }
  }
  if (del.required_decision_ids !== undefined) {
    if (!Array.isArray(del.required_decision_ids) || del.required_decision_ids.length === 0) {
      errors.push(`${prefix}.required_decision_ids must be a non-empty array when provided.`);
    } else {
      const seen = new Set();
      for (let i = 0; i < del.required_decision_ids.length; i++) {
        const id = del.required_decision_ids[i];
        if (typeof id !== 'string' || !/^DEC-\d+$/.test(id)) {
          errors.push(`${prefix}.required_decision_ids[${i}] must match pattern DEC-NNN.`);
          continue;
        }
        if (seen.has(id)) {
          errors.push(`${prefix}.required_decision_ids contains duplicate "${id}".`);
          continue;
        }
        seen.add(id);
      }
    }
  }

  return errors;
}

function buildIdleExpansionValidationContext(state, opts, activeTurn) {
  const source = activeTurn?.intake_context?.source || null;
  const context = activeTurn?.idle_expansion_context || activeTurn?.intake_context?.idle_expansion || {};
  return {
    required: source === 'vision_idle_expansion',
    expansionIteration: opts.idleExpansionIteration
      ?? context.expansion_iteration
      ?? state?.idle_expansion?.current_iteration
      ?? state?.continuous?.expansion_iteration
      ?? null,
    visionHeadingsSnapshot: opts.visionHeadingsSnapshot
      ?? context.vision_headings_snapshot
      ?? state?.vision_headings_snapshot
      ?? state?.continuous?.vision_headings_snapshot
      ?? [],
  };
}

function maybeAttachIdleExpansionSidecar(root, stagingRel, turnResult, context) {
  if (turnResult?.idle_expansion_result !== undefined) {
    // Normalize embedded idle_expansion_result in-place (same transforms as sidecar path)
    const normalizedResult = normalizeIdleExpansionSidecar(turnResult.idle_expansion_result, context);
    return {
      turnResult: { ...turnResult, idle_expansion_result: normalizedResult },
      warnings: [],
    };
  }
  if (context.required !== true) {
    return { turnResult, warnings: [] };
  }

  const sidecarRel = join(dirname(stagingRel), 'idle-expansion-result.json');
  const sidecarAbs = join(root, sidecarRel);
  if (!existsSync(sidecarAbs)) {
    return { turnResult, warnings: [] };
  }

  let raw;
  try {
    raw = readFileSync(sidecarAbs, 'utf8');
  } catch (err) {
    return { turnResult, warnings: [`[normalized] Cannot read idle expansion sidecar ${sidecarRel}: ${err.message}`] };
  }

  let sidecar;
  try {
    sidecar = JSON.parse(raw);
  } catch (err) {
    return { turnResult, warnings: [`[normalized] Invalid JSON in idle expansion sidecar ${sidecarRel}: ${err.message}`] };
  }

  const idleExpansionResult = normalizeIdleExpansionSidecar(sidecar, context);
  return {
    turnResult: {
      ...turnResult,
      idle_expansion_result: idleExpansionResult,
    },
    warnings: [`[normalized] Loaded idle_expansion_result from ${sidecarRel}.`],
  };
}

function normalizeIdleExpansionSidecar(sidecar, context) {
  if (!sidecar || typeof sidecar !== 'object' || Array.isArray(sidecar)) {
    return sidecar;
  }

  const result = {
    ...sidecar,
    expansion_iteration: Number.isInteger(sidecar.expansion_iteration)
      ? sidecar.expansion_iteration
      : context.expansionIteration,
  };

  let intent = sidecar.new_intake_intent || sidecar.proposed_intent;
  // Normalize flat new_intake_intent fields: if the PM put title/charter at the
  // top level instead of nesting under new_intake_intent, extract them.
  if (sidecar.kind === 'new_intake_intent' && !intent && sidecar.title && sidecar.charter) {
    intent = {
      title: sidecar.title,
      charter: sidecar.charter,
      acceptance_contract: sidecar.acceptance_contract,
      priority: sidecar.priority,
      template: sidecar.template,
    };
    // Remove flat fields from result to avoid schema pollution
    delete result.title;
    delete result.charter;
    delete result.acceptance_contract;
    delete result.priority;
    delete result.template;
  }
  if (sidecar.kind === 'new_intake_intent' && intent && typeof intent === 'object' && !Array.isArray(intent)) {
    result.new_intake_intent = {
      title: intent.title,
      charter: intent.charter,
      acceptance_contract: intent.acceptance_contract,
      priority: intent.priority,
      template: intent.template,
    };
    result.vision_traceability = normalizeVisionTraceabilityForTurnResult(
      sidecar.vision_traceability || intent.vision_traceability,
    );
  } else if (sidecar.vision_traceability !== undefined) {
    result.vision_traceability = normalizeVisionTraceabilityForTurnResult(sidecar.vision_traceability);
  }

  if (
    sidecar.kind === 'vision_exhausted'
    && sidecar.vision_exhausted
    && typeof sidecar.vision_exhausted === 'object'
    && !Array.isArray(sidecar.vision_exhausted)
    && Array.isArray(sidecar.vision_exhausted.classification)
  ) {
    result.vision_exhausted = {
      ...sidecar.vision_exhausted,
      classification: sidecar.vision_exhausted.classification.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return entry;
        }
        return {
          ...entry,
          vision_heading: entry.vision_heading || entry.heading,
        };
      }),
    };
  }

  return normalizeIdleExpansionMutualExclusionSentinel(result).value;
}

function normalizeVisionTraceabilityForTurnResult(traceability) {
  // Handle object-shaped traceability: { headings: [...], rationale: "..." }
  if (traceability && typeof traceability === 'object' && !Array.isArray(traceability) && Array.isArray(traceability.headings)) {
    const rationale = traceability.rationale || '';
    return traceability.headings.map((h) => {
      if (typeof h === 'string') return { vision_heading: h, goal: rationale, kind: 'advances' };
      if (h && typeof h === 'object') return { vision_heading: h.heading || h.vision_heading || '', goal: h.goal || h.rationale || rationale, kind: h.kind || 'advances' };
      return { vision_heading: String(h), goal: rationale, kind: 'advances' };
    });
  }
  if (!Array.isArray(traceability)) {
    return traceability;
  }

  return traceability.map((entry) => {
    if (typeof entry === 'string') {
      return { vision_heading: entry };
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return entry;
    }
    return {
      ...entry,
      vision_heading: entry.vision_heading || entry.heading,
    };
  });
}

// ── Stage B: Assignment Validation ───────────────────────────────────────────

function validateAssignment(tr, state) {
  const errors = [];

  if (!state) {
    errors.push('Cannot validate assignment: state.json is not loaded.');
    return errors;
  }

  if (state.run_id && tr.run_id !== state.run_id) {
    errors.push(`run_id mismatch: turn result has "${tr.run_id}", state has "${state.run_id}".`);
  }

  const currentTurn = getActiveTurn(state) || state.current_turn;
  if (!currentTurn) {
    errors.push('No active turn in state.json — cannot validate assignment.');
    return errors;
  }

  if (currentTurn.turn_id && tr.turn_id !== currentTurn.turn_id) {
    errors.push(`turn_id mismatch: turn result has "${tr.turn_id}", state has "${currentTurn.turn_id}".`);
  }
  if (currentTurn.assigned_role && tr.role !== currentTurn.assigned_role) {
    errors.push(`role mismatch: turn result has "${tr.role}", state assigns "${currentTurn.assigned_role}".`);
  }
  if (currentTurn.runtime_id && tr.runtime_id !== currentTurn.runtime_id) {
    errors.push(`runtime_id mismatch: turn result has "${tr.runtime_id}", state has "${currentTurn.runtime_id}".`);
  }

  return errors;
}

// ── Stage C: Artifact Validation ─────────────────────────────────────────────

function validateArtifact(tr, config) {
  const errors = [];
  const warnings = [];

  const role = config.roles?.[tr.role];
  const writeAuthority = role?.write_authority;

  // review_only roles must not declare product file changes
  if (writeAuthority === 'review_only') {
    const productFiles = (tr.files_changed || []).filter(f => !isAllowedReviewPath(f));
    if (productFiles.length > 0) {
      errors.push(
        `Role "${tr.role}" has review_only write authority but claims product file changes: ${productFiles.join(', ')}`
      );
    }
    if (tr.artifact?.type && tr.artifact.type !== 'review') {
      errors.push(
        `Role "${tr.role}" has review_only write authority but artifact type is "${tr.artifact.type}" (must be "review").`
      );
    }
  }

  // workspace artifact only allowed for authoritative + local_cli
  if (tr.artifact?.type === 'workspace') {
    if (writeAuthority && writeAuthority !== 'authoritative') {
      errors.push(
        `Artifact type "workspace" requires authoritative write authority, but role "${tr.role}" has "${writeAuthority}".`
      );
    }
  }

  // Check for reserved path modifications
  for (const file of tr.files_changed || []) {
    if (RESERVED_PATHS.includes(file)) {
      errors.push(`Turn result claims modification of reserved path: ${file}`);
    }
  }

  // Authoritative roles with product-file changes must not claim artifact.type "review".
  // "review" signals observation-only, but non-empty product files_changed means the actor
  // wrote to the repo.  Allowing the mismatch makes accepted_integration_ref look clean
  // when the workspace is actually dirty — hiding state from the next authoritative turn.
  if (writeAuthority === 'authoritative' && tr.artifact?.type === 'review') {
    const productFiles = (tr.files_changed || []).filter(f => !isAllowedReviewPath(f));
    if (productFiles.length > 0) {
      errors.push(
        `Role "${tr.role}" has authoritative write authority and changed product files (${productFiles.join(', ')}), but artifact type is "review". ` +
        'Use "workspace" or "commit" when product files are modified.'
      );
    }
  }

  // Warn if files_changed is empty for authoritative + completed turns
  if (writeAuthority === 'authoritative' && tr.status === 'completed' && (tr.files_changed || []).length === 0) {
    warnings.push('Authoritative role completed with no files_changed — is this intentional?');
  }

  // Validate proposed_changes for proposed runtimes that cannot write repo files directly.
  const runtimeType = config.runtimes?.[tr.runtime_id]?.type;
  if (writeAuthority === 'proposed' && (runtimeType === 'api_proxy' || runtimeType === 'remote_agent')) {
    // Completion-request turns are explicitly allowed to have empty proposed_changes —
    // the turn is signaling run completion, not delivering work.
    const isCompletionRequest = tr.run_completion_request === true;
    if (tr.status === 'completed' && (!tr.proposed_changes || tr.proposed_changes.length === 0) && !isCompletionRequest) {
      errors.push(`Proposed ${runtimeType} turn completed but proposed_changes is empty or missing.`);
    }
  }
  if (tr.proposed_changes && Array.isArray(tr.proposed_changes)) {
    if (writeAuthority === 'review_only') {
      warnings.push('Turn result contains proposed_changes but role has review_only write authority — proposed_changes will be ignored.');
    }
    for (let i = 0; i < tr.proposed_changes.length; i++) {
      const change = tr.proposed_changes[i];
      if (!change || typeof change !== 'object') {
        errors.push(`proposed_changes[${i}]: must be an object.`);
        continue;
      }
      if (!change.path || typeof change.path !== 'string') {
        errors.push(`proposed_changes[${i}]: missing or invalid "path".`);
      }
      if (!['create', 'modify', 'delete'].includes(change.action)) {
        errors.push(`proposed_changes[${i}]: action must be "create", "modify", or "delete" (got "${change.action}").`);
      }
      if ((change.action === 'create' || change.action === 'modify') && (change.content == null || typeof change.content !== 'string')) {
        errors.push(`proposed_changes[${i}]: content is required for "${change.action}" action.`);
      }
      if (change.path && RESERVED_PATHS.includes(change.path)) {
        errors.push(`proposed_changes[${i}]: cannot propose changes to reserved path "${change.path}".`);
      }
    }
  }

  return { errors, warnings };
}

/**
 * Paths that review_only roles are allowed to create/modify.
 */
function isAllowedReviewPath(filePath) {
  return filePath.startsWith('.planning/') || filePath.startsWith('.agentxchain/reviews/');
}

// ── Stage D: Verification Validation ─────────────────────────────────────────

function validateVerification(tr) {
  const errors = [];
  const warnings = [];

  const v = tr.verification;
  if (!v) return { errors, warnings };

  // If status is pass, there should be some evidence
  if (v.status === 'pass') {
    const hasCommands = Array.isArray(v.commands) && v.commands.length > 0;
    const hasMachineEvidence = Array.isArray(v.machine_evidence) && v.machine_evidence.length > 0;
    const hasEvidenceSummary = typeof v.evidence_summary === 'string' && v.evidence_summary.trim();

    if (!hasCommands && !hasMachineEvidence && !hasEvidenceSummary) {
      warnings.push('verification.status is "pass" but no evidence provided (commands, machine_evidence, or evidence_summary).');
    }
  }

  if (Array.isArray(v.commands)) {
    for (let i = 0; i < v.commands.length; i++) {
      const command = v.commands[i];
      if (typeof command !== 'string' || command.trim().length === 0) {
        errors.push(`verification.commands[${i}] must be a non-empty string.`);
      }
    }
  }

  // machine_evidence exit codes should be consistent with status
  if (Array.isArray(v.machine_evidence)) {
    for (let i = 0; i < v.machine_evidence.length; i++) {
      const entry = v.machine_evidence[i];
      if (typeof entry !== 'object' || entry === null) {
        errors.push(`verification.machine_evidence[${i}] must be an object.`);
        continue;
      }
      if (typeof entry.command !== 'string' || entry.command.trim().length === 0) {
        errors.push(`verification.machine_evidence[${i}].command must be a non-empty string.`);
      }
      if (typeof entry.exit_code !== 'number' || !Number.isInteger(entry.exit_code)) {
        errors.push(`verification.machine_evidence[${i}].exit_code must be an integer.`);
      }
      if ('expected_exit_code' in entry && (typeof entry.expected_exit_code !== 'number' || !Number.isInteger(entry.expected_exit_code))) {
        errors.push(`verification.machine_evidence[${i}].expected_exit_code must be an integer when provided.`);
      }
    }

    // If status is pass but any command has non-zero exit code, that is only
    // valid for explicitly declared expected negative checks.
    if (v.status === 'pass') {
      const failedCommands = v.machine_evidence.filter((entry) => (
        typeof entry?.exit_code === 'number'
        && entry.exit_code !== 0
        && !isExpectedNonZeroMachineEvidence(entry, v.evidence_summary)
      ));
      if (failedCommands.length > 0) {
        errors.push(
          `verification.status is "pass" but ${failedCommands.length} command(s) have non-zero exit codes that are not explicitly declared as expected failures. Set verification.machine_evidence[].expected_exit_code to the expected non-zero code, wrap expected-failure checks in a verifier that exits 0 only when the failure occurs as expected, or do not report "pass".`
        );
      }
      const expectedNonZeroCommands = v.machine_evidence.filter((entry) => (
        typeof entry?.exit_code === 'number'
        && entry.exit_code !== 0
        && isExpectedNonZeroMachineEvidence(entry, v.evidence_summary)
      ));
      if (expectedNonZeroCommands.length > 0) {
        warnings.push(`verification.status is "pass" with ${expectedNonZeroCommands.length} expected non-zero command(s).`);
      }
    }
  }

  if (Array.isArray(v.produced_files)) {
    const seenProducedPaths = new Map();
    const declaredFiles = new Set(Array.isArray(tr.files_changed) ? tr.files_changed : []);
    for (let i = 0; i < v.produced_files.length; i++) {
      const entry = v.produced_files[i];
      if (typeof entry !== 'object' || entry === null) {
        errors.push(`verification.produced_files[${i}] must be an object.`);
        continue;
      }

      const rawPath = typeof entry.path === 'string' ? entry.path : '';
      const path = rawPath.trim();
      if (!path) {
        errors.push(`verification.produced_files[${i}].path must be a non-empty string.`);
      }

      const disposition = entry.disposition == null ? 'artifact' : entry.disposition;
      if (!['artifact', 'ignore'].includes(disposition)) {
        errors.push(`verification.produced_files[${i}].disposition must be "artifact" or "ignore".`);
      }

      if (path) {
        if (seenProducedPaths.has(path)) {
          errors.push(`verification.produced_files[${i}].path duplicates "${path}" from verification.produced_files[${seenProducedPaths.get(path)}].`);
        } else {
          seenProducedPaths.set(path, i);
        }
        if (disposition === 'ignore' && declaredFiles.has(path)) {
          errors.push(`verification.produced_files[${i}] marks "${path}" as ignore, but it is also listed in files_changed.`);
        }
      }
    }
  }

  return { errors, warnings };
}

function isExpectedNonZeroMachineEvidence(entry, evidenceSummary) {
  if (!entry || typeof entry !== 'object') {
    return false;
  }
  if (!Number.isInteger(entry.exit_code) || entry.exit_code === 0) {
    return false;
  }
  if (Number.isInteger(entry.expected_exit_code)) {
    return entry.expected_exit_code === entry.exit_code;
  }
  return evidenceSummaryDeclaresExpectedExit(evidenceSummary, entry.command, entry.exit_code);
}

function evidenceSummaryDeclaresExpectedExit(evidenceSummary, command, exitCode) {
  if (typeof evidenceSummary !== 'string' || typeof command !== 'string') {
    return false;
  }
  const summary = normalizeEvidenceText(evidenceSummary);
  const snippets = expectedExitCommandSnippets(command).map(normalizeEvidenceText).filter(Boolean);
  for (const snippet of snippets) {
    const index = summary.indexOf(snippet);
    if (index === -1) {
      continue;
    }
    const window = summary.slice(index, index + snippet.length + 160);
    if (mentionsExitCode(window, exitCode)) {
      return true;
    }
  }
  return false;
}

function expectedExitCommandSnippets(command) {
  const normalized = normalizeEvidenceText(command);
  const snippets = [normalized];
  const firstTypeMatch = normalized.match(/(--first-type)\s+([^&|;`\n\r ]+)/i);
  if (firstTypeMatch) {
    snippets.push(`${firstTypeMatch[1]} ${firstTypeMatch[2]}`);
  }
  return [...new Set(snippets)];
}

function mentionsExitCode(text, exitCode) {
  const code = String(exitCode).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b(?:exit(?:s|ed)?(?:\\s+(?:code|with\\s+code))?|returns?|returned)\\s*${code}\\b`, 'i').test(text);
}

function normalizeEvidenceText(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

// ── Stage E: Protocol Compliance ─────────────────────────────────────────────

function validateProtocol(tr, state, config) {
  const errors = [];
  const warnings = [];

  const role = config.roles?.[tr.role];
  const writeAuthority = role?.write_authority;
  const activeTurn = getActiveTurn(state) || state?.current_turn || null;

  // Challenge requirement: review_only roles MUST raise at least one objection
  if (config.rules?.challenge_required !== false) {
    if (writeAuthority === 'review_only') {
      if (!Array.isArray(tr.objections) || tr.objections.length === 0) {
        errors.push(
          `Protocol violation: role "${tr.role}" has review_only authority and must raise at least one objection (challenge requirement).`
        );
      }
    }
  }

  // proposed_next_role must be routing-legal
  const phase = state?.phase;
  const routing = config.routing?.[phase];
  if (routing && tr.proposed_next_role) {
    const allowed = routing.allowed_next_roles || [];
    if (!allowed.includes(tr.proposed_next_role) && tr.proposed_next_role !== 'human') {
      errors.push(
        `proposed_next_role "${tr.proposed_next_role}" is not in the allowed_next_roles for phase "${phase}": [${allowed.join(', ')}].`
      );
    }
  }

  // phase_transition_request must reference a valid phase
  if (tr.phase_transition_request) {
    if (config.routing && !config.routing[tr.phase_transition_request]) {
      errors.push(
        `phase_transition_request "${tr.phase_transition_request}" is not a defined phase in routing.`
      );
    } else if (config.routing && state?.phase) {
      const invalidOrderReason = getInvalidPhaseTransitionReason(
        state.phase,
        tr.phase_transition_request,
        config.routing
      );
      if (invalidOrderReason) {
        errors.push(invalidOrderReason);
      }
    }
  }

  // run_completion_request and phase_transition_request are mutually exclusive
  if (tr.run_completion_request && tr.phase_transition_request) {
    errors.push('run_completion_request and phase_transition_request are mutually exclusive — set one or neither, not both.');
  }

  // needs_human status must have a reason
  if (tr.status === 'needs_human' && (!tr.needs_human_reason || !tr.needs_human_reason.trim())) {
    warnings.push('status is "needs_human" but needs_human_reason is empty.');
  }

  // ── Delegation validation ───────────────────────────────────────────────
  if (Array.isArray(tr.delegations) && tr.delegations.length > 0) {
    // Maximum 5 delegations per turn
    if (tr.delegations.length > 5) {
      errors.push(`Maximum 5 delegations per turn (got ${tr.delegations.length}).`);
    }

    // Delegations are mutually exclusive with run_completion_request
    if (tr.run_completion_request) {
      errors.push('delegations are mutually exclusive with run_completion_request — a turn cannot delegate and complete the run.');
    }

    // No recursive delegation: if this turn is a delegation review, it cannot delegate further
    if (activeTurn?.delegation_context) {
      errors.push('Delegation review turns cannot contain further delegations.');
    }

    const seenIds = new Set();
    for (const del of tr.delegations) {
      // Duplicate IDs
      if (seenIds.has(del.id)) {
        errors.push(`Duplicate delegation id "${del.id}".`);
      }
      seenIds.add(del.id);

      // Self-delegation
      if (del.to_role === tr.role) {
        errors.push(`Role "${tr.role}" cannot delegate to itself (delegation ${del.id}).`);
      }

      // to_role must be a defined role
      if (!config.roles?.[del.to_role]) {
        errors.push(`Delegation to_role "${del.to_role}" is not a defined role (delegation ${del.id}).`);
      }

      // to_role must be routing-legal for current phase
      if (routing && del.to_role) {
        const allowed = routing.allowed_next_roles || [];
        if (allowed.length > 0 && !allowed.includes(del.to_role)) {
          errors.push(
            `Delegation to_role "${del.to_role}" is not in allowed_next_roles for phase "${phase}": [${allowed.join(', ')}] (delegation ${del.id}).`
          );
        }
      }
    }
  }

  if (activeTurn?.delegation_review) {
    const unmetDecisionContracts = (activeTurn.delegation_review.results || [])
      .filter((result) => Array.isArray(result?.missing_decision_ids) && result.missing_decision_ids.length > 0);
    if (unmetDecisionContracts.length > 0) {
      const detail = unmetDecisionContracts
        .map((result) => `${result.delegation_id}: ${result.missing_decision_ids.join(', ')}`)
        .join('; ');
      if (tr.phase_transition_request) {
        errors.push(
          `Delegation review cannot request phase transition while required child decisions are missing: ${detail}.`
        );
      }
      if (tr.run_completion_request) {
        errors.push(
          `Delegation review cannot request run completion while required child decisions are missing: ${detail}.`
        );
      }
    }
  }

  return { errors, warnings };
}

// ── Normalization ───────────────────────────────────────────────────────────

/**
 * Best-effort normalization of predictable model-output drift patterns.
 * Returns a shallow-cloned turn result with corrections applied plus an
 * array of human-readable correction strings for logging.
 *
 * This runs BEFORE schema validation. It does not bypass validation —
 * it only fixes patterns that are unambiguously recoverable.
 */
export function normalizeTurnResult(tr, config, context = {}) {
  const corrections = [];
  const normalizationEvents = [];
  if (tr === null || typeof tr !== 'object' || Array.isArray(tr)) {
    return { normalized: tr, corrections, normalizationEvents };
  }

  const normalized = { ...tr };

  // ── BUG-97: recover stale run_id for retained active turns ────────────
  // run_id is state-owned identity. A staged result may safely inherit it
  // only when the staged turn_id proves it belongs to the active retained
  // turn and the active-turn/state run identity is coherent.
  const stagedTurnMatchesActive = Boolean(
    context.runId
    && context.turnId
    && typeof normalized.turn_id === 'string'
    && normalized.turn_id === context.turnId
  );
  const activeTurnRunIdCoherent = !context.activeTurnRunId || context.activeTurnRunId === context.runId;
  const stagedRunId = typeof normalized.run_id === 'string' ? normalized.run_id.trim() : '';
  if (stagedTurnMatchesActive && activeTurnRunIdCoherent && stagedRunId !== context.runId) {
    corrections.push(`run_id: rewritten from "${stagedRunId || '(missing)'}" to active state run_id "${context.runId}"`);
    normalizationEvents.push({
      field: 'run_id',
      original_value: normalized.run_id ?? null,
      normalized_value: context.runId,
      rationale: 'run_id_rewritten_from_active_turn_context',
    });
    normalized.run_id = context.runId;
  }

  // ── BUG-95: rename synonym fields before variable computation ────────
  // files_modified is an unambiguous synonym for files_changed.
  if (!('files_changed' in normalized) && Array.isArray(normalized.files_modified)) {
    corrections.push('files_changed: renamed from synonym files_modified');
    normalizationEvents.push({
      field: 'files_changed',
      original_value: null,
      normalized_value: '(renamed from files_modified)',
      rationale: 'files_modified_renamed_to_files_changed',
    });
    normalized.files_changed = normalized.files_modified;
    delete normalized.files_modified;
  }

  const routing = config?.routing;
  const phaseNames = routing ? Object.keys(routing) : [];
  const currentPhase = context.phase;
  const currentPhaseIndex = currentPhase ? phaseNames.indexOf(currentPhase) : -1;
  const isKnownPhase = currentPhaseIndex >= 0;
  const isTerminalPhase = isKnownPhase && currentPhaseIndex === phaseNames.length - 1;
  const nextPhase = isKnownPhase && currentPhaseIndex + 1 < phaseNames.length
    ? phaseNames[currentPhaseIndex + 1]
    : null;
  const allowedNextRoles = isKnownPhase ? (routing?.[currentPhase]?.allowed_next_roles || []) : [];
  const assignedRole = context.assignedRole || normalized.role || null;
  const isReviewOnly = context.writeAuthority === 'review_only';
  const filesChangedIsEmpty = Array.isArray(normalized.files_changed) && normalized.files_changed.length === 0;
  const hasExplicitNoEditLifecycleSignal = normalized.run_completion_request === true
    || (typeof normalized.phase_transition_request === 'string' && normalized.phase_transition_request.trim().length > 0);

  // ── BUG-94: default missing top-level required arrays ────────────────
  // Empty decisions/objections are schema-valid. Review-only challenge
  // requirements remain enforced later by protocol validation.
  if (!('decisions' in normalized)) {
    corrections.push('decisions: defaulted missing required array to []');
    normalizationEvents.push({
      field: 'decisions',
      original_value: null,
      normalized_value: [],
      rationale: 'missing_decisions_array_defaulted',
    });
    normalized.decisions = [];
  }
  if (!('objections' in normalized)) {
    corrections.push('objections: defaulted missing required array to []');
    normalizationEvents.push({
      field: 'objections',
      original_value: null,
      normalized_value: [],
      rationale: 'missing_objections_array_defaulted',
    });
    normalized.objections = [];
  }

  // ── BUG-95: default missing runtime_id from dispatch context ─────────
  if (!normalized.runtime_id && context.runtimeId) {
    corrections.push(`runtime_id: defaulted from dispatch context "${context.runtimeId}"`);
    normalizationEvents.push({
      field: 'runtime_id',
      original_value: null,
      normalized_value: context.runtimeId,
      rationale: 'missing_runtime_id_defaulted_from_context',
    });
    normalized.runtime_id = context.runtimeId;
  }

  // ── BUG-95: synthesize missing summary from available fields ─────────
  if (!normalized.summary || (typeof normalized.summary === 'string' && !normalized.summary.trim())) {
    const alt = (typeof normalized.milestone_title === 'string' && normalized.milestone_title.trim())
      ? normalized.milestone_title.trim()
      : (typeof normalized.milestone === 'string' && normalized.milestone.trim())
        ? `${normalized.role || 'agent'} turn for ${normalized.milestone.trim()}`
        : `${normalized.role || 'agent'} turn completed`;
    const src = (typeof normalized.milestone_title === 'string' && normalized.milestone_title.trim()) ? 'milestone_title'
      : (typeof normalized.milestone === 'string' && normalized.milestone.trim()) ? 'milestone' : 'fallback';
    corrections.push(`summary: synthesized from ${src}`);
    normalizationEvents.push({
      field: 'summary',
      original_value: normalized.summary ?? null,
      normalized_value: alt,
      rationale: `missing_summary_synthesized_from_${src}`,
    });
    normalized.summary = alt;
  }

  // ── BUG-95: default missing artifact object ────────────────────────────
  if (!normalized.artifact || typeof normalized.artifact !== 'object' || Array.isArray(normalized.artifact)) {
    const hasFiles = Array.isArray(normalized.files_changed) && normalized.files_changed.length > 0;
    const inferredArtifact = { type: hasFiles ? 'workspace' : 'review' };
    corrections.push(`artifact: inferred ${JSON.stringify(inferredArtifact)} from files_changed`);
    normalizationEvents.push({
      field: 'artifact',
      original_value: normalized.artifact ?? null,
      normalized_value: inferredArtifact,
      rationale: 'missing_artifact_inferred_from_files_changed',
    });
    normalized.artifact = inferredArtifact;
  }

  // ── BUG-95: default missing proposed_next_role ─────────────────────────
  if (!normalized.proposed_next_role) {
    let inferredRole = null;
    if (allowedNextRoles.length > 0) {
      inferredRole = allowedNextRoles.find(r => r !== assignedRole) || allowedNextRoles[0];
    }
    if (!inferredRole) inferredRole = 'pm';
    corrections.push(`proposed_next_role: defaulted to "${inferredRole}"`);
    normalizationEvents.push({
      field: 'proposed_next_role',
      original_value: null,
      normalized_value: inferredRole,
      rationale: 'missing_proposed_next_role_defaulted',
    });
    normalized.proposed_next_role = inferredRole;
  }

  // ── BUG-90: normalize status synonyms ────────────────────────────────
  const STATUS_SYNONYMS = { complete: 'completed', success: 'completed', done: 'completed', error: 'failed', failure: 'failed' };
  if (typeof normalized.status === 'string' && !VALID_STATUSES.includes(normalized.status)) {
    const mapped = STATUS_SYNONYMS[normalized.status.toLowerCase()];
    if (mapped) {
      corrections.push(`status: rewritten "${normalized.status}" → "${mapped}"`);
      normalizationEvents.push({
        field: 'status',
        original_value: normalized.status,
        normalized_value: mapped,
        rationale: 'status_synonym_rewritten',
      });
      normalized.status = mapped;
    }
  }

  // ── BUG-90: normalize files_changed objects to path strings ──────────
  if (Array.isArray(normalized.files_changed)) {
    let filesCoerced = false;
    normalized.files_changed = normalized.files_changed.map((item, i) => {
      if (typeof item === 'string') return item;
      if (item !== null && typeof item === 'object' && typeof item.path === 'string') {
        filesCoerced = true;
        return item.path;
      }
      return item; // let validator catch
    });
    if (filesCoerced) {
      corrections.push('files_changed: coerced object entries to path strings');
      normalizationEvents.push({
        field: 'files_changed',
        original_value: '(object entries)',
        normalized_value: '(path strings)',
        rationale: 'files_changed_object_to_string',
      });
    }
  }

  // ── BUG-90: normalize decisions ─────────────────────────────────────
  if (Array.isArray(normalized.decisions)) {
    normalized.decisions = normalized.decisions.map((dec, index) => {
      if (dec === null || typeof dec !== 'object' || Array.isArray(dec)) return dec;
      let patched = dec;

      // Normalize id: "D1" / "D2" / arbitrary → "DEC-001" / "DEC-002"
      const validDecIdPattern = /^DEC-\d+$/;
      const currentDecId = typeof patched.id === 'string' ? patched.id : '';
      if (!validDecIdPattern.test(currentDecId)) {
        const normalizedDecId = `DEC-${String(index + 1).padStart(3, '0')}`;
        corrections.push(`decisions[${index}].id: rewritten "${currentDecId || '(missing)'}" → ${normalizedDecId}`);
        normalizationEvents.push({
          field: `decisions[${index}].id`,
          original_value: patched.id ?? null,
          normalized_value: normalizedDecId,
          rationale: 'invalid_decision_id_rewritten',
        });
        patched = { ...patched, id: normalizedDecId };
      }

      // Normalize missing statement from unambiguous decision text fields.
      const stmt = typeof patched.statement === 'string' ? patched.statement.trim() : '';
      if (!stmt) {
        const alt = typeof patched.decision === 'string' ? patched.decision.trim()
          : typeof patched.description === 'string' ? patched.description.trim()
            : typeof patched.summary === 'string' ? patched.summary.trim() : '';
        if (alt) {
          const srcField = typeof patched.decision === 'string' && patched.decision.trim() ? 'decision'
            : typeof patched.description === 'string' && patched.description.trim() ? 'description' : 'summary';
          corrections.push(`decisions[${index}].statement: copied from ${srcField}`);
          normalizationEvents.push({
            field: `decisions[${index}].statement`,
            original_value: patched.statement ?? null,
            normalized_value: alt,
            rationale: `copied_from_${srcField}`,
          });
          patched = { ...patched, statement: alt };
        }
      }

      // Normalize missing rationale from existing decision text. Do not invent
      // rationale when the decision object has no meaningful source material.
      const rationale = typeof patched.rationale === 'string' ? patched.rationale.trim() : '';
      if (!rationale) {
        const rationaleSources = [
          ['reason', patched.reason],
          ['why', patched.why],
          ['description', patched.description],
          ['decision', patched.decision],
          ['statement', patched.statement],
        ];
        const source = rationaleSources.find(([, value]) => typeof value === 'string' && value.trim());
        if (source) {
          const [srcField, srcValue] = source;
          const alt = srcValue.trim();
          corrections.push(`decisions[${index}].rationale: copied from ${srcField}`);
          normalizationEvents.push({
            field: `decisions[${index}].rationale`,
            original_value: patched.rationale ?? null,
            normalized_value: alt,
            rationale: `copied_from_${srcField}`,
          });
          patched = { ...patched, rationale: alt };
        }
      }

      // Default missing category to 'implementation'
      if (!patched.category || !VALID_CATEGORIES.includes(patched.category)) {
        const defaultCat = 'implementation';
        corrections.push(`decisions[${index}].category: defaulted to "${defaultCat}"`);
        normalizationEvents.push({
          field: `decisions[${index}].category`,
          original_value: patched.category ?? null,
          normalized_value: defaultCat,
          rationale: 'missing_category_defaulted',
        });
        patched = { ...patched, category: defaultCat };
      }

      return patched;
    });
  }

  // ── BUG-90: normalize missing verification.status ───────────────────
  if (
    normalized.verification
    && typeof normalized.verification === 'object'
    && !Array.isArray(normalized.verification)
    && !('status' in normalized.verification)
  ) {
    const exitCode = normalized.verification.exit_code;
    const inferredStatus = exitCode === 0 ? 'pass' : typeof exitCode === 'number' ? 'fail' : 'skipped';
    corrections.push(`verification.status: inferred "${inferredStatus}" from exit_code=${exitCode}`);
    normalizationEvents.push({
      field: 'verification.status',
      original_value: null,
      normalized_value: inferredStatus,
      rationale: 'verification_status_inferred_from_exit_code',
    });
    normalized.verification = { ...normalized.verification, status: inferredStatus };
  }

  // ── BUG-90: normalize missing artifact.type ─────────────────────────
  if (
    normalized.artifact
    && typeof normalized.artifact === 'object'
    && !Array.isArray(normalized.artifact)
    && !('type' in normalized.artifact)
  ) {
    const hasFiles = Array.isArray(normalized.files_changed) && normalized.files_changed.length > 0;
    const inferredType = hasFiles ? 'workspace' : 'review';
    corrections.push(`artifact.type: inferred "${inferredType}" from files_changed`);
    normalizationEvents.push({
      field: 'artifact.type',
      original_value: null,
      normalized_value: inferredType,
      rationale: 'artifact_type_inferred_from_files_changed',
    });
    normalized.artifact = { ...normalized.artifact, type: inferredType };
  }

  // ── Rule 0a: empty workspace artifact → no-edit review normalization ──
  if (
    normalized.artifact
    && typeof normalized.artifact === 'object'
    && !Array.isArray(normalized.artifact)
    && normalized.artifact.type === 'workspace'
    && filesChangedIsEmpty
    && (context.forceReviewArtifact || hasExplicitNoEditLifecycleSignal)
  ) {
    normalized.artifact = {
      ...normalized.artifact,
      type: 'review',
      ref: typeof normalized.turn_id === 'string' && normalized.turn_id.trim()
        ? `turn:${normalized.turn_id}`
        : normalized.artifact.ref ?? null,
    };
    corrections.push('artifact.type: auto-normalized empty workspace artifact to review because files_changed is empty and no repo mutation was declared');
    normalizationEvents.push({
      field: 'artifact.type',
      original_value: 'workspace',
      normalized_value: 'review',
      rationale: 'empty_files_changed_no_repo_mutation_declared',
    });
  }

  if (Array.isArray(normalized.objections)) {
    normalized.objections = normalized.objections.map((objection, index) => {
      if (objection === null || typeof objection !== 'object' || Array.isArray(objection)) {
        return objection;
      }

      let patched = objection;

      // ── BUG-89: normalize invalid objection IDs to OBJ-NNN ──────────
      const validIdPattern = /^OBJ-\d+$/;
      const currentId = typeof patched.id === 'string' ? patched.id : '';
      if (!validIdPattern.test(currentId)) {
        const normalizedId = `OBJ-${String(index + 1).padStart(3, '0')}`;
        corrections.push(`objections[${index}].id: rewritten "${currentId || '(missing)'}" → ${normalizedId}`);
        normalizationEvents.push({
          field: `objections[${index}].id`,
          original_value: patched.id ?? null,
          normalized_value: normalizedId,
          rationale: 'invalid_objection_id_rewritten',
        });
        patched = { ...patched, id: normalizedId };
      }

      // ── BUG-79: normalize missing statement from summary/detail ─────
      const statement = typeof patched.statement === 'string' ? patched.statement.trim() : '';
      if (statement) {
        return patched;
      }
      const summary = typeof patched.summary === 'string' ? patched.summary.trim() : '';
      const detail = typeof patched.detail === 'string' ? patched.detail.trim() : '';
      const sourceField = summary ? 'summary' : detail ? 'detail' : null;
      const sourceValue = summary || detail;
      if (!sourceField) {
        return patched;
      }
      corrections.push(`objections[${index}].statement: copied from ${sourceField}`);
      normalizationEvents.push({
        field: `objections[${index}].statement`,
        original_value: patched.statement ?? null,
        normalized_value: sourceValue,
        rationale: `copied_from_${sourceField}`,
      });
      return {
        ...patched,
        statement: sourceValue,
      };
    });
  }

  const pickAllowedRoleFallback = () => {
    if (allowedNextRoles.length === 0) return null;
    return allowedNextRoles.find((role) => role !== assignedRole) || allowedNextRoles[0] || null;
  };
  const nextPhaseEntryRole = nextPhase && routing?.[nextPhase]?.entry_role
    ? routing[nextPhase].entry_role
    : null;

  // ── Rule 0: infer missing status only when intent is unambiguous ──────
  if (!('status' in normalized)) {
    const hasNeedsHumanReason = typeof normalized.needs_human_reason === 'string'
      && normalized.needs_human_reason.trim().length > 0;
    const hasPhaseTransitionRequest = typeof normalized.phase_transition_request === 'string'
      && normalized.phase_transition_request.trim().length > 0;
    const hasRunCompletionRequest = normalized.run_completion_request === true;

    if (hasNeedsHumanReason) {
      normalized.status = 'needs_human';
      corrections.push('status: inferred "needs_human" from needs_human_reason');
    } else if (hasPhaseTransitionRequest) {
      normalized.status = 'completed';
      corrections.push(`status: inferred "completed" from phase_transition_request "${normalized.phase_transition_request}"`);
    } else if (hasRunCompletionRequest) {
      normalized.status = 'completed';
      corrections.push('status: inferred "completed" from run_completion_request: true');
    }
  }

  // ── Rule 1: artifacts_created object coercion ─────────────────────────
  if (Array.isArray(normalized.artifacts_created)) {
    const coerced = [];
    for (let i = 0; i < normalized.artifacts_created.length; i++) {
      const item = normalized.artifacts_created[i];
      if (typeof item === 'string') {
        coerced.push(item);
      } else if (item !== null && typeof item === 'object') {
        const str = typeof item.path === 'string' ? item.path
          : typeof item.name === 'string' ? item.name
          : JSON.stringify(item);
        corrections.push(`artifacts_created[${i}]: coerced object to string "${str}"`);
        coerced.push(str);
      } else {
        coerced.push(item); // let validator catch non-string/non-object
      }
    }
    normalized.artifacts_created = coerced;
  }

  const idleExpansionCleanup = normalizeIdleExpansionMutualExclusionSentinel(
    normalized.idle_expansion_result,
  );
  if (idleExpansionCleanup.changed) {
    normalized.idle_expansion_result = idleExpansionCleanup.value;
    corrections.push(idleExpansionCleanup.correction);
  }

  // ── Rule 2: exit-gate-as-phase auto-correction ────────────────────────
  const gates = config?.gates;
  if (
    typeof normalized.phase_transition_request === 'string' &&
    routing && gates &&
    !normalized.run_completion_request // don't touch if both are set — let mutual-exclusivity validator catch it
  ) {
    const requested = normalized.phase_transition_request;
    const isValidPhase = requested in routing;
    const isGateName = requested in gates;

    if (!isValidPhase && isGateName) {
      // Find which phase owns this gate
      const phaseNames = Object.keys(routing);
      const ownerPhaseIndex = phaseNames.findIndex(
        (p) => routing[p].exit_gate === requested
      );

      if (ownerPhaseIndex >= 0) {
        const nextPhaseIndex = ownerPhaseIndex + 1;
        if (nextPhaseIndex < phaseNames.length) {
          // Non-terminal phase: correct to the next phase name
          const nextPhase = phaseNames[nextPhaseIndex];
          corrections.push(
            `phase_transition_request: corrected gate name "${requested}" to phase "${nextPhase}"`
          );
          normalized.phase_transition_request = nextPhase;
        } else {
          // Terminal phase: the agent meant run_completion_request
          corrections.push(
            `phase_transition_request: corrected terminal gate name "${requested}" to run_completion_request: true`
          );
          normalized.phase_transition_request = null;
          normalized.run_completion_request = true;
        }
      }
    }
  }

  // ── Rule 3: review_only needs_human → lifecycle correction ──────────
  // review_only roles cannot perform work that genuinely requires human
  // intervention. If the model says "needs_human" with an affirmative,
  // non-blocker reason, correct to the appropriate lifecycle signal:
  // terminal phase → run_completion_request, non-terminal → phase_transition.
  if (
    context.writeAuthority === 'review_only' &&
    context.phase &&
    routing &&
    normalized.status === 'needs_human' &&
    normalized.run_completion_request !== false &&
    typeof normalized.needs_human_reason === 'string'
  ) {
    const reason = normalized.needs_human_reason.toLowerCase();
    const affirmativeSignals = /\b(approv|ship|release|sign.?off|no.?block|ready|pass|good|accept|green.?light|proceed|move.?forward|complet|done|lgtm|satisf|recommend)\b/i;
    const blockerSignals = /\b(critical|security|fail|block|cannot|must.?fix|regression|vulnerab|reject|unsafe|broken)\b/i;
    const isAffirmative = affirmativeSignals.test(reason);
    const isBlocker = blockerSignals.test(reason);
    if (isAffirmative && !isBlocker) {
      if (isTerminalPhase) {
        corrections.push(
          `status: corrected review_only terminal "needs_human" to run_completion_request — reason indicated ship readiness ("${normalized.needs_human_reason.slice(0, 80)}"), not a genuine blocker`
        );
        normalized.status = 'completed';
        normalized.run_completion_request = true;
        delete normalized.needs_human_reason;
      } else if (nextPhase) {
        corrections.push(
          `status: corrected review_only "needs_human" to phase_transition_request "${nextPhase}" — reason indicated forward progress ("${normalized.needs_human_reason.slice(0, 80)}"), not a genuine blocker`
        );
        normalized.status = 'completed';
        normalized.phase_transition_request = nextPhase;
        delete normalized.needs_human_reason;
      }
    }
  }

  // ── Rule 4: infer missing lifecycle signal for completed turns ────────
  if (
    isKnownPhase &&
    isReviewOnly &&
    normalized.status === 'completed' &&
    normalized.run_completion_request == null &&
    !normalized.phase_transition_request
  ) {
    if (isTerminalPhase) {
      normalized.run_completion_request = true;
      corrections.push(
        `run_completion_request: inferred true for completed terminal phase "${currentPhase}"`
      );
    } else if (nextPhase) {
      normalized.phase_transition_request = nextPhase;
      corrections.push(
        `phase_transition_request: inferred next phase "${nextPhase}" for completed phase "${currentPhase}"`
      );
    }
  }

  // ── Rule 5: correct invalid or non-forward lifecycle requests ─────────
  if (
    isKnownPhase &&
    !isTerminalPhase &&
    !isReviewOnly &&
    normalized.status === 'completed' &&
    typeof normalized.phase_transition_request === 'string' &&
    !normalized.run_completion_request
  ) {
    const requested = normalized.phase_transition_request;
    const requestedIndex = phaseNames.indexOf(requested);
    const skipsImmediateNextPhase = requestedIndex > currentPhaseIndex + 1;

    if (skipsImmediateNextPhase && nextPhase) {
      normalized.phase_transition_request = nextPhase;
      corrections.push(
        `phase_transition_request: corrected skip-forward "${requested}" to immediate next phase "${nextPhase}"`
      );
      normalizationEvents.push({
        field: 'phase_transition_request',
        original_value: requested,
        normalized_value: nextPhase,
        rationale: 'skip_forward_phase_corrected_to_next_phase',
      });

      const proposedRoleIsStalePhase = normalized.proposed_next_role === requested;
      const proposedRoleIsRoutingIllegal = typeof normalized.proposed_next_role === 'string'
        && normalized.proposed_next_role !== 'human'
        && allowedNextRoles.length > 0
        && !allowedNextRoles.includes(normalized.proposed_next_role);
      if (
        nextPhaseEntryRole &&
        allowedNextRoles.includes(nextPhaseEntryRole) &&
        (proposedRoleIsStalePhase || proposedRoleIsRoutingIllegal)
      ) {
        corrections.push(
          `proposed_next_role: corrected "${normalized.proposed_next_role}" to entry role "${nextPhaseEntryRole}" for corrected phase "${nextPhase}"`
        );
        normalizationEvents.push({
          field: 'proposed_next_role',
          original_value: normalized.proposed_next_role,
          normalized_value: nextPhaseEntryRole,
          rationale: 'aligned_to_corrected_phase_entry_role',
        });
        normalized.proposed_next_role = nextPhaseEntryRole;
      }
    }
  }

  if (
    isKnownPhase &&
    isReviewOnly &&
    normalized.status === 'completed' &&
    typeof normalized.phase_transition_request === 'string' &&
    !normalized.run_completion_request
  ) {
    const requested = normalized.phase_transition_request;
    const requestedIndex = phaseNames.indexOf(requested);
    const invalidPhase = !(requested in (routing || {}));
    const notForward = requestedIndex >= 0 && requestedIndex <= currentPhaseIndex;

    if (invalidPhase || notForward) {
      if (nextPhase) {
        normalized.phase_transition_request = nextPhase;
        corrections.push(
          `phase_transition_request: corrected "${requested}" to forward phase "${nextPhase}"`
        );
      } else if (isTerminalPhase) {
        normalized.phase_transition_request = null;
        normalized.run_completion_request = true;
        corrections.push(
          `phase_transition_request: corrected terminal/non-forward "${requested}" to run_completion_request: true`
        );
      }
    }
  }

  // ── Rule 6: repair routing-illegal next-role signals only when safe ───
  if (isReviewOnly && normalized.run_completion_request === true && !normalized.phase_transition_request) {
    if (normalized.proposed_next_role !== 'human') {
      normalized.proposed_next_role = 'human';
      corrections.push('proposed_next_role: corrected to "human" for run completion');
    }
  } else if (
    isKnownPhase &&
    isReviewOnly &&
    normalized.status === 'completed' &&
    typeof normalized.proposed_next_role === 'string' &&
    normalized.proposed_next_role !== 'human' &&
    allowedNextRoles.length > 0 &&
    !allowedNextRoles.includes(normalized.proposed_next_role)
  ) {
    const fallback = pickAllowedRoleFallback();
    if (fallback) {
      corrections.push(
        `proposed_next_role: corrected "${normalized.proposed_next_role}" to allowed role "${fallback}"`
      );
      normalized.proposed_next_role = fallback;
    }
  } else if (
    // BUG-82: When BUG-81's gate auto-strip keeps the session in an earlier
    // phase (e.g. planning), authoritative roles dispatched in that phase may
    // propose a next role valid for the phase they *expected* (e.g. "qa" for
    // implementation) but illegal for the actual phase.  Auto-normalize to a
    // routing-legal role instead of hard-erroring.
    isKnownPhase &&
    !isReviewOnly &&
    normalized.status === 'completed' &&
    typeof normalized.proposed_next_role === 'string' &&
    normalized.proposed_next_role !== 'human' &&
    !/^<[^>]+>$/.test(normalized.proposed_next_role) && // skip template placeholders — let schema validation catch them
    allowedNextRoles.length > 0 &&
    !allowedNextRoles.includes(normalized.proposed_next_role)
  ) {
    const fallback = pickAllowedRoleFallback();
    if (fallback) {
      corrections.push(
        `proposed_next_role: corrected "${normalized.proposed_next_role}" to allowed role "${fallback}" (routing-illegal for phase "${currentPhase}")`
      );
      normalizationEvents.push({
        field: 'proposed_next_role',
        original_value: normalized.proposed_next_role,
        normalized_value: fallback,
        rationale: `routing_illegal_for_phase_${currentPhase}`,
      });
      normalized.proposed_next_role = fallback;
    }
  }

  return { normalized, corrections, normalizationEvents };
}

function normalizeIdleExpansionMutualExclusionSentinel(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { changed: false, value: result, correction: '' };
  }

  if (
    result.kind === 'new_intake_intent'
    && ('vision_exhausted' in result)
    && (result.vision_exhausted === false || result.vision_exhausted === null)
  ) {
    const normalized = { ...result };
    delete normalized.vision_exhausted;
    return {
      changed: true,
      value: normalized,
      correction: 'idle_expansion_result.vision_exhausted: removed false sentinel for new_intake_intent',
    };
  }

  return { changed: false, value: result, correction: '' };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function result(stage, errorClass, errors, warnings = []) {
  return {
    ok: false,
    stage,
    error_class: errorClass,
    errors,
    warnings,
    turnResult: null,
  };
}

export { STAGING_PATH };
