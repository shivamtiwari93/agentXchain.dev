import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluatePhaseExit, evaluateRunCompletion } from './gate-evaluator.js';
import {
  approvePhaseTransition,
  approveRunCompletion,
  assignGovernedTurn,
  initializeGovernedRun,
  normalizeGovernedStateShape,
} from './governed-state.js';
import { validateStagedTurnResult } from './turn-result-validator.js';
import { finalizeDispatchManifest, verifyDispatchManifest } from './dispatch-manifest.js';
import { getDispatchTurnDir } from './turn-paths.js';
import { runHooks } from './hook-runner.js';
import { validateCoordinatorConfig, normalizeCoordinatorConfig } from './coordinator-config.js';
import { VALID_RUN_EVENTS, emitRunEvent } from './run-events.js';
import { projectRepoAcceptance, evaluateBarriers } from './coordinator-acceptance.js';
import { readBarriers, saveCoordinatorState, readCoordinatorHistory } from './coordinator-state.js';

const VALID_DECISION_CATEGORIES = ['implementation', 'architecture', 'scope', 'process', 'quality', 'release'];
const FULL_STAGE_PIPELINE = ['schema', 'assignment', 'artifact', 'verification', 'protocol'];

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function inflateConfig(rawConfig = {}) {
  const config = deepClone(rawConfig);
  const roles = config.roles || {};
  const runtimes = config.runtimes || {};

  config.schema_version = config.schema_version || '1.0';
  config.project = config.project || { id: 'conformance-target', name: 'Conformance Target' };
  config.roles = Object.fromEntries(
    Object.entries(roles).map(([roleId, role]) => [
      roleId,
      {
        title: role?.title || roleId.toUpperCase(),
        mandate: role?.mandate || `Execute ${roleId} responsibilities.`,
        write_authority: role?.write_authority || 'authoritative',
        runtime: role?.runtime || 'manual',
        ...role,
      },
    ]),
  );

  for (const role of Object.values(config.roles)) {
    const runtimeId = role.runtime;
    if (!runtimeId) continue;
    if (!(runtimeId in runtimes) && runtimeId === 'manual') {
      runtimes.manual = { type: 'manual' };
    }
  }

  config.runtimes = Object.fromEntries(
    Object.entries(runtimes).map(([runtimeId, runtime]) => [
      runtimeId,
      {
        type: runtime?.type || 'manual',
        ...runtime,
      },
    ]),
  );
  config.routing = config.routing || {};
  config.gates = config.gates || {};
  config.rules = {
    challenge_required: true,
    ...(config.rules || {}),
  };

  return config;
}

function validateFixtureConfig(config) {
  const errors = [];

  if (config.schema_version !== '1.0') {
    errors.push(`schema_version must be "1.0", got "${config.schema_version}"`);
  }

  for (const [roleId, role] of Object.entries(config.roles || {})) {
    if (!role.runtime || !config.runtimes?.[role.runtime]) {
      errors.push(`Role "${roleId}" references unknown runtime "${role.runtime}"`);
    }
  }

  for (const [phase, route] of Object.entries(config.routing || {})) {
    if (route.entry_role && !config.roles?.[route.entry_role]) {
      errors.push(`Routing "${phase}": entry_role "${route.entry_role}" is not a defined role`);
    }
    for (const nextRole of route.allowed_next_roles || []) {
      if (nextRole !== 'human' && !config.roles?.[nextRole]) {
        errors.push(`Routing "${phase}": allowed_next_roles references unknown role "${nextRole}"`);
      }
    }
    if (route.exit_gate && !config.gates?.[route.exit_gate]) {
      errors.push(`Routing references unknown gate: "${route.exit_gate}"`);
    }
  }

  return errors;
}

function normalizeActiveTurns(activeTurns = {}, config) {
  return Object.fromEntries(
    Object.entries(activeTurns).map(([turnId, turn]) => {
      const roleId = turn.assigned_role || turn.role || 'dev';
      const runtimeId = turn.runtime_id || config.roles?.[roleId]?.runtime || 'manual';
      return [
        turnId,
        {
          turn_id: turn.turn_id || turnId,
          assigned_role: roleId,
          runtime_id: runtimeId,
          status: turn.status || 'running',
          attempt: turn.attempt || 1,
          assigned_sequence: turn.assigned_sequence || 1,
          ...turn,
          turn_id: turn.turn_id || turnId,
          assigned_role: roleId,
          runtime_id: runtimeId,
        },
      ];
    }),
  );
}

function inflateState(rawState = {}, config) {
  const state = {
    schema_version: '1.1',
    run_id: rawState.run_id ?? null,
    project_id: config.project?.id || 'conformance-target',
    status: rawState.status || 'idle',
    phase: rawState.phase || 'planning',
    accepted_integration_ref: rawState.accepted_integration_ref ?? null,
    active_turns: normalizeActiveTurns(rawState.active_turns || {}, config),
    pending_phase_transition: rawState.pending_phase_transition ?? null,
    pending_run_completion: rawState.pending_run_completion ?? null,
    blocked_on: rawState.blocked_on ?? null,
    blocked_reason: rawState.blocked_reason ?? null,
    escalation: rawState.escalation ?? null,
    last_gate_failure: rawState.last_gate_failure ?? null,
    accepted_sequence: rawState.accepted_sequence ?? 0,
    turn_sequence: rawState.turn_sequence ?? 0,
    budget_reservations: rawState.budget_reservations ?? {},
    phase_gate_status: rawState.phase_gate_status ?? {},
  };

  return normalizeGovernedStateShape(state).state;
}

function writeJson(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function writeJsonl(filePath, entries) {
  mkdirSync(dirname(filePath), { recursive: true });
  const content = entries.map((entry) => JSON.stringify(entry)).join('\n');
  writeFileSync(filePath, content ? `${content}\n` : '');
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readJsonl(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8').trim();
    if (!content) return [];
    return content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function materializeFixtureWorkspace(fixture) {
  const root = mkdtempSync(join(tmpdir(), 'agentxchain-conformance-'));
  const setup = fixture.setup || {};
  const rawConfig = setup.config || {};
  const inflatedConfig = inflateConfig(rawConfig);
  const state = inflateState(setup.state || {}, inflatedConfig);

  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  writeJson(join(root, 'agentxchain.json'), inflatedConfig);
  writeJson(join(root, '.agentxchain', 'state.json'), state);
  writeJsonl(join(root, '.agentxchain', 'history.jsonl'), setup.history || []);
  writeJsonl(join(root, '.agentxchain', 'decision-ledger.jsonl'), setup.ledger || []);

  const stagedTurnResult = setup.turn_result || fixture.input?.args?.turn_result;
  if (stagedTurnResult) {
    writeJson(join(root, '.agentxchain', 'staging', 'turn-result.json'), stagedTurnResult);
  }

  for (const [relPath, content] of Object.entries(setup.filesystem || {})) {
    const absPath = join(root, relPath);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, content);
  }

  // Materialize dispatch bundle files for manifest fixtures
  for (const [turnId, files] of Object.entries(setup.dispatch_bundle || {})) {
    const bundleDir = join(root, getDispatchTurnDir(turnId));
    mkdirSync(bundleDir, { recursive: true });
    for (const [fileName, content] of Object.entries(files)) {
      writeFileSync(join(bundleDir, fileName), content);
    }
  }

  return {
    root,
    rawConfig,
    inflatedConfig,
    fixtureConfig: inflatedConfig,
    configErrors: validateFixtureConfig(inflatedConfig),
    initialState: state,
  };
}

// ── Tier 3: Multi-workspace materialization ─────────────────────────────────

function materializeTier3Workspace(fixture) {
  const root = mkdtempSync(join(tmpdir(), 'agentxchain-conformance-multi-'));
  const setup = fixture.setup || {};

  // Write coordinator config
  if (setup.coordinator_config) {
    writeJson(join(root, 'agentxchain-multi.json'), setup.coordinator_config);
  }

  // Materialize governed repo roots
  for (const [repoId, repoSetup] of Object.entries(setup.repos || {})) {
    const repoPath = join(root, repoSetup.path || `./repos/${repoId}`);
    mkdirSync(join(repoPath, '.agentxchain'), { recursive: true });

    // Write repo-local agentxchain.json
    if (repoSetup.config) {
      writeJson(join(repoPath, 'agentxchain.json'), repoSetup.config);
    }

    // Write repo-local state
    if (repoSetup.state) {
      const repoConfig = repoSetup.config || {};
      const inflatedRepoConfig = inflateConfig(repoConfig);
      const repoState = inflateState(repoSetup.state, inflatedRepoConfig);
      writeJson(join(repoPath, '.agentxchain', 'state.json'), repoState);
    }

    // Write repo-local history
    if (repoSetup.history) {
      writeJsonl(join(repoPath, '.agentxchain', 'history.jsonl'), repoSetup.history);
    }

    // Write repo-local files
    for (const [filePath, content] of Object.entries(repoSetup.files || {})) {
      const absPath = join(repoPath, filePath);
      mkdirSync(dirname(absPath), { recursive: true });
      writeFileSync(absPath, content);
    }
  }

  // Write coordinator multirepo state if provided
  if (setup.coordinator_state || setup.barriers) {
    const multiDir = join(root, '.agentxchain', 'multirepo');
    mkdirSync(multiDir, { recursive: true });

    if (setup.coordinator_state) {
      writeJson(join(multiDir, 'state.json'), setup.coordinator_state);
    }

    if (setup.barriers) {
      writeJson(join(multiDir, 'barriers.json'), setup.barriers);
    }

    // Write coordinator history
    writeJsonl(join(multiDir, 'history.jsonl'), setup.coordinator_history || []);
    writeJsonl(join(multiDir, 'barrier-ledger.jsonl'), setup.barrier_ledger || []);
  }

  return root;
}

function isAssertionObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && typeof value.assert === 'string';
}

function matchUnorderedArray(expectedItems, actual) {
  if (!Array.isArray(expectedItems) || !Array.isArray(actual) || expectedItems.length !== actual.length) {
    return false;
  }

  const used = new Set();

  for (const expectedItem of expectedItems) {
    let matchedIndex = -1;
    for (let index = 0; index < actual.length; index += 1) {
      if (used.has(index)) continue;
      if (matchExpected(expectedItem, actual[index])) {
        matchedIndex = index;
        break;
      }
    }

    if (matchedIndex === -1) {
      return false;
    }

    used.add(matchedIndex);
  }

  return true;
}

function matchExpected(expected, actual) {
  if (isAssertionObject(expected)) {
    if (expected.assert === 'nonempty_string') {
      return typeof actual === 'string' && actual.trim().length > 0;
    }
    if (expected.assert === 'id_prefix') {
      return typeof actual === 'string' && actual.startsWith(expected.value);
    }
    if (expected.assert === 'present') {
      return actual !== undefined;
    }
    if (expected.assert === 'unordered_array') {
      return matchUnorderedArray(expected.items, actual);
    }
    return false;
  }

  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && expected.length === actual.length
      && expected.every((value, index) => matchExpected(value, actual[index]));
  }

  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object') {
      return false;
    }
    return Object.entries(expected).every(([key, value]) => {
      if (key === 'warnings_allowed') {
        return true;
      }
      return matchExpected(value, actual[key]);
    });
  }

  return Object.is(expected, actual);
}

function buildFailure(message, actual) {
  return { status: 'fail', message, actual };
}

function buildPass(actual, message = 'Fixture passed') {
  return { status: 'pass', message, actual };
}

function classifyTurnValidation(validation) {
  if (validation.ok) {
    return {
      result: 'success',
      stages_passed: FULL_STAGE_PIPELINE,
      errors: [],
      warnings: validation.warnings || [],
    };
  }

  const actual = {
    result: 'error',
    failed_stage: validation.stage,
    errors: validation.errors,
    warnings: validation.warnings || [],
  };
  const firstError = validation.errors?.[0] || '';
  const allErrors = validation.errors || [];

  if (validation.stage === 'schema' && firstError.startsWith('Missing required field: ')) {
    actual.error_type = 'missing_required_field';
    actual.error_field = firstError.replace('Missing required field: ', '');
  } else if (validation.stage === 'schema' && firstError.includes('.id must match pattern DEC-NNN.')) {
    actual.error_type = 'invalid_decision_id_format';
    actual.error_detail = 'Decision ID must match DEC-NNN pattern';
  } else if (validation.stage === 'assignment' && firstError.startsWith('run_id mismatch')) {
    actual.error_type = 'run_id_mismatch';
  } else if (validation.stage === 'assignment' && firstError.startsWith('turn_id mismatch')) {
    actual.error_type = 'turn_id_mismatch';
  } else if (validation.stage === 'artifact' && firstError.startsWith('Turn result claims modification of reserved path: ')) {
    actual.error_type = 'reserved_path_violation';
    actual.error_path = firstError.replace('Turn result claims modification of reserved path: ', '');
  } else if (validation.stage === 'protocol' && firstError.startsWith('Protocol violation:')) {
    actual.error_type = 'challenge_requirement_violated';
    actual.error_detail = 'review_only role must raise at least one objection';
  } else if (validation.stage === 'protocol' && allErrors.some((error) => error.includes('mutually exclusive'))) {
    actual.error_type = 'mutually_exclusive_requests';
    actual.error_detail = 'phase_transition_request and run_completion_request cannot both be present';
  } else {
    actual.error_type = validation.error_class || 'validation_error';
  }

  return actual;
}

function mapConfigErrors(errors) {
  const firstError = errors[0] || '';
  const actual = { result: 'error', errors };

  if (firstError.startsWith('Routing "implementation": entry_role "')) {
    actual.error_type = 'undeclared_role_reference';
    actual.error_field = 'routing.implementation.entry_role';
    actual.referenced_role = firstError.match(/entry_role "([^"]+)"/)?.[1] || null;
  } else if (firstError.startsWith('Role "dev" references unknown runtime "')) {
    actual.error_type = 'undeclared_runtime_reference';
    actual.error_field = 'roles.dev.runtime';
    actual.referenced_runtime = firstError.match(/runtime "([^"]+)"/)?.[1] || null;
  } else if (firstError.startsWith('Routing references unknown gate: "')) {
    actual.error_type = 'undeclared_gate_reference';
    actual.error_field = 'routing.implementation.exit_gate';
    actual.referenced_gate = firstError.match(/gate: "([^"]+)"/)?.[1] || null;
  } else if (firstError.includes('schema_version must be "1.0"')) {
    actual.error_type = 'schema_version_invalid';
    actual.expected_version = '1.0';
    actual.actual_version = firstError.match(/got "([^"]+)"/)?.[1] || null;
  } else {
    actual.error_type = 'invalid_config';
  }

  return actual;
}

function validateDecisionEntry(entry, existingLedger) {
  if (!/^DEC-\d+$/.test(entry.id || '')) {
    return { result: 'error', error_type: 'invalid_decision_id_format' };
  }
  if (!entry.statement || !entry.statement.trim()) {
    return { result: 'error', error_type: 'empty_required_field', error_field: 'statement' };
  }
  if (!VALID_DECISION_CATEGORIES.includes(entry.category)) {
    return {
      result: 'error',
      error_type: 'invalid_enum_value',
      error_field: 'category',
      valid_values: VALID_DECISION_CATEGORIES,
    };
  }
  if (existingLedger.some((item) => item.id === entry.id)) {
    return { result: 'error', error_type: 'duplicate_decision_id', duplicate_id: entry.id };
  }
  return { result: 'success' };
}

function performAcceptTurnOperation(root, fixture, normalizedConfig) {
  const statePath = join(root, '.agentxchain', 'state.json');
  const historyPath = join(root, '.agentxchain', 'history.jsonl');
  const stagingPath = join(root, '.agentxchain', 'staging', 'turn-result.json');
  const stateBefore = readJson(statePath);
  const historyBefore = readJsonl(historyPath);
  const requestedTurnId = fixture.input.args.turn_id;

  if (historyBefore.some((entry) => entry.turn_id === requestedTurnId)) {
    return {
      result: 'error',
      error_type: 'turn_already_accepted',
      history_length: historyBefore.length,
    };
  }

  const activeTurn = stateBefore.active_turns?.[requestedTurnId];
  if (!activeTurn) {
    return {
      result: 'error',
      error_type: 'turn_not_active',
      history_length: historyBefore.length,
      state_unchanged: true,
    };
  }

  const validation = validateStagedTurnResult(root, stateBefore, normalizedConfig.normalized, {
    stagingPath: '.agentxchain/staging/turn-result.json',
  });
  if (!validation.ok) {
    return classifyTurnValidation(validation);
  }

  const acceptedSequence = (stateBefore.accepted_sequence || 0) + 1;
  const entry = {
    turn_id: validation.turnResult.turn_id,
    run_id: validation.turnResult.run_id,
    role: validation.turnResult.role,
    status: validation.turnResult.status,
    summary: validation.turnResult.summary,
    accepted_sequence: acceptedSequence,
    accepted_at: new Date().toISOString(),
  };

  const nextState = {
    ...stateBefore,
    accepted_sequence: acceptedSequence,
    active_turns: Object.fromEntries(
      Object.entries(stateBefore.active_turns || {}).filter(([turnId]) => turnId !== requestedTurnId),
    ),
  };

  writeJson(statePath, nextState);
  writeJsonl(historyPath, [...historyBefore, entry]);

  return {
    result: 'success',
    state: {
      accepted_sequence: nextState.accepted_sequence,
      active_turns: nextState.active_turns,
    },
    history_length: historyBefore.length + 1,
    history_last_entry: entry,
  };
}

function finalizeManifestForFixture(root, turnId) {
  const state = readJson(join(root, '.agentxchain', 'state.json'));
  const activeTurn = state.active_turns?.[turnId];
  const identity = {
    run_id: state.run_id || 'run_001',
    role: activeTurn?.assigned_role || activeTurn?.role || 'dev',
  };
  const finalized = finalizeDispatchManifest(root, turnId, identity);
  if (!finalized.ok) {
    return {
      ok: false,
      actual: { result: 'error', error_type: 'finalization_failed', error: finalized.error },
    };
  }
  return { ok: true };
}

function applyManifestFixtureMutations(root, fixture, turnId) {
  const bundleDir = join(root, getDispatchTurnDir(turnId));

  for (const [fileName, content] of Object.entries(fixture.setup.post_finalize_inject?.[turnId] || {})) {
    writeFileSync(join(bundleDir, fileName), content);
  }

  for (const [fileName, content] of Object.entries(fixture.setup.post_finalize_tamper?.[turnId] || {})) {
    writeFileSync(join(bundleDir, fileName), content);
  }

  for (const fileName of fixture.setup.post_finalize_delete?.[turnId] || []) {
    try {
      unlinkSync(join(bundleDir, fileName));
    } catch {
      // Missing files are surfaced by manifest verification, not fixture setup.
    }
  }

  if (fixture.setup.post_finalize_delete_manifest) {
    try {
      unlinkSync(join(bundleDir, 'MANIFEST.json'));
    } catch {
      // Missing manifest is surfaced by manifest verification, not fixture setup.
    }
  }

  const corruptedManifest = fixture.setup.post_finalize_corrupt_manifest?.[turnId];
  if (corruptedManifest !== undefined) {
    const nextManifestContent = typeof corruptedManifest === 'string'
      ? corruptedManifest
      : JSON.stringify(corruptedManifest, null, 2);
    writeFileSync(join(bundleDir, 'MANIFEST.json'), nextManifestContent);
  }
}

function executeFixtureOperation(workspace, fixture) {
  const { root, fixtureConfig, configErrors } = workspace;
  const operation = fixture.input.operation;

  switch (operation) {
    case 'initialize_run': {
      if (configErrors.length > 0) {
        return { result: 'error', error_type: 'invalid_config', errors: configErrors, state_unchanged: true };
      }
      const result = initializeGovernedRun(root, fixtureConfig);
      if (!result.ok) {
        return { result: 'error', error_type: 'invalid_state_transition', error: result.error, state_unchanged: true };
      }
      return { result: 'ok', state_assertions: result.state };
    }

    case 'assign_turn': {
      if (configErrors.length > 0) {
        return { result: 'error', error_type: 'invalid_config', errors: configErrors, state_unchanged: true };
      }
      const result = assignGovernedTurn(root, fixtureConfig, fixture.input.args.role_id);
      if (!result.ok) {
        return { result: 'error', error_type: 'invalid_state_transition', error: result.error, state_unchanged: true };
      }
      return { result: 'ok', state_assertions: result.state };
    }

    case 'approve_transition': {
      const result = approvePhaseTransition(root, fixtureConfig);
      if (!result.ok) {
        return { result: 'error', error_type: 'invalid_state_transition', error: result.error, state_unchanged: true };
      }
      return { result: 'ok', state_assertions: result.state };
    }

    case 'approve_completion': {
      const result = approveRunCompletion(root, fixtureConfig);
      if (!result.ok) {
        return { result: 'error', error_type: 'invalid_state_transition', error: result.error, state_unchanged: true };
      }
      return { result: 'ok', state_assertions: result.state };
    }

    case 'resolve_blocked': {
      const statePath = join(root, '.agentxchain', 'state.json');
      const state = readJson(statePath);
      if (state.status !== 'blocked' || fixture.input.args.action !== 'resume') {
        return { result: 'error', error_type: 'invalid_state_transition', state_unchanged: true };
      }
      const nextState = {
        ...state,
        status: 'active',
        blocked_on: null,
        blocked_reason: null,
      };
      writeJson(statePath, nextState);
      return { result: 'ok', state_assertions: nextState };
    }

    case 'transition_state': {
      const statePath = join(root, '.agentxchain', 'state.json');
      const state = readJson(statePath);
      if (fixture.input.args.candidate_overrides?.run_id && fixture.input.args.candidate_overrides.run_id !== state.run_id) {
        return { result: 'error', error_type: 'immutable_field', state_unchanged: true };
      }
      if (fixture.input.args.target_status === 'completed' || fixture.input.args.target_status === 'paused') {
        return { result: 'error', error_type: 'invalid_state_transition', state_unchanged: true };
      }
      if (fixture.input.args.trigger === 'gate_requires_human_approval') {
        const nextState = {
          ...state,
          status: 'paused',
          pending_phase_transition: fixture.input.args.gate,
        };
        writeJson(statePath, nextState);
        return { result: 'ok', state_assertions: nextState };
      }
      if (fixture.input.args.trigger === 'escalation') {
        const roleId = fixture.input.args.role_id;
        const reason = fixture.input.args.reason?.replaceAll('_', '-') || 'unknown';
        const nextState = {
          ...state,
          status: 'blocked',
          blocked_on: `escalation:${reason}:${roleId}`,
        };
        writeJson(statePath, nextState);
        return { result: 'ok', state_assertions: nextState };
      }
      return { result: 'error', error_type: 'invalid_state_transition', state_unchanged: true };
    }

    case 'validate_turn_result': {
      const validation = validateStagedTurnResult(root, readJson(join(root, '.agentxchain', 'state.json')), fixtureConfig, {
        stagingPath: '.agentxchain/staging/turn-result.json',
      });
      return classifyTurnValidation(validation);
    }

    case 'evaluate_phase_exit': {
      const state = readJson(join(root, '.agentxchain', 'state.json'));
      const acceptedTurn = {
        phase_transition_request: fixture.input.args.requested_phase,
        verification: fixture.setup.turn_result?.verification || { status: 'pass' },
      };
      const result = evaluatePhaseExit({
        state,
        config: fixtureConfig,
        acceptedTurn,
        root,
      });
      if (result.action === 'unknown_phase') {
        return { result: 'error', action: 'gate_error', error_type: 'unknown_phase', state_unchanged: true };
      }
      if (result.action === 'awaiting_human_approval') {
        return {
          result: 'success',
          action: result.action,
          new_status: 'paused',
          pending_phase_transition: {
            from: state.phase,
            to: result.next_phase,
          },
        };
      }
      if (result.action === 'advance') {
        return { result: 'success', action: 'advance', new_phase: result.next_phase };
      }
      return {
        result: 'success',
        action: result.action,
        phase_unchanged: true,
        state_unchanged: true,
        reason: result.missing_files.length > 0
          ? 'requires_files predicate failed'
          : result.missing_verification
            ? 'requires_verification_pass predicate failed'
            : (result.reasons[0] || null),
      };
    }

    case 'evaluate_run_completion': {
      const state = readJson(join(root, '.agentxchain', 'state.json'));
      const acceptedTurn = {
        run_completion_request: fixture.setup.turn_result?.run_completion_request ?? true,
        verification: fixture.setup.turn_result?.verification || { status: 'pass' },
      };
      const result = evaluateRunCompletion({
        state,
        config: fixtureConfig,
        acceptedTurn,
        root,
      });

      if (result.action === 'awaiting_human_approval') {
        return {
          result: 'success',
          action: result.action,
          new_status: 'paused',
          pending_run_completion: {
            phase: state.phase,
            gate: result.gate_id,
          },
        };
      }

      if (result.action === 'complete') {
        return {
          result: 'success',
          action: result.action,
          new_status: 'completed',
        };
      }

      return {
        result: 'success',
        action: result.action,
        state_unchanged: true,
        reason: result.missing_files.length > 0
          ? 'requires_files predicate failed'
          : result.missing_verification
            ? 'requires_verification_pass predicate failed'
            : (result.reasons[0] || null),
      };
    }

    case 'append_decision': {
      const ledgerPath = join(root, '.agentxchain', 'decision-ledger.jsonl');
      const existingLedger = readJsonl(ledgerPath);
      const decisionCheck = validateDecisionEntry(fixture.input.args.entry, existingLedger);
      if (decisionCheck.result === 'error') {
        return {
          ...decisionCheck,
          ledger_length: existingLedger.length,
        };
      }
      const nextLedger = [...existingLedger, fixture.input.args.entry];
      writeJsonl(ledgerPath, nextLedger);
      return {
        result: 'success',
        ledger_length: nextLedger.length,
        ledger_last_entry: fixture.input.args.entry,
      };
    }

    case 'accept_turn':
      return performAcceptTurnOperation(root, fixture, { normalized: fixtureConfig });

    case 'validate_config': {
      const candidate = inflateConfig(fixture.input.args.config);
      const errors = validateFixtureConfig(candidate);
      if (errors.length > 0) {
        return mapConfigErrors(errors);
      }
      return { result: 'success', errors: [] };
    }

    // ── Tier 2: Dispatch Manifest ────────────────────────────────────────

    case 'verify_dispatch_manifest': {
      const turnId = fixture.input.args.turn_id;
      const finalization = finalizeManifestForFixture(root, turnId);
      if (!finalization.ok) {
        return finalization.actual;
      }
      applyManifestFixtureMutations(root, fixture, turnId);
      const ver = verifyDispatchManifest(root, turnId);
      if (!ver.ok) {
        return { result: 'error', error_type: ver.errors[0]?.type || 'verification_failed', verification_errors: ver.errors };
      }
      return {
        result: 'success',
        manifest_valid: true,
        manifest: ver.manifest,
        verification_errors: [],
      };
    }

    case 'inspect_dispatch_manifest': {
      const turnId = fixture.input.args.turn_id;
      const finalization = finalizeManifestForFixture(root, turnId);
      if (!finalization.ok) {
        return finalization.actual;
      }
      const ver = verifyDispatchManifest(root, turnId);
      const manifest = ver.manifest || readJson(join(root, getDispatchTurnDir(turnId), 'MANIFEST.json'));
      const filePaths = manifest.files.map((f) => f.path);
      const containsSelf = filePaths.includes('MANIFEST.json');
      return {
        result: 'success',
        manifest_contains_self: containsSelf,
        file_paths: filePaths,
      };
    }

    // ── Tier 2: Hook Audit ──────────────────────────────────────────────

    case 'run_hooks': {
      const phase = fixture.input.args.phase;
      const payload = fixture.input.args.payload || {};
      const hooksConfig = fixtureConfig.hooks || {};
      const state = readJson(join(root, '.agentxchain', 'state.json'));
      const auditDir = join(root, '.agentxchain');
      const hookResult = runHooks(root, hooksConfig, phase, payload, {
        run_id: state.run_id || payload.run_id || '',
        turn_id: payload.turn_id || null,
        auditDir,
        protectedPaths: [
          '.agentxchain/state.json',
          '.agentxchain/history.jsonl',
          '.agentxchain/decision-ledger.jsonl',
        ],
      });

      // Return the first audit entry for single-hook fixtures
      const auditEntry = hookResult.results?.[0] || null;
      return {
        result: 'success',
        hook_ok: hookResult.ok,
        blocked: hookResult.blocked || false,
        audit_entry: auditEntry,
        audit_entries: hookResult.results || [],
      };
    }

    // ── Tier 1: Event Lifecycle ──────────────────────────────────────────

    case 'validate_event': {
      const event = fixture.input.args.event;
      const errors = [];
      if (!event || typeof event !== 'object') {
        return { result: 'error', error_type: 'invalid_event', errors: ['Event must be an object'] };
      }
      if (typeof event.event_id !== 'string' || !event.event_id.trim()) {
        errors.push('event_id must be a non-empty string');
      }
      if (!VALID_RUN_EVENTS.includes(event.event_type)) {
        errors.push(`event_type must be one of: ${VALID_RUN_EVENTS.join(', ')}`);
      }
      if (typeof event.timestamp !== 'string' || Number.isNaN(Date.parse(event.timestamp))) {
        errors.push('timestamp must be a valid ISO-8601 string');
      }
      if (errors.length > 0) {
        return { result: 'error', error_type: 'invalid_event', errors };
      }
      return { result: 'success', errors: [] };
    }

    case 'validate_event_ordering': {
      const events = fixture.input.args.events;
      const errors = [];
      if (!Array.isArray(events) || events.length === 0) {
        return { result: 'error', error_type: 'invalid_events', errors: ['Events must be a non-empty array'] };
      }
      // run_started must be first
      if (events[0].event_type !== 'run_started') {
        errors.push('First event must be run_started');
      }
      // run_completed must be last (if present)
      const lastEvent = events[events.length - 1];
      if (events.some((e) => e.event_type === 'run_completed') && lastEvent.event_type !== 'run_completed') {
        errors.push('run_completed must be the last event');
      }
      // turn_dispatched must precede turn_accepted for same turn
      const dispatchedTurns = new Map();
      for (const event of events) {
        if (event.event_type === 'turn_dispatched' && event.turn?.turn_id) {
          dispatchedTurns.set(event.turn.turn_id, true);
        }
        if (event.event_type === 'turn_accepted' && event.turn?.turn_id) {
          if (!dispatchedTurns.has(event.turn.turn_id)) {
            errors.push(`turn_accepted for ${event.turn.turn_id} without preceding turn_dispatched`);
          }
        }
      }
      // Timestamps must be monotonically non-decreasing
      for (let i = 1; i < events.length; i++) {
        if (new Date(events[i].timestamp) < new Date(events[i - 1].timestamp)) {
          errors.push(`Event ${i} timestamp is before event ${i - 1}`);
        }
      }
      if (errors.length > 0) {
        return { result: 'error', error_type: 'ordering_violation', errors };
      }
      return { result: 'success', errors: [] };
    }

    default:
      return { result: 'error', error_type: 'unsupported_operation', operation };
  }
}

function executeTier3Operation(fixture) {
  const root = materializeTier3Workspace(fixture);
  try {
    const operation = fixture.input.operation;

    if (operation === 'validate_coordinator_config') {
      const configPath = join(root, 'agentxchain-multi.json');
      const raw = JSON.parse(readFileSync(configPath, 'utf8'));
      const validation = validateCoordinatorConfig(raw);
      if (!validation.ok) {
        const firstError = validation.errors[0] || '';
        let errorType = 'invalid_coordinator_config';
        if (firstError.startsWith('workstream_cycle:')) {
          errorType = 'workstream_cycle';
        }
        return { result: 'error', error_type: errorType, errors: validation.errors };
      }
      return { result: 'success', errors: [] };
    }

    if (operation === 'project_repo_acceptance') {
      const args = fixture.input.args;
      const configPath = join(root, 'agentxchain-multi.json');
      const raw = JSON.parse(readFileSync(configPath, 'utf8'));
      const normalized = normalizeCoordinatorConfig(raw);

      // Resolve repo paths against the materialized workspace
      for (const [repoId, repo] of Object.entries(normalized.repos)) {
        const resolvedPath = join(root, repo.path);
        normalized.repos[repoId] = { ...repo, resolved_path: resolvedPath };
      }
      normalized.repo_order = Object.keys(normalized.repos);

      const stateDir = join(root, '.agentxchain', 'multirepo');
      const state = JSON.parse(readFileSync(join(stateDir, 'state.json'), 'utf8'));

      const projectionResult = projectRepoAcceptance(
        root, state, normalized,
        args.repo_id, args.accepted_turn, args.workstream_id,
      );

      if (!projectionResult.ok) {
        let errorType = 'projection_failed';
        if (projectionResult.error && projectionResult.error.includes('Cross-repo write violation')) {
          errorType = 'cross_repo_write_violation';
        }
        return { result: 'error', error_type: errorType, error: projectionResult.error };
      }

      // Evaluate barriers after projection
      const barrierResult = evaluateBarriers(root, state, normalized);

      return {
        result: 'success',
        projection_ref: projectionResult.projection_ref,
        barrier_effects: projectionResult.barrier_effects || [],
        barrier_snapshot: Object.fromEntries(
          Object.entries(barrierResult.barriers).map(([id, b]) => [id, { status: b.status }]),
        ),
      };
    }

    return { result: 'error', error_type: 'unsupported_operation', operation };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function compareActualToExpected(fixture, actual) {
  if (matchExpected(fixture.expected, actual)) {
    return buildPass(actual);
  }
  return buildFailure(`Expected ${fixture.fixture_id} to match declared output`, actual);
}

export function runReferenceFixture(fixture) {
  // Tier 3 fixtures use multi-workspace materialization; route before creating a Tier 1/2 workspace
  const operation = fixture.input?.operation;
  if (operation === 'validate_coordinator_config' || operation === 'project_repo_acceptance') {
    const actual = executeTier3Operation(fixture);
    return compareActualToExpected(fixture, actual);
  }

  const workspace = materializeFixtureWorkspace(fixture);
  try {
    const actual = executeFixtureOperation(workspace, fixture);
    return compareActualToExpected(fixture, actual);
  } finally {
    rmSync(workspace.root, { recursive: true, force: true });
  }
}
