/**
 * BUG-1 beta-tester scenario: dirty workspace files cause false acceptance failure
 *
 * Fix: refreshTurnBaselineSnapshot() re-snapshots dirty files at dispatch time
 * so they are excluded from the acceptance diff.
 *
 * Tester sequence:
 *   1. Scaffold project, create a pre-existing dirty file, commit init
 *   2. Start run, assign a turn — dispatch baseline captures the dirty file
 *   3. Call refreshTurnBaselineSnapshot to update the snapshot
 *   4. Accept the turn — should succeed because the dirty file was in baseline
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  refreshTurnBaselineSnapshot,
  normalizeGovernedStateShape,
} from '../../src/lib/governed-state.js';
import { writeDispatchBundle } from '../../src/lib/dispatch-bundle.js';

const tempDirs = [];

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'bug1-test', name: 'BUG-1 Test', default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'Plan', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-pm' },
    },
    runtimes: { 'manual-pm': { type: 'manual' } },
    phases: [{ id: 'planning', name: 'Planning' }],
    routing: { planning: { entry_role: 'pm', allowed_next_roles: ['pm'] } },
    gates: {},
  };
}

function createProject(config) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug1-'));
  tempDirs.push(root);
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
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

describe('BUG-1 beta-tester scenario: dirty workspace false acceptance failure', () => {
  it('acceptance succeeds when dirty file existed before dispatch and baseline was refreshed', () => {
    const config = makeConfig();
    const root = createProject(config);

    // 1. Create a dirty file BEFORE the run starts — this is pre-existing workspace noise
    writeFileSync(join(root, 'unrelated-dirty-file.txt'), `random noise ${Date.now()}`);

    // 2. Initialize run + assign turn
    const initResult = initializeGovernedRun(root, config);
    assert.ok(initResult.ok, `Init failed: ${initResult.error}`);

    const assignResult = assignGovernedTurn(root, config, 'pm');
    assert.ok(assignResult.ok, `Assign failed: ${assignResult.error}`);
    const turnId = assignResult.turn.turn_id;

    const state = readState(root);
    writeDispatchBundle(root, state, config, { turnId });

    // 3. BUG-1 FIX: refresh the baseline to capture the dirty file
    refreshTurnBaselineSnapshot(root, turnId);

    // 4. Stage a valid turn result
    writeFileSync(join(root, '.agentxchain', 'staging', 'turn-result.json'), JSON.stringify({
      schema_version: '1.0',
      run_id: state.run_id,
      turn_id: turnId,
      role: 'pm',
      runtime_id: 'manual-pm',
      status: 'completed',
      summary: 'Planning review completed.',
      decisions: [],
      objections: [{ id: 'OBJ-1', target: 'process', statement: 'Workspace cleanliness', severity: 'low' }],
      files_changed: [],
      verification: { status: 'skipped' },
      artifact: { type: 'review', ref: null },
      objections: [{ id: 'OBJ-1', target: 'process', statement: 'Workspace hygiene review', severity: 'low' }],
      proposed_next_role: 'pm',
    }, null, 2));

    // 5. Accept — should succeed because the dirty file is in the refreshed baseline
    const acceptResult = acceptGovernedTurn(root, config, {
      turnId,
      resultPath: join(root, '.agentxchain', 'staging', 'turn-result.json'),
    });

    assert.ok(acceptResult.ok, `Acceptance must succeed with refreshed baseline. Got: ${acceptResult.error}`);
  });
});
