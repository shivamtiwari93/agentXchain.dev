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
  reconcilePhaseAdvanceBeforeDispatch,
} from '../../src/lib/governed-state.js';
import { getDispatchTurnDir, getTurnStagingResultPath } from '../../src/lib/turn-paths.js';

const ROOT = join(import.meta.dirname, '..', '..');
const CLI_PATH = join(ROOT, 'bin', 'agentxchain.js');
const tempDirs = [];

function makePlanningConfig() {
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

function makeQaLaunchConfig() {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug52-qa-launch-test', name: 'BUG-52 QA Launch Test', default_branch: 'main' },
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
      qa: {
        title: 'QA',
        mandate: 'Verify ship readiness.',
        write_authority: 'authoritative',
        runtime: 'manual-qa',
      },
      launch: {
        title: 'Launch',
        mandate: 'Ship the approved release.',
        write_authority: 'authoritative',
        runtime: 'manual-launch',
      },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'manual-dev': { type: 'manual' },
      'manual-qa': { type: 'manual' },
      'manual-launch': { type: 'manual' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa'], exit_gate: 'implementation_complete' },
      qa: { entry_role: 'qa', allowed_next_roles: ['qa', 'launch'], exit_gate: 'qa_ship_verdict' },
      launch: { entry_role: 'launch', allowed_next_roles: ['launch'], exit_gate: 'launch_approval' },
    },
    gates: {
      planning_signoff: {
        requires_files: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md'],
        requires_human_approval: true,
      },
      implementation_complete: {},
      qa_ship_verdict: {
        requires_files: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md', '.planning/RELEASE_NOTES.md'],
        requires_human_approval: true,
      },
      launch_approval: {},
    },
    gate_semantic_coverage_mode: 'lenient',
  };
}

function createProject(config = makePlanningConfig()) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug52-'));
  tempDirs.push(root);

  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'README.md'), '# BUG-52\n');
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));

  execSync('git init -b main', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });

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

function readHistory(root) {
  const filePath = join(root, '.agentxchain', 'history.jsonl');
  const raw = readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function readEvents(root) {
  const filePath = join(root, '.agentxchain', 'events.jsonl');
  const raw = readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
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

function writeState(root, state) {
  writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2));
}

function writeHistory(root, entries) {
  const content = entries.map((entry) => JSON.stringify(entry)).join('\n');
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), content ? `${content}\n` : '');
}

function writePassingAcceptanceMatrix(root) {
  writeFileSync(
    join(root, '.planning', 'acceptance-matrix.md'),
    '# Acceptance Matrix\n\n| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |\n|-------|-------------|-------------------|-------------|-------------|--------|\n| 1 | Release readiness | Ship artifacts are complete | pass | today | pass |\n',
  );
}

function repointGateFailureToNonDeclarer(root, { turnId, role, phase, runtimeId, summary }) {
  const state = readState(root);
  const history = readHistory(root);
  history.push({
    turn_id: turnId,
    run_id: state.run_id,
    role,
    assigned_role: role,
    runtime_id: runtimeId,
    status: 'completed',
    accepted_at: new Date().toISOString(),
    phase,
    phase_transition_request: null,
    summary,
    verification: { status: 'pass' },
  });
  writeHistory(root, history);
  writeState(root, {
    ...state,
    last_completed_turn_id: turnId,
    last_gate_failure: {
      ...state.last_gate_failure,
      requested_by_turn: turnId,
    },
  });
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

    const accepted = runCli(root, ['accept-turn']);
    assert.equal(accepted.status, 0, `accept-turn failed:\n${accepted.stdout}\n${accepted.stderr}`);
    const checkpoint = runCli(root, ['checkpoint-turn', '--turn', turnId]);
    assert.equal(checkpoint.status, 0, `checkpoint-turn failed:\n${checkpoint.stdout}\n${checkpoint.stderr}`);

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

  it('unblock moves qa -> launch and dispatches launch instead of another qa turn', () => {
    const { root, config } = createProject(makeQaLaunchConfig());

    const seededState = readState(root);
    seededState.phase = 'qa';
    seededState.status = 'active';
    seededState.active_turns = {};
    seededState.phase_gate_status = {
      planning_signoff: 'passed',
      implementation_complete: 'passed',
      qa_ship_verdict: 'pending',
      launch_approval: 'pending',
    };
    seededState.pending_phase_transition = null;
    seededState.pending_run_completion = null;
    seededState.last_gate_failure = null;
    writeState(root, seededState);

    const assign = assignGovernedTurn(root, config, 'qa');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;
    const qaState = readState(root);

    writeFileSync(
      join(root, '.planning', 'acceptance-matrix.md'),
      '# Acceptance Matrix\n\n| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |\n|-------|-------------|-------------------|-------------|-------------|--------|\n| 1 | Release readiness | Ship artifacts are complete | pending | — | pending |\n',
    );
    writeFileSync(join(root, '.planning', 'ship-verdict.md'), '# Ship Verdict\n\n## Verdict: PENDING\n');
    writeFileSync(
      join(root, '.planning', 'RELEASE_NOTES.md'),
      '# Release Notes\n\n## User Impact\n\n(QA fills this during the QA phase)\n\n## Verification Summary\n\n(QA fills this during the QA phase)\n',
    );

    stageTurnResult(root, turnId, {
      schema_version: '1.0',
      turn_id: turnId,
      run_id: qaState.run_id,
      role: 'qa',
      runtime_id: 'manual-qa',
      status: 'completed',
      summary: 'QA signoff artifacts drafted',
      artifact: { type: 'workspace', path: '.' },
      files_changed: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md', '.planning/RELEASE_NOTES.md'],
      decisions: [],
      objections: [],
      verification: { status: 'pass' },
      proposed_next_role: 'launch',
      phase_transition_request: 'launch',
      cost: { usd: 0.01 },
    });

    const accepted = runCli(root, ['accept-turn']);
    assert.equal(accepted.status, 0, `accept-turn failed:\n${accepted.stdout}\n${accepted.stderr}`);
    const checkpoint = runCli(root, ['checkpoint-turn', '--turn', turnId]);
    assert.equal(checkpoint.status, 0, `checkpoint-turn failed:\n${checkpoint.stdout}\n${checkpoint.stderr}`);

    const afterAccept = readState(root);
    assert.equal(afterAccept.phase, 'qa');
    assert.equal(afterAccept.status, 'active');
    assert.equal(afterAccept.phase_gate_status?.qa_ship_verdict, 'failed');
    assert.equal(afterAccept.last_gate_failure?.gate_id, 'qa_ship_verdict');

    writePassingAcceptanceMatrix(root);
    writeFileSync(join(root, '.planning', 'ship-verdict.md'), '# Ship Verdict\n\n## Verdict: YES\n\n## QA Summary\n\nRelease is ready.\n');
    writeFileSync(
      join(root, '.planning', 'RELEASE_NOTES.md'),
      '# Release Notes\n\n## User Impact\n\nLaunch role can now take over after QA approval.\n\n## Verification Summary\n\nQA artifacts are complete and release-worthy.\n',
    );
    execSync('git add .planning/acceptance-matrix.md .planning/ship-verdict.md .planning/RELEASE_NOTES.md && git commit -m "human: approve qa ship verdict"', {
      cwd: root,
      stdio: 'ignore',
    });

    const escalated = runCli(root, [
      'escalate',
      '--reason', 'qa_ship_verdict',
      '--detail', 'ship verdict recorded; unblock should advance to launch',
    ]);
    assert.equal(escalated.status, 0, `escalate failed:\n${escalated.stdout}\n${escalated.stderr}`);

    const escalationId = readHumanEscalationId(root);
    const unblocked = runCli(root, ['unblock', escalationId]);
    assert.equal(unblocked.status, 0, `unblock failed:\n${unblocked.stdout}\n${unblocked.stderr}`);

    const finalState = readState(root);
    const activeTurn = Object.values(finalState.active_turns || {})[0] || null;
    assert.equal(finalState.phase, 'launch', 'phase must advance after unblock when qa_ship_verdict now passes');
    assert.equal(finalState.phase_gate_status?.qa_ship_verdict, 'passed', 'qa_ship_verdict must be marked passed');
    assert.equal(activeTurn?.assigned_role, 'launch', 'next dispatch must target the launch role');
    assert.equal(activeTurn?.runtime_id, 'manual-launch');
    assert.equal(finalState.last_gate_failure, null, 'reconciled gate failure must be cleared');
    assert.match(unblocked.stdout, /launch/i, 'operator output should surface the launch phase');
    assert.doesNotMatch(unblocked.stdout, /Role:\s+qa/i, 'unblock must not redispatch the qa role');
  });

  it('Turn 93: unblock advances when needs_human turn declared phase_transition_request but no gate failure was recorded', () => {
    // Tester's real-flow shape that Turn 57-60 did not cover:
    //   - PM produces a `needs_human` turn that declares `phase_transition_request: "implementation"`
    //   - accept-turn short-circuits gate evaluation for `needs_human` status
    //     (cli/src/lib/governed-state.js:4657), so `last_gate_failure` stays null
    //     and `queued_phase_transition` stays null — the request is only preserved
    //     in the history entry.
    //   - state becomes `blocked` with `blocked_on: "human:<reason>"`; an
    //     `ensureHumanEscalation` record is raised automatically.
    //   - Human fixes the gate artifacts and calls `unblock <hesc>`.
    //   - reactivate clears blocked_on; reconcilePhaseAdvanceBeforeDispatch
    //     bailed on `gateFailure?.gate_type !== 'phase_transition'` because
    //     gateFailure was null — so the dispatcher re-dispatched `pm` in planning
    //     instead of advancing to implementation.
    // Acceptance: unblock must still advance the phase using the history-declared
    // phase_transition_request even when no gate failure is recorded.
    const { root, config, state } = createProject();

    const assign = assignGovernedTurn(root, config, 'pm');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    writeFileSync(join(root, '.planning', 'ROADMAP.md'), '# Roadmap\n\n- Ship implementation handoff\n');
    writeFileSync(join(root, '.planning', 'PM_SIGNOFF.md'), 'Approved: YES\n');
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
      status: 'needs_human',
      needs_human_reason: 'Need operator confirmation before handing off to dev',
      summary: 'Planning artifacts drafted, awaiting human confirmation',
      artifact: { type: 'workspace', path: '.' },
      files_changed: ['.planning/ROADMAP.md', '.planning/PM_SIGNOFF.md', '.planning/SYSTEM_SPEC.md'],
      decisions: [],
      objections: [],
      verification: { status: 'pass' },
      proposed_next_role: 'dev',
      phase_transition_request: 'implementation',
      cost: { usd: 0.01 },
    });

    const accepted = runCli(root, ['accept-turn']);
    assert.equal(accepted.status, 0, `accept-turn failed:\n${accepted.stdout}\n${accepted.stderr}`);

    const afterAccept = readState(root);
    // Sanity: this is the gap shape. needs_human blocks the run without recording
    // a gate failure. The phase_transition_request lives only in history.
    assert.equal(afterAccept.status, 'blocked', 'needs_human must block the run');
    assert.equal(afterAccept.last_gate_failure, null, 'needs_human path must not record a gate failure');
    assert.equal(afterAccept.queued_phase_transition ?? null, null, 'needs_human path must not queue a phase transition');
    assert.ok(
      typeof afterAccept.blocked_on === 'string' && afterAccept.blocked_on.startsWith('human:'),
      `blocked_on should use the human: prefix, got "${afterAccept.blocked_on}"`,
    );

    const checkpoint = runCli(root, ['checkpoint-turn', '--turn', turnId]);
    assert.equal(checkpoint.status, 0, `checkpoint-turn failed:\n${checkpoint.stdout}\n${checkpoint.stderr}`);

    const escalationId = readHumanEscalationId(root);
    const unblocked = runCli(root, ['unblock', escalationId]);
    assert.equal(unblocked.status, 0, `unblock failed:\n${unblocked.stdout}\n${unblocked.stderr}`);

    const finalState = readState(root);
    const activeTurn = Object.values(finalState.active_turns || {})[0] || null;
    assert.equal(finalState.phase, 'implementation', 'phase must advance even when needs_human left no gate failure record');
    assert.equal(finalState.phase_gate_status?.planning_signoff, 'passed', 'planning gate must be marked passed on advance');
    assert.equal(activeTurn?.assigned_role, 'dev', 'next dispatch must target the implementation role, not another pm turn');
    assert.equal(activeTurn?.runtime_id, 'manual-dev');
    assert.doesNotMatch(unblocked.stdout, /Role:\s+pm/i, 'unblock must not redispatch the planning role on the needs_human path');
  });

  it('Turn 176: unblock advances standing pending gate and cleans stale same-phase active turn before redispatch', () => {
    const { root, config, state } = createProject();

    const assign = assignGovernedTurn(root, config, 'pm');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    writeFileSync(join(root, '.planning', 'ROADMAP.md'), '# Roadmap\n\n- Ship implementation handoff\n');
    writeFileSync(join(root, '.planning', 'PM_SIGNOFF.md'), 'Approved: YES\n');
    writeFileSync(
      join(root, '.planning', 'SYSTEM_SPEC.md'),
      '# System Spec\n\n## Purpose\n\nPlan the implementation handoff.\n\n## Interface\n\nPM artifacts.\n\n## Acceptance Tests\n\n- [x] Dev can start implementation.\n',
    );

    stageTurnResult(root, turnId, {
      schema_version: '1.0',
      turn_id: turnId,
      run_id: state.run_id,
      role: 'pm',
      runtime_id: 'manual-pm',
      status: 'needs_human',
      needs_human_reason: 'Need operator confirmation before handing off to dev',
      summary: 'Planning artifacts drafted, awaiting human confirmation',
      artifact: { type: 'workspace', path: '.' },
      files_changed: ['.planning/ROADMAP.md', '.planning/PM_SIGNOFF.md', '.planning/SYSTEM_SPEC.md'],
      decisions: [],
      objections: [],
      verification: { status: 'pass' },
      proposed_next_role: 'dev',
      phase_transition_request: 'implementation',
      cost: { usd: 0.01 },
    });

    const accepted = runCli(root, ['accept-turn']);
    assert.equal(accepted.status, 0, `accept-turn failed:\n${accepted.stdout}\n${accepted.stderr}`);

    const checkpoint = runCli(root, ['checkpoint-turn', '--turn', turnId]);
    assert.equal(checkpoint.status, 0, `checkpoint-turn failed:\n${checkpoint.stdout}\n${checkpoint.stderr}`);

    const blocked = readState(root);
    const staleTurnId = blocked.blocked_reason?.turn_id;
    assert.equal(staleTurnId, turnId, 'fixture sanity: escalation should remain tied to the accepted PM turn');

    mkdirSync(join(root, getDispatchTurnDir(staleTurnId)), { recursive: true });
    writeFileSync(join(root, getDispatchTurnDir(staleTurnId), 'PROMPT.md'), 'stale PM dispatch\n');
    writeState(root, {
      ...blocked,
      pending_phase_transition: null,
      phase_gate_status: {
        ...(blocked.phase_gate_status || {}),
        planning_signoff: 'pending',
      },
      active_turns: {
        [staleTurnId]: {
          turn_id: staleTurnId,
          run_id: blocked.run_id,
          assigned_role: 'pm',
          runtime_id: 'manual-pm',
          status: 'dispatched',
          attempt: 1,
          assigned_sequence: blocked.turn_sequence || 1,
        },
      },
      budget_reservations: {
        ...(blocked.budget_reservations || {}),
        [staleTurnId]: { reserved_usd: 0.25, reason: 'stale tester-loop reservation' },
      },
    });

    const escalationId = readHumanEscalationId(root);
    const unblocked = runCli(root, ['unblock', escalationId]);
    assert.equal(unblocked.status, 0, `unblock failed:\n${unblocked.stdout}\n${unblocked.stderr}`);

    const finalState = readState(root);
    const activeTurn = Object.values(finalState.active_turns || {})[0] || null;
    assert.equal(finalState.phase, 'implementation', 'standing pending gate must advance to implementation after unblock');
    assert.equal(finalState.phase_gate_status?.planning_signoff, 'passed', 'planning gate must be marked passed');
    assert.equal(activeTurn?.assigned_role, 'dev', 'unblock must dispatch the implementation entry role, not the stale PM role');
    assert.notEqual(activeTurn?.turn_id, staleTurnId, 'stale PM turn must be cleared before dispatching the next phase');
    assert.equal(finalState.budget_reservations?.[staleTurnId], undefined, 'stale PM budget reservation must be cleared');
    assert.doesNotMatch(unblocked.stdout, /Role:\s+pm/i, 'unblock must not redispatch PM after approval');

    const events = readEvents(root);
    const cleanup = events.find((entry) => entry.event_type === 'phase_cleanup'
      && entry.payload?.from_phase === 'planning'
      && entry.payload?.removed_turn_ids?.includes(staleTurnId));
    assert.ok(cleanup, 'phase advance must emit phase_cleanup for the stale PM turn');
  });

  it('Turn 276: reconciled phase advance refreshes session checkpoint before any next dispatch', () => {
    const config = makePlanningConfig();
    config.gates.planning_signoff = {
      requires_files: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md'],
    };
    const { root, state } = createProject(config);

    const staleTurnId = 'turn_stale_pm_session';
    writeFileSync(join(root, '.planning', 'ROADMAP.md'), '# Roadmap\n\n- Ship implementation handoff\n');
    writeFileSync(join(root, '.planning', 'PM_SIGNOFF.md'), 'Approved: YES\n');
    mkdirSync(join(root, getDispatchTurnDir(staleTurnId)), { recursive: true });
    writeFileSync(join(root, getDispatchTurnDir(staleTurnId), 'PROMPT.md'), 'stale PM dispatch\n');

    const acceptedAt = new Date().toISOString();
    writeHistory(root, [{
      turn_id: staleTurnId,
      run_id: state.run_id,
      role: 'pm',
      assigned_role: 'pm',
      status: 'completed',
      accepted_at: acceptedAt,
      phase: 'planning',
      phase_transition_request: 'implementation',
      verification: { status: 'pass' },
    }]);
    writeState(root, {
      ...state,
      status: 'active',
      active_turns: {
        [staleTurnId]: {
          turn_id: staleTurnId,
          run_id: state.run_id,
          assigned_role: 'pm',
          runtime_id: 'manual-pm',
          status: 'dispatched',
          attempt: 1,
        },
      },
      budget_reservations: {
        [staleTurnId]: { reserved_usd: 0.25, reason: 'stale tester-loop reservation' },
      },
      last_completed_turn_id: staleTurnId,
      last_gate_failure: {
        gate_id: 'planning_signoff',
        gate_type: 'phase_transition',
        requested_by_turn: staleTurnId,
        requested_phase: 'implementation',
        failed_at: acceptedAt,
      },
      phase_gate_status: {
        ...(state.phase_gate_status || {}),
        planning_signoff: 'failed',
      },
    });
    writeFileSync(join(root, '.agentxchain', 'session.json'), JSON.stringify({
      session_id: 'session_stale_pm',
      run_id: state.run_id,
      checkpoint_reason: 'turn_assigned',
      run_status: 'active',
      phase: 'planning',
      active_turn_ids: [staleTurnId],
    }, null, 2));

    const result = reconcilePhaseAdvanceBeforeDispatch(root, config, null, {
      allow_active_turn_cleanup: true,
    });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.advanced, true, 'reconciler must advance the now-satisfied planning gate');

    const finalState = readState(root);
    assert.equal(finalState.phase, 'implementation', 'state must advance before dispatch');
    assert.equal(finalState.active_turns?.[staleTurnId], undefined, 'stale PM active turn must be cleared');
    assert.equal(finalState.budget_reservations?.[staleTurnId], undefined, 'stale PM budget reservation must be cleared');

    const session = JSON.parse(readFileSync(join(root, '.agentxchain', 'session.json'), 'utf8'));
    assert.equal(session.checkpoint_reason, 'phase_reconciled', 'reconciled phase advance must write its own session checkpoint');
    assert.equal(session.phase, 'implementation', 'session phase must match the reconciled state before any next dispatch');
    assert.deepEqual(session.active_turn_ids, [], 'session checkpoint must not retain stale prior-phase turn ids');

    const events = readEvents(root);
    const cleanup = events.find((entry) => entry.event_type === 'phase_cleanup'
      && entry.payload?.from_phase === 'planning'
      && entry.payload?.removed_turn_ids?.includes(staleTurnId)
      && entry.payload?.cleared_budget_turn_ids?.includes(staleTurnId)
      && entry.payload?.removed_dispatch_turn_ids?.includes(staleTurnId));
    assert.ok(cleanup, 'phase_cleanup must audit stale state, budget, and dispatch cleanup');
  });

  it('Turn 177: unblock does NOT advance standing pending gate when required evidence is missing (negative case)', () => {
    // HUMAN-ROADMAP BUG-52 third variant — sharpened fix requirement #5 negative
    // case: standing `planning_signoff: pending` with `pending_phase_transition:
    // null` AND the gate's `requires_files` list includes a file that is NOT
    // present on disk → `unblock` must NOT advance the phase. The escalation is
    // resolved (status transitions out of `blocked`), but the run is re-blocked
    // with a clear operator-facing message and the original gate state is
    // preserved. This proves the Turn 176 standing-gate path is evidence-gated,
    // not a rubber stamp.
    const { root, config, state } = createProject();

    const assign = assignGovernedTurn(root, config, 'pm');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    // Deliberately write ROADMAP.md but NOT PM_SIGNOFF.md. The planning_signoff
    // gate declares `requires_files: ['.planning/PM_SIGNOFF.md',
    // '.planning/ROADMAP.md']` in makePlanningConfig(), so the gate evaluator
    // will return `gate_failed` when reconcilePhaseAdvanceBeforeDispatch reruns
    // evaluatePhaseExit against the synthetic standing-gate source.
    writeFileSync(join(root, '.planning', 'ROADMAP.md'), '# Roadmap\n\n- Ship implementation handoff\n');
    // PM_SIGNOFF.md is INTENTIONALLY absent — this is the evidence-missing seam.

    stageTurnResult(root, turnId, {
      schema_version: '1.0',
      turn_id: turnId,
      run_id: state.run_id,
      role: 'pm',
      runtime_id: 'manual-pm',
      status: 'needs_human',
      needs_human_reason: 'Need operator confirmation before handing off to dev',
      summary: 'Planning artifacts drafted, awaiting human confirmation',
      artifact: { type: 'workspace', path: '.' },
      files_changed: ['.planning/ROADMAP.md'],
      decisions: [],
      objections: [],
      verification: { status: 'pass' },
      proposed_next_role: 'dev',
      phase_transition_request: 'implementation',
      cost: { usd: 0.01 },
    });

    const accepted = runCli(root, ['accept-turn']);
    assert.equal(accepted.status, 0, `accept-turn failed:\n${accepted.stdout}\n${accepted.stderr}`);

    const checkpoint = runCli(root, ['checkpoint-turn', '--turn', turnId]);
    assert.equal(checkpoint.status, 0, `checkpoint-turn failed:\n${checkpoint.stdout}\n${checkpoint.stderr}`);

    const blocked = readState(root);
    const staleTurnId = blocked.blocked_reason?.turn_id;
    assert.equal(staleTurnId, turnId, 'fixture sanity: escalation should remain tied to the accepted PM turn');

    // Recreate the third-variant shape: pending_phase_transition null, gate
    // standing pending, retained PM active turn.
    writeState(root, {
      ...blocked,
      pending_phase_transition: null,
      phase_gate_status: {
        ...(blocked.phase_gate_status || {}),
        planning_signoff: 'pending',
      },
      active_turns: {
        [staleTurnId]: {
          turn_id: staleTurnId,
          run_id: blocked.run_id,
          assigned_role: 'pm',
          runtime_id: 'manual-pm',
          status: 'dispatched',
          attempt: 1,
          assigned_sequence: blocked.turn_sequence || 1,
        },
      },
    });

    const escalationId = readHumanEscalationId(root);
    const unblocked = runCli(root, ['unblock', escalationId]);

    // resume.js:188 exits non-zero when the standing-gate reconcile cannot
    // materialize a phase transition. This proves the failure is surfaced to
    // the operator, not silently swallowed.
    assert.notEqual(unblocked.status, 0, `unblock must fail when required evidence is missing:\n${unblocked.stdout}\n${unblocked.stderr}`);

    const combinedOutput = `${unblocked.stdout}\n${unblocked.stderr}`;
    assert.match(
      combinedOutput,
      /did not materialize|no phase transition could be materialized|unblock_reconcile_failed/i,
      'operator must see an actionable reconcile-failure message',
    );

    const finalState = readState(root);
    assert.equal(finalState.phase, 'planning', 'phase must NOT advance when required evidence is missing');
    assert.equal(
      finalState.phase_gate_status?.planning_signoff,
      'pending',
      'planning_signoff gate must remain pending — evidence gap was not papered over',
    );
    // The retained PM turn state is preserved OR the run is re-blocked with a
    // recovery pointer. Either way: no new implementation-phase dispatch.
    const activeTurns = Object.values(finalState.active_turns || {});
    for (const turn of activeTurns) {
      assert.notEqual(turn?.assigned_role, 'dev', 'dev must NOT be dispatched when planning gate evidence is missing');
    }
    assert.equal(
      finalState.status,
      'blocked',
      'run must remain blocked pending operator recovery (providing the missing evidence)',
    );

    // No phase_entered / phase_cleanup events should have fired.
    const events = readEvents(root);
    const phaseEntered = events.find((entry) => entry.event_type === 'phase_entered'
      && entry.payload?.from === 'planning'
      && entry.payload?.to === 'implementation');
    assert.equal(phaseEntered, undefined, 'phase_entered must NOT fire on evidence-missing unblock');
    const phaseCleanup = events.find((entry) => entry.event_type === 'phase_cleanup'
      && entry.payload?.from_phase === 'planning');
    assert.equal(phaseCleanup, undefined, 'phase_cleanup must NOT fire when phase did not advance');
  });

  it('Turn 203: unblock advances standing pending gate when active_turns is empty AND PM history has no phase_transition_request', () => {
    // HUMAN-ROADMAP BUG-52 third variant — tester's v2.151.0 lights-out flow on
    // `tusq.dev`. The shape is narrower than Turn 176:
    //
    //   - PM accepts + checkpoints + returns needs_human WITHOUT declaring
    //     `phase_transition_request`. (Claude-Opus-driven PM roles that merely
    //     need human sign-off sometimes leave the field null — the tester's
    //     repro exhibits this.)
    //   - After accept+checkpoint, `active_turns` is empty (no retained turn).
    //   - `pending_phase_transition: null`, `phase_gate_status.planning_signoff:
    //     pending`, `last_gate_failure: null`, `queued_phase_transition: null`.
    //   - Open human escalation tied to the planning_signoff gate.
    //
    // Until Turn 203, resume.js line 146 only fired the standing-gate
    // reconciliation path when `activeCount > 0`. With no retained turn, resume
    // fell through to the line 321 reconcile (no `allow_standing_gate` opt-in),
    // which bailed because `resolvePhaseTransitionSource` could not find a
    // phase_transition_request anywhere. The dispatcher then redispatched PM in
    // planning — the tester observed this loop seven consecutive iterations on
    // `run_8543d07bd34cc982`.
    //
    // Acceptance: `unblock` must route through the standing-gate reconcile
    // regardless of `activeCount`, materialize the pending transition, and
    // dispatch `dev` in `implementation`.
    const { root, config, state } = createProject();

    const assign = assignGovernedTurn(root, config, 'pm');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    writeFileSync(join(root, '.planning', 'ROADMAP.md'), '# Roadmap\n\n- Ship implementation handoff\n');
    writeFileSync(join(root, '.planning', 'PM_SIGNOFF.md'), 'Approved: YES\n');
    writeFileSync(
      join(root, '.planning', 'SYSTEM_SPEC.md'),
      '# System Spec\n\n## Purpose\n\nPlan the implementation handoff.\n\n## Interface\n\nPM artifacts.\n\n## Acceptance Tests\n\n- [x] Dev can start implementation.\n',
    );

    // PM turn declares no phase_transition_request — the tester's actual flow.
    stageTurnResult(root, turnId, {
      schema_version: '1.0',
      turn_id: turnId,
      run_id: state.run_id,
      role: 'pm',
      runtime_id: 'manual-pm',
      status: 'needs_human',
      needs_human_reason: 'Need operator confirmation before handing off to dev',
      summary: 'Planning artifacts drafted, awaiting human confirmation',
      artifact: { type: 'workspace', path: '.' },
      files_changed: ['.planning/ROADMAP.md', '.planning/PM_SIGNOFF.md', '.planning/SYSTEM_SPEC.md'],
      decisions: [],
      objections: [],
      verification: { status: 'pass' },
      proposed_next_role: 'dev',
      phase_transition_request: null,
      cost: { usd: 0.01 },
    });

    const accepted = runCli(root, ['accept-turn']);
    assert.equal(accepted.status, 0, `accept-turn failed:\n${accepted.stdout}\n${accepted.stderr}`);

    const checkpoint = runCli(root, ['checkpoint-turn', '--turn', turnId]);
    assert.equal(checkpoint.status, 0, `checkpoint-turn failed:\n${checkpoint.stdout}\n${checkpoint.stderr}`);

    const blocked = readState(root);
    // Force the tester's precise third-variant shape: standing pending gate, no
    // pending phase transition, no retained active turn.
    writeState(root, {
      ...blocked,
      pending_phase_transition: null,
      queued_phase_transition: null,
      last_gate_failure: null,
      phase_gate_status: {
        ...(blocked.phase_gate_status || {}),
        planning_signoff: 'pending',
      },
      active_turns: {},
    });

    const escalationId = readHumanEscalationId(root);
    const unblocked = runCli(root, ['unblock', escalationId]);
    assert.equal(
      unblocked.status,
      0,
      `unblock must advance the standing gate even when active_turns is empty:\n${unblocked.stdout}\n${unblocked.stderr}`,
    );

    const finalState = readState(root);
    const activeTurn = Object.values(finalState.active_turns || {})[0] || null;
    assert.equal(finalState.phase, 'implementation', 'phase must advance even with empty active_turns and null phase_transition_request');
    assert.equal(finalState.phase_gate_status?.planning_signoff, 'passed', 'planning gate must be marked passed after unblock');
    assert.equal(activeTurn?.assigned_role, 'dev', 'next dispatch must target dev, not another PM');
    assert.equal(activeTurn?.runtime_id, 'manual-dev');
    assert.doesNotMatch(unblocked.stdout, /Role:\s+pm/i, 'unblock must not redispatch PM after approval');

    const events = readEvents(root);
    const phaseEntered = events.find((entry) => entry.event_type === 'phase_entered'
      && entry.payload?.from === 'planning'
      && entry.payload?.to === 'implementation');
    assert.ok(phaseEntered, 'phase_entered event must fire for planning -> implementation');
  });

  it('Turn 204: unblock does NOT advance empty-active standing pending gate when required evidence is missing', () => {
    // Mirror the Turn 203 third-variant shape, but omit PM_SIGNOFF.md. This is
    // the activeCount=0 half of the Turn 177 negative case: the standing-gate
    // reconcile branch is allowed to run, but it must remain evidence-gated.
    const { root, config, state } = createProject();

    const assign = assignGovernedTurn(root, config, 'pm');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    writeFileSync(join(root, '.planning', 'ROADMAP.md'), '# Roadmap\n\n- Ship implementation handoff\n');
    // PM_SIGNOFF.md is intentionally absent.

    stageTurnResult(root, turnId, {
      schema_version: '1.0',
      turn_id: turnId,
      run_id: state.run_id,
      role: 'pm',
      runtime_id: 'manual-pm',
      status: 'needs_human',
      needs_human_reason: 'Need operator confirmation before handing off to dev',
      summary: 'Planning artifacts drafted, awaiting human confirmation',
      artifact: { type: 'workspace', path: '.' },
      files_changed: ['.planning/ROADMAP.md'],
      decisions: [],
      objections: [],
      verification: { status: 'pass' },
      proposed_next_role: 'dev',
      phase_transition_request: null,
      cost: { usd: 0.01 },
    });

    const accepted = runCli(root, ['accept-turn']);
    assert.equal(accepted.status, 0, `accept-turn failed:\n${accepted.stdout}\n${accepted.stderr}`);

    const checkpoint = runCli(root, ['checkpoint-turn', '--turn', turnId]);
    assert.equal(checkpoint.status, 0, `checkpoint-turn failed:\n${checkpoint.stdout}\n${checkpoint.stderr}`);

    const blocked = readState(root);
    writeState(root, {
      ...blocked,
      pending_phase_transition: null,
      queued_phase_transition: null,
      last_gate_failure: null,
      phase_gate_status: {
        ...(blocked.phase_gate_status || {}),
        planning_signoff: 'pending',
      },
      active_turns: {},
    });

    const escalationId = readHumanEscalationId(root);
    const unblocked = runCli(root, ['unblock', escalationId]);
    assert.notEqual(
      unblocked.status,
      0,
      `unblock must fail when empty-active standing gate evidence is missing:\n${unblocked.stdout}\n${unblocked.stderr}`,
    );

    const combinedOutput = `${unblocked.stdout}\n${unblocked.stderr}`;
    assert.match(
      combinedOutput,
      /did not materialize|no phase transition could be materialized|unblock_reconcile_failed/i,
      'operator must see an actionable reconcile-failure message',
    );

    const finalState = readState(root);
    assert.equal(finalState.phase, 'planning', 'phase must NOT advance when empty-active standing gate evidence is missing');
    assert.equal(finalState.status, 'blocked', 'run must remain blocked pending operator recovery');
    assert.equal(finalState.phase_gate_status?.planning_signoff, 'pending', 'planning gate must remain pending');

    const activeTurns = Object.values(finalState.active_turns || {});
    for (const turn of activeTurns) {
      assert.notEqual(turn?.assigned_role, 'dev', 'dev must NOT be dispatched when planning gate evidence is missing');
    }

    const events = readEvents(root);
    const phaseEntered = events.find((entry) => entry.event_type === 'phase_entered'
      && entry.payload?.from === 'planning'
      && entry.payload?.to === 'implementation');
    assert.equal(phaseEntered, undefined, 'phase_entered must NOT fire on empty-active evidence-missing unblock');
    const phaseCleanup = events.find((entry) => entry.event_type === 'phase_cleanup'
      && entry.payload?.from_phase === 'planning');
    assert.equal(phaseCleanup, undefined, 'phase_cleanup must NOT fire when empty-active phase did not advance');
  });

  it('Turn 205: unblock advances standing pending gate when PM declares proposed_next_role: "human" (realistic needs_human shape)', () => {
    // Turn 205 adversarial-review finding: the Turn 204
    // DEC-BUG52-UNBLOCK-STANDING-GATE-DISCRIMINATOR-001 helper
    // `latestCompletedTurnWantsPhaseContinuation()` returns true when
    // `entry.phase_transition_request` is set OR
    // `entry.proposed_next_role && proposed !== 'human'`. The real-world PM
    // shape for a planning_signoff escalation is `status: "needs_human"`,
    // `phase_transition_request: null`, `proposed_next_role: "human"` — the
    // PM is literally asking the human to act next. With both conditions
    // false the discriminator denies the standing-gate branch, and the
    // tester's exact seven-iteration loop reproduces.
    //
    // This is the same third-variant scenario as Turn 203, except the PM
    // turn declares `proposed_next_role: "human"` instead of `"dev"`.
    // `unblock` must still advance the phase — the operator-approved gate
    // closure is the authoritative signal, not the PM's own guess about
    // which role should act next.
    const { root, config, state } = createProject();

    const assign = assignGovernedTurn(root, config, 'pm');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    writeFileSync(join(root, '.planning', 'ROADMAP.md'), '# Roadmap\n\n- Ship implementation handoff\n');
    writeFileSync(join(root, '.planning', 'PM_SIGNOFF.md'), 'Approved: YES\n');
    writeFileSync(
      join(root, '.planning', 'SYSTEM_SPEC.md'),
      '# System Spec\n\n## Purpose\n\nPlan the implementation handoff.\n\n## Interface\n\nPM artifacts.\n\n## Acceptance Tests\n\n- [x] Dev can start implementation.\n',
    );

    // Realistic PM needs_human shape: proposed_next_role is 'human'.
    stageTurnResult(root, turnId, {
      schema_version: '1.0',
      turn_id: turnId,
      run_id: state.run_id,
      role: 'pm',
      runtime_id: 'manual-pm',
      status: 'needs_human',
      needs_human_reason: 'Planning complete; awaiting operator sign-off on planning_signoff gate',
      summary: 'Planning artifacts drafted, escalating to human for gate approval',
      artifact: { type: 'workspace', path: '.' },
      files_changed: ['.planning/ROADMAP.md', '.planning/PM_SIGNOFF.md', '.planning/SYSTEM_SPEC.md'],
      decisions: [],
      objections: [],
      verification: { status: 'pass' },
      proposed_next_role: 'human',
      phase_transition_request: null,
      cost: { usd: 0.01 },
    });

    const accepted = runCli(root, ['accept-turn']);
    assert.equal(accepted.status, 0, `accept-turn failed:\n${accepted.stdout}\n${accepted.stderr}`);

    const checkpoint = runCli(root, ['checkpoint-turn', '--turn', turnId]);
    assert.equal(checkpoint.status, 0, `checkpoint-turn failed:\n${checkpoint.stdout}\n${checkpoint.stderr}`);

    const blocked = readState(root);
    writeState(root, {
      ...blocked,
      pending_phase_transition: null,
      queued_phase_transition: null,
      last_gate_failure: null,
      phase_gate_status: {
        ...(blocked.phase_gate_status || {}),
        planning_signoff: 'pending',
      },
      active_turns: {},
    });

    const escalationId = readHumanEscalationId(root);
    const unblocked = runCli(root, ['unblock', escalationId]);
    assert.equal(
      unblocked.status,
      0,
      `unblock must advance the standing gate even when PM declared proposed_next_role: "human":\n${unblocked.stdout}\n${unblocked.stderr}`,
    );

    const finalState = readState(root);
    const activeTurn = Object.values(finalState.active_turns || {})[0] || null;
    assert.equal(finalState.phase, 'implementation', 'phase must advance even when PM proposed_next_role is "human"');
    assert.equal(finalState.phase_gate_status?.planning_signoff, 'passed', 'planning gate must be marked passed after unblock');
    assert.equal(activeTurn?.assigned_role, 'dev', 'next dispatch must target dev, not another PM');
    assert.equal(activeTurn?.runtime_id, 'manual-dev');
    assert.doesNotMatch(unblocked.stdout, /Role:\s+pm/i, 'unblock must not redispatch PM after approval');
  });

  it('Turn 274: approve-transition explains pending standing gate with no prepared transition', () => {
    // HUMAN-ROADMAP BUG-52 third-variant command-surface inconsistency:
    // `gate show planning_signoff` can truthfully report a pending human gate
    // while `approve-transition --dry-run` used to say only "No pending phase
    // transition to approve." That message is technically true but
    // operationally misleading in the standing-gate shape; the operator needs
    // to know the gate exists and that `unblock <hesc_id>` is the recovery path
    // when a human escalation is open.
    const { root } = createProject();
    const state = readState(root);

    writeState(root, {
      ...state,
      phase: 'planning',
      status: 'blocked',
      pending_phase_transition: null,
      pending_run_completion: null,
      phase_gate_status: {
        ...(state.phase_gate_status || {}),
        planning_signoff: 'pending',
      },
      active_turns: {},
      blocked_on: 'escalation:operator:planning-signoff',
      blocked_reason: {
        category: 'operator_escalation',
        blocked_at: new Date().toISOString(),
        turn_id: null,
        recovery: {
          typed_reason: 'operator_escalation',
          owner: 'human',
          recovery_action: 'agentxchain unblock <hesc_id>',
          turn_retained: false,
          detail: 'planning_signoff',
        },
      },
    });

    const approved = runCli(root, ['approve-transition', '--dry-run']);
    assert.notEqual(approved.status, 0, 'approve-transition must still fail closed without a prepared transition');
    const output = `${approved.stdout}\n${approved.stderr}`;
    assert.match(output, /No pending phase transition to approve/i);
    assert.match(output, /Gate "planning_signoff" is pending human approval/i);
    assert.match(output, /Expected transition:\s+planning\s+→\s+implementation/i);
    assert.match(output, /agentxchain unblock <hesc_id>/i);
    assert.match(output, /agentxchain gate show planning_signoff --evaluate/i);
  });

  it('Turn 275: gate show explains pending standing gate recovery when no transition is prepared', () => {
    // Symmetric half of Turn 274: approve-transition now points to
    // `gate show <gate> --evaluate` in the standing-gate shape. The roadmap
    // BUG-52 fix requirement 3 says both surfaces must converge on a consistent
    // truth — without this hint, gate show still reports only "Status: pending"
    // and sends the operator back to approve-transition in a diagnostic loop.
    const { root } = createProject();
    const state = readState(root);

    writeState(root, {
      ...state,
      phase: 'planning',
      status: 'blocked',
      pending_phase_transition: null,
      pending_run_completion: null,
      phase_gate_status: {
        ...(state.phase_gate_status || {}),
        planning_signoff: 'pending',
      },
      active_turns: {},
      blocked_on: 'escalation:operator:planning-signoff',
      blocked_reason: {
        category: 'operator_escalation',
        blocked_at: new Date().toISOString(),
        turn_id: null,
        recovery: {
          typed_reason: 'operator_escalation',
          owner: 'human',
          recovery_action: 'agentxchain unblock <hesc_id>',
          turn_retained: false,
          detail: 'planning_signoff',
        },
      },
    });

    const shown = runCli(root, ['gate', 'show', 'planning_signoff']);
    assert.equal(shown.status, 0, `gate show must succeed: ${shown.stdout}\n${shown.stderr}`);
    const output = `${shown.stdout}\n${shown.stderr}`;
    assert.match(output, /Status:\s+pending/i);
    assert.match(output, /Recovery:/);
    assert.match(output, /No phase transition is prepared for "planning_signoff"/i);
    assert.match(output, /agentxchain unblock <hesc_id>/i);
    assert.match(output, /agentxchain approve-transition/i);
  });

  it('Turn 275: gate show does NOT emit standing-gate recovery when a transition is prepared', () => {
    // Negative: when pending_phase_transition exists, approve-transition is the
    // correct recovery path and the standing-gate hint must stay silent so it
    // does not mislead operators into chasing an escalation that does not
    // apply.
    const { root } = createProject();
    const state = readState(root);

    writeState(root, {
      ...state,
      phase: 'planning',
      status: 'active',
      pending_phase_transition: {
        from_phase: 'planning',
        to_phase: 'implementation',
        requested_at: new Date().toISOString(),
        source_turn_id: null,
      },
      phase_gate_status: {
        ...(state.phase_gate_status || {}),
        planning_signoff: 'pending',
      },
      active_turns: {},
    });

    const shown = runCli(root, ['gate', 'show', 'planning_signoff']);
    assert.equal(shown.status, 0);
    const output = `${shown.stdout}\n${shown.stderr}`;
    assert.match(output, /Status:\s+pending/i);
    assert.doesNotMatch(output, /No phase transition is prepared/i);
    assert.doesNotMatch(output, /unblock <hesc_id>/i);
  });

  it('Turn 206: unblock does not synthesize a verified phase advance for verification-gated needs_human turns', () => {
    const config = makeQaLaunchConfig();
    config.gates.qa_ship_verdict.requires_verification_pass = true;
    const { root } = createProject(config);

    const seededState = readState(root);
    seededState.phase = 'qa';
    seededState.status = 'active';
    seededState.active_turns = {};
    seededState.phase_gate_status = {
      planning_signoff: 'passed',
      implementation_complete: 'passed',
      qa_ship_verdict: 'pending',
      launch_approval: 'pending',
    };
    seededState.pending_phase_transition = null;
    seededState.pending_run_completion = null;
    seededState.last_gate_failure = null;
    writeState(root, seededState);

    const assign = assignGovernedTurn(root, config, 'qa');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;
    const qaState = readState(root);

    writePassingAcceptanceMatrix(root);
    writeFileSync(join(root, '.planning', 'ship-verdict.md'), '# Ship Verdict\n\n## Verdict: NEEDS HUMAN\n');
    writeFileSync(
      join(root, '.planning', 'RELEASE_NOTES.md'),
      '# Release Notes\n\n## User Impact\n\nLaunch role waits for verified QA approval.\n\n## Verification Summary\n\nVerification is not passing yet.\n',
    );

    stageTurnResult(root, turnId, {
      schema_version: '1.0',
      turn_id: turnId,
      run_id: qaState.run_id,
      role: 'qa',
      runtime_id: 'manual-qa',
      status: 'needs_human',
      needs_human_reason: 'QA verdict artifacts are present but verification failed',
      summary: 'QA artifacts drafted, but verification is not passing',
      artifact: { type: 'workspace', path: '.' },
      files_changed: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md', '.planning/RELEASE_NOTES.md'],
      decisions: [],
      objections: [],
      verification: { status: 'fail' },
      proposed_next_role: 'human',
      phase_transition_request: null,
      cost: { usd: 0.01 },
    });

    const accepted = runCli(root, ['accept-turn']);
    assert.equal(accepted.status, 0, `accept-turn failed:\n${accepted.stdout}\n${accepted.stderr}`);

    const checkpoint = runCli(root, ['checkpoint-turn', '--turn', turnId]);
    assert.equal(checkpoint.status, 0, `checkpoint-turn failed:\n${checkpoint.stdout}\n${checkpoint.stderr}`);

    const blocked = readState(root);
    writeState(root, {
      ...blocked,
      pending_phase_transition: null,
      queued_phase_transition: null,
      last_gate_failure: null,
      phase_gate_status: {
        ...(blocked.phase_gate_status || {}),
        qa_ship_verdict: 'pending',
      },
      active_turns: {},
    });

    const escalationId = readHumanEscalationId(root);
    const unblocked = runCli(root, ['unblock', escalationId]);
    assert.equal(unblocked.status, 0, `unblock should resume without force-advancing failed verification:\n${unblocked.stdout}\n${unblocked.stderr}`);

    const finalState = readState(root);
    const activeTurn = Object.values(finalState.active_turns || {})[0] || null;
    assert.equal(finalState.phase, 'qa', 'phase must not advance when a verification-gated synthetic source would be unverified');
    assert.equal(finalState.phase_gate_status?.qa_ship_verdict, 'pending', 'qa ship gate must remain pending');
    assert.equal(activeTurn?.assigned_role, 'qa', 'next dispatch must stay in QA so verification can be repaired');
    assert.doesNotMatch(unblocked.stdout, /Advanced phase before dispatch/i, 'unblock output must not claim a phase advance');
  });

  it('Turn 94: resume advances from queued_phase_transition even when the latest accepted turn had no phase request', () => {
    const { root } = createProject(makeQaLaunchConfig());
    const seededState = readState(root);
    const now = new Date().toISOString();

    seededState.phase = 'implementation';
    seededState.status = 'blocked';
    seededState.active_turns = {};
    seededState.blocked_on = 'human:queued_transition_review';
    seededState.blocked_reason = {
      category: 'needs_human',
      blocked_at: now,
      turn_id: 'turn_blocked_followup',
      recovery: {
        typed_reason: 'needs_human',
        owner: 'human',
        recovery_action: 'agentxchain resume',
        turn_retained: false,
        detail: 'queued transition should advance after resume',
      },
    };
    seededState.last_gate_failure = null;
    seededState.last_completed_turn_id = 'turn_blocked_followup';
    seededState.pending_phase_transition = null;
    seededState.pending_run_completion = null;
    seededState.queued_phase_transition = {
      from: 'implementation',
      to: 'qa',
      requested_by_turn: 'turn_impl_request',
      requested_at: now,
    };
    seededState.phase_gate_status = {
      planning_signoff: 'passed',
      implementation_complete: 'pending',
      qa_ship_verdict: 'pending',
      launch_approval: 'pending',
    };
    writeState(root, seededState);
    writeFileSync(
      join(root, '.planning', 'IMPLEMENTATION_NOTES.md'),
      '# Implementation Notes\n\n## Changes\n- Implementation work is complete and ready for QA.\n\n## Verification\n- Resume-based queued transition recovery fixture.\n',
    );
    execSync('git add .planning/IMPLEMENTATION_NOTES.md && git commit -m "seed implementation notes for queued transition recovery"', {
      cwd: root,
      stdio: 'ignore',
    });
    writeHistory(root, [
      {
        turn_id: 'turn_impl_request',
        run_id: seededState.run_id,
        role: 'dev',
        assigned_role: 'dev',
        runtime_id: 'manual-dev',
        status: 'completed',
        accepted_at: now,
        phase: 'implementation',
        phase_transition_request: 'qa',
        summary: 'Implementation work finished and requested QA.',
        verification: { status: 'pass' },
      },
      {
        turn_id: 'turn_blocked_followup',
        run_id: seededState.run_id,
        role: 'dev',
        assigned_role: 'dev',
        runtime_id: 'manual-dev',
        status: 'completed',
        accepted_at: now,
        phase: 'implementation',
        phase_transition_request: null,
        summary: 'Later implementation bookkeeping turn with no new phase request.',
        verification: { status: 'pass' },
      },
    ]);

    const resumed = runCli(root, ['resume']);
    assert.equal(resumed.status, 0, `resume failed:\n${resumed.stdout}\n${resumed.stderr}`);

    const finalState = readState(root);
    const activeTurn = Object.values(finalState.active_turns || {})[0] || null;
    assert.equal(finalState.phase, 'qa', 'queued_phase_transition must still advance the phase after resume');
    assert.equal(finalState.phase_gate_status?.implementation_complete, 'passed', 'implementation gate must be marked passed');
    assert.equal(finalState.queued_phase_transition, null, 'queued_phase_transition should clear once reconciliation advances');
    assert.equal(activeTurn?.assigned_role, 'qa', 'next dispatch must target QA from the queued request');
    assert.equal(activeTurn?.runtime_id, 'manual-qa');
    assert.doesNotMatch(resumed.stdout, /Role:\s+dev/i, 'resume must not redispatch implementation when a queued transition exists');
  });

  it('Turn 94: resume does not mine an unrelated historical phase request when the latest blocked turn had no request', () => {
    const { root } = createProject(makeQaLaunchConfig());
    const seededState = readState(root);
    const now = new Date().toISOString();

    seededState.phase = 'implementation';
    seededState.status = 'blocked';
    seededState.active_turns = {};
    seededState.blocked_on = 'budget:exhausted';
    seededState.blocked_reason = {
      category: 'budget_exhausted',
      blocked_at: now,
      turn_id: 'turn_budget_block',
      recovery: {
        typed_reason: 'budget_exhausted',
        owner: 'human',
        recovery_action: 'Increase budget, then run agentxchain resume',
        turn_retained: false,
        detail: 'Budget exhausted after a non-transition implementation turn',
      },
    };
    seededState.last_gate_failure = null;
    seededState.last_completed_turn_id = 'turn_budget_block';
    seededState.pending_phase_transition = null;
    seededState.pending_run_completion = null;
    seededState.queued_phase_transition = null;
    seededState.phase_gate_status = {
      planning_signoff: 'passed',
      implementation_complete: 'pending',
      qa_ship_verdict: 'pending',
      launch_approval: 'pending',
    };
    writeState(root, seededState);
    writeFileSync(
      join(root, '.planning', 'IMPLEMENTATION_NOTES.md'),
      '# Implementation Notes\n\n## Changes\n- Historical implementation request fixture remains on disk.\n\n## Verification\n- Resume should stay in implementation unless the latest blocked path preserved a current request.\n',
    );
    execSync('git add .planning/IMPLEMENTATION_NOTES.md && git commit -m "seed implementation notes for null-source recovery guard"', {
      cwd: root,
      stdio: 'ignore',
    });
    writeHistory(root, [
      {
        turn_id: 'turn_old_impl_request',
        run_id: seededState.run_id,
        role: 'dev',
        assigned_role: 'dev',
        runtime_id: 'manual-dev',
        status: 'completed',
        accepted_at: now,
        phase: 'implementation',
        phase_transition_request: 'qa',
        summary: 'Older implementation turn requested QA.',
        verification: { status: 'pass' },
      },
      {
        turn_id: 'turn_budget_block',
        run_id: seededState.run_id,
        role: 'dev',
        assigned_role: 'dev',
        runtime_id: 'manual-dev',
        status: 'completed',
        accepted_at: now,
        phase: 'implementation',
        phase_transition_request: null,
        summary: 'Latest accepted turn exhausted budget but did not request phase advance.',
        verification: { status: 'pass' },
      },
    ]);

    const resumed = runCli(root, ['resume']);
    assert.equal(resumed.status, 0, `resume failed:\n${resumed.stdout}\n${resumed.stderr}`);

    const finalState = readState(root);
    const activeTurn = Object.values(finalState.active_turns || {})[0] || null;
    assert.equal(finalState.phase, 'implementation', 'resume must not replay an unrelated older phase request');
    assert.equal(finalState.last_gate_failure, null, 'no gate failure should be synthesized from unrelated history');
    assert.equal(finalState.queued_phase_transition ?? null, null, 'no queued transition should be created from unrelated history');
    assert.equal(activeTurn?.assigned_role, 'dev', 'resume should dispatch the current phase entry role');
    assert.equal(activeTurn?.runtime_id, 'manual-dev');
    assert.doesNotMatch(resumed.stdout, /Role:\s+qa/i, 'resume must not jump to QA without a preserved current request');
  });

  it('unblock still advances when last_gate_failure.requested_by_turn points at a non-declarer history entry', () => {
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

    const accepted = runCli(root, ['accept-turn']);
    assert.equal(accepted.status, 0, `accept-turn failed:\n${accepted.stdout}\n${accepted.stderr}`);
    const checkpoint = runCli(root, ['checkpoint-turn', '--turn', turnId]);
    assert.equal(checkpoint.status, 0, `checkpoint-turn failed:\n${checkpoint.stdout}\n${checkpoint.stderr}`);

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

    repointGateFailureToNonDeclarer(root, {
      turnId: 'turn_planning_noise',
      role: 'pm',
      phase: 'planning',
      runtimeId: 'manual-pm',
      summary: 'Accumulated history noise after the real declarer',
    });

    const escalationId = readHumanEscalationId(root);
    const unblocked = runCli(root, ['unblock', escalationId]);
    assert.equal(unblocked.status, 0, `unblock failed:\n${unblocked.stdout}\n${unblocked.stderr}`);

    const finalState = readState(root);
    const activeTurn = Object.values(finalState.active_turns || {})[0] || null;
    assert.equal(finalState.phase, 'implementation', 'phase must still advance even if requested_by_turn drifted');
    assert.equal(activeTurn?.assigned_role, 'dev', 'fallback lookup must still dispatch the implementation role');
    assert.equal(finalState.last_gate_failure, null, 'reconciled gate failure must be cleared after fallback advance');
    assert.match(unblocked.stdout, /implementation/i, 'operator output should surface the reconciled implementation phase');
  });
});
