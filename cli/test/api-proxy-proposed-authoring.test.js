/**
 * Tests for api_proxy proposed authoring support.
 *
 * Validates:
 *   - Config accepts api_proxy + proposed write authority
 *   - Config rejects api_proxy + authoritative (unchanged)
 *   - Turn result validation for proposed_changes
 *   - Dispatch bundle includes proposed-authoring instructions
 *   - Proposal materialization writes correct files
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import { validateV4Config, loadNormalizedConfig } from '../src/lib/normalized-config.js';
import { validateStagedTurnResult } from '../src/lib/turn-result-validator.js';
import {
  writeDispatchBundle,
  getDispatchTurnDir,
} from '../src/lib/dispatch-bundle.js';
import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  getActiveTurn,
  normalizeGovernedStateShape,
  STATE_PATH,
} from '../src/lib/governed-state.js';
import { scaffoldGoverned } from '../src/commands/init.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-proxy-author-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeRawConfig({ writeAuthority = 'proposed' } = {}) {
  return {
    schema_version: '1.0',
    project: { id: 'proxy-author-test', name: 'proxy-author-test' },
    runtimes: {
      'api-dev': {
        type: 'api_proxy',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        auth_env: 'ANTHROPIC_API_KEY',
      },
      'local-pm': {
        type: 'manual',
      },
    },
    roles: {
      pm: { title: 'PM', mandate: 'Plan', write_authority: 'authoritative', runtime: 'local-pm' },
      dev: { title: 'Dev', mandate: 'Implement', write_authority: writeAuthority, runtime: 'api-dev' },
    },
    phases: {
      implement: { roles: ['pm', 'dev'], exit_gate: 'code_complete', allowed_next_roles: ['pm', 'dev', 'human'] },
    },
    phase_order: ['implement'],
    governance: { challenge_required: false, min_turns_before_completion: 1, human_approval_required: false },
  };
}

/** Normalized config in the shape governed-state.js expects. */
function makeNormalizedConfig({ writeAuthority = 'proposed' } = {}) {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'proxy-author-test', name: 'proxy-author-test', default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'Plan', write_authority: 'authoritative', runtime_class: 'manual', runtime_id: 'local-pm' },
      dev: { title: 'Dev', mandate: 'Implement', write_authority: writeAuthority, runtime_class: 'api_proxy', runtime_id: 'api-dev' },
    },
    runtimes: {
      'local-pm': { type: 'manual' },
      'api-dev': { type: 'api_proxy', provider: 'anthropic', model: 'claude-sonnet-4-6', auth_env: 'ANTHROPIC_API_KEY' },
    },
    routing: {
      implement: { entry_role: 'dev', allowed_next_roles: ['pm', 'dev', 'human'], exit_gate: 'code_complete' },
    },
    gates: {},
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    rules: { challenge_required: false, max_turn_retries: 2, max_deadlock_cycles: 2 },
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
    compat: { next_owner_source: 'state-json', lock_based_coordination: false, original_version: 4 },
  };
}

function writeIdleState(dir) {
  const stateDir = join(dir, '.agentxchain');
  mkdirSync(stateDir, { recursive: true });
  const state = {
    run_id: null,
    status: 'idle',
    phase: 'implement',
    active_turns: {},
    completed_turns: [],
    blocked_on: null,
    blocked_reason: null,
    phase_history: [],
    decision_count: 0,
    objection_count: 0,
    version: 2,
  };
  writeFileSync(join(stateDir, 'state.json'), JSON.stringify(state, null, 2));
  writeFileSync(join(stateDir, 'history.jsonl'), '');
  writeFileSync(join(stateDir, 'decision-ledger.jsonl'), '');
  mkdirSync(join(stateDir, 'staging'), { recursive: true });
  return state;
}

function readState(dir) {
  const parsed = JSON.parse(readFileSync(join(dir, STATE_PATH), 'utf8'));
  const normalized = normalizeGovernedStateShape(parsed).state;
  Object.defineProperty(normalized, 'current_turn', {
    configurable: true,
    enumerable: false,
    get() { return getActiveTurn(normalized); },
  });
  return normalized;
}

/** Set up a tmp dir with initialized run and assigned dev turn. */
function setupRun(writeAuth = 'proposed') {
  const tmp = makeTmpDir();
  const config = makeNormalizedConfig({ writeAuthority: writeAuth });
  writeIdleState(tmp);
  const initResult = initializeGovernedRun(tmp, config);
  assert.equal(initResult.ok, true, `Init failed: ${initResult.error}`);
  const assignResult = assignGovernedTurn(tmp, config, 'dev');
  assert.equal(assignResult.ok, true, `Assign failed: ${assignResult.error}`);
  const state = readState(tmp);
  const turnId = assignResult.turn.turn_id;
  return { tmp, config, runId: state.run_id, turnId, state };
}

function stageTurnResult(tmp, turnId, runId, overrides = {}) {
  const tr = {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turnId,
    role: 'dev',
    runtime_id: 'api-dev',
    status: 'completed',
    summary: 'Implement connection pool',
    decisions: [],
    objections: [],
    files_changed: ['src/pool.js', 'src/config.js'],
    verification: { status: 'pass' },
    artifact: { type: 'patch' },
    proposed_next_role: 'pm',
    proposed_changes: [
      { path: 'src/pool.js', action: 'create', content: '// pool module\nexport function createPool() {}' },
      { path: 'src/config.js', action: 'modify', content: '// updated config\nexport const MAX_POOL = 10;' },
    ],
    ...overrides,
  };
  const stagingDir = join(tmp, '.agentxchain/staging');
  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(join(stagingDir, 'turn-result.json'), JSON.stringify(tr));
  return tr;
}

// ── Config Validation ────────────────────────────────────────────────────────

describe('api_proxy proposed authoring — config validation', () => {
  it('accepts api_proxy + proposed write authority', () => {
    const result = validateV4Config(makeRawConfig({ writeAuthority: 'proposed' }));
    assert.equal(result.ok, true, `Expected ok but got errors: ${result.errors?.join('; ')}`);
  });

  it('accepts api_proxy + review_only write authority (unchanged)', () => {
    const result = validateV4Config(makeRawConfig({ writeAuthority: 'review_only' }));
    assert.equal(result.ok, true, `Expected ok but got errors: ${result.errors?.join('; ')}`);
  });

  it('rejects api_proxy + authoritative write authority', () => {
    const result = validateV4Config(makeRawConfig({ writeAuthority: 'authoritative' }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('api_proxy only supports review_only and proposed')));
  });
});

// ── Turn Result Validation ───────────────────────────────────────────────────

describe('api_proxy proposed authoring — turn result validation', () => {
  let env;

  beforeEach(() => { env = setupRun('proposed'); });
  afterEach(() => { rmSync(env.tmp, { recursive: true, force: true }); });

  it('valid proposed_changes passes validation', () => {
    stageTurnResult(env.tmp, env.turnId, env.runId);
    const result = validateStagedTurnResult(env.tmp, env.state, env.config);
    assert.equal(result.ok, true, `Expected ok but got: ${result.errors?.join('; ')}`);
  });

  it('missing proposed_changes for completed proposed api_proxy turn fails', () => {
    stageTurnResult(env.tmp, env.turnId, env.runId, { proposed_changes: undefined });
    const result = validateStagedTurnResult(env.tmp, env.state, env.config);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('proposed_changes is empty or missing')));
  });

  it('proposed_changes with missing path fails', () => {
    stageTurnResult(env.tmp, env.turnId, env.runId, {
      proposed_changes: [{ action: 'create', content: 'hello' }],
    });
    const result = validateStagedTurnResult(env.tmp, env.state, env.config);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('missing or invalid "path"')));
  });

  it('proposed_changes with invalid action fails', () => {
    stageTurnResult(env.tmp, env.turnId, env.runId, {
      proposed_changes: [{ path: 'foo.js', action: 'rename', content: 'x' }],
    });
    const result = validateStagedTurnResult(env.tmp, env.state, env.config);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('action must be')));
  });

  it('proposed_changes with missing content for create fails', () => {
    stageTurnResult(env.tmp, env.turnId, env.runId, {
      proposed_changes: [{ path: 'foo.js', action: 'create' }],
    });
    const result = validateStagedTurnResult(env.tmp, env.state, env.config);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('content is required')));
  });

  it('proposed_changes with delete action (no content) passes', () => {
    stageTurnResult(env.tmp, env.turnId, env.runId, {
      proposed_changes: [
        { path: 'src/pool.js', action: 'create', content: '// new' },
        { path: 'src/old.js', action: 'delete' },
      ],
    });
    const result = validateStagedTurnResult(env.tmp, env.state, env.config);
    assert.equal(result.ok, true, `Expected ok but got: ${result.errors?.join('; ')}`);
  });
});

describe('api_proxy proposed authoring — review_only with proposed_changes warning', () => {
  let env;

  beforeEach(() => { env = setupRun('review_only'); });
  afterEach(() => { rmSync(env.tmp, { recursive: true, force: true }); });

  it('proposed_changes on review_only role produces warning not error', () => {
    stageTurnResult(env.tmp, env.turnId, env.runId, {
      artifact: { type: 'review' },
      files_changed: [],
      proposed_changes: [{ path: 'foo.js', action: 'create', content: 'x' }],
    });
    const result = validateStagedTurnResult(env.tmp, env.state, env.config);
    assert.equal(result.ok, true, `Expected ok but got: ${result.errors?.join('; ')}`);
    assert.ok(result.warnings?.some(w => w.includes('proposed_changes will be ignored')));
  });
});

// ── Dispatch Bundle ──────────────────────────────────────────────────────────

describe('api_proxy proposed authoring — dispatch bundle', () => {
  it('includes proposed-authoring instructions for api_proxy + proposed', () => {
    const env = setupRun('proposed');
    try {
      writeDispatchBundle(env.tmp, env.state, env.config);
      const turnDir = join(env.tmp, getDispatchTurnDir(env.turnId));
      const promptPath = join(turnDir, 'PROMPT.md');
      assert.ok(existsSync(promptPath), 'PROMPT.md should exist');

      const prompt = readFileSync(promptPath, 'utf8');
      assert.match(prompt, /proposed_changes/, 'Prompt must mention proposed_changes');
      assert.match(prompt, /\.agentxchain\/proposed\//, 'Prompt must mention materialization path');
      assert.match(prompt, /cannot write repo files directly/, 'Prompt must state api_proxy cannot write directly');
    } finally {
      rmSync(env.tmp, { recursive: true, force: true });
    }
  });

  it('does NOT include proposed-authoring instructions for api_proxy + review_only', () => {
    const env = setupRun('review_only');
    try {
      writeDispatchBundle(env.tmp, env.state, env.config);
      const turnDir = join(env.tmp, getDispatchTurnDir(env.turnId));
      const promptPath = join(turnDir, 'PROMPT.md');
      const prompt = readFileSync(promptPath, 'utf8');
      assert.doesNotMatch(prompt, /proposed_changes/, 'Review-only prompt must not mention proposed_changes');
    } finally {
      rmSync(env.tmp, { recursive: true, force: true });
    }
  });
});

// ── Proposal Materialization ─────────────────────────────────────────────────

describe('api_proxy proposed authoring — materialization', () => {
  it('materializes proposed changes to .agentxchain/proposed/<turn_id>/', () => {
    const env = setupRun('proposed');
    try {
      stageTurnResult(env.tmp, env.turnId, env.runId, {
        proposed_changes: [
          { path: 'src/pool.js', action: 'create', content: '// pool module\nexport function createPool() {}\n' },
          { path: 'src/config.js', action: 'modify', content: '// updated config\nexport const MAX_POOL = 10;\n' },
          { path: 'src/old.js', action: 'delete' },
        ],
        files_changed: ['src/pool.js', 'src/config.js', 'src/old.js'],
      });

      const acceptResult = acceptGovernedTurn(env.tmp, env.config);
      assert.equal(acceptResult.ok, true, `Accept failed: ${acceptResult.error}`);

      // Verify materialization
      const proposalDir = join(env.tmp, '.agentxchain/proposed', env.turnId);
      assert.ok(existsSync(proposalDir), 'Proposal directory should exist');
      assert.ok(existsSync(join(proposalDir, 'PROPOSAL.md')), 'PROPOSAL.md should exist');
      assert.ok(existsSync(join(proposalDir, 'SOURCE_SNAPSHOT.json')), 'SOURCE_SNAPSHOT.json should exist');
      assert.ok(existsSync(join(proposalDir, 'src/pool.js')), 'Proposed pool.js should exist');
      assert.ok(existsSync(join(proposalDir, 'src/config.js')), 'Proposed config.js should exist');
      assert.ok(!existsSync(join(proposalDir, 'src/old.js')), 'Deleted file should not be materialized');

      // Verify content
      const poolContent = readFileSync(join(proposalDir, 'src/pool.js'), 'utf8');
      assert.match(poolContent, /createPool/);
      const configContent = readFileSync(join(proposalDir, 'src/config.js'), 'utf8');
      assert.match(configContent, /MAX_POOL/);

      // Verify PROPOSAL.md
      const proposalMd = readFileSync(join(proposalDir, 'PROPOSAL.md'), 'utf8');
      assert.match(proposalMd, /src\/pool\.js.*create/);
      assert.match(proposalMd, /src\/config\.js.*modify/);
      assert.match(proposalMd, /src\/old\.js.*delete/);

      const snapshot = JSON.parse(readFileSync(join(proposalDir, 'SOURCE_SNAPSHOT.json'), 'utf8'));
      assert.equal(snapshot.files.length, 3);
      assert.deepStrictEqual(snapshot.files.map((entry) => entry.path), ['src/pool.js', 'src/config.js', 'src/old.js']);
    } finally {
      rmSync(env.tmp, { recursive: true, force: true });
    }
  });
});
