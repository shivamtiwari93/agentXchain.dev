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
  const dir = mkdtempSync(join(tmpdir(), 'agentxchain-escalation-e2e-'));
  scaffoldGoverned(dir, 'Escalation E2E Fixture', 'escalation-e2e-fixture');
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

function readLedger(dir) {
  const raw = readFileSync(join(dir, '.agentxchain', 'decision-ledger.jsonl'), 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter((l) => l.trim()).map((line) => JSON.parse(line));
}

function writeTurnResult(dir, turn, runId) {
  const result = {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Escalation E2E fixture turn completed.',
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
  };
  writeFileSync(join(dir, '.agentxchain', 'staging', 'turn-result.json'), JSON.stringify(result, null, 2));
}

describe('escalation recovery E2E', () => {
  it('AT-ESC-E2E-001..003: escalate with retained turn → status → resume re-dispatches same turn', () => {
    const dir = makeProject();

    try {
      // Initialize run and assign a turn
      const context = loadProjectContext(dir);
      assert.ok(context, 'expected governed project context');
      const init = initializeGovernedRun(dir, context.config);
      assert.ok(init.ok, init.error);
      const assign = assignGovernedTurn(dir, context.config, 'pm');
      assert.ok(assign.ok, assign.error);

      const firstTurn = Object.values(assign.state.active_turns || {})[0];
      assert.ok(firstTurn, 'expected initial turn assignment');

      // Escalate — should block run with turn retained
      const escalate = runCli(dir, ['escalate', '--reason', 'Security review required before proceeding']);
      assert.equal(escalate.status, 0, `escalate failed: ${escalate.combined}`);

      // Verify blocked state
      const blockedState = readState(dir);
      assert.equal(blockedState.status, 'blocked', 'run should be blocked after escalation');
      assert.ok(
        blockedState.blocked_on.startsWith('escalation:operator:'),
        `blocked_on should start with escalation:operator:, got: ${blockedState.blocked_on}`
      );
      assert.equal(blockedState.blocked_reason.category, 'operator_escalation');

      // Verify turn is retained
      const retainedTurn = Object.values(blockedState.active_turns || {})[0];
      assert.ok(retainedTurn, 'turn should be retained during escalation');
      assert.equal(retainedTurn.turn_id, firstTurn.turn_id, 'retained turn should be the same as the original');

      // Status should show escalation details with retained turn
      const status = runCli(dir, ['status']);
      assert.equal(status.status, 0, `status failed: ${status.combined}`);
      assert.match(status.stdout, /Reason:\s+operator_escalation/, 'status should show operator_escalation');
      assert.match(status.stdout, /Owner:\s+human/, 'status should show human owner');
      assert.match(status.stdout, /agentxchain resume/, 'status should recommend resume for retained manual turn');
      assert.match(status.stdout, /Turn:\s+retained/, 'status should show turn retained');

      // Recover via resume — re-dispatches the retained turn without waiting for manual completion
      const resume = runCli(dir, ['resume']);
      assert.equal(resume.status, 0, `resume failed: ${resume.combined}`);
      assert.match(resume.stdout, /Re-dispatching blocked turn/, 'resume should re-dispatch the retained turn');

      // Verify run is active again
      const resumedState = readState(dir);
      assert.equal(resumedState.status, 'active', 'run should be active after recovery');
      assert.equal(resumedState.blocked_on, null, 'blocked_on should be cleared');
      assert.equal(resumedState.blocked_reason, null, 'blocked_reason should be cleared');
      assert.equal(resumedState.escalation, null, 'escalation should be cleared');

      // Verify dispatch bundle was materialized for re-dispatched turn
      const dispatchDir = join(dir, '.agentxchain', 'dispatch', 'turns', firstTurn.turn_id);
      assert.ok(existsSync(join(dispatchDir, 'PROMPT.md')), 'resume must materialize PROMPT.md for retained turn');

      // Verify the same turn was re-dispatched (not a new turn)
      const resumedTurn = Object.values(resumedState.active_turns || {})[0];
      assert.ok(resumedTurn, 'retained turn should still be active after resume');
      assert.equal(resumedTurn.turn_id, firstTurn.turn_id, 'resume should re-dispatch the same turn, not assign a new one');

      // Verify decision ledger has both entries
      const history = readLedger(dir);
      const escalatedEntry = history.find((e) => e.decision === 'operator_escalated');
      assert.ok(escalatedEntry, 'ledger should contain operator_escalated entry');
      assert.ok(escalatedEntry.escalation, 'escalated entry should have escalation metadata');
      assert.equal(escalatedEntry.escalation.reason, 'Security review required before proceeding');

      const resolvedEntry = history.find((e) => e.decision === 'escalation_resolved');
      assert.ok(resolvedEntry, 'ledger should contain escalation_resolved entry');
      assert.ok(resolvedEntry.resolved_via, 'resolved entry should have resolved_via field');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-ESC-E2E-004..007: escalate without retained turn → status → resume assigns next turn', () => {
    const dir = makeProject();

    try {
      // Initialize run, assign a turn, and complete it
      const context = loadProjectContext(dir);
      assert.ok(context, 'expected governed project context');
      const init = initializeGovernedRun(dir, context.config);
      assert.ok(init.ok, init.error);
      const assign = assignGovernedTurn(dir, context.config, 'pm');
      assert.ok(assign.ok, assign.error);

      const firstTurn = Object.values(assign.state.active_turns || {})[0];
      assert.ok(firstTurn, 'expected initial turn assignment');

      // Complete the turn via accept-turn
      writeTurnResult(dir, firstTurn, assign.state.run_id);
      const accept = runCli(dir, ['accept-turn']);
      assert.equal(accept.status, 0, `accept-turn failed: ${accept.combined}`);

      // Verify run is active with no active turns
      const activeState = readState(dir);
      assert.equal(activeState.status, 'active');
      const activeTurns = Object.values(activeState.active_turns || {}).filter((t) => t.status === 'active' || t.status === 'assigned');
      assert.equal(activeTurns.length, 0, 'no active turns after accept-turn');

      // Escalate at run level — no retained turn
      const escalate = runCli(dir, ['escalate', '--reason', 'Architecture review needed before next phase']);
      assert.equal(escalate.status, 0, `escalate failed: ${escalate.combined}`);

      // Verify blocked state without retained turn
      const blockedState = readState(dir);
      assert.equal(blockedState.status, 'blocked');
      assert.ok(blockedState.blocked_on.startsWith('escalation:operator:'));
      assert.equal(blockedState.blocked_reason.category, 'operator_escalation');

      // Status should show escalation with resume recovery
      const status = runCli(dir, ['status']);
      assert.equal(status.status, 0, `status failed: ${status.combined}`);
      assert.match(status.stdout, /Reason:\s+operator_escalation/);
      assert.match(status.stdout, /Owner:\s+human/);
      assert.match(status.stdout, /Action:\s+Resolve the escalation, then run agentxchain resume/);
      assert.match(status.stdout, /Turn:\s+cleared/, 'status should show turn cleared');

      // Recover via resume — should assign next turn
      const resume = runCli(dir, ['resume']);
      assert.equal(resume.status, 0, `resume failed: ${resume.combined}`);
      assert.match(resume.stdout, /Resumed blocked run:/, 'resume should confirm reactivation');

      // Verify run is active with a new turn assigned
      const resumedState = readState(dir);
      assert.equal(resumedState.status, 'active', 'run should be active after recovery');
      assert.equal(resumedState.blocked_on, null);
      assert.equal(resumedState.blocked_reason, null);
      assert.equal(resumedState.escalation, null);

      const newTurns = Object.values(resumedState.active_turns || {});
      assert.ok(newTurns.length > 0, 'resume should assign a new turn after run-level escalation recovery');

      const newTurn = newTurns[0];
      assert.notEqual(newTurn.turn_id, firstTurn.turn_id, 'new turn should be different from the completed one');

      // Verify dispatch bundle materialized for the new turn
      assert.ok(
        existsSync(join(dir, '.agentxchain', 'dispatch', 'turns', newTurn.turn_id, 'PROMPT.md')),
        'resume must materialize dispatch bundle for the new turn'
      );

      // Verify decision ledger completeness
      const history = readLedger(dir);
      const escalatedEntry = history.find((e) => e.decision === 'operator_escalated');
      assert.ok(escalatedEntry, 'ledger should contain operator_escalated entry');
      assert.equal(escalatedEntry.escalation.reason, 'Architecture review needed before next phase');

      const resolvedEntry = history.find((e) => e.decision === 'escalation_resolved');
      assert.ok(resolvedEntry, 'ledger should contain escalation_resolved entry');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
