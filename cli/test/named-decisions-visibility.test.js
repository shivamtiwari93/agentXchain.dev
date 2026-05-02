import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
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

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function createGovernedRepo(repoRoot, name, status) {
  writeJson(join(repoRoot, 'agentxchain.json'), {
    schema_version: '4',
    project: { id: name, name, goal: 'Test repo' },
    roles: { dev: { agent: 'manual', charter: 'dev' } },
    phases: ['implementation'],
    gates: {},
    hooks: {},
  });
  writeJson(join(repoRoot, '.agentxchain', 'state.json'), {
    schema_version: '4',
    run_id: `run_${name}_001`,
    status,
    phase: 'implementation',
    turn_number: 1,
    accepted_turn_history: [],
    retention: { turns_retained: 5 },
  });
  writeJsonl(join(repoRoot, '.agentxchain', 'history.jsonl'), [
    { turn_id: 'turn_001', role: 'dev', status: 'accepted', decisions: [{ id: 'DEC-101', statement: 'API contract defined.' }] },
  ]);
  writeJsonl(join(repoRoot, '.agentxchain', 'decision-ledger.jsonl'), [
    { id: 'DEC-101', statement: 'API contract defined.' },
  ]);
}

function createNamedDecisionsWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'axc-ndvis-'));
  createGovernedRepo(join(root, 'repos', 'api'), 'api-svc', 'linked');
  createGovernedRepo(join(root, 'repos', 'web'), 'web-app', 'linked');

  writeJson(join(root, 'agentxchain-multi.json'), {
    schema_version: '0.1',
    project: { id: 'ndvis-test', name: 'Named Decisions Visibility Test' },
    repos: {
      api: { path: './repos/api', default_branch: 'main', required: true },
      web: { path: './repos/web', default_branch: 'main', required: true },
    },
    workstreams: {
      sync: {
        phase: 'implementation',
        repos: ['api', 'web'],
        entry_repo: 'api',
        depends_on: [],
        completion_barrier: 'named_decisions',
        named_decisions: {
          decision_ids_by_repo: {
            api: ['DEC-101'],
            web: ['DEC-201', 'DEC-202'],
          },
        },
      },
    },
    routing: { implementation: { entry_workstream: 'sync' } },
    gates: {},
    hooks: {},
  });

  writeJson(join(root, '.agentxchain', 'multirepo', 'state.json'), {
    schema_version: '0.1',
    super_run_id: 'srun_ndvis_001',
    project_id: 'ndvis-test',
    status: 'active',
    phase: 'implementation',
    repo_runs: {
      api: { run_id: 'run_api_001', status: 'linked', phase: 'implementation' },
      web: { run_id: 'run_web_001', status: 'linked', phase: 'implementation' },
    },
    pending_gate: null,
    phase_gate_status: {},
    created_at: '2026-04-14T00:00:00Z',
    updated_at: '2026-04-14T00:00:00Z',
  });

  writeJson(join(root, '.agentxchain', 'multirepo', 'barriers.json'), {
    'barrier-ws-sync': {
      workstream_id: 'sync',
      type: 'named_decisions',
      status: 'partially_satisfied',
      required_repos: ['api', 'web'],
      satisfied_repos: ['api'],
      required_decision_ids_by_repo: {
        api: ['DEC-101'],
        web: ['DEC-201', 'DEC-202'],
      },
    },
  });

  writeJsonl(join(root, '.agentxchain', 'multirepo', 'history.jsonl'), [
    { type: 'run_initialized', super_run_id: 'srun_ndvis_001' },
  ]);
  writeJsonl(join(root, '.agentxchain', 'multirepo', 'decision-ledger.jsonl'), []);
  writeJsonl(join(root, '.agentxchain', 'multirepo', 'barrier-ledger.jsonl'), []);

  return root;
}

describe('Named decisions visibility in report', () => {
  it('AT-NDVIS-001: report JSON barrier entry includes required_decision_ids_by_repo and satisfied_decision_ids_by_repo', () => {
    const root = createNamedDecisionsWorkspace();
    try {
      const exportResult = runCli(root, ['export', '--output', 'artifact.json']);
      assert.equal(exportResult.status, 0, exportResult.stderr);

      const result = runCli(root, ['report', '--input', 'artifact.json', '--format', 'json']);
      assert.equal(result.status, 0, result.stderr);

      const report = JSON.parse(result.stdout);
      const barriers = report.subject.barrier_summary;
      assert.ok(Array.isArray(barriers), 'barrier_summary must be an array');
      assert.equal(barriers.length, 1);

      const b = barriers[0];
      assert.equal(b.barrier_id, 'barrier-ws-sync');
      assert.equal(b.type, 'named_decisions');
      assert.deepEqual(b.required_decision_ids_by_repo, {
        api: ['DEC-101'],
        web: ['DEC-201', 'DEC-202'],
      });
      assert.deepEqual(b.satisfied_decision_ids_by_repo, {
        api: ['DEC-101'],
        web: [],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-NDVIS-002: report text output renders per-repo decision breakdown', () => {
    const root = createNamedDecisionsWorkspace();
    try {
      const exportResult = runCli(root, ['export', '--output', 'artifact.json']);
      assert.equal(exportResult.status, 0, exportResult.stderr);

      const result = runCli(root, ['report', '--input', 'artifact.json', '--format', 'text']);
      assert.equal(result.status, 0, result.stderr);

      const output = result.stdout;
      assert.match(output, /Decision requirements:/);
      assert.match(output, /api: DEC-101 \(satisfied\)/);
      assert.match(output, /web: DEC-201 \(pending\), DEC-202 \(pending\)/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-NDVIS-003: report markdown output renders decision-requirements table', () => {
    const root = createNamedDecisionsWorkspace();
    try {
      const exportResult = runCli(root, ['export', '--output', 'artifact.json']);
      assert.equal(exportResult.status, 0, exportResult.stderr);

      const result = runCli(root, ['report', '--input', 'artifact.json', '--format', 'markdown']);
      assert.equal(result.status, 0, result.stderr);

      const output = result.stdout;
      assert.match(output, /### Decision Requirements/);
      assert.match(output, /\*\*`barrier-ws-sync`\*\* decision requirements:/);
      assert.match(output, /\| `api` \| `DEC-101` \| `DEC-101` \|/);
      assert.match(output, /\| `web` \| `DEC-201`, `DEC-202` \| — \|/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-NDVIS-005: barriers without decision requirements render unchanged', () => {
    const root = mkdtempSync(join(tmpdir(), 'axc-ndvis-noreg-'));
    try {
      createGovernedRepo(join(root, 'repos', 'web'), 'web-app', 'linked');
      createGovernedRepo(join(root, 'repos', 'cli'), 'cli-tool', 'linked');

      writeJson(join(root, 'agentxchain-multi.json'), {
        schema_version: '0.1',
        project: { id: 'noreg', name: 'No Regression' },
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
        routing: { implementation: { entry_workstream: 'sync' } },
        gates: {},
        hooks: {},
      });

      writeJson(join(root, '.agentxchain', 'multirepo', 'state.json'), {
        schema_version: '0.1',
        super_run_id: 'srun_noreg_001',
        project_id: 'noreg',
        status: 'active',
        phase: 'implementation',
        repo_runs: {
          web: { run_id: 'run_web_001', status: 'linked', phase: 'implementation' },
          cli: { run_id: 'run_cli_001', status: 'linked', phase: 'implementation' },
        },
        pending_gate: null,
        phase_gate_status: {},
        created_at: '2026-04-14T00:00:00Z',
        updated_at: '2026-04-14T00:00:00Z',
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
        { type: 'run_initialized', super_run_id: 'srun_noreg_001' },
      ]);
      writeJsonl(join(root, '.agentxchain', 'multirepo', 'decision-ledger.jsonl'), []);
      writeJsonl(join(root, '.agentxchain', 'multirepo', 'barrier-ledger.jsonl'), []);

      const exportResult = runCli(root, ['export', '--output', 'artifact.json']);
      assert.equal(exportResult.status, 0, exportResult.stderr);

      const jsonResult = runCli(root, ['report', '--input', 'artifact.json', '--format', 'json']);
      assert.equal(jsonResult.status, 0, jsonResult.stderr);
      const report = JSON.parse(jsonResult.stdout);
      const b = report.subject.barrier_summary[0];
      assert.equal(b.type, 'all_repos_accepted');
      assert.equal(b.required_decision_ids_by_repo, undefined, 'must not have decision IDs for non-decision barriers');

      const textResult = runCli(root, ['report', '--input', 'artifact.json', '--format', 'text']);
      assert.equal(textResult.status, 0, textResult.stderr);
      assert.ok(!textResult.stdout.includes('Decision requirements:'), 'text must not show decision detail for non-decision barriers');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('Named decisions visibility in dashboard', () => {
  it('AT-NDVIS-004: initiative view renders decision-ID detail for named_decisions barrier', () => {
    const initiativePath = join(__dirname, '..', 'dashboard', 'components', 'initiative.js');
    const source = readFileSync(initiativePath, 'utf8');

    assert.ok(source.includes('required_decision_ids_by_repo'), 'initiative must reference required_decision_ids_by_repo');
    assert.ok(source.includes('Decision Requirements'), 'initiative must render Decision Requirements label');
    assert.ok(source.includes('alignment_decision_ids'), 'initiative must fall back to alignment_decision_ids for legacy barriers');
  });

  it('AT-NDVIS-006: docs page documents the new fields', () => {
    const docsPath = join(__dirname, '..', '..', 'website-v2', 'docs', 'governance-report.mdx');
    const docs = readFileSync(docsPath, 'utf8');

    assert.ok(docs.includes('required_decision_ids_by_repo'), 'docs must document required_decision_ids_by_repo');
    assert.ok(docs.includes('satisfied_decision_ids_by_repo'), 'docs must document satisfied_decision_ids_by_repo');
    assert.ok(docs.includes('Decision Requirements'), 'docs must mention Decision Requirements section');
  });
});
