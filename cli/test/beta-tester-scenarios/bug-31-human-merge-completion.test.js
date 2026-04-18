/**
 * BUG-31 beta-tester scenario: `accept-turn --resolution human_merge`
 * must resolve a conflicted turn in one invocation.
 *
 * Tester sequence:
 *   1. Start a governed repo with two concurrent authoritative turns.
 *   2. Accept the first overlapping turn so the second becomes conflicted.
 *   3. Run `accept-turn --resolution human_merge` on the conflicted turn.
 *   4. Expect terminal acceptance plus durable conflict-resolution evidence.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  normalizeGovernedStateShape,
} from '../../src/lib/governed-state.js';
import { getTurnStagingResultPath } from '../../src/lib/turn-paths.js';
import { readRunEvents } from '../../src/lib/run-events.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', '..', 'bin', 'agentxchain.js');
const tempDirs = [];

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'bug31-test', name: 'BUG-31 Test', default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-dev',
        runtime: 'local-dev',
      },
      qa: {
        title: 'QA',
        mandate: 'Verify',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-qa',
        runtime: 'local-qa',
      },
    },
    runtimes: {
      'local-dev': { type: 'local_cli', command: ['echo', 'dev'], prompt_transport: 'dispatch_bundle_only' },
      'local-qa': { type: 'local_cli', command: ['echo', 'qa'], prompt_transport: 'dispatch_bundle_only' },
    },
    phases: [{ id: 'planning', name: 'Planning' }],
    routing: {
      planning: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'qa'],
        max_concurrent_turns: 2,
      },
    },
    gates: {},
  };
}

function createProject(config) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug31-'));
  tempDirs.push(root);
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, '.planning', 'shared-conflict.md'), '# Base\n');
  writeFileSync(join(root, 'README.md'), '# Test\n');
  execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  return root;
}

function readState(root) {
  return normalizeGovernedStateShape(JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'))).state;
}

function writeTurnResult(root, state, turn, filesChanged) {
  mkdirSync(join(root, '.agentxchain', 'staging', turn.turn_id), { recursive: true });
  writeFileSync(join(root, getTurnStagingResultPath(turn.turn_id)), JSON.stringify({
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: `Updated ${filesChanged.join(', ')}`,
    decisions: [],
    objections: [],
    files_changed: filesChanged,
    verification: { status: 'pass' },
    artifact: { type: 'workspace', ref: null },
    proposed_next_role: turn.assigned_role,
  }, null, 2));
}

function runCli(root, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
  });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {}
  }
});

describe('BUG-31 beta-tester scenario: human_merge completes in one command', () => {
  it('accept-turn --resolution human_merge accepts the conflicted turn and emits conflict_resolved', () => {
    const config = makeConfig();
    const root = createProject(config);

    const initResult = initializeGovernedRun(root, config);
    assert.ok(initResult.ok, `Init failed: ${initResult.error}`);

    const firstAssign = assignGovernedTurn(root, config, 'dev');
    assert.ok(firstAssign.ok, `First assign failed: ${firstAssign.error}`);

    const secondAssign = assignGovernedTurn(root, config, 'qa');
    assert.ok(secondAssign.ok, `Second assign failed: ${secondAssign.error}`);

    const stateAfterAssign = readState(root);
    const firstTurn = stateAfterAssign.active_turns[firstAssign.turn.turn_id];
    const secondTurn = stateAfterAssign.active_turns[secondAssign.turn.turn_id];
    const sharedFile = '.planning/shared-conflict.md';

    writeFileSync(join(root, sharedFile), '# Shared\nupdated\n');
    writeTurnResult(root, stateAfterAssign, firstTurn, [sharedFile]);
    const firstAccepted = acceptGovernedTurn(root, config, { turnId: firstTurn.turn_id });
    assert.ok(firstAccepted.ok, `First accept failed: ${firstAccepted.error}`);

    const stateAfterFirstAccept = readState(root);
    writeTurnResult(root, stateAfterFirstAccept, stateAfterFirstAccept.active_turns[secondTurn.turn_id], [sharedFile, 'TALK.md']);
    const conflictResult = acceptGovernedTurn(root, config, { turnId: secondTurn.turn_id });
    assert.equal(conflictResult.ok, false, 'second accept must conflict before human_merge');
    assert.equal(conflictResult.error_code, 'conflict');

    const mergeResult = runCli(root, ['accept-turn', '--turn', secondTurn.turn_id, '--resolution', 'human_merge']);
    assert.equal(
      mergeResult.status,
      0,
      `human_merge must exit 0 and accept in one invocation.\nstdout:\n${mergeResult.stdout}\nstderr:\n${mergeResult.stderr}`,
    );

    const finalState = readState(root);
    assert.equal(finalState.last_completed_turn_id, secondTurn.turn_id);
    assert.equal(Object.keys(finalState.active_turns).length, 0, 'no conflicted active turn should remain');

    const history = readFileSync(join(root, '.agentxchain', 'history.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const mergedEntry = history.find((entry) => entry.turn_id === secondTurn.turn_id);
    assert.ok(mergedEntry, 'merged turn must be written to history');
    assert.equal(mergedEntry.conflict_resolution?.mode, 'human_merge');
    assert.equal(mergedEntry.conflict_resolution?.merge_strategy, 'operator_authoritative_staged_result');

    const ledger = readFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.ok(
      ledger.some((entry) => entry.decision === 'conflict_resolved' && entry.turn_id === secondTurn.turn_id),
      'decision ledger must record conflict_resolved for the merged turn',
    );

    const events = readRunEvents(root);
    assert.ok(
      events.some((entry) => entry.event_type === 'conflict_resolved' && entry.turn?.turn_id === secondTurn.turn_id),
      'run events must include conflict_resolved for the merged turn',
    );
  });
});
