/**
 * BUG-45 beta-tester scenario: retained-turn acceptance must reconcile against
 * live intent state instead of using the stale embedded intake_context.
 *
 * Tester's exact scenario distilled:
 *   1. Seed a retained turn with embedded intake_context.acceptance_contract
 *   2. Seed the intent file on disk — first in `executing` status, then mark
 *      it `completed` (simulating operator resolution)
 *   3. Run `accept-turn --turn <id>` via real CLI
 *   4. Assert acceptance succeeds — reconciliation sees the terminal intent
 *      and skips coverage enforcement
 *
 * Also tests:
 *   - `intake resolve --intent <id> --outcome completed` operator escape hatch
 *   - HUMAN_TASKS.md framework writes not triggering "Undeclared file changes"
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  acceptGovernedTurn,
  assignGovernedTurn,
  initializeGovernedRun,
  normalizeGovernedStateShape,
} from '../../src/lib/governed-state.js';
import { getTurnStagingResultPath } from '../../src/lib/turn-paths.js';
import { resolveIntent } from '../../src/lib/intake.js';

const ROOT = join(import.meta.dirname, '..', '..');
const CLI_PATH = join(ROOT, 'bin', 'agentxchain.js');
const INTENT_ID = 'intent_1776535590576_a157';
const EVENT_ID = 'evt_1776535590576_bug45';
const tempDirs = [];

function makeConfig() {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug45-test', name: 'BUG-45 Test', default_branch: 'main' },
    roles: {
      pm: { title: 'Product Marketing', mandate: 'Consolidate.', write_authority: 'authoritative', runtime: 'manual-pm' },
      qa: { title: 'QA', mandate: 'Verify.', write_authority: 'review_only', runtime: 'manual-qa' },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'manual-qa': { type: 'manual' },
    },
    routing: {
      qa: { entry_role: 'pm', allowed_next_roles: ['pm', 'qa'], exit_gate: 'qa_ship_verdict' },
    },
    gates: {
      qa_ship_verdict: {},
    },
  };
}

function createProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug45-'));
  tempDirs.push(root);

  mkdirSync(join(root, '.planning'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'intake', 'events'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'intake', 'intents'), { recursive: true });

  writeFileSync(join(root, 'README.md'), '# BUG-45\n');
  writeFileSync(join(root, '.planning', 'IMPLEMENTATION_NOTES.md'),
    '# Implementation Notes\n\n## Summary\n- Live-site consolidation\n\n## Changes\n- Website consolidated\n');
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(makeConfig(), null, 2));

  execSync('git init -b main', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });

  const config = makeConfig();
  const init = initializeGovernedRun(root, config);
  assert.ok(init.ok, init.error);
  return { root, config, state: init.state };
}

function readState(root) {
  const raw = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
  return normalizeGovernedStateShape(raw).state;
}

function stageTurnResult(root, turnId, payload) {
  const resultPath = join(root, getTurnStagingResultPath(turnId));
  mkdirSync(join(root, '.agentxchain', 'staging', turnId), { recursive: true });
  writeFileSync(resultPath, JSON.stringify(payload, null, 2));
  return resultPath;
}

function seedExecutingIntent(root, runId) {
  const timestamp = '2026-04-19T01:00:00.000Z';
  writeFileSync(join(root, '.agentxchain', 'intake', 'events', `${EVENT_ID}.json`), JSON.stringify({
    schema_version: '1.0',
    event_id: EVENT_ID,
    source: 'manual',
    category: 'operator_injection',
    created_at: timestamp,
    signal: { description: 'live-site consolidation', injected: true, priority: 'p0' },
    evidence: [{ type: 'text', value: 'beta tester bug report #14' }],
    dedup_key: 'manual:bug45',
  }, null, 2));

  writeFileSync(join(root, '.agentxchain', 'intake', 'intents', `${INTENT_ID}.json`), JSON.stringify({
    schema_version: '1.0',
    intent_id: INTENT_ID,
    event_id: EVENT_ID,
    status: 'executing',
    priority: 'p0',
    template: 'generic',
    charter: 'website/ reflects the current live website content and assets from websites/ instead of diverging from it',
    acceptance_contract: [
      'website/ reflects the current live website content and assets from websites/ instead of diverging from it',
      '.planning/IMPLEMENTATION_NOTES.md contains a literal ## Changes heading describing the consolidation work',
      'implementation can advance to qa after verification without depending on websites/ as a separate active site',
    ],
    phase_scope: null,
    approved_run_id: runId,
    target_run: runId,
    cross_run_durable: false,
    created_at: timestamp,
    updated_at: timestamp,
    history: [
      { from: 'approved', to: 'planned', at: timestamp, reason: 'dispatched' },
      { from: 'planned', to: 'executing', at: timestamp, reason: 'governed execution started' },
    ],
  }, null, 2));
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('BUG-45: retained-turn acceptance reconciles against live intent state', () => {
  it('accept-turn succeeds when live intent is already completed (defect 1)', () => {
    const { root, config, state } = createProject();
    seedExecutingIntent(root, state.run_id);

    // Assign a turn with the intent's intake_context embedded
    const assign = assignGovernedTurn(root, config, 'pm', {
      intakeContext: {
        intent_id: INTENT_ID,
        charter: 'live-site consolidation',
        acceptance_contract: [
          'website/ reflects the current live website content and assets from websites/ instead of diverging from it',
          '.planning/IMPLEMENTATION_NOTES.md contains a literal ## Changes heading describing the consolidation work',
          'implementation can advance to qa after verification without depending on websites/ as a separate active site',
        ],
        priority: 'p0',
      },
    });
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    // Now simulate: operator resolves the intent to completed on disk
    // (the tester did this via manual state surgery)
    const intentPath = join(root, '.agentxchain', 'intake', 'intents', `${INTENT_ID}.json`);
    const intent = JSON.parse(readFileSync(intentPath, 'utf8'));
    intent.status = 'completed';
    intent.completed_at = '2026-04-19T02:00:00.000Z';
    intent.updated_at = '2026-04-19T02:00:00.000Z';
    intent.history.push({
      from: 'executing',
      to: 'completed',
      at: '2026-04-19T02:00:00.000Z',
      reason: 'operator-resolved via intake resolve --outcome completed',
    });
    writeFileSync(intentPath, JSON.stringify(intent, null, 2));

    // Stage a turn result that does NOT address the acceptance contract
    // (the point is: the intent is completed, so coverage should be skipped)
    stageTurnResult(root, turnId, {
      schema_version: '1.0',
      run_id: state.run_id,
      turn_id: turnId,
      role: 'pm',
      runtime_id: 'manual-pm',
      status: 'completed',
      summary: 'QA verification pass.',
      decisions: [],
      objections: [],
      files_changed: ['.planning/IMPLEMENTATION_NOTES.md'],
      verification: { status: 'pass' },
      artifact: { type: 'workspace', ref: null },
      proposed_next_role: 'qa',
    });

    // Accept via the real CLI
    const accept = spawnSync('node', [CLI_PATH, 'accept-turn', '--turn', turnId], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(accept.status, 0,
      `accept-turn should succeed when intent is completed on disk:\n${accept.stdout}\n${accept.stderr}`);
    assert.doesNotMatch(accept.stdout + accept.stderr, /Intent coverage incomplete/,
      'should not complain about stale intent coverage');
  });

  it('intake resolve --outcome completed transitions executing intent (defect 2)', () => {
    const { root, state } = createProject();
    seedExecutingIntent(root, state.run_id);

    // Before: intent is executing
    const intentPath = join(root, '.agentxchain', 'intake', 'intents', `${INTENT_ID}.json`);
    const before = JSON.parse(readFileSync(intentPath, 'utf8'));
    assert.equal(before.status, 'executing');

    // Run resolve with --outcome completed
    const result = resolveIntent(root, INTENT_ID, { outcome: 'completed' });
    assert.ok(result.ok, result.error);
    assert.equal(result.previous_status, 'executing');
    assert.equal(result.new_status, 'completed');
    assert.equal(result.no_change, false);

    // After: intent is completed on disk
    const after = JSON.parse(readFileSync(intentPath, 'utf8'));
    assert.equal(after.status, 'completed');
    assert.ok(after.completed_at, 'completed_at should be set');
    assert.ok(after.history.some(h => h.to === 'completed' && h.reason.includes('operator-resolved')),
      'history should record operator resolution');
  });

  it('intake resolve --outcome completed via CLI command', () => {
    const { root, state } = createProject();
    seedExecutingIntent(root, state.run_id);

    const result = spawnSync('node', [
      CLI_PATH, 'intake', 'resolve',
      '--intent', INTENT_ID,
      '--outcome', 'completed',
      '--json',
    ], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(result.status, 0, `CLI should exit 0:\n${result.stdout}\n${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert.equal(output.previous_status, 'executing');
    assert.equal(output.new_status, 'completed');
    assert.equal(output.no_change, false);
  });

  it('HUMAN_TASKS.md framework edits do not trigger undeclared file changes (defect 3)', () => {
    const { root, config, state } = createProject();

    // Assign a turn (no intent binding)
    const assign = assignGovernedTurn(root, config, 'pm');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    // Simulate framework writing to HUMAN_TASKS.md AFTER baseline was captured
    writeFileSync(join(root, 'HUMAN_TASKS.md'),
      '# Human Tasks\n\n### hesc_cc29324d02653f26 — resolved\nEscalation resolved.\n');
    execSync('git add HUMAN_TASKS.md && git commit -m "framework escalation"', {
      cwd: root,
      stdio: 'ignore',
    });

    // Stage a turn result that does NOT list HUMAN_TASKS.md in files_changed
    stageTurnResult(root, turnId, {
      schema_version: '1.0',
      run_id: state.run_id,
      turn_id: turnId,
      role: 'pm',
      runtime_id: 'manual-pm',
      status: 'completed',
      summary: 'QA work.',
      decisions: [],
      objections: [],
      files_changed: ['.planning/IMPLEMENTATION_NOTES.md'],
      verification: { status: 'pass' },
      artifact: { type: 'workspace', ref: null },
    });

    const accept = acceptGovernedTurn(root, config, {
      turnId,
    });
    // The key assertion: HUMAN_TASKS.md should not trigger "Undeclared file changes"
    if (!accept.ok) {
      assert.doesNotMatch(accept.error, /HUMAN_TASKS\.md/,
        'HUMAN_TASKS.md should be excluded from artifact observation');
    }
    // If accept succeeded, that also proves HUMAN_TASKS.md didn't block
  });
});
