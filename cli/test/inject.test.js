import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it, beforeEach, afterEach } from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

const GOVERNED_CONFIG = {
  schema_version: '1.0',
  protocol_mode: 'governed',
  project: {
    id: 'test-inject',
    name: 'Test Inject',
    default_branch: 'main',
  },
  roles: {
    dev: {
      title: 'Developer',
      mandate: 'Develop features',
      write_authority: 'authoritative',
      runtime: 'manual-dev',
    },
  },
  runtimes: {
    'manual-dev': { type: 'manual' },
  },
  routing: {
    implementation: {
      entry_role: 'dev',
      allowed_next_roles: ['dev'],
      exit_gate: null,
      max_concurrent_turns: 1,
    },
  },
  gates: {},
  rules: {
    challenge_required: false,
    max_turn_retries: 2,
    max_deadlock_cycles: 2,
  },
};

function createProject() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-inject-'));
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(GOVERNED_CONFIG, null, 2));
  mkdirSync(join(dir, '.agentxchain'), { recursive: true });
  return dir;
}

function createGovernedProject() {
  return createProject();
}

function writeActiveState(dir, overrides = {}) {
  writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify({
    schema_version: '1.0',
    run_id: `run_${Date.now()}_inject`,
    project_id: 'test-inject',
    status: 'active',
    phase: 'implementation',
    accepted_integration_ref: null,
    active_turns: {},
    turn_sequence: 0,
    last_completed_turn_id: null,
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
    pending_phase_transition: null,
    pending_run_completion: null,
    queued_phase_transition: null,
    queued_run_completion: null,
    phase_gate_status: {},
    provenance: {
      trigger: 'schedule',
      created_by: 'operator',
      trigger_reason: 'schedule:test-inject',
    },
    ...overrides,
  }, null, 2));
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 10000,
  });
}

function readIntakeFiles(dir, subdir) {
  const path = join(dir, '.agentxchain', 'intake', subdir);
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter(f => f.endsWith('.json') && !f.startsWith('.tmp-'))
    .map(f => JSON.parse(readFileSync(join(path, f), 'utf8')));
}

function readPreemptionMarker(dir) {
  const p = join(dir, '.agentxchain', 'intake', 'injected-priority.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

describe('agentxchain inject', () => {
  let dir;
  beforeEach(() => { dir = createProject(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  // AT-INJECT-001
  it('creates an approved p0 intent with preemption marker', () => {
    const result = runCli(['inject', 'Fix sidebar ordering', '--priority', 'p0', '--json'], dir);
    assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`);

    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.status, 'approved');
    assert.equal(out.priority, 'p0');
    assert.equal(out.deduplicated, false);
    assert.equal(out.preemption_marker, true);
    assert.match(out.intent_id, /^intent_\d+_[0-9a-f]{4}$/);

    // Verify intent on disk
    const intents = readIntakeFiles(dir, 'intents');
    assert.equal(intents.length, 1);
    assert.equal(intents[0].status, 'approved');
    assert.equal(intents[0].priority, 'p0');
    assert.equal(intents[0].approved_by, 'human');

    // Verify preemption marker
    const marker = readPreemptionMarker(dir);
    assert.ok(marker, 'preemption marker must exist');
    assert.equal(marker.intent_id, out.intent_id);
    assert.equal(marker.priority, 'p0');
    assert.ok(marker.injected_at);
  });

  // AT-INJECT-002
  it('creates an approved p2 intent without preemption marker', () => {
    const result = runCli(['inject', 'Low priority cleanup', '--priority', 'p2', '--json'], dir);
    assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`);

    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.status, 'approved');
    assert.equal(out.priority, 'p2');
    assert.equal(out.preemption_marker, false);

    // No preemption marker for non-p0
    const marker = readPreemptionMarker(dir);
    assert.equal(marker, null);
  });

  // AT-INJECT-003
  it('stops at triaged when --no-approve is set', () => {
    const result = runCli(['inject', 'Draft work', '--no-approve', '--json'], dir);
    assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`);

    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.status, 'triaged');
    assert.equal(out.preemption_marker, false);
  });

  // AT-INJECT-004
  it('uses description as default charter', () => {
    const result = runCli(['inject', 'Refactor auth module', '--priority', 'p1', '--json'], dir);
    assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`);

    const intents = readIntakeFiles(dir, 'intents');
    assert.equal(intents[0].charter, 'Refactor auth module');
  });

  // AT-INJECT-005
  it('uses explicit charter when provided', () => {
    const result = runCli([
      'inject', 'Auth work',
      '--charter', 'Refactor authentication to use OAuth2',
      '--priority', 'p1',
      '--json',
    ], dir);
    assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`);

    const intents = readIntakeFiles(dir, 'intents');
    assert.equal(intents[0].charter, 'Refactor authentication to use OAuth2');
  });

  // AT-INJECT-006
  it('handles acceptance criteria', () => {
    const result = runCli([
      'inject', 'Add dark mode',
      '--acceptance', 'Toggle works,Colors correct,Persists',
      '--json',
    ], dir);
    assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`);

    const intents = readIntakeFiles(dir, 'intents');
    assert.deepStrictEqual(intents[0].acceptance_contract, ['Toggle works', 'Colors correct', 'Persists']);
  });

  // AT-INJECT-007
  it('deduplicates identical injections', () => {
    runCli(['inject', 'Fix sidebar', '--json'], dir);
    const result = runCli(['inject', 'Fix sidebar', '--json'], dir);
    assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`);

    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.deduplicated, true);

    // Only one intent exists
    const intents = readIntakeFiles(dir, 'intents');
    assert.equal(intents.length, 1);
  });

  // AT-INJECT-008
  it('rejects invalid priority', () => {
    const result = runCli(['inject', 'Bad priority', '--priority', 'p9', '--json'], dir);
    assert.notEqual(result.status, 0);
  });

  // AT-INJECT-009
  it('rejects empty description', () => {
    const result = runCli(['inject', '', '--json'], dir);
    assert.notEqual(result.status, 0);
  });
});

describe('inject preemption in status', () => {
  let dir;
  beforeEach(() => { dir = createGovernedProject(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  // AT-INJECT-004 (status visibility)
  it('status --json includes preemption_marker when present', () => {
    // Inject p0
    runCli(['inject', 'Critical fix', '--priority', 'p0', '--json'], dir);

    // Check status
    const result = runCli(['status', '--json'], dir);
    assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`);

    const status = JSON.parse(result.stdout);
    assert.ok(status.preemption_marker, 'preemption_marker must be present in status');
    assert.equal(status.preemption_marker.priority, 'p0');
    assert.ok(status.preemption_marker.intent_id);
  });

  it('status --json shows null preemption_marker when none exists', () => {
    const result = runCli(['status', '--json'], dir);
    assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`);

    const status = JSON.parse(result.stdout);
    assert.equal(status.preemption_marker, null);
  });
});

describe('inject preemption in run loop', () => {
  let dir;
  beforeEach(() => { dir = createGovernedProject(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  // AT-INJECT-005 (run loop preemption)
  it('run loop library returns priority_preempted when p0 marker exists', async () => {
    const { runLoop } = await import('../src/lib/run-loop.js');
    const { loadNormalizedConfig } = await import('../src/lib/normalized-config.js');

    // Write a preemption marker directly (simulates a concurrent inject)
    const markerDir = join(dir, '.agentxchain', 'intake');
    const intentsDir = join(markerDir, 'intents');
    mkdirSync(intentsDir, { recursive: true });
    const marker = {
      intent_id: 'intent_9999999999999_abcd',
      priority: 'p0',
      description: 'Emergency fix',
      injected_at: new Date().toISOString(),
    };
    writeFileSync(join(markerDir, 'injected-priority.json'), JSON.stringify(marker));
    // BUG-48: preemption marker validation now requires the intent file to exist
    // on disk with an actionable status (approved or planned)
    writeFileSync(join(intentsDir, 'intent_9999999999999_abcd.json'), JSON.stringify({
      intent_id: 'intent_9999999999999_abcd',
      status: 'approved',
      priority: 'p0',
      description: 'Emergency fix',
      created_at: new Date().toISOString(),
    }));

    // Write an active governed state so the run loop doesn't need to init
    const runId = `run_${Date.now()}_test`;
    writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify({
      schema_version: '1.0',
      run_id: runId,
      project_id: 'test-inject',
      status: 'active',
      phase: 'implementation',
      accepted_integration_ref: null,
      turn_count: 0,
      turns: [],
      decision_count: 0,
    }));
    writeFileSync(join(dir, '.agentxchain', 'history.jsonl'), '');
    writeFileSync(join(dir, '.agentxchain', 'decision-ledger.jsonl'), '');

    // Load and normalize config
    const raw = JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8'));
    const normalized = loadNormalizedConfig(raw, dir);
    assert.ok(normalized.ok, `config normalization failed: ${normalized.errors?.join(', ')}`);

    const events = [];
    const result = await runLoop(dir, normalized.normalized, {
      selectRole: () => 'dev',
      dispatch: async () => ({ status: 'completed', content: 'done' }),
      approveGate: async () => true,
      onEvent: (e) => events.push(e),
    }, { maxTurns: 5 });

    assert.equal(result.stop_reason, 'priority_preempted', `expected priority_preempted, got ${result.stop_reason}`);
    assert.equal(result.preempted_by, marker.intent_id);

    // Verify the priority_injected event was emitted
    const preemptEvent = events.find(e => e.type === 'priority_injected');
    assert.ok(preemptEvent, 'priority_injected event must be emitted');
    assert.equal(preemptEvent.intent_id, marker.intent_id);
  });
});

describe('inject preemption marker consumption', () => {
  let dir;
  beforeEach(() => { dir = createGovernedProject(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('plans and starts the injected intent, then clears the marker', async () => {
    writeActiveState(dir);

    const injected = runCli(['inject', 'Critical fix', '--priority', 'p0', '--json'], dir);
    assert.equal(injected.status, 0, `exit ${injected.status}: ${injected.stderr}`);
    const injectedPayload = JSON.parse(injected.stdout);

    const { consumePreemptionMarker } = await import('../src/lib/intake.js');
    const result = consumePreemptionMarker(dir);

    assert.equal(result.ok, true, result.error || 'consumePreemptionMarker must succeed');
    assert.equal(result.intent_id, injectedPayload.intent_id);
    assert.equal(result.starting_status, 'approved');
    assert.equal(result.final_status, 'executing');
    assert.equal(result.planned, true);
    assert.equal(result.started, true);
    assert.ok(result.turn_id);

    assert.equal(readPreemptionMarker(dir), null, 'preemption marker must be cleared after start');

    const intents = readIntakeFiles(dir, 'intents');
    assert.equal(intents[0].status, 'executing');
    assert.equal(intents[0].target_turn, result.turn_id);

    const state = JSON.parse(readFileSync(join(dir, '.agentxchain', 'state.json'), 'utf8'));
    assert.ok(state.active_turns[result.turn_id], 'consuming the marker must assign the injected turn');
  });
});
