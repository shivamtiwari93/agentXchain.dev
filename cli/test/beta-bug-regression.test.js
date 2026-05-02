/**
 * Regression tests for BUG-1 through BUG-6.
 * These reproduce the exact scenarios from the first beta tester's report.
 */

import { strict as assert } from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import {
  captureBaseline,
  captureDirtyWorkspaceSnapshot,
  observeChanges,
  compareDeclaredVsObserved,
  isOperationalPath,
} from '../src/lib/repo-observer.js';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  rejectGovernedTurn,
  refreshTurnBaselineSnapshot,
  reissueTurn,
  getActiveTurn,
  getActiveTurns,
  normalizeGovernedStateShape,
} from '../src/lib/governed-state.js';

import { writeSessionCheckpoint, readSessionCheckpoint, captureBaselineRef } from '../src/lib/session-checkpoint.js';
import { emitRunEvent, VALID_RUN_EVENTS } from '../src/lib/run-events.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function initGitRepo(dir) {
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'ignore' });
  writeFileSync(join(dir, 'README.md'), '# Test\n');
  execSync('git add . && git commit -m "init"', { cwd: dir, stdio: 'ignore' });
}

function createGovernedProject() {
  const dir = mkdtempSync(join(tmpdir(), 'agentxchain-beta-bug-'));
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(dir, '.planning'), { recursive: true });

  const config = {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'beta-test', name: 'Beta Test', default_branch: 'main' },
    roles: {
      pm: {
        title: 'PM',
        mandate: 'Plan.',
        write_authority: 'review_only',
        runtime: 'manual-pm',
      },
      dev: {
        title: 'Dev',
        mandate: 'Build.',
        write_authority: 'authoritative',
        runtime: 'manual-dev',
      },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'manual-dev': { type: 'manual' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev'], exit_gate: 'impl_complete' },
    },
    gates: {
      planning_signoff: { requires_files: ['.planning/PM_SIGNOFF.md'] },
      impl_complete: { requires_verification_pass: true },
    },
  };

  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
  initGitRepo(dir);
  // agentxchain.json is already committed by initGitRepo's `git add .`

  return { dir, config };
}

function readState(dir) {
  const raw = JSON.parse(readFileSync(join(dir, '.agentxchain/state.json'), 'utf8'));
  return normalizeGovernedStateShape(raw).state;
}

function readEvents(dir) {
  const p = join(dir, '.agentxchain/events.jsonl');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

// ── BUG-2: Baseline consistency ─────────────────────────────────────────────

describe('BUG-2: state.json and session.json baseline agreement', () => {
  let dir, config;
  beforeEach(() => {
    ({ dir, config } = createGovernedProject());
  });
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('session.json workspace_dirty matches state.json baseline.clean after turn assignment', () => {
    // Initialize run
    const initResult = initializeGovernedRun(dir, config);
    assert.ok(initResult.ok, `Init failed: ${initResult.error}`);

    // Assign PM turn
    const assignResult = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assignResult.ok, `Assign failed: ${assignResult.error}`);

    const state = readState(dir);
    const turn = getActiveTurn(state);
    const session = readSessionCheckpoint(dir);

    // Both must agree on workspace dirty status
    assert.ok(turn.baseline, 'Turn should have a baseline');
    assert.ok(session, 'Session checkpoint should exist');

    // state.json: clean means NOT dirty
    // session.json: workspace_dirty is the opposite of clean
    assert.strictEqual(
      session.baseline_ref.workspace_dirty,
      !turn.baseline.clean,
      `Baseline consistency violation: state.json says clean=${turn.baseline.clean} but session.json says workspace_dirty=${session.baseline_ref.workspace_dirty}`,
    );
  });

  it('both agree when workspace is dirty at assignment time', () => {
    const initResult = initializeGovernedRun(dir, config);
    assert.ok(initResult.ok);

    // Make workspace dirty with a non-operational file
    // (PM is review_only so clean baseline check is skipped)
    writeFileSync(join(dir, 'dirty-file.txt'), 'operator edit');

    const assignResult = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assignResult.ok, `Assign failed: ${assignResult.error}`);

    const state = readState(dir);
    const turn = getActiveTurn(state);
    const session = readSessionCheckpoint(dir);

    assert.strictEqual(
      session.baseline_ref.workspace_dirty,
      !turn.baseline.clean,
      `Dirty workspace: state.json clean=${turn.baseline.clean} but session.json workspace_dirty=${session.baseline_ref.workspace_dirty}`,
    );
  });
});

// ── BUG-1: Delta-based artifact validation ──────────────────────────────────

describe('BUG-1: dirty workspace files do not cause false acceptance failure', () => {
  let dir, config;
  beforeEach(() => {
    ({ dir, config } = createGovernedProject());
  });
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('refreshTurnBaselineSnapshot captures files dirtied after assignment', () => {
    const initResult = initializeGovernedRun(dir, config);
    assert.ok(initResult.ok);

    const assignResult = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assignResult.ok);

    const turn = getActiveTurn(assignResult.state);

    // Workspace was clean at assignment; dirty_snapshot should be empty
    assert.deepStrictEqual(turn.baseline.dirty_snapshot, {});

    // Now operator dirties agentxchain.json (the beta tester scenario)
    writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({
      ...config,
      _operator_edit: true,
    }, null, 2));

    // Refresh baseline snapshot (simulates what happens before dispatch)
    const refreshResult = refreshTurnBaselineSnapshot(dir, turn.turn_id);
    assert.ok(refreshResult.ok);
    assert.ok(refreshResult.refreshed_files.includes('agentxchain.json'),
      'agentxchain.json should appear in refreshed files');

    // Now the turn's baseline should include agentxchain.json
    const updatedState = readState(dir);
    const updatedTurn = getActiveTurn(updatedState);
    assert.ok('agentxchain.json' in updatedTurn.baseline.dirty_snapshot,
      'agentxchain.json should be in the updated dirty_snapshot');
  });

  it('observeChanges filters files in dirty_snapshot with unchanged hash', () => {
    // Create a baseline that includes a known dirty file
    writeFileSync(join(dir, 'pre-existing.txt'), 'content A');
    const baseline = captureBaseline(dir);
    assert.ok('pre-existing.txt' in baseline.dirty_snapshot);

    // Observation should filter it out (file unchanged since baseline)
    const observation = observeChanges(dir, baseline);
    assert.ok(
      !observation.files_changed.includes('pre-existing.txt'),
      'Pre-existing dirty file with unchanged content should be filtered from observation',
    );
  });

  it('observeChanges includes files modified since baseline', () => {
    writeFileSync(join(dir, 'pre-existing.txt'), 'content A');
    const baseline = captureBaseline(dir);

    // Modify the file after baseline capture
    writeFileSync(join(dir, 'pre-existing.txt'), 'content B');

    const observation = observeChanges(dir, baseline);
    assert.ok(
      observation.files_changed.includes('pre-existing.txt'),
      'Modified file should appear in observation',
    );
  });
});

// ── BUG-3: Failure-path state transition ────────────────────────────────────

describe('BUG-3: turn transitions to failed_acceptance on acceptance failure', () => {
  let dir, config;
  beforeEach(() => {
    ({ dir, config } = createGovernedProject());
  });
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('turn status becomes failed_acceptance when validation fails', () => {
    const initResult = initializeGovernedRun(dir, config);
    assert.ok(initResult.ok);

    const assignResult = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assignResult.ok);

    const turn = getActiveTurn(assignResult.state);

    // Write an invalid staged result (missing required fields)
    const stagingDir = join(dir, '.agentxchain', 'staging', turn.turn_id);
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(stagingDir, 'turn-result.json'), JSON.stringify({
      // Deliberately incomplete — should fail validation
      turn_id: turn.turn_id,
      role: 'pm',
    }));

    const acceptResult = acceptGovernedTurn(dir, config, { turnId: turn.turn_id });
    assert.ok(!acceptResult.ok, 'Acceptance should fail');

    // The turn must NOT be stuck in 'running'
    const state = readState(dir);
    const updatedTurn = getActiveTurn(state);
    assert.ok(updatedTurn, 'Turn should still exist in active_turns');
    assert.strictEqual(updatedTurn.status, 'failed_acceptance',
      `Turn should be 'failed_acceptance', got '${updatedTurn.status}'`);
    assert.ok(updatedTurn.failure_reason, 'Turn should have a failure_reason');
  });
});

// ── BUG-4: Failure event logging ────────────────────────────────────────────

describe('BUG-4: acceptance_failed event is emitted to events.jsonl', () => {
  it('acceptance_failed is a valid event type', () => {
    assert.ok(VALID_RUN_EVENTS.includes('acceptance_failed'),
      'acceptance_failed should be in VALID_RUN_EVENTS');
  });

  let dir, config;
  beforeEach(() => {
    ({ dir, config } = createGovernedProject());
  });
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('emits acceptance_failed event when acceptance rejects a turn', () => {
    const initResult = initializeGovernedRun(dir, config);
    assert.ok(initResult.ok);

    const assignResult = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assignResult.ok);

    const turn = getActiveTurn(assignResult.state);

    // Write invalid staged result
    const stagingDir = join(dir, '.agentxchain', 'staging', turn.turn_id);
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(stagingDir, 'turn-result.json'), JSON.stringify({
      turn_id: turn.turn_id,
      role: 'pm',
    }));

    acceptGovernedTurn(dir, config, { turnId: turn.turn_id });

    // Check events
    const events = readEvents(dir);
    const acceptanceFailedEvents = events.filter(e => e.event_type === 'acceptance_failed');
    assert.ok(acceptanceFailedEvents.length > 0,
      `Expected at least one acceptance_failed event, got: ${events.map(e => e.event_type).join(', ')}`);

    const evt = acceptanceFailedEvents[0];
    assert.strictEqual(evt.turn.turn_id, turn.turn_id);
    assert.ok(evt.payload.reason, 'Event should include failure reason');
  });
});

// ── BUG-5: Operator messaging ───────────────────────────────────────────────

describe('BUG-5: dispatch bundle warns about dirty workspace', () => {
  it('isOperationalPath correctly classifies files', () => {
    // Operational paths should be excluded
    assert.ok(isOperationalPath('.agentxchain/state.json'));
    assert.ok(isOperationalPath('.agentxchain/session.json'));
    assert.ok(isOperationalPath('.agentxchain/events.jsonl'));

    // Non-operational paths should NOT be excluded
    assert.ok(!isOperationalPath('agentxchain.json'));
    assert.ok(!isOperationalPath('.planning/ROADMAP.md'));
    assert.ok(!isOperationalPath('README.md'));
  });

  it('captureDirtyWorkspaceSnapshot includes non-operational dirty files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-bug5-'));
    initGitRepo(dir);
    writeFileSync(join(dir, 'dirty.txt'), 'operator edit');

    const snapshot = captureDirtyWorkspaceSnapshot(dir);
    assert.ok('dirty.txt' in snapshot, 'dirty.txt should be in snapshot');

    rmSync(dir, { recursive: true, force: true });
  });
});

// ── BUG-6: Live subprocess streaming ────────────────────────────────────────

describe('BUG-6: --stream flag is recognized by step command', () => {
  it('step command help includes --stream option', () => {
    const result = spawnSync('node', [CLI_BIN, 'step', '--help'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    const output = result.stdout || '';
    assert.ok(output.includes('--stream'),
      `step --help should mention --stream flag. Got: ${output.slice(0, 500)}`);
  });
});

// ── BUG-7: reissue-turn ─────────────────────────────────────────────────────

describe('BUG-7: reissueTurn produces a fresh turn against current state', () => {
  let dir, config;
  beforeEach(() => {
    ({ dir, config } = createGovernedProject());
  });
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('reissues a turn with fresh baseline after HEAD changes', () => {
    const initResult = initializeGovernedRun(dir, config);
    assert.ok(initResult.ok);

    const assignResult = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assignResult.ok);

    const oldTurn = getActiveTurn(assignResult.state);
    const oldHead = oldTurn.baseline.head_ref;

    // Simulate operator committing a file (changing HEAD)
    writeFileSync(join(dir, 'new-file.txt'), 'content');
    execSync('git add new-file.txt && git commit -m "operator commit"', { cwd: dir, stdio: 'ignore' });

    const newHead = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
    assert.notStrictEqual(oldHead, newHead, 'HEAD should have changed');

    // Reissue
    const reissueResult = reissueTurn(dir, config, {
      turnId: oldTurn.turn_id,
      reason: 'baseline drift',
    });

    assert.ok(reissueResult.ok, `Reissue failed: ${reissueResult.error}`);
    assert.ok(reissueResult.newTurn, 'Should have a new turn');
    assert.notStrictEqual(reissueResult.newTurn.turn_id, oldTurn.turn_id, 'New turn should have a different ID');
    assert.strictEqual(reissueResult.newTurn.assigned_role, 'pm', 'Same role');
    assert.strictEqual(reissueResult.newTurn.baseline.head_ref, newHead, 'New baseline should point to current HEAD');
    assert.ok(reissueResult.baselineDelta.head_changed, 'Should detect HEAD change');

    // Old turn should not be in active turns
    const state = readState(dir);
    const activeTurns = getActiveTurns(state);
    assert.ok(!(oldTurn.turn_id in activeTurns), 'Old turn should be removed from active turns');
    assert.ok(reissueResult.newTurn.turn_id in activeTurns, 'New turn should be in active turns');

    // Check events
    const events = readEvents(dir);
    const reissueEvents = events.filter(e => e.event_type === 'turn_reissued');
    assert.ok(reissueEvents.length > 0, 'Should emit turn_reissued event');
  });

  it('reissue-turn command is registered', () => {
    const result = spawnSync('node', [CLI_BIN, 'reissue-turn', '--help'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    const output = result.stdout || '';
    assert.ok(output.includes('reissue'),
      `reissue-turn --help should exist. Got: ${output.slice(0, 500)}`);
  });
});

// ── BUG-8: reject-turn retry refreshes baseline ─────────────────────────────

describe('BUG-8: reject-turn retry refreshes baseline', () => {
  let dir, config;
  beforeEach(() => {
    ({ dir, config } = createGovernedProject());
  });
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('retry baseline is refreshed after HEAD changes', () => {
    const initResult = initializeGovernedRun(dir, config);
    assert.ok(initResult.ok);

    const assignResult = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assignResult.ok);

    const turn = getActiveTurn(assignResult.state);
    const oldHead = turn.baseline.head_ref;

    // Change HEAD
    writeFileSync(join(dir, 'new-file.txt'), 'content');
    execSync('git add new-file.txt && git commit -m "operator commit"', { cwd: dir, stdio: 'ignore' });

    const newHead = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();

    // Reject the turn
    const rejectResult = rejectGovernedTurn(dir, config, {
      errors: ['test rejection'],
      failed_stage: 'test',
    }, {
      turnId: turn.turn_id,
      reason: 'baseline drift test',
    });

    assert.ok(rejectResult.ok, `Reject failed: ${rejectResult.error}`);

    // The retry turn should have a refreshed baseline
    const state = readState(dir);
    const retryTurn = getActiveTurn(state);
    assert.ok(retryTurn, 'Should have a retry turn');
    assert.strictEqual(retryTurn.baseline.head_ref, newHead,
      `Retry baseline should point to current HEAD ${newHead}, got ${retryTurn.baseline.head_ref}`);
  });
});
