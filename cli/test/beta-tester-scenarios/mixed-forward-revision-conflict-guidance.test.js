/**
 * Mixed forward-revision + destructive conflict retry guidance.
 *
 * Tester sequence:
 *   1. Accept a PM-owned planning edit on `.planning/SYSTEM_SPEC.md`.
 *   2. Accept a later dev edit on `.planning/shared-conflict.md`.
 *   3. Stage a stale PM retry that touches both files.
 *   4. Trigger acceptance conflict, then run `reject-turn --reassign`.
 *   5. Expect the retry PROMPT.md to separate destructive conflict files from
 *      safe forward-revision files.
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
import { getTurnStagingResultPath, getDispatchPromptPath } from '../../src/lib/turn-paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', '..', 'bin', 'agentxchain.js');
const tempDirs = [];

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'mixed-conflict-test', name: 'Mixed Conflict Test', default_branch: 'main' },
    roles: {
      pm: {
        title: 'Product Manager',
        mandate: 'Own planning artifacts.',
        write_authority: 'review_only',
        runtime_class: 'manual',
        runtime_id: 'manual-pm',
        runtime: 'manual-pm',
      },
      dev: {
        title: 'Developer',
        mandate: 'Implement',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-dev',
        runtime: 'local-dev',
      },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'local-dev': { type: 'local_cli', command: ['echo', 'dev'], prompt_transport: 'dispatch_bundle_only' },
    },
    phases: [{ id: 'planning', name: 'Planning' }],
    routing: {
      planning: {
        entry_role: 'pm',
        allowed_next_roles: ['pm', 'dev'],
        max_concurrent_turns: 2,
      },
    },
    workflow_kit: {
      phases: {
        planning: {
          artifacts: [
            { path: '.planning/SYSTEM_SPEC.md', required: true, semantics: 'system_spec', owned_by: 'pm' },
          ],
        },
      },
    },
    gates: {},
  };
}

function createProject(config) {
  const root = mkdtempSync(join(tmpdir(), 'axc-mixed-conflict-'));
  tempDirs.push(root);
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, '.planning', 'SYSTEM_SPEC.md'), '# Base spec\n');
  writeFileSync(join(root, '.planning', 'shared-conflict.md'), '# Base shared\n');
  execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  return root;
}

function readState(root) {
  return normalizeGovernedStateShape(JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'))).state;
}

function writeTurnResult(root, state, turn, filesChanged, overrides = {}) {
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
    ...overrides,
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

describe('mixed forward revision conflict retry guidance', () => {
  it('reject-turn --reassign keeps destructive conflict files separate from forward revisions', () => {
    const config = makeConfig();
    const root = createProject(config);

    const initResult = initializeGovernedRun(root, config);
    assert.ok(initResult.ok, `Init failed: ${initResult.error}`);

    const firstPmAssign = assignGovernedTurn(root, config, 'pm');
    assert.ok(firstPmAssign.ok, `First PM assign failed: ${firstPmAssign.error}`);
    const devAssign = assignGovernedTurn(root, config, 'dev');
    assert.ok(devAssign.ok, `Dev assign failed: ${devAssign.error}`);

    writeFileSync(join(root, '.planning', 'SYSTEM_SPEC.md'), '# System Spec\n\n## Purpose\n\nInitial planning truth.\n');
    writeTurnResult(root, readState(root), firstPmAssign.turn, ['.planning/SYSTEM_SPEC.md'], {
      artifact: { type: 'review', ref: null },
      objections: [{ id: 'OBJ-001', severity: 'low', statement: 'Planning review complete.' }],
    });
    execSync('git add -A && git commit -m "pm first turn"', { cwd: root, stdio: 'ignore' });
    const firstPmAccept = acceptGovernedTurn(root, config, { turnId: firstPmAssign.turn.turn_id });
    assert.ok(firstPmAccept.ok, `First PM accept failed: ${firstPmAccept.error}`);

    const secondPmAssign = assignGovernedTurn(root, config, 'pm');
    assert.ok(secondPmAssign.ok, `Second PM assign failed: ${secondPmAssign.error}`);

    writeFileSync(join(root, '.planning', 'shared-conflict.md'), '# shared from dev\n');
    writeTurnResult(root, readState(root), devAssign.turn, ['.planning/shared-conflict.md']);
    execSync('git add -A && git commit -m "dev shared turn"', { cwd: root, stdio: 'ignore' });
    const devAccept = acceptGovernedTurn(root, config, { turnId: devAssign.turn.turn_id });
    assert.ok(devAccept.ok, `Dev accept failed: ${devAccept.error}`);

    const historyPath = join(root, '.agentxchain', 'history.jsonl');
    const historyEntries = readFileSync(historyPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    historyEntries.find((entry) => entry.turn_id === firstPmAssign.turn.turn_id).accepted_sequence = 2;
    historyEntries.find((entry) => entry.turn_id === devAssign.turn.turn_id).accepted_sequence = 3;
    writeFileSync(historyPath, historyEntries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');

    const staleState = readState(root);
    staleState.turn_sequence = 3;
    staleState.active_turns[secondPmAssign.turn.turn_id].assigned_sequence = 1;
    writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify(staleState, null, 2));

    writeFileSync(
      join(root, '.planning', 'SYSTEM_SPEC.md'),
      '# System Spec\n\n## Purpose\n\nInitial planning truth.\n\n## Interface\n\n- Revised by PM.\n',
    );
    writeFileSync(join(root, '.planning', 'shared-conflict.md'), '# shared from stale pm\n');
    writeTurnResult(
      root,
      readState(root),
      readState(root).active_turns[secondPmAssign.turn.turn_id],
      ['.planning/SYSTEM_SPEC.md', '.planning/shared-conflict.md'],
      {
        artifact: { type: 'review', ref: null },
        objections: [{ id: 'OBJ-002', severity: 'low', statement: 'Mixed overlap review complete.' }],
      },
    );
    execSync('git add -A && git commit -m "pm stale mixed turn"', { cwd: root, stdio: 'ignore' });

    const conflictResult = acceptGovernedTurn(root, config, { turnId: secondPmAssign.turn.turn_id });
    assert.equal(conflictResult.ok, false, 'stale mixed PM turn must conflict');
    assert.equal(conflictResult.error_code, 'conflict');

    const rejectResult = runCli(root, [
      'reject-turn',
      '--turn', secondPmAssign.turn.turn_id,
      '--reassign',
      '--reason', 'Rebase only the destructive overlap',
    ]);
    assert.equal(
      rejectResult.status,
      0,
      `reject-turn --reassign must succeed.\nstdout:\n${rejectResult.stdout}\nstderr:\n${rejectResult.stderr}`,
    );

    const retryState = readState(root);
    const retryTurn = retryState.active_turns[secondPmAssign.turn.turn_id];
    assert.deepEqual(retryTurn.conflict_context.conflicting_files, ['.planning/shared-conflict.md']);
    assert.deepEqual(retryTurn.conflict_context.forward_revision_files, ['.planning/SYSTEM_SPEC.md']);

    const retryPrompt = readFileSync(join(root, getDispatchPromptPath(secondPmAssign.turn.turn_id)), 'utf8');
    assert.match(retryPrompt, /Conflicting files:/);
    assert.match(retryPrompt, /\.planning\/shared-conflict\.md/);
    assert.match(retryPrompt, /Forward-revision files already safe to carry forward:/);
    assert.match(retryPrompt, /\.planning\/SYSTEM_SPEC\.md/);
    assert.match(retryPrompt, /Forward-revision turns since assignment:/);
    assert.match(retryPrompt, new RegExp(firstPmAssign.turn.turn_id));
  });
});
