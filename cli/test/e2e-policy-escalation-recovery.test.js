import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';
import { loadProjectContext } from '../src/lib/config.js';
import { assignGovernedTurn, initializeGovernedRun } from '../src/lib/governed-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function makeProject() {
  const dir = mkdtempSync(join(tmpdir(), 'agentxchain-policy-e2e-'));
  scaffoldGoverned(dir, 'Policy E2E Fixture', 'policy-e2e-fixture');
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });

  const configPath = join(dir, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.policies = [
    {
      id: 'total-turn-cap',
      rule: 'max_total_turns',
      params: { limit: 1 },
      action: 'escalate',
    },
  ];
  writeFileSync(configPath, JSON.stringify(config, null, 2));
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

function readLedger(dir) {
  const raw = readFileSync(join(dir, '.agentxchain', 'decision-ledger.jsonl'), 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function writeTurnResult(dir, turn, runId, overrides = {}) {
  const result = {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Policy E2E fixture turn completed.',
    decisions: [{ id: 'DEC-001', category: 'implementation', statement: 'Fixture decision.', rationale: 'E2E proof.' }],
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
    cost: { input_tokens: 100, output_tokens: 50, usd: 0.01 },
    ...overrides,
  };
  writeFileSync(join(dir, '.agentxchain', 'staging', 'turn-result.json'), JSON.stringify(result, null, 2));
}

describe('policy escalation recovery E2E', () => {
  it('surfaces runtime-aware recovery from accept-turn through status and resume', () => {
    const dir = makeProject();

    try {
      const context = loadProjectContext(dir);
      assert.ok(context, 'expected governed project context');

      const init = initializeGovernedRun(dir, context.config);
      assert.ok(init.ok, init.error);

      const firstAssign = assignGovernedTurn(dir, context.config, 'pm');
      assert.ok(firstAssign.ok, firstAssign.error);
      const firstTurn = Object.values(firstAssign.state.active_turns || {})[0];
      assert.ok(firstTurn, 'expected first turn assignment');

      writeTurnResult(dir, firstTurn, firstAssign.state.run_id);
      const firstAccept = runCli(dir, ['accept-turn']);
      assert.equal(firstAccept.status, 0, `first accept-turn failed: ${firstAccept.combined}`);

      const secondDispatch = runCli(dir, ['resume', '--role', 'pm']);
      assert.equal(secondDispatch.status, 0, `resume --role pm failed: ${secondDispatch.combined}`);
      const dispatchedState = readState(dir);
      const secondTurn = Object.values(dispatchedState.active_turns || {})[0];
      assert.ok(secondTurn, 'expected second turn assignment');
      assert.notEqual(secondTurn.turn_id, firstTurn.turn_id, 'expected a new turn before escalation');

      writeTurnResult(dir, secondTurn, dispatchedState.run_id);
      const escalatedAccept = runCli(dir, ['accept-turn']);
      assert.equal(escalatedAccept.status, 1, 'policy escalation should fail the accept-turn command');
      assert.match(escalatedAccept.stdout, /Turn Acceptance Escalated By Policy/);
      assert.match(escalatedAccept.stdout, /Policy:\s+total-turn-cap \(max_total_turns\)/);
      assert.match(escalatedAccept.stdout, /Reason:\s+policy_escalation/);
      assert.match(escalatedAccept.stdout, /Action:\s+Resolve policy "total-turn-cap" condition, then run agentxchain resume/);
      assert.match(escalatedAccept.stdout, /Turn:\s+retained/);

      const blockedState = readState(dir);
      assert.equal(blockedState.status, 'blocked');
      assert.equal(blockedState.blocked_on, 'policy:total-turn-cap');
      assert.equal(blockedState.blocked_reason.category, 'policy_escalation');
      assert.equal(blockedState.blocked_reason.recovery.typed_reason, 'policy_escalation');
      assert.equal(
        blockedState.blocked_reason.recovery.recovery_action,
        'Resolve policy "total-turn-cap" condition, then run agentxchain resume',
      );
      assert.match(blockedState.blocked_reason.recovery.detail, /run has reached 1\/1 total accepted turns/);

      const status = runCli(dir, ['status']);
      assert.equal(status.status, 0, `status failed: ${status.combined}`);
      assert.match(status.stdout, /Reason:\s+policy_escalation/);
      assert.match(status.stdout, /Action:\s+Resolve policy "total-turn-cap" condition, then run agentxchain resume/);
      assert.match(status.stdout, /Turn:\s+retained/);

      const ledger = readLedger(dir);
      const policyEntry = ledger.find((entry) => entry.decision === 'policy_escalation');
      assert.ok(policyEntry, 'decision ledger should record policy_escalation');
      assert.equal(policyEntry.violations[0].policy_id, 'total-turn-cap');

      const resume = runCli(dir, ['resume']);
      assert.equal(resume.status, 0, `resume failed: ${resume.combined}`);
      assert.match(resume.stdout, /Re-dispatching blocked turn/);

      const resumedState = readState(dir);
      assert.equal(resumedState.status, 'active');
      assert.equal(resumedState.blocked_on, null);
      assert.equal(resumedState.blocked_reason, null);
      const resumedTurn = Object.values(resumedState.active_turns || {})[0];
      assert.ok(resumedTurn, 'retained turn should still be active after resume');
      assert.equal(resumedTurn.turn_id, secondTurn.turn_id, 'resume should redispatch the same retained turn');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
