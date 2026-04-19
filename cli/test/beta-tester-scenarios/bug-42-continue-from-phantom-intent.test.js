import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  createLegacyIntentRepo,
  readEvents,
  readIntent,
  seedContinuousSession,
} from './_helpers/legacy-intent-fixture.js';

const ROOT = join(import.meta.dirname, '..', '..');
const CLI_PATH = join(ROOT, 'bin', 'agentxchain.js');
const RUN_ID = 'run_c8a4701ce0d4952d';
const INTENT_ID = 'intent_1776473633943_0543';
const tempDirs = [];

function createRepoWithPhantomIntent() {
  const root = createLegacyIntentRepo('axc-bug42-continuous-');
  tempDirs.push(root);

  seedContinuousSession(root, {
    session_id: 'cont-bug42',
    started_at: '2026-04-18T00:00:00.000Z',
    vision_path: '.planning/VISION.md',
    runs_completed: 0,
    max_runs: 5,
    idle_cycles: 0,
    max_idle_cycles: 1,
    current_run_id: RUN_ID,
    current_vision_objective: null,
    status: 'running',
    per_session_max_usd: null,
    cumulative_spent_usd: 0,
    budget_exhausted: false,
    startup_reconciled_run_id: RUN_ID,
  });

  writeFileSync(join(root, '.agentxchain', 'intake', 'intents', `${INTENT_ID}.json`), JSON.stringify({
    intent_id: INTENT_ID,
    summary: 'Previously accepted planning work still marked approved',
    priority: 'p1',
    status: 'approved',
    approved_run_id: RUN_ID,
    run_id: null,
    template: 'generic',
    charter: 'Legacy planning work already exists on disk.',
    acceptance_contract: ['Should be superseded before dispatch'],
    created_at: '2026-04-18T00:00:00.000Z',
    updated_at: '2026-04-18T00:00:00.000Z',
    history: [],
  }, null, 2));

  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('BUG-42: exact continue-from continuous command supersedes phantom intents before queue selection', () => {
  it('prints phantom supersession, emits an event, and does not abort on planning overwrite', () => {
    const root = createRepoWithPhantomIntent();

    const result = spawnSync('node', [
      CLI_PATH,
      'run',
      '--continue-from', RUN_ID,
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
    assert.match(result.stdout, /Superseded 1 phantom intent\(s\): intent_1776473633943_0543/);
    assert.doesNotMatch(result.stdout, /existing planning artifacts would be overwritten/);
    assert.doesNotMatch(result.stdout, /Found queued intent: intent_1776473633943_0543/);

    const intent = readIntent(root, INTENT_ID);
    assert.equal(intent.status, 'superseded');
    assert.match(intent.archived_reason, /planning artifacts for this intent already exist on disk/);

    const supersededEvents = readEvents(root).filter((event) => event.event_type === 'intents_superseded');
    assert.equal(supersededEvents.length, 1, 'continuous startup should emit one intents_superseded event');
    assert.deepEqual(supersededEvents[0].payload.superseded_intent_ids, [INTENT_ID]);
  });
});
