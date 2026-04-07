import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import {
  writeDispatchBundle,
  DISPATCH_INDEX_PATH,
  RESERVED_PATHS,
  getDispatchTurnDir,
  getTurnStagingResultPath,
} from '../src/lib/dispatch-bundle.js';
import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  normalizeGovernedStateShape,
  getActiveTurn,
  STATE_PATH,
  HISTORY_PATH,
  STAGING_PATH,
} from '../src/lib/governed-state.js';
import { scaffoldGoverned } from '../src/commands/init.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-dispatch-test-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(root, relPath) {
  const parsed = JSON.parse(readFileSync(join(root, relPath), 'utf8'));
  if (relPath === STATE_PATH || relPath.endsWith('state.json')) {
    const normalized = normalizeGovernedStateShape(parsed).state;
    Object.defineProperty(normalized, 'current_turn', {
      configurable: true,
      enumerable: false,
      get() {
        return getActiveTurn(normalized);
      },
    });
    return normalized;
  }
  return parsed;
}

function makeNormalizedConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'test-project', name: 'Test Project', default_branch: 'main' },
    roles: {
      pm: { title: 'Product Manager', mandate: 'Protect user value.', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-pm' },
      dev: { title: 'Developer', mandate: 'Implement approved work safely.', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-dev' },
      qa: { title: 'QA', mandate: 'Challenge correctness.', write_authority: 'review_only', runtime_class: 'api_proxy', runtime_id: 'api-qa' },
      eng_director: { title: 'Engineering Director', mandate: 'Resolve deadlocks.', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-director' },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'local-dev': { type: 'local_cli' },
      'api-qa': { type: 'api_proxy' },
      'manual-director': { type: 'manual' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'eng_director', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'eng_director', 'human'], exit_gate: 'implementation_complete' },
      qa: { entry_role: 'qa', allowed_next_roles: ['dev', 'qa', 'eng_director', 'human'], exit_gate: 'qa_ship_verdict' },
    },
    gates: {
      planning_signoff: {
        requires_files: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md'],
        requires_human_approval: true,
      },
      implementation_complete: { requires_verification_pass: true },
      qa_ship_verdict: {
        requires_files: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md', '.planning/RELEASE_NOTES.md'],
        requires_human_approval: true,
      },
    },
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    rules: { challenge_required: true, max_turn_retries: 2, max_deadlock_cycles: 2 },
    prompts: { pm: '.agentxchain/prompts/pm.md', dev: '.agentxchain/prompts/dev.md' },
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
    compat: { next_owner_source: 'state-json', lock_based_coordination: false, original_version: 4 },
  };
}

function bundleDirFor(state) {
  return getDispatchTurnDir(state.current_turn.turn_id);
}

function stagingPathFor(state) {
  return getTurnStagingResultPath(state.current_turn.turn_id);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('writeDispatchBundle', () => {
  let root;
  let config;

  beforeEach(() => {
    root = makeTmpDir();
    config = makeNormalizedConfig();
    scaffoldGoverned(root, 'test-project');
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  it('rejects when no active turn', () => {
    const state = readJson(root, STATE_PATH);
    const result = writeDispatchBundle(root, state, config);
    assert.equal(result.ok, false);
    assert.match(result.error, /No active turn/);
  });

  it('writes ASSIGNMENT.json, PROMPT.md, CONTEXT.md on success', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const state = readJson(root, STATE_PATH);

    const result = writeDispatchBundle(root, state, config);
    assert.equal(result.ok, true);

    const bundleDir = join(root, bundleDirFor(state));
    assert.ok(existsSync(join(bundleDir, 'ASSIGNMENT.json')));
    assert.ok(existsSync(join(bundleDir, 'PROMPT.md')));
    assert.ok(existsSync(join(bundleDir, 'CONTEXT.md')));
  });

  it('ASSIGNMENT.json contains correct turn metadata', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const state = readJson(root, STATE_PATH);

    writeDispatchBundle(root, state, config);
    const assignment = readJson(root, join(bundleDirFor(state), 'ASSIGNMENT.json'));

    assert.equal(assignment.run_id, state.run_id);
    assert.equal(assignment.turn_id, state.current_turn.turn_id);
    assert.equal(assignment.phase, 'planning');
    assert.equal(assignment.role, 'pm');
    assert.equal(assignment.runtime_id, 'manual-pm');
    assert.equal(assignment.write_authority, 'review_only');
    assert.equal(assignment.staging_result_path, stagingPathFor(state));
    assert.deepEqual(assignment.reserved_paths, RESERVED_PATHS);
    assert.deepEqual(assignment.allowed_next_roles, ['pm', 'eng_director', 'human']);
    assert.equal(assignment.attempt, 1);
    assert.ok(assignment.deadline_at);
  });

  it('PROMPT.md includes role mandate and protocol rules', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const state = readJson(root, STATE_PATH);

    writeDispatchBundle(root, state, config);
    const prompt = readFileSync(join(root, bundleDirFor(state), 'PROMPT.md'), 'utf8');

    assert.match(prompt, /Product Manager/);
    assert.match(prompt, /Protect user value/);
    assert.match(prompt, /Protocol Rules/);
    assert.match(prompt, /staging\/turn_[^/]+\/turn-result\.json/);
    assert.match(prompt, /review_only/);
    assert.match(prompt, /Challenge the previous turn/);
    assert.match(prompt, /reserved state files/);
  });

  it('PROMPT.md includes review_only constraints for PM', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const state = readJson(root, STATE_PATH);

    writeDispatchBundle(root, state, config);
    const prompt = readFileSync(join(root, bundleDirFor(state), 'PROMPT.md'), 'utf8');

    assert.match(prompt, /Write Authority: review_only/);
    assert.match(prompt, /may NOT modify product\/code files/);
    assert.match(prompt, /MUST raise at least one objection/);
  });

  it('PROMPT.md includes authoritative constraints for dev', () => {
    initializeGovernedRun(root, config);
    // Move to implementation phase for dev
    const state = readJson(root, STATE_PATH);
    state.phase = 'implementation';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state, null, 2));

    assignGovernedTurn(root, config, 'dev');
    const updatedState = readJson(root, STATE_PATH);

    writeDispatchBundle(root, updatedState, config);
    const prompt = readFileSync(join(root, bundleDirFor(updatedState), 'PROMPT.md'), 'utf8');

    assert.match(prompt, /Write Authority: authoritative/);
    assert.match(prompt, /directly modify repository files/);
  });

  it('PROMPT.md includes gate requirements', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const state = readJson(root, STATE_PATH);

    writeDispatchBundle(root, state, config);
    const prompt = readFileSync(join(root, bundleDirFor(state), 'PROMPT.md'), 'utf8');

    assert.match(prompt, /planning_signoff/);
    assert.match(prompt, /PM_SIGNOFF\.md/);
    assert.match(prompt, /ROADMAP\.md/);
  });

  it('PROMPT.md includes retry context when attempt > 1', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const state = readJson(root, STATE_PATH);

    // Simulate a retry
    state.current_turn.attempt = 2;
    state.current_turn.last_rejection = {
      reason: 'Schema validation failed',
      failed_stage: 'schema',
      validation_errors: ['Missing required field: summary'],
    };
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state, null, 2));

    writeDispatchBundle(root, state, config);
    const prompt = readFileSync(join(root, bundleDirFor(state), 'PROMPT.md'), 'utf8');

    assert.match(prompt, /Previous Attempt Failed/);
    assert.match(prompt, /attempt 2/);
    assert.match(prompt, /Schema validation failed/);
    assert.match(prompt, /Missing required field: summary/);
  });

  it('ASSIGNMENT.json and PROMPT.md include conflict context on reassign', () => {
    initializeGovernedRun(root, config);
    const assignResult = assignGovernedTurn(root, config, 'dev');
    const state = assignResult.state;

    state.current_turn.attempt = 2;
    state.current_turn.status = 'retrying';
    state.current_turn.conflict_context = {
      prior_attempt_turn_id: state.current_turn.turn_id,
      prior_attempt_number: 1,
      conflict_type: 'file_conflict',
      conflicting_files: ['src/core/handler.ts'],
      accepted_turns_since: [
        {
          turn_id: 'turn_prev',
          role: 'qa',
          files_changed: ['src/core/handler.ts'],
        },
      ],
      non_conflicting_files_preserved: ['src/core/types.ts'],
      guidance: 'Rebase on the current workspace state before retrying.',
    };

    writeDispatchBundle(root, state, config);

    const assignment = readJson(root, join(bundleDirFor(state), 'ASSIGNMENT.json'));
    const prompt = readFileSync(join(root, bundleDirFor(state), 'PROMPT.md'), 'utf8');

    assert.deepEqual(assignment.conflict_context.conflicting_files, ['src/core/handler.ts']);
    assert.match(prompt, /File Conflict - Retry Required/);
    assert.match(prompt, /src\/core\/handler\.ts/);
    assert.match(prompt, /turn_prev/);
    assert.match(prompt, /src\/core\/types\.ts/);
  });

  it('CONTEXT.md includes current state summary', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const state = readJson(root, STATE_PATH);

    writeDispatchBundle(root, state, config);
    const context = readFileSync(join(root, bundleDirFor(state), 'CONTEXT.md'), 'utf8');

    assert.match(context, /Current State/);
    assert.match(context, /Phase:.*planning/);
    assert.match(context, /Budget spent/);
  });

  it('CONTEXT.md includes gate required files with existence check', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const state = readJson(root, STATE_PATH);

    writeDispatchBundle(root, state, config);
    const context = readFileSync(join(root, bundleDirFor(state), 'CONTEXT.md'), 'utf8');

    // PM_SIGNOFF.md is scaffolded by init --governed
    assert.match(context, /PM_SIGNOFF\.md/);
    assert.match(context, /ROADMAP\.md/);
  });

  it('CONTEXT.md includes phase gate status', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const state = readJson(root, STATE_PATH);

    writeDispatchBundle(root, state, config);
    const context = readFileSync(join(root, bundleDirFor(state), 'CONTEXT.md'), 'utf8');

    assert.match(context, /Phase Gate Status/);
    assert.match(context, /planning_signoff/);
  });

  it('clears previous dispatch bundle before writing', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const state = readJson(root, STATE_PATH);

    // Write a stale file in the dispatch dir
    const bundleDir = join(root, bundleDirFor(state));
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(join(bundleDir, 'STALE.txt'), 'old data');

    writeDispatchBundle(root, state, config);

    assert.ok(!existsSync(join(bundleDir, 'STALE.txt')));
    assert.ok(existsSync(join(bundleDir, 'ASSIGNMENT.json')));
  });

  it('rejects when role not found in config', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const state = readJson(root, STATE_PATH);

    // Corrupt the role reference
    state.current_turn.assigned_role = 'nonexistent';
    const result = writeDispatchBundle(root, state, config);
    assert.equal(result.ok, false);
    assert.match(result.error, /not found in config/);
  });
});

describe('resume workflow: full dispatch cycle', () => {
  let root;
  let config;

  beforeEach(() => {
    root = makeTmpDir();
    config = makeNormalizedConfig();
    scaffoldGoverned(root, 'test-project');
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  it('idle → init → assign → dispatch produces a complete bundle', () => {
    // This is the happy path that resume follows for a fresh project
    const initResult = initializeGovernedRun(root, config);
    assert.ok(initResult.ok);

    const assignResult = assignGovernedTurn(root, config, 'pm');
    assert.ok(assignResult.ok);

    const bundleResult = writeDispatchBundle(root, assignResult.state, config);
    assert.ok(bundleResult.ok);

    // Verify all three files exist
    const bundleDir = join(root, bundleDirFor(assignResult.state));
    const assignment = readJson(root, join(bundleDirFor(assignResult.state), 'ASSIGNMENT.json'));
    const prompt = readFileSync(join(bundleDir, 'PROMPT.md'), 'utf8');
    const context = readFileSync(join(bundleDir, 'CONTEXT.md'), 'utf8');

    assert.equal(assignment.role, 'pm');
    assert.equal(assignment.phase, 'planning');
    assert.ok(prompt.length > 100);
    assert.ok(context.length > 50);
  });

  it('paused migration-review → init → assign → dispatch works', () => {
    // Simulate post-migration state
    const state = readJson(root, STATE_PATH);
    state.status = 'paused';
    state.blocked_on = 'human:migration-review';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state, null, 2));

    // Initialize the run (initializeGovernedRun accepts paused)
    const initResult = initializeGovernedRun(root, config);
    assert.ok(initResult.ok);
    assert.equal(initResult.state.status, 'active');
    assert.equal(initResult.state.blocked_on, null);

    const assignResult = assignGovernedTurn(root, config, 'pm');
    assert.ok(assignResult.ok);

    const bundleResult = writeDispatchBundle(root, assignResult.state, config);
    assert.ok(bundleResult.ok);
  });

  it('CONTEXT.md includes last turn info after a completed turn', () => {
    // Init + assign + accept a PM turn
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const state = readJson(root, STATE_PATH);

    // Write a staged turn result
    const turnResult = {
      schema_version: '1.0',
      run_id: state.run_id,
      turn_id: state.current_turn.turn_id,
      role: 'pm',
      runtime_id: 'manual-pm',
      status: 'completed',
      summary: 'Defined MVP scope.',
      decisions: [{ id: 'DEC-001', category: 'scope', statement: 'Focus on core workflow.', rationale: 'User value.' }],
      objections: [{ id: 'OBJ-001', severity: 'low', statement: 'No concerns.', status: 'raised' }],
      files_changed: [],
      artifacts_created: [],
      verification: { status: 'pass', commands: [], evidence_summary: 'Review complete.' },
      artifact: { type: 'review', ref: null },
      proposed_next_role: 'human',
      phase_transition_request: null,
      needs_human_reason: null,
      cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
    };
    mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
    writeFileSync(join(root, STAGING_PATH), JSON.stringify(turnResult));

    // Accept the turn
    const acceptResult = acceptGovernedTurn(root, config);
    assert.ok(acceptResult.ok);

    // Now assign a dev turn in implementation phase
    const newState = readJson(root, STATE_PATH);
    newState.phase = 'implementation';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(newState, null, 2));

    assignGovernedTurn(root, config, 'dev');
    const devState = readJson(root, STATE_PATH);
    writeDispatchBundle(root, devState, config);

    const context = readFileSync(join(root, bundleDirFor(devState), 'CONTEXT.md'), 'utf8');
    assert.match(context, /Last Accepted Turn/);
    assert.match(context, /Defined MVP scope/);
    assert.match(context, /DEC-001/);
  });

  it('returns a warning when history.jsonl cannot be parsed for context rendering', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const state = readJson(root, STATE_PATH);

    state.last_completed_turn_id = 'turn-bad-history';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state, null, 2));
    writeFileSync(join(root, HISTORY_PATH), '{not json}\n');

    const result = writeDispatchBundle(root, state, config);
    assert.equal(result.ok, true);
    assert.ok(result.warnings?.some((warning) => warning.includes('.agentxchain/history.jsonl')));

    const context = readFileSync(join(root, bundleDirFor(state), 'CONTEXT.md'), 'utf8');
    assert.match(context, /Current State/);
    assert.ok(!context.includes('## Last Accepted Turn'));
  });

  it('dispatch bundle for re-dispatched failed turn preserves attempt count', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const state = readJson(root, STATE_PATH);

    // Simulate failed turn (retries exhausted)
    state.status = 'paused';
    state.current_turn.status = 'failed';
    state.current_turn.attempt = 3;
    state.current_turn.last_rejection = {
      reason: 'Artifact error',
      failed_stage: 'artifact',
      validation_errors: ['Reserved path modified'],
    };
    state.blocked_on = 'escalation:retries-exhausted:pm';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state, null, 2));

    // Reactivate and re-dispatch
    state.status = 'active';
    state.blocked_on = null;
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state, null, 2));

    const bundleResult = writeDispatchBundle(root, state, config);
    assert.ok(bundleResult.ok);

    const assignment = readJson(root, join(bundleDirFor(state), 'ASSIGNMENT.json'));
    assert.equal(assignment.attempt, 3);

    const prompt = readFileSync(join(root, bundleDirFor(state), 'PROMPT.md'), 'utf8');
    assert.match(prompt, /Previous Attempt Failed/);
    assert.match(prompt, /attempt 3/);
    assert.match(prompt, /Reserved path modified/);
  });
});

describe('dispatch bundle: prompt file loading', () => {
  let root;
  let config;

  beforeEach(() => {
    root = makeTmpDir();
    config = makeNormalizedConfig();
    scaffoldGoverned(root, 'test-project');
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  it('PROMPT.md injects custom prompt file contents when file exists', () => {
    // The scaffolded pm.md should exist from init
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const state = readJson(root, STATE_PATH);

    // Write a custom prompt file
    writeFileSync(
      join(root, '.agentxchain/prompts/pm.md'),
      '# Custom PM Instructions\n\nAlways prioritize user retention metrics.\n'
    );

    writeDispatchBundle(root, state, config);
    const prompt = readFileSync(join(root, bundleDirFor(state), 'PROMPT.md'), 'utf8');

    assert.match(prompt, /Role-Specific Instructions/);
    assert.match(prompt, /Always prioritize user retention metrics/);
  });

  it('PROMPT.md works gracefully when custom prompt file is missing', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const state = readJson(root, STATE_PATH);

    // Delete the prompt file
    try { rmSync(join(root, '.agentxchain/prompts/pm.md'), { force: true }); } catch {}

    writeDispatchBundle(root, state, config);
    const prompt = readFileSync(join(root, bundleDirFor(state), 'PROMPT.md'), 'utf8');

    // Should not include "Role-Specific Instructions" section if file missing
    assert.ok(!prompt.includes('Role-Specific Instructions'));
    // But should still have the rest of the prompt
    assert.match(prompt, /Protocol Rules/);
    assert.match(prompt, /Required Output/);
  });

  it('returns a warning when the configured prompt path exists but cannot be read', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const state = readJson(root, STATE_PATH);

    rmSync(join(root, '.agentxchain/prompts/pm.md'), { force: true });
    mkdirSync(join(root, '.agentxchain/prompts/pm.md'));

    const result = writeDispatchBundle(root, state, config);
    assert.equal(result.ok, true);
    assert.ok(result.warnings?.some((warning) => warning.includes('.agentxchain/prompts/pm.md')));

    const prompt = readFileSync(join(root, bundleDirFor(state), 'PROMPT.md'), 'utf8');
    assert.ok(!prompt.includes('Role-Specific Instructions'));
    assert.match(prompt, /Required Output/);
  });

  it('PROMPT.md works when no prompts configured for role', () => {
    // Remove prompts config
    const configNoPrompts = { ...config, prompts: {} };
    initializeGovernedRun(root, configNoPrompts);
    assignGovernedTurn(root, configNoPrompts, 'pm');
    const state = readJson(root, STATE_PATH);

    writeDispatchBundle(root, state, configNoPrompts);
    const prompt = readFileSync(join(root, bundleDirFor(state), 'PROMPT.md'), 'utf8');

    assert.ok(!prompt.includes('Role-Specific Instructions'));
    assert.match(prompt, /Required Output/);
  });
});

describe('dispatch bundle: turn result template', () => {
  let root;
  let config;

  beforeEach(() => {
    root = makeTmpDir();
    config = makeNormalizedConfig();
    scaffoldGoverned(root, 'test-project');
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  it('PROMPT.md includes JSON turn result template for review_only role', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const state = readJson(root, STATE_PATH);

    writeDispatchBundle(root, state, config);
    const prompt = readFileSync(join(root, bundleDirFor(state), 'PROMPT.md'), 'utf8');

    // Should contain the actual JSON template
    assert.match(prompt, /"schema_version": "1\.0"/);
    assert.match(prompt, /"run_id"/);
    assert.match(prompt, /"turn_id"/);
    assert.match(prompt, /"status": "completed"/);
    assert.match(prompt, /"objections"/);
    // Review_only template should have review artifact type
    assert.match(prompt, /"type": "review"/);
    // Should include field rules
    assert.match(prompt, /Field Rules/);
    assert.match(prompt, /must be non-empty.*challenge requirement/);
  });

  it('PROMPT.md includes JSON turn result template for authoritative role', () => {
    initializeGovernedRun(root, config);
    const state = readJson(root, STATE_PATH);
    state.phase = 'implementation';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state, null, 2));

    assignGovernedTurn(root, config, 'dev');
    const devState = readJson(root, STATE_PATH);

    writeDispatchBundle(root, devState, config);
    const prompt = readFileSync(join(root, bundleDirFor(devState), 'PROMPT.md'), 'utf8');

    // Authoritative template should have workspace artifact type
    assert.match(prompt, /"type": "workspace"/);
    // Should have verification pass status
    assert.match(prompt, /"status": "pass"/);
    // Should NOT have "must be non-empty" for objections (authoritative can have empty)
    assert.ok(!prompt.includes('must be non-empty'));
  });

  it('turn result template has correct run_id and turn_id', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const state = readJson(root, STATE_PATH);

    writeDispatchBundle(root, state, config);
    const prompt = readFileSync(join(root, bundleDirFor(state), 'PROMPT.md'), 'utf8');

    // Extract the JSON block from the prompt
    const jsonMatch = prompt.match(/```json\n([\s\S]*?)```/);
    assert.ok(jsonMatch, 'Should contain a JSON code block');

    const template = JSON.parse(jsonMatch[1]);
    assert.equal(template.run_id, state.run_id);
    assert.equal(template.turn_id, state.current_turn.turn_id);
    assert.equal(template.role, 'pm');
    assert.equal(template.runtime_id, 'manual-pm');
  });

  it('PROMPT.md includes phase_transition_request and run_completion_request rules', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const state = readJson(root, STATE_PATH);

    writeDispatchBundle(root, state, config);
    const prompt = readFileSync(join(root, bundleDirFor(state), 'PROMPT.md'), 'utf8');

    assert.match(prompt, /phase_transition_request/);
    assert.match(prompt, /run_completion_request/);
    assert.match(prompt, /mutually exclusive/);
  });
});

describe('dispatch bundle: QA evidence visibility', () => {
  let root;
  let config;

  beforeEach(() => {
    root = makeTmpDir();
    config = makeNormalizedConfig();
    scaffoldGoverned(root, 'test-project');
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  function acceptPmTurnAndTransition() {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const pmState = readJson(root, STATE_PATH);
    const pmResult = {
      schema_version: '1.0',
      run_id: pmState.run_id,
      turn_id: pmState.current_turn.turn_id,
      role: 'pm',
      runtime_id: 'manual-pm',
      status: 'completed',
      summary: 'Approved scope.',
      decisions: [{ id: 'DEC-001', category: 'scope', statement: 'Build it.', rationale: 'User value.' }],
      objections: [{ id: 'OBJ-001', severity: 'low', statement: 'No concerns.', status: 'raised' }],
      files_changed: [],
      artifacts_created: [],
      verification: { status: 'pass', commands: [], evidence_summary: 'Review complete.' },
      artifact: { type: 'review', ref: null },
      proposed_next_role: 'human',
      phase_transition_request: null,
      cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
    };
    mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
    writeFileSync(join(root, STAGING_PATH), JSON.stringify(pmResult));
    const pmAccept = acceptGovernedTurn(root, config);
    assert.ok(pmAccept.ok, `PM accept failed: ${pmAccept.error}`);

    // Transition to implementation
    const state = readJson(root, STATE_PATH);
    state.phase = 'implementation';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state, null, 2));
  }

  function acceptDevTurn(overrides = {}) {
    assignGovernedTurn(root, config, 'dev');
    const devState = readJson(root, STATE_PATH);
    const devResult = {
      schema_version: '1.0',
      run_id: devState.run_id,
      turn_id: devState.current_turn.turn_id,
      role: 'dev',
      runtime_id: 'local-dev',
      status: 'completed',
      summary: 'Implemented todo API with tests.',
      decisions: [{ id: 'DEC-002', category: 'implementation', statement: 'Used Express.', rationale: 'Simple.' }],
      objections: [],
      files_changed: ['src/api.js', 'src/api.test.js', 'package.json'],
      artifacts_created: [],
      verification: {
        status: 'pass',
        commands: ['npm test', 'npm run build'],
        evidence_summary: 'All 27 tests pass. Build output clean.',
        machine_evidence: [
          { command: 'npm test', exit_code: 0 },
          { command: 'npm run build', exit_code: 0 },
        ],
      },
      artifact: { type: 'workspace', ref: 'abc123' },
      proposed_next_role: 'qa',
      phase_transition_request: null,
      cost: { input_tokens: 5000, output_tokens: 3000, usd: 0.02 },
      ...overrides,
    };
    mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
    writeFileSync(join(root, STAGING_PATH), JSON.stringify(devResult));
    const devAccept = acceptGovernedTurn(root, config);
    assert.ok(devAccept.ok, `Dev accept failed: ${devAccept.error}`);
  }

  it('AT-QEV-001: CONTEXT.md includes verification evidence for QA turn', () => {
    acceptPmTurnAndTransition();
    acceptDevTurn();

    // Assign QA turn
    const state = readJson(root, STATE_PATH);
    state.phase = 'qa';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state, null, 2));
    assignGovernedTurn(root, config, 'qa');
    const qaState = readJson(root, STATE_PATH);
    writeDispatchBundle(root, qaState, config);

    const context = readFileSync(join(root, bundleDirFor(qaState), 'CONTEXT.md'), 'utf8');

    // Verification section must exist with status, commands, evidence, and machine evidence
    assert.match(context, /### Verification/);
    assert.match(context, /Status:.*pass/);
    assert.match(context, /`npm test`/);
    assert.match(context, /`npm run build`/);
    assert.match(context, /All 27 tests pass/);
    assert.match(context, /Machine evidence/);
    assert.match(context, /\| `npm test` \| 0 \|/);
    assert.match(context, /\| `npm run build` \| 0 \|/);
  });

  it('AT-QEV-002: CONTEXT.md includes files changed list for QA turn', () => {
    acceptPmTurnAndTransition();
    acceptDevTurn();

    const state = readJson(root, STATE_PATH);
    state.phase = 'qa';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state, null, 2));
    assignGovernedTurn(root, config, 'qa');
    const qaState = readJson(root, STATE_PATH);
    writeDispatchBundle(root, qaState, config);

    const context = readFileSync(join(root, bundleDirFor(qaState), 'CONTEXT.md'), 'utf8');

    assert.match(context, /### Files Changed/);
    assert.match(context, /`src\/api\.js`/);
    assert.match(context, /`src\/api\.test\.js`/);
    assert.match(context, /`package\.json`/);
  });

  it('AT-QEV-003: verification section shows only status when no commands or evidence', () => {
    acceptPmTurnAndTransition();
    acceptDevTurn({ verification: { status: 'skipped' } });

    const state = readJson(root, STATE_PATH);
    state.phase = 'qa';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state, null, 2));
    assignGovernedTurn(root, config, 'qa');
    const qaState = readJson(root, STATE_PATH);
    writeDispatchBundle(root, qaState, config);

    const context = readFileSync(join(root, bundleDirFor(qaState), 'CONTEXT.md'), 'utf8');

    assert.match(context, /### Verification/);
    assert.match(context, /Status:.*skipped/);
    assert.ok(!context.includes('Machine evidence'));
    assert.ok(!context.includes('Commands:'));
  });

  it('AT-QEV-004: no files changed section when files_changed is empty', () => {
    acceptPmTurnAndTransition();
    acceptDevTurn({ files_changed: [] });

    const state = readJson(root, STATE_PATH);
    state.phase = 'qa';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state, null, 2));
    assignGovernedTurn(root, config, 'qa');
    const qaState = readJson(root, STATE_PATH);
    writeDispatchBundle(root, qaState, config);

    const context = readFileSync(join(root, bundleDirFor(qaState), 'CONTEXT.md'), 'utf8');

    assert.ok(!context.includes('### Files Changed'));
  });

  it('AT-QEV-005: existing context sections unchanged after evidence addition', () => {
    acceptPmTurnAndTransition();
    acceptDevTurn();

    const state = readJson(root, STATE_PATH);
    state.phase = 'qa';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state, null, 2));
    assignGovernedTurn(root, config, 'qa');
    const qaState = readJson(root, STATE_PATH);
    writeDispatchBundle(root, qaState, config);

    const context = readFileSync(join(root, bundleDirFor(qaState), 'CONTEXT.md'), 'utf8');

    // Existing sections must still be present
    assert.match(context, /## Current State/);
    assert.match(context, /## Last Accepted Turn/);
    assert.match(context, /Implemented todo API with tests/);
    assert.match(context, /DEC-002/);
  });

  it('AT-QCV-001: review_only QA turn sees changed file previews from the last accepted turn', () => {
    acceptPmTurnAndTransition();
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'api.js'), 'function done() {\n  process.exitCode = 1;\n  return;\n}\n');
    writeFileSync(join(root, 'src', 'api.test.js'), "const { execFileSync } = require('child_process');\nexecFileSync('node', ['api.js']);\n");
    writeFileSync(join(root, 'package.json'), '{\n  "scripts": {\n    "test": "node src/api.test.js"\n  }\n}\n');
    acceptDevTurn();

    const state = readJson(root, STATE_PATH);
    state.phase = 'qa';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state, null, 2));
    assignGovernedTurn(root, config, 'qa');
    const qaState = readJson(root, STATE_PATH);
    writeDispatchBundle(root, qaState, config);

    const context = readFileSync(join(root, bundleDirFor(qaState), 'CONTEXT.md'), 'utf8');

    assert.match(context, /### Changed File Previews/);
    assert.match(context, /#### `src\/api\.js`/);
    assert.match(context, /process\.exitCode = 1/);
    assert.match(context, /return;/);
    assert.match(context, /#### `src\/api\.test\.js`/);
    assert.match(context, /execFileSync/);
  });

  it('AT-QCV-002: authoritative target turns do not receive changed file previews', () => {
    acceptPmTurnAndTransition();
    assignGovernedTurn(root, config, 'dev');
    const state = readJson(root, STATE_PATH);

    writeDispatchBundle(root, state, config);
    const context = readFileSync(join(root, bundleDirFor(state), 'CONTEXT.md'), 'utf8');

    assert.ok(!context.includes('### Changed File Previews'));
  });

  it('AT-QCV-003: long changed files are truncated in preview output', () => {
    acceptPmTurnAndTransition();
    mkdirSync(join(root, 'src'), { recursive: true });
    const longFile = Array.from({ length: 100 }, (_, idx) => `line ${idx + 1}`).join('\n') + '\n';
    writeFileSync(join(root, 'src', 'long.js'), longFile);
    acceptDevTurn({ files_changed: ['src/long.js'] });

    const state = readJson(root, STATE_PATH);
    state.phase = 'qa';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state, null, 2));
    assignGovernedTurn(root, config, 'qa');
    const qaState = readJson(root, STATE_PATH);
    writeDispatchBundle(root, qaState, config);

    const context = readFileSync(join(root, bundleDirFor(qaState), 'CONTEXT.md'), 'utf8');

    assert.match(context, /line 80/);
    assert.ok(!context.includes('line 81'));
    assert.match(context, /Preview truncated after 80 lines/);
  });

  it('AT-QCV-004: missing changed files are skipped without empty preview headings', () => {
    acceptPmTurnAndTransition();
    acceptDevTurn({ files_changed: ['src/missing.js'] });

    const state = readJson(root, STATE_PATH);
    state.phase = 'qa';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state, null, 2));
    assignGovernedTurn(root, config, 'qa');
    const qaState = readJson(root, STATE_PATH);
    writeDispatchBundle(root, qaState, config);

    const context = readFileSync(join(root, bundleDirFor(qaState), 'CONTEXT.md'), 'utf8');

    assert.ok(!context.includes('### Changed File Previews'));
    assert.ok(!context.includes('#### `src/missing.js`'));
  });

  // ── Dispatch log excerpt tests (AT-MED-*) ──

  function writeDevDispatchLog(content) {
    // Read the last completed turn ID from state to find the dispatch dir
    const state = readJson(root, STATE_PATH);
    const turnId = state.last_completed_turn_id;
    const logDir = join(root, getDispatchTurnDir(turnId));
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, 'stdout.log'), content);
  }

  it('AT-MED-001: review_only QA turn sees dispatch log excerpt from the last accepted turn', () => {
    acceptPmTurnAndTransition();
    acceptDevTurn();

    const logContent = [
      '> npm test',
      '',
      '  PASS  src/api.test.js',
      '    ✓ GET /todos returns empty list (3ms)',
      '    ✓ POST /todos creates a todo (5ms)',
      '    ✓ DELETE /todos/:id removes a todo (2ms)',
      '',
      'Tests: 3 passed, 3 total',
      'Time:  0.245s',
    ].join('\n');
    writeDevDispatchLog(logContent);

    const state = readJson(root, STATE_PATH);
    state.phase = 'qa';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state, null, 2));
    assignGovernedTurn(root, config, 'qa');
    const qaState = readJson(root, STATE_PATH);
    writeDispatchBundle(root, qaState, config);

    const context = readFileSync(join(root, bundleDirFor(qaState), 'CONTEXT.md'), 'utf8');

    assert.match(context, /### Dispatch Log Excerpt/);
    assert.match(context, /PASS.*src\/api\.test\.js/);
    assert.match(context, /Tests: 3 passed, 3 total/);
    assert.ok(!context.includes('Log truncated'));
  });

  it('AT-MED-002: authoritative dev turns do NOT see dispatch log excerpt', () => {
    acceptPmTurnAndTransition();

    // Write a fake dispatch log for the PM turn
    const state = readJson(root, STATE_PATH);
    const pmTurnId = state.last_completed_turn_id;
    const logDir = join(root, getDispatchTurnDir(pmTurnId));
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, 'stdout.log'), 'PM turn log output\n');

    assignGovernedTurn(root, config, 'dev');
    const devState = readJson(root, STATE_PATH);
    writeDispatchBundle(root, devState, config);

    const context = readFileSync(join(root, bundleDirFor(devState), 'CONTEXT.md'), 'utf8');

    assert.ok(!context.includes('### Dispatch Log Excerpt'));
    assert.ok(!context.includes('PM turn log output'));
  });

  it('AT-MED-003: long dispatch logs are truncated to last 50 lines with indicator', () => {
    acceptPmTurnAndTransition();
    acceptDevTurn();

    // Generate a 120-line log
    const logLines = [];
    for (let i = 1; i <= 120; i++) {
      logLines.push(`Line ${i}: test output`);
    }
    writeDevDispatchLog(logLines.join('\n'));

    const state = readJson(root, STATE_PATH);
    state.phase = 'qa';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state, null, 2));
    assignGovernedTurn(root, config, 'qa');
    const qaState = readJson(root, STATE_PATH);
    writeDispatchBundle(root, qaState, config);

    const context = readFileSync(join(root, bundleDirFor(qaState), 'CONTEXT.md'), 'utf8');

    assert.match(context, /### Dispatch Log Excerpt/);
    assert.match(context, /Log truncated — showing last 50 lines of 120 total/);
    // Should contain the last 50 lines (71-120), not the first
    assert.match(context, /Line 120: test output/);
    assert.match(context, /Line 71: test output/);
    assert.ok(!context.includes('Line 70: test output'));
  });

  it('AT-MED-004: missing or empty dispatch log is skipped cleanly', () => {
    acceptPmTurnAndTransition();
    acceptDevTurn();
    // Do NOT write a dispatch log

    const state = readJson(root, STATE_PATH);
    state.phase = 'qa';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state, null, 2));
    assignGovernedTurn(root, config, 'qa');
    const qaState = readJson(root, STATE_PATH);
    writeDispatchBundle(root, qaState, config);

    const context = readFileSync(join(root, bundleDirFor(qaState), 'CONTEXT.md'), 'utf8');

    assert.ok(!context.includes('### Dispatch Log Excerpt'));
  });

  it('AT-MED-005: extremely long lines are per-line truncated', () => {
    acceptPmTurnAndTransition();
    acceptDevTurn();

    const longLine = 'X'.repeat(10000);
    writeDevDispatchLog(`short line\n${longLine}\nfinal line`);

    const state = readJson(root, STATE_PATH);
    state.phase = 'qa';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state, null, 2));
    assignGovernedTurn(root, config, 'qa');
    const qaState = readJson(root, STATE_PATH);
    writeDispatchBundle(root, qaState, config);

    const context = readFileSync(join(root, bundleDirFor(qaState), 'CONTEXT.md'), 'utf8');

    assert.match(context, /### Dispatch Log Excerpt/);
    assert.match(context, /short line/);
    assert.match(context, /final line/);
    // The long line should be truncated (8192 chars + ellipsis)
    assert.ok(!context.includes('X'.repeat(10000)));
    assert.match(context, /X{100}.*…/);
  });
});
