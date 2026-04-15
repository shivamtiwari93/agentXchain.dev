import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const tempDirs = new Set();

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function writeJsonl(filePath, entries) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, NODE_NO_WARNINGS: '1', NO_COLOR: '1' },
  });
}

function isoMinutesAgo(minutesAgo) {
  return new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
}

function createGovernedProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-recent-events-run-'));
  tempDirs.add(root);
  const dispatchedAt = isoMinutesAgo(4);
  const acceptedAt = isoMinutesAgo(2);

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: 'recent-events-run', name: 'Recent Events Run', default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement safely.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
    },
    runtimes: {
      'local-dev': {
        type: 'local_cli',
        command: ['echo', '{prompt}'],
        prompt_transport: 'argv',
      },
    },
    routing: {
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
      },
    },
    budget: { per_run_max_usd: 10, per_turn_max_usd: 2 },
    gates: {},
    hooks: {},
  });

  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: 'recent-events-run',
    run_id: 'run_recent_events_001',
    status: 'active',
    phase: 'implementation',
    active_turns: {
      turn_001: {
        turn_id: 'turn_001',
        assigned_role: 'dev',
        status: 'running',
        attempt: 1,
        runtime_id: 'local-dev',
        assigned_sequence: 1,
        started_at: dispatchedAt,
      },
    },
    retained_turns: {},
    turn_sequence: 1,
    blocked_on: null,
    blocked_reason: null,
    phase_gate_status: {},
    budget_status: { spent_usd: 0.25, remaining_usd: 9.75 },
    protocol_mode: 'governed',
    created_at: '2026-04-15T20:00:00.000Z',
  });

  writeJsonl(join(root, '.agentxchain', 'history.jsonl'), [
    {
      turn_id: 'turn_001',
      role: 'dev',
      status: 'running',
      summary: 'Implementing recent event visibility.',
      decisions: [{ id: 'DEC-RECENT-EVENTS-001' }],
      objections: [],
      files_changed: ['cli/src/commands/status.js'],
      cost: { total_usd: 0.25 },
      started_at: dispatchedAt,
      accepted_sequence: 1,
    },
  ]);

  writeJsonl(join(root, '.agentxchain', 'decision-ledger.jsonl'), [
    {
      id: 'DEC-RECENT-EVENTS-001',
      turn_id: 'turn_001',
      role: 'dev',
      phase: 'implementation',
      statement: 'Expose recent lifecycle evidence in operator surfaces.',
    },
  ]);

  writeJsonl(join(root, '.agentxchain', 'events.jsonl'), [
    {
      event_id: 'evt_recent_001',
      event_type: 'turn_dispatched',
      timestamp: dispatchedAt,
      run_id: 'run_recent_events_001',
      phase: 'implementation',
      status: 'active',
      turn: { turn_id: 'turn_001', role_id: 'dev' },
      payload: {},
    },
    {
      event_id: 'evt_recent_002',
      event_type: 'turn_accepted',
      timestamp: acceptedAt,
      run_id: 'run_recent_events_001',
      phase: 'implementation',
      status: 'active',
      turn: { turn_id: 'turn_001', role_id: 'dev' },
      payload: {},
    },
  ]);

  return { root, dispatchedAt, acceptedAt };
}

function createCoordinatorWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'axc-recent-events-coord-'));
  tempDirs.add(root);
  const initializedAt = isoMinutesAgo(12);
  const resyncedAt = isoMinutesAgo(3);
  const childAcceptedAt = isoMinutesAgo(2);

  writeJson(join(root, 'agentxchain-multi.json'), {
    schema_version: '0.1',
    project: { id: 'coord-recent-events', name: 'Coordinator Recent Events' },
    repos: {
      app: { path: './repos/app', default_branch: 'main', required: true },
    },
    workstreams: {
      default: {
        phase: 'implementation',
        repos: ['app'],
        entry_repo: 'app',
        completion_barrier: 'all_repos_accepted',
      },
    },
    routing: {
      implementation: { entry_workstream: 'default' },
    },
    gates: {},
  });

  writeJson(join(root, '.agentxchain', 'multirepo', 'state.json'), {
    schema_version: '0.1',
    super_run_id: 'srun_recent_events_001',
    status: 'active',
    phase: 'implementation',
    repo_runs: {
      app: {
        status: 'active',
        run_id: 'run_app_001',
        phase: 'implementation',
        initialized_by_coordinator: true,
      },
    },
  });

  writeJsonl(join(root, '.agentxchain', 'multirepo', 'history.jsonl'), [
    {
      type: 'repo_initialized',
      repo_id: 'app',
      timestamp: initializedAt,
      message: 'Initialized app repo.',
    },
    {
      type: 'state_resynced',
      timestamp: resyncedAt,
      super_run_id: 'srun_recent_events_001',
      resynced_repos: ['app'],
      barrier_changes: [],
    },
  ]);

  writeJsonl(join(root, '.agentxchain', 'multirepo', 'decision-ledger.jsonl'), [
    {
      id: 'DEC-COORD-RECENT-001',
      statement: 'Track the app repo as active.',
      timestamp: '2026-04-15T20:11:05.000Z',
    },
  ]);

  writeJson(join(root, '.agentxchain', 'multirepo', 'barriers.json'), {});

  const childRoot = join(root, 'repos', 'app');
  writeJson(join(childRoot, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: 'child-app', name: 'Child App', default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement safely.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
    },
    runtimes: {
      'local-dev': {
        type: 'local_cli',
        command: ['echo', '{prompt}'],
        prompt_transport: 'argv',
      },
    },
    routing: {
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev'],
      },
    },
    budget: { per_run_max_usd: 10, per_turn_max_usd: 2 },
    gates: {},
    hooks: {},
  });

  writeJson(join(childRoot, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: 'child-app',
    run_id: 'run_app_001',
    status: 'active',
    phase: 'implementation',
    active_turns: {},
    retained_turns: {},
    turn_sequence: 1,
    blocked_on: null,
    blocked_reason: null,
    phase_gate_status: {},
    budget_status: {},
    protocol_mode: 'governed',
  });

  writeJsonl(join(childRoot, '.agentxchain', 'history.jsonl'), [
    { turn_id: 'turn_001', role: 'dev', status: 'completed', accepted_sequence: 1 },
  ]);

  writeJsonl(join(childRoot, '.agentxchain', 'decision-ledger.jsonl'), [
    { id: 'DEC-APP-001', role: 'dev', phase: 'implementation', statement: 'Child repo ready.' },
  ]);

  writeJsonl(join(childRoot, '.agentxchain', 'events.jsonl'), [
    {
      event_id: 'evt_child_001',
      event_type: 'turn_accepted',
      timestamp: childAcceptedAt,
      run_id: 'run_app_001',
      phase: 'implementation',
      status: 'active',
      turn: { turn_id: 'turn_001', role_id: 'dev' },
      payload: {},
    },
  ]);

  return { root, resyncedAt, childAcceptedAt };
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  tempDirs.clear();
});

describe('recent event operator surfaces', () => {
  it('AT-RES-003: governed status text and json expose the recent-event digest', () => {
    const { root, acceptedAt } = createGovernedProject();

    const text = runCli(root, ['status']);
    assert.equal(text.status, 0, `${text.stdout}\n${text.stderr}`);
    assert.match(text.stdout, /Recent events:\s+recent \(2 in last 15m\)/);
    assert.match(text.stdout, /Latest:\s+turn_accepted \[dev\]/);
    assert.match(text.stdout, new RegExp(`When:\\s+${acceptedAt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

    const json = runCli(root, ['status', '--json']);
    assert.equal(json.status, 0, `${json.stdout}\n${json.stderr}`);
    const payload = JSON.parse(json.stdout);
    assert.equal(payload.recent_event_summary.freshness, 'recent');
    assert.equal(payload.recent_event_summary.recent_count, 2);
    assert.equal(payload.recent_event_summary.latest_event.event_type, 'turn_accepted');
    assert.equal(payload.recent_event_summary.latest_event.summary, 'turn_accepted [dev]');
  });

  it('AT-RES-004: governed audit/report expose run-level recent-event digest in text and json', () => {
    const { root, acceptedAt } = createGovernedProject();

    const auditText = runCli(root, ['audit', '--format', 'text']);
    assert.equal(auditText.status, 0, `${auditText.stdout}\n${auditText.stderr}`);
    assert.match(auditText.stdout, /Recent events: recent \(2 in last 15m\)/);
    assert.match(auditText.stdout, new RegExp(`Latest event: turn_accepted \\[dev\\] at ${acceptedAt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

    const exportResult = runCli(root, ['export', '--output', 'recent-events-export.json']);
    assert.equal(exportResult.status, 0, `${exportResult.stdout}\n${exportResult.stderr}`);

    const reportJson = runCli(root, ['report', '--input', 'recent-events-export.json', '--format', 'json']);
    assert.equal(reportJson.status, 0, `${reportJson.stdout}\n${reportJson.stderr}`);
    const report = JSON.parse(reportJson.stdout);
    assert.equal(report.subject.run.recent_event_summary.freshness, 'recent');
    assert.equal(report.subject.run.recent_event_summary.recent_count, 2);
    assert.equal(report.subject.run.recent_event_summary.latest_event.summary, 'turn_accepted [dev]');
  });

  it('AT-RES-005: coordinator audit exposes separate coordinator and child-repo recent-event digests', () => {
    const { root, resyncedAt, childAcceptedAt } = createCoordinatorWorkspace();

    const json = runCli(root, ['audit', '--format', 'json']);
    assert.equal(json.status, 0, `${json.stdout}\n${json.stderr}`);
    const report = JSON.parse(json.stdout);
    assert.equal(report.subject.run.recent_coordinator_events.freshness, 'recent');
    assert.equal(report.subject.run.recent_coordinator_events.latest_event.summary, 'Resynced state for 1 repo, 0 barrier changes');
    assert.equal(report.subject.run.recent_child_repo_events.freshness, 'recent');
    assert.equal(report.subject.run.recent_child_repo_events.latest_event.summary, '[app] turn_accepted');

    const text = runCli(root, ['audit', '--format', 'text']);
    assert.equal(text.status, 0, `${text.stdout}\n${text.stderr}`);
    assert.match(text.stdout, /Recent coordinator events: recent \(2 in last 15m\)/);
    assert.match(text.stdout, new RegExp(`Latest coordinator event: Resynced state for 1 repo, 0 barrier changes at ${resyncedAt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(text.stdout, /Recent child repo events: recent \(1 in last 15m\)/);
    assert.match(text.stdout, new RegExp(`Latest child repo event: \\[app\\] turn_accepted at ${childAcceptedAt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  });
});
