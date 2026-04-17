import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import {
  STATE_PATH,
  acceptGovernedTurn,
  assignGovernedTurn,
  getActiveTurn,
  initializeGovernedRun,
} from '../src/lib/governed-state.js';
import {
  HUMAN_ESCALATIONS_PATH,
  HUMAN_TASKS_PATH,
  readHumanEscalations,
} from '../src/lib/human-escalations.js';
import { readRunEvents, RUN_EVENTS_PATH } from '../src/lib/run-events.js';
import { getTurnStagingResultPath } from '../src/lib/turn-paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const dirs = [];

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function createProject() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-human-escalation-'));
  dirs.push(dir);

  const config = {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'human-escalation-fixture', name: 'Human Escalation Fixture', default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'Plan', write_authority: 'review_only', runtime: 'manual-pm' },
      dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime: 'local-dev' },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'local-dev': {
        type: 'local_cli',
        command: ['echo', '{prompt}'],
        prompt_transport: 'argv',
      },
    },
    routing: {
      planning: {
        entry_role: 'pm',
        allowed_next_roles: ['pm', 'dev', 'human'],
      },
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
      },
    },
    rules: {
      challenge_required: false,
      max_turn_retries: 2,
      max_deadlock_cycles: 2,
    },
    files: {
      talk: 'TALK.md',
      history: '.agentxchain/history.jsonl',
      state: '.agentxchain/state.json',
    },
  };

  writeJson(join(dir, 'agentxchain.json'), config);
  writeFileSync(join(dir, 'TALK.md'), '# Talk\n');
  mkdirSync(join(dir, '.planning'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain'), { recursive: true });
  writeFileSync(join(dir, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(dir, '.agentxchain', 'decision-ledger.jsonl'), '');

  return { dir, config };
}

function makeTurnResult(state, turn, overrides = {}) {
  return {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Blocked for human follow-up.',
    decisions: [],
    objections: [],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: [],
      evidence_summary: 'Not relevant for this fixture.',
      machine_evidence: [],
    },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'human',
    phase_transition_request: null,
    run_completion_request: false,
    needs_human_reason: null,
    cost: { input_tokens: 10, output_tokens: 5, usd: 0.001 },
    ...overrides,
  };
}

function blockRunForHumanOauth() {
  const { dir, config } = createProject();
  const initialized = initializeGovernedRun(dir, config);
  assert.equal(initialized.ok, true, initialized.error);

  const assigned = assignGovernedTurn(dir, config, 'dev');
  assert.equal(assigned.ok, true, assigned.error);

  const state = JSON.parse(readFileSync(join(dir, STATE_PATH), 'utf8'));
  const turn = getActiveTurn(state);
  writeJson(
    join(dir, getTurnStagingResultPath(turn.turn_id)),
    makeTurnResult(state, turn, {
      status: 'needs_human',
      needs_human_reason: 'Linear OAuth expired for governed intake sync. Reconnect the OAuth session before continuing.',
    }),
  );

  const accepted = acceptGovernedTurn(dir, config, { turnId: turn.turn_id });
  assert.equal(accepted.ok, true, accepted.error);
  assert.equal(accepted.state.status, 'blocked');

  return { dir, config, state: accepted.state };
}

afterEach(() => {
  for (const dir of dirs.splice(0, dirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('human escalation surface', () => {
  it('AT-HESC-001: blocked human-owned runs create structured escalation records and managed HUMAN_TASKS content', () => {
    const { dir } = blockRunForHumanOauth();

    const records = readHumanEscalations(dir);
    assert.equal(records.length, 1);
    assert.equal(records[0].status, 'open');
    assert.equal(records[0].type, 'needs_oauth');
    assert.equal(records[0].service, 'Linear');
    assert.match(records[0].resolution_command, /^agentxchain unblock hesc_/);

    const tasksDoc = readFileSync(join(dir, HUMAN_TASKS_PATH), 'utf8');
    assert.match(tasksDoc, /## Open/);
    assert.match(tasksDoc, /\.agentxchain\/human-escalations\.jsonl/);
    assert.match(tasksDoc, new RegExp(records[0].escalation_id));
    assert.match(tasksDoc, new RegExp(`agentxchain unblock ${records[0].escalation_id}`));

    const status = runCli(dir, ['status']);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, new RegExp(`Human task:\\s+${records[0].escalation_id}`));
    assert.match(status.stdout, /Type:\s+needs_oauth/);
    assert.match(status.stdout, new RegExp(`Unblock:\\s+agentxchain unblock ${records[0].escalation_id}`));
  });

  it('AT-HESC-002: unblock resolves the escalation record and resumes governed execution', () => {
    const { dir } = blockRunForHumanOauth();
    const [record] = readHumanEscalations(dir);

    const result = runCli(dir, ['unblock', record.escalation_id]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Unblocking/);
    assert.match(result.stdout, /Continuing governed execution/);

    const state = JSON.parse(readFileSync(join(dir, STATE_PATH), 'utf8'));
    assert.equal(state.status, 'active');
    assert.equal(state.blocked_on, null);
    assert.equal(state.blocked_reason, null);
    assert.ok(getActiveTurn(state), 'resume path should assign or re-dispatch the next turn');

    const records = readHumanEscalations(dir);
    const resolved = records.find((entry) => entry.escalation_id === record.escalation_id);
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.resolved_via, 'operator_unblock');

    const tasksDoc = readFileSync(join(dir, HUMAN_TASKS_PATH), 'utf8');
    assert.match(tasksDoc, /## Completed/);
    assert.match(tasksDoc, new RegExp(`${record.escalation_id} — resolved`));
    assert.match(tasksDoc, /Resolved via: operator_unblock/);

    const rawAudit = readFileSync(join(dir, HUMAN_ESCALATIONS_PATH), 'utf8').trim().split('\n');
    assert.equal(rawAudit.length, 2, 'expected raised + resolved JSONL entries');
  });

  it('AT-HESC-003: ensureHumanEscalation emits human_escalation_raised to events.jsonl', () => {
    const { dir } = blockRunForHumanOauth();

    const events = readRunEvents(dir, { type: 'human_escalation_raised' });
    assert.equal(events.length, 1, 'expected exactly one human_escalation_raised event');
    assert.equal(events[0].event_type, 'human_escalation_raised');
    assert.ok(events[0].payload.escalation_id, 'payload must include escalation_id');
    assert.equal(events[0].payload.type, 'needs_oauth');
    assert.equal(events[0].payload.service, 'Linear');
    assert.match(events[0].payload.resolution_command, /^agentxchain unblock hesc_/);
    assert.ok(events[0].run_id, 'event must carry run_id');
  });

  it('AT-HESC-004: unblock emits human_escalation_resolved to events.jsonl', () => {
    const { dir } = blockRunForHumanOauth();
    const [record] = readHumanEscalations(dir);

    const result = runCli(dir, ['unblock', record.escalation_id]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const events = readRunEvents(dir, { type: 'human_escalation_resolved' });
    assert.equal(events.length, 1, 'expected exactly one human_escalation_resolved event');
    assert.equal(events[0].event_type, 'human_escalation_resolved');
    assert.equal(events[0].payload.escalation_id, record.escalation_id);
    assert.equal(events[0].payload.type, 'needs_oauth');
    assert.equal(events[0].payload.service, 'Linear');
    assert.equal(events[0].payload.resolved_via, 'operator_unblock');
  });

  it('AT-HESC-005: local stderr notifier fires on escalation raise', () => {
    const { dir, config } = createProject();
    const initialized = initializeGovernedRun(dir, config);
    assert.equal(initialized.ok, true, initialized.error);
    const assigned = assignGovernedTurn(dir, config, 'dev');
    assert.equal(assigned.ok, true, assigned.error);
    const state = JSON.parse(readFileSync(join(dir, STATE_PATH), 'utf8'));
    const turn = getActiveTurn(state);
    writeJson(
      join(dir, getTurnStagingResultPath(turn.turn_id)),
      makeTurnResult(state, turn, {
        status: 'needs_human',
        needs_human_reason: 'GitHub OAuth session expired for push access.',
      }),
    );

    // Capture stderr from the accept call by running via CLI
    const result = runCli(dir, ['accept-turn', '--turn', turn.turn_id]);
    // The CLI should emit a stderr notice about the escalation
    assert.match(result.stderr, /HUMAN ESCALATION RAISED/, 'stderr must contain local escalation notice');
    assert.match(result.stderr, /needs_oauth/, 'stderr must show escalation type');
    assert.match(result.stderr, /agentxchain unblock/, 'stderr must show unblock command');
  });
});
