import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  existsSync,
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

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
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

  writeJsonl(join(repoRoot, '.agentxchain', 'history.jsonl'), [
    { turn_id: 'turn_000', role: 'dev', status: 'completed' },
  ]);
  writeJsonl(join(repoRoot, '.agentxchain', 'decision-ledger.jsonl'), [
    { id: 'DEC-001', statement: 'Test decision.' },
  ]);
}

function createCoordinatorWorkspace(opts = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-coord-export-'));
  const webRoot = join(root, 'repos', 'web');
  const cliRoot = join(root, 'repos', 'cli');

  // Create child repos unless opts.skipChildRepos
  if (!opts.skipChildRepos) {
    createGovernedRepo(webRoot, 'web-app');
    createGovernedRepo(cliRoot, 'cli-tool');
  }

  // Create one broken child repo if requested
  if (opts.brokenChild) {
    mkdirSync(join(root, 'repos', 'broken'), { recursive: true });
    // No agentxchain.json — will fail governed export detection
  }

  // Write coordinator config
  const repos = {
    web: { path: './repos/web', default_branch: 'main', required: true },
    cli: { path: './repos/cli', default_branch: 'main', required: true },
  };
  if (opts.brokenChild) {
    repos.broken = { path: './repos/broken', default_branch: 'main', required: false };
  }

  writeJson(join(root, 'agentxchain-multi.json'), {
    schema_version: '0.1',
    project: { id: 'coord-test', name: 'Coordinator Test' },
    repos,
    workstreams: {
      core_sync: {
        phase: 'implementation',
        repos: ['web', 'cli'],
        entry_repo: 'web',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
    },
    routing: {
      implementation: { entry_workstream: 'core_sync' },
    },
    gates: {
      ship_gate: { requires_human_approval: true, requires_repos: ['web', 'cli'] },
    },
    hooks: {},
  });

  // Create coordinator state if not pre-init
  if (!opts.preInit) {
    writeJson(join(root, '.agentxchain', 'multirepo', 'state.json'), {
      schema_version: '0.1',
      super_run_id: 'srun_test_001',
      project_id: 'coord-test',
      status: 'active',
      phase: 'implementation',
      repo_runs: {
        web: { run_id: 'run_web-app_001', status: 'linked', phase: 'implementation' },
        cli: { run_id: 'run_cli-tool_001', status: 'initialized', phase: 'implementation' },
      },
      pending_gate: null,
      phase_gate_status: {},
      created_at: '2026-04-01T00:00:00Z',
      updated_at: '2026-04-01T00:00:00Z',
    });

    writeJson(join(root, '.agentxchain', 'multirepo', 'barriers.json'), {
      'barrier-001': {
        workstream_id: 'core_sync',
        type: 'all_repos_accepted',
        status: 'pending',
        required_repos: ['web', 'cli'],
        satisfied_repos: [],
        created_at: '2026-04-01T00:00:00Z',
      },
    });

    writeJsonl(join(root, '.agentxchain', 'multirepo', 'history.jsonl'), [
      { type: 'run_initialized', super_run_id: 'srun_test_001', ts: '2026-04-01T00:00:00Z' },
      { type: 'turn_dispatched', repo_id: 'web', turn_id: 'turn_001', ts: '2026-04-01T00:01:00Z' },
      { type: 'acceptance_projection', repo_id: 'web', turn_id: 'turn_001', ts: '2026-04-01T00:02:00Z' },
    ]);

    writeJsonl(join(root, '.agentxchain', 'multirepo', 'decision-ledger.jsonl'), [
      { id: 'DEC-COORD-001', statement: 'Initialize coordinator.' },
      { id: 'DEC-COORD-002', statement: 'Dispatch to web first.' },
    ]);

    writeJsonl(join(root, '.agentxchain', 'multirepo', 'barrier-ledger.jsonl'), [
      { barrier_id: 'barrier-001', from: null, to: 'pending', ts: '2026-04-01T00:00:00Z' },
    ]);
  }

  return root;
}

describe('coordinator export CLI', () => {
  it('AT-COORD-EXPORT-001: export from coordinator workspace produces coordinator export kind', () => {
    const root = createCoordinatorWorkspace();
    try {
      const result = runCli(root, ['export', '--format', 'json']);
      assert.equal(result.status, 0, result.stderr);

      const exported = JSON.parse(result.stdout);
      assert.equal(exported.export_kind, 'agentxchain_coordinator_export');
      assert.equal(exported.schema_version, '0.1');
      assert.equal(exported.coordinator.project_id, 'coord-test');
      assert.equal(exported.coordinator.project_name, 'Coordinator Test');
      assert.equal(exported.coordinator.repo_count, 2);
      assert.equal(exported.coordinator.workstream_count, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-COORD-EXPORT-002: coordinator files are included with correct format and data', () => {
    const root = createCoordinatorWorkspace();
    try {
      const result = runCli(root, ['export']);
      assert.equal(result.status, 0, result.stderr);

      const exported = JSON.parse(result.stdout);

      // Config file
      assert.equal(exported.files['agentxchain-multi.json'].format, 'json');
      assert.equal(exported.files['agentxchain-multi.json'].data.project.id, 'coord-test');

      // State file
      assert.equal(exported.files['.agentxchain/multirepo/state.json'].format, 'json');
      assert.equal(
        exported.files['.agentxchain/multirepo/state.json'].data.super_run_id,
        'srun_test_001',
      );

      // History JSONL
      assert.equal(exported.files['.agentxchain/multirepo/history.jsonl'].format, 'jsonl');
      assert.equal(exported.files['.agentxchain/multirepo/history.jsonl'].data.length, 3);

      // Barriers
      assert.equal(exported.files['.agentxchain/multirepo/barriers.json'].format, 'json');
      assert.ok(exported.files['.agentxchain/multirepo/barriers.json'].data['barrier-001']);

      // Decision ledger
      assert.equal(exported.files['.agentxchain/multirepo/decision-ledger.jsonl'].format, 'jsonl');
      assert.equal(exported.files['.agentxchain/multirepo/decision-ledger.jsonl'].data.length, 2);

      // Barrier ledger
      assert.equal(exported.files['.agentxchain/multirepo/barrier-ledger.jsonl'].format, 'jsonl');

      // All files have sha256
      for (const [, file] of Object.entries(exported.files)) {
        assert.ok(file.sha256, 'every file must have a sha256 hash');
        assert.ok(typeof file.bytes === 'number', 'every file must have a byte count');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-COORD-EXPORT-003: child repo exports are recursively embedded under repos', () => {
    const root = createCoordinatorWorkspace();
    try {
      const result = runCli(root, ['export']);
      assert.equal(result.status, 0, result.stderr);

      const exported = JSON.parse(result.stdout);

      // Both repos should be embedded
      assert.ok(exported.repos.web, 'web repo must be present');
      assert.ok(exported.repos.cli, 'cli repo must be present');

      // web repo should be a full governed export
      assert.equal(exported.repos.web.ok, true);
      assert.equal(exported.repos.web.path, './repos/web');
      assert.equal(exported.repos.web.export.export_kind, 'agentxchain_run_export');
      assert.equal(exported.repos.web.export.project.id, 'web-app');
      assert.ok(exported.repos.web.export.files['agentxchain.json']);
      assert.ok(exported.repos.web.export.files['.agentxchain/state.json']);

      // cli repo should be a full governed export
      assert.equal(exported.repos.cli.ok, true);
      assert.equal(exported.repos.cli.path, './repos/cli');
      assert.equal(exported.repos.cli.export.export_kind, 'agentxchain_run_export');
      assert.equal(exported.repos.cli.export.project.id, 'cli-tool');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-COORD-EXPORT-004: child repo failure does not fail coordinator export', () => {
    const root = createCoordinatorWorkspace({ brokenChild: true });
    try {
      const result = runCli(root, ['export']);
      assert.equal(result.status, 0, result.stderr);

      const exported = JSON.parse(result.stdout);
      assert.equal(exported.export_kind, 'agentxchain_coordinator_export');

      // Good repos still succeed
      assert.equal(exported.repos.web.ok, true);
      assert.equal(exported.repos.cli.ok, true);

      // Broken repo fails gracefully
      assert.equal(exported.repos.broken.ok, false);
      assert.equal(exported.repos.broken.path, './repos/broken');
      assert.ok(exported.repos.broken.error, 'broken repo must have an error message');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-COORD-EXPORT-005: pre-init coordinator exports with null summary fields', () => {
    const root = createCoordinatorWorkspace({ preInit: true });
    try {
      const result = runCli(root, ['export']);
      assert.equal(result.status, 0, result.stderr);

      const exported = JSON.parse(result.stdout);
      assert.equal(exported.export_kind, 'agentxchain_coordinator_export');
      assert.equal(exported.summary.super_run_id, null);
      assert.equal(exported.summary.status, null);
      assert.equal(exported.summary.phase, null);
      assert.deepEqual(exported.summary.repo_run_statuses, {});
      assert.equal(exported.summary.barrier_count, 0);
      assert.equal(exported.summary.history_entries, 0);
      assert.equal(exported.summary.decision_entries, 0);

      // Config file still present
      assert.ok(exported.files['agentxchain-multi.json']);

      // No multirepo state files
      assert.equal(exported.files['.agentxchain/multirepo/state.json'], undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-COORD-EXPORT-006: --output writes coordinator export to file', () => {
    const root = createCoordinatorWorkspace();
    try {
      const outputRel = 'artifacts/coordinator-export.json';
      const result = runCli(root, ['export', '--output', outputRel]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /coordinator workspace/);

      const outputPath = join(root, outputRel);
      assert.ok(existsSync(outputPath));

      const exported = JSON.parse(readFileSync(outputPath, 'utf8'));
      assert.equal(exported.export_kind, 'agentxchain_coordinator_export');
      assert.equal(exported.coordinator.project_id, 'coord-test');
      assert.ok(exported.repos.web.ok);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-COORD-EXPORT-007: summary includes correct repo_run_statuses, barrier_count, history/decision counts', () => {
    const root = createCoordinatorWorkspace();
    try {
      const result = runCli(root, ['export']);
      assert.equal(result.status, 0, result.stderr);

      const exported = JSON.parse(result.stdout);
      assert.deepEqual(exported.summary.repo_run_statuses, {
        web: 'linked',
        cli: 'initialized',
      });
      assert.equal(exported.summary.barrier_count, 1);
      assert.equal(exported.summary.history_entries, 3);
      assert.equal(exported.summary.decision_entries, 2);
      assert.equal(exported.summary.super_run_id, 'srun_test_001');
      assert.equal(exported.summary.status, 'active');
      assert.equal(exported.summary.phase, 'implementation');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-COORD-EXPORT-008: governed project root still produces governed export (detection priority)', () => {
    // Create a dir that has BOTH agentxchain.json and agentxchain-multi.json
    const root = mkdtempSync(join(tmpdir(), 'axc-dual-export-'));
    try {
      writeJson(join(root, 'agentxchain.json'), {
        schema_version: '1.0',
        template: 'generic',
        project: { id: 'dual-test', name: 'Dual Test', default_branch: 'main' },
        roles: {
          dev: {
            title: 'Dev',
            mandate: 'Build.',
            write_authority: 'authoritative',
            runtime: 'local-dev',
          },
        },
        runtimes: {
          'local-dev': { type: 'local_cli', command: ['echo', '{prompt}'], prompt_transport: 'argv' },
        },
        routing: { implementation: { entry_role: 'dev', allowed_next_roles: ['dev'] } },
        gates: {},
        hooks: {},
      });
      writeJson(join(root, '.agentxchain', 'state.json'), {
        schema_version: '1.1',
        project_id: 'dual-test',
        run_id: 'run_dual_001',
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
      writeJson(join(root, 'agentxchain-multi.json'), {
        schema_version: '0.1',
        project: { id: 'coord', name: 'Coord' },
        repos: {},
        workstreams: {},
      });

      const result = runCli(root, ['export']);
      assert.equal(result.status, 0, result.stderr);

      const exported = JSON.parse(result.stdout);
      // Governed takes priority
      assert.equal(exported.export_kind, 'agentxchain_run_export');
      assert.equal(exported.project.id, 'dual-test');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
