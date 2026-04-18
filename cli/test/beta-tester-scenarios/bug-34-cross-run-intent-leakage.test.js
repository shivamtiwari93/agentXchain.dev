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

    // Inject intent in run 1
    const inject1 = injectIntent(root, 'Run 1 intent', {
      priority: 'p0',
      charter: 'Run 1 work',
      acceptance: 'Done',
    });
    assert.ok(inject1.ok);

    // Start run 2
    const stateForReset = readState(root);
    stateForReset.status = 'idle';
    stateForReset.run_id = null;
    writeFileSync(join(root, '.agentxchain/state.json'), JSON.stringify(stateForReset, null, 2));
    initializeGovernedRun(root, config);
    const state2 = readState(root);
    const run2Id = state2.run_id;

    // Inject intent in run 2
    const inject2 = injectIntent(root, 'Run 2 intent', {
      priority: 'p0',
      charter: 'Run 2 work',
      acceptance: 'Done',
    });
    assert.ok(inject2.ok);

    // Without scoping: both intents visible
    const allPending = findPendingApprovedIntents(root);
    assert.ok(allPending.length >= 2, 'both intents should be visible without scoping');

    // With run_id scoping: only run 2's intent visible
    const scopedPending = findPendingApprovedIntents(root, { run_id: run2Id });
    assert.ok(
      scopedPending.every(i => i.intent_id !== inject1.intent.intent_id),
      'BUG-34: run 1 intent should not appear in run 2 scoped results'
    );
  });

  it('retroactive migration archives unbound intents from prior runs', () => {
    const config = makeConfig();
    const root = createProject();

    // Initialize run 1
    initializeGovernedRun(root, config);
    const state1 = readState(root);
    const run1Id = state1.run_id;

    // Inject intent without run_id binding (pre-migration format)
    const inject1 = injectIntent(root, 'Legacy unbound intent', {
      priority: 'p1',
      charter: 'Old work',
      acceptance: 'Legacy check',
    });
    assert.ok(inject1.ok);
    const legacyIntentId = inject1.intent.intent_id;

    // Simulate run 1 completion
    const stateForReset = readState(root);
    stateForReset.status = 'idle';
    stateForReset.run_id = null;
    writeFileSync(join(root, '.agentxchain/state.json'), JSON.stringify(stateForReset, null, 2));

    // Start run 2 — migration should archive the unbound intent
    initializeGovernedRun(root, config);
    const state2 = readState(root);
    const run2Id = state2.run_id;

    // After migration, the legacy intent should not be dispatchable in run 2
    const result = findNextDispatchableIntent(root, { run_id: run2Id });
    assert.ok(
      !result.ok || result.intentId !== legacyIntentId,
      'BUG-34: legacy unbound intent should be archived/filtered after migration'
    );

    // The legacy intent should have been archived (status != approved)
    const intentPath = join(root, '.agentxchain', 'intake', 'intents', `${legacyIntentId}.json`);
    if (existsSync(intentPath)) {
      const intent = JSON.parse(readFileSync(intentPath, 'utf8'));
      // After migration, either archived or still approved but with a prior run_id marker
      // that makes it filterable
      const isFilterable = intent.status !== 'approved' ||
        (intent.approved_run_id && intent.approved_run_id !== run2Id) ||
        intent.cross_run_durable === false;
      assert.ok(isFilterable, 'BUG-34: legacy intent must be archivable or filterable after migration');
    }
  });
});
