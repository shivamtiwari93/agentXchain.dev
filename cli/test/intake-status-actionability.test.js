import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it, beforeEach, afterEach } from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function createGovernedProject() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-intake-status-action-'));

  const config = {
    schema_version: '1.0',
    project: {
      id: 'test-intake-status-action',
      name: 'Test Intake Status Actionability',
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
    project_id: 'test-intake-status-action',
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

function recordIntent(dir, description = `status action ${Date.now()}`) {
  const result = runCli([
    'intake', 'record',
    '--source', 'manual',
    '--signal', JSON.stringify({ description }),
    '--evidence', '{"type":"text","value":"test evidence"}',
    '--json',
  ], dir);
  assert.equal(result.status, 0, `record failed: ${result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout).intent.intent_id;
}

function triageIntent(dir, intentId) {
  const result = runCli([
    'intake', 'triage',
    '--intent', intentId,
    '--priority', 'p1',
    '--template', 'generic',
    '--charter', 'Actionability test',
    '--acceptance', 'surface next action',
    '--json',
  ], dir);
  assert.equal(result.status, 0, `triage failed: ${result.stderr}\n${result.stdout}`);
}

function approveIntent(dir, intentId) {
  const result = runCli(['intake', 'approve', '--intent', intentId, '--json'], dir);
  assert.equal(result.status, 0, `approve failed: ${result.stderr}\n${result.stdout}`);
}

function planIntent(dir, intentId) {
  const result = runCli(['intake', 'plan', '--intent', intentId, '--json'], dir);
  assert.equal(result.status, 0, `plan failed: ${result.stderr}\n${result.stdout}`);
}

function startIntent(dir, intentId) {
  const result = runCli(['intake', 'start', '--intent', intentId, '--json'], dir);
  assert.equal(result.status, 0, `start failed: ${result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout);
}

function setRunStatus(dir, overrides) {
  const statePath = join(dir, '.agentxchain', 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  Object.assign(state, overrides);
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

describe('intake status actionability', () => {
  let dir;

  beforeEach(() => { dir = createGovernedProject(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('AT-INTAKE-ACT-001: detected intent detail JSON exposes triage command and suppress alternative', () => {
    const intentId = recordIntent(dir);

    const result = runCli(['intake', 'status', '--intent', intentId, '--json'], dir);
    assert.equal(result.status, 0, `status failed: ${result.stderr}\n${result.stdout}`);

    const out = JSON.parse(result.stdout);
    assert.equal(out.next_action.label, 'triage');
    assert.match(out.next_action.command, new RegExp(`agentxchain intake triage --intent ${intentId}`));
    assert.equal(out.next_action.alternatives.length, 1);
    assert.match(out.next_action.alternatives[0], new RegExp(`agentxchain intake triage --intent ${intentId} --suppress --reason`));
  });

  it('AT-INTAKE-ACT-002: triaged intent detail text shows approve and reject guidance', () => {
    const intentId = recordIntent(dir);
    triageIntent(dir, intentId);

    const result = runCli(['intake', 'status', '--intent', intentId], dir);
    assert.equal(result.status, 0, `status failed: ${result.stderr}\n${result.stdout}`);

    assert.match(result.stdout, /Next Action:/);
    assert.match(result.stdout, /Approve this triaged intent for planning or reject it explicitly\./);
    assert.match(result.stdout, new RegExp(`Command:\\s+agentxchain intake approve --intent ${intentId}`));
    assert.match(result.stdout, new RegExp(`Alternative:\\s+agentxchain intake triage --intent ${intentId} --reject --reason`));
  });

  it('AT-INTAKE-ACT-003: planned intent JSON shows start as primary and handoff as alternative', () => {
    const intentId = recordIntent(dir);
    triageIntent(dir, intentId);
    approveIntent(dir, intentId);
    planIntent(dir, intentId);

    const result = runCli(['intake', 'status', '--intent', intentId, '--json'], dir);
    assert.equal(result.status, 0, `status failed: ${result.stderr}\n${result.stdout}`);

    const out = JSON.parse(result.stdout);
    assert.equal(out.next_action.label, 'start');
    assert.equal(out.next_action.command, `agentxchain intake start --intent ${intentId}`);
    assert.equal(out.next_action.alternatives.length, 1);
    assert.equal(
      out.next_action.alternatives[0],
      `agentxchain intake handoff --intent ${intentId} --coordinator-root <path> --workstream <id>`
    );
  });

  it('AT-INTAKE-ACT-004: blocked intent detail JSON surfaces recovery plus rerun-resolve command', () => {
    const intentId = recordIntent(dir);
    triageIntent(dir, intentId);
    approveIntent(dir, intentId);
    planIntent(dir, intentId);
    const started = startIntent(dir, intentId);

    setRunStatus(dir, {
      status: 'blocked',
      active_turns: {},
      blocked_on: 'escalation:retries-exhausted:dev',
      blocked_reason: {
        category: 'retries_exhausted',
        blocked_at: new Date().toISOString(),
        turn_id: started.turn_id,
        recovery: {
          typed_reason: 'retries_exhausted',
          owner: 'human',
          recovery_action: 'Resolve the escalation, then run agentxchain step --resume',
          turn_retained: true,
          detail: null,
        },
      },
    });

    const resolve = runCli(['intake', 'resolve', '--intent', intentId, '--json'], dir);
    assert.equal(resolve.status, 0, `resolve failed: ${resolve.stderr}\n${resolve.stdout}`);

    const result = runCli(['intake', 'status', '--intent', intentId, '--json'], dir);
    assert.equal(result.status, 0, `status failed: ${result.stderr}\n${result.stdout}`);

    const out = JSON.parse(result.stdout);
    assert.equal(out.next_action.label, 'recover');
    assert.equal(out.next_action.command, `agentxchain intake resolve --intent ${intentId}`);
    assert.equal(out.next_action.recovery, 'Resolve the escalation, then run agentxchain step --resume');
  });

  it('AT-INTAKE-ACT-005: summary JSON rows include next_action for actionable intents', () => {
    const detectedId = recordIntent(dir, 'detected action');
    const plannedId = recordIntent(dir, 'planned action');
    triageIntent(dir, plannedId);
    approveIntent(dir, plannedId);
    planIntent(dir, plannedId);

    const result = runCli(['intake', 'status', '--json'], dir);
    assert.equal(result.status, 0, `status failed: ${result.stderr}\n${result.stdout}`);

    const out = JSON.parse(result.stdout);
    const byId = new Map(out.summary.intents.map((intent) => [intent.intent_id, intent]));

    assert.equal(byId.get(detectedId).next_action.label, 'triage');
    assert.equal(byId.get(plannedId).next_action.label, 'start');
    assert.equal(byId.get(plannedId).next_action.command, `agentxchain intake start --intent ${plannedId}`);
  });
});
