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
