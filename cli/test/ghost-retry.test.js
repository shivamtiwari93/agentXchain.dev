import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  GHOST_FAILURE_TYPES,
  readGhostRetryState,
  resetGhostRetryForRun,
  findPrimaryGhostTurn,
  classifyGhostRetryDecision,
  applyGhostRetryAttempt,
  applyGhostRetryExhaustion,
  buildGhostRetryExhaustionMirror,
} from '../src/lib/ghost-retry.js';

function ghostState({
  runId = 'run_abc',
  turnId = 'turn_ghost_1',
  failureType = 'runtime_spawn_failed',
  extraActive = {},
  stagedResult = null,
} = {}) {
  return {
    run_id: runId,
    blocked_reason: {
      category: 'ghost_turn',
      turn_id: turnId,
      recovery: {
        typed_reason: 'ghost_turn',
        owner: 'human',
        detail: 'agentxchain reissue-turn --turn ' + turnId + ' --reason ghost',
      },
    },
    active_turns: {
      [turnId]: {
        turn_id: turnId,
        assigned_role: 'pm',
        status: 'failed_start',
        failed_start_reason: failureType,
        staged_result: stagedResult,
      },
      ...extraActive,
    },
  };
}

const FULL_RETRY_OPTS = { enabled: true, maxRetriesPerRun: 3, cooldownSeconds: 5 };

describe('ghost-retry helper', () => {
  describe('GHOST_FAILURE_TYPES', () => {
    it('only recognizes typed BUG-51 startup failures', () => {
      assert.deepEqual([...GHOST_FAILURE_TYPES], ['runtime_spawn_failed', 'stdout_attach_failed']);
    });
  });

  describe('readGhostRetryState', () => {
    it('returns a safe default when the session has no ghost_retry field', () => {
      const s = readGhostRetryState({});
      assert.equal(s.attempts, 0);
      assert.equal(s.run_id, null);
      assert.equal(s.exhausted, false);
    });

    it('sanitizes malformed attempts into 0', () => {
      const s = readGhostRetryState({ ghost_retry: { attempts: -5 } });
      assert.equal(s.attempts, 0);
    });

    it('returns the stored shape when valid', () => {
      const s = readGhostRetryState({
        ghost_retry: {
          run_id: 'run_x',
          attempts: 2,
          max_retries_per_run: 3,
          last_old_turn_id: 'turn_old',
          last_new_turn_id: 'turn_new',
          last_failure_type: 'stdout_attach_failed',
          last_retried_at: '2026-04-22T01:00:00.000Z',
          exhausted: false,
        },
      });
      assert.equal(s.run_id, 'run_x');
      assert.equal(s.attempts, 2);
      assert.equal(s.last_failure_type, 'stdout_attach_failed');
    });
  });

  describe('resetGhostRetryForRun', () => {
    it('resets when run_id differs', () => {
      const s = resetGhostRetryForRun({ ghost_retry: { run_id: 'run_old', attempts: 2 } }, 'run_new');
      assert.equal(s.run_id, 'run_new');
      assert.equal(s.attempts, 0);
    });

    it('preserves counter when run_id matches', () => {
      const s = resetGhostRetryForRun({ ghost_retry: { run_id: 'run_x', attempts: 2, max_retries_per_run: 3 } }, 'run_x');
      assert.equal(s.run_id, 'run_x');
      assert.equal(s.attempts, 2);
      assert.equal(s.max_retries_per_run, 3);
    });
  });

  describe('findPrimaryGhostTurn', () => {
    it('returns the hinted ghost when the category matches', () => {
      const ghost = findPrimaryGhostTurn(ghostState());
      assert.equal(ghost.turn_id, 'turn_ghost_1');
      assert.equal(ghost.failure_type, 'runtime_spawn_failed');
    });

    it('returns null when category is not ghost_turn', () => {
      const s = ghostState();
      s.blocked_reason.category = 'stale_turn';
      assert.equal(findPrimaryGhostTurn(s), null);
    });

    it('returns null when active turn has no typed BUG-51 failure', () => {
      const s = ghostState({ failureType: 'arbitrary_other_reason' });
      assert.equal(findPrimaryGhostTurn(s), null);
    });

    it('returns null when the turn has a meaningful staged result', () => {
      const s = ghostState({ stagedResult: { summary: 'partial work' } });
      assert.equal(findPrimaryGhostTurn(s), null);
    });

    it('falls back to scanning active_turns when blocked_reason.turn_id is missing', () => {
      const s = ghostState();
      delete s.blocked_reason.turn_id;
      const ghost = findPrimaryGhostTurn(s);
      assert.equal(ghost.turn_id, 'turn_ghost_1');
    });
  });

  describe('classifyGhostRetryDecision', () => {
    it('returns disabled when auto_retry_on_ghost is off', () => {
      const d = classifyGhostRetryDecision({
        state: ghostState(),
        session: {},
        autoRetryOnGhost: { enabled: false, maxRetriesPerRun: 3 },
      });
      assert.equal(d.decision, 'disabled');
    });

    it('returns skip_non_ghost when blocker is not a ghost', () => {
      const s = ghostState();
      s.blocked_reason.category = 'budget_exceeded';
      const d = classifyGhostRetryDecision({ state: s, session: {}, autoRetryOnGhost: FULL_RETRY_OPTS });
      assert.equal(d.decision, 'skip_non_ghost');
    });

    it('returns missing_active_ghost when reason references a turn not in active_turns', () => {
      const s = ghostState();
      s.active_turns = {};
      const d = classifyGhostRetryDecision({ state: s, session: {}, autoRetryOnGhost: FULL_RETRY_OPTS });
      assert.equal(d.decision, 'missing_active_ghost');
    });

    it('returns retry when budget is available', () => {
      const d = classifyGhostRetryDecision({
        state: ghostState(),
        session: {},
        autoRetryOnGhost: FULL_RETRY_OPTS,
      });
      assert.equal(d.decision, 'retry');
      assert.equal(d.attempts, 0);
      assert.equal(d.maxRetries, 3);
      assert.equal(d.ghost.turn_id, 'turn_ghost_1');
      assert.equal(d.ghost.failure_type, 'runtime_spawn_failed');
    });

    it('increments the counter semantically across repeated retries on the same run', () => {
      const state = ghostState();
      const session = applyGhostRetryAttempt({}, {
        runId: 'run_abc',
        oldTurnId: 'turn_old',
        newTurnId: 'turn_ghost_1',
        failureType: 'runtime_spawn_failed',
        maxRetries: 3,
        nowIso: '2026-04-22T00:00:00.000Z',
      });
      const d = classifyGhostRetryDecision({
        state,
        session,
        autoRetryOnGhost: FULL_RETRY_OPTS,
      });
      assert.equal(d.decision, 'retry');
      assert.equal(d.attempts, 1);
    });

    it('returns exhausted once attempts reach maxRetries', () => {
      const session = {
        ghost_retry: {
          run_id: 'run_abc',
          attempts: 3,
          max_retries_per_run: 3,
          last_failure_type: 'stdout_attach_failed',
        },
      };
      const d = classifyGhostRetryDecision({
        state: ghostState(),
        session,
        autoRetryOnGhost: FULL_RETRY_OPTS,
      });
      assert.equal(d.decision, 'exhausted');
      assert.equal(d.attempts, 3);
      assert.equal(d.retryState.exhausted, true);
    });

    it('resets the counter when the run_id changes (retry budget is run-scoped)', () => {
      const session = {
        ghost_retry: { run_id: 'run_prior', attempts: 3, max_retries_per_run: 3 },
      };
      const d = classifyGhostRetryDecision({
        state: ghostState({ runId: 'run_new' }),
        session,
        autoRetryOnGhost: FULL_RETRY_OPTS,
      });
      assert.equal(d.decision, 'retry');
      assert.equal(d.attempts, 0);
      assert.equal(d.retryState.run_id, 'run_new');
    });

    it('returns missing_run_id when neither state nor runId parameter carry one', () => {
      const s = ghostState();
      delete s.run_id;
      const d = classifyGhostRetryDecision({
        state: s,
        session: {},
        autoRetryOnGhost: FULL_RETRY_OPTS,
      });
      assert.equal(d.decision, 'missing_run_id');
    });

    it('defaults maxRetries to 3 when opts omit maxRetriesPerRun', () => {
      const d = classifyGhostRetryDecision({
        state: ghostState(),
        session: {},
        autoRetryOnGhost: { enabled: true },
      });
      assert.equal(d.maxRetries, 3);
    });
  });

  describe('applyGhostRetryAttempt', () => {
    it('increments attempts and records the turn ids and failure type', () => {
      const s = applyGhostRetryAttempt({}, {
        runId: 'run_abc',
        oldTurnId: 'turn_old',
        newTurnId: 'turn_new',
        failureType: 'runtime_spawn_failed',
        maxRetries: 3,
        nowIso: '2026-04-22T00:00:00.000Z',
      });
      assert.equal(s.ghost_retry.run_id, 'run_abc');
      assert.equal(s.ghost_retry.attempts, 1);
      assert.equal(s.ghost_retry.last_old_turn_id, 'turn_old');
      assert.equal(s.ghost_retry.last_new_turn_id, 'turn_new');
      assert.equal(s.ghost_retry.last_failure_type, 'runtime_spawn_failed');
      assert.equal(s.ghost_retry.last_retried_at, '2026-04-22T00:00:00.000Z');
      assert.equal(s.ghost_retry.exhausted, false);
    });

    it('chains across multiple retries within the same run', () => {
      let s = {};
      s = applyGhostRetryAttempt(s, { runId: 'run_abc', oldTurnId: 't1', newTurnId: 't2', failureType: 'runtime_spawn_failed', maxRetries: 3, nowIso: 'now1' });
      s = applyGhostRetryAttempt(s, { runId: 'run_abc', oldTurnId: 't2', newTurnId: 't3', failureType: 'stdout_attach_failed', maxRetries: 3, nowIso: 'now2' });
      assert.equal(s.ghost_retry.attempts, 2);
      assert.equal(s.ghost_retry.last_failure_type, 'stdout_attach_failed');
    });

    it('resets when run_id changes before incrementing', () => {
      let s = {};
      s = applyGhostRetryAttempt(s, { runId: 'run_a', oldTurnId: 't1', newTurnId: 't2', failureType: 'runtime_spawn_failed', maxRetries: 3, nowIso: 'now1' });
      s = applyGhostRetryAttempt(s, { runId: 'run_b', oldTurnId: 't1', newTurnId: 't2', failureType: 'runtime_spawn_failed', maxRetries: 3, nowIso: 'now2' });
      assert.equal(s.ghost_retry.run_id, 'run_b');
      assert.equal(s.ghost_retry.attempts, 1);
    });
  });

  describe('applyGhostRetryExhaustion', () => {
    it('marks exhausted=true without incrementing attempts', () => {
      const base = {
        ghost_retry: {
          run_id: 'run_abc',
          attempts: 3,
          max_retries_per_run: 3,
          last_old_turn_id: 't_old',
          last_failure_type: 'stdout_attach_failed',
        },
      };
      const s = applyGhostRetryExhaustion(base, {
        runId: 'run_abc',
        failureType: 'stdout_attach_failed',
        turnId: 't_old',
        maxRetries: 3,
      });
      assert.equal(s.ghost_retry.attempts, 3);
      assert.equal(s.ghost_retry.exhausted, true);
      assert.equal(s.ghost_retry.last_failure_type, 'stdout_attach_failed');
    });
  });

  describe('buildGhostRetryExhaustionMirror', () => {
    it('formats a human-readable exhaustion detail string', () => {
      const s = buildGhostRetryExhaustionMirror({
        attempts: 3,
        maxRetries: 3,
        failureType: 'stdout_attach_failed',
        manualRecoveryDetail: 'Run `agentxchain reissue-turn --turn turn_x --reason ghost` to recover.',
      });
      assert.ok(s.includes('Auto-retry exhausted after 3/3'));
      assert.ok(s.includes('stdout_attach_failed'));
      assert.ok(s.includes('reissue-turn'));
    });

    it('works without a manualRecoveryDetail suffix', () => {
      const s = buildGhostRetryExhaustionMirror({ attempts: 3, maxRetries: 3, failureType: 'runtime_spawn_failed' });
      assert.ok(s.startsWith('Auto-retry exhausted after 3/3'));
      assert.ok(s.includes('runtime_spawn_failed'));
    });
  });
});
