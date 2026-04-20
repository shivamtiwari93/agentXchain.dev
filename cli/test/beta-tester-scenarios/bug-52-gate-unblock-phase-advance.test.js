/**
 * BUG-52 beta-tester scenario: resolving a blocked gate via `unblock` must
 * advance the phase before the dispatcher assigns another same-phase turn.
 *
 * Tester shape:
 *   1. PM turn is accepted with `phase_transition_request: "implementation"`
 *   2. `accept-turn --checkpoint` succeeds
 *   3. The run is later blocked behind a human escalation tied to the failed
 *      planning gate
 *   4. The gate artifacts are now satisfied on disk
 *   5. `unblock <hesc_*>` must advance to implementation and dispatch `dev`
 *      instead of redispatching another PM turn in planning
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  initializeGovernedRun,
  assignGovernedTurn,
} from '../../src/lib/governed-state.js';
import { getTurnStagingResultPath } from '../../src/lib/turn-paths.js';

const ROOT = join(import.meta.dirname, '..', '..');
const CLI_PATH = join(ROOT, 'bin', 'agentxchain.js');
const tempDirs = [];

function makeConfig() {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug52-test', name: 'BUG-52 Test', default_branch: 'main' },
    roles: {
      pm: {
        title: 'Product Manager',
        mandate: 'Drive planning.',
        write_authority: 'authoritative',
        runtime: 'manual-pm',
      },
      dev: {
        title: 'Developer',
        mandate: 'Implement approved work.',
        write_authority: 'authoritative',
        runtime: 'manual-dev',
      },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'manual-dev': { type: 'manual' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev'], exit_gate: 'implementation_complete' },
    },
    gates: {
      planning_signoff: {
        requires_files: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md'],
        requires_human_approval: true,
      },
      implementation_complete: {},
    },
    gate_semantic_coverage_mode: 'lenient',
  };
}

function createProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug52-'));
  tempDirs.push(root);

  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'README.md'), '# BUG-52\n');
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

function stageTurnResult(root, turnId, payload) {
  const resultPath = join(root, getTurnStagingResultPath(turnId));
  mkdirSync(join(root, '.agentxchain', 'staging', turnId), { recursive: true });
  writeFileSync(resultPath, JSON.stringify(payload, null, 2));
}

function runCli(root, args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NODE_NO_WARNINGS: '1',
    },
  });
}

function readState(root) {
  return JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
}

function readHumanEscalationId(root) {
  const lines = readFileSync(join(root, '.agentxchain', 'human-escalations.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const raised = lines.find((entry) => entry.kind === 'raised');
  assert.ok(raised, 'expected a raised human escalation record');
  return raised.escalation_id;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('BUG-52: unblock advances the phase before dispatch', () => {
  it('unblock moves planning -> implementation and dispatches dev instead of another pm turn', () => {
    const { root, config, state } = createProject();

    const assign = assignGovernedTurn(root, config, 'pm');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    writeFileSync(join(root, '.planning', 'ROADMAP.md'), '# Roadmap\n\n- Ship implementation handoff\n');
    writeFileSync(join(root, '.planning', 'PM_SIGNOFF.md'), 'Approved: NO\n');
    writeFileSync(
      join(root, '.planning', 'SYSTEM_SPEC.md'),
      '# System Spec\n\n## Purpose\n\nPlan the implementation handoff.\n\n## Interface\n\nPM artifacts.\n\n## Acceptance Tests\n\n- [ ] Dev can start implementation.\n',
    );

    stageTurnResult(root, turnId, {
      schema_version: '1.0',
      turn_id: turnId,
      run_id: state.run_id,
      role: 'pm',
      runtime_id: 'manual-pm',
      status: 'completed',
      summary: 'Planning artifacts drafted',
      artifact: { type: 'workspace', path: '.' },
      files_changed: ['.planning/ROADMAP.md', '.planning/PM_SIGNOFF.md', '.planning/SYSTEM_SPEC.md'],
      decisions: [],
      objections: [],
      verification: { status: 'pass' },
      proposed_next_role: 'dev',
      phase_transition_request: 'implementation',
      cost: { usd: 0.01 },
    });

    const accepted = runCli(root, ['accept-turn', '--checkpoint']);
    assert.equal(accepted.status, 0, `accept-turn --checkpoint failed:\n${accepted.stdout}\n${accepted.stderr}`);

    const afterAccept = readState(root);
    assert.equal(afterAccept.phase, 'planning');
    assert.equal(afterAccept.status, 'active');
    assert.equal(afterAccept.phase_gate_status?.planning_signoff, 'failed');
    assert.equal(afterAccept.last_gate_failure?.gate_id, 'planning_signoff');

    writeFileSync(join(root, '.planning', 'PM_SIGNOFF.md'), 'Approved: YES\n');
    execSync('git add .planning/PM_SIGNOFF.md && git commit -m "human: approve planning signoff"', {
      cwd: root,
      stdio: 'ignore',
    });

    const escalated = runCli(root, [
      'escalate',
      '--reason', 'planning_signoff',
      '--detail', 'human signoff recorded; unblock should advance the phase',
    ]);
    assert.equal(escalated.status, 0, `escalate failed:\n${escalated.stdout}\n${escalated.stderr}`);

    const escalationId = readHumanEscalationId(root);
    const unblocked = runCli(root, ['unblock', escalationId]);
    assert.equal(unblocked.status, 0, `unblock failed:\n${unblocked.stdout}\n${unblocked.stderr}`);

    const finalState = readState(root);
    const activeTurn = Object.values(finalState.active_turns || {})[0] || null;
    assert.equal(finalState.phase, 'implementation', 'phase must advance after unblock when gate now passes');
    assert.equal(finalState.phase_gate_status?.planning_signoff, 'passed', 'planning gate must be marked passed');
    assert.equal(activeTurn?.assigned_role, 'dev', 'next dispatch must target the implementation role');
    assert.equal(activeTurn?.runtime_id, 'manual-dev');
    assert.equal(finalState.last_gate_failure, null, 'reconciled gate failure must be cleared');
    assert.match(unblocked.stdout, /implementation/i, 'operator output should surface the implementation phase');
    assert.doesNotMatch(unblocked.stdout, /Role:\s+pm/i, 'unblock must not redispatch the planning role');
  });
});
