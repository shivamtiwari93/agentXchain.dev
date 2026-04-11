import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';
import { loadProjectContext } from '../src/lib/config.js';
import { assignGovernedTurn, initializeGovernedRun } from '../src/lib/governed-state.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_BIN = join(cliRoot, 'bin', 'agentxchain.js');
const MOCK_AGENT = join(cliRoot, 'test-support', 'mock-agent.mjs');

const tempDirs = [];

function makeProject({ withTimeouts = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-run-provenance-e2e-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Run Provenance E2E', `run-provenance-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const mockRuntime = {
    type: 'local_cli',
    command: process.execPath,
    args: [MOCK_AGENT],
    prompt_transport: 'dispatch_bundle_only',
  };

  for (const runtimeId of Object.keys(config.runtimes || {})) {
    config.runtimes[runtimeId] = { ...mockRuntime };
  }
  for (const role of Object.values(config.roles || {})) {
    role.write_authority = 'authoritative';
  }

  if (withTimeouts) {
    config.timeouts = { per_turn_minutes: 1, action: 'escalate' };
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  return root;
}

function runCli(root, args, opts = {}) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: opts.timeout || 60000,
    env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function readState(root) {
  return JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
}

function readRunHistory(root) {
  const raw = readFileSync(join(root, '.agentxchain', 'run-history.jsonl'), 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function writeCompletedTurnResult(root, turn, runId) {
  const result = {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Run provenance E2E blocked-parent fixture turn completed.',
    decisions: [{
      id: 'DEC-101',
      category: 'implementation',
      statement: 'Blocked parent run was created through the real acceptance path.',
      rationale: 'Recovery provenance must be proven against a terminal blocked parent.',
    }],
    objections: [{
      id: 'OBJ-101',
      severity: 'low',
      statement: 'No blocker.',
      status: 'raised',
    }],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['echo ok'],
      evidence_summary: 'Fixture verification passed.',
      machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
    },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'pm',
    phase_transition_request: null,
    run_completion_request: false,
    needs_human_reason: null,
    cost: { input_tokens: 100, output_tokens: 50, usd: 0.01 },
  };

  writeJson(join(root, '.agentxchain', 'staging', 'turn-result.json'), result);
}

function createBlockedParentRun(root) {
  const context = loadProjectContext(root);
  assert.ok(context, 'expected governed project context');

  const init = initializeGovernedRun(root, context.config);
  assert.ok(init.ok, init.error);

  const assign = assignGovernedTurn(root, context.config, 'pm');
  assert.ok(assign.ok, assign.error);

  const statePath = join(root, '.agentxchain', 'state.json');
  const state = readState(root);
  const turnId = Object.keys(state.active_turns)[0];
  state.active_turns[turnId].started_at = '2026-04-10T00:00:00.000Z';
  writeJson(statePath, state);

  const timedOutState = readState(root);
  const turn = timedOutState.active_turns[turnId];
  writeCompletedTurnResult(root, turn, timedOutState.run_id);

  const accept = runCli(root, ['accept-turn']);
  assert.equal(accept.status, 0, `accept-turn failed:\n${accept.combined}`);
  assert.match(accept.stdout, /Turn Accepted/);

  const blockedState = readState(root);
  assert.equal(blockedState.status, 'blocked', 'parent run must end blocked');

  const history = readRunHistory(root);
  assert.equal(history.length, 1, 'blocked parent must be recorded in run-history');
  assert.equal(history[0].status, 'blocked');

  return blockedState.run_id;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('run provenance E2E', () => {
  it('AT-PROV-E2E-001: plain run after completed state initializes a fresh manual run', () => {
    const root = makeProject();

    const firstRun = runCli(root, ['run', '--auto-approve', '--max-turns', '5']);
    assert.equal(firstRun.status, 0, `first run failed:\n${firstRun.combined}`);
    assert.match(firstRun.stdout, /Run completed/);

    const firstState = readState(root);
    const firstRunId = firstState.run_id;
    assert.equal(firstState.status, 'completed');

    const secondRun = runCli(root, ['run', '--auto-approve', '--max-turns', '5']);
    assert.equal(secondRun.status, 0, `second run failed:\n${secondRun.combined}`);
    assert.match(secondRun.stdout, /Turn assigned:/, 'fresh run must execute turns, not reuse terminal state');
    assert.match(secondRun.stdout, /Turns:\s+3/, 'fresh manual rerun must execute the governed lifecycle');

    const secondState = readState(root);
    assert.equal(secondState.status, 'completed');
    assert.notEqual(secondState.run_id, firstRunId, 'plain rerun must create a new run id');
    assert.deepEqual(secondState.provenance, {
      trigger: 'manual',
      parent_run_id: null,
      trigger_reason: null,
      intake_intent_id: null,
      created_by: 'operator',
    });

    const history = readRunHistory(root);
    assert.equal(history.length, 2, 'fresh rerun must append a second run-history entry');
    assert.equal(history[1].run_id, secondState.run_id);
    assert.equal(history[1].provenance.trigger, 'manual');
  });

  it('AT-PROV-E2E-002: --continue-from on a completed repo state initializes a new continuation run', () => {
    const root = makeProject();

    const firstRun = runCli(root, ['run', '--auto-approve', '--max-turns', '5']);
    assert.equal(firstRun.status, 0, `first run failed:\n${firstRun.combined}`);

    const firstState = readState(root);
    const parentRunId = firstState.run_id;
    assert.equal(firstState.status, 'completed');

    const continued = runCli(root, ['run', '--auto-approve', '--max-turns', '5', '--continue-from', parentRunId]);
    assert.equal(continued.status, 0, `continue-from run failed:\n${continued.combined}`);
    assert.match(continued.stdout, /Turn assigned:/, 'continuation run must execute turns');
    assert.match(continued.stdout, /Turns:\s+3/, 'continuation run must not short-circuit at 0 turns');

    const continuedState = readState(root);
    assert.equal(continuedState.status, 'completed');
    assert.notEqual(continuedState.run_id, parentRunId, 'continuation must create a new run id');
    assert.equal(continuedState.provenance.trigger, 'continuation');
    assert.equal(continuedState.provenance.parent_run_id, parentRunId);
    assert.equal(continuedState.provenance.created_by, 'operator');

    const history = readRunHistory(root);
    assert.equal(history.length, 2, 'continuation must append a new run-history entry');
    assert.equal(history[1].run_id, continuedState.run_id);
    assert.equal(history[1].provenance.trigger, 'continuation');
    assert.equal(history[1].provenance.parent_run_id, parentRunId);
  });

  it('AT-PROV-E2E-003: --recover-from bootstraps a new run from a blocked parent', () => {
    const root = makeProject({ withTimeouts: true });
    const blockedRunId = createBlockedParentRun(root);

    const recovered = runCli(root, ['run', '--auto-approve', '--max-turns', '5', '--recover-from', blockedRunId]);
    assert.equal(recovered.status, 0, `recover-from run failed:\n${recovered.combined}`);
    assert.match(recovered.stdout, /Turn assigned:/, 'recovery run must execute turns');
    assert.match(recovered.stdout, /Run completed/);
    assert.match(recovered.stdout, /Turns:\s+3/, 'recovery run must not short-circuit at 0 turns');

    const recoveredState = readState(root);
    assert.equal(recoveredState.status, 'completed');
    assert.notEqual(recoveredState.run_id, blockedRunId, 'recovery must create a new run id');
    assert.equal(recoveredState.provenance.trigger, 'recovery');
    assert.equal(recoveredState.provenance.parent_run_id, blockedRunId);

    const history = readRunHistory(root);
    assert.equal(history.length, 2, 'recovery must append a second run-history entry');
    assert.equal(history[0].run_id, blockedRunId);
    assert.equal(history[0].status, 'blocked');
    assert.equal(history[1].run_id, recoveredState.run_id);
    assert.equal(history[1].provenance.trigger, 'recovery');
    assert.equal(history[1].provenance.parent_run_id, blockedRunId);
  });
});
