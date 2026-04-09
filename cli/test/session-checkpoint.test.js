import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeSessionCheckpoint, readSessionCheckpoint, SESSION_PATH } from '../src/lib/session-checkpoint.js';

describe('session-checkpoint', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'session-ckpt-'));
    mkdirSync(join(root, '.agentxchain'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes a checkpoint file with expected fields', () => {
    const state = {
      run_id: 'run_abc123',
      current_phase: 'implementation',
      current_turn: { id: 'turn-002', role: 'dev' },
      status: 'active',
    };

    writeSessionCheckpoint(root, state, 'turn_accepted', { role: 'dev' });

    const checkpoint = readSessionCheckpoint(root);
    assert.ok(checkpoint, 'checkpoint should exist');
    assert.equal(checkpoint.run_id, 'run_abc123');
    assert.equal(checkpoint.last_turn_id, 'turn-002');
    assert.equal(checkpoint.last_phase, 'implementation');
    assert.equal(checkpoint.last_role, 'dev');
    assert.equal(checkpoint.checkpoint_reason, 'turn_accepted');
    assert.equal(checkpoint.run_status, 'active');
    assert.ok(checkpoint.session_id.startsWith('session_'));
    assert.ok(checkpoint.last_checkpoint_at);
  });

  it('preserves session_id across checkpoints for the same run', () => {
    const state = {
      run_id: 'run_abc123',
      current_phase: 'planning',
      status: 'active',
    };

    writeSessionCheckpoint(root, state, 'turn_accepted');
    const first = readSessionCheckpoint(root);

    state.current_phase = 'implementation';
    writeSessionCheckpoint(root, state, 'phase_approved');
    const second = readSessionCheckpoint(root);

    assert.equal(first.session_id, second.session_id, 'session_id should persist');
    assert.equal(second.checkpoint_reason, 'phase_approved');
    assert.equal(second.last_phase, 'implementation');
  });

  it('generates a new session_id when run_id changes', () => {
    const state1 = { run_id: 'run_aaa', status: 'active' };
    writeSessionCheckpoint(root, state1, 'turn_accepted');
    const first = readSessionCheckpoint(root);

    const state2 = { run_id: 'run_bbb', status: 'active' };
    writeSessionCheckpoint(root, state2, 'turn_accepted');
    const second = readSessionCheckpoint(root);

    assert.notEqual(first.session_id, second.session_id, 'different run should get new session');
  });

  it('returns null when no checkpoint exists', () => {
    const checkpoint = readSessionCheckpoint(root);
    assert.equal(checkpoint, null);
  });

  it('returns null for corrupted checkpoint file', () => {
    writeFileSync(join(root, SESSION_PATH), 'not json');
    const checkpoint = readSessionCheckpoint(root);
    assert.equal(checkpoint, null);
  });

  it('creates .agentxchain directory if missing', () => {
    const freshRoot = mkdtempSync(join(tmpdir(), 'session-ckpt-fresh-'));
    const state = { run_id: 'run_fresh', status: 'active' };
    writeSessionCheckpoint(freshRoot, state, 'turn_accepted');
    const checkpoint = readSessionCheckpoint(freshRoot);
    assert.ok(checkpoint);
    assert.equal(checkpoint.run_id, 'run_fresh');
    rmSync(freshRoot, { recursive: true, force: true });
  });
});
