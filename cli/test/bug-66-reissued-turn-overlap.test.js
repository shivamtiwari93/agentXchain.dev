/**
 * BUG-66: Reissued turns produce near-identical content, triggering
 * overlap acceptance conflicts.
 *
 * Verifies that classifyAcceptanceOverlap() skips history entries
 * with status 'reissued' and entries that are direct predecessors
 * of the target turn (via reissued_from).
 *
 * Spec: .planning/BUG_66_REISSUED_TURN_OVERLAP_SPEC.md
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const { _classifyAcceptanceOverlap: classifyAcceptanceOverlap } = await import(
  join(cliRoot, 'src', 'lib', 'governed-state.js')
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeHistoryEntry(overrides = {}) {
  return {
    turn_id: 'turn_old_001',
    run_id: 'run_001',
    role: 'dev',
    phase: 'implementation',
    status: 'accepted',
    files_changed: ['src/app.js', 'src/utils.js'],
    assigned_sequence: 1,
    accepted_sequence: 2,
    accepted_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeTargetTurn(overrides = {}) {
  return {
    turn_id: 'turn_new_001',
    run_id: 'run_001',
    assigned_role: 'dev',
    assigned_sequence: 3,
    attempt: 2,
    ...overrides,
  };
}

const minConfig = {
  roles: {
    dev: { title: 'Dev', mandate: 'Build.', write_authority: 'authoritative' },
  },
  routing: {
    implementation: { entry_role: 'dev', allowed_next_roles: ['dev'] },
  },
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('BUG-66: reissued turn overlap detection', () => {
  it('AT-BUG66-001: skips history entry with status "reissued"', () => {
    const target = makeTargetTurn();
    const conflictFiles = ['src/app.js', 'src/utils.js'];
    const history = [
      makeHistoryEntry({
        turn_id: 'turn_reissued_001',
        status: 'reissued',
        assigned_sequence: 1,
        accepted_sequence: 4, // higher than target — would normally be a conflict candidate
        files_changed: ['src/app.js', 'src/utils.js'],
      }),
    ];

    const result = classifyAcceptanceOverlap(target, conflictFiles, history, minConfig);
    assert.strictEqual(result.conflict, null, 'reissued entry should not trigger conflict');
  });

  it('AT-BUG66-002: skips history entry matching targetTurn.reissued_from', () => {
    const target = makeTargetTurn({ reissued_from: 'turn_old_001' });
    const conflictFiles = ['src/app.js', 'src/utils.js'];
    const history = [
      makeHistoryEntry({
        turn_id: 'turn_old_001',
        status: 'accepted', // not reissued status, but is direct predecessor
        assigned_sequence: 1,
        accepted_sequence: 4,
        files_changed: ['src/app.js', 'src/utils.js'],
      }),
    ];

    const result = classifyAcceptanceOverlap(target, conflictFiles, history, minConfig);
    assert.strictEqual(result.conflict, null, 'direct predecessor should not trigger conflict');
  });

  it('AT-BUG66-003: non-reissued entries with overlapping files STILL trigger conflict', () => {
    const target = makeTargetTurn();
    const conflictFiles = ['src/app.js', 'src/utils.js'];
    const history = [
      makeHistoryEntry({
        turn_id: 'turn_concurrent_001',
        status: 'accepted',
        assigned_sequence: 1,
        accepted_sequence: 4, // higher than target's assigned_sequence
        files_changed: ['src/app.js'],
      }),
    ];

    const result = classifyAcceptanceOverlap(target, conflictFiles, history, minConfig);
    assert.ok(result.conflict, 'normal accepted entry should still trigger conflict');
    assert.strictEqual(result.conflict.type, 'file_conflict');
    assert.deepStrictEqual(result.conflict.conflicting_files, ['src/app.js']);
  });

  it('AT-BUG66-004: mixed history — reissued skipped, accepted conflicting', () => {
    const target = makeTargetTurn();
    const conflictFiles = ['src/app.js', 'src/utils.js', 'src/index.js'];
    const history = [
      // This should be skipped (reissued)
      makeHistoryEntry({
        turn_id: 'turn_reissued_001',
        status: 'reissued',
        assigned_sequence: 1,
        accepted_sequence: 4,
        files_changed: ['src/app.js', 'src/utils.js'],
      }),
      // This should trigger conflict (normal accepted)
      makeHistoryEntry({
        turn_id: 'turn_accepted_002',
        status: 'accepted',
        role: 'qa',
        assigned_sequence: 2,
        accepted_sequence: 5,
        files_changed: ['src/index.js'],
      }),
    ];

    const result = classifyAcceptanceOverlap(target, conflictFiles, history, minConfig);
    assert.ok(result.conflict, 'should have conflict from the accepted entry');
    // Only src/index.js should conflict — src/app.js and src/utils.js from the reissued entry should be skipped
    assert.deepStrictEqual(result.conflict.conflicting_files, ['src/index.js']);
    assert.strictEqual(result.conflict.accepted_since.length, 1);
    assert.strictEqual(result.conflict.accepted_since[0].turn_id, 'turn_accepted_002');
  });

  it('AT-BUG66-005: no conflict when all overlapping entries are reissued', () => {
    const target = makeTargetTurn();
    const conflictFiles = ['src/app.js'];
    const history = [
      makeHistoryEntry({ turn_id: 'turn_r1', status: 'reissued', accepted_sequence: 4, files_changed: ['src/app.js'] }),
      makeHistoryEntry({ turn_id: 'turn_r2', status: 'reissued', accepted_sequence: 5, files_changed: ['src/app.js'] }),
    ];

    const result = classifyAcceptanceOverlap(target, conflictFiles, history, minConfig);
    assert.strictEqual(result.conflict, null, 'all-reissued history should produce no conflict');
  });
});
