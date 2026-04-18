/**
 * BUG-39 beta-tester scenario: cross-run intent migration must archive pre-BUG-34
 * intent files that have `approved_run_id: null` instead of silently adopting them
 * into the current run.
 *
 * Tester evidence: older intent files at `.agentxchain/intake/intents/*.json` still
 * have `approved_run_id: null` and `run_id: null`. BUG-34's fix stamps these fields
 * on NEW approvals but did not run a migration pass to update existing files.
 * Result: continuous mode picks up stale intents from before the BUG-34 fix.
 *
 * Fix requirements (from HUMAN-ROADMAP):
 *   - On startup, scan intents. For any `approved` intent with `approved_run_id: null`:
 *     archive it with `status: "archived_migration"` and explicit reason.
 *   - Do NOT silently re-bind to current run.
 *   - Emit `intents_migrated` event with count and IDs.
 *   - CLI notice at startup when migration runs.
 *
 * This test must FAIL on pre-fix HEAD and PASS after the fix.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import {
  initializeGovernedRun,
  normalizeGovernedStateShape,
} from '../../src/lib/governed-state.js';
import {
  findNextDispatchableIntent,
  findPendingApprovedIntents,
} from '../../src/lib/intake.js';

const tempDirs = [];

function makeRawConfig() {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug39-test', name: 'BUG-39 Test', default_branch: 'main' },
    roles: {
      dev: { title: 'Developer', mandate: 'Implement features.', write_authority: 'authoritative', runtime: 'local-dev' },
    },
    runtimes: { 'local-dev': { type: 'local_cli', command: 'echo done' } },
    routing: { implementation: { entry_role: 'dev', allowed_next_roles: ['dev'] } },
    gates: {},
  };
}

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'bug39-test', name: 'BUG-39 Test', default_branch: 'main' },
    roles: {
      dev: { title: 'Developer', mandate: 'Implement features.', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-dev' },
    },
    runtimes: { 'local-dev': { type: 'local_cli', command: 'echo done' } },
    phases: [{ id: 'implementation', name: 'Implementation' }],
    routing: { implementation: { entry_role: 'dev', allowed_next_roles: ['dev'] } },
    gates: {},
  };
}

function createProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug39-'));
  tempDirs.push(root);
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'intake', 'intents'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'events'), { recursive: true });
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

/**
 * Seed a pre-BUG-34 intent file: approved status, approved_run_id: null, run_id: null.
 * This exactly matches the tester's on-disk state for repos that existed before BUG-34.
 */
function seedPreBug34Intent(root, intentId, summary) {
  const intent = {
    intent_id: intentId,
    summary: summary || `Pre-BUG-34 intent ${intentId}`,
    priority: 'p1',
    status: 'approved',
    approved_run_id: null,
    run_id: null,
    charter: 'Legacy pre-BUG-34 intent with no run scope.',
    acceptance: ['Must be archived on migration'],
    created_at: '2026-04-10T00:00:00.000Z',
    updated_at: '2026-04-10T00:00:00.000Z',
    history: [],
  };
  writeFileSync(
    join(root, '.agentxchain', 'intake', 'intents', `${intentId}.json`),
    JSON.stringify(intent, null, 2),
  );
  return intent;
}

function readEvents(root) {
  const eventsFile = join(root, '.agentxchain', 'events.jsonl');
  if (!existsSync(eventsFile)) return [];
  const events = [];
  const lines = readFileSync(eventsFile, 'utf8').trim().split('\n').filter(Boolean);
  for (const line of lines) {
    try { events.push(JSON.parse(line)); } catch {}
  }
  return events;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {}
  }
});

describe('BUG-39: pre-BUG-34 intent migration on run startup', () => {
  it('archives pre-BUG-34 intents (approved_run_id: null) instead of adopting them', () => {
    const config = makeConfig();
    const root = createProject();

    // Seed two pre-BUG-34 intent files matching the tester's actual on-disk state
    const staleId1 = 'intent_1776473633943_0543';
    const staleId2 = 'intent_1776474414878_c28b';
    seedPreBug34Intent(root, staleId1, 'Stale intent from before BUG-34 fix');
    seedPreBug34Intent(root, staleId2, 'Another stale pre-BUG-34 intent');

    // Initialize a run — migration should fire
    initializeGovernedRun(root, config);
    const state = readState(root);
    const runId = state.run_id;
    assert.ok(runId, 'run should have started');

    // Both pre-BUG-34 intents must be archived, NOT adopted
    for (const intentId of [staleId1, staleId2]) {
      const intentPath = join(root, '.agentxchain', 'intake', 'intents', `${intentId}.json`);
      const intent = JSON.parse(readFileSync(intentPath, 'utf8'));

      assert.equal(
        intent.status, 'archived_migration',
        `BUG-39: intent ${intentId} should be archived_migration, got ${intent.status}`,
      );
      assert.ok(
        intent.archived_reason && intent.archived_reason.includes('pre-BUG-34'),
        `BUG-39: intent ${intentId} should have pre-BUG-34 archival reason, got: ${intent.archived_reason}`,
      );
      // Must NOT have been adopted into current run
      assert.notEqual(
        intent.approved_run_id, runId,
        `BUG-39: intent ${intentId} must NOT be adopted into current run`,
      );
    }

    // Neither intent should appear as dispatchable
    const dispatchable = findNextDispatchableIntent(root, { run_id: runId });
    if (dispatchable.ok) {
      assert.notEqual(dispatchable.intentId, staleId1, 'stale intent 1 must not be dispatchable');
      assert.notEqual(dispatchable.intentId, staleId2, 'stale intent 2 must not be dispatchable');
    }

    // Neither intent should appear in pending queue
    const pending = findPendingApprovedIntents(root, { run_id: runId });
    const pendingIds = pending.map(i => i.intent_id);
    assert.ok(!pendingIds.includes(staleId1), 'stale intent 1 must not appear in pending');
    assert.ok(!pendingIds.includes(staleId2), 'stale intent 2 must not appear in pending');
  });

  it('emits intents_migrated event with count and IDs of archived intents', () => {
    const config = makeConfig();
    const root = createProject();

    seedPreBug34Intent(root, 'intent_legacy_001', 'Legacy intent A');
    seedPreBug34Intent(root, 'intent_legacy_002', 'Legacy intent B');

    initializeGovernedRun(root, config);

    // Check for intents_migrated event
    const events = readEvents(root);
    const migrationEvents = events.filter(e => e.event_type === 'intents_migrated');
    assert.ok(
      migrationEvents.length > 0,
      'BUG-39: must emit intents_migrated event on startup when pre-BUG-34 intents are found',
    );

    const migrationEvent = migrationEvents[0];
    assert.ok(migrationEvent.payload, 'migration event must have payload');
    assert.equal(migrationEvent.payload.archived_count, 2, 'must report 2 archived intents');
    assert.ok(
      Array.isArray(migrationEvent.payload.archived_intent_ids),
      'must include array of archived intent IDs',
    );
    assert.ok(
      migrationEvent.payload.archived_intent_ids.includes('intent_legacy_001'),
      'must include intent_legacy_001 in archived IDs',
    );
    assert.ok(
      migrationEvent.payload.archived_intent_ids.includes('intent_legacy_002'),
      'must include intent_legacy_002 in archived IDs',
    );
  });

  it('continuous mode does not hit stale-queue error after migration', () => {
    const config = makeConfig();
    const root = createProject();

    // Seed pre-BUG-34 intent matching tester's exact state
    seedPreBug34Intent(root, 'intent_1776473633943_0543');

    // Initialize run — should succeed without continuous start error
    const result = initializeGovernedRun(root, config);
    assert.ok(result.ok, `run initialization should succeed: ${result.error}`);

    const state = readState(root);
    assert.equal(state.status, 'active', 'run should be active');

    // No approved intents should remain in the queue
    const pending = findPendingApprovedIntents(root, { run_id: state.run_id });
    assert.equal(pending.length, 0, 'no pre-BUG-34 intents should remain as approved');
  });
});
