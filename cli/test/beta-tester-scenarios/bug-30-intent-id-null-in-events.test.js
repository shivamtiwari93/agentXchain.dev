/**
 * BUG-30 beta-tester scenario: intent_id still null in events.jsonl
 * (REOPEN of BUG-21)
 *
 * Tester sequence:
 *   1. Inject intent → approve
 *   2. PM turn addresses intent
 *   3. Accept PM turn
 *   4. events.jsonl shows intent_id: null for turn_dispatched
 *
 * Root cause of false closure: BUG-21 fixed restart.js to call
 * consumeNextApprovedIntent. But the regression test didn't check events.jsonl.
 *
 * This test verifies that when a turn is assigned with intakeContext (the way
 * consumeNextApprovedIntent / startIntent works), ALL lifecycle events contain
 * the correct intent_id — not null.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  normalizeGovernedStateShape,
  transitionActiveTurnLifecycle,
} from '../../src/lib/governed-state.js';
import { writeDispatchBundle } from '../../src/lib/dispatch-bundle.js';
import { finalizeDispatchManifest } from '../../src/lib/dispatch-manifest.js';

const tempDirs = [];

function createProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug30-'));
  tempDirs.push(root);

  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'intake', 'intents'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });

  const config = {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug30-test', name: 'BUG-30 Test', default_branch: 'main' },
    roles: {
      pm: {
        title: 'PM',
        mandate: 'Plan the project.',
        write_authority: 'review_only',
        runtime: 'manual-pm',
      },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
    },
    routing: {
      planning: {
        entry_role: 'pm',
        allowed_next_roles: ['pm'],
      },
    },
    gates: {},
  };

  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));

  execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', {
    cwd: root, stdio: 'ignore',
  });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });

  return { root, config };
}

function readState(root) {
  const raw = JSON.parse(readFileSync(join(root, '.agentxchain/state.json'), 'utf8'));
  return normalizeGovernedStateShape(raw).state;
}

function readEvents(root) {
  const eventsPath = join(root, '.agentxchain', 'events.jsonl');
  try {
    return readFileSync(eventsPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

function createExecutingIntent(root, intentId, charter) {
  const intentPath = join(root, '.agentxchain', 'intake', 'intents', `${intentId}.json`);
  writeFileSync(intentPath, JSON.stringify({
    intent_id: intentId,
    type: 'planning_revision',
    priority: 'p0',
    status: 'executing',
    charter,
    acceptance_contract: [
      `Address: ${charter}`,
    ],
    source: 'operator',
    created_at: new Date().toISOString(),
    approved_at: new Date().toISOString(),
    history: [
      { from: 'needs_triage', to: 'approved', at: new Date().toISOString(), by: 'operator' },
      { from: 'approved', to: 'executing', at: new Date().toISOString(), by: 'system' },
    ],
  }, null, 2));
}

afterEach(() => {
  while (tempDirs.length > 0) {
    try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {}
  }
});

describe('BUG-30 beta-tester scenario: intent_id in events.jsonl', () => {
  it('turn_dispatched and turn_accepted events contain intent_id when intake_context is bound', () => {
    const { root, config } = createProject();

    // 1. Initialize run
    const initResult = initializeGovernedRun(root, config);
    assert.ok(initResult.ok, `Init failed: ${initResult.error}`);

    // 2. Create an intent in executing state
    const intentId = `intent_bug30_${Date.now()}`;
    createExecutingIntent(root, intentId, 'Add logging to all API endpoints');

    // 3. Assign a PM turn with intakeContext (same as what consumeNextApprovedIntent does)
    const assignResult = assignGovernedTurn(root, config, 'pm', {
      intakeContext: {
        intent_id: intentId,
        charter: 'Add logging to all API endpoints',
        acceptance_contract: [
          'Add logging to all API endpoints',
        ],
      },
    });
    assert.ok(assignResult.ok, `Assign failed: ${assignResult.error}`);

    const turnId = assignResult.turn.turn_id;

    // 4. Drive the real dispatch lifecycle: write bundle, finalize manifest,
    // then transition to dispatched (which emits turn_dispatched).
    const state = readState(root);
    const bundleResult = writeDispatchBundle(root, state, config, { turnId });
    assert.ok(bundleResult.ok, `Bundle failed: ${bundleResult.error}`);
    const manifestResult = finalizeDispatchManifest(root, turnId, {
      run_id: state.run_id,
      role: 'pm',
    });
    assert.ok(manifestResult.ok, `Manifest failed: ${manifestResult.error}`);
    const dispatched = transitionActiveTurnLifecycle(root, turnId, 'dispatched');
    assert.ok(dispatched.ok, `Dispatch transition failed: ${dispatched.error}`);

    // 5. KEY ASSERTION: turn_dispatched event must have intent_id
    const eventsAfterDispatch = readEvents(root);
    const dispatchEvent = eventsAfterDispatch.find(
      e => e.event_type === 'turn_dispatched',
    );
    assert.ok(dispatchEvent, 'Should have a turn_dispatched event');
    assert.strictEqual(
      dispatchEvent.intent_id,
      intentId,
      `turn_dispatched event must have intent_id=${intentId}. Got: ${dispatchEvent.intent_id}`,
    );

    // 6. Stage and accept the turn
    const turnResultPath = join(root, '.agentxchain', 'staging', 'turn-result.json');
    writeFileSync(turnResultPath, JSON.stringify({
      schema_version: '1.0',
      run_id: state.run_id,
      turn_id: turnId,
      role: 'pm',
      runtime_id: 'manual-pm',
      status: 'completed',
      summary: 'Added logging to all API endpoints.',
      decisions: [],
      objections: [{ id: 'OBJ-1', target: 'process', statement: 'Event provenance review', severity: 'low' }],
      files_changed: [],
      verification: { status: 'skipped' },
      artifact: { type: 'review', ref: null },
      proposed_next_role: 'pm',
      intent_response: [
        { item: 'Add logging to all API endpoints', status: 'addressed' },
      ],
    }, null, 2));

    const acceptResult = acceptGovernedTurn(root, config, {
      turnId,
      resultPath: turnResultPath,
    });
    assert.ok(acceptResult.ok, `Accept failed: ${acceptResult.error}`);

    // 7. KEY ASSERTION: turn_accepted event must have intent_id
    const allEvents = readEvents(root);
    const acceptedEvent = allEvents.find(e => e.event_type === 'turn_accepted');
    assert.ok(acceptedEvent, 'Should have a turn_accepted event');
    assert.strictEqual(
      acceptedEvent.intent_id,
      intentId,
      `turn_accepted event must have intent_id=${intentId}. Got: ${acceptedEvent.intent_id}`,
    );

    // 8. No event for this intent-bound turn should have intent_id: null
    const turnEvents = allEvents.filter(e =>
      e.intent_id !== undefined && (
        e.event_type === 'turn_dispatched' ||
        e.event_type === 'turn_accepted' ||
        e.event_type === 'intent_satisfied'
      ),
    );
    for (const event of turnEvents) {
      assert.notStrictEqual(
        event.intent_id,
        null,
        `Event ${event.event_type} must not have intent_id: null`,
      );
    }
  });
});
