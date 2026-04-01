import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  rejectGovernedTurn,
  STATE_PATH,
  HISTORY_PATH,
  LEDGER_PATH,
  STAGING_PATH,
  TALK_PATH
} from '../src/lib/governed-state.js';
import { scaffoldGoverned } from '../src/commands/init.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-test-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(root, relPath) {
  return JSON.parse(readFileSync(join(root, relPath), 'utf8'));
}

function readJsonl(root, relPath) {
  const content = readFileSync(join(root, relPath), 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map(line => JSON.parse(line));
}

function makeNormalizedConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'test-project', name: 'Test Project', default_branch: 'main' },
    roles: {
      pm: { title: 'Product Manager', mandate: 'Test', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-pm' },
      dev: { title: 'Developer', mandate: 'Test', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-dev' },
      qa: { title: 'QA', mandate: 'Test', write_authority: 'review_only', runtime_class: 'api_proxy', runtime_id: 'api-qa' },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'local-dev': { type: 'local_cli' },
      'api-qa': { type: 'api_proxy' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'implementation_complete' },
      qa: { entry_role: 'qa', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'qa_ship_verdict' },
    },
    gates: {},
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    rules: { challenge_required: true, max_turn_retries: 2, max_deadlock_cycles: 2 },
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
    compat: { next_owner_source: 'state-json', lock_based_coordination: false, original_version: 4 },
  };
}

function makeTurnResult(state) {
  return {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: state.current_turn.turn_id,
    role: state.current_turn.assigned_role,
    runtime_id: state.current_turn.runtime_id,
    status: 'completed',
    summary: 'Did the work.',
    decisions: [{
      id: 'DEC-001',
      category: 'implementation',
      statement: 'Used approach A.',
      rationale: 'Simpler.'
    }],
    objections: [{
      id: 'OBJ-001',
      severity: 'low',
      statement: 'No major concerns.',
      status: 'raised'
    }],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['echo ok'],
      evidence_summary: 'All good.',
      machine_evidence: [{ command: 'echo ok', exit_code: 0 }]
    },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'dev',
    phase_transition_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 100, output_tokens: 50, usd: 0.01 }
  };
}

// ── Tests: init --governed scaffolding ───────────────────────────────────────

describe('scaffoldGoverned', () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('creates all required governed files', () => {
    scaffoldGoverned(dir, 'Test Project', 'test-project');

    assert.ok(existsSync(join(dir, 'agentxchain.json')));
    assert.ok(existsSync(join(dir, '.agentxchain', 'state.json')));
    assert.ok(existsSync(join(dir, '.agentxchain', 'history.jsonl')));
    assert.ok(existsSync(join(dir, '.agentxchain', 'decision-ledger.jsonl')));
    assert.ok(existsSync(join(dir, '.agentxchain', 'prompts', 'pm.md')));
    assert.ok(existsSync(join(dir, '.agentxchain', 'prompts', 'dev.md')));
    assert.ok(existsSync(join(dir, '.agentxchain', 'prompts', 'qa.md')));
    assert.ok(existsSync(join(dir, '.agentxchain', 'prompts', 'eng_director.md')));
    assert.ok(existsSync(join(dir, '.planning', 'PM_SIGNOFF.md')));
    assert.ok(existsSync(join(dir, '.planning', 'ROADMAP.md')));
    assert.ok(existsSync(join(dir, '.planning', 'acceptance-matrix.md')));
    assert.ok(existsSync(join(dir, '.planning', 'ship-verdict.md')));
    assert.ok(existsSync(join(dir, 'TALK.md')));
  });

  it('creates v4 governed config', () => {
    scaffoldGoverned(dir, 'Test Project', 'test-project');
    const config = readJson(dir, 'agentxchain.json');
    assert.equal(config.schema_version, '1.0');
    assert.equal(config.project.id, 'test-project');
    assert.ok(config.roles.pm);
    assert.ok(config.roles.dev);
    assert.ok(config.roles.qa);
    assert.ok(config.roles.eng_director);
    assert.ok(config.runtimes['manual-pm']);
    assert.ok(config.runtimes['local-dev']);
    assert.ok(config.routing.planning);
    assert.ok(config.gates.planning_signoff);
  });

  it('creates idle state with no active turn', () => {
    scaffoldGoverned(dir, 'Test Project', 'test-project');
    const state = readJson(dir, '.agentxchain/state.json');
    assert.equal(state.status, 'idle');
    assert.equal(state.phase, 'planning');
    assert.equal(state.run_id, null);
    assert.equal(state.current_turn, null);
  });

  it('does not create legacy files (lock.json, root state.json)', () => {
    scaffoldGoverned(dir, 'Test Project', 'test-project');
    assert.ok(!existsSync(join(dir, 'lock.json')));
    assert.ok(!existsSync(join(dir, 'state.json'))); // state is under .agentxchain/
    assert.ok(!existsSync(join(dir, 'state.md')));
    assert.ok(!existsSync(join(dir, 'history.jsonl'))); // history is under .agentxchain/
  });

  it('creates staging and dispatch directories', () => {
    scaffoldGoverned(dir, 'Test Project', 'test-project');
    assert.ok(existsSync(join(dir, '.agentxchain', 'staging')));
    assert.ok(existsSync(join(dir, '.agentxchain', 'dispatch')));
    assert.ok(existsSync(join(dir, '.agentxchain', 'reviews')));
  });

  it('prompt templates include role-specific behavioral instructions', () => {
    scaffoldGoverned(dir, 'Test Project', 'test-project');
    const devPrompt = readFileSync(join(dir, '.agentxchain', 'prompts', 'dev.md'), 'utf8');
    assert.ok(devPrompt.includes('Developer'));
    assert.ok(devPrompt.includes('Implement'));
    assert.ok(devPrompt.includes('Verification Is Mandatory'));

    const qaPrompt = readFileSync(join(dir, '.agentxchain', 'prompts', 'qa.md'), 'utf8');
    assert.ok(qaPrompt.includes('QA'));
    assert.ok(qaPrompt.includes('run_completion_request'));
    assert.ok(qaPrompt.includes('ship-verdict'));

    const pmPrompt = readFileSync(join(dir, '.agentxchain', 'prompts', 'pm.md'), 'utf8');
    assert.ok(pmPrompt.includes('Product Manager'));
    assert.ok(pmPrompt.includes('ROADMAP'));
    assert.ok(pmPrompt.includes('phase_transition_request'));
  });
});

// ── Tests: initializeGovernedRun ─────────────────────────────────────────────

describe('initializeGovernedRun', () => {
  let dir, config;
  beforeEach(() => {
    dir = makeTmpDir();
    config = makeNormalizedConfig();
    scaffoldGoverned(dir, 'Test Project', 'test-project');
  });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('creates a run from idle state', () => {
    const result = initializeGovernedRun(dir, config);
    assert.ok(result.ok);
    assert.ok(result.state.run_id.startsWith('run_'));
    assert.equal(result.state.status, 'active');
  });

  it('rejects when status is active', () => {
    initializeGovernedRun(dir, config);
    const result = initializeGovernedRun(dir, config);
    assert.ok(!result.ok);
    assert.ok(result.error.includes('active'));
  });

  it('allows initialization from paused state', () => {
    // Simulate a paused state (e.g., post-migration)
    const state = readJson(dir, '.agentxchain/state.json');
    state.status = 'paused';
    writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2) + '\n');

    const result = initializeGovernedRun(dir, config);
    assert.ok(result.ok);
    assert.equal(result.state.status, 'active');
  });

  it('sets budget from config', () => {
    const result = initializeGovernedRun(dir, config);
    assert.equal(result.state.budget_status.remaining_usd, 50.0);
    assert.equal(result.state.budget_status.spent_usd, 0);
  });
});

// ── Tests: assignGovernedTurn ────────────────────────────────────────────────

describe('assignGovernedTurn', () => {
  let dir, config;
  beforeEach(() => {
    dir = makeTmpDir();
    config = makeNormalizedConfig();
    scaffoldGoverned(dir, 'Test Project', 'test-project');
    initializeGovernedRun(dir, config);
  });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('assigns a turn to a valid role', () => {
    const result = assignGovernedTurn(dir, config, 'pm');
    assert.ok(result.ok);
    assert.ok(result.state.current_turn);
    assert.equal(result.state.current_turn.assigned_role, 'pm');
    assert.ok(result.state.current_turn.turn_id.startsWith('turn_'));
    assert.equal(result.state.current_turn.attempt, 1);
  });

  it('rejects assignment when a turn is already active', () => {
    assignGovernedTurn(dir, config, 'pm');
    const result = assignGovernedTurn(dir, config, 'dev');
    assert.ok(!result.ok);
    assert.ok(result.error.includes('already assigned'));
  });

  it('rejects unknown role', () => {
    const result = assignGovernedTurn(dir, config, 'nonexistent');
    assert.ok(!result.ok);
    assert.ok(result.error.includes('Unknown role'));
  });

  it('falls back to raw governed role.runtime when runtime_id is absent', () => {
    const rawishConfig = structuredClone(config);
    rawishConfig.roles.pm = {
      title: 'Product Manager',
      mandate: 'Test',
      write_authority: 'review_only',
      runtime: 'manual-pm'
    };

    const result = assignGovernedTurn(dir, rawishConfig, 'pm');
    assert.ok(result.ok);
    assert.equal(result.state.current_turn.runtime_id, 'manual-pm');
  });

  it('rejects when run is not active', () => {
    const state = readJson(dir, '.agentxchain/state.json');
    state.status = 'paused';
    writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2) + '\n');

    const result = assignGovernedTurn(dir, config, 'pm');
    assert.ok(!result.ok);
  });
});

// ── Tests: acceptGovernedTurn ────────────────────────────────────────────────

describe('acceptGovernedTurn', () => {
  let dir, config;
  beforeEach(() => {
    dir = makeTmpDir();
    config = makeNormalizedConfig();
    scaffoldGoverned(dir, 'Test Project', 'test-project');
    initializeGovernedRun(dir, config);
  });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('accepts a valid turn result and updates all state files', () => {
    const assignResult = assignGovernedTurn(dir, config, 'qa');
    const state = assignResult.state;

    // Write a valid staged turn result
    const turnResult = makeTurnResult(state);
    mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(turnResult, null, 2));

    const result = acceptGovernedTurn(dir, config);
    assert.ok(result.ok, `Accept failed: ${result.error}`);

    // State updated
    assert.equal(result.state.current_turn, null);
    assert.equal(result.state.last_completed_turn_id, state.current_turn.turn_id);

    // History appended
    const history = readJsonl(dir, HISTORY_PATH);
    assert.equal(history.length, 1);
    assert.equal(history[0].turn_id, state.current_turn.turn_id);
    assert.ok(history[0].accepted_at);

    // Decision ledger appended
    const ledger = readJsonl(dir, LEDGER_PATH);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].id, 'DEC-001');

    // TALK.md updated
    const talk = readFileSync(join(dir, 'TALK.md'), 'utf8');
    assert.ok(talk.includes('Did the work.'));

    // Staging file cleared
    assert.ok(!existsSync(join(dir, STAGING_PATH)));
  });

  it('tracks budget after acceptance', () => {
    const assignResult = assignGovernedTurn(dir, config, 'qa');
    const turnResult = makeTurnResult(assignResult.state);
    turnResult.cost.usd = 1.50;
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(turnResult, null, 2));

    const result = acceptGovernedTurn(dir, config);
    assert.ok(result.ok);
    assert.equal(result.state.budget_status.spent_usd, 1.50);
    assert.equal(result.state.budget_status.remaining_usd, 48.50);
  });

  it('pauses run when turn status is needs_human', () => {
    const assignResult = assignGovernedTurn(dir, config, 'qa');
    const turnResult = makeTurnResult(assignResult.state);
    turnResult.status = 'needs_human';
    turnResult.needs_human_reason = 'Manual QA required';
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(turnResult, null, 2));

    const result = acceptGovernedTurn(dir, config);
    assert.ok(result.ok);
    assert.equal(result.state.status, 'paused');
    assert.ok(result.state.blocked_on.includes('Manual QA required'));
  });

  it('rejects when no turn is active', () => {
    const result = acceptGovernedTurn(dir, config);
    assert.ok(!result.ok);
    assert.ok(result.error.includes('No active turn'));
  });

  it('rejects when staging file is missing', () => {
    assignGovernedTurn(dir, config, 'qa');
    const result = acceptGovernedTurn(dir, config);
    assert.ok(!result.ok);
    assert.ok(result.error.includes('Validation failed') || result.error.includes('not found'));
  });

  it('rejects when turn result has mismatched run_id', () => {
    const assignResult = assignGovernedTurn(dir, config, 'qa');
    const turnResult = makeTurnResult(assignResult.state);
    turnResult.run_id = 'run_wrong';
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(turnResult, null, 2));

    const result = acceptGovernedTurn(dir, config);
    assert.ok(!result.ok);
    assert.ok(result.error.includes('assignment'));
  });
});

// ── Tests: rejectGovernedTurn ────────────────────────────────────────────────

describe('rejectGovernedTurn', () => {
  let dir, config;
  beforeEach(() => {
    dir = makeTmpDir();
    config = makeNormalizedConfig();
    scaffoldGoverned(dir, 'Test Project', 'test-project');
    initializeGovernedRun(dir, config);
  });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('increments attempt on first rejection (retry allowed)', () => {
    assignGovernedTurn(dir, config, 'dev');

    // Write a bad staging file
    writeFileSync(join(dir, STAGING_PATH), '{"bad": true}');

    const validationResult = { errors: ['Missing fields'], failed_stage: 'schema' };
    const result = rejectGovernedTurn(dir, config, validationResult, 'Bad result');

    assert.ok(result.ok);
    assert.equal(result.escalated, false);
    assert.equal(result.state.current_turn.attempt, 2);
    assert.equal(result.state.current_turn.status, 'retrying');
    // Staging file cleared
    assert.ok(!existsSync(join(dir, STAGING_PATH)));
  });

  it('escalates after max retries exhausted', () => {
    assignGovernedTurn(dir, config, 'dev');

    // First rejection
    writeFileSync(join(dir, STAGING_PATH), '{"bad": true}');
    rejectGovernedTurn(dir, config, { errors: ['err'], failed_stage: 'schema' });

    // Second rejection (attempt 2, max is 2)
    writeFileSync(join(dir, STAGING_PATH), '{"bad": true}');
    const result = rejectGovernedTurn(dir, config, { errors: ['err'], failed_stage: 'schema' });

    assert.ok(result.ok);
    assert.equal(result.escalated, true);
    assert.equal(result.state.status, 'paused');
    assert.ok(result.state.blocked_on.includes('escalation'));
    assert.ok(result.state.escalation);
    assert.ok(result.state.escalation.reason.includes('Retries exhausted'));
  });

  it('preserves rejected artifact', () => {
    assignGovernedTurn(dir, config, 'dev');
    writeFileSync(join(dir, STAGING_PATH), '{"bad": true}');

    rejectGovernedTurn(dir, config, { errors: ['err'], failed_stage: 'schema' });

    // Check rejected artifact was saved
    const rejectedDir = join(dir, '.agentxchain', 'dispatch', 'rejected');
    assert.ok(existsSync(rejectedDir));

    const files = readdirSync(rejectedDir);
    assert.equal(files.length, 1);
    assert.ok(files[0].includes('attempt-1'));
  });

  it('does NOT append to history or ledger', () => {
    assignGovernedTurn(dir, config, 'dev');
    writeFileSync(join(dir, STAGING_PATH), '{"bad": true}');

    rejectGovernedTurn(dir, config, { errors: ['err'], failed_stage: 'schema' });

    const historyContent = readFileSync(join(dir, HISTORY_PATH), 'utf8');
    assert.equal(historyContent.trim(), '');

    const ledgerContent = readFileSync(join(dir, LEDGER_PATH), 'utf8');
    assert.equal(ledgerContent.trim(), '');
  });

  it('rejects when no turn is active', () => {
    const result = rejectGovernedTurn(dir, config, { errors: ['err'] });
    assert.ok(!result.ok);
    assert.ok(result.error.includes('No active turn'));
  });
});

// ── Tests: migrate ───────────────────────────────────────────────────────────

describe('migrate (integration)', () => {
  let dir;
  beforeEach(() => {
    dir = makeTmpDir();
  });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('migrate module loads without error', async () => {
    const mod = await import('../src/commands/migrate.js');
    assert.ok(typeof mod.migrateCommand === 'function');
  });
});

// ── Tests: full accept/reject cycle ──────────────────────────────────────────

describe('full governed cycle', () => {
  let dir, config;
  beforeEach(() => {
    dir = makeTmpDir();
    config = makeNormalizedConfig();
    scaffoldGoverned(dir, 'Test Project', 'test-project');
  });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('init → run → assign → accept → assign second turn', () => {
    // Initialize run
    const initResult = initializeGovernedRun(dir, config);
    assert.ok(initResult.ok);

    // Assign first turn (QA review)
    const assign1 = assignGovernedTurn(dir, config, 'qa');
    assert.ok(assign1.ok);

    // Write valid turn result
    const turnResult = makeTurnResult(assign1.state);
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(turnResult, null, 2));

    // Accept
    const accept1 = acceptGovernedTurn(dir, config);
    assert.ok(accept1.ok, `Accept failed: ${accept1.error}`);
    assert.equal(accept1.state.current_turn, null);

    // Assign second turn
    const assign2 = assignGovernedTurn(dir, config, 'dev');
    assert.ok(assign2.ok);
    assert.equal(assign2.state.current_turn.assigned_role, 'dev');

    // Verify history has one entry
    const history = readJsonl(dir, HISTORY_PATH);
    assert.equal(history.length, 1);
  });

  it('init → run → assign → reject → retry → accept', () => {
    initializeGovernedRun(dir, config);
    const assign = assignGovernedTurn(dir, config, 'qa');
    assert.ok(assign.ok);

    // First attempt: bad result, rejected
    writeFileSync(join(dir, STAGING_PATH), '{"bad": true}');
    const reject1 = rejectGovernedTurn(dir, config, { errors: ['bad'], failed_stage: 'schema' });
    assert.ok(reject1.ok);
    assert.equal(reject1.escalated, false);
    assert.equal(reject1.state.current_turn.attempt, 2);

    // Retry: good result
    const turnResult = makeTurnResult(reject1.state);
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(turnResult, null, 2));

    const accept = acceptGovernedTurn(dir, config);
    assert.ok(accept.ok, `Accept on retry failed: ${accept.error}`);

    // Only one history entry (the accepted one)
    const history = readJsonl(dir, HISTORY_PATH);
    assert.equal(history.length, 1);
  });
});
