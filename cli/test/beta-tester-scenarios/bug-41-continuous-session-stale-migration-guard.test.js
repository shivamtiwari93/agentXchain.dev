import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  createLegacyIntentRepo,
  readEvents,
  readIntent,
  seedContinuousSession,
  seedLegacyIntent,
} from './_helpers/legacy-intent-fixture.js';

const ROOT = join(import.meta.dirname, '..', '..');
const CLI_PATH = join(ROOT, 'bin', 'agentxchain.js');
const tempDirs = [];

function createRepoWithReconciledSession() {
  const root = createLegacyIntentRepo('axc-bug41-');
  tempDirs.push(root);
  seedContinuousSession(root, {
    session_id: 'cont-stale-lock',
    started_at: '2026-04-18T00:00:00.000Z',
    vision_path: '.planning/VISION.md',
    runs_completed: 0,
    max_runs: 5,
    idle_cycles: 0,
    max_idle_cycles: 1,
    current_run_id: 'run_c8a4701ce0d4952d',
    current_vision_objective: null,
    status: 'running',
    per_session_max_usd: null,
    cumulative_spent_usd: 0,
    budget_exhausted: false,
    startup_reconciled_run_id: 'run_c8a4701ce0d4952d',
  });
  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('BUG-41: continuous startup re-runs legacy intent migration even when the session already marks the run reconciled', () => {
  it('archives legacy null-scoped intents instead of skipping straight to stale queue selection', () => {
    const root = createRepoWithReconciledSession();
    const legacyIds = [
      'intent_1776473633943_0543',
      'intent_1776474414878_c28b',
      'intent_1776489830072_6802',
    ];
    legacyIds.forEach((intentId) => seedLegacyIntent(root, intentId));

    const result = spawnSync('node', [
      CLI_PATH,
      'run',
      '--continue-from', 'run_c8a4701ce0d4952d',
      '--continuous',
      '--auto-approve',
      '--auto-checkpoint',
      '--max-turns', '20',
      '--max-runs', '1',
      '--max-idle-cycles', '1',
      '--poll-seconds', '0',
      '--triage-approval', 'auto',
    ], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NODE_NO_WARNINGS: '1',
      },
    });

    assert.equal(result.status, 0, `continuous startup should succeed, stderr: ${result.stderr}`);
    assert.match(
      result.stdout,
      /Archived 3 pre-BUG-34 intent\(s\): intent_1776473633943_0543, intent_1776474414878_c28b, intent_1776489830072_6802/,
    );
    assert.doesNotMatch(result.stdout, /existing planning artifacts would be overwritten/);
    assert.doesNotMatch(result.stdout, /Found queued intent: intent_1776473633943_0543/);

    for (const intentId of legacyIds) {
      const intent = readIntent(root, intentId);
      assert.equal(intent.status, 'archived_migration');
    }

    const migrationEvents = readEvents(root).filter((event) => event.event_type === 'intents_migrated');
    assert.equal(migrationEvents.length, 1, 'continuous startup should emit one intents_migrated event');
    assert.deepEqual(
      migrationEvents[0].payload.archived_intent_ids.sort(),
      [...legacyIds].sort(),
    );
  });
});
