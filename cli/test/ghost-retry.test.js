import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  GHOST_FAILURE_TYPES,
  SIGNATURE_REPEAT_THRESHOLD,
  readGhostRetryState,
  resetGhostRetryForRun,
  findPrimaryGhostTurn,
  classifyGhostRetryDecision,
  applyGhostRetryAttempt,
  applyGhostRetryExhaustion,
  buildGhostRetryExhaustionMirror,
  buildAttemptFingerprint,
  classifySameSignatureExhaustion,
  buildGhostRetryDiagnosticBundle,
  extractLatestStderrDiagnostic,
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

    // Slice 2c
    it('formats a same-signature mirror when signatureRepeat is provided', () => {
      const s = buildGhostRetryExhaustionMirror({
        attempts: 2,
        maxRetries: 3,
        failureType: 'stdout_attach_failed',
        manualRecoveryDetail: 'Run reissue manually.',
        signatureRepeat: { signature: 'claude|pm|stdout_attach_failed', consecutive: 2 },
      });
      assert.ok(s.startsWith('Auto-retry stopped early'));
      assert.ok(s.includes('2 consecutive same-signature attempts'));
      assert.ok(s.includes('claude|pm|stdout_attach_failed'));
      assert.ok(s.includes('last attempt 2/3'));
      assert.ok(s.includes('Run reissue manually.'));
    });
  });

  // -----------------------------------------------------------------------
  // Slice 2c: per-attempt fingerprint log + same-signature early-stop +
  // diagnostic bundle.
  // -----------------------------------------------------------------------

  describe('SIGNATURE_REPEAT_THRESHOLD', () => {
    it('is 2 — a second identical signature is already non-transient', () => {
      assert.equal(SIGNATURE_REPEAT_THRESHOLD, 2);
    });
  });

  describe('buildAttemptFingerprint', () => {
    it('joins runtime/role/failure with pipe separators', () => {
      assert.equal(
        buildAttemptFingerprint({ runtime_id: 'claude', role_id: 'pm', failure_type: 'runtime_spawn_failed' }),
        'claude|pm|runtime_spawn_failed',
      );
    });

    it('normalizes missing fields to ?', () => {
      assert.equal(buildAttemptFingerprint({}), '?|?|?');
      assert.equal(
        buildAttemptFingerprint({ runtime_id: 'codex' }),
        'codex|?|?',
      );
    });
  });

  describe('classifySameSignatureExhaustion', () => {
    it('returns not-triggered when log is shorter than threshold', () => {
      const r = classifySameSignatureExhaustion([{ runtime_id: 'claude', role_id: 'pm', failure_type: 'x' }], 2);
      assert.equal(r.triggered, false);
      assert.equal(r.consecutive, 0);
    });

    it('returns triggered when two tail entries share fingerprint', () => {
      const log = [
        { runtime_id: 'claude', role_id: 'pm', failure_type: 'runtime_spawn_failed' },
        { runtime_id: 'claude', role_id: 'pm', failure_type: 'runtime_spawn_failed' },
      ];
      const r = classifySameSignatureExhaustion(log, 2);
      assert.equal(r.triggered, true);
      assert.equal(r.signature, 'claude|pm|runtime_spawn_failed');
      assert.equal(r.consecutive, 2);
    });

    it('returns not-triggered when tail mixes signatures', () => {
      const log = [
        { runtime_id: 'claude', role_id: 'pm', failure_type: 'runtime_spawn_failed' },
        { runtime_id: 'claude', role_id: 'dev', failure_type: 'runtime_spawn_failed' },
      ];
      const r = classifySameSignatureExhaustion(log, 2);
      assert.equal(r.triggered, false);
    });

    it('refuses to trigger on an all-unknown signature (?|?|?)', () => {
      const log = [{}, {}];
      const r = classifySameSignatureExhaustion(log, 2);
      assert.equal(r.triggered, false);
    });

    it('only inspects the tail: old mismatched entries do not defeat a recent pair', () => {
      const log = [
        { runtime_id: 'claude', role_id: 'pm', failure_type: 'a' },
        { runtime_id: 'claude', role_id: 'pm', failure_type: 'b' },
        { runtime_id: 'codex', role_id: 'qa', failure_type: 'stdout_attach_failed' },
        { runtime_id: 'codex', role_id: 'qa', failure_type: 'stdout_attach_failed' },
      ];
      const r = classifySameSignatureExhaustion(log, 2);
      assert.equal(r.triggered, true);
      assert.equal(r.signature, 'codex|qa|stdout_attach_failed');
    });

    it('rejects thresholds < 2', () => {
      const log = [{ runtime_id: 'claude', role_id: 'pm', failure_type: 'x' }];
      assert.equal(classifySameSignatureExhaustion(log, 1).triggered, false);
    });
  });

  describe('applyGhostRetryAttempt records per-attempt fingerprint', () => {
    it('appends fingerprint entry with runtime/role/failure/timing fields', () => {
      const s = applyGhostRetryAttempt({}, {
        runId: 'run_x',
        oldTurnId: 't_old',
        newTurnId: 't_new',
        failureType: 'runtime_spawn_failed',
        maxRetries: 3,
        nowIso: 'now',
        runtimeId: 'claude',
        roleId: 'pm',
        runningMs: 30285,
        thresholdMs: 30000,
      });
      assert.equal(s.ghost_retry.attempts_log.length, 1);
      const e = s.ghost_retry.attempts_log[0];
      assert.equal(e.attempt, 1);
      assert.equal(e.runtime_id, 'claude');
      assert.equal(e.role_id, 'pm');
      assert.equal(e.failure_type, 'runtime_spawn_failed');
      assert.equal(e.running_ms, 30285);
      assert.equal(e.threshold_ms, 30000);
      assert.equal(e.retried_at, 'now');
    });

    it('resets attempts_log when run_id changes', () => {
      let s = applyGhostRetryAttempt({}, {
        runId: 'run_a', oldTurnId: 't1', newTurnId: 't2', failureType: 'runtime_spawn_failed',
        maxRetries: 3, nowIso: 'n1', runtimeId: 'claude', roleId: 'pm',
      });
      s = applyGhostRetryAttempt(s, {
        runId: 'run_b', oldTurnId: 't3', newTurnId: 't4', failureType: 'stdout_attach_failed',
        maxRetries: 3, nowIso: 'n2', runtimeId: 'codex', roleId: 'qa',
      });
      assert.equal(s.ghost_retry.attempts_log.length, 1);
      assert.equal(s.ghost_retry.attempts_log[0].runtime_id, 'codex');
    });

    it('caps the attempts_log at 10 entries', () => {
      let s = {};
      for (let i = 0; i < 15; i += 1) {
        s = applyGhostRetryAttempt(s, {
          runId: 'run_x', oldTurnId: `t${i}`, newTurnId: `t${i + 1}`, failureType: 'runtime_spawn_failed',
          maxRetries: 20, nowIso: `n${i}`, runtimeId: 'claude', roleId: 'pm',
        });
      }
      assert.equal(s.ghost_retry.attempts_log.length, 10);
      // The tail is preserved (attempt 15 last).
      assert.equal(s.ghost_retry.attempts_log[9].attempt, 15);
    });
  });

  describe('classifyGhostRetryDecision same-signature early stop', () => {
    it('returns exhausted with same_signature_repeat reason when attempts_log shows two same fingerprints', () => {
      // Budget is NOT exhausted in raw count terms (2 < 3) but the pattern
      // says retry is pointless.
      const session = {
        ghost_retry: {
          run_id: 'run_abc',
          attempts: 2,
          max_retries_per_run: 3,
          attempts_log: [
            { attempt: 1, runtime_id: 'claude', role_id: 'pm', failure_type: 'stdout_attach_failed' },
            { attempt: 2, runtime_id: 'claude', role_id: 'pm', failure_type: 'stdout_attach_failed' },
          ],
        },
      };
      const d = classifyGhostRetryDecision({
        state: ghostState({ runId: 'run_abc', failureType: 'stdout_attach_failed' }),
        session,
        autoRetryOnGhost: FULL_RETRY_OPTS,
      });
      assert.equal(d.decision, 'exhausted');
      assert.ok(d.reason.startsWith('same_signature_repeat'));
      assert.equal(d.attempts, 2);
      assert.equal(d.signatureRepeat.signature, 'claude|pm|stdout_attach_failed');
      assert.equal(d.signatureRepeat.consecutive, 2);
      assert.equal(d.retryState.exhausted, true);
    });

    it('continues to retry when fingerprints differ even with log length >= threshold', () => {
      const session = {
        ghost_retry: {
          run_id: 'run_abc',
          attempts: 2,
          max_retries_per_run: 3,
          attempts_log: [
            { attempt: 1, runtime_id: 'claude', role_id: 'pm', failure_type: 'runtime_spawn_failed' },
            { attempt: 2, runtime_id: 'claude', role_id: 'pm', failure_type: 'stdout_attach_failed' },
          ],
        },
      };
      const d = classifyGhostRetryDecision({
        state: ghostState({ runId: 'run_abc' }),
        session,
        autoRetryOnGhost: FULL_RETRY_OPTS,
      });
      assert.equal(d.decision, 'retry');
      assert.equal(d.attempts, 2);
    });

    it('budget exhaustion still wins when both conditions are present (reason prefers raw budget)', () => {
      const session = {
        ghost_retry: {
          run_id: 'run_abc',
          attempts: 3,
          max_retries_per_run: 3,
          attempts_log: [
            { attempt: 1, runtime_id: 'claude', role_id: 'pm', failure_type: 'stdout_attach_failed' },
            { attempt: 2, runtime_id: 'claude', role_id: 'pm', failure_type: 'stdout_attach_failed' },
            { attempt: 3, runtime_id: 'claude', role_id: 'pm', failure_type: 'stdout_attach_failed' },
          ],
        },
      };
      const d = classifyGhostRetryDecision({
        state: ghostState({ runId: 'run_abc', failureType: 'stdout_attach_failed' }),
        session,
        autoRetryOnGhost: FULL_RETRY_OPTS,
      });
      assert.equal(d.decision, 'exhausted');
      // Raw budget check fires first by design; signatureRepeat is not set.
      assert.ok(d.reason.startsWith('retry budget exhausted'));
      assert.equal(d.signatureRepeat, undefined);
    });
  });

  describe('buildGhostRetryDiagnosticBundle', () => {
    it('summarizes attempts_log with fingerprint counts and final signature', () => {
      const session = {
        ghost_retry: {
          run_id: 'run_x',
          attempts: 3,
          max_retries_per_run: 3,
          attempts_log: [
            { attempt: 1, runtime_id: 'claude', role_id: 'pm', failure_type: 'runtime_spawn_failed' },
            { attempt: 2, runtime_id: 'claude', role_id: 'pm', failure_type: 'stdout_attach_failed' },
            { attempt: 3, runtime_id: 'claude', role_id: 'pm', failure_type: 'stdout_attach_failed' },
          ],
        },
      };
      const bundle = buildGhostRetryDiagnosticBundle(session);
      assert.equal(bundle.attempts_log.length, 3);
      assert.equal(bundle.final_signature, 'claude|pm|stdout_attach_failed');
      // Most frequent signature sorted first.
      assert.equal(bundle.fingerprint_summary[0].signature, 'claude|pm|stdout_attach_failed');
      assert.equal(bundle.fingerprint_summary[0].count, 2);
      assert.equal(bundle.fingerprint_summary[1].signature, 'claude|pm|runtime_spawn_failed');
      assert.equal(bundle.fingerprint_summary[1].count, 1);
    });

    it('returns empty bundle when session has no ghost_retry', () => {
      const bundle = buildGhostRetryDiagnosticBundle({});
      assert.deepEqual(bundle.attempts_log, []);
      assert.deepEqual(bundle.fingerprint_summary, []);
      assert.equal(bundle.final_signature, null);
    });
  });

  // Slice 2d (Turn 201): per-attempt stderr excerpt + exit code surfacing.
  describe('extractLatestStderrDiagnostic', () => {
    it('returns nulls for empty or non-string input', () => {
      assert.deepEqual(
        extractLatestStderrDiagnostic(''),
        { stderr_excerpt: null, exit_code: null, exit_signal: null },
      );
      assert.deepEqual(
        extractLatestStderrDiagnostic(null),
        { stderr_excerpt: null, exit_code: null, exit_signal: null },
      );
    });

    it('extracts stderr_excerpt, exit_code, and exit_signal from a process_exit line', () => {
      const log = [
        '[adapter:diag] spawn_prepare {"pid":null,"command":"claude"}',
        '[adapter:diag] process_exit {"pid":1234,"exit_code":1,"signal":null,"stderr_excerpt":"Error: auth failed","stderr_bytes":18,"watchdog_fired":true}',
      ].join('\n');
      const d = extractLatestStderrDiagnostic(log);
      assert.equal(d.stderr_excerpt, 'Error: auth failed');
      assert.equal(d.exit_code, 1);
      assert.equal(d.exit_signal, null);
    });

    it('reads exit_signal when the process was killed', () => {
      const log = '[adapter:diag] process_exit {"pid":99,"exit_code":null,"signal":"SIGTERM","stderr_excerpt":"killed"}\n';
      const d = extractLatestStderrDiagnostic(log);
      assert.equal(d.exit_signal, 'SIGTERM');
      assert.equal(d.exit_code, null);
      assert.equal(d.stderr_excerpt, 'killed');
    });

    it('prefers the most recent diagnostic entry when multiple exist', () => {
      const log = [
        '[adapter:diag] process_exit {"exit_code":2,"stderr_excerpt":"first run"}',
        '[adapter:diag] process_exit {"exit_code":3,"stderr_excerpt":"latest run"}',
      ].join('\n');
      const d = extractLatestStderrDiagnostic(log);
      assert.equal(d.exit_code, 3);
      assert.equal(d.stderr_excerpt, 'latest run');
    });

    it('falls back to a spawn_error line when no process_exit with evidence exists', () => {
      const log = '[adapter:diag] spawn_error {"code":"ENOENT","errno":-2,"syscall":"spawn","message":"spawn claude ENOENT"}\n';
      const d = extractLatestStderrDiagnostic(log);
      // spawn_error has no stderr_excerpt/exit_code, but since the log contains
      // ONLY that entry we still return nulls — honest.
      assert.equal(d.stderr_excerpt, null);
      assert.equal(d.exit_code, null);
    });

    it('skips benign final process_exit line and returns a prior spawn_error evidence', () => {
      const log = [
        '[adapter:diag] spawn_error {"message":"spawn claude ENOENT","stderr_excerpt":"bash: claude: command not found","exit_code":127}',
        '[adapter:diag] process_exit {"pid":null}',
      ].join('\n');
      const d = extractLatestStderrDiagnostic(log);
      // The final process_exit has no useful field → we keep scanning back and
      // land on the spawn_error entry with real evidence.
      assert.equal(d.stderr_excerpt, 'bash: claude: command not found');
      assert.equal(d.exit_code, 127);
    });

    it('ignores malformed JSON lines without throwing', () => {
      const log = [
        '[adapter:diag] process_exit this is not json',
        '[adapter:diag] process_exit {"exit_code":9,"stderr_excerpt":"recovered"}',
      ].join('\n');
      const d = extractLatestStderrDiagnostic(log);
      assert.equal(d.exit_code, 9);
      assert.equal(d.stderr_excerpt, 'recovered');
    });
  });

  describe('applyGhostRetryAttempt with stderr/exit diagnostics', () => {
    it('records stderr_excerpt, exit_code, and exit_signal on the attempt entry', () => {
      const s = applyGhostRetryAttempt({}, {
        runId: 'run_x',
        oldTurnId: 't_old',
        newTurnId: 't_new',
        failureType: 'runtime_spawn_failed',
        maxRetries: 3,
        nowIso: 'now',
        runtimeId: 'claude',
        roleId: 'pm',
        runningMs: 30285,
        thresholdMs: 30000,
        stderrExcerpt: 'Error: Claude auth token invalid',
        exitCode: 1,
        exitSignal: null,
      });
      const e = s.ghost_retry.attempts_log[0];
      assert.equal(e.stderr_excerpt, 'Error: Claude auth token invalid');
      assert.equal(e.exit_code, 1);
      assert.equal(e.exit_signal, null);
    });

    it('normalizes missing / malformed diagnostics to null', () => {
      const s = applyGhostRetryAttempt({}, {
        runId: 'run_x',
        oldTurnId: 't_old',
        newTurnId: 't_new',
        failureType: 'stdout_attach_failed',
        maxRetries: 3,
        nowIso: 'now',
        runtimeId: 'codex',
        roleId: 'qa',
        stderrExcerpt: '',
        exitCode: 'not-a-number',
        exitSignal: '',
      });
      const e = s.ghost_retry.attempts_log[0];
      assert.equal(e.stderr_excerpt, null);
      assert.equal(e.exit_code, null);
      assert.equal(e.exit_signal, null);
    });

    it('preserves new diagnostic fields in the buildGhostRetryDiagnosticBundle output', () => {
      let s = applyGhostRetryAttempt({}, {
        runId: 'run_x', oldTurnId: 't1', newTurnId: 't2', failureType: 'runtime_spawn_failed',
        maxRetries: 3, nowIso: 'n1', runtimeId: 'claude', roleId: 'pm',
        stderrExcerpt: 'first stderr', exitCode: 1, exitSignal: null,
      });
      s = applyGhostRetryAttempt(s, {
        runId: 'run_x', oldTurnId: 't2', newTurnId: 't3', failureType: 'stdout_attach_failed',
        maxRetries: 3, nowIso: 'n2', runtimeId: 'claude', roleId: 'pm',
        stderrExcerpt: 'second stderr', exitCode: 2, exitSignal: 'SIGTERM',
      });
      const bundle = buildGhostRetryDiagnosticBundle(s);
      assert.equal(bundle.attempts_log.length, 2);
      assert.equal(bundle.attempts_log[0].stderr_excerpt, 'first stderr');
      assert.equal(bundle.attempts_log[0].exit_code, 1);
      assert.equal(bundle.attempts_log[1].stderr_excerpt, 'second stderr');
      assert.equal(bundle.attempts_log[1].exit_code, 2);
      assert.equal(bundle.attempts_log[1].exit_signal, 'SIGTERM');
    });
  });
});
