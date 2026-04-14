import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  getActiveTurn,
  normalizeGovernedStateShape,
  STATE_PATH,
} from '../src/lib/governed-state.js';
import { getTurnStagingResultPath } from '../src/lib/turn-paths.js';
import { resolveGovernedRole } from '../src/lib/role-resolution.js';
import { writeDispatchBundle } from '../src/lib/dispatch-bundle.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-del-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'ignore' });
  writeFileSync(join(dir, 'README.md'), '# Test\n');
  execSync('git add -A && git commit -m "init"', { cwd: dir, stdio: 'ignore' });
  return dir;
}

function readState(root) {
  const raw = JSON.parse(readFileSync(join(root, STATE_PATH), 'utf8'));
  return normalizeGovernedStateShape(raw).state;
}

function gitCommit(root) {
  execSync('git add -A && git commit -m "state" --allow-empty', { cwd: root, stdio: 'ignore' });
}

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'del-test', name: 'Delegation Test', default_branch: 'main' },
    roles: {
      director: { title: 'Engineering Director', mandate: 'Coordinate and delegate', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-director' },
      dev: { title: 'Developer', mandate: 'Write code', write_authority: 'authoritative', runtime_class: 'manual', runtime_id: 'manual-dev' },
      qa: { title: 'QA', mandate: 'Test', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-qa' },
    },
    runtimes: {
      'manual-director': { type: 'manual' },
      'manual-dev': { type: 'manual' },
      'manual-qa': { type: 'manual' },
    },
    routing: {
      planning: { entry_role: 'director', allowed_next_roles: ['director', 'dev', 'qa', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['director', 'dev', 'qa', 'human'], exit_gate: 'impl_complete' },
    },
    phases: ['planning', 'implementation'],
    gates: {},
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    rules: { challenge_required: false, max_turn_retries: 2, max_deadlock_cycles: 2 },
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
    compat: { next_owner_source: 'state-json', lock_based_coordination: false, original_version: 4 },
  };
}

function makeTurnResult(state, overrides = {}) {
  const turn = getActiveTurn(state);
  return {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Completed the work.',
    decisions: [],
    objections: [],
    files_changed: [],
    artifacts_created: [],
    verification: { status: 'pass', commands: ['echo ok'], evidence_summary: 'ok', machine_evidence: [{ command: 'echo ok', exit_code: 0 }] },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'dev',
    phase_transition_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 100, output_tokens: 50, usd: 0.01 },
    ...overrides,
  };
}

function stageTurnResult(root, state, turnResult) {
  const turn = getActiveTurn(state);
  const stagingPath = getTurnStagingResultPath(turn.turn_id);
  const absPath = join(root, stagingPath);
  mkdirSync(join(root, '.agentxchain', 'staging', turn.turn_id), { recursive: true });
  writeFileSync(absPath, JSON.stringify(turnResult, null, 2));
}

/** Stage, commit, accept, commit — full cycle for clean baseline between turns. */
function stageAcceptCommit(root, config, state, turnResult) {
  stageTurnResult(root, state, turnResult);
  gitCommit(root);
  const result = acceptGovernedTurn(root, config);
  if (result.ok) gitCommit(root);
  return result;
}

let tmpDirs = [];

function setup() {
  const root = makeTmpDir();
  tmpDirs.push(root);
  const config = makeConfig();
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  gitCommit(root);
  const initResult = initializeGovernedRun(root, config);
  assert.ok(initResult.ok, `Init failed: ${initResult.error}`);
  gitCommit(root);
  return { root, config };
}

function cleanup() {
  for (const dir of tmpDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  tmpDirs = [];
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Delegation Chains', () => {
  afterEach(cleanup);

  describe('AT-DEL-001: Turn result with delegations populates delegation_queue', () => {
    it('enqueues delegations and sets next_recommended_role', () => {
      const { root, config } = setup();
      const a1 = assignGovernedTurn(root, config, 'director');
      assert.ok(a1.ok, `Assign failed: ${a1.error}`);

      let state = readState(root);
      const result = stageAcceptCommit(root, config, state, makeTurnResult(state, {
        proposed_next_role: 'dev',
        delegations: [
          { id: 'del-001', to_role: 'dev', charter: 'Implement auth middleware', acceptance_contract: ['Auth tests pass'] },
          { id: 'del-002', to_role: 'qa', charter: 'Review auth implementation', acceptance_contract: ['Security review complete'] },
        ],
      }));
      assert.ok(result.ok, `Accept failed: ${result.error}`);

      state = readState(root);
      assert.ok(Array.isArray(state.delegation_queue), 'delegation_queue should exist');
      assert.equal(state.delegation_queue.length, 2);
      assert.equal(state.delegation_queue[0].delegation_id, 'del-001');
      assert.equal(state.delegation_queue[0].status, 'pending');
      assert.equal(state.delegation_queue[0].to_role, 'dev');
      assert.equal(state.delegation_queue[1].delegation_id, 'del-002');
      assert.equal(state.delegation_queue[1].status, 'pending');
      assert.equal(state.next_recommended_role, 'dev');
    });
  });

  describe('AT-DEL-002: Role resolution returns delegation queue to_role', () => {
    it('prioritizes pending delegation over normal resolution', () => {
      const { root, config } = setup();
      const a1 = assignGovernedTurn(root, config, 'director');
      assert.ok(a1.ok);
      let state = readState(root);
      stageAcceptCommit(root, config, state, makeTurnResult(state, {
        delegations: [{ id: 'del-001', to_role: 'dev', charter: 'Feature X', acceptance_contract: ['Tests pass'] }],
      }));

      state = readState(root);
      const resolution = resolveGovernedRole({ state, config });
      assert.equal(resolution.roleId, 'dev');
      assert.ok(resolution.delegation);
      assert.equal(resolution.delegation.delegation_id, 'del-001');
    });
  });

  describe('AT-DEL-003: Delegated turn receives delegation_context in dispatch bundle', () => {
    it('includes delegation_context in assignment and CONTEXT.md', () => {
      const { root, config } = setup();
      const a1 = assignGovernedTurn(root, config, 'director');
      assert.ok(a1.ok);
      let state = readState(root);
      stageAcceptCommit(root, config, state, makeTurnResult(state, {
        delegations: [{ id: 'del-001', to_role: 'dev', charter: 'Build the API', acceptance_contract: ['API responds 200'] }],
      }));

      const a2 = assignGovernedTurn(root, config, 'dev');
      assert.ok(a2.ok, `Dev assign failed: ${a2.error}`);

      state = readState(root);
      const turn = getActiveTurn(state);
      assert.ok(turn.delegation_context);
      assert.equal(turn.delegation_context.delegation_id, 'del-001');
      assert.equal(turn.delegation_context.parent_role, 'director');
      assert.equal(turn.delegation_context.charter, 'Build the API');

      const bundleResult = writeDispatchBundle(root, state, config);
      assert.ok(bundleResult.ok, `Bundle failed: ${bundleResult.error}`);

      const assignmentPath = join(root, '.agentxchain', 'dispatch', 'turns', turn.turn_id, 'ASSIGNMENT.json');
      const assignment = JSON.parse(readFileSync(assignmentPath, 'utf8'));
      assert.ok(assignment.delegation_context);
      assert.equal(assignment.delegation_context.charter, 'Build the API');

      const contextPath = join(root, '.agentxchain', 'dispatch', 'turns', turn.turn_id, 'CONTEXT.md');
      const contextMd = readFileSync(contextPath, 'utf8');
      assert.ok(contextMd.includes('## Delegation Context'));
      assert.ok(contextMd.includes('Build the API'));
      assert.ok(contextMd.includes('API responds 200'));
    });
  });

  describe('AT-DEL-004: Completing all delegations triggers delegation review', () => {
    it('sets pending_delegation_review and recommends parent role', () => {
      const { root, config } = setup();
      const a1 = assignGovernedTurn(root, config, 'director');
      assert.ok(a1.ok);
      let state = readState(root);
      stageAcceptCommit(root, config, state, makeTurnResult(state, {
        delegations: [{ id: 'del-001', to_role: 'dev', charter: 'Build feature', acceptance_contract: ['Tests pass'] }],
      }));

      const a2 = assignGovernedTurn(root, config, 'dev');
      assert.ok(a2.ok, `Dev assign failed: ${a2.error}`);
      state = readState(root);
      const devResult = stageAcceptCommit(root, config, state, makeTurnResult(state, {
        summary: 'Built the feature with tests',
        proposed_next_role: 'director',
      }));
      assert.ok(devResult.ok, `Dev accept failed: ${devResult.error}`);

      state = readState(root);
      assert.ok(state.pending_delegation_review);
      assert.equal(state.pending_delegation_review.parent_role, 'director');
      assert.equal(state.pending_delegation_review.delegation_results.length, 1);
      assert.equal(state.pending_delegation_review.delegation_results[0].delegation_id, 'del-001');
      assert.equal(state.pending_delegation_review.delegation_results[0].summary, 'Built the feature with tests');
      assert.equal(state.next_recommended_role, 'director');
      assert.equal(state.delegation_queue.length, 0);
    });
  });

  describe('AT-DEL-005: Delegation review turn receives results in dispatch bundle', () => {
    it('includes delegation_review in assignment and CONTEXT.md', () => {
      const { root, config } = setup();

      // Director delegates, dev completes
      const a1 = assignGovernedTurn(root, config, 'director');
      assert.ok(a1.ok);
      let state = readState(root);
      stageAcceptCommit(root, config, state, makeTurnResult(state, {
        delegations: [{ id: 'del-001', to_role: 'dev', charter: 'Build auth', acceptance_contract: ['Auth works'] }],
      }));

      const a2 = assignGovernedTurn(root, config, 'dev');
      assert.ok(a2.ok, `Dev assign: ${a2.error}`);
      state = readState(root);
      stageAcceptCommit(root, config, state, makeTurnResult(state, { summary: 'Auth implemented', proposed_next_role: 'director' }));

      // Director review
      const a3 = assignGovernedTurn(root, config, 'director');
      assert.ok(a3.ok, `Review assign: ${a3.error}`);
      state = readState(root);
      const turn = getActiveTurn(state);
      assert.ok(turn.delegation_review);
      assert.equal(turn.delegation_review.results.length, 1);
      assert.equal(turn.delegation_review.results[0].delegation_id, 'del-001');

      const bundleResult = writeDispatchBundle(root, state, config);
      assert.ok(bundleResult.ok);
      const contextPath = join(root, '.agentxchain', 'dispatch', 'turns', turn.turn_id, 'CONTEXT.md');
      const contextMd = readFileSync(contextPath, 'utf8');
      assert.ok(contextMd.includes('## Delegation Review'));
      assert.ok(contextMd.includes('Auth implemented'));
    });
  });

  describe('AT-DEL-006: Accepting delegation review clears pending_delegation_review', () => {
    it('clears pending_delegation_review after review accepted', () => {
      const { root, config } = setup();

      // Full cycle: director → dev → director review
      const a1 = assignGovernedTurn(root, config, 'director');
      assert.ok(a1.ok);
      let state = readState(root);
      stageAcceptCommit(root, config, state, makeTurnResult(state, {
        delegations: [{ id: 'del-001', to_role: 'dev', charter: 'Do work', acceptance_contract: ['Done'] }],
      }));

      const a2 = assignGovernedTurn(root, config, 'dev');
      assert.ok(a2.ok, `Dev: ${a2.error}`);
      state = readState(root);
      stageAcceptCommit(root, config, state, makeTurnResult(state, { proposed_next_role: 'director' }));

      const a3 = assignGovernedTurn(root, config, 'director');
      assert.ok(a3.ok, `Review: ${a3.error}`);
      state = readState(root);
      const reviewResult = stageAcceptCommit(root, config, state, makeTurnResult(state, { proposed_next_role: 'dev' }));
      assert.ok(reviewResult.ok, `Review accept: ${reviewResult.error}`);

      state = readState(root);
      assert.equal(state.pending_delegation_review, null);
    });
  });

  describe('AT-DEL-007: Self-delegation is rejected', () => {
    it('rejects when a role delegates to itself', () => {
      const { root, config } = setup();
      const a = assignGovernedTurn(root, config, 'director');
      assert.ok(a.ok);
      let state = readState(root);
      stageTurnResult(root, state, makeTurnResult(state, {
        delegations: [{ id: 'del-001', to_role: 'director', charter: 'Self', acceptance_contract: ['Never'] }],
      }));
      const result = acceptGovernedTurn(root, config);
      assert.equal(result.ok, false, 'Should reject self-delegation');
    });
  });

  describe('AT-DEL-008: Delegation to unknown role is rejected', () => {
    it('rejects when to_role does not exist', () => {
      const { root, config } = setup();
      const a = assignGovernedTurn(root, config, 'director');
      assert.ok(a.ok);
      let state = readState(root);
      stageTurnResult(root, state, makeTurnResult(state, {
        delegations: [{ id: 'del-001', to_role: 'nonexistent', charter: 'Impossible', acceptance_contract: ['Never'] }],
      }));
      const result = acceptGovernedTurn(root, config);
      assert.equal(result.ok, false, 'Should reject unknown role');
    });
  });

  describe('AT-DEL-009: Delegation with run_completion_request is rejected', () => {
    it('rejects when delegations and run_completion_request coexist', () => {
      const { root, config } = setup();
      const a = assignGovernedTurn(root, config, 'director');
      assert.ok(a.ok);
      let state = readState(root);
      stageTurnResult(root, state, makeTurnResult(state, {
        run_completion_request: true,
        delegations: [{ id: 'del-001', to_role: 'dev', charter: 'Work', acceptance_contract: ['Done'] }],
      }));
      const result = acceptGovernedTurn(root, config);
      assert.equal(result.ok, false, 'Should reject delegation + run_completion');
    });
  });

  describe('AT-DEL-010: More than 5 delegations per turn is rejected', () => {
    it('rejects when >5 delegations provided', () => {
      const { root, config } = setup();
      const a = assignGovernedTurn(root, config, 'director');
      assert.ok(a.ok);
      let state = readState(root);
      const delegations = [];
      for (let i = 1; i <= 6; i++) {
        delegations.push({ id: `del-${String(i).padStart(3, '0')}`, to_role: 'dev', charter: `Task ${i}`, acceptance_contract: [`Done ${i}`] });
      }
      stageTurnResult(root, state, makeTurnResult(state, { delegations }));
      const result = acceptGovernedTurn(root, config);
      assert.equal(result.ok, false, 'Should reject >5 delegations');
    });
  });

  describe('AT-DEL-011: Role resolution warns when override skips delegation', () => {
    it('warns when explicit role skips pending delegation', () => {
      const { root, config } = setup();
      const a = assignGovernedTurn(root, config, 'director');
      assert.ok(a.ok);
      let state = readState(root);
      stageAcceptCommit(root, config, state, makeTurnResult(state, {
        delegations: [{ id: 'del-001', to_role: 'dev', charter: 'Build it', acceptance_contract: ['Built'] }],
      }));

      state = readState(root);
      const resolution = resolveGovernedRole({ override: 'qa', state, config });
      assert.equal(resolution.roleId, 'qa');
      assert.ok(resolution.warnings.some(w => w.includes('skips pending delegation')));
    });
  });

  describe('AT-DEL-012: Multiple sequential delegations work correctly', () => {
    it('processes delegations one at a time, then triggers review', () => {
      const { root, config } = setup();

      // Director delegates to dev and qa
      const a1 = assignGovernedTurn(root, config, 'director');
      assert.ok(a1.ok);
      let state = readState(root);
      stageAcceptCommit(root, config, state, makeTurnResult(state, {
        delegations: [
          { id: 'del-001', to_role: 'dev', charter: 'Build it', acceptance_contract: ['Built'] },
          { id: 'del-002', to_role: 'qa', charter: 'Test it', acceptance_contract: ['Tested'] },
        ],
      }));

      // Dev completes first delegation
      state = readState(root);
      assert.equal(state.delegation_queue.length, 2);
      assert.equal(resolveGovernedRole({ state, config }).roleId, 'dev');

      const a2 = assignGovernedTurn(root, config, 'dev');
      assert.ok(a2.ok, `Dev: ${a2.error}`);
      state = readState(root);
      stageAcceptCommit(root, config, state, makeTurnResult(state, { summary: 'Built it', proposed_next_role: 'qa' }));

      // QA should be next (del-001 is completed, del-002 is still pending)
      state = readState(root);
      assert.equal(state.delegation_queue.filter(d => d.status === 'pending').length, 1);
      assert.equal(resolveGovernedRole({ state, config }).roleId, 'qa');

      const a3 = assignGovernedTurn(root, config, 'qa');
      assert.ok(a3.ok, `QA: ${a3.error}`);
      state = readState(root);
      stageAcceptCommit(root, config, state, makeTurnResult(state, {
        summary: 'Tested it',
        objections: [{ id: 'OBJ-001', severity: 'low', statement: 'Minor issue' }],
        proposed_next_role: 'director',
      }));

      // Review pending for director
      state = readState(root);
      assert.ok(state.pending_delegation_review);
      assert.equal(state.pending_delegation_review.delegation_results.length, 2);
      assert.equal(state.next_recommended_role, 'director');
    });
  });
});
