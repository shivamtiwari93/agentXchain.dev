/**
 * BUG-49 beta-tester scenario: accepted_integration_ref not updated on checkpoint.
 *
 * When a turn is accepted and checkpointed, state.accepted_integration_ref
 * must match the new checkpoint SHA, not the parent run's final SHA.
 * Drift detection must not report false drift immediately after a clean checkpoint.
 *
 * Tester sequence:
 *   1. Initialize a run (simulating a fresh run from a parent)
 *   2. Assign and accept a PM turn that writes a file
 *   3. Checkpoint the accepted turn
 *   4. Assert accepted_integration_ref matches the checkpoint SHA
 *   5. Assert status does not report drift
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
} from '../../src/lib/governed-state.js';
import { checkpointAcceptedTurn } from '../../src/lib/turn-checkpoint.js';
import { getTurnStagingResultPath } from '../../src/lib/turn-paths.js';

const tempDirs = [];

function makeConfig() {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug49-test', name: 'BUG-49 Test', default_branch: 'main' },
    roles: {
      pm: {
        title: 'Product Marketing',
        mandate: 'Draft copy.',
        write_authority: 'authoritative',
        runtime: 'manual-pm',
      },
    },
    runtimes: { 'manual-pm': { type: 'manual' } },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm'], exit_gate: 'planning_signoff' },
    },
    gates: { planning_signoff: {} },
  };
}

function createProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug49-'));
  tempDirs.push(root);

  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'README.md'), '# BUG-49\n');
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
  return JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
}

function stageTurnResult(root, turnId, payload) {
  const resultPath = join(root, getTurnStagingResultPath(turnId));
  mkdirSync(join(root, '.agentxchain', 'staging', turnId), { recursive: true });
  writeFileSync(resultPath, JSON.stringify(payload, null, 2));
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('BUG-49: accepted_integration_ref updated on checkpoint', () => {
  it('continuation run seeds accepted_integration_ref from current HEAD at initialization', () => {
    const { root, config } = createProject();

    const parentHead = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();

    const rawStatePath = join(root, '.agentxchain', 'state.json');
    const rawState = JSON.parse(readFileSync(rawStatePath, 'utf8'));
    rawState.status = 'completed';
    rawState.completed_at = new Date().toISOString();
    writeFileSync(rawStatePath, JSON.stringify(rawState, null, 2));

    const child = initializeGovernedRun(root, config, {
      allow_terminal_restart: true,
      provenance: {
        trigger: 'continuation',
        parent_run_id: 'run_parent_abcdef12',
        created_by: 'operator',
      },
    });
    assert.ok(child.ok, child.error);
    assert.equal(child.state.accepted_integration_ref, `git:${parentHead}`);
  });

  it('checkpoint updates accepted_integration_ref to the new checkpoint SHA', () => {
    const { root, config, state } = createProject();

    // Assign a PM turn
    const assign = assignGovernedTurn(root, config, 'pm');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    // Write a file (agent output)
    writeFileSync(join(root, '.planning', 'MARKETING_COPY.md'), '# Marketing Copy\n\nDraft content.\n');

    // Stage turn result
    stageTurnResult(root, turnId, {
      schema_version: '1.0',
      turn_id: turnId,
      run_id: state.run_id,
      role: 'pm',
      runtime_id: 'manual-pm',
      status: 'completed',
      summary: 'Drafted marketing copy',
      artifact: { type: 'workspace', path: '.' },
      files_changed: ['.planning/MARKETING_COPY.md'],
      decisions: [],
      objections: [],
      verification: { status: 'pass' },
      proposed_next_role: 'pm',
    });

    // Accept the turn
    const accept = acceptGovernedTurn(root, config);
    assert.ok(accept.ok, accept.error);

    // Read state after acceptance — accepted_integration_ref should be set
    const stateAfterAccept = readState(root);
    const refAfterAccept = stateAfterAccept.accepted_integration_ref;
    assert.ok(refAfterAccept, 'accepted_integration_ref should be set after acceptance');

    // Checkpoint the accepted turn
    const checkpoint = checkpointAcceptedTurn(root, { turnId });
    assert.ok(checkpoint.ok, checkpoint.error);
    assert.ok(checkpoint.checkpoint_sha, 'Checkpoint SHA should be returned');

    // Read state after checkpoint
    const stateAfterCheckpoint = readState(root);
    const refAfterCheckpoint = stateAfterCheckpoint.accepted_integration_ref;

    // The ref should now be git:<checkpoint_sha>
    assert.equal(refAfterCheckpoint, `git:${checkpoint.checkpoint_sha}`,
      'accepted_integration_ref should match the checkpoint SHA');
    assert.notEqual(refAfterCheckpoint, refAfterAccept,
      'accepted_integration_ref should have changed from pre-checkpoint value');
  });

  it('no false drift reported after clean checkpoint', () => {
    const { root, config, state } = createProject();

    // Assign, write, accept, checkpoint
    const assign = assignGovernedTurn(root, config, 'pm');
    assert.ok(assign.ok, assign.error);
    writeFileSync(join(root, '.planning', 'MARKETING_COPY.md'), '# Copy\n');
    stageTurnResult(root, assign.turn.turn_id, {
      schema_version: '1.0',
      turn_id: assign.turn.turn_id,
      run_id: state.run_id,
      role: 'pm',
      runtime_id: 'manual-pm',
      status: 'completed',
      summary: 'Copy done',
      artifact: { type: 'workspace', path: '.' },
      files_changed: ['.planning/MARKETING_COPY.md'],
      decisions: [],
      objections: [],
      verification: { status: 'pass' },
      proposed_next_role: 'pm',
    });
    const accept = acceptGovernedTurn(root, config);
    assert.ok(accept.ok, accept.error);
    const checkpoint = checkpointAcceptedTurn(root, { turnId: assign.turn.turn_id });
    assert.ok(checkpoint.ok, checkpoint.error);

    // Get current HEAD
    const currentHead = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
    const stateData = readState(root);

    // accepted_integration_ref should match HEAD (the checkpoint)
    assert.equal(stateData.accepted_integration_ref, `git:${currentHead}`,
      'accepted_integration_ref should match current HEAD after checkpoint');
  });
});
