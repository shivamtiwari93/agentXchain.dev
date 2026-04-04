import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
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

function runCli(cwd, args, extra = {}) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
    ...extra,
  });
}

function createGovernedProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-verify-export-'));
  mkdirSync(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'staging', 'turn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'transactions', 'accept', 'txn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'intake', 'events'), { recursive: true });

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: 'verify-export', name: 'Verify Export', default_branch: 'main' },
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

  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: 'verify-export',
    run_id: 'run_verify_export_001',
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
      },
    },
    retained_turns: {},
    turn_sequence: 1,
    blocked_on: null,
    phase_gate_status: {},
    budget_status: { spent_usd: 0.4, remaining_usd: 9.6 },
    protocol_mode: 'governed',
  });

  writeJsonl(join(root, '.agentxchain', 'history.jsonl'), [
    { turn_id: 'turn_001', role: 'dev', status: 'running' },
  ]);
  writeJsonl(join(root, '.agentxchain', 'decision-ledger.jsonl'), [
    { id: 'DEC-001', statement: 'Ship verify export.' },
  ]);
  writeJsonl(join(root, '.agentxchain', 'hook-audit.jsonl'), [
    { phase: 'after_dispatch', hook: 'notify', verdict: 'allow' },
  ]);
  writeJsonl(join(root, '.agentxchain', 'hook-annotations.jsonl'), [
    { turn_id: 'turn_001', annotations: { note: 'captured' } },
  ]);
  writeJsonl(join(root, '.agentxchain', 'notification-audit.jsonl'), [
    { event_type: 'run_blocked', notification_name: 'ops_webhook', delivered: true },
  ]);
  writeJsonl(join(root, '.agentxchain', 'intake', 'events', 'events.jsonl'), [
    { event_id: 'evt_001', category: 'schedule' },
  ]);
  writeFileSync(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001', 'PROMPT.md'), '# Prompt\n');
  writeJson(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001', 'ASSIGNMENT.json'), {
    turn_id: 'turn_001',
    role: 'dev',
  });
  writeJson(join(root, '.agentxchain', 'staging', 'turn_001', 'turn-result.json'), {
    turn_id: 'turn_001',
    status: 'completed',
    objections: [],
  });
  writeJson(join(root, '.agentxchain', 'transactions', 'accept', 'txn_001', 'journal.json'), {
    turn_id: 'turn_001',
    action: 'accept',
  });

  return root;
}

function createGovernedRepo(repoRoot, repoId) {
  mkdirSync(join(repoRoot, '.agentxchain'), { recursive: true });
  writeJson(join(repoRoot, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: repoId, name: repoId, default_branch: 'main' },
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
    budget_status: {},
    protocol_mode: 'governed',
  });
  writeJsonl(join(repoRoot, '.agentxchain', 'history.jsonl'), [
    { turn_id: 'turn_000', role: 'dev', status: 'completed' },
  ]);
  writeJsonl(join(repoRoot, '.agentxchain', 'decision-ledger.jsonl'), [
    { id: 'DEC-001', statement: 'Repo ready.' },
  ]);
}

function createCoordinatorWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'axc-verify-export-coord-'));
  createGovernedRepo(join(root, 'repos', 'web'), 'web-app');
  createGovernedRepo(join(root, 'repos', 'cli'), 'cli-tool');

  writeJson(join(root, 'agentxchain-multi.json'), {
    schema_version: '0.1',
    project: { id: 'coord-verify', name: 'Coordinator Verify' },
    repos: {
      web: { path: './repos/web', default_branch: 'main', required: true },
      cli: { path: './repos/cli', default_branch: 'main', required: true },
    },
    workstreams: {
      sync: {
        phase: 'implementation',
        repos: ['web', 'cli'],
        entry_repo: 'web',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
    },
    routing: {
      implementation: { entry_workstream: 'sync' },
    },
    gates: {},
    hooks: {},
  });

  writeJson(join(root, '.agentxchain', 'multirepo', 'state.json'), {
    schema_version: '0.1',
    super_run_id: 'srun_coord_verify_001',
    project_id: 'coord-verify',
    status: 'active',
    phase: 'implementation',
    repo_runs: {
      web: { run_id: 'run_web_001', status: 'linked', phase: 'implementation' },
      cli: { run_id: 'run_cli_001', status: 'initialized', phase: 'implementation' },
    },
    pending_gate: null,
    phase_gate_status: {},
    created_at: '2026-04-03T00:00:00Z',
    updated_at: '2026-04-03T00:00:00Z',
  });
  writeJson(join(root, '.agentxchain', 'multirepo', 'barriers.json'), {
    barrier_001: {
      workstream_id: 'sync',
      type: 'all_repos_accepted',
      status: 'pending',
      required_repos: ['web', 'cli'],
      satisfied_repos: [],
    },
  });
  writeJsonl(join(root, '.agentxchain', 'multirepo', 'history.jsonl'), [
    { type: 'run_initialized', super_run_id: 'srun_coord_verify_001' },
  ]);
  writeJsonl(join(root, '.agentxchain', 'multirepo', 'decision-ledger.jsonl'), [
    { id: 'DEC-COORD-001', statement: 'Coordinator ready.' },
  ]);
  writeJsonl(join(root, '.agentxchain', 'multirepo', 'barrier-ledger.jsonl'), [
    { barrier_id: 'barrier_001', to: 'pending' },
  ]);

  return root;
}

function exportToFile(root, fileName = 'artifact.json') {
  const output = join(root, fileName);
  const result = runCli(root, ['export', '--output', fileName]);
  assert.equal(result.status, 0, result.stderr);
  return output;
}

describe('verify export CLI', () => {
  it('AT-VERIFY-EXPORT-001: verify export --help shows supported flags', () => {
    const result = runCli(process.cwd(), ['verify', 'export', '--help']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--input <path>/);
    assert.match(result.stdout, /--format <format>/);
  });

  it('AT-VERIFY-EXPORT-002: valid governed run export verifies successfully from a file', () => {
    const root = createGovernedProject();
    try {
      const artifactPath = exportToFile(root);
      const result = runCli(root, ['verify', 'export', '--input', artifactPath, '--format', 'json']);
      assert.equal(result.status, 0, result.stderr);

      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'pass');
      assert.equal(report.export_kind, 'agentxchain_run_export');
      assert.equal(report.schema_version, '0.2');
      assert.equal(report.file_count > 0, true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-VERIFY-EXPORT-003: valid coordinator export verifies successfully and recursively checks child exports', () => {
    const root = createCoordinatorWorkspace();
    try {
      const artifactPath = exportToFile(root, 'coordinator-export.json');
      const result = runCli(root, ['verify', 'export', '--input', artifactPath, '--format', 'json']);
      assert.equal(result.status, 0, result.stderr);

      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'pass');
      assert.equal(report.export_kind, 'agentxchain_coordinator_export');
      assert.equal(report.repo_count, 2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-VERIFY-EXPORT-004: tampering with content_base64 or sha256 fails verification', () => {
    const root = createGovernedProject();
    try {
      const artifactPath = exportToFile(root);
      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
      artifact.files['agentxchain.json'].content_base64 = Buffer.from('{"tampered":true}\n').toString('base64');
      writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n');

      const result = runCli(root, ['verify', 'export', '--input', artifactPath]);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /FAIL/);
      assert.match(result.stdout, /sha256 does not match content_base64|data does not match decoded JSON content/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-VERIFY-EXPORT-005: summary drift fails verification', () => {
    const root = createGovernedProject();
    try {
      const artifactPath = exportToFile(root);
      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
      artifact.summary.history_entries = 99;
      writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n');

      const result = runCli(root, ['verify', 'export', '--input', artifactPath, '--format', 'json']);
      assert.equal(result.status, 1);
      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'fail');
      assert.ok(report.errors.some((error) => error.includes('summary.history_entries')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-VERIFY-EXPORT-006: invalid JSON input exits with command error', () => {
    const root = mkdtempSync(join(tmpdir(), 'axc-verify-export-invalid-'));
    try {
      const artifactPath = join(root, 'bad-export.json');
      writeFileSync(artifactPath, '{not valid json\n');

      const result = runCli(root, ['verify', 'export', '--input', artifactPath, '--format', 'json']);
      assert.equal(result.status, 2);
      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'error');
      assert.match(report.message, /Invalid JSON export artifact/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-VERIFY-EXPORT-007: stdin input is supported', () => {
    const root = createGovernedProject();
    try {
      const exported = runCli(root, ['export', '--format', 'json']);
      assert.equal(exported.status, 0, exported.stderr);

      const result = runCli(root, ['verify', 'export', '--format', 'json'], {
        input: exported.stdout,
      });
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'pass');
      assert.equal(report.input, 'stdin');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
