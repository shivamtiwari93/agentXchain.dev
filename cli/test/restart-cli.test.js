import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'os';
import { scaffoldGoverned } from '../src/commands/init.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function setupProject(stateOverrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'axc-restart-'));
  scaffoldGoverned(dir, 'Restart Fixture', 'restart-fixture');

  const baseState = {
    schema_version: '1.1',
    run_id: 'run_test123',
    project_id: 'restart-fixture',
    status: 'paused',
    phase: 'implementation',
    current_phase: 'implementation',
    active_turns: {},
    turn_count: 2,
    ...stateOverrides,
  };

  writeFileSync(join(dir, '.agentxchain/state.json'), JSON.stringify(baseState, null, 2));
  return dir;
}

function createRealProject() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-restart-real-'));
  scaffoldGoverned(dir, 'Restart E2E Fixture', 'restart-e2e-fixture');
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@example.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test User"', { cwd: dir, stdio: 'ignore' });
  execSync('git add .', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "baseline"', { cwd: dir, stdio: 'ignore' });
  return dir;
}

function readState(dir) {
  return JSON.parse(readFileSync(join(dir, '.agentxchain/state.json'), 'utf8'));
}

function readSession(dir) {
  return JSON.parse(readFileSync(join(dir, '.agentxchain/session.json'), 'utf8'));
}

function stageTurnResult(dir, turn, runId, overrides = {}) {
  const result = {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: `Restart proof for ${turn.assigned_role}.`,
    decisions: [{
      id: 'DEC-001',
      category: 'implementation',
      statement: 'Advance the restart proof fixture.',
      rationale: 'Dedicated subprocess proof for restart acceptance criteria.',
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
    proposed_next_role: 'pm',
    phase_transition_request: null,
    run_completion_request: false,
    needs_human_reason: null,
    cost: { input_tokens: 100, output_tokens: 50, usd: 0.01 },
    ...overrides,
  };

  const stagingDir = join(dir, '.agentxchain', 'staging');
  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(join(stagingDir, 'turn-result.json'), JSON.stringify(result, null, 2));
}

function writePlanningArtifacts(dir) {
  mkdirSync(join(dir, '.planning'), { recursive: true });
  writeFileSync(
    join(dir, '.planning/PM_SIGNOFF.md'),
    '# PM Signoff\n\nApproved: YES\n\n## Discovery Checklist\n- [x] Target user defined\n- [x] Core pain point defined\n- [x] Core workflow defined\n- [x] MVP scope defined\n- [x] Out-of-scope list defined\n- [x] Success metric defined\n',
  );
  writeFileSync(
    join(dir, '.planning/ROADMAP.md'),
    '# Roadmap\n\n## MVP Scope\n\nRestart acceptance proof fixture.\n',
  );
  writeFileSync(
    join(dir, '.planning/SYSTEM_SPEC.md'),
    '# System Spec\n\n## Purpose\n\nExercise restart checkpoint and reconnect behavior.\n\n## Interface\n\n- `agentxchain restart`\n- `agentxchain approve-transition`\n\n## Acceptance Tests\n\n- [x] Checkpoint updates after accept-turn\n- [x] Checkpoint updates after approve-transition\n',
  );
  execSync('git add .planning/PM_SIGNOFF.md .planning/ROADMAP.md .planning/SYSTEM_SPEC.md', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "add planning artifacts"', { cwd: dir, stdio: 'ignore' });
}

const dirs = [];

after(() => {
  for (const d of dirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

describe('agentxchain restart', () => {
  it('AT-SCR-001: succeeds on a paused run with valid checkpoint and assigns next turn', () => {
    const dir = setupProject();
    dirs.push(dir);

    // Write a checkpoint
    writeFileSync(join(dir, '.agentxchain/session.json'), JSON.stringify({
      session_id: 'session_old',
      run_id: 'run_test123',
      last_checkpoint_at: '2026-04-09T01:00:00Z',
      last_turn_id: 'turn-002',
      last_phase: 'implementation',
      last_role: 'dev',
      checkpoint_reason: 'turn_accepted',
    }, null, 2));

    const result = runCli(dir, ['restart']);
    assert.equal(result.status, 0, `Expected success, got: ${result.stdout}\n${result.stderr}`);
    assert.ok(
      result.stdout.includes('Restarted run') || result.stdout.includes('Reconnected to run'),
      `Expected restart output, got: ${result.stdout}`
    );
  });

  it('AT-SCR-002: fails with exit 1 on a completed run', () => {
    const dir = setupProject({ status: 'completed', completed_at: '2026-04-09T00:00:00Z' });
    dirs.push(dir);

    const result = runCli(dir, ['restart']);
    assert.notEqual(result.status, 0, 'should fail on completed run');
    assert.ok(result.stdout.includes('terminal state'), `Expected terminal state, got: ${result.stdout}`);
  });

  it('AT-SCR-003: fails with exit 1 when no governed run (no state.json)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'axc-restart-nostate-'));
    scaffoldGoverned(dir, 'No State', 'no-state');
    // Remove the scaffolded state.json to simulate "no governed run"
    rmSync(join(dir, '.agentxchain/state.json'), { force: true });
    dirs.push(dir);

    const result = runCli(dir, ['restart']);
    assert.notEqual(result.status, 0, 'should fail when no state');
    assert.ok(result.stdout.includes('No governed run'), `Expected no-run error, got: ${result.stdout}`);
  });

  it('AT-SCR-005: writes SESSION_RECOVERY.md with run identity and phase', () => {
    const dir = setupProject();
    dirs.push(dir);

    // Write history for the report
    writeFileSync(join(dir, '.agentxchain/history.jsonl'), [
      JSON.stringify({ turn_id: 'turn-001', role: 'dev', phase: 'planning', status: 'accepted' }),
      JSON.stringify({ turn_id: 'turn-002', role: 'dev', phase: 'implementation', status: 'accepted' }),
    ].join('\n') + '\n');

    const result = runCli(dir, ['restart']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const recoveryPath = join(dir, '.agentxchain/SESSION_RECOVERY.md');
    assert.ok(existsSync(recoveryPath), 'SESSION_RECOVERY.md should exist');
    const content = readFileSync(recoveryPath, 'utf8');
    assert.ok(content.includes('run_test123'), 'should contain run_id');
    assert.ok(content.includes('implementation'), 'should contain phase');
    assert.ok(content.includes('Turn History'), 'should contain turn history');
  });

  it('AT-SCR-008: proceeds when session.json run_id mismatches state.json (stale checkpoint)', () => {
    const dir = setupProject();
    dirs.push(dir);

    writeFileSync(join(dir, '.agentxchain/session.json'), JSON.stringify({
      session_id: 'session_stale',
      run_id: 'run_DIFFERENT',
      checkpoint_reason: 'turn_accepted',
    }, null, 2));

    const result = runCli(dir, ['restart']);
    // Should warn but still succeed
    assert.equal(result.status, 0, `Expected restart to succeed with stale checkpoint, got: ${result.stdout}\n${result.stderr}`);
  });

  it('fails on blocked run', () => {
    const dir = setupProject({
      status: 'blocked',
      blocked_reason: 'hook_tamper_detected',
    });
    dirs.push(dir);

    const result = runCli(dir, ['restart']);
    assert.notEqual(result.status, 0, 'should fail on blocked run');
    assert.ok(result.stdout.includes('blocked'), `Expected blocked, got: ${result.stdout}`);
  });

  it('AT-SCR-004: reconnects to an abandoned active turn in a fresh process', () => {
    const dir = createRealProject();
    dirs.push(dir);

    const resumePlanning = runCli(dir, ['resume', '--role', 'pm']);
    assert.equal(resumePlanning.status, 0, `resume planning failed: ${resumePlanning.stdout}\n${resumePlanning.stderr}`);

    writePlanningArtifacts(dir);

    const planningState = readState(dir);
    const planningTurn = Object.values(planningState.active_turns || {})[0];
    assert.ok(planningTurn, 'planning turn should exist');
    stageTurnResult(dir, planningTurn, planningState.run_id, {
      proposed_next_role: 'human',
      phase_transition_request: 'implementation',
      artifact: { type: 'review', path: '.planning/PM_SIGNOFF.md' },
    });

    const acceptPlanning = runCli(dir, ['accept-turn']);
    assert.equal(acceptPlanning.status, 0, `accept planning failed: ${acceptPlanning.stdout}\n${acceptPlanning.stderr}`);

    const approveTransition = runCli(dir, ['approve-transition']);
    assert.equal(approveTransition.status, 0, `approve-transition failed: ${approveTransition.stdout}\n${approveTransition.stderr}`);

    const resumeImplementation = runCli(dir, ['resume', '--role', 'dev']);
    assert.equal(resumeImplementation.status, 0, `resume implementation failed: ${resumeImplementation.stdout}\n${resumeImplementation.stderr}`);

    const beforeRestartState = readState(dir);
    const abandonedTurn = Object.values(beforeRestartState.active_turns || {})[0];
    assert.ok(abandonedTurn, 'implementation turn should exist before restart');

    const restart = runCli(dir, ['restart']);
    assert.equal(restart.status, 0, `restart failed: ${restart.stdout}\n${restart.stderr}`);
    assert.match(restart.stdout, /Reconnected to run/, 'restart should reconnect rather than assign a replacement turn');
    assert.match(restart.stdout, new RegExp(abandonedTurn.turn_id), 'restart output should identify the retained active turn');

    const afterRestartState = readState(dir);
    const activeTurns = Object.values(afterRestartState.active_turns || {});
    assert.equal(activeTurns.length, 1, 'restart should preserve exactly one active turn');
    assert.equal(activeTurns[0].turn_id, abandonedTurn.turn_id, 'restart should preserve the abandoned turn instead of replacing it');
  });

  it('AT-SCR-006: accept-turn and approve-transition update session checkpoints through the CLI', () => {
    const dir = createRealProject();
    dirs.push(dir);

    const resumePlanning = runCli(dir, ['resume', '--role', 'pm']);
    assert.equal(resumePlanning.status, 0, `resume planning failed: ${resumePlanning.stdout}\n${resumePlanning.stderr}`);

    writePlanningArtifacts(dir);

    const planningState = readState(dir);
    const planningTurn = Object.values(planningState.active_turns || {})[0];
    assert.ok(planningTurn, 'planning turn should exist');
    stageTurnResult(dir, planningTurn, planningState.run_id, {
      proposed_next_role: 'human',
      phase_transition_request: 'implementation',
      artifact: { type: 'review', path: '.planning/PM_SIGNOFF.md' },
    });

    const acceptPlanning = runCli(dir, ['accept-turn']);
    assert.equal(acceptPlanning.status, 0, `accept planning failed: ${acceptPlanning.stdout}\n${acceptPlanning.stderr}`);

    const acceptCheckpoint = readSession(dir);
    assert.equal(acceptCheckpoint.run_id, planningState.run_id, 'checkpoint should track the active run');
    assert.equal(acceptCheckpoint.last_turn_id, planningTurn.turn_id, 'accept-turn should checkpoint the accepted turn');
    assert.equal(acceptCheckpoint.checkpoint_reason, 'turn_accepted', 'accept-turn should write a turn_accepted checkpoint');

    const approveTransition = runCli(dir, ['approve-transition']);
    assert.equal(approveTransition.status, 0, `approve-transition failed: ${approveTransition.stdout}\n${approveTransition.stderr}`);

    const transitionCheckpoint = readSession(dir);
    assert.equal(transitionCheckpoint.run_id, planningState.run_id, 'phase approval checkpoint should keep the same run_id');
    assert.equal(transitionCheckpoint.checkpoint_reason, 'phase_approved', 'approve-transition should overwrite the checkpoint reason');
    assert.equal(transitionCheckpoint.last_phase, 'implementation', 'phase approval checkpoint should reflect the advanced phase');
  });
});
