/**
 * E2E — Multi-Session Governed Continuity
 *
 * Proves two independent multi-session operator paths:
 *   1. Recovery path:
 *      - Start run + complete first turn in Session A
 *      - Resume same run + complete second turn in Session B
 *      - Block run in Session C, recover in Session D
 *   2. Phase-transition approval path:
 *      - Planning turn requests transition in Session E
 *      - Fresh process approves transition in Session F
 *      - Another fresh process resumes next-phase work in Session G
 *   3. Completion path:
 *      - Final-phase QA turn requests run completion in Session H
 *      - Fresh process approves completion in Session I
 *
 * Every "session" is a separate spawnSync invocation — a fresh process
 * with no shared in-memory state. Continuity lives entirely in
 * .agentxchain/ on disk.
 *
 * See: .planning/MULTI_SESSION_CONTINUITY_SPEC.md
 */

import { strict as assert } from 'node:assert';
import { describe, it, after } from 'node:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

// ── Helpers ──────────────────────────────────────────────────────────

function runCli(cwd, args) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
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

function readHistory(dir) {
  const raw = readFileSync(join(dir, '.agentxchain', 'history.jsonl'), 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(l => l.trim()).map(line => JSON.parse(line));
}

function readLedger(dir) {
  const raw = readFileSync(join(dir, '.agentxchain', 'decision-ledger.jsonl'), 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(l => l.trim()).map(line => JSON.parse(line));
}

function stageTurnResult(dir, turn, runId, overrides = {}) {
  const result = {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: `Multi-session continuity E2E — ${turn.assigned_role} turn.`,
    decisions: [{
      id: 'DEC-001',
      category: 'implementation',
      statement: `Session continuity proof for ${turn.assigned_role}.`,
      rationale: 'Cross-session proof.',
    }],
    objections: [{
      id: 'OBJ-001',
      severity: 'low',
      statement: 'No blocker.',
      status: 'raised',
    }],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['echo ok'],
      evidence_summary: 'Fixture pass.',
      machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
    },
    artifact: { type: 'review', ref: null },
    proposed_next_role: overrides.proposed_next_role || 'pm',
    phase_transition_request: overrides.phase_transition_request || null,
    run_completion_request: overrides.run_completion_request || false,
    needs_human_reason: null,
    cost: { input_tokens: 100, output_tokens: 50, usd: 0.01 },
    ...overrides,
  };
  // Use flat staging path (legacy path supported by acceptGovernedTurn)
  const stagingDir = join(dir, '.agentxchain', 'staging');
  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(join(stagingDir, 'turn-result.json'), JSON.stringify(result, null, 2));
}

function makePassingAcceptanceMatrix() {
  return '# Acceptance Matrix\n\n| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |\n|-------|-------------|-------------------|-------------|-------------|--------|\n| 1 | Completion flow | Fresh-session approve-completion finalizes the run | pass | 2026-04-08 | pass |\n';
}

function markPlanningGateApproved(dir) {
  writeFileSync(
    join(dir, '.planning', 'PM_SIGNOFF.md'),
    '# PM Signoff — Session Continuity Fixture\n\nApproved: YES\n\n## Discovery Checklist\n- [x] Target user defined\n- [x] Core pain point defined\n- [x] Core workflow defined\n- [x] MVP scope defined\n- [x] Out-of-scope list defined\n- [x] Success metric defined\n\n## Notes for team\nPlanning gate intentionally prepared for cross-session phase-transition approval proof.\n',
  );
  writeFileSync(
    join(dir, '.planning', 'SYSTEM_SPEC.md'),
    '# System Spec — Session Continuity Fixture\n\n## Purpose\n\nProve that cross-session phase transitions work correctly.\n\n## Interface\n\nagentxchain resume / accept-turn / approve-transition across fresh CLI sessions.\n\n## Acceptance Tests\n\n- [ ] Phase transitions persist across fresh sessions.\n',
  );
  execSync('git add .planning/PM_SIGNOFF.md .planning/SYSTEM_SPEC.md', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "approve planning signoff"', { cwd: dir, stdio: 'ignore' });
}

function createProject() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-session-continuity-'));
  scaffoldGoverned(dir, 'Session Continuity Fixture', 'session-continuity-fixture');
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  initGitRepo(dir);
  return dir;
}

function initGitRepo(dir) {
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@example.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test User"', { cwd: dir, stdio: 'ignore' });
  execSync('git add .', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "baseline"', { cwd: dir, stdio: 'ignore' });
}

function createCompletionProject() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-session-completion-'));
  scaffoldGoverned(dir, 'Session Completion Fixture', 'session-completion-fixture');
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(dir, '.planning'), { recursive: true });

  writeFileSync(join(dir, '.planning', 'acceptance-matrix.md'), makePassingAcceptanceMatrix());
  writeFileSync(join(dir, '.planning', 'ship-verdict.md'), '## Verdict: YES\n\nReady to ship.\n');
  writeFileSync(join(dir, '.planning', 'RELEASE_NOTES.md'), '# Release Notes\n\n## User Impact\n\nGoverned runs can now complete across fresh operator sessions.\n\n## Verification Summary\n\nMulti-session completion proof.\n');

  const statePath = join(dir, '.agentxchain', 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  state.phase = 'qa';
  state.status = 'idle';
  state.run_id = null;
  state.active_turns = {};
  state.completed_turns = [];
  state.turn_sequence = 0;
  state.last_completed_turn_id = null;
  state.pending_phase_transition = null;
  state.pending_run_completion = null;
  state.completed_at = null;
  state.blocked_on = null;
  state.blocked_reason = null;
  state.escalation = null;
  state.phase_gate_status = {
    planning_signoff: 'passed',
    implementation_complete: 'passed',
    qa_ship_verdict: 'pending',
  };
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');

  initGitRepo(dir);
  return dir;
}

// ── Test ─────────────────────────────────────────────────────────────

describe('E2E multi-session governed continuity', () => {
  const dirs = [];

  after(() => {
    for (const dir of dirs) {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });

  it('AT-SESSION-001,002,003,004,006: run survives across separate recovery sessions', () => {
    const dir = createProject();
    dirs.push(dir);

    // ─── Session A: Initialize run + assign + accept first turn ───
    const resumeA = runCli(dir, ['resume', '--role', 'pm']);
    assert.equal(resumeA.status, 0, `Session A resume failed: ${resumeA.combined}`);

    const stateA = readState(dir);
    assert.equal(stateA.status, 'active', 'Session A: run should be active');
    const runId = stateA.run_id;
    assert.ok(runId, 'Session A: run_id must exist');

    const turnA = Object.values(stateA.active_turns || {})[0];
    assert.ok(turnA, 'Session A: active turn must exist');
    assert.equal(turnA.assigned_role, 'pm', 'Session A: first turn assigned to pm');

    // Stage and accept turn in Session A
    stageTurnResult(dir, turnA, runId);
    const acceptA = runCli(dir, ['accept-turn']);
    assert.equal(acceptA.status, 0, `Session A accept-turn failed: ${acceptA.combined}`);

    const stateAfterA = readState(dir);
    assert.equal(stateAfterA.run_id, runId, 'Session A: run_id unchanged after acceptance');
    assert.equal(stateAfterA.last_completed_turn_id, turnA.turn_id, 'Session A: last_completed_turn_id set');

    const historyAfterA = readHistory(dir);
    assert.ok(historyAfterA.length >= 1, `Session A: history should have ≥1 entry after acceptance, got ${historyAfterA.length}`);

    const ledgerAfterA = readLedger(dir);
    assert.ok(ledgerAfterA.length >= 1, `Session A: ledger should have ≥1 entry, got ${ledgerAfterA.length}`);

    const historyCountAfterA = historyAfterA.length;
    const ledgerCountAfterA = ledgerAfterA.length;

    // ─── Session B: Fresh process — resume same run + second turn ───
    const resumeB = runCli(dir, ['resume', '--role', 'pm']);
    assert.equal(resumeB.status, 0, `Session B resume failed: ${resumeB.combined}`);

    const stateB = readState(dir);
    // AT-SESSION-001: same run_id across sessions
    assert.equal(stateB.run_id, runId, 'AT-SESSION-001: run_id must be identical across sessions');
    assert.equal(stateB.status, 'active');

    const turnB = Object.values(stateB.active_turns || {})[0];
    assert.ok(turnB, 'Session B: active turn must exist');
    assert.equal(turnB.assigned_role, 'pm', 'Session B: second turn assigned to pm');
    assert.notEqual(turnB.turn_id, turnA.turn_id, 'Session B: turn_id must differ from Session A');

    // AT-SESSION-006: turn sequence monotonicity
    assert.ok(stateB.turn_sequence > 1, `AT-SESSION-006: turn_sequence should be >1, got ${stateB.turn_sequence}`);

    // Stage and accept turn in Session B
    stageTurnResult(dir, turnB, runId);
    const acceptB = runCli(dir, ['accept-turn']);
    assert.equal(acceptB.status, 0, `Session B accept-turn failed: ${acceptB.combined}`);

    // AT-SESSION-002: cross-session history continuity
    const historyAfterB = readHistory(dir);
    assert.ok(
      historyAfterB.length > historyCountAfterA,
      `AT-SESSION-002: history should grow across sessions. Before: ${historyCountAfterA}, after: ${historyAfterB.length}`,
    );

    // AT-SESSION-003: cross-session ledger continuity
    const ledgerAfterB = readLedger(dir);
    assert.ok(
      ledgerAfterB.length >= ledgerCountAfterA + 1,
      `AT-SESSION-003: ledger should grow across sessions. Before: ${ledgerCountAfterA}, after: ${ledgerAfterB.length}`,
    );

    const stateAfterB = readState(dir);
    assert.equal(stateAfterB.last_completed_turn_id, turnB.turn_id, 'Session B: last_completed_turn_id updated');

    // ─── Session C: Block run via escalation ───
    const escalate = runCli(dir, ['escalate', '--reason', 'Cross-session recovery proof']);
    assert.equal(escalate.status, 0, `Session C escalate failed: ${escalate.combined}`);

    const stateC = readState(dir);
    assert.equal(stateC.status, 'blocked', 'Session C: run should be blocked');
    assert.ok(stateC.blocked_on, 'Session C: blocked_on must be set');
    assert.equal(stateC.blocked_reason.category, 'operator_escalation');

    // ─── Session D: Fresh process — recover from blocked ───
    const resumeD = runCli(dir, ['resume']);
    assert.equal(resumeD.status, 0, `Session D resume failed: ${resumeD.combined}`);

    const stateD = readState(dir);
    // AT-SESSION-004: cross-session blocked recovery
    assert.equal(stateD.status, 'active', 'AT-SESSION-004: run should be active after cross-session recovery');
    assert.equal(stateD.blocked_on, null, 'AT-SESSION-004: blocked_on should be cleared');
    assert.equal(stateD.blocked_reason, null, 'AT-SESSION-004: blocked_reason should be cleared');
    assert.equal(stateD.escalation, null, 'AT-SESSION-004: escalation should be cleared');
    assert.equal(stateD.run_id, runId, 'AT-SESSION-004: run_id still the same');

    const ledgerAfterD = readLedger(dir);
    const escalatedEntry = ledgerAfterD.find(e => e.decision === 'operator_escalated');
    assert.ok(escalatedEntry, 'AT-SESSION-004: ledger must have operator_escalated');
    const resolvedEntry = ledgerAfterD.find(e => e.decision === 'escalation_resolved');
    assert.ok(resolvedEntry, 'AT-SESSION-004: ledger must have escalation_resolved');

    // Session D assigns a turn after recovery — accept it to prove post-recovery continuity
    const turnD = Object.values(stateD.active_turns || {})[0];
    assert.ok(turnD, 'Session D: active turn must exist after recovery');

    stageTurnResult(dir, turnD, runId);
    const acceptD = runCli(dir, ['accept-turn']);
    assert.equal(acceptD.status, 0, `Session D accept-turn failed: ${acceptD.combined}`);

    const finalState = readState(dir);

    assert.equal(finalState.run_id, runId, 'run_id unchanged through all recovery sessions');
    assert.equal(finalState.last_completed_turn_id, turnD.turn_id, 'last_completed_turn_id updated after recovery session');

    // Verify full history spans all sessions
    const finalHistory = readHistory(dir);
    assert.ok(
      finalHistory.length >= 3,
      `final history should have ≥3 entries (one per accepted turn), got ${finalHistory.length}`,
    );

    // Verify ledger spans all sessions (turn decisions + escalation + resolution)
    const finalLedger = readLedger(dir);
    assert.ok(
      finalLedger.length >= 3,
      `final ledger should have ≥3 entries spanning all sessions, got ${finalLedger.length}`,
    );

    // AT-SESSION-006 (strengthened): turn sequence is monotonic across all sessions
    assert.ok(
      finalState.turn_sequence >= 3,
      `AT-SESSION-006: turn_sequence should be ≥3 after 3 turns, got ${finalState.turn_sequence}`,
    );
  });

  it('AT-SESSION-005: final-phase run completion can be approved in a fresh session', () => {
    const dir = createCompletionProject();
    dirs.push(dir);

    const resumeQa = runCli(dir, ['resume', '--role', 'qa']);
    assert.equal(resumeQa.status, 0, `Completion Session E resume failed: ${resumeQa.combined}`);

    const stateAfterResume = readState(dir);
    assert.equal(stateAfterResume.status, 'active', 'Completion Session E: run should be active');
    const runId = stateAfterResume.run_id;
    assert.ok(runId, 'Completion Session E: run_id must exist');

    const qaTurn = Object.values(stateAfterResume.active_turns || {})[0];
    assert.ok(qaTurn, 'Completion Session E: active QA turn must exist');
    assert.equal(qaTurn.assigned_role, 'qa', 'Completion Session E: turn must be assigned to qa');

    stageTurnResult(dir, qaTurn, runId, {
      summary: 'Final QA review complete. Requesting governed run completion.',
      proposed_next_role: 'human',
      run_completion_request: true,
    });

    const acceptQa = runCli(dir, ['accept-turn']);
    assert.equal(acceptQa.status, 0, `Completion Session E accept-turn failed: ${acceptQa.combined}`);

    const pausedState = readState(dir);
    assert.equal(pausedState.status, 'paused', 'AT-SESSION-005: run should pause for pending completion approval');
    assert.equal(pausedState.run_id, runId, 'AT-SESSION-005: run_id must remain stable before approval');
    assert.equal(pausedState.pending_run_completion?.gate, 'qa_ship_verdict', 'AT-SESSION-005: pending completion must target final gate');
    assert.equal(pausedState.pending_run_completion?.requested_by_turn, qaTurn.turn_id, 'AT-SESSION-005: pending completion must point at QA turn');

    const status = runCli(dir, ['status']);
    assert.equal(status.status, 0, `Completion Session F status failed: ${status.combined}`);
    assert.match(status.combined, /approve-completion/, 'AT-SESSION-005: status must guide the operator to approve-completion');

    const approveCompletion = runCli(dir, ['approve-completion']);
    assert.equal(approveCompletion.status, 0, `Completion Session F approve-completion failed: ${approveCompletion.combined}`);

    const finalState = readState(dir);
    assert.equal(finalState.status, 'completed', 'AT-SESSION-005: fresh-session approve-completion must complete the run');
    assert.equal(finalState.run_id, runId, 'AT-SESSION-005: run_id must remain stable after approval');
    assert.equal(finalState.pending_run_completion, null, 'AT-SESSION-005: pending completion must be cleared after approval');
    assert.equal(finalState.phase_gate_status?.qa_ship_verdict, 'passed', 'AT-SESSION-005: final gate must be marked passed after approval');
    assert.ok(finalState.completed_at, 'AT-SESSION-005: completed_at must be set');

    const finalHistory = readHistory(dir);
    assert.ok(
      finalHistory.some((entry) => entry.turn_id === qaTurn.turn_id),
      'AT-SESSION-005: history must retain the accepted QA turn that requested completion',
    );
  });

  it('AT-SESSION-007: phase transitions can be requested and approved across fresh sessions', () => {
    const dir = createProject();
    dirs.push(dir);
    markPlanningGateApproved(dir);

    const resumePlanning = runCli(dir, ['resume', '--role', 'pm']);
    assert.equal(resumePlanning.status, 0, `Transition Session E resume failed: ${resumePlanning.combined}`);

    const planningState = readState(dir);
    assert.equal(planningState.phase, 'planning', 'Transition Session E: run must start in planning');
    assert.equal(planningState.status, 'active', 'Transition Session E: run must be active before acceptance');
    const runId = planningState.run_id;
    assert.ok(runId, 'Transition Session E: run_id must exist');

    const planningTurn = Object.values(planningState.active_turns || {})[0];
    assert.ok(planningTurn, 'Transition Session E: active PM turn must exist');
    assert.equal(planningTurn.assigned_role, 'pm', 'Transition Session E: turn must be assigned to pm');

    stageTurnResult(dir, planningTurn, runId, {
      summary: 'Planning complete. Requesting transition to implementation.',
      proposed_next_role: 'human',
      phase_transition_request: 'implementation',
    });

    const acceptPlanning = runCli(dir, ['accept-turn']);
    assert.equal(acceptPlanning.status, 0, `Transition Session E accept-turn failed: ${acceptPlanning.combined}`);

    const pausedState = readState(dir);
    assert.equal(pausedState.status, 'paused', 'AT-SESSION-007: run must pause for human phase approval');
    assert.equal(pausedState.run_id, runId, 'AT-SESSION-007: run_id must remain stable before transition approval');
    assert.equal(pausedState.pending_phase_transition?.from, 'planning', 'AT-SESSION-007: pending transition must start from planning');
    assert.equal(pausedState.pending_phase_transition?.to, 'implementation', 'AT-SESSION-007: pending transition must target implementation');
    assert.equal(pausedState.pending_phase_transition?.gate, 'planning_signoff', 'AT-SESSION-007: pending transition must reference planning_signoff');
    assert.equal(pausedState.pending_phase_transition?.requested_by_turn, planningTurn.turn_id, 'AT-SESSION-007: pending transition must point at the planning turn');

    const status = runCli(dir, ['status']);
    assert.equal(status.status, 0, `Transition Session F status failed: ${status.combined}`);
    assert.match(status.combined, /approve-transition/, 'AT-SESSION-007: status must guide the operator to approve-transition');
    assert.match(status.combined, /planning.*implementation/i, 'AT-SESSION-007: status must show the requested phase change');

    const approveTransition = runCli(dir, ['approve-transition']);
    assert.equal(approveTransition.status, 0, `Transition Session F approve-transition failed: ${approveTransition.combined}`);

    const transitionedState = readState(dir);
    assert.equal(transitionedState.status, 'active', 'AT-SESSION-007: fresh-session approve-transition must reactivate the run');
    assert.equal(transitionedState.phase, 'implementation', 'AT-SESSION-007: phase must advance after approval');
    assert.equal(transitionedState.run_id, runId, 'AT-SESSION-007: run_id must remain stable after approval');
    assert.equal(transitionedState.pending_phase_transition, null, 'AT-SESSION-007: pending transition must be cleared after approval');
    assert.equal(transitionedState.phase_gate_status?.planning_signoff, 'passed', 'AT-SESSION-007: planning gate must be marked passed after approval');

    const resumeImplementation = runCli(dir, ['resume', '--role', 'dev']);
    assert.equal(resumeImplementation.status, 0, `Transition Session G resume failed: ${resumeImplementation.combined}`);

    const implementationState = readState(dir);
    assert.equal(implementationState.run_id, runId, 'AT-SESSION-007: later fresh session must stay in the same run');
    assert.equal(implementationState.phase, 'implementation', 'AT-SESSION-007: later fresh session must remain in implementation');
    const implementationTurn = Object.values(implementationState.active_turns || {})[0];
    assert.ok(implementationTurn, 'AT-SESSION-007: later fresh session must assign an implementation turn');
    assert.equal(implementationTurn.assigned_role, 'dev', 'AT-SESSION-007: later fresh session must assign the dev role');
  });
});
