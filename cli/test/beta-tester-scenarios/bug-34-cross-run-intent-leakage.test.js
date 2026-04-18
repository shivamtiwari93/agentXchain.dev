/**
 * BUG-34 beta-tester scenario: continuous mode must not pick up stale intents
 * from prior runs.
 *
 * Tester sequence:
 *   1. Create governed project, initialize run 1
 *   2. Inject and approve intent in run 1
 *   3. Complete run 1
 *   4. Initialize run 2 (new run_id)
 *   5. Call findNextDispatchableIntent for run 2
 *   6. Verify: run 1's intent is NOT returned as dispatchable
 *   7. Inject new intent in run 2
 *   8. Verify: run 2's intent IS returned as dispatchable
 *
 * This test must FAIL on pre-fix HEAD (confirming the bug) and PASS after the fix.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import {
  initializeGovernedRun,
  acceptGovernedTurn,
  assignGovernedTurn,
  normalizeGovernedStateShape,
} from '../../src/lib/governed-state.js';
import { writeDispatchBundle } from '../../src/lib/dispatch-bundle.js';
import {
  injectIntent,
  findNextDispatchableIntent,
  findPendingApprovedIntents,
} from '../../src/lib/intake.js';

const tempDirs = [];

function makeRawConfig() {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug34-test', name: 'BUG-34 Test', default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'Plan', write_authority: 'review_only', runtime: 'manual-pm' },
    },
    runtimes: { 'manual-pm': { type: 'manual' } },
    routing: { planning: { entry_role: 'pm', allowed_next_roles: ['pm'] } },
    gates: {},
  };
}

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'bug34-test', name: 'BUG-34 Test', default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'Plan', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-pm' },
    },
    runtimes: { 'manual-pm': { type: 'manual' } },
    phases: [{ id: 'planning', name: 'Planning' }],
    routing: { planning: { entry_role: 'pm', allowed_next_roles: ['pm'] } },
    gates: {},
  };
}

function createProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug34-'));
  tempDirs.push(root);
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'intake', 'intents'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(makeRawConfig(), null, 2));
  writeFileSync(join(root, 'README.md'), '# Test\n');
  execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  return root;
}

function readState(root) {
  return normalizeGovernedStateShape(JSON.parse(readFileSync(join(root, '.agentxchain/state.json'), 'utf8'))).state;
}

afterEach(() => {
  while (tempDirs.length > 0) { try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {} }
});

describe('BUG-34: cross-run intent leakage in continuous mode', () => {
  it('findNextDispatchableIntent does not return intents from a prior run', () => {
    const config = makeConfig();
    const root = createProject();

    // 1. Initialize run 1
    initializeGovernedRun(root, config);
    const state1 = readState(root);
    const run1Id = state1.run_id;
    assert.ok(run1Id, 'run 1 should have a run_id');

    // 2. Inject and approve intent in run 1
    const inject1 = injectIntent(root, 'Stale planning intent from run 1', {
      priority: 'p1',
      charter: 'This should not be picked up by run 2',
      acceptance: 'Stale check',
    });
    assert.ok(inject1.ok, `inject1 failed: ${inject1.error}`);
    const staleIntentId = inject1.intent.intent_id;
    assert.equal(inject1.intent.status, 'approved');

    // 3. Verify intent is dispatchable without scoping (baseline confirmation)
    const beforeScope = findNextDispatchableIntent(root);
    assert.ok(beforeScope.ok, 'intent should be dispatchable before run scoping');
    assert.equal(beforeScope.intentId, staleIntentId);

    // 4. Simulate run 1 completion → start run 2
    const stateAfterRun1 = readState(root);
    stateAfterRun1.status = 'idle';
    stateAfterRun1.run_id = null;
    writeFileSync(join(root, '.agentxchain/state.json'), JSON.stringify(stateAfterRun1, null, 2));

    initializeGovernedRun(root, config);
    const state2 = readState(root);
    const run2Id = state2.run_id;
    assert.ok(run2Id, 'run 2 should have a run_id');
    assert.notEqual(run1Id, run2Id, 'run 2 should have a different run_id');

    // 5. BUG-34: with run_id scoping, findNextDispatchableIntent should skip
    //    the stale intent from run 1
    const scopedResult = findNextDispatchableIntent(root, { run_id: run2Id });
    assert.ok(
      !scopedResult.ok || scopedResult.intentId !== staleIntentId,
      `BUG-34: findNextDispatchableIntent returned stale intent ${staleIntentId} from prior run`
    );

    // 6. Inject a new intent in run 2 — this one SHOULD be dispatchable
    const inject2 = injectIntent(root, 'Fresh work for run 2', {
      priority: 'p0',
      charter: 'Fresh intent for current run',
      acceptance: 'Work done',
    });
    assert.ok(inject2.ok, `inject2 failed: ${inject2.error}`);
    const run2IntentId = inject2.intent.intent_id;

    // With run_id scoping, the fresh intent should be returned
    const freshResult = findNextDispatchableIntent(root, { run_id: run2Id });
    assert.ok(freshResult.ok, 'fresh intent should be dispatchable');
    assert.equal(freshResult.intentId, run2IntentId, 'should return the run 2 intent');
  });

  it('findPendingApprovedIntents respects run_id scoping', () => {
    const config = makeConfig();
    const root = createProject();

    // Initialize run 1
    initializeGovernedRun(root, config);
    const state1 = readState(root);
    const run1Id = state1.run_id;

    // Inject intent in run 1 — gets approved_run_id = run1Id
    const inject1 = injectIntent(root, 'Run 1 intent', {
      priority: 'p0',
      charter: 'Run 1 work',
      acceptance: 'Done',
    });
    assert.ok(inject1.ok);

    // Start run 2 — migration archives run 1's intent
    const stateForReset = readState(root);
    stateForReset.status = 'idle';
    stateForReset.run_id = null;
    writeFileSync(join(root, '.agentxchain/state.json'), JSON.stringify(stateForReset, null, 2));
    initializeGovernedRun(root, config);
    const state2 = readState(root);
    const run2Id = state2.run_id;

    // Run 1's intent should already be archived by the migration
    const run1IntentPath = join(root, '.agentxchain', 'intake', 'intents', `${inject1.intent.intent_id}.json`);
    const archivedIntent = JSON.parse(readFileSync(run1IntentPath, 'utf8'));
    assert.equal(archivedIntent.status, 'suppressed', 'run 1 intent should be archived on run 2 init');
    assert.ok(archivedIntent.archived_reason, 'archived intent should have an archival reason');

    // Inject intent in run 2 — gets approved_run_id = run2Id
    const inject2 = injectIntent(root, 'Run 2 intent', {
      priority: 'p0',
      charter: 'Run 2 work',
      acceptance: 'Done',
    });
    assert.ok(inject2.ok);

    // findPendingApprovedIntents without scoping: only run 2's intent
    // (run 1's intent was archived)
    const allPending = findPendingApprovedIntents(root);
    assert.equal(allPending.length, 1, 'only run 2 intent should be approved');
    assert.equal(allPending[0].intent_id, inject2.intent.intent_id);

    // With run_id scoping: still only run 2's intent
    const scopedPending = findPendingApprovedIntents(root, { run_id: run2Id });
    assert.equal(scopedPending.length, 1, 'scoped results should show only run 2 intent');
    assert.equal(scopedPending[0].intent_id, inject2.intent.intent_id);
  });

  it('retroactive migration: intents from a prior run are archived, pre-run intents are adopted', () => {
    const config = makeConfig();
    const root = createProject();

    // Initialize run 1
    initializeGovernedRun(root, config);
    const state1 = readState(root);
    const run1Id = state1.run_id;

    // Inject intent in run 1 — gets approved_run_id = run1Id
    const inject1 = injectIntent(root, 'Run 1 bound intent', {
      priority: 'p1',
      charter: 'Run 1 work',
      acceptance: 'Legacy check',
    });
    assert.ok(inject1.ok);
    const run1IntentId = inject1.intent.intent_id;

    // Verify it got stamped with run1's run_id
    const intent1Path = join(root, '.agentxchain', 'intake', 'intents', `${run1IntentId}.json`);
    const intent1Before = JSON.parse(readFileSync(intent1Path, 'utf8'));
    assert.equal(intent1Before.approved_run_id, run1Id, 'intent should be stamped with run 1 id');

    // Simulate run 1 completion
    const stateForReset = readState(root);
    stateForReset.status = 'idle';
    stateForReset.run_id = null;
    writeFileSync(join(root, '.agentxchain/state.json'), JSON.stringify(stateForReset, null, 2));

    // Inject a pre-run intent while idle (no run_id in state)
    const inject2 = injectIntent(root, 'Pre-run unbound intent', {
      priority: 'p0',
      charter: 'Unbound work',
      acceptance: 'Pre-run check',
    });
    assert.ok(inject2.ok);
    const unboundIntentId = inject2.intent.intent_id;

    // Start run 2 — migration should archive run 1's intent and adopt the unbound one
    initializeGovernedRun(root, config);
    const state2 = readState(root);
    const run2Id = state2.run_id;

    // Run 1's intent should be archived (suppressed)
    const intent1After = JSON.parse(readFileSync(intent1Path, 'utf8'));
    assert.equal(intent1After.status, 'suppressed', 'run 1 intent should be archived');
    assert.ok(intent1After.archived_reason, 'archived intent should have a reason');

    // Pre-run intent should be adopted into run 2
    const intent2Path = join(root, '.agentxchain', 'intake', 'intents', `${unboundIntentId}.json`);
    const intent2After = JSON.parse(readFileSync(intent2Path, 'utf8'));
    assert.equal(intent2After.status, 'approved', 'pre-run intent should remain approved');
    assert.equal(intent2After.approved_run_id, run2Id, 'pre-run intent should be adopted into run 2');

    // The adopted intent should be dispatchable in run 2
    const result = findNextDispatchableIntent(root, { run_id: run2Id });
    assert.ok(result.ok, 'adopted intent should be dispatchable');
    assert.equal(result.intentId, unboundIntentId, 'should return the adopted intent');
  });
});
