/**
 * BUG-75: Stale idle-expansion runs created before BUG-74 do not recover
 * after upgrading to agentxchain@2.155.21.
 *
 * Runs initialized from pm_idle_expansion_derived before v2.155.21 lack
 * charter_materialization_pending. When PM is reissued/resumed, the dispatch
 * prompt never receives the materialization directive, PM makes zero edits,
 * and semantic coverage gate fails in a loop.
 *
 * The fix detects this stale state on load and reconstructs
 * charter_materialization_pending from the intake event/intent.
 *
 * Spec: .planning/BUG_75_STALE_IDLE_EXPANSION_RUN_RECOVERY_SPEC.md
 */

import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { scaffoldGoverned } from '../src/commands/init.js';
import {
  approveIntent,
  planIntent,
  recordEvent,
  startIntent,
  triageIntent,
} from '../src/lib/intake.js';
import { loadProjectContext, loadProjectState } from '../src/lib/config.js';
import { writeDispatchBundle } from '../src/lib/dispatch-bundle.js';
import { readRunEvents } from '../src/lib/run-events.js';

function readJson(root, relPath) {
  return JSON.parse(readFileSync(join(root, relPath), 'utf8'));
}

function writeJson(root, relPath, data) {
  writeFileSync(join(root, relPath), JSON.stringify(data, null, 2));
}

/**
 * Creates a planned+approved idle-expansion-derived intent, matching the
 * flow from continuous-run.js:ingestIdleExpansionResult().
 */
function prepareIdleExpansionDerivedIntent(root, overrides = {}) {
  const charter = overrides.charter || 'M29: Auth Scheme Classification';
  const acceptanceContract = overrides.acceptanceContract || [
    'classifyAuthScheme() produces bearer for jwt middleware',
    'classifyAuthScheme() produces unknown for zero-evidence',
    'eval-regression test covers all auth scheme rules',
  ];

  const record = recordEvent(root, {
    source: 'vision_scan',
    category: 'pm_idle_expansion_derived',
    signal: {
      description: charter,
      derived: true,
      expansion_iteration: 2,
    },
    evidence: [{ type: 'text', value: `PM idle-expansion #2 derived: ${charter}` }],
  });
  assert.equal(record.ok, true, `recordEvent must succeed: ${record.error}`);
  const intentId = record.intent.intent_id;

  const triage = triageIntent(root, intentId, {
    priority: 'p2',
    template: 'generic',
    charter: `[pm-derived] ${charter}`,
    acceptance_contract: acceptanceContract,
  });
  assert.equal(triage.ok, true, `triageIntent must succeed: ${triage.error}`);

  const approve = approveIntent(root, intentId, {
    approver: 'idle_expansion_ingestion',
    reason: 'PM idle-expansion #2 derived intent',
  });
  assert.equal(approve.ok, true, `approveIntent must succeed: ${approve.error}`);

  const plan = planIntent(root, intentId, {
    projectName: 'BUG-75 Test',
  });
  assert.equal(plan.ok, true, `planIntent must succeed: ${plan.error}`);

  return { intentId, eventId: record.event.event_id, charter, acceptanceContract };
}

/**
 * Simulate a pre-BUG-74 stale run: start the intent (which sets
 * charter_materialization_pending via BUG-74 fix), then strip the flag
 * from state.json to mimic a run created before v2.155.21.
 */
function createStalePreBug74Run(root, overrides = {}) {
  const prep = prepareIdleExpansionDerivedIntent(root, overrides);
  const result = startIntent(root, prep.intentId);
  assert.equal(result.ok, true, result.error || 'startIntent must succeed');

  // Strip charter_materialization_pending to simulate pre-BUG-74 state
  const state = readJson(root, '.agentxchain/state.json');
  assert.ok(state.charter_materialization_pending,
    'BUG-74 fix must have set charter_materialization_pending');
  delete state.charter_materialization_pending;
  writeJson(root, '.agentxchain/state.json', state);

  // Clear the BUG-74 run-initialization event so the recovery event is distinguishable
  const eventsPath = join(root, '.agentxchain/events.jsonl');
  if (existsSync(eventsPath)) {
    const events = readFileSync(eventsPath, 'utf8')
      .split('\n')
      .filter(line => {
        if (!line.trim()) return false;
        try {
          const e = JSON.parse(line);
          return e.event_type !== 'charter_materialization_required';
        } catch {
          return true;
        }
      })
      .join('\n');
    writeFileSync(eventsPath, events + '\n');
  }

  return { ...prep, runId: state.run_id };
}

describe('BUG-75: stale idle-expansion run recovery on state load', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'axc-bug75-'));
    scaffoldGoverned(root, 'BUG-75 Test', `bug75-test-${Date.now()}`);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('AT-BUG75-001: loadProjectState recovers charter_materialization_pending for stale idle-expansion run', () => {
    const { charter, acceptanceContract } = createStalePreBug74Run(root);

    // Confirm state on disk has no charter_materialization_pending
    const rawState = readJson(root, '.agentxchain/state.json');
    assert.equal(rawState.charter_materialization_pending, undefined,
      'pre-recovery state must not have charter_materialization_pending');

    // Load state through loadProjectState — recovery should fire
    const { config } = loadProjectContext(root);
    const state = loadProjectState(root, config);
    assert.ok(state, 'loadProjectState must return state');

    // charter_materialization_pending must be recovered
    assert.ok(state.charter_materialization_pending,
      'charter_materialization_pending must be recovered');
    assert.equal(typeof state.charter_materialization_pending, 'object');
    assert.equal(state.charter_materialization_pending.charter, `[pm-derived] ${charter}`,
      'recovered charter must match intent charter');
    assert.deepEqual(state.charter_materialization_pending.acceptance_contract, acceptanceContract,
      'recovered acceptance_contract must match intent');
    assert.equal(state.charter_materialization_pending.suppressed_transition, 'implementation');

    // State must be persisted back to disk
    const persistedState = readJson(root, '.agentxchain/state.json');
    assert.ok(persistedState.charter_materialization_pending,
      'charter_materialization_pending must be persisted to disk');
  });

  it('AT-BUG75-001b: recovery emits charter_materialization_required with recovered_missing_flag', () => {
    createStalePreBug74Run(root);

    const { config } = loadProjectContext(root);
    loadProjectState(root, config);

    const events = readRunEvents(root);
    const recoveryEvents = events.filter(e =>
      e.event_type === 'charter_materialization_required'
      && e.payload?.source === 'stale_run_recovery',
    );

    assert.ok(recoveryEvents.length > 0,
      'must emit charter_materialization_required with source: stale_run_recovery');
    assert.equal(recoveryEvents[0].payload.recovered_missing_flag, true,
      'event must have recovered_missing_flag: true');
    assert.equal(recoveryEvents[0].payload.suppressed_transition, 'implementation');
  });

  it('AT-BUG75-002: recovered PM dispatch bundle includes materialization directive', () => {
    createStalePreBug74Run(root);

    const { config } = loadProjectContext(root);
    const state = loadProjectState(root, config);

    // Write the dispatch bundle for the assigned PM turn
    const bundle = writeDispatchBundle(root, state, config);
    assert.equal(bundle.ok, true, bundle.error || 'writeDispatchBundle must succeed');

    // Read PROMPT.md from the dispatch directory
    const turn = Object.values(state.active_turns)[0];
    const promptPath = join(root, `.agentxchain/dispatch/turns/${turn.turn_id}/PROMPT.md`);
    const prompt = readFileSync(promptPath, 'utf8');

    // Must include the charter materialization directive
    assert.match(prompt, /Charter Materialization Required/,
      'PROMPT.md must include charter materialization header');
    assert.match(prompt, /You MUST create or update these planning artifacts/,
      'PROMPT.md must include the materialization directive');
    assert.match(prompt, /SYSTEM_SPEC\.md/);
    assert.match(prompt, /ROADMAP\.md/);
    assert.match(prompt, /PM_SIGNOFF\.md/);
    assert.match(prompt, /M29.*Auth Scheme/,
      'PROMPT.md must include the recovered charter text');
  });

  it('AT-BUG75-005: normal non-idle-expansion planning run is NOT affected by recovery', () => {
    // Record a normal manual intent
    const record = recordEvent(root, {
      source: 'manual',
      signal: { description: 'Normal manual work item' },
      evidence: [{ type: 'text', value: 'manual signal' }],
    });
    assert.equal(record.ok, true);
    const intentId = record.intent.intent_id;

    const triage = triageIntent(root, intentId, {
      priority: 'p1',
      template: 'generic',
      charter: 'Normal work — not idle expansion',
      acceptance_contract: ['Tests pass'],
    });
    assert.equal(triage.ok, true);

    const approve = approveIntent(root, intentId, {
      approver: 'test-operator',
      reason: 'normal approval',
    });
    assert.equal(approve.ok, true);

    const plan = planIntent(root, intentId, { projectName: 'BUG-75 Test' });
    assert.equal(plan.ok, true);

    const result = startIntent(root, intentId);
    assert.equal(result.ok, true);

    // Confirm no charter_materialization_pending was set (normal intent)
    const rawState = readJson(root, '.agentxchain/state.json');
    assert.equal(rawState.charter_materialization_pending, undefined,
      'normal intent must not have charter_materialization_pending');

    // Load through loadProjectState — recovery must NOT fire
    const { config } = loadProjectContext(root);
    const state = loadProjectState(root, config);
    assert.ok(state);
    assert.equal(state.charter_materialization_pending, undefined,
      'recovery must not set charter_materialization_pending for non-idle-expansion runs');

    // No recovery events should exist
    const events = readRunEvents(root);
    const recoveryEvents = events.filter(e =>
      e.event_type === 'charter_materialization_required'
      && e.payload?.source === 'stale_run_recovery',
    );
    assert.equal(recoveryEvents.length, 0,
      'no stale_run_recovery events for normal runs');
  });

  it('AT-BUG75-005b: run already containing charter_materialization_pending is NOT overwritten', () => {
    const { intentId } = prepareIdleExpansionDerivedIntent(root);
    const result = startIntent(root, intentId);
    assert.equal(result.ok, true);

    // State already has charter_materialization_pending from BUG-74 fix
    const rawState = readJson(root, '.agentxchain/state.json');
    assert.ok(rawState.charter_materialization_pending);
    const originalRecordedAt = rawState.charter_materialization_pending.recorded_at;

    // Load through loadProjectState — recovery must NOT fire (flag already present)
    const { config } = loadProjectContext(root);
    const state = loadProjectState(root, config);
    assert.ok(state);
    assert.ok(state.charter_materialization_pending);
    assert.equal(state.charter_materialization_pending.recorded_at, originalRecordedAt,
      'existing charter_materialization_pending must not be overwritten');
  });

  it('AT-BUG75-003: zero-edit PM result on recovered run still fails semantic coverage', () => {
    // This test verifies the acceptance gate is not weakened by recovery.
    // The acceptance gate itself is tested elsewhere; here we confirm
    // that recovery sets the flag correctly so the gate has the data it needs.
    createStalePreBug74Run(root);

    const { config } = loadProjectContext(root);
    const state = loadProjectState(root, config);

    // The recovered state must have the flag so gate_semantic_coverage
    // can detect zero-edit PM transitions against the recovered charter
    assert.ok(state.charter_materialization_pending,
      'recovered state must have charter_materialization_pending for gate evaluation');
    assert.ok(state.charter_materialization_pending.charter,
      'recovered charter must be non-null');
    assert.ok(Array.isArray(state.charter_materialization_pending.acceptance_contract),
      'recovered acceptance_contract must be an array');
    assert.ok(state.charter_materialization_pending.acceptance_contract.length > 0,
      'recovered acceptance_contract must be non-empty');
  });
});
