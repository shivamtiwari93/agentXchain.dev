import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  evaluateTimeouts,
  validateTimeoutsConfig,
  buildTimeoutBlockedReason,
} from '../src/lib/timeout-evaluator.js';

describe('timeout-evaluator', () => {
  describe('evaluateTimeouts', () => {
    const baseConfig = {
      timeouts: {
        per_turn_minutes: 30,
        per_phase_minutes: 120,
        per_run_minutes: 480,
        action: 'escalate',
      },
      routing: {
        planning: { entry_role: 'pm' },
        implementation: { entry_role: 'dev' },
      },
    };

    const baseState = {
      phase: 'planning',
      created_at: '2026-04-10T00:00:00.000Z',
      phase_entered_at: '2026-04-10T01:00:00.000Z',
    };

    it('AT-TIMEOUT-001: turn timeout fires when started_at + limit < now', () => {
      const result = evaluateTimeouts({
        config: baseConfig,
        state: baseState,
        turn: { started_at: '2026-04-10T01:00:00.000Z' },
        now: '2026-04-10T02:00:00.000Z', // 60 min elapsed, limit 30
      });
      assert.equal(result.exceeded.length, 1);
      const t = result.exceeded.find((r) => r.scope === 'turn');
      assert.ok(t);
      assert.equal(t.limit_minutes, 30);
      assert.equal(t.action, 'escalate');
      assert.ok(t.exceeded_by_minutes >= 29);
    });

    it('AT-TIMEOUT-002: phase timeout fires when phase_entered_at + limit < now', () => {
      const result = evaluateTimeouts({
        config: baseConfig,
        state: baseState,
        now: '2026-04-10T04:00:00.000Z', // 3 hours in phase, limit 2 hours
      });
      const t = result.exceeded.find((r) => r.scope === 'phase');
      assert.ok(t);
      assert.equal(t.limit_minutes, 120);
      assert.equal(t.phase, 'planning');
      assert.equal(t.action, 'escalate');
    });

    it('AT-TIMEOUT-003: run timeout fires when created_at + limit < now', () => {
      const result = evaluateTimeouts({
        config: baseConfig,
        state: baseState,
        now: '2026-04-10T09:00:00.000Z', // 9 hours, limit 8 hours
      });
      const t = result.exceeded.find((r) => r.scope === 'run');
      assert.ok(t);
      assert.equal(t.limit_minutes, 480);
      assert.equal(t.action, 'escalate');
    });

    it('AT-TIMEOUT-004: action warn logs warning but does not escalate', () => {
      const config = {
        timeouts: { per_turn_minutes: 10, action: 'warn' },
        routing: {},
      };
      const result = evaluateTimeouts({
        config,
        state: baseState,
        turn: { started_at: '2026-04-10T01:00:00.000Z' },
        now: '2026-04-10T01:20:00.000Z', // 20 min, limit 10
      });
      assert.equal(result.exceeded.length, 0);
      assert.equal(result.warnings.length, 1);
      assert.equal(result.warnings[0].scope, 'turn');
      assert.equal(result.warnings[0].action, 'warn');
    });

    it('AT-TIMEOUT-006: per-phase routing override takes precedence', () => {
      const config = {
        timeouts: { per_phase_minutes: 120, action: 'escalate' },
        routing: {
          planning: { entry_role: 'pm', timeout_minutes: 30 },
          implementation: { entry_role: 'dev' },
        },
      };
      const result = evaluateTimeouts({
        config,
        state: { ...baseState, phase: 'planning' },
        now: '2026-04-10T01:45:00.000Z', // 45 min in phase
      });
      const t = result.exceeded.find((r) => r.scope === 'phase');
      assert.ok(t, 'phase timeout should fire at 45 min when override is 30');
      assert.equal(t.limit_minutes, 30);
    });

    it('AT-TIMEOUT-005: skip_phase action fires for phase scope', () => {
      const config = {
        timeouts: { per_phase_minutes: 60 },
        routing: {
          planning: { entry_role: 'pm', timeout_action: 'skip_phase' },
        },
      };
      const result = evaluateTimeouts({
        config,
        state: { ...baseState, phase: 'planning' },
        now: '2026-04-10T02:30:00.000Z', // 90 min in phase, limit 60
      });
      const t = result.exceeded.find((r) => r.scope === 'phase');
      assert.ok(t);
      assert.equal(t.action, 'skip_phase');
    });

    it('no timeouts when all within limits', () => {
      const result = evaluateTimeouts({
        config: baseConfig,
        state: baseState,
        turn: { started_at: '2026-04-10T01:00:00.000Z' },
        now: '2026-04-10T01:10:00.000Z', // 10 min, all limits much higher
      });
      assert.equal(result.exceeded.length, 0);
      assert.equal(result.warnings.length, 0);
    });

    it('no timeouts when config has no timeouts section', () => {
      const result = evaluateTimeouts({
        config: { routing: {} },
        state: baseState,
      });
      assert.equal(result.exceeded.length, 0);
      assert.equal(result.warnings.length, 0);
    });

    it('falls back to created_at when phase_entered_at is missing', () => {
      const config = {
        timeouts: { per_phase_minutes: 60 },
        routing: {},
      };
      const state = {
        phase: 'planning',
        created_at: '2026-04-10T00:00:00.000Z',
        // no phase_entered_at
      };
      const result = evaluateTimeouts({
        config,
        state,
        now: '2026-04-10T02:00:00.000Z', // 2 hours from created_at
      });
      assert.equal(result.exceeded.length, 1);
      assert.equal(result.exceeded[0].scope, 'phase');
    });

    it('skip_phase is downgraded to escalate for non-phase scopes', () => {
      // Even if someone sets action: 'skip_phase' globally (which validation catches),
      // the evaluator should still handle it defensively
      const config = {
        timeouts: { per_turn_minutes: 5, action: 'skip_phase' },
        routing: {},
      };
      const result = evaluateTimeouts({
        config,
        state: baseState,
        turn: { started_at: '2026-04-10T01:00:00.000Z' },
        now: '2026-04-10T01:10:00.000Z',
      });
      assert.equal(result.exceeded.length, 1);
      assert.equal(result.exceeded[0].action, 'escalate', 'skip_phase must be downgraded to escalate for turn scope');
    });

    it('prefers active turn timestamps over staged-result fallbacks', () => {
      const result = evaluateTimeouts({
        config: { timeouts: { per_turn_minutes: 5 }, routing: {} },
        state: baseState,
        turn: { started_at: '2026-04-10T01:00:00.000Z' },
        turnResult: { dispatched_at: '2026-04-10T01:09:00.000Z' },
        now: '2026-04-10T01:10:00.000Z',
      });
      assert.equal(result.exceeded.length, 1);
      assert.equal(result.exceeded[0].scope, 'turn');
      assert.equal(result.exceeded[0].elapsed_minutes, 10);
    });
  });

  describe('validateTimeoutsConfig', () => {
    it('accepts valid timeouts config', () => {
      const result = validateTimeoutsConfig({
        per_turn_minutes: 30,
        per_phase_minutes: 120,
        per_run_minutes: 480,
        action: 'escalate',
      }, {});
      assert.ok(result.ok);
      assert.equal(result.errors.length, 0);
    });

    it('accepts null/undefined (no timeouts)', () => {
      assert.ok(validateTimeoutsConfig(null).ok);
      assert.ok(validateTimeoutsConfig(undefined).ok);
    });

    it('AT-TIMEOUT-011: rejects skip_phase as global action', () => {
      const result = validateTimeoutsConfig({ action: 'skip_phase' }, {});
      assert.ok(!result.ok);
      assert.ok(result.errors.some((e) => e.includes('skip_phase')));
    });

    it('rejects per_turn_minutes < 1', () => {
      const result = validateTimeoutsConfig({ per_turn_minutes: 0 }, {});
      assert.ok(!result.ok);
      assert.ok(result.errors.some((e) => e.includes('per_turn_minutes')));
    });

    it('rejects per_phase_minutes < 1', () => {
      const result = validateTimeoutsConfig({ per_phase_minutes: -5 }, {});
      assert.ok(!result.ok);
    });

    it('rejects per_run_minutes < 1', () => {
      const result = validateTimeoutsConfig({ per_run_minutes: 0.5 }, {});
      assert.ok(!result.ok);
    });

    it('rejects invalid action', () => {
      const result = validateTimeoutsConfig({ action: 'abort' }, {});
      assert.ok(!result.ok);
      assert.ok(result.errors.some((e) => e.includes('action')));
    });

    it('validates per-phase routing overrides', () => {
      const result = validateTimeoutsConfig({}, {
        planning: { entry_role: 'pm', timeout_minutes: -1 },
      });
      assert.ok(!result.ok);
      assert.ok(result.errors.some((e) => e.includes('timeout_minutes')));
    });

    it('validates per-phase routing action overrides', () => {
      const result = validateTimeoutsConfig({}, {
        planning: { entry_role: 'pm', timeout_action: 'invalid' },
      });
      assert.ok(!result.ok);
      assert.ok(result.errors.some((e) => e.includes('timeout_action')));
    });

    it('rejects non-object timeouts', () => {
      const result = validateTimeoutsConfig('30', {});
      assert.ok(!result.ok);
      assert.ok(result.errors.some((e) => e.includes('must be an object')));
    });
  });

  describe('buildTimeoutBlockedReason', () => {
    it('AT-TIMEOUT-012: builds structured recovery descriptor for turn timeout', () => {
      const reason = buildTimeoutBlockedReason({
        scope: 'turn',
        limit_minutes: 30,
        elapsed_minutes: 45,
        exceeded_by_minutes: 15,
        action: 'escalate',
      });
      assert.equal(reason.category, 'timeout');
      assert.equal(reason.recovery.typed_reason, 'timeout');
      assert.equal(reason.recovery.owner, 'operator');
      assert.equal(reason.recovery.recovery_action, 'agentxchain resume');
      assert.ok(reason.recovery.detail.includes('Turn timeout'));
      assert.ok(reason.recovery.detail.includes('30m'));
    });

    it('builds structured recovery descriptor for phase timeout', () => {
      const reason = buildTimeoutBlockedReason({
        scope: 'phase',
        phase: 'implementation',
        limit_minutes: 120,
        elapsed_minutes: 150,
        exceeded_by_minutes: 30,
        action: 'escalate',
      });
      assert.ok(reason.recovery.detail.includes('Phase timeout'));
      assert.ok(reason.recovery.detail.includes('implementation'));
    });

    it('builds structured recovery descriptor for run timeout', () => {
      const reason = buildTimeoutBlockedReason({
        scope: 'run',
        limit_minutes: 480,
        elapsed_minutes: 500,
        exceeded_by_minutes: 20,
        action: 'escalate',
      });
      assert.ok(reason.recovery.detail.includes('Run timeout'));
    });

    it('preserves turn_retained when the caller reports active turns', () => {
      const reason = buildTimeoutBlockedReason({
        scope: 'run',
        limit_minutes: 480,
        elapsed_minutes: 500,
        exceeded_by_minutes: 20,
        action: 'escalate',
      }, { turnRetained: true });
      assert.equal(reason.recovery.turn_retained, true);
    });
  });
});
