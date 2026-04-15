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
    assert.match(prompt, /Expected-failure checks must be wrapped/);
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

  it('pre-run migration-review bootstrap → init → assign → dispatch works', () => {
    // Simulate a migrated bootstrap state that normalizes to blocked-without-run
    const state = readJson(root, STATE_PATH);
    state.status = 'paused';
    state.blocked_on = 'human:migration-review';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state, null, 2));

    // initializeGovernedRun still accepts this bootstrap path after state normalization
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

  it('PROMPT.md includes patch template and proposed_changes for proposed role', () => {
    const proposedConfig = {
      ...config,
      roles: {
        ...config.roles,
        dev: {
          ...config.roles.dev,
          write_authority: 'proposed',
          runtime_class: 'api_proxy',
          runtime_id: 'api-dev',
        },
      },
      runtimes: {
        ...config.runtimes,
        'api-dev': { type: 'api_proxy' },
      },
    };

    initializeGovernedRun(root, proposedConfig);
    const state = readJson(root, STATE_PATH);
    state.phase = 'implementation';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state, null, 2));

    assignGovernedTurn(root, proposedConfig, 'dev');
    const proposedState = readJson(root, STATE_PATH);

    writeDispatchBundle(root, proposedState, proposedConfig);
    const prompt = readFileSync(join(root, bundleDirFor(proposedState), 'PROMPT.md'), 'utf8');

    assert.match(prompt, /"type": "patch"/);
    assert.match(prompt, /"proposed_changes": \[/);
    assert.match(prompt, /Do NOT use `artifact\.type: "workspace"` or `artifact\.type: "commit"`/);
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

  it('PROMPT.md tells api_proxy review turns not to claim planning-file writes', () => {
    initializeGovernedRun(root, config);
    const state = readJson(root, STATE_PATH);
    state.phase = 'qa';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state, null, 2));

    assignGovernedTurn(root, config, 'qa');
    const qaState = readJson(root, STATE_PATH);
    writeDispatchBundle(root, qaState, config);
    const prompt = readFileSync(join(root, bundleDirFor(qaState), 'PROMPT.md'), 'utf8');

    assert.match(prompt, /cannot write repo files directly/i);
    assert.match(prompt, /\.agentxchain\/reviews\/turn_[a-z0-9]+-qa-review\.md/);
    assert.match(prompt, /Do NOT claim `?\.planning/i);
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

  it('AT-RFPC-001: modest changed files are shown in full for review-only QA turns', () => {
    acceptPmTurnAndTransition();
    mkdirSync(join(root, 'src'), { recursive: true });
    const eightyOneLineFile = Array.from({ length: 81 }, (_, idx) => `line ${idx + 1}`).join('\n') + '\n';
    writeFileSync(join(root, 'src', 'eighty-one.js'), eightyOneLineFile);
    acceptDevTurn({ files_changed: ['src/eighty-one.js'] });

    const state = readJson(root, STATE_PATH);
    state.phase = 'qa';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state, null, 2));
    assignGovernedTurn(root, config, 'qa');
    const qaState = readJson(root, STATE_PATH);
    writeDispatchBundle(root, qaState, config);

    const context = readFileSync(join(root, bundleDirFor(qaState), 'CONTEXT.md'), 'utf8');

    assert.match(context, /line 81/);
    assert.ok(!context.includes('Preview truncated'));
  });

  it('AT-RFPC-002: long changed files are truncated in preview output', () => {
    acceptPmTurnAndTransition();
    mkdirSync(join(root, 'src'), { recursive: true });
    const longFile = Array.from({ length: 140 }, (_, idx) => `line ${idx + 1}`).join('\n') + '\n';
    writeFileSync(join(root, 'src', 'long.js'), longFile);
    acceptDevTurn({ files_changed: ['src/long.js'] });

    const state = readJson(root, STATE_PATH);
    state.phase = 'qa';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state, null, 2));
    assignGovernedTurn(root, config, 'qa');
    const qaState = readJson(root, STATE_PATH);
    writeDispatchBundle(root, qaState, config);

    const context = readFileSync(join(root, bundleDirFor(qaState), 'CONTEXT.md'), 'utf8');

    assert.match(context, /line 120/);
    assert.ok(!context.includes('line 121'));
    assert.match(context, /Preview truncated after 120 lines/);
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

  it('AT-PROPCTX-001: review_only turns see accepted proposed artifacts in context', () => {
    acceptPmTurnAndTransition();

    config.roles.dev.write_authority = 'proposed';
    config.roles.dev.runtime_class = 'api_proxy';
    config.roles.dev.runtime_id = 'api-dev';
    config.runtimes['api-dev'] = { type: 'api_proxy' };
    config.gates.implementation_complete = { requires_verification_pass: true };

    assignGovernedTurn(root, config, 'dev');
    const devState = readJson(root, STATE_PATH);
    const devResult = {
      schema_version: '1.0',
      run_id: devState.run_id,
      turn_id: devState.current_turn.turn_id,
      role: 'dev',
      runtime_id: 'api-dev',
      status: 'completed',
      summary: 'Proposed the API-backed implementation slice for review.',
      decisions: [{ id: 'DEC-003', category: 'implementation', statement: 'Stage the implementation as a proposal.', rationale: 'Remote runtime cannot write directly.' }],
      objections: [],
      files_changed: ['src/proposed-feature.js'],
      artifacts_created: [],
      verification: {
        status: 'pass',
        commands: ['echo ok'],
        evidence_summary: 'Proposal validated.',
        machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
      },
      artifact: { type: 'patch', ref: null },
      proposed_next_role: 'qa',
      phase_transition_request: 'qa',
      proposed_changes: [
        { path: 'src/proposed-feature.js', action: 'create', content: 'export const proposalReady = true;\n' },
      ],
      cost: { input_tokens: 10, output_tokens: 20, usd: 0.01 },
    };
    mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
    writeFileSync(join(root, STAGING_PATH), JSON.stringify(devResult));
    const devAccept = acceptGovernedTurn(root, config);
    assert.ok(devAccept.ok, `Dev accept failed: ${devAccept.error}`);

    assignGovernedTurn(root, config, 'qa');
    const qaState = readJson(root, STATE_PATH);
    writeDispatchBundle(root, qaState, config);

    const context = readFileSync(join(root, bundleDirFor(qaState), 'CONTEXT.md'), 'utf8');

    assert.match(context, /### Proposed Artifact/);
    assert.match(context, /\.agentxchain\/proposed\/turn_/);
    assert.match(context, /### Proposed File Previews/);
    assert.match(context, /#### `src\/proposed-feature\.js` \(create\)/);
    assert.match(context, /export const proposalReady = true/);
    assert.ok(!context.includes('### Changed File Previews'));
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

  // ─── AT-NORM-007: Prompt phase-name guidance ──────────────────────────

  it('AT-NORM-007: QA review_only prompt in terminal phase lists valid phase names and run_completion guidance', () => {
    // Setup: standalone root with QA phase
    const qaRoot = makeTmpDir();
    const qaConfig = makeNormalizedConfig();
    scaffoldGoverned(qaRoot, 'test-project');
    initializeGovernedRun(qaRoot, qaConfig);
    assignGovernedTurn(qaRoot, qaConfig, 'pm');

    // Accept PM turn
    const pmState = readJson(qaRoot, STATE_PATH);
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
      verification: { status: 'pass', commands: [], evidence_summary: 'Review.' },
      artifact: { type: 'review', ref: null },
      proposed_next_role: 'human',
      phase_transition_request: null,
      cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
    };
    mkdirSync(join(qaRoot, '.agentxchain', 'staging'), { recursive: true });
    writeFileSync(join(qaRoot, STAGING_PATH), JSON.stringify(pmResult));
    acceptGovernedTurn(qaRoot, qaConfig);

    // Force to QA phase and assign QA turn
    const rawSt = JSON.parse(readFileSync(join(qaRoot, STATE_PATH), 'utf8'));
    rawSt.phase = 'qa';
    writeFileSync(join(qaRoot, STATE_PATH), JSON.stringify(rawSt, null, 2));
    assignGovernedTurn(qaRoot, qaConfig, 'qa');
    const qaState = readJson(qaRoot, STATE_PATH);

    writeDispatchBundle(qaRoot, qaState, qaConfig);

    const promptPath = join(qaRoot, bundleDirFor(qaState), 'PROMPT.md');
    const prompt = readFileSync(promptPath, 'utf8');

    // Must list valid phase names
    assert.match(prompt, /Valid phases:.*planning.*implementation.*qa/i);
    // Must warn about gate names
    assert.match(prompt, /Do NOT use exit gate names/i);
    // Must include run_completion guidance for terminal phase
    assert.match(prompt, /run_completion_request.*true/i);

    rmSync(qaRoot, { recursive: true, force: true });
  });
});

// ─── Phase-Transition Intent Tests ──────────────────────────────────────────

describe('dispatch bundle: phase-transition intent prompt', () => {
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

  it('AT-PTI-001: authoritative role in non-terminal phase sees explicit next-phase instruction', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');

    // Accept PM turn to advance
    const pmState = readJson(root, STATE_PATH);
    const pmResult = {
      schema_version: '1.0',
      run_id: pmState.run_id,
      turn_id: pmState.current_turn.turn_id,
      role: 'pm',
      runtime_id: 'manual-pm',
      status: 'completed',
      summary: 'Approved.',
      decisions: [{ id: 'DEC-001', category: 'scope', statement: 'Go.', rationale: 'Yes.' }],
      objections: [{ id: 'OBJ-001', severity: 'low', statement: 'None.', status: 'raised' }],
      files_changed: [],
      artifacts_created: [],
      verification: { status: 'pass', commands: [], evidence_summary: 'Review.' },
      artifact: { type: 'review', ref: null },
      proposed_next_role: 'human',
      phase_transition_request: null,
      cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
    };
    mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
    writeFileSync(join(root, STAGING_PATH), JSON.stringify(pmResult));
    acceptGovernedTurn(root, config);

    // Force to implementation phase and assign dev turn
    const rawSt = JSON.parse(readFileSync(join(root, STATE_PATH), 'utf8'));
    rawSt.phase = 'implementation';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(rawSt, null, 2));
    assignGovernedTurn(root, config, 'dev');
    const devState = readJson(root, STATE_PATH);

    writeDispatchBundle(root, devState, config);

    const promptPath = join(root, bundleDirFor(devState), 'PROMPT.md');
    const prompt = readFileSync(promptPath, 'utf8');

    // Must see explicit current-phase identification
    assert.match(prompt, /You are in the `implementation` phase/);
    // Must see explicit next-phase instruction
    assert.match(prompt, /phase_transition_request: "qa"/);
    // Must reference the exit gate
    assert.match(prompt, /implementation_complete/);
  });

  it('AT-PTI-002: authoritative role in terminal phase sees final-phase and run_completion guidance', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');

    // Accept PM turn
    const pmState = readJson(root, STATE_PATH);
    const pmResult = {
      schema_version: '1.0',
      run_id: pmState.run_id,
      turn_id: pmState.current_turn.turn_id,
      role: 'pm',
      runtime_id: 'manual-pm',
      status: 'completed',
      summary: 'Approved.',
      decisions: [{ id: 'DEC-001', category: 'scope', statement: 'Go.', rationale: 'Yes.' }],
      objections: [{ id: 'OBJ-001', severity: 'low', statement: 'None.', status: 'raised' }],
      files_changed: [],
      artifacts_created: [],
      verification: { status: 'pass', commands: [], evidence_summary: 'Review.' },
      artifact: { type: 'review', ref: null },
      proposed_next_role: 'human',
      phase_transition_request: null,
      cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
    };
    mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
    writeFileSync(join(root, STAGING_PATH), JSON.stringify(pmResult));
    acceptGovernedTurn(root, config);

    // Force to qa phase (terminal) and assign dev turn (hypothetical authoritative role in terminal phase)
    const rawSt = JSON.parse(readFileSync(join(root, STATE_PATH), 'utf8'));
    rawSt.phase = 'qa';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(rawSt, null, 2));
    // Temporarily make dev authoritative in qa phase for this test
    assignGovernedTurn(root, config, 'dev');
    const devState = readJson(root, STATE_PATH);

    writeDispatchBundle(root, devState, config);

    const promptPath = join(root, bundleDirFor(devState), 'PROMPT.md');
    const prompt = readFileSync(promptPath, 'utf8');

    // Must see terminal-phase identification
    assert.match(prompt, /You are in the `qa` phase \(final phase\)/);
    // Must see run_completion guidance
    assert.match(prompt, /run_completion_request: true/);
  });

  it('AT-PTI-003: review_only role does NOT see authoritative phase guidance', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');

    // Accept PM turn
    const pmState = readJson(root, STATE_PATH);
    const pmResult = {
      schema_version: '1.0',
      run_id: pmState.run_id,
      turn_id: pmState.current_turn.turn_id,
      role: 'pm',
      runtime_id: 'manual-pm',
      status: 'completed',
      summary: 'Approved.',
      decisions: [{ id: 'DEC-001', category: 'scope', statement: 'Go.', rationale: 'Yes.' }],
      objections: [{ id: 'OBJ-001', severity: 'low', statement: 'None.', status: 'raised' }],
      files_changed: [],
      artifacts_created: [],
      verification: { status: 'pass', commands: [], evidence_summary: 'Review.' },
      artifact: { type: 'review', ref: null },
      proposed_next_role: 'human',
      phase_transition_request: null,
      cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
    };
    mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
    writeFileSync(join(root, STAGING_PATH), JSON.stringify(pmResult));
    acceptGovernedTurn(root, config);

    // Force to implementation and assign QA (review_only) turn
    const rawSt = JSON.parse(readFileSync(join(root, STATE_PATH), 'utf8'));
    rawSt.phase = 'implementation';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(rawSt, null, 2));
    assignGovernedTurn(root, config, 'qa');
    const qaState = readJson(root, STATE_PATH);

    writeDispatchBundle(root, qaState, config);

    const promptPath = join(root, bundleDirFor(qaState), 'PROMPT.md');
    const prompt = readFileSync(promptPath, 'utf8');

    // review_only must NOT see "You are in the `implementation` phase" authoritative guidance
    assert.doesNotMatch(prompt, /\*\*You are in the `implementation` phase\.\*\*/);
  });

  it('AT-TCS-001: review_only terminal prompt distinguishes ship-ready from blocked', () => {
    const qaPhaseConfig = { ...config, routing: { ...config.routing } };
    initializeGovernedRun(root, config);

    // Advance to qa phase
    const state = readJson(root, STATE_PATH);
    state.phase = 'qa';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state, null, 2));

    assignGovernedTurn(root, qaPhaseConfig, 'qa');
    const qaState = readJson(root, STATE_PATH);

    writeDispatchBundle(root, qaState, qaPhaseConfig);

    const promptPath = join(root, bundleDirFor(qaState), 'PROMPT.md');
    const prompt = readFileSync(promptPath, 'utf8');

    // Must include ship-ready vs blocked distinction
    assert.match(prompt, /ship-ready.*run_completion_request.*true/is);
    assert.match(prompt, /blocking issues.*needs_human/is);
    assert.match(prompt, /Do NOT use.*needs_human.*to mean.*human should approve/is);
  });

  it('AT-PTI-004: no phase-specific instruction when routing config is absent', () => {
    const noRoutingConfig = { ...config, routing: undefined };
    initializeGovernedRun(root, noRoutingConfig);
    assignGovernedTurn(root, noRoutingConfig, 'dev');
    const devState = readJson(root, STATE_PATH);

    writeDispatchBundle(root, devState, noRoutingConfig);

    const promptPath = join(root, bundleDirFor(devState), 'PROMPT.md');
    const prompt = readFileSync(promptPath, 'utf8');

    // Must not contain phase-specific guidance
    assert.doesNotMatch(prompt, /You are in the/);
  });
});

describe('dispatch bundle: review context sufficiency (gate-file content)', () => {
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

  function assignPmTurn() {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    return readJson(root, STATE_PATH);
  }

  function assignQaTurn() {
    initializeGovernedRun(root, config);
    const state = readJson(root, STATE_PATH);
    state.phase = 'qa';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state, null, 2));
    assignGovernedTurn(root, config, 'qa');
    return readJson(root, STATE_PATH);
  }

  function assignDevTurn() {
    initializeGovernedRun(root, config);
    const state = readJson(root, STATE_PATH);
    state.phase = 'implementation';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state, null, 2));
    assignGovernedTurn(root, config, 'dev');
    return readJson(root, STATE_PATH);
  }

  it('AT-RCS-001: CONTEXT.md for review_only role includes gate-file content previews', () => {
    const state = assignPmTurn();
    // PM_SIGNOFF.md is scaffolded by init --governed — write known content
    writeFileSync(join(root, '.planning/PM_SIGNOFF.md'), '# PM Signoff\n\nApproved: YES\n');
    writeFileSync(join(root, '.planning/ROADMAP.md'), '# Roadmap\n\n- [ ] Feature A\n');

    writeDispatchBundle(root, state, config);
    const context = readFileSync(join(root, bundleDirFor(state), 'CONTEXT.md'), 'utf8');

    // Should contain file content, not just existence flag
    assert.match(context, /### `\.planning\/PM_SIGNOFF\.md` — exists/);
    assert.match(context, /# PM Signoff/);
    assert.match(context, /Approved: YES/);
    assert.match(context, /### `\.planning\/ROADMAP\.md` — exists/);
    assert.match(context, /Feature A/);
  });

  it('AT-RCS-002: CONTEXT.md for review_only role shows MISSING without preview', () => {
    const state = assignPmTurn();
    // Remove ROADMAP.md so it is missing
    try { rmSync(join(root, '.planning/ROADMAP.md'), { force: true }); } catch {}

    writeDispatchBundle(root, state, config);
    const context = readFileSync(join(root, bundleDirFor(state), 'CONTEXT.md'), 'utf8');

    assert.match(context, /### `\.planning\/ROADMAP\.md` — MISSING/);
    // No code block after a MISSING entry
    const missingIdx = context.indexOf('### `.planning/ROADMAP.md` — MISSING');
    const nextSection = context.indexOf('##', missingIdx + 1);
    const between = context.slice(missingIdx, nextSection === -1 ? undefined : nextSection);
    assert.ok(!between.includes('```'), 'MISSING gate file should not have a preview block');
  });

  it('AT-RCS-003: semantic annotation Approved: YES when PM_SIGNOFF.md has the marker', () => {
    const state = assignPmTurn();
    writeFileSync(join(root, '.planning/PM_SIGNOFF.md'), '# PM Signoff\n\nApproved: YES\n');

    writeDispatchBundle(root, state, config);
    const context = readFileSync(join(root, bundleDirFor(state), 'CONTEXT.md'), 'utf8');

    assert.match(context, /Gate semantic: Approved: YES/);
  });

  it('AT-RCS-004: semantic annotation "approval not found" when PM_SIGNOFF.md lacks marker', () => {
    const state = assignPmTurn();
    writeFileSync(join(root, '.planning/PM_SIGNOFF.md'), '# PM Signoff\n\nApproved: NO\n');

    writeDispatchBundle(root, state, config);
    const context = readFileSync(join(root, bundleDirFor(state), 'CONTEXT.md'), 'utf8');

    assert.match(context, /Gate semantic: approval not found/);
  });

  it('AT-RCS-005: semantic annotation for ship-verdict.md verdict status', () => {
    const state = assignQaTurn();
    writeFileSync(join(root, '.planning/ship-verdict.md'), '# Ship Verdict\n\n## Verdict: YES\n');

    writeDispatchBundle(root, state, config);
    const context = readFileSync(join(root, bundleDirFor(state), 'CONTEXT.md'), 'utf8');

    assert.match(context, /Gate semantic: Verdict: YES/);
  });

  it('AT-RCS-005b: semantic annotation "verdict not affirmative" for PENDING verdict', () => {
    const state = assignQaTurn();
    writeFileSync(join(root, '.planning/ship-verdict.md'), '# Ship Verdict\n\n## Verdict: PENDING\n');

    writeDispatchBundle(root, state, config);
    const context = readFileSync(join(root, bundleDirFor(state), 'CONTEXT.md'), 'utf8');

    assert.match(context, /Gate semantic: verdict not affirmative/);
  });

  it('AT-RCS-006: non-review_only role shows only existence flags (no previews)', () => {
    const state = assignDevTurn();
    writeFileSync(join(root, '.planning/PM_SIGNOFF.md'), '# PM Signoff\n\nApproved: YES\n');

    writeDispatchBundle(root, state, config);
    const context = readFileSync(join(root, bundleDirFor(state), 'CONTEXT.md'), 'utf8');

    // Implementation phase uses implementation_complete gate which has no requires_files,
    // so test with a config override to prove non-review roles get flat format
    // Instead, verify that the dev context does NOT contain gate-file previews
    assert.ok(!context.includes('Gate semantic:'), 'non-review role should not see gate semantic annotations');
    assert.ok(!context.includes('### `.planning/'), 'non-review role should not see gate file headings');
  });

  it('AT-RCS-007: gate file content preview truncates at 60 lines with indicator', () => {
    const state = assignQaTurn();
    const longContent = Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
    writeFileSync(join(root, '.planning/ship-verdict.md'), longContent);

    writeDispatchBundle(root, state, config);
    const context = readFileSync(join(root, bundleDirFor(state), 'CONTEXT.md'), 'utf8');

    assert.match(context, /Preview truncated after 60 lines/);
    assert.match(context, /line 60/);
    assert.ok(!context.includes('line 61'), 'line 61 should not appear in truncated preview');
  });

  it('AT-RDCTX-001: CONTEXT.md annotates repo-decision authority when configured', () => {
    config.roles.pm.decision_authority = 30;
    config.roles.dev.decision_authority = 20;
    writeFileSync(
      join(root, '.agentxchain', 'repo-decisions.jsonl'),
      `${JSON.stringify({
        id: 'DEC-100',
        status: 'active',
        category: 'architecture',
        statement: 'Use PostgreSQL',
        role: 'pm',
        run_id: 'run_prior',
        durability: 'repo',
      })}\n`,
    );

    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'dev');
    const state = readJson(root, STATE_PATH);

    writeDispatchBundle(root, state, config);
    const context = readFileSync(join(root, bundleDirFor(state), 'CONTEXT.md'), 'utf8');

    assert.match(context, /When both roles declare `decision_authority`/);
    assert.match(context, /\*\*DEC-100\*\* \(architecture, by pm authority 30\): Use PostgreSQL/);
  });
});

// ── AT-DPT-001/002: No TODO placeholders in PROMPT.md ───────────────────────

describe('dispatch bundle: template placeholder hygiene', () => {
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

  it('PROMPT.md contains no literal TODO strings in the turn-result template (AT-DPT-001)', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const state = readJson(root, STATE_PATH);

    writeDispatchBundle(root, state, config);
    const prompt = readFileSync(join(root, bundleDirFor(state), 'PROMPT.md'), 'utf8');

    assert.ok(!prompt.includes('TODO:'), 'PROMPT.md must not contain TODO: placeholders');
    assert.ok(!/\bTODO\b/.test(prompt.replace(/TODO:/g, '')), 'PROMPT.md must not contain bare TODO placeholders');
  });

  it('PROMPT.md template uses angle-bracket placeholder format (AT-DPT-002)', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const state = readJson(root, STATE_PATH);

    writeDispatchBundle(root, state, config);
    const prompt = readFileSync(join(root, bundleDirFor(state), 'PROMPT.md'), 'utf8');

    // Extract the JSON template block from PROMPT.md
    const jsonMatch = prompt.match(/```json\n([\s\S]*?)\n```/);
    assert.ok(jsonMatch, 'PROMPT.md must contain a JSON template block');
    const template = JSON.parse(jsonMatch[1]);

    assert.match(template.summary, /^<[^>]+>$/);
    assert.match(template.proposed_next_role, /^<[^>]+>$/);
    assert.match(template.decisions[0].statement, /^<[^>]+>$/);
    assert.match(template.decisions[0].rationale, /^<[^>]+>$/);
  });

  it('authoritative-role PROMPT.md uses angle-bracket placeholders in verification (AT-DPT-002b)', () => {
    initializeGovernedRun(root, config);
    // Transition to implementation so dev (authoritative) can be assigned
    const state0 = readJson(root, STATE_PATH);
    state0.phase = 'implementation';
    writeFileSync(join(root, '.agentxchain/state.json'), JSON.stringify(state0, null, 2));

    assignGovernedTurn(root, config, 'dev');
    const state = readJson(root, STATE_PATH);

    writeDispatchBundle(root, state, config);
    const prompt = readFileSync(join(root, bundleDirFor(state), 'PROMPT.md'), 'utf8');

    const jsonMatch = prompt.match(/```json\n([\s\S]*?)\n```/);
    assert.ok(jsonMatch);
    const template = JSON.parse(jsonMatch[1]);

    assert.match(template.files_changed[0], /^<[^>]+>$/);
    assert.match(template.verification.commands[0], /^<[^>]+>$/);
    assert.match(template.verification.evidence_summary, /^<[^>]+>$/);
    assert.match(template.verification.machine_evidence[0].command, /^<[^>]+>$/);
  });
});
