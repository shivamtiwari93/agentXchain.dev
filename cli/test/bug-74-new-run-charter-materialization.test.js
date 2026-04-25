/**
 * BUG-74: charter_materialization_pending not set when a new run starts
 * from an idle-expansion intake intent.
 *
 * When the continuous loop starts a NEW run from an already-approved
 * idle-expansion intent (category: "pm_idle_expansion_derived"), the
 * initial state must have charter_materialization_pending set so the
 * first PM turn receives the "You MUST create or update these planning
 * artifacts" directive.
 *
 * Spec: .planning/BUG_74_NEW_RUN_CHARTER_MATERIALIZATION_SPEC.md
 */

import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
import { loadProjectContext } from '../src/lib/config.js';
import { writeDispatchBundle } from '../src/lib/dispatch-bundle.js';
import { readRunEvents } from '../src/lib/run-events.js';

function readJson(root, relPath) {
  return JSON.parse(readFileSync(join(root, relPath), 'utf8'));
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
    projectName: 'BUG-74 Test',
  });
  assert.equal(plan.ok, true, `planIntent must succeed: ${plan.error}`);

  return { intentId, eventId: record.event.event_id, charter, acceptanceContract };
}

describe('BUG-74: new run from idle-expansion intent sets charter_materialization_pending', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'axc-bug74-'));
    scaffoldGoverned(root, 'BUG-74 Test', `bug74-test-${Date.now()}`);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('AC-1: startIntent from pm_idle_expansion_derived intent sets charter_materialization_pending on initial state', () => {
    const { intentId, charter, acceptanceContract } = prepareIdleExpansionDerivedIntent(root);

    const result = startIntent(root, intentId);
    assert.equal(result.ok, true, result.error || 'startIntent must succeed');

    const state = readJson(root, '.agentxchain/state.json');

    // charter_materialization_pending must be set (not null/false/undefined)
    assert.ok(state.charter_materialization_pending,
      'charter_materialization_pending must be truthy on initial state');
    assert.equal(typeof state.charter_materialization_pending, 'object',
      'charter_materialization_pending must be an object');

    // Verify the charter text is carried through
    assert.equal(state.charter_materialization_pending.charter, `[pm-derived] ${charter}`,
      'charter text must match the intent charter');

    // Verify acceptance_contract is carried through
    assert.deepEqual(state.charter_materialization_pending.acceptance_contract, acceptanceContract,
      'acceptance_contract must match the intent acceptance_contract');

    // Verify suppressed_transition
    assert.equal(state.charter_materialization_pending.suppressed_transition, 'implementation',
      'suppressed_transition must be "implementation"');
  });

  it('AC-2: first PM dispatch bundle includes materialization directive', () => {
    const { intentId } = prepareIdleExpansionDerivedIntent(root);

    const result = startIntent(root, intentId);
    assert.equal(result.ok, true, result.error || 'startIntent must succeed');

    const state = readJson(root, '.agentxchain/state.json');
    const { config } = loadProjectContext(root);

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
    assert.match(prompt, /SYSTEM_SPEC\.md/,
      'PROMPT.md must reference SYSTEM_SPEC.md');
    assert.match(prompt, /ROADMAP\.md/,
      'PROMPT.md must reference ROADMAP.md');
    assert.match(prompt, /PM_SIGNOFF\.md/,
      'PROMPT.md must reference PM_SIGNOFF.md');
    assert.match(prompt, /M29.*Auth Scheme/,
      'PROMPT.md must include the charter text');
  });

  it('AC-3: charter_materialization_required event is emitted during run initialization', () => {
    const { intentId } = prepareIdleExpansionDerivedIntent(root);

    const result = startIntent(root, intentId);
    assert.equal(result.ok, true, result.error || 'startIntent must succeed');

    const events = readRunEvents(root);
    const materializationEvents = events.filter(e => e.event_type === 'charter_materialization_required');

    assert.ok(materializationEvents.length > 0,
      'must emit charter_materialization_required event');
    assert.equal(materializationEvents[0].payload.source, 'run_initialization',
      'event source must be run_initialization');
    assert.equal(materializationEvents[0].payload.suppressed_transition, 'implementation',
      'event must indicate suppressed implementation transition');
  });

  it('AC-4: non-idle-expansion intent does NOT set charter_materialization_pending', () => {
    // Record a normal manual intent (not idle-expansion-derived)
    const record = recordEvent(root, {
      source: 'manual',
      signal: { description: 'Normal manual work item' },
      evidence: [{ type: 'text', value: 'manual signal' }],
    });
    assert.equal(record.ok, true, `recordEvent must succeed: ${record.error}`);
    const intentId = record.intent.intent_id;

    const triage = triageIntent(root, intentId, {
      priority: 'p1',
      template: 'generic',
      charter: 'Normal work — not from idle expansion',
      acceptance_contract: ['Tests pass'],
    });
    assert.equal(triage.ok, true, `triageIntent must succeed: ${triage.error}`);

    const approve = approveIntent(root, intentId, {
      approver: 'test-operator',
      reason: 'normal approval',
    });
    assert.equal(approve.ok, true, `approveIntent must succeed: ${approve.error}`);

    const plan = planIntent(root, intentId, { projectName: 'BUG-74 Test' });
    assert.equal(plan.ok, true, `planIntent must succeed: ${plan.error}`);

    const result = startIntent(root, intentId);
    assert.equal(result.ok, true, result.error || 'startIntent must succeed');

    const state = readJson(root, '.agentxchain/state.json');

    // charter_materialization_pending must NOT be set
    assert.equal(state.charter_materialization_pending, undefined,
      'charter_materialization_pending must not be set for non-idle-expansion intents');
  });
});
