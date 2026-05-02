/**
 * BUG-7 beta-tester scenario: reissue-turn must work after baseline drift
 *
 * After HEAD changes post-dispatch, `reissue-turn` must archive the old turn
 * and create a new one against the current HEAD.
 */

import { describe, it, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  reissueTurn,
  getActiveTurn,
  normalizeGovernedStateShape,
} from '../../src/lib/governed-state.js';
import { writeDispatchBundle } from '../../src/lib/dispatch-bundle.js';

const tempDirs = [];

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'bug7-test', name: 'BUG-7 Test', default_branch: 'main' },
    roles: {
      dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-dev' },
    },
    runtimes: { 'local-dev': { type: 'local_cli', command: ['echo', 'dev'], prompt_transport: 'dispatch_bundle_only' } },
    phases: [{ id: 'implementation', name: 'Implementation' }],
    routing: { implementation: { entry_role: 'dev', allowed_next_roles: ['dev'] } },
    gates: {},
  };
}

function createProject(config) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug7-'));
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

describe('BUG-7 beta-tester scenario: reissue-turn after baseline drift', () => {
  it('produces a fresh turn against current HEAD after drift', () => {
    const config = makeConfig();
    const root = createProject(config);

    // 1. Initialize + assign a dev turn
    initializeGovernedRun(root, config);
    const assign = assignGovernedTurn(root, config, 'dev');
    assert.ok(assign.ok, `Assign failed: ${assign.error}`);
    const originalTurnId = assign.turn.turn_id;

    const state = readState(root);
    writeDispatchBundle(root, state, config, { turnId: originalTurnId });

    // 2. Cause baseline drift: commit after dispatch
    writeFileSync(join(root, 'drift.txt'), 'baseline drift');
    execSync('git add drift.txt && git commit -m "drift"', { cwd: root, stdio: 'ignore' });

    // 3. Reissue the turn
    const reissueResult = reissueTurn(root, config, { reason: 'baseline drift' });
    assert.ok(reissueResult.ok, `Reissue failed: ${reissueResult.error}`);

    // 4. Verify a new active turn exists and is different from the original
    const stateAfter = readState(root);
    const activeTurn = getActiveTurn(stateAfter);
    assert.ok(activeTurn, 'Must have an active turn after reissue');
    assert.notEqual(activeTurn.turn_id, originalTurnId, 'New turn must have a different turn_id');
  });
});
