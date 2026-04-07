import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';
import { loadProjectContext } from '../src/lib/config.js';
import { assignGovernedTurn, initializeGovernedRun } from '../src/lib/governed-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function makeProject() {
  const dir = mkdtempSync(join(tmpdir(), 'agentxchain-budget-recovery-'));
  scaffoldGoverned(dir, 'Budget Recovery Fixture', 'budget-recovery-fixture');

  const configPath = join(dir, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.budget.per_run_max_usd = 5.0;
  config.budget.per_turn_max_usd = 2.0;
  writeFileSync(configPath, JSON.stringify(config, null, 2));

  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  return dir;
}

function runCli(dir, args) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: process.env,
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function readState(dir) {
  return JSON.parse(readFileSync(join(dir, '.agentxchain', 'state.json'), 'utf8'));
}

function writeTurnResult(dir, turn, runId, costUsd) {
  const result = {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Budget recovery fixture turn completed.',
    decisions: [{ id: 'DEC-001', category: 'implementation', statement: 'Budget exhaust path reproduced.', rationale: 'Operator recovery needs proof.' }],
    objections: [{ id: 'OBJ-001', severity: 'low', statement: 'No blocker.', status: 'raised' }],
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
    cost: { input_tokens: 100, output_tokens: 50, usd: costUsd },
  };

  writeFileSync(join(dir, '.agentxchain', 'staging', 'turn-result.json'), JSON.stringify(result, null, 2));
}

describe('budget recovery E2E', () => {
  it('AT-BUDGET-REC-001: operator raises budget in agentxchain.json and resume assigns the next turn', () => {
    const dir = makeProject();

    try {
      const context = loadProjectContext(dir);
      assert.ok(context, 'expected governed project context');
      const init = initializeGovernedRun(dir, context.config);
      assert.ok(init.ok, init.error);
      const assign = assignGovernedTurn(dir, context.config, 'pm');
      assert.ok(assign.ok, assign.error);

      const firstTurn = Object.values(assign.state.active_turns || {})[0];
      assert.ok(firstTurn, 'expected initial turn assignment');

      writeTurnResult(dir, firstTurn, assign.state.run_id, 6.0);

      const accept = runCli(dir, ['accept-turn']);
      assert.equal(accept.status, 0, accept.combined);
      assert.match(accept.stdout, /Turn Accepted/);

      const blockedState = readState(dir);
      assert.equal(blockedState.status, 'blocked');
      assert.equal(blockedState.blocked_on, 'budget:exhausted');
      assert.equal(blockedState.blocked_reason.category, 'budget_exhausted');
      assert.match(blockedState.blocked_reason.recovery.recovery_action, /agentxchain resume/);

      const blockedStatus = runCli(dir, ['status']);
      assert.equal(blockedStatus.status, 0, blockedStatus.combined);
      assert.match(blockedStatus.stdout, /Reason:\s+budget_exhausted/);
      assert.match(blockedStatus.stdout, /Increase per_run_max_usd in agentxchain\.json, then run agentxchain resume/);

      const configPath = join(dir, 'agentxchain.json');
      const updatedConfig = JSON.parse(readFileSync(configPath, 'utf8'));
      updatedConfig.budget.per_run_max_usd = 9.0;
      writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2));

      const readyStatus = runCli(dir, ['status']);
      assert.equal(readyStatus.status, 0, readyStatus.combined);
      assert.match(readyStatus.stdout, /Action:\s+Run agentxchain resume to assign the next turn/);
      assert.match(readyStatus.stdout, /Detail:\s+Budget recovery ready: spent \$6\.00 of \$9\.00 limit \(\$3\.00 remaining\)/);

      const reconciledState = readState(dir);
      assert.equal(reconciledState.budget_status.remaining_usd, 3);
      assert.equal(reconciledState.budget_status.exhausted, undefined);

      const recovered = runCli(dir, ['resume']);
      assert.equal(recovered.status, 0, recovered.combined);
      assert.match(recovered.stdout, /Resumed blocked run:/);
      assert.match(recovered.stdout, /Turn Assigned/);

      const resumedState = readState(dir);
      assert.equal(resumedState.status, 'active');
      assert.equal(resumedState.blocked_on, null);
      assert.equal(resumedState.blocked_reason, null);

      const nextTurn = Object.values(resumedState.active_turns || {})[0];
      assert.ok(nextTurn, 'expected recovered run to assign a new turn');
      assert.ok(
        existsSync(join(dir, '.agentxchain', 'dispatch', 'turns', nextTurn.turn_id, 'PROMPT.md')),
        'resume must materialize the next dispatch bundle'
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
