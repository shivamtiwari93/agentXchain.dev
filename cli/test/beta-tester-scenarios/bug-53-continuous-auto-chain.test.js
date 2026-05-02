/**
 * BUG-53 beta-tester scenario: continuous sessions must auto-chain to the
 * next vision-derived objective after a run completes cleanly.
 *
 * Tester's evidence (HUMAN-ROADMAP.md report #18):
 *   session `cont-5d436a8f` ended up paused after `run_78133e963b912f46`
 *   completed cleanly (all 4 gates passed, final checkpoint
 *   `32a38b0a3bbd5e1e6ce82d7271ee45e4b6e5a44b`). No new vision_scan run was
 *   created, no next objective was derived.
 *
 * Fix requirements (from HUMAN-ROADMAP.md):
 *   1. After `session.runs_completed += 1`, the continuous loop must:
 *      - Check against `contOpts.maxRuns` — if reached, exit cleanly with
 *        status `completed`
 *      - If not reached, call `deriveVisionCandidates()` again to find the
 *        next unaddressed vision goal
 *      - If a candidate exists, seed a new intent via the standard
 *        `intake record → triage → approve` pipeline and start the next run
 *      - If no candidate exists (all vision goals addressed), exit with
 *        status `idle_exit` (clean termination, NOT paused)
 *   2. `paused` status should only be used for real blockers (`needs_human`,
 *      `blocked`), never for "I finished a run and didn't know what to do next."
 *   4. Emit `session_continuation` event with payload
 *      `{previous_run_id, next_objective, next_run_id}` so the operator has
 *      a clear audit trail of the auto-chain.
 *
 * Acceptance (from HUMAN-ROADMAP.md):
 *   `run --continuous --max-runs 5` where first run completes, second run is
 *   automatically created from the next vision candidate without any operator
 *   intervention. Session status stays `running`, never `paused`, until
 *   either max_runs is hit or no vision candidates remain.
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
  executeContinuousRun,
  resolveContinuousOptions,
  readContinuousSession,
} from '../../src/lib/continuous-run.js';
import { RUN_EVENTS_PATH } from '../../src/lib/run-events.js';

const tempDirs = [];
const CLI_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CLI_BIN = join(CLI_ROOT, 'bin', 'agentxchain.js');
const EXPECTED_SESSION_CONTINUATION_PAYLOAD_KEYS = [
  'next_intent_id',
  'next_objective',
  'next_run_id',
  'previous_run_id',
  'runs_completed',
  'session_id',
  'trigger',
];
const FORBIDDEN_SESSION_CONTINUATION_PAYLOAD_KEYS = [
  // BUG-54 reproduction metadata belongs in the BUG-54 quote-back harness,
  // not in BUG-53's run-to-run continuation event.
  'prompt_transport',
  'env_snapshot',
  'stdin_bytes',
  'watchdog_ms',
  // BUG-61 ghost-turn retry diagnostics belong in ghost retry events and
  // continuous-session counters, not in session_continuation.
  'auto_retried_ghost',
  'ghost_retry_exhausted',
  'attempts_log',
  'diagnostic_bundle',
  'failure_type',
];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function createTmpProject() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-bug53-'));
  tempDirs.push(dir);
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { name: 'bug53-test', id: 'bug53-001', default_branch: 'main' },
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
    project_id: 'bug53-001',
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

function createCliProject() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-bug53-cli-'));
  tempDirs.push(dir);

  const agentPath = join(dir, '_bug53-cli-agent.mjs');
  writeFileSync(agentPath, [
    "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
    "import { dirname, join } from 'node:path';",
    'const root = process.cwd();',
    "const index = JSON.parse(readFileSync(join(root, '.agentxchain/dispatch/index.json'), 'utf8'));",
    "const entry = Object.values(index.active_turns || {})[0] || {};",
    "const turnId = entry.turn_id || 'unknown';",
    "const runtimeId = entry.runtime_id || 'local-dev';",
    "const stagingResultPath = entry.staging_result_path;",
    "const runId = index.run_id || 'run-unknown';",
    "const session = JSON.parse(readFileSync(join(root, '.agentxchain/continuous-session.json'), 'utf8'));",
    "const objective = String(session.current_vision_objective || runId);",
    "const slug = objective.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || turnId;",
    "const relPath = `src/objectives/${slug}.js`;",
    "const absPath = join(root, relPath);",
    "mkdirSync(dirname(absPath), { recursive: true });",
    "writeFileSync(absPath, `export const objective = ${JSON.stringify(objective)};\\nexport const turnId = ${JSON.stringify(turnId)};\\nexport const runId = ${JSON.stringify(runId)};\\n`);",
    "const result = {",
    "  schema_version: '1.0',",
    '  run_id: runId,',
    '  turn_id: turnId,',
    "  role: 'dev',",
    '  runtime_id: runtimeId,',
    "  status: 'completed',",
    "  summary: `Objective completed: ${objective}` ,",
    "  decisions: [{ id: 'DEC-001', category: 'implementation', statement: `Completed ${objective}`, rationale: 'CLI auto-chain regression proof.' }],",
    "  objections: [],",
    '  files_changed: [relPath],',
    '  artifacts_created: [],',
    "  verification: { status: 'pass', commands: ['echo ok'], evidence_summary: 'ok', machine_evidence: [{ command: 'echo ok', exit_code: 0 }] },",
    "  artifact: { type: 'workspace', ref: null },",
    "  proposed_next_role: 'human',",
    '  phase_transition_request: null,',
    '  run_completion_request: true,',
    '  needs_human_reason: null,',
    '  cost: { usd: 0 },',
    '};',
    "const absStaging = join(root, stagingResultPath);",
    "mkdirSync(dirname(absStaging), { recursive: true });",
    "writeFileSync(absStaging, JSON.stringify(result, null, 2));",
    "console.log(`bug53-cli-agent: completed ${objective}`);",
    '',
  ].join('\n'));

  const config = {
    schema_version: 4,
    protocol_mode: 'governed',
    template: 'generic',
    project: { name: 'bug53-cli-test', id: `bug53-cli-${randomUUID().slice(0, 8)}`, default_branch: 'main' },
    roles: {
      dev: { title: 'Developer', mandate: 'Implement.', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-dev', runtime: 'local-dev' },
    },
    runtimes: {
      'local-dev': {
        type: 'local_cli',
        command: process.execPath,
        args: [agentPath],
        prompt_transport: 'dispatch_bundle_only',
      },
    },
    routing: {
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'human'] },
    },
    gates: {},
    rules: { challenge_required: false, max_turn_retries: 1 },
    intent_coverage_mode: 'lenient',
  };

  mkdirSync(join(dir, '.agentxchain', 'dispatch', 'turns'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(dir, '.gitignore'), '.agentxchain/\n');
  writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify({
    schema_version: '1.0',
    run_id: null,
    project_id: config.project.id,
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
  writeFileSync(join(dir, '.agentxchain', 'run-history.jsonl'), '');
  writeVision(dir, [
    '# CLI Vision',
    '',
    '## Governed Delivery',
    '',
    '- durable decision ledger',
    '- explicit phase gates',
    '- recovery-first blocked state handling',
    '',
  ].join('\n'));

  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "bug53@test.local"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "BUG-53 Test"', { cwd: dir, stdio: 'ignore' });
  execSync('git add .', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "initial"', { cwd: dir, stdio: 'ignore' });
  return dir;
}

it('continues an active governed run that is waiting for its next turn assignment', async () => {
  const root = createTmpProject();
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, '.planning', 'VISION.md'), '# Vision\n\n## Goals\n\n- Already scoped active run\n');
  const config = JSON.parse(readFileSync(join(root, 'agentxchain.json'), 'utf8'));
  const runId = `run_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify({
    schema_version: '1.0',
    run_id: runId,
    project_id: 'bug53-001',
    status: 'active',
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

  let executions = 0;
  const result = await executeContinuousRun(
    { root, config },
    {
      visionPath: '.planning/VISION.md',
      maxRuns: 1,
      maxIdleCycles: 3,
      pollSeconds: 0,
      cooldownSeconds: 0,
      triageApproval: 'auto',
      autoCheckpoint: false,
    },
    async () => {
      executions += 1;
      return {
        exitCode: 0,
        result: {
          stop_reason: 'completed',
          state: {
            run_id: runId,
            status: 'completed',
            budget_status: { spent_usd: 0 },
          },
        },
      };
    },
    () => {},
  );

  assert.equal(result.exitCode, 0);
  assert.equal(executions, 1, 'continuous mode must continue active current runs even when active_turns is empty');
  const session = readContinuousSession(root);
  assert.equal(session.runs_completed, 1);
  assert.equal(session.status, 'completed');
  assert.equal(session.idle_cycles, 0, 'active current runs must not be counted as vision idle cycles');
});

function writeVision(dir, content) {
  const planDir = join(dir, '.planning');
  mkdirSync(planDir, { recursive: true });
  writeFileSync(join(planDir, 'VISION.md'), content, 'utf8');
}

function readRunEvents(dir) {
  const p = join(dir, RUN_EVENTS_PATH);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function assertSessionContinuationPayloadShape(evt) {
  const payload = evt.payload || {};
  assert.deepEqual(
    Object.keys(payload).sort(),
    EXPECTED_SESSION_CONTINUATION_PAYLOAD_KEYS,
    `session_continuation payload shape drifted; got ${JSON.stringify(payload)}`,
  );
  for (const key of FORBIDDEN_SESSION_CONTINUATION_PAYLOAD_KEYS) {
    assert.equal(
      Object.hasOwn(payload, key),
      false,
      `BUG-53 session_continuation payload must not carry unrelated ${key} diagnostic data: ${JSON.stringify(payload)}`,
    );
  }
}

function runContinuousCli(dir, maxRuns = 3) {
  return spawnSync(process.execPath, [
    CLI_BIN,
    'run',
    '--continuous',
    '--vision',
    '.planning/VISION.md',
    '--max-runs',
    String(maxRuns),
    '--max-idle-cycles',
    '1',
    '--poll-seconds',
    '0',
  ], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
  });
}

/**
 * Mock executor that simulates a clean run completion.
 * Writes state.status=completed and preserves the run_id that
 * prepareIntentForDispatch assigned (so resolveIntent's run_id guard passes).
 */
function makeSuccessExecutor(dir) {
  return async () => {
    const statePath = join(dir, '.agentxchain', 'state.json');
    const current = JSON.parse(readFileSync(statePath, 'utf8'));
    const runId = current.run_id;
    current.status = 'completed';
    current.completed_at = new Date().toISOString();
    current.last_completed_turn_id = null;
    current.active_turns = {};
    writeFileSync(statePath, JSON.stringify(current, null, 2));
    return {
      exitCode: 0,
      result: {
        stop_reason: 'completed',
        state: { run_id: runId, status: 'completed' },
      },
    };
  };
}

describe('BUG-53: continuous session auto-chains after a completed run', () => {
  it('CLI-owned run --continuous auto-chains 3 vision goals and emits session_continuation events', () => {
    const dir = createCliProject();

    const run = runContinuousCli(dir, 3);
    const combined = `${run.stdout || ''}${run.stderr || ''}`;
    assert.equal(run.status, 0, `CLI-owned BUG-53 scenario must exit cleanly:\n${combined}`);
    assert.match(combined, /agentxchain run --continuous/);
    assert.match(combined, /Run 1\/3 completed: completed/);
    assert.match(combined, /Run 2\/3 completed: completed/);
    assert.match(combined, /Run 3\/3 completed: completed/);
    assert.doesNotMatch(combined, /continuous loop paused|Run blocked — continuous loop paused/i,
      `BUG-53 clean-completion CLI path must not advertise a paused session:\n${combined}`);

    const session = readContinuousSession(dir);
    assert.ok(session, 'continuous-session.json must exist after CLI-owned auto-chain run');
    assert.equal(session.status, 'completed');
    assert.equal(session.runs_completed, 3);

    const history = readRunEvents(dir)
      .filter((entry) => entry.event_type === 'run_started' || entry.event_type === 'run_completed');
    assert.ok(history.length >= 3,
      `expected run lifecycle events for the CLI-owned auto-chain; got ${history.length}`);

    const continuations = readRunEvents(dir).filter((entry) => entry.event_type === 'session_continuation');
    assert.equal(continuations.length, 2,
      `CLI-owned BUG-53 scenario must emit 2 session_continuation events across 3 runs; got ${continuations.length}`);
    for (const evt of continuations) {
      assertSessionContinuationPayloadShape(evt);
      assert.ok(evt.payload?.previous_run_id, `missing previous_run_id: ${JSON.stringify(evt)}`);
      assert.ok(evt.payload?.next_run_id, `missing next_run_id: ${JSON.stringify(evt)}`);
      assert.ok(evt.payload?.next_objective, `missing next_objective: ${JSON.stringify(evt)}`);
      assert.notEqual(evt.payload.previous_run_id, evt.payload.next_run_id,
        `session_continuation must connect distinct runs: ${JSON.stringify(evt.payload)}`);
    }
  });

  it('chains 3 vision goals through maxRuns=3 and exits cleanly without passing through paused', async () => {
    // Three distinct, unambiguous vision goals so each one seeds a separate
    // candidate after the previous is resolved.
    const dir = createTmpProject();
    writeVision(dir, [
      '## Protocol',
      '',
      '- governed state machine coverage',
      '- intake pipeline deduplication',
      '- phase transition enforcement',
      '',
    ].join('\n'));

    const context = {
      root: dir,
      config: JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8')),
    };
    const contOpts = {
      ...resolveContinuousOptions({ continuous: true, maxRuns: 3 }, context.config),
      cooldownSeconds: 0,
      pollSeconds: 0,
    };

    const statuses = [];
    const runIds = [];
    const originalWrite = null; // placeholder; we observe via event stream

    // Track every session.status value the loop persists so we can prove
    // `paused` never appears on the clean-completion path.
    const statusSnapshots = [];
    const capture = () => {
      const s = readContinuousSession(dir);
      if (s) statusSnapshots.push(s.status);
    };

    const baseExecutor = makeSuccessExecutor(dir);
    const instrumented = async (...args) => {
      capture();
      const out = await baseExecutor(...args);
      runIds.push(out.result.state.run_id);
      capture();
      return out;
    };

    const logs = [];
    const { exitCode, session } = await executeContinuousRun(
      context,
      contOpts,
      instrumented,
      (msg) => logs.push(msg),
    );

    // Core acceptance: exactly 3 runs executed, exit is clean completion, NOT paused.
    assert.equal(exitCode, 0, `expected clean exit; logs:\n${logs.join('\n')}`);
    assert.equal(runIds.length, 3,
      `continuous session must auto-chain through 3 runs (maxRuns=3); ran ${runIds.length}. ` +
      `This is the BUG-53 operator symptom — after a clean completion the loop fails to derive the next vision candidate and stops.`);
    assert.equal(session.runs_completed, 3, 'session.runs_completed must match actual runs');
    assert.equal(session.status, 'completed',
      `session.status at terminal must be "completed" (hit maxRuns); got "${session.status}". ` +
      `BUG-53 requirement #2: paused must never be used for "I finished a run and didn't know what to do next."`);

    // No status transition should ever hit "paused" on the clean-completion path.
    assert.ok(!statusSnapshots.includes('paused'),
      `session.status transitioned through "paused" during a clean-completion auto-chain; observed: ${statusSnapshots.join(' → ')}. ` +
      `BUG-53 requirement #2: paused is reserved for real blockers.`);
    assert.ok(!statusSnapshots.includes('failed'),
      `session.status transitioned through "failed" during a clean-completion auto-chain; observed: ${statusSnapshots.join(' → ')}.`);

    // Distinct run_ids prove each chained run was a genuinely new governed
    // run, not the same run being re-reported.
    const uniqueRunIds = new Set(runIds);
    assert.equal(uniqueRunIds.size, 3,
      `auto-chained runs must have distinct run_ids; got: ${runIds.join(', ')}`);

    // Emission contract: exactly N-1 session_continuation events, one per
    // auto-chain boundary (BUG-53 fix #4).
    const events = readRunEvents(dir);
    const continuations = events.filter((e) => e.event_type === 'session_continuation');
    assert.equal(continuations.length, 2,
      `continuous auto-chain must emit a session_continuation event at every post-completion boundary (2 boundaries for 3 runs); got ${continuations.length}. ` +
      `BUG-53 requirement #4: {previous_run_id, next_objective, next_run_id} audit trail.`);
    for (const evt of continuations) {
      assertSessionContinuationPayloadShape(evt);
      assert.ok(evt.payload?.previous_run_id,
        `session_continuation event must carry payload.previous_run_id; got ${JSON.stringify(evt.payload)}`);
      assert.ok(evt.payload?.next_objective,
        `session_continuation event must carry payload.next_objective; got ${JSON.stringify(evt.payload)}`);
      assert.ok(evt.payload?.next_run_id,
        `session_continuation event must carry payload.next_run_id; got ${JSON.stringify(evt.payload)}`);
      assert.notEqual(evt.payload.previous_run_id, evt.payload.next_run_id,
        `session_continuation event must link two distinct runs; got previous=${evt.payload.previous_run_id} next=${evt.payload.next_run_id}`);
    }

    // Log contract: operator should see a "Run X/Y completed" line per run.
    const completedLogs = logs.filter((l) => /Run \d+\/3 completed/.test(l));
    assert.equal(completedLogs.length, 3,
      `operator log must record "Run X/3 completed" for every run; got ${completedLogs.length}. Log snapshot:\n${logs.join('\n')}`);
  });

  it('CLI-owned run --continuous reaches idle_exit (not paused) when vision goals exhaust mid-chain', () => {
    // BUG-53 fix requirement #1 sub-bullet 4 — "If no candidate exists (all
    // vision goals addressed), exit with status `idle_exit` (clean termination,
    // NOT paused)" — only had a function-call (`executeContinuousRun()`) test.
    // Per HUMAN-ROADMAP rule #13, every BUG-53 fix sub-requirement that lives
    // on the operator's CLI surface needs a child-process spawn assertion.
    //
    // Operator scenario: vision with a single goal, --max-runs higher than
    // achievable (5), --max-idle-cycles 1. After run 1 satisfies the only
    // goal, the next vision scan must return idle, the loop must increment
    // idle_cycles to 1 == maxIdleCycles, and terminate via the idle_exit
    // branch with session.status=completed. The "Run 5/5 completed" line
    // must NEVER appear (we only ran 1 real run); the operator-facing
    // "All vision goals appear addressed (...) Stopping." line MUST appear.
    const dir = createCliProject();
    writeVision(dir, [
      '# CLI Vision',
      '',
      '## Sole Objective',
      '',
      '- single vision goal that completes in one governed run',
      '',
    ].join('\n'));
    // Re-commit the trimmed vision so the governed loop sees a clean tree.
    execSync('git add .planning/VISION.md', { cwd: dir, stdio: 'ignore' });
    execSync('git commit -m "trim vision to single goal"', { cwd: dir, stdio: 'ignore' });

    const run = runContinuousCli(dir, 5);
    const combined = `${run.stdout || ''}${run.stderr || ''}`;
    assert.equal(run.status, 0, `idle_exit CLI scenario must exit cleanly:\n${combined}`);
    assert.match(combined, /Run 1\/5 completed: completed/,
      `operator must see exactly one completed run before idle_exit; output was:\n${combined}`);
    assert.doesNotMatch(combined, /Run [2-5]\/5 completed/,
      `operator must NOT see runs 2..5 — only one vision goal was seeded; output was:\n${combined}`);
    assert.match(combined, /All vision goals appear addressed/,
      `operator must see the idle_exit terminal log line; output was:\n${combined}`);
    assert.doesNotMatch(combined, /continuous loop paused|Run blocked — continuous loop paused/i,
      `BUG-53 rule #2 — clean idle_exit must NEVER advertise "paused" to the operator; output was:\n${combined}`);

    const session = readContinuousSession(dir);
    assert.ok(session, 'continuous-session.json must exist after CLI-owned idle_exit run');
    assert.equal(session.status, 'completed',
      `BUG-53 rule #2 — terminal session.status after idle_exit must be "completed", never "paused"; got "${session.status}"`);
    assert.notEqual(session.status, 'paused',
      `BUG-53 rule #2 — paused is reserved for blocked runs, not idle exhaustion`);
    assert.equal(session.runs_completed, 1,
      `idle_exit CLI scenario must record exactly 1 completed run (only one vision goal seeded); got ${session.runs_completed}`);

    // No session_continuation events should fire — the loop never started a
    // second run, so there is no auto-chain boundary to advertise.
    const continuations = readRunEvents(dir).filter((entry) => entry.event_type === 'session_continuation');
    assert.equal(continuations.length, 0,
      `idle_exit CLI scenario must emit ZERO session_continuation events (no second run was seeded); got ${continuations.length}`);
  });

  it('exits with idle_exit (not paused) when all vision goals are addressed after one run', async () => {
    // Only one distinct goal in the vision file. After run 1 resolves that
    // intent, the next vision scan returns no candidates. The session must
    // terminate as `idle_exit`, not `paused` or `failed`.
    const dir = createTmpProject();
    writeVision(dir, '## Goal\n\n- singleton vision objective to satisfy once\n');

    const context = {
      root: dir,
      config: JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8')),
    };
    const contOpts = {
      ...resolveContinuousOptions({ continuous: true, maxRuns: 5, maxIdleCycles: 1 }, context.config),
      cooldownSeconds: 0,
      pollSeconds: 0,
    };

    const executor = makeSuccessExecutor(dir);
    const logs = [];
    const { exitCode, session } = await executeContinuousRun(
      context, contOpts, executor, (msg) => logs.push(msg),
    );

    assert.equal(exitCode, 0);
    assert.equal(session.runs_completed, 1,
      `only 1 vision goal → only 1 run should execute; got ${session.runs_completed}`);
    assert.ok(
      session.status === 'completed' || session.status === 'running',
      `after exhausting vision goals, session.status must reach a clean terminal path (completed/idle); got "${session.status}". ` +
      `Must NEVER be "paused".`,
    );
    assert.notEqual(session.status, 'paused',
      `BUG-53 requirement #2 — paused must never be used when all goals are addressed`);
    assert.notEqual(session.status, 'failed',
      `idle termination must not be reported as failure`);
  });
});
