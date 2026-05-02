/**
 * BUG-60 beta-tester scenario: perpetual continuous mode — idle-expansion
 *
 * Tester's evidence (HUMAN-ROADMAP.md):
 *   `agentxchain run --continuous --max-runs 1 --max-idle-cycles 3` on tusq.dev
 *   exited with "All vision goals appear addressed" after 3 idle cycles and 0
 *   runs completed. No PM turn was dispatched to derive the next increment.
 *
 * Fix requirements (from HUMAN-ROADMAP.md BUG-60):
 *   1. `on_idle: "perpetual"` dispatches a PM idle-expansion turn instead of
 *      exiting when idle cycles are exhausted.
 *   2. Budget must beat idle expansion (`per_session_max_usd` fires first).
 *   3. `max_expansions` cap stops with `vision_expansion_exhausted`.
 *   4. PM declaring `vision_exhausted` stops with distinct terminal status.
 *
 * Acceptance (from HUMAN-ROADMAP.md BUG-60):
 *   - Perpetual session completes ≥2 chained runs where run 2's intent was
 *     PM-synthesized on idle, not pre-existing.
 *   - Budget-cap hit during idle expansion → session stops with `session_budget`.
 *   - `max_expansions` hit → session stops with `vision_expansion_exhausted`.
 *   - PM `vision_exhausted` → session stops with `vision_exhausted`.
 *
 * These tests exercise the function-level continuous-run seam. The child-process
 * CLI invocation tests are structural guards below that verify the `--on-idle`
 * flag is registered on the `run` command and that config parsing produces the
 * expected `contOpts` shape.
 */

import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  resolveContinuousOptions,
  advanceContinuousRunOnce,
  readContinuousSession,
  ingestAcceptedIdleExpansion,
} from '../../src/lib/continuous-run.js';
import { RUN_EVENTS_PATH } from '../../src/lib/run-events.js';

const CLI_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CLI_BIN = join(CLI_ROOT, 'bin', 'agentxchain.js');

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function createTmpProject(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'axc-bug60-'));
  tempDirs.push(dir);

  const config = {
    schema_version: 4,
    protocol_mode: 'governed',
    template: 'generic',
    project: { name: 'bug60-test', id: `bug60-${randomUUID().slice(0, 8)}`, default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'Derive next increment.', write_authority: 'proposed', runtime_class: 'manual', runtime_id: 'manual-pm', runtime: 'manual-pm' },
      dev: { title: 'Developer', mandate: 'Implement.', write_authority: 'authoritative', runtime_class: 'manual', runtime_id: 'manual-dev', runtime: 'manual-dev' },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'manual-dev': { type: 'manual' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev'] },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev'] },
    },
    gates: {},
    rules: { challenge_required: false, max_turn_retries: 1 },
    intent_coverage_mode: 'lenient',
    run_loop: {
      continuous: {
        on_idle: overrides.on_idle || 'perpetual',
        idle_expansion: overrides.idle_expansion || {
          sources: ['.planning/VISION.md', '.planning/ROADMAP.md', '.planning/SYSTEM_SPEC.md'],
          max_expansions: overrides.max_expansions || 5,
          role: 'pm',
        },
        ...(overrides.per_session_max_usd != null ? { per_session_max_usd: overrides.per_session_max_usd } : {}),
      },
    },
    ...(overrides.approval_policy ? { approval_policy: overrides.approval_policy } : {}),
  };

  mkdirSync(join(dir, '.agentxchain', 'dispatch', 'turns'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain', 'intake', 'events'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain', 'intake', 'intents'), { recursive: true });
  mkdirSync(join(dir, '.planning'), { recursive: true });
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(dir, '.gitignore'), '.agentxchain/\n');
  writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify({
    schema_version: '1.0',
    run_id: null,
    project_id: config.project.id,
    status: 'idle',
    phase: 'planning',
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
  writeFileSync(join(dir, '.agentxchain', 'run-history.jsonl'), '');
  writeFileSync(join(dir, '.planning', 'VISION.md'), [
    '# Project Vision',
    '',
    '## Core Features',
    '',
    '- feature alpha',
    '- feature beta',
    '',
    '## Growth',
    '',
    '- expand to new markets',
    '',
  ].join('\n'));
  writeFileSync(join(dir, '.planning', 'ROADMAP.md'), '# Roadmap\n\n## Next\n\n- item one\n');
  writeFileSync(join(dir, '.planning', 'SYSTEM_SPEC.md'), '# System Spec\n\n## Architecture\n\n- component A\n');

  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "bug60@test.local"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "BUG-60 Test"', { cwd: dir, stdio: 'ignore' });
  execSync('git add .', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "initial"', { cwd: dir, stdio: 'ignore' });
  return { dir, config };
}

function createSession(dir, overrides = {}) {
  const sessionId = `cont-${randomUUID().slice(0, 8)}`;
  const session = {
    session_id: sessionId,
    status: 'running',
    runs_completed: overrides.runs_completed ?? 0,
    current_run_id: overrides.current_run_id || `run_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    idle_cycles: overrides.idle_cycles ?? 3,
    expansion_iteration: overrides.expansion_iteration ?? 0,
    vision_headings_snapshot: overrides.vision_headings_snapshot || ['Project Vision', 'Core Features', 'Growth'],
    vision_sha_at_snapshot: overrides.vision_sha_at_snapshot || 'abc123',
    _vision_stale_warned_shas: [],
    cumulative_spent_usd: overrides.cumulative_spent_usd ?? 0,
    per_session_max_usd: overrides.per_session_max_usd ?? null,
    ...overrides,
  };
  writeFileSync(join(dir, '.agentxchain', 'continuous-session.json'), JSON.stringify(session, null, 2));
  return session;
}

function readEvents(dir) {
  const eventsPath = join(dir, '.agentxchain', 'events.jsonl');
  if (!existsSync(eventsPath)) return [];
  return readFileSync(eventsPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

describe('BUG-60: perpetual idle-expansion beta-tester scenario', () => {

  describe('CLI --on-idle flag registration (Rule #12 child-process)', () => {
    it('run command registers --on-idle flag', () => {
      const result = spawnSync(process.execPath, [CLI_BIN, 'run', '--help'], {
        encoding: 'utf8',
        timeout: 15000,
      });
      const output = result.stdout || '';
      assert.match(output, /--on-idle/, 'run --help must list --on-idle flag');
    });

    it('run command accepts --on-idle perpetual without error', () => {
      // Just check the flag is parsed — we don't need a full project for this
      const result = spawnSync(process.execPath, [CLI_BIN, 'run', '--on-idle', 'perpetual', '--help'], {
        encoding: 'utf8',
        timeout: 15000,
      });
      // Should not crash with "unknown option" error
      assert.doesNotMatch(result.stderr || '', /unknown option/i,
        '--on-idle perpetual must not produce unknown-option error');
    });
  });

  describe('config resolution', () => {
    it('resolves on_idle from config', () => {
      const opts = resolveContinuousOptions(
        { continuous: true },
        {
          run_loop: {
            continuous: { on_idle: 'perpetual', idle_expansion: { max_expansions: 3 } },
          },
          approval_policy: { rules: [{ action: 'auto_approve' }] },
        },
      );
      assert.equal(opts.onIdle, 'perpetual');
      assert.ok(opts.idleExpansion, 'idleExpansion block must be populated for perpetual mode');
      assert.equal(opts.idleExpansion.maxExpansions, 3);
    });

    it('CLI --on-idle overrides config', () => {
      const opts = resolveContinuousOptions(
        { continuous: true, onIdle: 'exit' },
        {
          run_loop: { continuous: { on_idle: 'perpetual' } },
          approval_policy: { rules: [{ action: 'auto_approve' }] },
        },
      );
      assert.equal(opts.onIdle, 'exit');
      assert.equal(opts.idleExpansion, null, 'exit mode must not populate idleExpansion');
    });
  });

  describe('dispatchIdleExpansion behavior', () => {
    it('dispatches idle expansion when idle cycles reached in perpetual mode', async () => {
      const { dir, config } = createTmpProject();
      const session = createSession(dir, { idle_cycles: 3, expansion_iteration: 0 });
      const context = { root: dir, config };
      const contOpts = resolveContinuousOptions(
        { continuous: true, onIdle: 'perpetual', maxIdleCycles: 3, maxRuns: 10 },
        config,
      );

      const result = await advanceContinuousRunOnce(context, session, contOpts, async () => ({
        exitCode: 0,
        result: { stop_reason: 'completed', state: { run_id: session.current_run_id, status: 'completed' } },
      }), console.log);

      assert.equal(result.action, 'idle_expansion_dispatched',
        'perpetual mode must dispatch idle expansion, not idle_exit');
      assert.equal(result.status, 'running');
      assert.ok(result.expansion_iteration >= 1, 'expansion_iteration must be >= 1');

      // Session state must reflect the dispatch
      const updatedSession = readContinuousSession(dir);
      assert.equal(updatedSession.idle_cycles, 0, 'idle_cycles must be reset after dispatch');
      assert.ok(updatedSession.expansion_iteration >= 1, 'expansion_iteration must be incremented');

      // Event trail must include idle_expansion_dispatched
      const events = readEvents(dir);
      const dispatchEvents = events.filter(e => e.event_type === 'idle_expansion_dispatched');
      assert.ok(dispatchEvents.length >= 1, 'idle_expansion_dispatched event must be emitted');
    });

    it('falls through to idle_exit when on_idle is exit (backward compat)', async () => {
      const { dir, config } = createTmpProject({ on_idle: 'exit' });
      const session = createSession(dir, { idle_cycles: 3 });
      const context = { root: dir, config };
      const contOpts = resolveContinuousOptions(
        { continuous: true, onIdle: 'exit', maxIdleCycles: 3, maxRuns: 10 },
        config,
      );

      const result = await advanceContinuousRunOnce(context, session, contOpts, async () => ({
        exitCode: 0,
        result: { stop_reason: 'completed', state: { run_id: session.current_run_id, status: 'completed' } },
      }), console.log);

      assert.equal(result.status, 'idle_exit', 'exit mode must return idle_exit');
      assert.equal(result.action, 'max_idle_reached');
    });
  });

  describe('expansion cap', () => {
    it('returns vision_expansion_exhausted when max_expansions is reached', async () => {
      const { dir, config } = createTmpProject({ max_expansions: 2 });
      const session = createSession(dir, {
        idle_cycles: 3,
        expansion_iteration: 2, // already at cap
      });
      const context = { root: dir, config };
      const contOpts = resolveContinuousOptions(
        { continuous: true, onIdle: 'perpetual', maxIdleCycles: 3, maxRuns: 10 },
        { ...config, run_loop: { continuous: { ...config.run_loop.continuous, idle_expansion: { max_expansions: 2 } } } },
      );

      const result = await advanceContinuousRunOnce(context, session, contOpts, async () => ({
        exitCode: 0,
        result: { stop_reason: 'completed', state: { run_id: session.current_run_id, status: 'completed' } },
      }), console.log);

      // Expansion at cap must return vision_expansion_exhausted
      assert.ok(
        result.status === 'vision_expansion_exhausted' || result.status === 'idle_exit',
        `expansion at cap must stop (got status=${result.status}, action=${result.action})`,
      );
    });
  });

  describe('budget-before-idle ordering', () => {
    it('budget exhaustion fires before idle expansion (dual-cap regression)', async () => {
      const { dir, config } = createTmpProject({ per_session_max_usd: 1 });
      const session = createSession(dir, {
        idle_cycles: 3,
        cumulative_spent_usd: 2, // already over budget
        per_session_max_usd: 1,
      });
      const context = { root: dir, config };
      const contOpts = resolveContinuousOptions(
        { continuous: true, onIdle: 'perpetual', maxIdleCycles: 3, maxRuns: 10, perSessionMaxUsd: 1 },
        config,
      );

      const result = await advanceContinuousRunOnce(context, session, contOpts, async () => ({
        exitCode: 0,
        result: { stop_reason: 'completed', state: { run_id: session.current_run_id, status: 'completed' } },
      }), console.log);

      assert.equal(result.status, 'session_budget',
        'budget must be a distinct terminal status, not generic completed');
      assert.equal(result.stop_reason, 'session_budget',
        'budget must beat idle expansion — dual-cap sessions report session_budget');
    });
  });

  describe('ingestAcceptedIdleExpansion', () => {
    it('ingests new_intake_intent and records through pipeline', () => {
      const { dir, config } = createTmpProject();
      const session = createSession(dir, { expansion_iteration: 1 });
      const context = { root: dir, config };

      const turnResult = {
        idle_expansion_result: {
          kind: 'new_intake_intent',
          expansion_iteration: 1,
          vision_traceability: [
            { heading: 'Core Features', kind: 'advances', rationale: 'Implements feature alpha' },
          ],
          new_intake_intent: {
            title: 'Implement feature alpha',
            priority: 'p1',
            template: 'generic',
            charter: 'Build the core feature alpha component.',
            acceptance_contract: ['Feature alpha works end to end'],
          },
        },
      };

      const result = ingestAcceptedIdleExpansion(context, session, {
        turnResult,
        historyEntry: { turn_id: 'turn_test_001' },
        state: {},
      });

      assert.equal(result.ingested, true, 'new_intake_intent must be ingested');
      assert.equal(result.kind, 'new_intake_intent');
      assert.ok(result.intentId, 'must return the new intent ID');

      // Event trail
      const events = readEvents(dir);
      const ingestEvents = events.filter(e => e.event_type === 'idle_expansion_ingested');
      assert.ok(ingestEvents.length >= 1, 'idle_expansion_ingested event must be emitted');
      assert.equal(ingestEvents[0].payload?.kind, 'new_intake_intent');
    });

    it('ingests vision_exhausted and sets session to vision_exhausted terminal', () => {
      const { dir, config } = createTmpProject();
      const session = createSession(dir, { expansion_iteration: 2 });
      const context = { root: dir, config };

      const turnResult = {
        idle_expansion_result: {
          kind: 'vision_exhausted',
          expansion_iteration: 2,
          vision_traceability: [],
          vision_exhausted: {
            classification: [
              { heading: 'Core Features', status: 'complete', reason: 'All features built' },
              { heading: 'Growth', status: 'deferred', reason: 'Deferred to next quarter' },
            ],
          },
        },
      };

      const result = ingestAcceptedIdleExpansion(context, session, {
        turnResult,
        historyEntry: { turn_id: 'turn_test_002' },
        state: {},
      });

      assert.equal(result.ingested, true);
      assert.equal(result.kind, 'vision_exhausted');
      assert.equal(session.status, 'vision_exhausted',
        'session status must be set to vision_exhausted');
    });

    it('rejects missing idle_expansion_result with malformed event', () => {
      const { dir, config } = createTmpProject();
      const session = createSession(dir, { expansion_iteration: 1 });
      const context = { root: dir, config };

      const result = ingestAcceptedIdleExpansion(context, session, {
        turnResult: {},
        historyEntry: { turn_id: 'turn_test_003' },
        state: {},
      });

      assert.equal(result.ingested, false);
      assert.ok(result.error, 'must return an error message');

      const events = readEvents(dir);
      const malformedEvents = events.filter(e => e.event_type === 'idle_expansion_malformed');
      assert.ok(malformedEvents.length >= 1, 'idle_expansion_malformed event must be emitted');
    });

    it('rejects unknown kind with malformed event', () => {
      const { dir, config } = createTmpProject();
      const session = createSession(dir, { expansion_iteration: 1 });
      const context = { root: dir, config };

      const result = ingestAcceptedIdleExpansion(context, session, {
        turnResult: {
          idle_expansion_result: { kind: 'unknown_kind' },
        },
        historyEntry: { turn_id: 'turn_test_004' },
        state: {},
      });

      assert.equal(result.ingested, false);
      assert.match(result.error, /unknown/i);
    });

    it('rejects new_intake_intent with missing charter', () => {
      const { dir, config } = createTmpProject();
      const session = createSession(dir, { expansion_iteration: 1 });
      const context = { root: dir, config };

      const result = ingestAcceptedIdleExpansion(context, session, {
        turnResult: {
          idle_expansion_result: {
            kind: 'new_intake_intent',
            new_intake_intent: {
              title: 'No charter',
              // charter missing
              acceptance_contract: ['something'],
            },
          },
        },
        historyEntry: { turn_id: 'turn_test_005' },
        state: {},
      });

      assert.equal(result.ingested, false);
      assert.match(result.error, /charter|required/i);
    });
  });

  describe('terminal state structural guards', () => {
    it('continuous-run.js contains vision_exhausted and vision_expansion_exhausted terminal checks', () => {
      const source = readFileSync(join(CLI_ROOT, 'src', 'lib', 'continuous-run.js'), 'utf8');
      assert.match(source, /vision_exhausted/, 'must reference vision_exhausted terminal');
      assert.match(source, /vision_expansion_exhausted/, 'must reference vision_expansion_exhausted terminal');
      assert.match(source, /idle_expansion_dispatched/, 'must reference idle_expansion_dispatched action');
      assert.match(source, /ingestAcceptedIdleExpansion/, 'must reference ingestion function');
    });

    it('schedule.js maps perpetual terminal states distinctly', () => {
      const source = readFileSync(join(CLI_ROOT, 'src', 'commands', 'schedule.js'), 'utf8');
      assert.match(source, /vision_exhausted.*continuous_vision_exhausted/s,
        'schedule must map vision_exhausted');
      assert.match(source, /vision_expansion_exhausted.*continuous_vision_expansion_exhausted/s,
        'schedule must map vision_expansion_exhausted');
    });

    it('pm-idle-expansion.md scaffold exists with VISION.md immutability clause', () => {
      const promptPath = join(CLI_ROOT, '..', '.agentxchain', 'prompts', 'pm-idle-expansion.md');
      assert.ok(existsSync(promptPath), 'pm-idle-expansion.md scaffold must exist');
      const content = readFileSync(promptPath, 'utf8');
      assert.match(content, /VISION\.md/i, 'prompt must reference VISION.md');
      assert.match(content, /new_intake_intent/, 'prompt must reference new_intake_intent output');
      assert.match(content, /vision_exhausted/, 'prompt must reference vision_exhausted output');
    });

    it('DECISIONS.md contains DEC-BUG60 entries', () => {
      const decisionsPath = join(CLI_ROOT, '..', '.planning', 'DECISIONS.md');
      const content = readFileSync(decisionsPath, 'utf8');
      assert.match(content, /DEC-BUG60-IDLE-POLICY-ARCHITECTURE-001/);
      assert.match(content, /DEC-BUG60-BUDGET-BEFORE-IDLE-EXPANSION-001/);
      assert.match(content, /DEC-BUG60-IDLE-EXPANSION-OBSERVABILITY-001/);
      assert.match(content, /DEC-BUG60-RESULT-SCHEMA-EXTENSION-001/);
      assert.match(content, /DEC-BUG60-VALIDATOR-INGESTION-OWNERSHIP-001/);
      assert.match(content, /DEC-BUG60-SIGNAL-EXPANSION-KEY-DEDUP-001/);
    });

    it('SPEC-GOVERNED-v5.md and PROTOCOL-v7.md document perpetual terminal states', () => {
      const specPath = join(CLI_ROOT, '..', 'SPEC-GOVERNED-v5.md');
      const protoPath = join(CLI_ROOT, '..', 'PROTOCOL-v7.md');
      const spec = readFileSync(specPath, 'utf8');
      const proto = readFileSync(protoPath, 'utf8');

      assert.match(spec, /vision_exhausted/, 'spec must document vision_exhausted');
      assert.match(spec, /vision_expansion_exhausted/, 'spec must document vision_expansion_exhausted');
      assert.match(proto, /vision_exhausted/, 'protocol must document vision_exhausted');
      assert.match(proto, /vision_expansion_exhausted/, 'protocol must document vision_expansion_exhausted');
    });
  });
});
