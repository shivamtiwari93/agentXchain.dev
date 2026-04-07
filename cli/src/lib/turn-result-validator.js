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
import { join } from 'path';
import { getActiveTurn } from './governed-state.js';

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

  // ── Pre-validation normalization ───────────────────────────────────────
  const { normalized, corrections } = normalizeTurnResult(turnResult, config);
  turnResult = normalized;
  const normWarnings = corrections.map((c) => `[normalized] ${c}`);

  // ── Stage A: Schema Validation ─────────────────────────────────────────
  const schemaErrors = validateSchema(turnResult);
  if (schemaErrors.length > 0) {
    return result('schema', 'schema_error', schemaErrors);
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

  return errors;
}

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

  // Warn if files_changed is empty for authoritative + completed turns
  if (writeAuthority === 'authoritative' && tr.status === 'completed' && (tr.files_changed || []).length === 0) {
    warnings.push('Authoritative role completed with no files_changed — is this intentional?');
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

  // machine_evidence exit codes should be consistent with status
  if (Array.isArray(v.machine_evidence)) {
    for (let i = 0; i < v.machine_evidence.length; i++) {
      const entry = v.machine_evidence[i];
      if (typeof entry !== 'object' || entry === null) {
        errors.push(`verification.machine_evidence[${i}] must be an object.`);
        continue;
      }
      if (typeof entry.command !== 'string') {
        errors.push(`verification.machine_evidence[${i}].command must be a string.`);
      }
      if (typeof entry.exit_code !== 'number' || !Number.isInteger(entry.exit_code)) {
        errors.push(`verification.machine_evidence[${i}].exit_code must be an integer.`);
      }
    }

    // If status is pass but any command has non-zero exit code, that's suspicious
    if (v.status === 'pass') {
      const failedCommands = v.machine_evidence.filter(e => typeof e.exit_code === 'number' && e.exit_code !== 0);
      if (failedCommands.length > 0) {
        errors.push(
          `verification.status is "pass" but ${failedCommands.length} command(s) have non-zero exit codes. Wrap expected-failure checks in a verifier that exits 0 only when the failure occurs as expected, or do not report "pass".`
        );
      }
    }
  }

  return { errors, warnings };
}

// ── Stage E: Protocol Compliance ─────────────────────────────────────────────

function validateProtocol(tr, state, config) {
  const errors = [];
  const warnings = [];

  const role = config.roles?.[tr.role];
  const writeAuthority = role?.write_authority;

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
export function normalizeTurnResult(tr, config) {
  const corrections = [];
  if (tr === null || typeof tr !== 'object' || Array.isArray(tr)) {
    return { normalized: tr, corrections };
  }

  const normalized = { ...tr };

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

  // ── Rule 2: exit-gate-as-phase auto-correction ────────────────────────
  const routing = config?.routing;
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

  return { normalized, corrections };
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
