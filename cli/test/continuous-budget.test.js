import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

import {
  resolveContinuousOptions,
  readContinuousSession,
  executeContinuousRun,
  advanceContinuousRunOnce,
  writeContinuousSession,
} from '../src/lib/continuous-run.js';

import {
  validateSchedulesConfig,
} from '../src/lib/normalized-config.js';

function createTmpProject() {
  const dir = join(tmpdir(), `axc-cont-budget-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { name: 'budget-test', id: 'bt-001', default_branch: 'main' },
    roles: {
      dev: { title: 'Developer', mandate: 'Implement.', write_authority: 'authoritative', runtime: 'manual-dev' },
    },
    runtimes: { 'manual-dev': { type: 'manual' } },
    routing: { implementation: { entry_role: 'dev', allowed_next_roles: ['dev'], exit_gate: 'done' } },
    gates: { done: {} },
    rules: { challenge_required: false, max_turn_retries: 1 },
  }, null, 2));
  mkdirSync(join(dir, '.agentxchain', 'dispatch', 'turns'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify({
    schema_version: '1.0',
    run_id: null,
    project_id: 'bt-001',
    status: 'idle',
    phase: 'implementation',
    accepted_integration_ref: null,
    active_turns: {},
    turn_sequence: 0,
    last_completed_turn_id: null,
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
    phase_gate_status: {},
  }, null, 2));
  writeFileSync(join(dir, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(dir, '.agentxchain', 'decision-ledger.jsonl'), '');
  return dir;
}

function writeVision(dir, content) {
  const planDir = join(dir, '.planning');
  mkdirSync(planDir, { recursive: true });
  writeFileSync(join(planDir, 'VISION.md'), content, 'utf8');
}

function writeIntent(dir, { intentId, status, charter }) {
  const intentsDir = join(dir, '.agentxchain', 'intake', 'intents');
  mkdirSync(intentsDir, { recursive: true });
  const eventsDir = join(dir, '.agentxchain', 'intake', 'events');
  mkdirSync(eventsDir, { recursive: true });

  const eventId = `evt_${Date.now()}_${randomUUID().slice(0, 4)}`;
  const event = {
    schema_version: '1.0',
    event_id: eventId,
    source: 'test',
    signal: { description: charter },
    evidence: [],
    created_at: new Date().toISOString(),
  };
  writeFileSync(join(eventsDir, `${eventId}.json`), JSON.stringify(event, null, 2));

  const intent = {
    schema_version: '1.0',
    intent_id: intentId,
    event_id: eventId,
    status,
    priority: 'p2',
    template: 'generic',
    charter,
    acceptance_contract: [charter],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    history: [],
  };
  writeFileSync(join(intentsDir, `${intentId}.json`), JSON.stringify(intent, null, 2));
}

describe('Continuous Budget Enforcement', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTmpProject();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('resolveContinuousOptions — perSessionMaxUsd', () => {
    it('defaults to null when not configured', () => {
      const opts = resolveContinuousOptions({}, {});
      assert.equal(opts.perSessionMaxUsd, null);
    });

    it('CLI --session-budget overrides config', () => {
      const opts = resolveContinuousOptions(
        { sessionBudget: 50 },
        { run_loop: { continuous: { per_session_max_usd: 200 } } },
      );
      assert.equal(opts.perSessionMaxUsd, 50);
    });

    it('reads config per_session_max_usd when no CLI flag', () => {
      const opts = resolveContinuousOptions({}, {
        run_loop: { continuous: { per_session_max_usd: 150 } },
      });
      assert.equal(opts.perSessionMaxUsd, 150);
    });
  });

  describe('AT-CONT-BUDGET-001: session stops when cumulative spend exceeds budget', () => {
    it('stops after 3 runs when session budget is $10 and each run costs $4', async () => {
      writeVision(tmpDir, `## Protocol\n\n- governed run state machine\n- explicit role mandates\n- phase-aware dispatch\n- decision ledger persistence\n`);

      const context = { root: tmpDir, config: JSON.parse(readFileSync(join(tmpDir, 'agentxchain.json'), 'utf8')) };
      const contOpts = {
        ...resolveContinuousOptions({ continuous: true, maxRuns: 10, sessionBudget: 10 }, context.config),
        cooldownSeconds: 0,
      };

      let runCount = 0;
      const mockExecutor = async () => {
        runCount += 1;
        const statePath = join(tmpDir, '.agentxchain', 'state.json');
        const current = JSON.parse(readFileSync(statePath, 'utf8'));
        current.status = 'completed';
        current.completed_at = new Date().toISOString();
        current.last_completed_turn_id = null;
        current.active_turns = {};
        current.budget_status = {
          spent_usd: 4.0,
          remaining_usd: 46.0,
        };
        writeFileSync(statePath, JSON.stringify(current, null, 2));
        return {
          exitCode: 0,
          result: {
            stop_reason: 'completed',
            state: { run_id: current.run_id, status: 'completed', budget_status: { spent_usd: 4.0, remaining_usd: 46.0 } },
          },
        };
      };

      const logs = [];
      const { exitCode, session } = await executeContinuousRun(
        context, contOpts, mockExecutor, (msg) => logs.push(msg),
      );

      assert.equal(exitCode, 0);
      // Run 1: $4 → cumulative $4 (< $10, continue)
      // Run 2: $4 → cumulative $8 (< $10, continue)
      // Run 3: $4 → cumulative $12 (>= $10, next check stops)
      assert.equal(runCount, 3, 'should execute exactly 3 runs');
      assert.equal(session.runs_completed, 3);
      assert.equal(session.cumulative_spent_usd, 12);
      assert.equal(session.budget_exhausted, true);
      assert.equal(session.status, 'session_budget');

      // Session file should persist budget state
      const saved = readContinuousSession(tmpDir);
      assert.equal(saved.cumulative_spent_usd, 12);
      assert.equal(saved.budget_exhausted, true);
      assert.equal(saved.per_session_max_usd, 10);
      assert.equal(saved.status, 'session_budget');

      // Logs should mention budget exhaustion
      const budgetLog = logs.find(l => l.includes('Session budget exhausted'));
      assert.ok(budgetLog, 'should log budget exhaustion message');
      assert.ok(logs.some(l => l.includes('Session budget exhausted. Stopping.')),
        'should log terminal budget stop reason');
      assert.ok(!logs.some(l => l.includes('Max runs reached')),
        'budget exhaustion must not be misreported as max-runs completion');
    });
  });

  describe('AT-CONT-BUDGET-002: zero-cost runs complete normally under budget', () => {
    it('completes max_runs when local_cli incurs zero cost', async () => {
      writeVision(tmpDir, `## Build\n\n- feature one\n- feature two\n- feature three\n`);

      const context = { root: tmpDir, config: JSON.parse(readFileSync(join(tmpDir, 'agentxchain.json'), 'utf8')) };
      const contOpts = {
        ...resolveContinuousOptions({ continuous: true, maxRuns: 2, sessionBudget: 100 }, context.config),
        cooldownSeconds: 0,
      };

      let runCount = 0;
      const mockExecutor = async () => {
        runCount += 1;
        const statePath = join(tmpDir, '.agentxchain', 'state.json');
        const current = JSON.parse(readFileSync(statePath, 'utf8'));
        current.status = 'completed';
        current.completed_at = new Date().toISOString();
        current.last_completed_turn_id = null;
        current.active_turns = {};
        writeFileSync(statePath, JSON.stringify(current, null, 2));
        return {
          exitCode: 0,
          result: {
            stop_reason: 'completed',
            state: { run_id: current.run_id, status: 'completed' },
            // No budget_status — local_cli zero-cost
          },
        };
      };

      const { exitCode, session } = await executeContinuousRun(
        context, contOpts, mockExecutor, () => {},
      );

      assert.equal(exitCode, 0);
      assert.equal(runCount, 2);
      assert.equal(session.runs_completed, 2);
      assert.equal(session.cumulative_spent_usd, 0);
      assert.equal(session.budget_exhausted, false);
      assert.equal(session.status, 'completed');
    });
  });

  describe('AT-CONT-BUDGET-003: schedule continuous config validation', () => {
    it('accepts valid per_session_max_usd', () => {
      const result = validateSchedulesConfig({
        factory: {
          every_minutes: 30,
          continuous: {
            enabled: true,
            vision_path: '.planning/VISION.md',
            per_session_max_usd: 500,
          },
        },
      });
      assert.ok(result.ok, `expected ok, got errors: ${result.errors.join(', ')}`);
    });

    it('rejects negative per_session_max_usd', () => {
      const result = validateSchedulesConfig({
        factory: {
          every_minutes: 30,
          continuous: {
            enabled: true,
            vision_path: '.planning/VISION.md',
            per_session_max_usd: -1,
          },
        },
      });
      assert.ok(!result.ok);
      assert.ok(result.errors.some(e => e.includes('per_session_max_usd') && e.includes('greater than 0')));
    });

    it('rejects non-numeric per_session_max_usd', () => {
      const result = validateSchedulesConfig({
        factory: {
          every_minutes: 30,
          continuous: {
            enabled: true,
            vision_path: '.planning/VISION.md',
            per_session_max_usd: 'fifty',
          },
        },
      });
      assert.ok(!result.ok);
      assert.ok(result.errors.some(e => e.includes('per_session_max_usd') && e.includes('finite number')));
    });

    it('accepts null per_session_max_usd (no budget cap)', () => {
      const result = validateSchedulesConfig({
        factory: {
          every_minutes: 30,
          continuous: {
            enabled: true,
            vision_path: '.planning/VISION.md',
            per_session_max_usd: null,
          },
        },
      });
      assert.ok(result.ok, `expected ok, got errors: ${result.errors.join(', ')}`);
    });
  });

  describe('AT-CONT-BUDGET-004: advanceContinuousRunOnce budget pre-check', () => {
    it('returns session_budget_exhausted without starting a run', async () => {
      writeVision(tmpDir, `## Goal\n\n- build something\n`);
      writeIntent(tmpDir, { intentId: 'intent_budget', status: 'planned', charter: 'build something' });

      const context = { root: tmpDir, config: JSON.parse(readFileSync(join(tmpDir, 'agentxchain.json'), 'utf8')) };
      const contOpts = { visionPath: '.planning/VISION.md', maxRuns: 10, maxIdleCycles: 3, triageApproval: 'auto', perSessionMaxUsd: 50 };

      const session = {
        session_id: 'cont-budget-test',
        started_at: new Date().toISOString(),
        vision_path: '.planning/VISION.md',
        runs_completed: 5,
        max_runs: 10,
        idle_cycles: 0,
        max_idle_cycles: 3,
        current_run_id: null,
        current_vision_objective: null,
        status: 'running',
        per_session_max_usd: 50,
        cumulative_spent_usd: 55, // Already over budget
        budget_exhausted: false,
      };

      const mockExecutor = async () => {
        assert.fail('Should not execute a run when budget is exhausted');
      };

      const logs = [];
      const step = await advanceContinuousRunOnce(context, session, contOpts, mockExecutor, (msg) => logs.push(msg));

      assert.equal(step.ok, true);
      assert.equal(step.status, 'session_budget');
      assert.equal(step.action, 'session_budget_exhausted');
      assert.equal(step.stop_reason, 'session_budget');
      assert.equal(session.budget_exhausted, true);
      assert.equal(session.status, 'session_budget');

      // Session should be persisted
      const saved = readContinuousSession(tmpDir);
      assert.equal(saved.budget_exhausted, true);
      assert.equal(saved.status, 'session_budget');
    });
  });
});
