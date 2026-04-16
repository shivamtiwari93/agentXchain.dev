import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';
import { loadProjectContext } from '../src/lib/config.js';
import { assignGovernedTurn, initializeGovernedRun } from '../src/lib/governed-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function makeProject(timeoutOverrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agentxchain-timeout-e2e-'));
  scaffoldGoverned(dir, 'Timeout E2E Fixture', 'timeout-e2e-fixture');
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });

  const configPath = join(dir, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.timeouts = { per_turn_minutes: 1, action: 'escalate', ...timeoutOverrides };
  writeJson(configPath, config);

  return dir;
}

function runCli(dir, args) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function primeAssignedTurn(dir, context, role = 'pm') {
  const init = initializeGovernedRun(dir, context.config);
  assert.ok(init.ok, init.error);
  const assign = assignGovernedTurn(dir, context.config, role);
  assert.ok(assign.ok, assign.error);

  const statePath = join(dir, '.agentxchain', 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  const turnId = Object.keys(state.active_turns)[0];
  assert.ok(turnId, 'expected an assigned turn');
  return { statePath, state, turnId };
}

function writePassingTurnResult(dir, turn, runId, summary) {
  const result = {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary,
    decisions: [{ id: 'DEC-201', category: 'implementation', statement: 'Accepted work should survive timeout escalation.', rationale: 'Operator review happens after acceptance.' }],
    objections: [{ id: 'OBJ-201', severity: 'low', statement: 'No blocker.', status: 'raised' }],
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
  writeJson(join(dir, '.agentxchain', 'staging', 'turn-result.json'), result);
}

describe('timeout blocking E2E', () => {
  it('AT-TIMEOUT-001A: accept-turn preserves accepted work and blocks the run on timeout', () => {
    const dir = makeProject();

    try {
      const context = loadProjectContext(dir);
      assert.ok(context, 'expected governed project context');
      const { statePath, state, turnId } = primeAssignedTurn(dir, context);
      state.active_turns[turnId].started_at = '2026-04-10T00:00:00.000Z';
      writeJson(statePath, state);

      const timedOutState = JSON.parse(readFileSync(statePath, 'utf8'));
      const turn = timedOutState.active_turns[turnId];
      writePassingTurnResult(dir, turn, timedOutState.run_id, 'Timeout E2E fixture accepted work.');

      const accept = runCli(dir, ['accept-turn']);
      assert.equal(accept.status, 0, accept.combined);
      assert.match(accept.stdout, /Turn Accepted/);
      assert.match(accept.stdout, /Reason:\s+timeout/);
      assert.match(accept.stdout, /Action:\s+agentxchain resume/);
      assert.match(accept.stdout, /Detail:\s+Turn timeout:/);

      const blockedState = JSON.parse(readFileSync(statePath, 'utf8'));
      assert.equal(blockedState.status, 'blocked');
      assert.equal(blockedState.blocked_on, 'timeout:turn');

      const historyLines = readFileSync(join(dir, '.agentxchain', 'history.jsonl'), 'utf8').trim().split('\n').filter(Boolean);
      assert.equal(historyLines.length, 1);
      assert.equal(JSON.parse(historyLines[0]).turn_id, turnId);

      const status = runCli(dir, ['status']);
      assert.equal(status.status, 0, status.combined);
      assert.match(status.stdout, /Blocked:\s+BLOCKED/);
      assert.match(status.stdout, /Reason:\s+timeout/);
      assert.match(status.stdout, /Action:\s+agentxchain resume/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-TIMEOUT-002A: phase timeout blocks at accept-turn and reports phase-specific recovery detail', () => {
    const dir = makeProject({ per_phase_minutes: 1, per_turn_minutes: 60 });

    try {
      const context = loadProjectContext(dir);
      assert.ok(context, 'expected governed project context');
      const { statePath, state, turnId } = primeAssignedTurn(dir, context);
      state.phase_entered_at = '2026-04-10T00:00:00.000Z';
      // Use a recent timestamp so the turn itself is within the 60-minute limit
      state.active_turns[turnId].started_at = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      writeJson(statePath, state);

      const timedOutState = JSON.parse(readFileSync(statePath, 'utf8'));
      const turn = timedOutState.active_turns[turnId];
      writePassingTurnResult(dir, turn, timedOutState.run_id, 'Phase timeout fixture accepted work.');

      const accept = runCli(dir, ['accept-turn']);
      assert.equal(accept.status, 0, accept.combined);
      assert.match(accept.stdout, /Reason:\s+timeout/);
      assert.match(accept.stdout, /Action:\s+agentxchain resume/);
      assert.match(accept.stdout, /Detail:\s+Phase timeout \(planning\):/);

      const blockedState = JSON.parse(readFileSync(statePath, 'utf8'));
      assert.equal(blockedState.status, 'blocked');
      assert.equal(blockedState.blocked_on, 'timeout:phase');

      const status = runCli(dir, ['status']);
      assert.equal(status.status, 0, status.combined);
      assert.match(status.stdout, /Reason:\s+timeout/);
      assert.match(status.stdout, /Detail:\s+Phase timeout \(planning\):/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-TIMEOUT-003A: run timeout blocks at accept-turn and reports run-specific recovery detail', () => {
    const dir = makeProject({ per_run_minutes: 1, per_turn_minutes: 60 });

    try {
      const context = loadProjectContext(dir);
      assert.ok(context, 'expected governed project context');
      const { statePath, state, turnId } = primeAssignedTurn(dir, context);
      state.created_at = '2026-04-10T00:00:00.000Z';
      // Use a recent timestamp so the turn itself is within the 60-minute limit
      state.active_turns[turnId].started_at = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      writeJson(statePath, state);

      const timedOutState = JSON.parse(readFileSync(statePath, 'utf8'));
      const turn = timedOutState.active_turns[turnId];
      writePassingTurnResult(dir, turn, timedOutState.run_id, 'Run timeout fixture accepted work.');

      const accept = runCli(dir, ['accept-turn']);
      assert.equal(accept.status, 0, accept.combined);
      assert.match(accept.stdout, /Reason:\s+timeout/);
      assert.match(accept.stdout, /Action:\s+agentxchain resume/);
      assert.match(accept.stdout, /Detail:\s+Run timeout:/);

      const blockedState = JSON.parse(readFileSync(statePath, 'utf8'));
      assert.equal(blockedState.status, 'blocked');
      assert.equal(blockedState.blocked_on, 'timeout:run');

      const status = runCli(dir, ['status']);
      assert.equal(status.status, 0, status.combined);
      assert.match(status.stdout, /Reason:\s+timeout/);
      assert.match(status.stdout, /Detail:\s+Run timeout:/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
