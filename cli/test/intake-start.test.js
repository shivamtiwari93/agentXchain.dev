import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it, beforeEach, afterEach } from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

/**
 * Create a governed project with roles, routing, and idle state —
 * the minimum viable surface for intake start to work.
 */
function createGovernedProject() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-intake-s3-'));

  const config = {
    schema_version: '1.0',
    project: {
      id: 'test-intake-s3',
      name: 'Test Intake S3',
      default_branch: 'main',
    },
    protocol_mode: 'governed',
    roles: {
      pm: {
        title: 'Product Manager',
        mandate: 'Protect user value.',
        write_authority: 'review_only',
        runtime: 'manual-pm',
      },
      dev: {
        title: 'Developer',
        mandate: 'Implement approved work.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'local-dev': { type: 'local_cli', command: ['echo', 'test'], cwd: '.' },
    },
    routing: {
      planning: {
        entry_role: 'pm',
        allowed_next_roles: ['pm', 'dev'],
        max_concurrent_turns: 1,
      },
    },
    rules: {
      challenge_required: true,
      max_turn_retries: 2,
      max_deadlock_cycles: 2,
    },
  };

  const state = {
    schema_version: '1.0',
    run_id: null,
    project_id: 'test-intake-s3',
    status: 'idle',
    phase: 'planning',
    accepted_integration_ref: null,
    active_turns: {},
    turn_sequence: 0,
    last_completed_turn_id: null,
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
    phase_gate_status: {
      planning_signoff: 'pending',
    },
  };

  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
  mkdirSync(join(dir, '.agentxchain', 'dispatch', 'turns'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2));
  writeFileSync(join(dir, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(dir, '.agentxchain', 'decision-ledger.jsonl'), '');
  mkdirSync(join(dir, '.planning'), { recursive: true });

  return dir;
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
  });
}

/** Full pipeline: record → triage → approve → plan → return intent ID */
function pipelineThroughPlan(dir, template = 'generic') {
  const recordResult = runCli([
    'intake', 'record',
    '--source', 'manual',
    '--signal', `{"desc":"s3 test ${Date.now()}"}`,
    '--evidence', '{"type":"text","value":"test evidence"}',
    '--json',
  ], dir);
  assert.equal(recordResult.status, 0, `record failed: ${recordResult.stderr}`);
  const intentId = JSON.parse(recordResult.stdout).intent.intent_id;

  const triageResult = runCli([
    'intake', 'triage',
    '--intent', intentId,
    '--priority', 'p1',
    '--template', template,
    '--charter', 'S3 start test',
    '--acceptance', 'governed execution starts',
    '--json',
  ], dir);
  assert.equal(triageResult.status, 0, `triage failed: ${triageResult.stderr}`);

  const approveResult = runCli([
    'intake', 'approve',
    '--intent', intentId,
    '--json',
  ], dir);
  assert.equal(approveResult.status, 0, `approve failed: ${approveResult.stderr}`);

  const planResult = runCli([
    'intake', 'plan',
    '--intent', intentId,
    '--json',
  ], dir);
  assert.equal(planResult.status, 0, `plan failed: ${planResult.stderr}`);

  return intentId;
}

describe('intake start', () => {
  let dir;
  beforeEach(() => { dir = createGovernedProject(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  // AT-V3S3-001: start on a planned intent in idle project
  it('starts a planned intent, initializes run, assigns default role, transitions to executing', () => {
    const intentId = pipelineThroughPlan(dir);

    const result = runCli(['intake', 'start', '--intent', intentId, '--json'], dir);
    assert.equal(result.status, 0, `start failed: ${result.stderr}\n${result.stdout}`);

    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.intent.status, 'executing');
    assert.ok(out.run_id, 'run_id must be present');
    assert.ok(out.turn_id, 'turn_id must be present');
    assert.equal(out.role, 'pm'); // default entry role
    assert.ok(out.dispatch_dir, 'dispatch_dir must be present');
    assert.equal(out.intent.target_run, out.run_id);
    assert.equal(out.intent.target_turn, out.turn_id);
    assert.ok(out.intent.started_at, 'started_at must be set');

    // Verify governed state was updated
    const state = JSON.parse(readFileSync(join(dir, '.agentxchain', 'state.json'), 'utf8'));
    assert.equal(state.status, 'active');
    assert.ok(state.run_id);
    assert.ok(state.active_turns[out.turn_id]);
    assert.equal(state.active_turns[out.turn_id].assigned_role, 'pm');

    // Verify dispatch bundle was created
    assert.ok(existsSync(join(dir, out.dispatch_dir, 'ASSIGNMENT.json')));
    assert.ok(existsSync(join(dir, out.dispatch_dir, 'PROMPT.md')));
  });

  // AT-V3S3-002: role override
  it('records overridden role when --role is valid', () => {
    const intentId = pipelineThroughPlan(dir);

    const result = runCli(['intake', 'start', '--intent', intentId, '--role', 'dev', '--json'], dir);
    assert.equal(result.status, 0, `start failed: ${result.stderr}\n${result.stdout}`);

    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.role, 'dev');
    assert.equal(out.intent.status, 'executing');

    const state = JSON.parse(readFileSync(join(dir, '.agentxchain', 'state.json'), 'utf8'));
    assert.equal(state.active_turns[out.turn_id].assigned_role, 'dev');
  });

  // AT-V3S3-003: wrong state rejection
  it('rejects start on a triaged intent', () => {
    // Record and triage but do not approve/plan
    const recordResult = runCli([
      'intake', 'record',
      '--source', 'manual',
      '--signal', '{"desc":"wrong state test"}',
      '--evidence', '{"type":"text","value":"ev"}',
      '--json',
    ], dir);
    const intentId = JSON.parse(recordResult.stdout).intent.intent_id;

    runCli([
      'intake', 'triage',
      '--intent', intentId,
      '--priority', 'p2',
      '--template', 'generic',
      '--charter', 'test',
      '--acceptance', 'test',
      '--json',
    ], dir);

    const result = runCli(['intake', 'start', '--intent', intentId, '--json'], dir);
    assert.notEqual(result.status, 0);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.match(out.error, /must be planned/);
  });

  // AT-V3S3-003 variant: approved but not planned
  it('rejects start on an approved intent', () => {
    const recordResult = runCli([
      'intake', 'record',
      '--source', 'manual',
      '--signal', '{"desc":"approved state test"}',
      '--evidence', '{"type":"text","value":"ev"}',
      '--json',
    ], dir);
    const intentId = JSON.parse(recordResult.stdout).intent.intent_id;

    runCli(['intake', 'triage', '--intent', intentId, '--priority', 'p1', '--template', 'generic', '--charter', 'test', '--acceptance', 'test', '--json'], dir);
    runCli(['intake', 'approve', '--intent', intentId, '--json'], dir);

    const result = runCli(['intake', 'start', '--intent', intentId, '--json'], dir);
    assert.notEqual(result.status, 0);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.match(out.error, /must be planned/);
  });

  // AT-V3S3-004: missing planning artifacts
  it('rejects when recorded planning artifacts are missing on disk', () => {
    const intentId = pipelineThroughPlan(dir, 'cli-tool');

    // Read the intent and delete one of its artifacts
    const intentsDir = join(dir, '.agentxchain', 'intake', 'intents');
    const intentFiles = readdirSync(intentsDir).filter(f => f.startsWith('intent_'));
    const intentFile = intentFiles.find(f => {
      const i = JSON.parse(readFileSync(join(intentsDir, f), 'utf8'));
      return i.intent_id === intentId;
    });
    const intent = JSON.parse(readFileSync(join(intentsDir, intentFile), 'utf8'));

    if (intent.planning_artifacts && intent.planning_artifacts.length > 0) {
      const artifactPath = join(dir, intent.planning_artifacts[0]);
      rmSync(artifactPath, { force: true });

      const result = runCli(['intake', 'start', '--intent', intentId, '--json'], dir);
      assert.notEqual(result.status, 0);
      const out = JSON.parse(result.stdout);
      assert.equal(out.ok, false);
      assert.match(out.error, /missing/i);
      assert.ok(out.missing.length > 0);
    }
  });

  // AT-V3S3-005: rejects when active turn exists
  it('rejects when another active governed turn already exists', () => {
    const intentId = pipelineThroughPlan(dir);

    // Start the first intent to create an active turn
    const firstResult = runCli(['intake', 'start', '--intent', intentId, '--json'], dir);
    assert.equal(firstResult.status, 0);

    // Create a second planned intent
    const secondId = pipelineThroughPlan(dir);

    // Try to start the second — should fail because first turn is still active
    const result = runCli(['intake', 'start', '--intent', secondId, '--json'], dir);
    assert.notEqual(result.status, 0);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.match(out.error, /active turn/);
  });

  // AT-V3S3-006: rejects when governed state is blocked
  it('rejects when governed state is blocked', () => {
    const intentId = pipelineThroughPlan(dir);

    // Manually set state to blocked (must keep the run_id so state validates)
    const statePath = join(dir, '.agentxchain', 'state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    state.run_id = 'run_blocked_test';
    state.status = 'blocked';
    state.blocked_on = 'human:test_block';
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    const result = runCli(['intake', 'start', '--intent', intentId, '--json'], dir);
    assert.notEqual(result.status, 0);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.match(out.error, /blocked/);
  });

  // AT-V3S3-007: rejects when governed state is completed
  it('rejects when governed state is completed', () => {
    const intentId = pipelineThroughPlan(dir);

    const statePath = join(dir, '.agentxchain', 'state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    state.status = 'completed';
    state.run_id = 'run_completed_test';
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    const result = runCli(['intake', 'start', '--intent', intentId, '--json'], dir);
    assert.notEqual(result.status, 0);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.match(out.error, /completed/);
  });

  // AT-V3S3-008: JSON output shape
  it('returns run_id, turn_id, and dispatch_dir in JSON mode', () => {
    const intentId = pipelineThroughPlan(dir);

    const result = runCli(['intake', 'start', '--intent', intentId, '--json'], dir);
    assert.equal(result.status, 0);

    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.ok(out.run_id.startsWith('run_'), `run_id should start with run_: ${out.run_id}`);
    assert.ok(out.turn_id.startsWith('turn_'), `turn_id should start with turn_: ${out.turn_id}`);
    assert.ok(out.dispatch_dir.includes(out.turn_id), 'dispatch_dir should contain the turn_id');
    assert.equal(out.exitCode, 0);
  });

  // AT-V3S3-009: history transition
  it('appends history entry from planned to executing with linkage fields', () => {
    const intentId = pipelineThroughPlan(dir);

    const result = runCli(['intake', 'start', '--intent', intentId, '--json'], dir);
    assert.equal(result.status, 0);

    const out = JSON.parse(result.stdout);
    const history = out.intent.history;
    const lastEntry = history[history.length - 1];

    assert.equal(lastEntry.from, 'planned');
    assert.equal(lastEntry.to, 'executing');
    assert.equal(lastEntry.run_id, out.run_id);
    assert.equal(lastEntry.turn_id, out.turn_id);
    assert.equal(lastEntry.role, 'pm');
    assert.ok(lastEntry.at, 'history entry must have timestamp');
  });

  // Edge: unknown role override
  it('rejects unknown --role override', () => {
    const intentId = pipelineThroughPlan(dir);

    const result = runCli(['intake', 'start', '--intent', intentId, '--role', 'nonexistent', '--json'], dir);
    assert.notEqual(result.status, 0);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.match(out.error, /unknown role/i);
  });

  // Edge: non-existent intent
  it('exits 2 for non-existent intent', () => {
    const result = runCli(['intake', 'start', '--intent', 'intent_000_0000', '--json'], dir);
    assert.equal(result.status, 2);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.match(out.error, /not found/);
  });

  // Edge: paused with pending phase transition is rejected (paused check fires first)
  it('rejects paused run with pending phase transition', () => {
    const intentId = pipelineThroughPlan(dir);

    const statePath = join(dir, '.agentxchain', 'state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    state.status = 'paused';
    state.run_id = 'run_paused_gate';
    state.pending_phase_transition = 'implementation';
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    const result = runCli(['intake', 'start', '--intent', intentId, '--json'], dir);
    assert.notEqual(result.status, 0);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.match(out.error, /paused/);
  });

  // AT-V3S3-010: pure paused run without pending gates is rejected
  // The schema validator rejects paused state without pending gates at parse time,
  // so this surfaces as a state.json parse failure rather than the explicit paused check.
  it('rejects paused run even without pending gates (approval-held)', () => {
    const intentId = pipelineThroughPlan(dir);

    const statePath = join(dir, '.agentxchain', 'state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    state.status = 'paused';
    state.run_id = 'run_paused_no_gates';
    delete state.pending_phase_transition;
    delete state.pending_run_completion;
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    const result = runCli(['intake', 'start', '--intent', intentId, '--json'], dir);
    assert.notEqual(result.status, 0);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    // Schema validator catches this: paused without pending gates is structurally invalid
    assert.match(out.error, /parse governed state|paused/);
  });
});
