/**
 * E2E Intake Lifecycle Test
 *
 * Validates the shipped intake lifecycle through real CLI subprocesses:
 * record -> triage -> approve -> plan -> start -> accept-turn -> resolve.
 *
 * See: .planning/E2E_INTAKE_LIFECYCLE_SPEC.md
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync, execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getTurnStagingResultPath } from '../src/lib/turn-paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function writeJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function runCli(cwd, args) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
  });

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function createGovernedRepo() {
  const root = join(
    tmpdir(),
    `axc-e2e-intake-${randomBytes(6).toString('hex')}`,
  );
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'dispatch', 'turns'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });

  const config = {
    schema_version: '1.0',
    protocol_mode: 'governed',
    project: {
      id: 'intake-e2e',
      name: 'Intake E2E',
      default_branch: 'main',
    },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement approved work.',
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
        allowed_next_roles: ['dev', 'human'],
        exit_gate: null,
        max_concurrent_turns: 1,
      },
    },
    gates: {},
    rules: {
      challenge_required: true,
      max_turn_retries: 2,
      max_deadlock_cycles: 2,
    },
  };

  const state = {
    schema_version: '1.0',
    run_id: null,
    project_id: 'intake-e2e',
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
  };

  writeJson(join(root, 'agentxchain.json'), config);
  writeJson(join(root, '.agentxchain', 'state.json'), state);
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');

  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git add -A', { cwd: root, stdio: 'ignore' });
  execSync(
    'git -c user.name="test" -c user.email="test@test" commit -m "initial"',
    { cwd: root, stdio: 'ignore' },
  );

  return root;
}

function commitAll(root, message) {
  execSync('git add -A', { cwd: root, stdio: 'ignore' });
  execSync(
    `git -c user.name="test" -c user.email="test@test" commit -m "${message}" --allow-empty`,
    { cwd: root, stdio: 'ignore' },
  );
}

function stageTurnResult(root, turnInfo) {
  const stagedSourcePath = 'src/intake-e2e.js';
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, stagedSourcePath),
    'export const intakeE2E = "completed";\n',
  );

  const result = {
    schema_version: '1.0',
    run_id: turnInfo.runId,
    turn_id: turnInfo.turnId,
    role: turnInfo.role,
    runtime_id: turnInfo.runtimeId,
    status: 'completed',
    summary: 'Completed intake-driven governed work.',
    decisions: [
      {
        id: 'DEC-001',
        category: 'implementation',
        statement: 'Close the intake lifecycle through real CLI acceptance.',
        rationale: 'Workflow-heavy behavior needs subprocess proof.',
      },
    ],
    objections: [
      {
        id: 'OBJ-001',
        severity: 'low',
        statement: 'No blocked-path coverage in this slice.',
        status: 'raised',
      },
    ],
    files_changed: [stagedSourcePath],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['node --eval "process.exit(0)"'],
      evidence_summary: 'Synthetic pass for CLI intake E2E.',
      machine_evidence: [
        { command: 'node --eval "process.exit(0)"', exit_code: 0 },
      ],
    },
    artifact: { type: 'workspace', ref: null },
    proposed_next_role: 'human',
    phase_transition_request: null,
    run_completion_request: true,
    needs_human_reason: null,
    cost: { input_tokens: 100, output_tokens: 50, usd: 0.01 },
  };

  const stagingPath = join(root, getTurnStagingResultPath(turnInfo.turnId));
  mkdirSync(dirname(stagingPath), { recursive: true });
  writeJson(stagingPath, result);
  return { stagingPath, stagedSourcePath };
}

describe('E2E intake lifecycle', () => {
  let root;

  before(() => {
    root = createGovernedRepo();
  });

  after(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  });

  it('drives the shipped intake lifecycle through CLI subprocesses and closes the intent to completed', () => {
    const record = runCli(root, [
      'intake', 'record',
      '--source', 'manual',
      '--signal', '{"description":"e2e intake lifecycle"}',
      '--evidence', '{"type":"text","value":"prove the full intake loop"}',
      '--json',
    ]);
    assert.equal(record.exitCode, 0, record.combined);
    const recordOut = JSON.parse(record.stdout);
    const intentId = recordOut.intent.intent_id;
    const eventId = recordOut.event.event_id;

    const triage = runCli(root, [
      'intake', 'triage',
      '--intent', intentId,
      '--priority', 'p1',
      '--template', 'cli-tool',
      '--charter', 'Prove the full intake lifecycle through CLI subprocesses',
      '--acceptance', 'intake lifecycle closes through real governed acceptance',
      '--json',
    ]);
    assert.equal(triage.exitCode, 0, triage.combined);

    const approve = runCli(root, [
      'intake', 'approve',
      '--intent', intentId,
      '--approver', 'e2e-operator',
      '--reason', 'workflow-heavy proof gap',
      '--json',
    ]);
    assert.equal(approve.exitCode, 0, approve.combined);

    const plan = runCli(root, [
      'intake', 'plan',
      '--intent', intentId,
      '--project-name', 'Intake E2E',
      '--json',
    ]);
    assert.equal(plan.exitCode, 0, plan.combined);
    const planOut = JSON.parse(plan.stdout);
    assert.ok(Array.isArray(planOut.intent.planning_artifacts));
    assert.ok(planOut.intent.planning_artifacts.length > 0);
    for (const relPath of planOut.intent.planning_artifacts) {
      assert.ok(existsSync(join(root, relPath)), `missing planning artifact ${relPath}`);
    }

    commitAll(root, 'commit planned intake artifacts');

    const start = runCli(root, [
      'intake', 'start',
      '--intent', intentId,
      '--json',
    ]);
    assert.equal(start.exitCode, 0, start.combined);
    const startOut = JSON.parse(start.stdout);
    assert.equal(startOut.ok, true);
    assert.equal(startOut.intent.status, 'executing');
    assert.ok(startOut.run_id);
    assert.ok(startOut.turn_id);
    assert.equal(startOut.role, 'dev');
    assert.equal(startOut.intent.target_run, startOut.run_id);
    assert.equal(startOut.intent.target_turn, startOut.turn_id);
    assert.ok(startOut.intent.started_at);

    const stateAfterStart = readJson(join(root, '.agentxchain', 'state.json'));
    const activeTurn = stateAfterStart.active_turns[startOut.turn_id];
    assert.ok(activeTurn, 'active turn must exist after intake start');

    const staged = stageTurnResult(root, {
      runId: startOut.run_id,
      turnId: startOut.turn_id,
      role: activeTurn.assigned_role,
      runtimeId: activeTurn.runtime_id,
    });
    assert.ok(existsSync(staged.stagingPath), 'turn-result must be staged');
    assert.ok(existsSync(join(root, staged.stagedSourcePath)), 'product change must exist');

    const accept = runCli(root, ['accept-turn']);
    assert.equal(accept.exitCode, 0, accept.combined);
    assert.match(accept.stdout, /Turn Accepted/);

    const completedState = readJson(join(root, '.agentxchain', 'state.json'));
    assert.equal(completedState.status, 'completed');
    assert.equal(completedState.run_id, startOut.run_id);

    const resolve = runCli(root, [
      'intake', 'resolve',
      '--intent', intentId,
      '--json',
    ]);
    assert.equal(resolve.exitCode, 0, resolve.combined);
    const resolveOut = JSON.parse(resolve.stdout);
    assert.equal(resolveOut.ok, true);
    assert.equal(resolveOut.previous_status, 'executing');
    assert.equal(resolveOut.new_status, 'completed');
    assert.equal(resolveOut.run_outcome, 'completed');
    assert.equal(resolveOut.no_change, false);
    assert.equal(resolveOut.intent.intent_id, intentId);
    assert.equal(resolveOut.intent.event_id, eventId);
    assert.equal(resolveOut.intent.target_run, startOut.run_id);
    assert.equal(resolveOut.intent.run_final_turn, startOut.turn_id);

    const eventPath = join(root, '.agentxchain', 'intake', 'events', `${eventId}.json`);
    const intentPath = join(root, '.agentxchain', 'intake', 'intents', `${intentId}.json`);
    const observationsPath = join(root, '.agentxchain', 'intake', 'observations', intentId);
    assert.ok(existsSync(eventPath), 'event artifact must exist');
    assert.ok(existsSync(intentPath), 'intent artifact must exist');
    assert.ok(existsSync(observationsPath), 'observation scaffold must exist');

    const intent = readJson(intentPath);
    assert.equal(intent.status, 'completed');
    assert.ok(
      intent.history.some(
        (entry) =>
          entry.from === 'executing' &&
          entry.to === 'completed' &&
          entry.run_id === startOut.run_id,
      ),
      'intent history must record the completing run linkage',
    );
  });
});
