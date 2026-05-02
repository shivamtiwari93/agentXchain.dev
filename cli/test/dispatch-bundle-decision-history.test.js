import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, appendFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import { writeDispatchBundle } from '../src/lib/dispatch-bundle.js';
import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  normalizeGovernedStateShape,
  getActiveTurn,
  STATE_PATH,
  STAGING_PATH,
} from '../src/lib/governed-state.js';
import { scaffoldGoverned } from '../src/commands/init.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-dh-test-${randomBytes(6).toString('hex')}`);
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
      get() { return getActiveTurn(normalized); },
    });
    return normalized;
  }
  return parsed;
}

function readJsonl(root, relPath) {
  const path = join(root, relPath);
  if (!existsSync(path)) return [];
  const content = readFileSync(path, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line));
}

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'test-dh', name: 'Test DH', default_branch: 'main' },
    roles: {
      pm: { title: 'Product Manager', mandate: 'Protect user value.', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-pm' },
      dev: { title: 'Developer', mandate: 'Build.', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-gpt-5.5' },
      qa: { title: 'QA', mandate: 'Challenge correctness.', write_authority: 'review_only', runtime_class: 'api_proxy', runtime_id: 'local-opus-4.6' },
      eng_director: { title: 'Engineering Director', mandate: 'Resolve deadlocks.', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-gpt-5.5' },
    },
    runtimes: { 'manual-pm': { type: 'manual' }, 'local-gpt-5.5': { type: 'local_cli' }, 'local-opus-4.6': { type: 'api_proxy' } },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev', 'eng_director'], exit_gate: 'planning_done' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'eng_director'], exit_gate: 'impl_done' },
      qa: { entry_role: 'qa', allowed_next_roles: ['dev', 'qa', 'eng_director'], exit_gate: 'qa_done' },
      remediation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa'], exit_gate: 'remediation_done' },
    },
    gates: {
      planning_done: { requires_human_approval: true },
      impl_done: { requires_verification_pass: true },
      qa_done: { requires_verification_pass: true },
      remediation_done: { requires_verification_pass: true },
    },
    workflow: { phases: ['planning', 'implementation', 'qa', 'remediation'] },
  };
}

function writeLedgerEntries(root, entries) {
  const ledgerPath = join(root, '.agentxchain', 'decision-ledger.jsonl');
  const content = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(ledgerPath, content);
}

function appendLedgerLine(root, line) {
  const ledgerPath = join(root, '.agentxchain', 'decision-ledger.jsonl');
  appendFileSync(ledgerPath, line + '\n');
}

function getContextMd(root, config) {
  const state = readJson(root, STATE_PATH);
  const bundleResult = writeDispatchBundle(root, state, config);
  assert.ok(bundleResult.ok, `dispatch failed: ${bundleResult.error}`);
  const contextPath = join(bundleResult.bundlePath, 'CONTEXT.md');
  return readFileSync(contextPath, 'utf8');
}

function writeStagedResult(root, state, overrides) {
  const turn = state.current_turn;
  const base = {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: `${turn.assigned_role} completed the assigned turn.`,
    decisions: [],
    objections: [],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['node --version'],
      evidence_summary: 'Turn behavior verified in fixture.',
      machine_evidence: [{ command: 'node --version', exit_code: 0 }],
    },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'dev',
    phase_transition_request: null,
    run_completion_request: null,
    cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
  };
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  writeFileSync(join(root, STAGING_PATH), JSON.stringify({ ...base, ...overrides }, null, 2));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('dispatch bundle: decision history', () => {
  let root;
  let config;

  beforeEach(() => {
    root = makeTmpDir();
    config = makeConfig();
    scaffoldGoverned(root, 'test-dh');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('includes Decision History section when ledger has agent decisions', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');

    writeLedgerEntries(root, [
      { id: 'DEC-001', turn_id: 'turn_1', role: 'pm', phase: 'planning', category: 'architecture', statement: 'Use PostgreSQL', rationale: 'Mature RDBMS', status: 'accepted', created_at: '2026-04-01T00:00:00Z' },
      { id: 'DEC-002', turn_id: 'turn_2', role: 'dev', phase: 'implementation', category: 'implementation', statement: 'Use Vitest for tests', rationale: 'Fast', status: 'accepted', created_at: '2026-04-01T01:00:00Z' },
      { id: 'DEC-003', turn_id: 'turn_3', role: 'architect', phase: 'planning', category: 'architecture', statement: 'REST over GraphQL', rationale: 'Simpler', status: 'accepted', created_at: '2026-04-01T02:00:00Z' },
    ]);

    const ctx = getContextMd(root, config);

    assert.ok(ctx.includes('## Decision History'), 'should have Decision History header');
    assert.ok(ctx.includes('| ID | Phase | Role | Runtime | Statement |'), 'should have table header');
    assert.ok(ctx.includes('DEC-001'), 'should include first decision');
    assert.ok(ctx.includes('DEC-002'), 'should include second decision');
    assert.ok(ctx.includes('DEC-003'), 'should include third decision');
    assert.ok(ctx.includes('Use PostgreSQL'), 'should include decision statement');
  });

  it('truncates to 50 entries when ledger exceeds limit', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');

    const entries = [];
    for (let i = 1; i <= 60; i++) {
      entries.push({
        id: `DEC-${String(i).padStart(3, '0')}`,
        turn_id: `turn_${i}`,
        role: 'dev',
        phase: 'implementation',
        category: 'implementation',
        statement: `Decision number ${i}`,
        rationale: 'Reason',
        status: 'accepted',
        created_at: `2026-04-01T${String(i).padStart(2, '0')}:00:00Z`,
      });
    }
    writeLedgerEntries(root, entries);

    const ctx = getContextMd(root, config);

    assert.ok(ctx.includes('## Decision History'));
    // Should show entries 11-60 (last 50), not 1-10
    assert.ok(!ctx.includes('DEC-010'), 'old entry DEC-010 should be excluded');
    assert.ok(ctx.includes('DEC-011'), 'entry DEC-011 should be included');
    assert.ok(ctx.includes('DEC-060'), 'newest entry should be included');
    assert.ok(ctx.includes('Showing 50 of 60 decisions'), 'should have truncation note');
  });

  it('omits section when ledger has only system entries', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');

    writeLedgerEntries(root, [
      { type: 'gate_failure', gate_id: 'impl_done', timestamp: '2026-04-01T00:00:00Z' },
      { decision: 'operator_escalated', run_id: 'run_1', timestamp: '2026-04-01T01:00:00Z' },
      { type: 'approval_policy', gate_type: 'phase_transition', action: 'auto_approve', timestamp: '2026-04-01T02:00:00Z' },
    ]);

    const ctx = getContextMd(root, config);

    assert.ok(!ctx.includes('## Decision History'), 'should not have Decision History for system-only entries');
  });

  it('omits section when ledger file does not exist', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');

    const ctx = getContextMd(root, config);

    assert.ok(!ctx.includes('## Decision History'), 'should not have Decision History when no ledger');
  });

  it('filters out system entries and shows only agent decisions', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');

    writeLedgerEntries(root, [
      { id: 'DEC-001', turn_id: 'turn_1', role: 'pm', phase: 'planning', category: 'architecture', statement: 'Use REST', rationale: 'Simple', status: 'accepted', created_at: '2026-04-01T00:00:00Z' },
      { type: 'gate_failure', gate_id: 'impl_done', timestamp: '2026-04-01T01:00:00Z' },
      { decision: 'operator_escalated', run_id: 'run_1', timestamp: '2026-04-01T02:00:00Z' },
      { id: 'DEC-002', turn_id: 'turn_2', role: 'dev', phase: 'implementation', category: 'implementation', statement: 'Add auth middleware', rationale: 'Security', status: 'accepted', created_at: '2026-04-01T03:00:00Z' },
    ]);

    const ctx = getContextMd(root, config);

    assert.ok(ctx.includes('DEC-001'), 'should include agent decision 1');
    assert.ok(ctx.includes('DEC-002'), 'should include agent decision 2');
    assert.ok(!ctx.includes('gate_failure'), 'should not include system entry');
    assert.ok(!ctx.includes('operator_escalated'), 'should not include system entry');
  });

  it('table has correct columns: ID, Phase, Role, Runtime, Statement', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');

    writeLedgerEntries(root, [
      { id: 'DEC-ARCH-001', turn_id: 'turn_1', role: 'architect', phase: 'planning', category: 'architecture', statement: 'Microservices over monolith', rationale: 'Scale', status: 'accepted', created_at: '2026-04-01T00:00:00Z' },
    ]);

    const ctx = getContextMd(root, config);

    // Check the actual row format (Runtime column is empty when ledger entry has no runtime_id)
    assert.ok(ctx.includes('| DEC-ARCH-001 | planning | architect |  | Microservices over monolith |'));
  });

  it('decisions appear in chronological order (oldest first)', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');

    writeLedgerEntries(root, [
      { id: 'DEC-FIRST', turn_id: 'turn_1', role: 'pm', phase: 'planning', statement: 'First decision', status: 'accepted', created_at: '2026-04-01T00:00:00Z' },
      { id: 'DEC-SECOND', turn_id: 'turn_2', role: 'dev', phase: 'implementation', statement: 'Second decision', status: 'accepted', created_at: '2026-04-01T01:00:00Z' },
    ]);

    const ctx = getContextMd(root, config);

    const firstIdx = ctx.indexOf('DEC-FIRST');
    const secondIdx = ctx.indexOf('DEC-SECOND');
    assert.ok(firstIdx < secondIdx, 'DEC-FIRST should appear before DEC-SECOND (chronological)');
  });

  it('skips malformed JSON lines without crashing', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');

    writeLedgerEntries(root, [
      { id: 'DEC-GOOD', turn_id: 'turn_1', role: 'dev', phase: 'implementation', statement: 'Good decision', status: 'accepted', created_at: '2026-04-01T00:00:00Z' },
    ]);
    // Append a malformed line
    appendLedgerLine(root, '{invalid json here');
    // Append another valid line
    appendLedgerLine(root, JSON.stringify({ id: 'DEC-ALSO-GOOD', turn_id: 'turn_2', role: 'qa', phase: 'qa', statement: 'Also good', status: 'accepted', created_at: '2026-04-01T01:00:00Z' }));

    const ctx = getContextMd(root, config);

    assert.ok(ctx.includes('DEC-GOOD'), 'should include valid decision before malformed line');
    assert.ok(ctx.includes('DEC-ALSO-GOOD'), 'should include valid decision after malformed line');
  });

  it('escapes pipe characters in decision statements', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');

    writeLedgerEntries(root, [
      { id: 'DEC-PIPE', turn_id: 'turn_1', role: 'dev', phase: 'implementation', statement: 'Use A | B pattern', status: 'accepted', created_at: '2026-04-01T00:00:00Z' },
    ]);

    const ctx = getContextMd(root, config);

    // Pipes should be escaped so the table isn't broken
    assert.ok(ctx.includes('Use A \\| B pattern'), 'pipes in statement should be escaped');
  });

  it('preserves cross-model challenge attribution through ledger, history, and CONTEXT.md', () => {
    initializeGovernedRun(root, config);

    const initialState = readJson(root, STATE_PATH);
    initialState.phase = 'implementation';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(initialState, null, 2));

    const devAssign = assignGovernedTurn(root, config, 'dev');
    assert.equal(devAssign.ok, true, devAssign.error);
    const devState = readJson(root, STATE_PATH);
    writeFileSync(join(root, 'feature.js'), 'export const challengeReady = true;\n');
    writeStagedResult(root, devState, {
      summary: 'Implemented the challenge-quality fixture.',
      decisions: [{
        id: 'DEC-001',
        category: 'implementation',
        statement: 'Dev implementation is ready for QA challenge.',
        rationale: 'The product fixture has executable behavior and verification evidence.',
      }],
      files_changed: ['feature.js'],
      artifact: { type: 'workspace', ref: 'git:dirty' },
      proposed_next_role: 'qa',
      phase_transition_request: 'qa',
    });
    const devAccept = acceptGovernedTurn(root, config);
    assert.equal(devAccept.ok, true, devAccept.error);

    const qaAssign = assignGovernedTurn(root, config, 'qa');
    assert.equal(qaAssign.ok, true, qaAssign.error);
    const qaState = readJson(root, STATE_PATH);
    writeStagedResult(root, qaState, {
      summary: 'Challenged the dev implementation and preserved the finding.',
      decisions: [{
        id: 'DEC-002',
        category: 'quality',
        statement: 'QA challenge is substantive and attributable to a different runtime.',
        rationale: 'The objection is stored with the QA accepted turn while the decision ledger retains runtime identity.',
      }],
      objections: [{
        id: 'OBJ-001',
        severity: 'low',
        statement: 'Dev evidence should remain visible to the next implementer.',
        status: 'raised',
      }],
      proposed_next_role: 'dev',
      phase_transition_request: 'remediation',
    });
    const qaAccept = acceptGovernedTurn(root, config);
    assert.equal(qaAccept.ok, true, qaAccept.error);

    const history = readJsonl(root, '.agentxchain/history.jsonl');
    assert.equal(history.at(-1).runtime_id, 'local-opus-4.6');
    assert.deepEqual(history.at(-1).objections, [{
      id: 'OBJ-001',
      severity: 'low',
      statement: 'Dev evidence should remain visible to the next implementer.',
      status: 'raised',
    }]);

    const ledger = readJsonl(root, '.agentxchain/decision-ledger.jsonl');
    assert.equal(ledger.find((entry) => entry.id === 'DEC-001').runtime_id, 'local-gpt-5.5');
    assert.equal(ledger.find((entry) => entry.id === 'DEC-002').runtime_id, 'local-opus-4.6');

    const followupAssign = assignGovernedTurn(root, config, 'dev');
    assert.equal(followupAssign.ok, true, followupAssign.error);
    const ctx = getContextMd(root, config);

    assert.match(ctx, /## Last Accepted Turn[\s\S]*- \*\*Role:\*\* qa[\s\S]*- \*\*Runtime:\*\* local-opus-4\.6/);
    assert.match(ctx, /- \*\*Objections:\*\*[\s\S]*OBJ-001 \(low\): Dev evidence should remain visible to the next implementer\./);
    assert.ok(ctx.includes('| DEC-001 | implementation | dev | local-gpt-5.5 | Dev implementation is ready for QA challenge. |'));
    assert.ok(ctx.includes('| DEC-002 | qa | qa | local-opus-4.6 | QA challenge is substantive and attributable to a different runtime. |'));
  });

  it('accepts eng_director escalation turns through the governed persistence pipeline', () => {
    initializeGovernedRun(root, config);

    const initialState = readJson(root, STATE_PATH);
    initialState.phase = 'implementation';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(initialState, null, 2));

    const devAssign = assignGovernedTurn(root, config, 'dev');
    assert.equal(devAssign.ok, true, devAssign.error);
    const devState = readJson(root, STATE_PATH);
    writeFileSync(join(root, 'deadlock-resolution.js'), 'export const escalationRequested = true;\n');
    writeStagedResult(root, devState, {
      summary: 'Identified a tactical deadlock and routed to engineering director.',
      decisions: [{
        id: 'DEC-001',
        category: 'process',
        statement: 'Escalate the deadlock to engineering director.',
        rationale: 'The implementation turn needs a binding technical decision before QA.',
      }],
      files_changed: ['deadlock-resolution.js'],
      artifact: { type: 'workspace', ref: 'git:dirty' },
      proposed_next_role: 'eng_director',
    });
    const devAccept = acceptGovernedTurn(root, config);
    assert.equal(devAccept.ok, true, devAccept.error);
    assert.equal(devAccept.state.next_recommended_role, 'eng_director');

    const directorAssign = assignGovernedTurn(root, config, 'eng_director');
    assert.equal(directorAssign.ok, true, directorAssign.error);
    const directorState = readJson(root, STATE_PATH);
    writeFileSync(join(root, 'director-decision.js'), 'export const escalationResolved = true;\n');
    writeStagedResult(root, directorState, {
      summary: 'Resolved the deadlock with a binding implementation direction.',
      decisions: [{
        id: 'DEC-002',
        category: 'architecture',
        statement: 'Use the role-agnostic acceptance path for escalation roles.',
        rationale: 'Director turns must persist the same evidence surfaces as PM, Dev, and QA turns.',
      }],
      objections: [{
        id: 'OBJ-001',
        severity: 'medium',
        statement: 'Do not mark escalation coverage complete unless director runtime evidence is persisted.',
        status: 'raised',
      }],
      files_changed: ['director-decision.js'],
      artifact: { type: 'workspace', ref: 'git:dirty' },
      proposed_next_role: 'qa',
    });
    const directorAccept = acceptGovernedTurn(root, config);
    assert.equal(directorAccept.ok, true, directorAccept.error);

    const history = readJsonl(root, '.agentxchain/history.jsonl');
    const directorHistory = history.at(-1);
    assert.equal(directorHistory.role, 'eng_director');
    assert.equal(directorHistory.runtime_id, 'local-gpt-5.5');
    assert.deepEqual(directorHistory.objections, [{
      id: 'OBJ-001',
      severity: 'medium',
      statement: 'Do not mark escalation coverage complete unless director runtime evidence is persisted.',
      status: 'raised',
    }]);

    const ledger = readJsonl(root, '.agentxchain/decision-ledger.jsonl');
    assert.equal(ledger.find((entry) => entry.id === 'DEC-001').runtime_id, 'local-gpt-5.5');
    const directorDecision = ledger.find((entry) => entry.id === 'DEC-002');
    assert.equal(directorDecision.role, 'eng_director');
    assert.equal(directorDecision.runtime_id, 'local-gpt-5.5');

    const qaAssign = assignGovernedTurn(root, config, 'qa');
    assert.equal(qaAssign.ok, true, qaAssign.error);
    const ctx = getContextMd(root, config);

    assert.match(ctx, /## Last Accepted Turn[\s\S]*- \*\*Role:\*\* eng_director[\s\S]*- \*\*Runtime:\*\* local-gpt-5\.5/);
    assert.match(ctx, /- \*\*Objections:\*\*[\s\S]*OBJ-001 \(medium\): Do not mark escalation coverage complete unless director runtime evidence is persisted\./);
    assert.ok(ctx.includes('| DEC-001 | implementation | dev | local-gpt-5.5 | Escalate the deadlock to engineering director. |'));
    assert.ok(ctx.includes('| DEC-002 | implementation | eng_director | local-gpt-5.5 | Use the role-agnostic acceptance path for escalation roles. |'));
  });

  it('section appears between Last Accepted Turn and Blockers', () => {
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');

    writeLedgerEntries(root, [
      { id: 'DEC-POS', turn_id: 'turn_1', role: 'dev', phase: 'implementation', statement: 'Position test', status: 'accepted', created_at: '2026-04-01T00:00:00Z' },
    ]);

    const ctx = getContextMd(root, config);

    const stateIdx = ctx.indexOf('## Current State');
    const histIdx = ctx.indexOf('## Decision History');
    assert.ok(stateIdx >= 0, 'Current State should exist');
    assert.ok(histIdx >= 0, 'Decision History should exist');
    assert.ok(stateIdx < histIdx, 'Decision History should come after Current State');

    // If there's a Blockers section, Decision History should be before it
    const blockerIdx = ctx.indexOf('## Blockers');
    if (blockerIdx >= 0) {
      assert.ok(histIdx < blockerIdx, 'Decision History should come before Blockers');
    }
  });
});
