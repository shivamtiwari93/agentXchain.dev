import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, appendFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import { writeDispatchBundle } from '../src/lib/dispatch-bundle.js';
import {
  initializeGovernedRun,
  assignGovernedTurn,
  normalizeGovernedStateShape,
  getActiveTurn,
  STATE_PATH,
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

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'test-dh', name: 'Test DH', default_branch: 'main' },
    roles: {
      pm: { title: 'Product Manager', mandate: 'Protect user value.', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-pm' },
      dev: { title: 'Developer', mandate: 'Build.', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-dev' },
    },
    runtimes: { 'manual-pm': { type: 'manual' }, 'local-dev': { type: 'local_cli' } },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev'], exit_gate: 'planning_done' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev'], exit_gate: 'impl_done' },
    },
    gates: {
      planning_done: { requires_human_approval: true },
      impl_done: { requires_verification_pass: true },
    },
    workflow: { phases: ['planning', 'implementation'] },
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
