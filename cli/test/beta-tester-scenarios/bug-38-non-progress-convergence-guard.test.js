/**
 * BUG-38 beta-tester scenario: framework must detect when N consecutive accepted
 * turns fail to reduce the same gate failure, and escalate to needs_human.
 *
 * Tester evidence: 5+ accepted dev turns (turn_48b1c08ef3905243, turn_494964a9db3924e0,
 * turn_67d4624e95eabff1, turn_40a159d90975714c, turn_f38c0b19b70c8cf6) all left the
 * same `## Changes` gate failure intact. The framework never escalated, never stopped
 * the loop. Even after BUG-37's strict rejection, a non-progress guard adds defense
 * in depth.
 *
 * Fix requirements (from HUMAN-ROADMAP):
 *   - Track gate_failure_signature across accepted turns.
 *   - When N consecutive accepted turns produce the same signature AND gated file
 *     wasn't modified, emit `run_stalled` and transition to `needs_human`.
 *   - N configurable, default 3 (`run_loop.non_progress_threshold`).
 *   - `agentxchain unblock-run <run_id> --acknowledge-non-progress` resets counter.
 *
 * This test must FAIL on pre-fix HEAD and PASS after the fix.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  normalizeGovernedStateShape,
  markRunBlocked,
  reactivateGovernedRun,
} from '../../src/lib/governed-state.js';
import { writeDispatchBundle } from '../../src/lib/dispatch-bundle.js';

const tempDirs = [];

function makeRawConfig(overrides = {}) {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug38-test', name: 'BUG-38 Test', default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement features.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
    },
    runtimes: { 'local-dev': { type: 'local_cli', command: 'echo done' } },
    routing: {
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev'],
        exit_gate: 'implementation_complete',
      },
      qa: { entry_role: 'dev', allowed_next_roles: ['dev'] },
    },
    gates: {
      implementation_complete: {
        requires_files: ['.planning/IMPLEMENTATION_NOTES.md'],
        semantics: [{
          file: '.planning/IMPLEMENTATION_NOTES.md',
          rule: 'section_exists',
          config: { heading: '## Changes' },
        }],
      },
    },
    ...overrides,
  };
}

function makeConfig(overrides = {}) {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'bug38-test', name: 'BUG-38 Test', default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement features.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-dev',
      },
    },
    runtimes: { 'local-dev': { type: 'local_cli', command: 'echo done' } },
    phases: [
      { id: 'implementation', name: 'Implementation' },
      { id: 'qa', name: 'QA' },
    ],
    routing: {
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev'],
        exit_gate: 'implementation_complete',
      },
      qa: { entry_role: 'dev', allowed_next_roles: ['dev'] },
    },
    gates: {
      implementation_complete: {
        requires_files: ['.planning/IMPLEMENTATION_NOTES.md'],
        semantics: [{
          file: '.planning/IMPLEMENTATION_NOTES.md',
          rule: 'section_exists',
          config: { heading: '## Changes' },
        }],
      },
    },
    gate_semantic_coverage_mode: 'lenient',
    ...overrides,
  };
}

function createProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug38-'));
  tempDirs.push(root);
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'events'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(makeRawConfig(), null, 2));
  writeFileSync(join(root, 'README.md'), '# Test\n');
  // Create the gated file WITHOUT the required section — gate will fail
  writeFileSync(
    join(root, '.planning', 'IMPLEMENTATION_NOTES.md'),
    '# Implementation Notes\n\n## Overview\n\nThis is missing the ## Changes section.\n',
  );
  execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  return root;
}

function readState(root) {
  return normalizeGovernedStateShape(JSON.parse(readFileSync(join(root, '.agentxchain/state.json'), 'utf8'))).state;
}

function readEvents(root) {
  const eventsFile = join(root, '.agentxchain', 'events.jsonl');
  if (!existsSync(eventsFile)) return [];
  const events = [];
  const lines = readFileSync(eventsFile, 'utf8').trim().split('\n').filter(Boolean);
  for (const line of lines) {
    try { events.push(JSON.parse(line)); } catch {}
  }
  return events;
}

/**
 * Dispatch a dev turn that does NOT modify the gated file.
 * Returns the acceptance result and the turn ID.
 */
function dispatchNonProgressTurn(root, config, turnIndex) {
  const assign = assignGovernedTurn(root, config, 'dev', { runtime_id: 'local-dev' });
  assert.ok(assign.ok, `assign #${turnIndex} failed: ${assign.error}`);
  const turnId = assign.turn.turn_id;

  const state = readState(root);
  writeDispatchBundle(root, state, config, { turnId });

  // Dev turn that modifies only src/ files, NOT the gated .planning/ file
  const srcFile = `src/feature-${turnIndex}.js`;
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, srcFile), `// feature ${turnIndex}\nconsole.log("turn ${turnIndex}");\n`);
  execSync(`git add -A && git commit -m "dev turn ${turnIndex}"`, { cwd: root, stdio: 'ignore' });

  const turnResult = {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turnId,
    role: 'dev',
    runtime_id: 'local-dev',
    status: 'completed',
    summary: `Implemented feature ${turnIndex}. Ready for QA handoff.`,
    decisions: [],
    objections: [],
    files_changed: [srcFile],
    verification: { status: 'pass' },
    artifact: { type: 'workspace', ref: null },
    proposed_next_role: 'dev',
    // No phase_transition_request — the turn doesn't try to transition,
    // so gate_semantic_coverage (BUG-36) won't reject it.
    // But the gate is still failing after this turn.
  };

  const turnResultPath = join(root, '.agentxchain', 'staging', 'turn-result.json');
  writeFileSync(turnResultPath, JSON.stringify(turnResult, null, 2));

  const accept = acceptGovernedTurn(root, config, {
    turnId,
    resultPath: turnResultPath,
  });

  return { accept, turnId };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {}
  }
});

describe('BUG-38: non-progress convergence guard', () => {
  it('blocks the run after N consecutive accepted turns that do not reduce the same gate failure', () => {
    const config = makeConfig({ 'run_loop': { non_progress_threshold: 3 } });
    const root = createProject();

    initializeGovernedRun(root, config);
    const initialState = readState(root);
    assert.equal(initialState.status, 'active');

    // Dispatch 3 dev turns that all decline to modify the gated file
    // Turn 1: accepted, non-progress counter = 1
    const turn1 = dispatchNonProgressTurn(root, config, 1);
    assert.ok(turn1.accept.ok, `turn 1 acceptance should succeed: ${turn1.accept.error}`);
    let state = readState(root);
    assert.equal(state.status, 'active', 'run should still be active after turn 1');

    // Turn 2: accepted, non-progress counter = 2
    const turn2 = dispatchNonProgressTurn(root, config, 2);
    assert.ok(turn2.accept.ok, `turn 2 acceptance should succeed: ${turn2.accept.error}`);
    state = readState(root);
    assert.equal(state.status, 'active', 'run should still be active after turn 2');

    // Turn 3: should trigger the non-progress guard
    const turn3 = dispatchNonProgressTurn(root, config, 3);
    state = readState(root);

    // The run must be blocked with non-progress escalation
    assert.equal(
      state.status, 'blocked',
      `BUG-38: run must be blocked after ${3} non-progress turns, got status: ${state.status}`,
    );
    assert.ok(
      state.blocked_on && state.blocked_on.includes('non_progress'),
      `BUG-38: blocked_on must mention non_progress, got: ${state.blocked_on}`,
    );
    assert.ok(
      state.blocked_reason?.category === 'non_progress',
      `BUG-38: blocked_reason category must be non_progress, got: ${state.blocked_reason?.category}`,
    );
    assert.equal(
      state.blocked_reason?.recovery?.recovery_action,
      'agentxchain resume',
      'BUG-83: non-progress recovery guidance must use a valid resume command',
    );
    assert.doesNotMatch(
      state.blocked_reason?.recovery?.recovery_action || '',
      /--acknowledge-non-progress/,
      'BUG-83: resume must not advertise a non-existent --acknowledge-non-progress flag',
    );

    // run_stalled event must be emitted
    const events = readEvents(root);
    const stalledEvents = events.filter(e => e.event_type === 'run_stalled');
    assert.ok(
      stalledEvents.length > 0,
      'BUG-38: must emit run_stalled event when non-progress is detected',
    );
    const stalledEvent = stalledEvents[0];
    assert.ok(stalledEvent.payload, 'run_stalled event must have payload');
    assert.ok(
      stalledEvent.payload.consecutive_non_progress_turns >= 3,
      'run_stalled event must report >= 3 consecutive non-progress turns',
    );
  });

  it('unblock-run --acknowledge-non-progress resets the counter and allows resumption', () => {
    const config = makeConfig({ 'run_loop': { non_progress_threshold: 3 } });
    const root = createProject();

    initializeGovernedRun(root, config);

    // Trigger the non-progress block
    dispatchNonProgressTurn(root, config, 1);
    dispatchNonProgressTurn(root, config, 2);
    dispatchNonProgressTurn(root, config, 3);

    let state = readState(root);
    assert.equal(state.status, 'blocked', 'must be blocked before unblock');

    // Simulate unblock: reactivate the run and reset non-progress tracking
    const reactivation = reactivateGovernedRun(root, state, {
      acknowledge_non_progress: true,
    });
    assert.ok(
      reactivation.ok,
      `BUG-38: reactivateGovernedRun with acknowledge_non_progress should succeed: ${reactivation.error}`,
    );

    state = readState(root);
    assert.equal(state.status, 'active', 'run should be active after unblock');

    // Non-progress counter must be reset — next turn should succeed without immediate block
    const nextTurn = dispatchNonProgressTurn(root, config, 4);
    assert.ok(nextTurn.accept.ok, 'turn after unblock should be accepted');
    state = readState(root);
    assert.equal(state.status, 'active', 'run should remain active after 1 non-progress turn post-unblock');
  });

  it('counter resets when a turn actually modifies the gated file', () => {
    // Use a simple gate with only requires_files (no semantics) to isolate
    // the non-progress counter reset behavior from default semantic checks.
    const simpleGateConfig = makeConfig({
      'run_loop': { non_progress_threshold: 3 },
      gates: {
        implementation_complete: {
          requires_files: ['.planning/DESIGN.md'],
        },
      },
    });
    const simpleGateRawConfig = makeRawConfig({
      gates: {
        implementation_complete: {
          requires_files: ['.planning/DESIGN.md'],
        },
      },
    });

    const root = mkdtempSync(join(tmpdir(), 'axc-bug38-reset-'));
    tempDirs.push(root);
    mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(simpleGateRawConfig, null, 2));
    writeFileSync(join(root, 'README.md'), '# Test\n');
    // Do NOT create DESIGN.md — gate will fail on missing file
    execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', { cwd: root, stdio: 'ignore' });
    execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });

    initializeGovernedRun(root, simpleGateConfig);

    // 2 non-progress turns (don't create the missing file)
    dispatchNonProgressTurn(root, simpleGateConfig, 1);
    dispatchNonProgressTurn(root, simpleGateConfig, 2);

    let state = readState(root);
    assert.equal(state.status, 'active', 'still active after 2 non-progress turns');

    // Turn 3 creates the missing file — counter should reset
    const assign = assignGovernedTurn(root, simpleGateConfig, 'dev', { runtime_id: 'local-dev' });
    assert.ok(assign.ok);
    const turnId = assign.turn.turn_id;
    state = readState(root);
    writeDispatchBundle(root, state, simpleGateConfig, { turnId });

    // Create the gated file — satisfies the gate
    writeFileSync(join(root, '.planning', 'DESIGN.md'), '# Design\n\nComplete design doc.\n');
    execSync('git add -A && git commit -m "create gated file"', { cwd: root, stdio: 'ignore' });

    const turnResult = {
      schema_version: '1.0',
      run_id: state.run_id,
      turn_id: turnId,
      role: 'dev',
      runtime_id: 'local-dev',
      status: 'completed',
      summary: 'Created the gated file.',
      decisions: [],
      objections: [],
      files_changed: ['.planning/DESIGN.md'],
      verification: { status: 'pass' },
      artifact: { type: 'workspace', ref: null },
      proposed_next_role: 'dev',
    };

    const turnResultPath = join(root, '.agentxchain', 'staging', 'turn-result.json');
    writeFileSync(turnResultPath, JSON.stringify(turnResult, null, 2));

    const accept = acceptGovernedTurn(root, simpleGateConfig, { turnId, resultPath: turnResultPath });
    assert.ok(accept.ok, `turn that creates gated file should be accepted: ${accept.error}`);
    state = readState(root);
    assert.equal(state.status, 'active', 'run should remain active after progress was made');
    assert.equal(state.non_progress_count, 0, 'non-progress counter should be reset to 0 after gate was satisfied');

    // Now 2 more non-progress turns should NOT trigger the guard (no gate failure anymore)
    dispatchNonProgressTurn(root, simpleGateConfig, 4);
    dispatchNonProgressTurn(root, simpleGateConfig, 5);
    state = readState(root);
    assert.equal(state.status, 'active', 'run should still be active — no gate failure exists');
    assert.equal(state.non_progress_count, 0, 'non-progress count should remain 0 when no gate is failing');
  });
});
