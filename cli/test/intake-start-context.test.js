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
import { assignGovernedTurn, initializeGovernedRun } from '../src/lib/governed-state.js';
import { loadProjectContext } from '../src/lib/config.js';
import { writeDispatchBundle } from '../src/lib/dispatch-bundle.js';

function readJson(root, relPath) {
  return JSON.parse(readFileSync(join(root, relPath), 'utf8'));
}

function preparePlannedIntent(root, overrides = {}) {
  const record = recordEvent(root, {
    source: overrides.source || 'manual',
    signal: overrides.signal || { description: 'start intake with truthful context' },
    evidence: overrides.evidence || [{ type: 'text', value: 'operator-reported work item' }],
  });
  assert.equal(record.ok, true, 'recordEvent must succeed');

  const intentId = record.intent.intent_id;
  const triage = triageIntent(root, intentId, {
    priority: 'p1',
    template: 'cli-tool',
    charter: overrides.charter || 'Ship truthful intake context into the governed turn bundle',
    acceptance_contract: overrides.acceptanceContract || [
      'dispatch bundle shows the intake charter',
      'run provenance identifies the intake trigger',
    ],
  });
  assert.equal(triage.ok, true, 'triageIntent must succeed');

  const approve = approveIntent(root, intentId, {
    approver: 'test-operator',
    reason: 'context continuity proof',
  });
  assert.equal(approve.ok, true, 'approveIntent must succeed');

  const plan = planIntent(root, intentId, {
    projectName: 'Intake Start Context Test',
  });
  assert.equal(plan.ok, true, 'planIntent must succeed');

  return { intentId, eventId: record.event.event_id };
}

describe('intake start context bridge', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'axc-intake-start-context-'));
    scaffoldGoverned(root, 'Intake Start Context Test', `intake-start-context-${Date.now()}`);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('AT-ISC-001 + AT-ISC-002 + AT-ISC-003: intake start records intake provenance and renders intake context into the first dispatch bundle', () => {
    const { intentId, eventId } = preparePlannedIntent(root);

    const result = startIntent(root, intentId);
    assert.equal(result.ok, true, result.error || 'startIntent must succeed');

    const state = readJson(root, '.agentxchain/state.json');
    assert.equal(state.provenance.trigger, 'intake');
    assert.equal(state.provenance.intake_intent_id, intentId);
    assert.equal(state.provenance.trigger_reason, 'Ship truthful intake context into the governed turn bundle');

    const assignment = readJson(root, join(result.dispatch_dir, 'ASSIGNMENT.json'));
    assert.deepEqual(assignment.intake_context, {
      intent_id: intentId,
      event_id: eventId,
      source: 'manual',
      category: 'manual_signal',
      charter: 'Ship truthful intake context into the governed turn bundle',
      acceptance_contract: [
        'dispatch bundle shows the intake charter',
        'run provenance identifies the intake trigger',
      ],
    });

    const context = readFileSync(join(root, result.dispatch_dir, 'CONTEXT.md'), 'utf8');
    assert.match(context, /## Intake Intent/);
    assert.match(context, new RegExp(`Intent:\\*\\* ${intentId}`));
    assert.match(context, /Source:\*\* manual/);
    assert.match(context, /Category:\*\* manual_signal/);
    assert.match(context, /Charter:\*\* Ship truthful intake context into the governed turn bundle/);
    assert.match(context, /Acceptance Contract:\*\*/);
    assert.match(context, /dispatch bundle shows the intake charter/);
    assert.match(context, /run provenance identifies the intake trigger/);
  });

  it('AT-ISC-004: non-intake dispatch bundles omit the intake section', () => {
    const { config } = loadProjectContext(root);
    const initResult = initializeGovernedRun(root, config);
    assert.equal(initResult.ok, true, initResult.error || 'initializeGovernedRun must succeed');

    const assignResult = assignGovernedTurn(root, config, 'pm');
    assert.equal(assignResult.ok, true, assignResult.error || 'assignGovernedTurn must succeed');

    const bundle = writeDispatchBundle(root, assignResult.state, config);
    assert.equal(bundle.ok, true, bundle.error || 'writeDispatchBundle must succeed');
    const context = readFileSync(
      join(root, `.agentxchain/dispatch/turns/${assignResult.turn.turn_id}/CONTEXT.md`),
      'utf8',
    );
    assert.doesNotMatch(context, /## Intake Intent/);
  });

  it('AT-ISC-005: intake start preserves existing run provenance when reusing an already-active run', () => {
    const { config } = loadProjectContext(root);
    const initResult = initializeGovernedRun(root, config, {
      provenance: {
        trigger: 'schedule',
        trigger_reason: 'schedule:nightly_governed_run',
        created_by: 'operator',
      },
    });
    assert.equal(initResult.ok, true, initResult.error || 'initializeGovernedRun must succeed');

    const { intentId } = preparePlannedIntent(root, {
      charter: 'Reuse the current run but still preserve intake context on the new turn',
      acceptanceContract: ['existing run provenance stays schedule', 'dispatch bundle still shows the intake charter'],
    });

    const result = startIntent(root, intentId);
    assert.equal(result.ok, true, result.error || 'startIntent must succeed');

    const state = readJson(root, '.agentxchain/state.json');
    assert.equal(state.provenance.trigger, 'schedule');
    assert.equal(state.provenance.intake_intent_id, null);
    assert.equal(state.provenance.trigger_reason, 'schedule:nightly_governed_run');

    const assignment = readJson(root, join(result.dispatch_dir, 'ASSIGNMENT.json'));
    assert.equal(assignment.intake_context.intent_id, intentId);
    assert.equal(
      assignment.intake_context.charter,
      'Reuse the current run but still preserve intake context on the new turn',
    );
  });
});
