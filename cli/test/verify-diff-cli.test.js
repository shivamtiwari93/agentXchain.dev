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
  const root = mkdtempSync(join(tmpdir(), 'axc-verify-diff-'));
  mkdirSync(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'staging', 'turn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'transactions', 'accept', 'txn_001'), { recursive: true });

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: 'verify-diff', name: 'Verify Diff', default_branch: 'main' },
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
    project_id: 'verify-diff',
    run_id: 'run_verify_diff_001',
    status: 'completed',
    phase: 'implementation',
    active_turns: {},
    retained_turns: {},
    turn_sequence: 1,
    blocked_on: null,
    phase_gate_status: { planning_signoff: 'passed' },
    budget_status: { spent_usd: 0.4, remaining_usd: 9.6, warn_mode: false, exhausted: false },
    protocol_mode: 'governed',
  });

  writeJsonl(join(root, '.agentxchain', 'history.jsonl'), [
    {
      turn_id: 'turn_001',
      role: 'dev',
      runtime_id: 'local-dev',
      status: 'completed',
      accepted_at: '2026-04-15T00:00:00.000Z',
      summary: 'Implemented the baseline flow.',
      verification: { status: 'passed', machine_evidence: [] },
    },
  ]);
  writeJsonl(join(root, '.agentxchain', 'decision-ledger.jsonl'), [
    { id: 'DEC-100', statement: 'Ship baseline flow.', role: 'dev' },
  ]);
  writeJsonl(join(root, '.agentxchain', 'hook-audit.jsonl'), []);
  writeJsonl(join(root, '.agentxchain', 'hook-annotations.jsonl'), []);
  writeJsonl(join(root, '.agentxchain', 'notification-audit.jsonl'), []);
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

function createGovernedRepo(repoRoot, repoId, status = 'completed') {
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
    status,
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

function createCompletedCoordinatorWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'axc-verify-diff-coord-'));
  createGovernedRepo(join(root, 'repos', 'web'), 'web-app', 'completed');
  createGovernedRepo(join(root, 'repos', 'api'), 'api-service', 'completed');

  writeJson(join(root, 'agentxchain-multi.json'), {
    schema_version: '0.1',
    project: { id: 'coord-verify-diff', name: 'Coordinator Verify Diff' },
    repos: {
      web: { path: './repos/web', default_branch: 'main', required: true },
      api: { path: './repos/api', default_branch: 'main', required: true },
    },
    workstreams: {
      sync: {
        phase: 'implementation',
        repos: ['web', 'api'],
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

  mkdirSync(join(root, '.agentxchain', 'multirepo'), { recursive: true });
  writeJson(join(root, '.agentxchain', 'multirepo', 'state.json'), {
    schema_version: '0.1',
    super_run_id: 'srun_verify_diff_001',
    project_id: 'coord-verify-diff',
    status: 'completed',
    phase: 'implementation',
    repo_runs: {
      web: { run_id: 'run_web-app_001', status: 'completed', phase: 'implementation' },
      api: { run_id: 'run_api-service_001', status: 'completed', phase: 'implementation' },
    },
    pending_gate: null,
    phase_gate_status: {},
    created_at: '2026-04-15T00:00:00Z',
    updated_at: '2026-04-15T00:00:00Z',
  });
  writeJson(join(root, '.agentxchain', 'multirepo', 'barriers.json'), {});
  writeJsonl(join(root, '.agentxchain', 'multirepo', 'history.jsonl'), [
    { type: 'run_completed', super_run_id: 'srun_verify_diff_001', timestamp: '2026-04-15T00:00:00Z' },
  ]);
  writeJsonl(join(root, '.agentxchain', 'multirepo', 'decision-ledger.jsonl'), [
    { id: 'DEC-COORD-001', statement: 'Coordinator completed.' },
  ]);
  writeJsonl(join(root, '.agentxchain', 'multirepo', 'barrier-ledger.jsonl'), []);

  return root;
}

function exportArtifact(cwd, outputName) {
  const outputPath = join(cwd, outputName);
  const result = runCli(cwd, ['export', '--output', outputPath]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return outputPath;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('verify diff CLI', () => {
  it('AT-VERIFY-DIFF-001: verify diff --help shows supported flags', () => {
    const result = runCli(process.cwd(), ['verify', 'diff', '--help']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /verify diff \[options\] <left_export> <right_export>/);
    assert.match(result.stdout, /--format <format>/);
  });

  it('AT-VERIFY-DIFF-002: identical verified exports pass with no regressions', () => {
    const root = createGovernedProject();
    try {
      const left = exportArtifact(root, 'left.json');
      const right = exportArtifact(root, 'right.json');
      const result = runCli(root, ['verify', 'diff', left, right, '--format', 'json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.overall, 'pass');
      assert.equal(parsed.left.overall, 'pass');
      assert.equal(parsed.right.overall, 'pass');
      assert.ok(parsed.diff);
      assert.equal(parsed.diff.has_regressions, false);
      assert.equal(parsed.diff.regression_count, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-VERIFY-DIFF-003: verified exports with governance regressions fail and report them', () => {
    const root = createGovernedProject();
    try {
      const left = exportArtifact(root, 'left.json');

      writeJson(join(root, '.agentxchain', 'state.json'), {
        ...readJson(join(root, '.agentxchain', 'state.json')),
        status: 'failed',
        phase_gate_status: { planning_signoff: 'failed' },
        budget_status: { spent_usd: 12, remaining_usd: 0, warn_mode: true, exhausted: true },
      });
      const right = exportArtifact(root, 'right.json');

      const text = runCli(root, ['verify', 'diff', left, right]);
      assert.equal(text.status, 1, text.stderr || text.stdout);
      assert.match(text.stdout, /Governance Regressions/i);
      assert.match(text.stdout, /REG-STATUS/i);

      const json = runCli(root, ['verify', 'diff', left, right, '--format', 'json']);
      assert.equal(json.status, 1, json.stderr || json.stdout);
      const parsed = JSON.parse(json.stdout);
      assert.equal(parsed.overall, 'fail');
      assert.equal(parsed.left.overall, 'pass');
      assert.equal(parsed.right.overall, 'pass');
      assert.ok(parsed.diff.has_regressions);
      assert.ok(parsed.diff.regressions.some((entry) => entry.category === 'status'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-VERIFY-DIFF-004: failed export verification skips diff construction', () => {
    const root = createGovernedProject();
    try {
      const left = exportArtifact(root, 'left.json');
      const right = exportArtifact(root, 'right.json');

      const tampered = readJson(right);
      tampered.summary.status = 'failed';
      writeJson(right, tampered);

      const result = runCli(root, ['verify', 'diff', left, right, '--format', 'json']);
      assert.equal(result.status, 1, result.stderr || result.stdout);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.overall, 'fail');
      assert.equal(parsed.left.overall, 'pass');
      assert.equal(parsed.right.overall, 'fail');
      assert.equal(parsed.diff, null);
      assert.match(parsed.message, /skipped because one or both exports failed verification/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-VERIFY-DIFF-005: mismatched export kinds return command error', () => {
    const root = createGovernedProject();
    try {
      const left = exportArtifact(root, 'left.json');
      const right = exportArtifact(root, 'right.json');
      const tampered = readJson(right);
      tampered.export_kind = 'agentxchain_coordinator_export';
      writeJson(right, tampered);

      const result = runCli(root, ['verify', 'diff', left, right, '--format', 'json']);
      assert.equal(result.status, 2, result.stderr || result.stdout);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.overall, 'error');
      assert.match(parsed.message, /Export kinds do not match/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-VERIFY-DIFF-006: completed coordinator child drift passes because the comparison is terminal observability', () => {
    const root = createCompletedCoordinatorWorkspace();
    try {
      const left = exportArtifact(root, 'left.json');

      writeJson(join(root, '.agentxchain', 'multirepo', 'state.json'), {
        schema_version: '0.1',
        super_run_id: 'srun_verify_diff_001',
        project_id: 'coord-verify-diff',
        status: 'completed',
        phase: 'implementation',
        repo_runs: {
          web: { run_id: 'run_web-app_001', status: 'completed', phase: 'implementation' },
          api: { run_id: 'run_api-service_001', status: 'failed', phase: 'implementation' },
        },
        pending_gate: null,
        phase_gate_status: {},
        created_at: '2026-04-15T00:00:00Z',
        updated_at: '2026-04-15T00:05:00Z',
      });
      writeJson(join(root, 'repos', 'api', '.agentxchain', 'state.json'), {
        schema_version: '1.1',
        project_id: 'api-service',
        run_id: 'run_api-service_001',
        status: 'failed',
        phase: 'implementation',
        active_turns: {},
        retained_turns: {},
        turn_sequence: 0,
        blocked_on: null,
        phase_gate_status: {},
        budget_status: {},
        protocol_mode: 'governed',
      });

      const right = exportArtifact(root, 'right.json');
      const result = runCli(root, ['verify', 'diff', left, right, '--format', 'json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.overall, 'pass');
      assert.ok(parsed.diff, 'diff should still be constructed');
      assert.equal(parsed.diff.subject_kind, 'coordinator');
      assert.equal(parsed.diff.repo_status_changes.some((entry) => entry.key === 'api' && entry.changed), true);
      assert.equal(parsed.diff.has_regressions, false);
      assert.equal(parsed.diff.regressions.some((entry) => entry.category === 'repo_status'), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-VERIFY-DIFF-007: stale coordinator summary status alone does not create repo-status drift or regression', () => {
    const root = createCompletedCoordinatorWorkspace();
    try {
      writeJson(join(root, '.agentxchain', 'multirepo', 'state.json'), {
        schema_version: '0.1',
        super_run_id: 'srun_verify_diff_001',
        project_id: 'coord-verify-diff',
        status: 'active',
        phase: 'implementation',
        repo_runs: {
          web: { run_id: 'run_web-app_001', status: 'completed', phase: 'implementation' },
          api: { run_id: 'run_api-service_001', status: 'completed', phase: 'implementation' },
        },
        pending_gate: null,
        phase_gate_status: {},
        created_at: '2026-04-15T00:00:00Z',
        updated_at: '2026-04-15T00:00:00Z',
      });
      const left = exportArtifact(root, 'left.json');

      writeJson(join(root, '.agentxchain', 'multirepo', 'state.json'), {
        schema_version: '0.1',
        super_run_id: 'srun_verify_diff_001',
        project_id: 'coord-verify-diff',
        status: 'active',
        phase: 'implementation',
        repo_runs: {
          web: { run_id: 'run_web-app_001', status: 'completed', phase: 'implementation' },
          api: { run_id: 'run_api-service_001', status: 'failed', phase: 'implementation' },
        },
        pending_gate: null,
        phase_gate_status: {},
        created_at: '2026-04-15T00:00:00Z',
        updated_at: '2026-04-15T00:05:00Z',
      });

      const right = exportArtifact(root, 'right.json');
      const result = runCli(root, ['verify', 'diff', left, right, '--format', 'json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.overall, 'pass');
      assert.ok(parsed.diff, 'diff should still be constructed');
      assert.equal(parsed.diff.subject_kind, 'coordinator');
      assert.equal(parsed.diff.left.repo_statuses.api, 'completed');
      assert.equal(parsed.diff.right.repo_statuses.api, 'completed');
      assert.equal(parsed.diff.right.coordinator_repo_statuses.api, 'failed');
      assert.equal(parsed.diff.repo_status_changes.some((entry) => entry.key === 'api' && entry.changed), false);
      assert.equal(parsed.diff.regressions.some((entry) => entry.category === 'repo_status'), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
