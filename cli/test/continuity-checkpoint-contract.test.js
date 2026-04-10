/**
 * Continuity / Checkpointing contract tests.
 *
 * Tests AT-CC-001 through AT-CC-011 from CONTINUITY_CHECKPOINTING_SPEC.md.
 * Validates that checkpoint writes happen at every governance boundary,
 * that the enriched schema captures recovery-critical metadata, and that
 * restart correctly detects repo drift and surfaces pending gates.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import {
  writeSessionCheckpoint,
  readSessionCheckpoint,
  captureBaselineRef,
  SESSION_PATH,
} from '../src/lib/session-checkpoint.js';

// ── Helper: build a governed state fixture ──────────────────────────────────

function makeState(overrides = {}) {
  return {
    run_id: 'run_cc_test',
    status: 'active',
    phase: 'implementation',
    current_phase: 'implementation',
    current_turn: null,
    active_turns: {},
    last_completed_turn_id: null,
    pending_phase_transition: null,
    pending_run_completion: null,
    ...overrides,
  };
}

function makeTurn(id = 'turn_001', role = 'dev') {
  return {
    turn_id: id,
    assigned_role: role,
    status: 'running',
    attempt: 1,
    started_at: new Date().toISOString(),
  };
}

// ── Helper: create a temp git repo for baseline tests ────────────────────────

function initGitRepo(root) {
  execSync('git init', { cwd: root, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: root, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: root, stdio: 'pipe' });
  writeFileSync(join(root, 'init.txt'), 'init');
  execSync('git add . && git commit -m "init"', { cwd: root, stdio: 'pipe' });
}

describe('continuity-checkpoint-contract', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cc-contract-'));
    mkdirSync(join(root, '.agentxchain'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // ── AT-CC-001: turn assignment writes a checkpoint ──────────────────────

  it('AT-CC-001: checkpoint is written at turn_assigned with enriched schema', () => {
    const turn = makeTurn('turn_001', 'dev');
    const state = makeState({
      active_turns: { turn_001: turn },
      current_turn: turn,
    });

    writeSessionCheckpoint(root, state, 'turn_assigned', {
      role: 'dev',
      dispatch_dir: '.agentxchain/dispatch/turns/turn_001',
    });

    const ckpt = readSessionCheckpoint(root);
    assert.ok(ckpt, 'checkpoint should exist');
    assert.equal(ckpt.checkpoint_reason, 'turn_assigned');
    assert.equal(ckpt.run_status, 'active');
    assert.equal(ckpt.last_turn_id, 'turn_001');
    assert.equal(ckpt.last_role, 'dev');
    assert.deepEqual(ckpt.active_turn_ids, ['turn_001']);
    assert.equal(ckpt.blocked, false);
    assert.ok(ckpt.baseline_ref, 'baseline_ref should be populated');
    assert.equal(ckpt.agent_context.dispatch_dir, '.agentxchain/dispatch/turns/turn_001');
  });

  // ── AT-CC-002: turn acceptance updates checkpoint ──────────────────────

  it('AT-CC-002: checkpoint after turn_accepted updates last_completed_turn_id', () => {
    const state = makeState({
      active_turns: {},
      last_completed_turn_id: 'turn_001',
    });

    writeSessionCheckpoint(root, state, 'turn_accepted', { role: 'dev' });

    const ckpt = readSessionCheckpoint(root);
    assert.equal(ckpt.checkpoint_reason, 'turn_accepted');
    assert.equal(ckpt.last_completed_turn_id, 'turn_001');
    assert.ok(ckpt.last_checkpoint_at, 'timestamp should be set');
  });

  // ── AT-CC-003: blocked state writes checkpoint ─────────────────────────

  it('AT-CC-003: checkpoint is written at blocked state with blocked=true', () => {
    const turn = makeTurn('turn_002', 'qa');
    const state = makeState({
      status: 'blocked',
      active_turns: { turn_002: turn },
      blocked_on: 'hook:after_acceptance:lint',
      blocked_reason: { category: 'hook_failure' },
    });

    writeSessionCheckpoint(root, state, 'blocked', { role: 'qa' });

    const ckpt = readSessionCheckpoint(root);
    assert.equal(ckpt.checkpoint_reason, 'blocked');
    assert.equal(ckpt.run_status, 'blocked');
    assert.equal(ckpt.blocked, true);
    assert.deepEqual(ckpt.active_turn_ids, ['turn_002']);
    assert.equal(ckpt.last_role, 'qa');
  });

  // ── AT-CC-004: phase approval updates checkpoint phase ─────────────────

  it('AT-CC-004: checkpoint after phase_approved updates phase metadata', () => {
    const state = makeState({
      phase: 'qa',
      current_phase: 'qa',
    });

    writeSessionCheckpoint(root, state, 'phase_approved');

    const ckpt = readSessionCheckpoint(root);
    assert.equal(ckpt.checkpoint_reason, 'phase_approved');
    assert.equal(ckpt.phase, 'qa');
  });

  // ── AT-CC-005: run completion updates checkpoint to terminal ────────────

  it('AT-CC-005: checkpoint after run_completed reflects terminal state', () => {
    const state = makeState({
      status: 'completed',
      phase: 'release',
    });

    writeSessionCheckpoint(root, state, 'run_completed');

    const ckpt = readSessionCheckpoint(root);
    assert.equal(ckpt.checkpoint_reason, 'run_completed');
    assert.equal(ckpt.run_status, 'completed');
    assert.equal(ckpt.blocked, false);
  });

  // ── AT-CC-006: restart reconnects to abandoned active turn ─────────────

  it('AT-CC-006: restart_reconnect checkpoint preserves active turn info', () => {
    const turn = makeTurn('turn_003', 'architect');
    const state = makeState({
      active_turns: { turn_003: turn },
    });

    writeSessionCheckpoint(root, state, 'restart_reconnect');

    const ckpt = readSessionCheckpoint(root);
    assert.equal(ckpt.checkpoint_reason, 'restart_reconnect');
    assert.deepEqual(ckpt.active_turn_ids, ['turn_003']);
    assert.equal(ckpt.last_turn_id, 'turn_003');
  });

  // ── AT-CC-007: restart on paused/idle assigns next turn ────────────────
  // (Tested via assignGovernedTurn checkpoint write — this verifies the
  //  shape when the state is paused with no active turns)

  it('AT-CC-007: checkpoint on idle state with no active turns', () => {
    const state = makeState({
      status: 'idle',
      active_turns: {},
    });

    // Simulates what restart does before assigning
    writeSessionCheckpoint(root, state, 'turn_assigned', { role: 'pm' });

    const ckpt = readSessionCheckpoint(root);
    assert.equal(ckpt.checkpoint_reason, 'turn_assigned');
    assert.equal(ckpt.last_role, 'pm');
    assert.deepEqual(ckpt.active_turn_ids, []);
  });

  // ── AT-CC-008: pending gate is surfaced in checkpoint ──────────────────

  it('AT-CC-008: pending phase transition is captured in checkpoint', () => {
    const state = makeState({
      status: 'paused',
      pending_phase_transition: {
        from: 'implementation',
        to: 'qa',
        gate: 'human_approval',
        requested_by_turn: 'turn_005',
        requested_at: '2026-04-10T00:00:00Z',
      },
    });

    writeSessionCheckpoint(root, state, 'restart_reconnect');

    const ckpt = readSessionCheckpoint(root);
    assert.equal(ckpt.pending_gate, 'human_approval');
    assert.equal(ckpt.pending_run_completion, null);
  });

  it('AT-CC-008b: pending run completion is captured in checkpoint', () => {
    const state = makeState({
      status: 'paused',
      pending_run_completion: {
        gate: 'human_approval',
        requested_by_turn: 'turn_007',
      },
    });

    writeSessionCheckpoint(root, state, 'restart_reconnect');

    const ckpt = readSessionCheckpoint(root);
    assert.equal(ckpt.pending_run_completion, true);
    assert.equal(ckpt.pending_gate, null);
  });

  // ── AT-CC-009: stale run_id mismatch ───────────────────────────────────

  it('AT-CC-009: new session_id generated when run_id changes (stale checkpoint)', () => {
    const state1 = makeState({ run_id: 'run_old' });
    writeSessionCheckpoint(root, state1, 'turn_accepted');
    const ckpt1 = readSessionCheckpoint(root);

    const state2 = makeState({ run_id: 'run_new' });
    writeSessionCheckpoint(root, state2, 'turn_assigned');
    const ckpt2 = readSessionCheckpoint(root);

    assert.notEqual(ckpt1.session_id, ckpt2.session_id,
      'stale run_id should produce new session');
    assert.equal(ckpt2.run_id, 'run_new');
  });

  // ── AT-CC-010: dirty workspace drift in baseline_ref ───────────────────

  it('AT-CC-010: baseline_ref captures workspace_dirty state', () => {
    initGitRepo(root);
    mkdirSync(join(root, '.agentxchain'), { recursive: true });

    // Clean state
    const state = makeState();
    writeSessionCheckpoint(root, state, 'turn_assigned');
    const ckptClean = readSessionCheckpoint(root);
    assert.equal(ckptClean.baseline_ref.workspace_dirty, false,
      'clean workspace should be false');

    // Now dirty it
    writeFileSync(join(root, 'dirty.txt'), 'dirty');
    writeSessionCheckpoint(root, state, 'turn_accepted');
    const ckptDirty = readSessionCheckpoint(root);
    assert.equal(ckptDirty.baseline_ref.workspace_dirty, true,
      'dirty workspace should be true');
  });

  // ── AT-CC-011: captureBaselineRef captures git head and branch ─────────

  it('AT-CC-011: captureBaselineRef returns git_head and git_branch', () => {
    initGitRepo(root);

    const baseline = captureBaselineRef(root);
    assert.ok(baseline.git_head, 'git_head should be a commit hash');
    assert.match(baseline.git_head, /^[0-9a-f]{40}$/, 'should be a 40-char hex hash');
    assert.ok(baseline.git_branch, 'git_branch should be set');
    assert.equal(baseline.workspace_dirty, false);
  });

  it('AT-CC-011b: captureBaselineRef returns nulls for non-git directory', () => {
    // root is not a git repo
    const baseline = captureBaselineRef(root);
    assert.equal(baseline.git_head, null);
    assert.equal(baseline.git_branch, null);
    assert.equal(baseline.workspace_dirty, null);
  });

  // ── Schema enrichment tests ────────────────────────────────────────────

  it('enriched checkpoint includes all spec-required fields', () => {
    const turn = makeTurn('turn_010', 'security');
    const state = makeState({
      active_turns: { turn_010: turn },
      current_turn: turn,
      last_completed_turn_id: 'turn_009',
      pending_phase_transition: { gate: 'human_approval', from: 'impl', to: 'qa' },
    });

    writeSessionCheckpoint(root, state, 'turn_assigned', {
      role: 'security',
      dispatch_dir: '.agentxchain/dispatch/turns/turn_010',
    });

    const ckpt = readSessionCheckpoint(root);

    // All spec-required fields must be present
    const requiredFields = [
      'session_id', 'run_id', 'started_at', 'last_checkpoint_at',
      'checkpoint_reason', 'run_status', 'phase', 'last_turn_id',
      'last_completed_turn_id', 'active_turn_ids', 'last_role',
      'pending_gate', 'pending_run_completion', 'blocked',
      'baseline_ref', 'agent_context',
    ];

    for (const field of requiredFields) {
      assert.ok(field in ckpt, `checkpoint must include "${field}"`);
    }

    assert.equal(ckpt.last_completed_turn_id, 'turn_009');
    assert.equal(ckpt.pending_gate, 'human_approval');
    assert.equal(ckpt.blocked, false);
    assert.ok(ckpt.baseline_ref);
  });

  it('checkpoint writes are non-fatal on filesystem errors', () => {
    // Write to a path that will fail (root doesn't exist)
    const badRoot = '/nonexistent/path/that/should/not/exist';
    // Should not throw
    writeSessionCheckpoint(badRoot, makeState(), 'turn_accepted');
    // And reading from non-existent returns null
    const ckpt = readSessionCheckpoint(badRoot);
    assert.equal(ckpt, null);
  });
});
