/**
 * Phase Transition Event Observability Tests
 *
 * Validates that phase transitions (automatic, auto-approved, gate failures)
 * emit events to events.jsonl so operators can observe them via
 * `agentxchain events` without digging into state.json or decision-ledger.jsonl.
 *
 * DEC-PHASE-EVENT-001 through DEC-PHASE-EVENT-003
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  getActiveTurn,
  normalizeGovernedStateShape,
} from '../src/lib/governed-state.js';
import { scaffoldGoverned } from '../src/commands/init.js';
import { readRunEvents, VALID_RUN_EVENTS } from '../src/lib/run-events.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-phase-evt-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(root, relPath) {
  return JSON.parse(readFileSync(join(root, relPath), 'utf8'));
}

/**
 * Config with two phases: planning → implementation.
 * No gate requirements — phase advances automatically when requested.
 */
function makeAutoAdvanceConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'test-phase-events', name: 'Phase Event Test', default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'Plan', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-pm' },
      dev: { title: 'Developer', mandate: 'Build', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-dev' },
    },
    runtimes: { 'local-pm': { type: 'local_cli' }, 'local-dev': { type: 'local_cli' } },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'human'], exit_gate: 'implementation_complete' },
    },
    gates: {
      planning_signoff: {},
      implementation_complete: {},
    },
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    rules: { challenge_required: false, max_turn_retries: 2, max_deadlock_cycles: 2 },
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
    compat: { next_owner_source: 'state-json', lock_based_coordination: false, original_version: 4 },
  };
}

/**
 * Config with gate that requires file verification — will fail when file is absent.
 */
function makeGateFailConfig() {
  return {
    ...makeAutoAdvanceConfig(),
    gates: {
      planning_signoff: {
        requires_files: ['SPEC.md'],
      },
      implementation_complete: {},
    },
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
    summary: 'Phase event test turn.',
    decisions: [],
    objections: [],
    files_changed: [],
    artifacts_created: [],
    verification: { status: 'pass', commands: ['echo ok'], evidence_summary: 'OK', machine_evidence: [{ command: 'echo ok', exit_code: 0 }] },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'dev',
    phase_transition_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 100, output_tokens: 50, usd: 0.01 },
    ...overrides,
  };
}

function stageTurnResult(dir, state, overrides = {}) {
  const result = makeTurnResult(state, overrides);
  const stagingPath = join(dir, '.agentxchain', 'staging', 'turn-result.json');
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  writeFileSync(stagingPath, JSON.stringify(result, null, 2));
  return result;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Phase Transition Event Observability', () => {
  let dir;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('gate_failed is a valid event type', () => {
    assert.ok(VALID_RUN_EVENTS.includes('gate_failed'), 'gate_failed must be in VALID_RUN_EVENTS');
  });

  it('automatic phase advance emits phase_entered with trigger=auto', () => {
    const config = makeAutoAdvanceConfig();
    scaffoldGoverned(dir, 'Phase Event Test', 'test-phase-events');
    initializeGovernedRun(dir, config);

    // Assign and accept a turn with phase_transition_request
    const assignResult = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assignResult.ok);

    stageTurnResult(dir, assignResult.state, {
      phase_transition_request: 'implementation',
    });

    const acceptResult = acceptGovernedTurn(dir, config);
    assert.ok(acceptResult.ok);

    // Read events and find phase_entered
    const events = readRunEvents(dir);
    const phaseEvents = events.filter(e => e.event_type === 'phase_entered');
    assert.ok(phaseEvents.length >= 1, `Expected at least 1 phase_entered event, got ${phaseEvents.length}`);

    const evt = phaseEvents[phaseEvents.length - 1];
    assert.equal(evt.payload.from, 'planning');
    assert.equal(evt.payload.to, 'implementation');
    assert.equal(evt.payload.trigger, 'auto');
    assert.ok(evt.payload.gate_id, 'gate_id must be present');
    assert.equal(evt.phase, 'implementation', 'event phase should be the new phase');
  });

  it('gate failure emits gate_failed with reasons and gate_id', () => {
    const config = makeGateFailConfig();
    scaffoldGoverned(dir, 'Phase Event Test', 'test-phase-events');
    initializeGovernedRun(dir, config);

    // Assign and accept a turn requesting transition without the required file
    const assignResult = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assignResult.ok);

    stageTurnResult(dir, assignResult.state, {
      phase_transition_request: 'implementation',
    });

    const acceptResult = acceptGovernedTurn(dir, config);
    assert.ok(acceptResult.ok);

    // Read events and find gate_failed
    const events = readRunEvents(dir);
    const gateFailedEvents = events.filter(e => e.event_type === 'gate_failed');
    assert.ok(gateFailedEvents.length >= 1, `Expected at least 1 gate_failed event, got ${gateFailedEvents.length}`);

    const evt = gateFailedEvents[gateFailedEvents.length - 1];
    assert.ok(evt.payload.gate_id, 'gate_id must be present');
    assert.equal(evt.payload.from_phase, 'planning');
    assert.ok(Array.isArray(evt.payload.reasons), 'reasons must be an array');
    // Phase should still be planning since gate failed
    assert.equal(evt.phase, 'planning');
  });

  it('phase_entered payload includes gate_id for all trigger types', () => {
    const config = makeAutoAdvanceConfig();
    scaffoldGoverned(dir, 'Phase Event Test', 'test-phase-events');
    initializeGovernedRun(dir, config);

    const assignResult = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assignResult.ok);

    stageTurnResult(dir, assignResult.state, {
      phase_transition_request: 'implementation',
    });

    acceptGovernedTurn(dir, config);

    const events = readRunEvents(dir);
    const phaseEvents = events.filter(e => e.event_type === 'phase_entered');

    for (const evt of phaseEvents) {
      assert.ok(evt.payload.gate_id, `phase_entered event missing gate_id: ${JSON.stringify(evt.payload)}`);
      assert.ok(evt.payload.trigger, `phase_entered event missing trigger: ${JSON.stringify(evt.payload)}`);
      assert.ok(evt.payload.from, `phase_entered event missing from: ${JSON.stringify(evt.payload)}`);
      assert.ok(evt.payload.to, `phase_entered event missing to: ${JSON.stringify(evt.payload)}`);
    }
  });

  it('no phase_entered event when no phase transition occurs', () => {
    const config = makeAutoAdvanceConfig();
    scaffoldGoverned(dir, 'Phase Event Test', 'test-phase-events');
    initializeGovernedRun(dir, config);

    const assignResult = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assignResult.ok);

    // Accept without requesting phase transition
    stageTurnResult(dir, assignResult.state, {
      phase_transition_request: null,
    });

    acceptGovernedTurn(dir, config);

    const events = readRunEvents(dir);
    const phaseEvents = events.filter(e => e.event_type === 'phase_entered');
    assert.equal(phaseEvents.length, 0, 'No phase_entered event should be emitted without a transition');
  });
});
