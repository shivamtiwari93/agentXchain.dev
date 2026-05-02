import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

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
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
}

/** Export coordinator workspace to JSON, save to file, return path */
function exportToFile(cwd) {
  const result = runCli(cwd, ['export', '--format', 'json']);
  assert.equal(result.status, 0, `export failed: ${result.stderr}`);
  const artifactPath = join(cwd, '.agentxchain-export.json');
  writeFileSync(artifactPath, result.stdout);
  return artifactPath;
}

function createGovernedRepo(repoRoot, repoId) {
  mkdirSync(join(repoRoot, '.agentxchain', 'dispatch'), { recursive: true });

  writeJson(join(repoRoot, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: repoId, name: `Repo ${repoId}`, default_branch: 'main' },
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
    gates: {},
    hooks: {},
  });

  writeJson(join(repoRoot, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: repoId,
    run_id: `run_${repoId}_001`,
    status: 'active',
    phase: 'implementation',
    active_turns: {},
    retained_turns: {},
    turn_sequence: 0,
    blocked_on: null,
    phase_gate_status: {},
    budget_status: { spent_usd: 0, remaining_usd: 10 },
    protocol_mode: 'governed',
  });
}

/**
 * Create a coordinator workspace with child repos that have events.jsonl files.
 */
function createCoordinatorWithEvents() {
  const root = mkdtempSync(join(tmpdir(), 'axc-coord-evt-surf-'));
  const webRoot = join(root, 'repos', 'web');
  const apiRoot = join(root, 'repos', 'api');

  createGovernedRepo(webRoot, 'web-app');
  createGovernedRepo(apiRoot, 'api-svc');

  // Write events.jsonl for web repo
  writeJsonl(join(webRoot, '.agentxchain', 'events.jsonl'), [
    { event_id: 'evt_web_001', event_type: 'run_started', timestamp: '2026-04-15T05:00:00Z', run_id: 'run_web-app_001' },
    { event_id: 'evt_web_002', event_type: 'turn_dispatched', timestamp: '2026-04-15T05:01:00Z', run_id: 'run_web-app_001', role: 'dev' },
    { event_id: 'evt_web_003', event_type: 'turn_accepted', timestamp: '2026-04-15T05:02:00Z', run_id: 'run_web-app_001', role: 'dev' },
    { event_id: 'evt_web_004', event_type: 'run_completed', timestamp: '2026-04-15T05:03:00Z', run_id: 'run_web-app_001' },
  ]);

  // Write events.jsonl for api repo (interleaved timestamps)
  writeJsonl(join(apiRoot, '.agentxchain', 'events.jsonl'), [
    { event_id: 'evt_api_001', event_type: 'run_started', timestamp: '2026-04-15T05:00:30Z', run_id: 'run_api-svc_001' },
    { event_id: 'evt_api_002', event_type: 'turn_dispatched', timestamp: '2026-04-15T05:01:30Z', run_id: 'run_api-svc_001', role: 'dev' },
    { event_id: 'evt_api_003', event_type: 'turn_accepted', timestamp: '2026-04-15T05:02:30Z', run_id: 'run_api-svc_001', role: 'dev' },
    { event_id: 'evt_api_004', event_type: 'run_completed', timestamp: '2026-04-15T05:03:30Z', run_id: 'run_api-svc_001' },
  ]);

  // Write coordinator config
  writeJson(join(root, 'agentxchain-multi.json'), {
    schema_version: '0.1',
    project: { id: 'coord-evt-test', name: 'Coordinator Event Test' },
    repos: {
      web: { path: './repos/web', default_branch: 'main', required: true },
      api: { path: './repos/api', default_branch: 'main', required: true },
    },
    workstreams: {
      core: {
        phase: 'implementation',
        repos: ['web', 'api'],
        entry_repo: 'web',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
    },
    routing: { implementation: { entry_workstream: 'core' } },
    gates: {},
    hooks: {},
  });

  // Coordinator state
  writeJson(join(root, '.agentxchain', 'multirepo', 'state.json'), {
    schema_version: '0.1',
    super_run_id: 'srun_evt_test_001',
    project_id: 'coord-evt-test',
    status: 'active',
    phase: 'implementation',
    repo_runs: {
      web: { run_id: 'run_web-app_001', status: 'linked', phase: 'implementation' },
      api: { run_id: 'run_api-svc_001', status: 'linked', phase: 'implementation' },
    },
    pending_gate: null,
    phase_gate_status: {},
    created_at: '2026-04-15T05:00:00Z',
    updated_at: '2026-04-15T05:03:30Z',
  });

  writeJsonl(join(root, '.agentxchain', 'multirepo', 'history.jsonl'), [
    { type: 'run_initialized', super_run_id: 'srun_evt_test_001', timestamp: '2026-04-15T05:00:00Z' },
  ]);

  writeJson(join(root, '.agentxchain', 'multirepo', 'barriers.json'), {});
  writeJsonl(join(root, '.agentxchain', 'multirepo', 'decision-ledger.jsonl'), []);
  writeJsonl(join(root, '.agentxchain', 'multirepo', 'barrier-ledger.jsonl'), []);

  return root;
}

describe('coordinator event surfaces — export', () => {
  it('AT-COORD-EVT-001: coordinator export includes aggregated_events in summary', () => {
    const root = createCoordinatorWithEvents();
    try {
      const result = runCli(root, ['export', '--format', 'json']);
      assert.equal(result.status, 0, result.stderr);

      const exported = JSON.parse(result.stdout);
      assert.equal(exported.export_kind, 'agentxchain_coordinator_export');
      assert.ok(exported.summary.aggregated_events, 'aggregated_events should be present');
      assert.equal(exported.summary.aggregated_events.total_events, 8);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-COORD-EVT-002: aggregated events are sorted by timestamp ascending', () => {
    const root = createCoordinatorWithEvents();
    try {
      const result = runCli(root, ['export', '--format', 'json']);
      const exported = JSON.parse(result.stdout);
      const events = exported.summary.aggregated_events.events;

      for (let i = 1; i < events.length; i++) {
        assert.ok(
          new Date(events[i].timestamp).getTime() >= new Date(events[i - 1].timestamp).getTime(),
          `Event ${i} timestamp should be >= event ${i - 1}`
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-COORD-EVT-003: each event carries repo_id', () => {
    const root = createCoordinatorWithEvents();
    try {
      const result = runCli(root, ['export', '--format', 'json']);
      const exported = JSON.parse(result.stdout);
      const events = exported.summary.aggregated_events.events;

      for (const evt of events) {
        assert.ok(evt.repo_id, `Event ${evt.event_id} should have repo_id`);
        assert.ok(['web', 'api'].includes(evt.repo_id), `repo_id should be web or api, got ${evt.repo_id}`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-COORD-EVT-004: event_type_counts matches actual distribution', () => {
    const root = createCoordinatorWithEvents();
    try {
      const result = runCli(root, ['export', '--format', 'json']);
      const exported = JSON.parse(result.stdout);
      const counts = exported.summary.aggregated_events.event_type_counts;

      assert.equal(counts.run_started, 2);
      assert.equal(counts.turn_dispatched, 2);
      assert.equal(counts.turn_accepted, 2);
      assert.equal(counts.run_completed, 2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-COORD-EVT-005: repos_with_events lists only repos with events', () => {
    const root = createCoordinatorWithEvents();
    try {
      const result = runCli(root, ['export', '--format', 'json']);
      const exported = JSON.parse(result.stdout);
      const repos = exported.summary.aggregated_events.repos_with_events;

      assert.deepEqual(repos, ['api', 'web']); // sorted
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-COORD-EVT-006: missing events file is skipped without error', () => {
    const root = createCoordinatorWithEvents();
    try {
      // Delete api events file
      rmSync(join(root, 'repos', 'api', '.agentxchain', 'events.jsonl'));

      const result = runCli(root, ['export', '--format', 'json']);
      assert.equal(result.status, 0, result.stderr);

      const exported = JSON.parse(result.stdout);
      assert.equal(exported.summary.aggregated_events.total_events, 4); // only web
      assert.deepEqual(exported.summary.aggregated_events.repos_with_events, ['web']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('coordinator event surfaces — report text', () => {
  it('AT-COORD-EVT-007: text report includes Aggregated Child Repo Events section', () => {
    const root = createCoordinatorWithEvents();
    try {
      const artifactPath = exportToFile(root);
      const result = runCli(root, ['report', '--input', artifactPath, '--format', 'text']);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(result.stdout.includes('Aggregated Child Repo Events:'), 'should contain section header');
      assert.ok(result.stdout.includes('[web] run_started'), 'should contain web events');
      assert.ok(result.stdout.includes('[api] run_started'), 'should contain api events');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('coordinator event surfaces — report markdown', () => {
  it('AT-COORD-EVT-008: markdown report includes Aggregated Child Repo Events table', () => {
    const root = createCoordinatorWithEvents();
    try {
      const artifactPath = exportToFile(root);
      const result = runCli(root, ['report', '--input', artifactPath, '--format', 'markdown']);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(result.stdout.includes('## Aggregated Child Repo Events'), 'should contain markdown heading');
      assert.ok(result.stdout.includes('| Timestamp | Repo | Event Type | Summary |'), 'should contain table header');
      assert.ok(result.stdout.includes('`web`'), 'should contain web repo');
      assert.ok(result.stdout.includes('`api`'), 'should contain api repo');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('coordinator event surfaces — report html', () => {
  it('AT-COORD-EVT-009: HTML report includes aggregated events table with repo badges', () => {
    const root = createCoordinatorWithEvents();
    try {
      const artifactPath = exportToFile(root);
      const result = runCli(root, ['report', '--input', artifactPath, '--format', 'html']);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(result.stdout.includes('Aggregated Child Repo Events'), 'should contain section header');
      assert.ok(result.stdout.includes('web'), 'should contain web repo');
      assert.ok(result.stdout.includes('api'), 'should contain api repo');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('coordinator event surfaces — report json', () => {
  it('AT-COORD-EVT-010: JSON report subject includes aggregated_event_timeline', () => {
    const root = createCoordinatorWithEvents();
    try {
      const artifactPath = exportToFile(root);
      const result = runCli(root, ['report', '--input', artifactPath, '--format', 'json']);
      assert.equal(result.status, 0, result.stderr);

      const report = JSON.parse(result.stdout);
      assert.ok(Array.isArray(report.subject.aggregated_event_timeline), 'should have aggregated_event_timeline array');
      assert.equal(report.subject.aggregated_event_timeline.length, 8);

      const first = report.subject.aggregated_event_timeline[0];
      assert.ok(first.repo_id, 'each entry should have repo_id');
      assert.ok(first.type, 'each entry should have type');
      assert.ok(first.timestamp, 'each entry should have timestamp');
      assert.ok(first.summary, 'each entry should have summary');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('coordinator event surfaces — empty events', () => {
  it('AT-COORD-EVT-011: empty events renders "No child repo events" in text', () => {
    const root = createCoordinatorWithEvents();
    try {
      // Remove both events files
      rmSync(join(root, 'repos', 'web', '.agentxchain', 'events.jsonl'));
      rmSync(join(root, 'repos', 'api', '.agentxchain', 'events.jsonl'));

      const artifactPath = exportToFile(root);
      const result = runCli(root, ['report', '--input', artifactPath, '--format', 'text']);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(result.stdout.includes('No child repo events'), 'should show empty state');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
