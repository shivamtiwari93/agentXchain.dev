import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = join(import.meta.dirname, '..', '..');
const CLI_PATH = join(ROOT, 'bin', 'agentxchain.js');
const tempDirs = [];

function createRepo() {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug40-'));
  tempDirs.push(root);

  mkdirSync(join(root, '.agentxchain', 'dispatch', 'turns'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'intake', 'intents'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });

  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify({
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug40-test', name: 'BUG-40 Test', default_branch: 'main' },
    roles: {
      pm: { title: 'Product Manager', mandate: 'Plan.', write_authority: 'review_only', runtime: 'manual-pm' },
      dev: { title: 'Developer', mandate: 'Build.', write_authority: 'authoritative', runtime: 'manual-dev' },
      qa: { title: 'QA', mandate: 'Verify.', write_authority: 'review_only', runtime: 'manual-qa' },
      eng_director: { title: 'Engineering Director', mandate: 'Resolve deadlocks.', write_authority: 'review_only', runtime: 'manual-director' },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'manual-dev': { type: 'manual' },
      'manual-qa': { type: 'manual' },
      'manual-director': { type: 'manual' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'eng_director', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'eng_director', 'human'], exit_gate: 'implementation_complete' },
      qa: { entry_role: 'qa', allowed_next_roles: ['dev', 'qa', 'eng_director', 'human'], exit_gate: 'qa_ship_verdict' },
    },
    gates: {
      planning_signoff: {
        requires_files: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md', '.planning/SYSTEM_SPEC.md'],
        requires_human_approval: true,
      },
      implementation_complete: {
        requires_files: ['.planning/IMPLEMENTATION_NOTES.md'],
        requires_verification_pass: true,
      },
      qa_ship_verdict: {
        requires_files: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md', '.planning/RELEASE_NOTES.md'],
        requires_human_approval: true,
      },
    },
  }, null, 2));

  writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify({
    schema_version: '1.0',
    protocol_version: '2.135.1',
    run_id: 'run_c8a4701ce0d4952d',
    project_id: 'bug40-test',
    status: 'active',
    phase: 'implementation',
    accepted_integration_ref: null,
    active_turns: {},
    turn_sequence: 7,
    last_completed_turn_id: 'turn_prev_001',
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
    phase_gate_status: {},
  }, null, 2));
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'events.jsonl'), '');

  // Existing planning artifacts are what made the stale approved legacy intent explode
  // with "existing planning artifacts would be overwritten" in the tester repo.
  writeFileSync(join(root, '.planning', 'PM_SIGNOFF.md'), '# Existing signoff\n');
  writeFileSync(join(root, '.planning', 'ROADMAP.md'), '# Existing roadmap\n');
  writeFileSync(join(root, '.planning', 'SYSTEM_SPEC.md'), '# Existing spec\n');
  writeFileSync(join(root, '.planning', 'VISION.md'), '# Vision\n\n## Goals\n\n');

  return root;
}

function seedLegacyIntent(root, intentId) {
  writeFileSync(join(root, '.agentxchain', 'intake', 'intents', `${intentId}.json`), JSON.stringify({
    intent_id: intentId,
    summary: `Legacy ${intentId}`,
    priority: 'p1',
    status: 'approved',
    approved_run_id: null,
    run_id: null,
    template: 'generic',
    charter: 'Legacy pre-BUG-34 intent with no run scope.',
    acceptance_contract: ['Should be archived before dispatch'],
    created_at: '2026-04-10T00:00:00.000Z',
    updated_at: '2026-04-10T00:00:00.000Z',
    history: [],
  }, null, 2));
}

function readIntent(root, intentId) {
  return JSON.parse(readFileSync(join(root, '.agentxchain', 'intake', 'intents', `${intentId}.json`), 'utf8'));
}

function readEvents(root) {
  const eventsPath = join(root, '.agentxchain', 'events.jsonl');
  if (!existsSync(eventsPath)) return [];
  return readFileSync(eventsPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('BUG-40: continuous startup migrates legacy intents before queue selection', () => {
  it('archives legacy null-scoped intents on run --continue-from continuous startup instead of planning them', () => {
    const root = createRepo();
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
      /Archived 3 pre-BUG-34 intent\(s\): intent_1776473633943_0543, intent_1776474414878_c28b, intent_1776489830072_6802/
    );
    assert.doesNotMatch(result.stdout, /existing planning artifacts would be overwritten/);
    assert.doesNotMatch(result.stdout, /Found queued intent: intent_1776473633943_0543/);

    for (const intentId of legacyIds) {
      const intent = readIntent(root, intentId);
      assert.equal(intent.status, 'archived_migration');
      assert.match(intent.archived_reason, /pre-BUG-34 intent with no run scope/);
    }

    const migrationEvents = readEvents(root).filter((event) => event.event_type === 'intents_migrated');
    assert.equal(migrationEvents.length, 1, 'continuous startup should emit one intents_migrated event');
    assert.deepEqual(
      migrationEvents[0].payload.archived_intent_ids.sort(),
      [...legacyIds].sort(),
    );
  });
});
