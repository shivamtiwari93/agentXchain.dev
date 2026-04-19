/**
 * BUG-42: Phantom intents — approved intents bound to the current run whose
 * planning artifacts already exist on disk. Continuous mode picks them up and
 * fails with "existing planning artifacts would be overwritten."
 *
 * The tester's state: intent_1776473633943_0543.json has
 *   status=approved, approved_run_id=run_c8a4701ce0d4952d, run_id=null,
 *   archived_at=null, consumed_at=null
 * and the planning artifacts from a prior PM acceptance already exist.
 *
 * Test seeds the exact tester state and verifies:
 * 1. archiveStaleIntentsForRun() detects and supersedes the phantom intent
 * 2. migrate-intents --dry-run correctly identifies the phantom
 * 3. migrate-intents supersedes the phantom
 * 4. After supersession, continuous startup does not pick up the phantom
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { archiveStaleIntentsForRun } from '../../src/lib/intent-startup-migration.js';
import { findNextDispatchableIntent } from '../../src/lib/intake.js';

const ROOT = join(import.meta.dirname, '../..');
const CLI_PATH = join(ROOT, 'bin', 'agentxchain.js');

function runCli(cwd, args) {
  return execFileSync('node', [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
    timeout: 15_000,
  });
}

/**
 * Seeds the exact tester state for BUG-42:
 * - governed project with api-service template (has planning artifacts)
 * - state.json with run_id matching the intent
 * - intent file with approved_run_id set to the run
 * - planning artifacts already exist on disk from a prior PM turn
 */
function seedTesterState() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-bug42-'));
  runCli(ROOT, ['init', '--governed', '--dir', dir, '-y']);

  const RUN_ID = 'run_c8a4701ce0d4952d';
  const INTENT_ID = 'intent_1776473633943_0543';

  // Set up state.json with the run_id
  const stateDir = join(dir, '.agentxchain');
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, 'state.json'), JSON.stringify({
    run_id: RUN_ID,
    phase: 'planning',
    status: 'active',
    protocol_version: '7',
  }));

  // Create the phantom intent — approved, bound to current run, but planning
  // artifacts already exist from a prior accepted PM turn
  const intentsDir = join(stateDir, 'intake', 'intents');
  mkdirSync(intentsDir, { recursive: true });
  writeFileSync(join(intentsDir, `${INTENT_ID}.json`), JSON.stringify({
    intent_id: INTENT_ID,
    status: 'approved',
    template: 'api-service',
    approved_run_id: RUN_ID,
    run_id: null,
    archived_at: null,
    consumed_at: null,
    priority: 'p0',
    charter: 'Build the API service',
    created_at: '2026-04-17T10:00:00Z',
    approved_at: '2026-04-17T10:05:00Z',
    updated_at: '2026-04-17T10:05:00Z',
    history: [
      { from: 'draft', to: 'approved', at: '2026-04-17T10:05:00Z', reason: 'auto' },
    ],
  }));

  // Create the planning artifacts that already exist on disk
  // (from a prior accepted PM turn that already wrote them)
  const planningDir = join(dir, '.planning');
  mkdirSync(planningDir, { recursive: true });
  writeFileSync(join(planningDir, 'api-contract.md'), '# API Contract\nExisting content from prior PM turn\n');
  writeFileSync(join(planningDir, 'operational-readiness.md'), '# Operational Readiness\nExisting\n');
  writeFileSync(join(planningDir, 'error-budget.md'), '# Error Budget\nExisting\n');

  return { dir, RUN_ID, INTENT_ID };
}

describe('BUG-42: phantom intent detection and supersession', () => {
  it('archiveStaleIntentsForRun detects and supersedes phantom intents', () => {
    const { dir, RUN_ID, INTENT_ID } = seedTesterState();

    // Before fix: intent is found as dispatchable
    const before = findNextDispatchableIntent(dir, { run_id: RUN_ID });
    assert.ok(before.ok, 'phantom intent should be found before supersession');
    assert.equal(before.intentId, INTENT_ID);

    // Run the fix
    const result = archiveStaleIntentsForRun(dir, RUN_ID);

    assert.equal(result.phantom_superseded, 1, 'should supersede 1 phantom intent');
    assert.ok(result.phantom_superseded_intent_ids.includes(INTENT_ID));

    // After fix: intent is NOT dispatchable
    const after = findNextDispatchableIntent(dir, { run_id: RUN_ID });
    assert.ok(!after.ok, 'phantom intent should not be dispatchable after supersession');

    // Verify the intent file was updated
    const intentPath = join(dir, '.agentxchain', 'intake', 'intents', `${INTENT_ID}.json`);
    const intent = JSON.parse(readFileSync(intentPath, 'utf8'));
    assert.equal(intent.status, 'superseded');
    assert.ok(intent.archived_reason.includes('planning artifacts'));
    assert.ok(intent.history.some((h) => h.to === 'superseded'));
  });

  it('migrate-intents --dry-run identifies phantom intents', () => {
    const { dir, INTENT_ID } = seedTesterState();

    const out = runCli(dir, ['migrate-intents', '--dry-run', '--json']);
    const result = JSON.parse(out);

    assert.equal(result.phantom_superseded_count, 1, 'should find 1 phantom intent');
    assert.ok(result.phantom_superseded_intent_ids.includes(INTENT_ID));
    assert.ok(result.message.includes('phantom'));
    assert.equal(result.dry_run, true);
  });

  it('migrate-intents supersedes phantom intents', () => {
    const { dir, INTENT_ID } = seedTesterState();

    const out = runCli(dir, ['migrate-intents', '--json']);
    const result = JSON.parse(out);

    assert.equal(result.phantom_superseded_count, 1);
    assert.ok(result.phantom_superseded_intent_ids.includes(INTENT_ID));
    assert.equal(result.dry_run, false);

    // Verify on-disk state
    const intentPath = join(dir, '.agentxchain', 'intake', 'intents', `${INTENT_ID}.json`);
    const intent = JSON.parse(readFileSync(intentPath, 'utf8'));
    assert.equal(intent.status, 'superseded');
  });

  it('non-phantom run-scoped intents are not affected', () => {
    const { dir, RUN_ID } = seedTesterState();

    // Add a valid non-phantom intent (no planning artifacts exist for its template)
    const validIntentId = 'intent_valid_001';
    const intentsDir = join(dir, '.agentxchain', 'intake', 'intents');
    writeFileSync(join(intentsDir, `${validIntentId}.json`), JSON.stringify({
      intent_id: validIntentId,
      status: 'approved',
      template: 'generic',
      approved_run_id: RUN_ID,
      priority: 'p1',
      history: [],
    }));

    const result = archiveStaleIntentsForRun(dir, RUN_ID);

    // Phantom should be superseded, but valid intent should remain
    assert.equal(result.phantom_superseded, 1);

    const after = findNextDispatchableIntent(dir, { run_id: RUN_ID });
    assert.ok(after.ok, 'valid intent should still be dispatchable');
    assert.equal(after.intentId, validIntentId);
  });
});
