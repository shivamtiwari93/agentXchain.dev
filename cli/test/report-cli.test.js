import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
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
  const root = mkdtempSync(join(tmpdir(), 'axc-report-cli-'));
  mkdirSync(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'staging', 'turn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'transactions', 'accept', 'txn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'intake', 'events'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'multirepo'), { recursive: true });

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: 'report-test', name: 'Report Test', default_branch: 'main' },
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
    project_id: 'report-test',
    run_id: 'run_report_001',
    status: 'blocked',
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
    retained_turns: {
      turn_000: {
        turn_id: 'turn_000',
        assigned_role: 'qa',
        status: 'failed',
        attempt: 1,
        runtime_id: 'local-dev',
      },
    },
    turn_sequence: 1,
    blocked_on: 'escalation:operator:dev',
    blocked_reason: {
      category: 'operator_escalation',
      blocked_at: '2026-04-03T00:00:00.000Z',
      turn_id: 'turn_001',
      recovery: {
        typed_reason: 'operator_escalation',
        owner: 'human',
        recovery_action: 'agentxchain step --resume',
        turn_retained: true,
        detail: 'Operator halted the run for review.',
      },
    },
    phase_gate_status: {},
    budget_status: { spent_usd: 1.2, remaining_usd: 8.8 },
    protocol_mode: 'governed',
  });

  writeJsonl(join(root, '.agentxchain', 'history.jsonl'), [
    { turn_id: 'turn_000', role: 'qa', status: 'failed' },
    { turn_id: 'turn_001', role: 'dev', status: 'running' },
  ]);
  writeJsonl(join(root, '.agentxchain', 'decision-ledger.jsonl'), [
    { id: 'DEC-001', statement: 'Ship report command.' },
  ]);
  writeJsonl(join(root, '.agentxchain', 'hook-audit.jsonl'), [
    { phase: 'after_dispatch', hook: 'notify', verdict: 'allow' },
  ]);
  writeJsonl(join(root, '.agentxchain', 'notification-audit.jsonl'), [
    { event_type: 'run_blocked', notification_name: 'ops_webhook', delivered: true },
  ]);
  writeJsonl(join(root, '.agentxchain', 'intake', 'events', 'events.jsonl'), [
    { event_id: 'evt_001', category: 'schedule' },
  ]);
  writeFileSync(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001', 'PROMPT.md'), '# Prompt for turn_001\n');
  writeJson(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001', 'ASSIGNMENT.json'), {
    turn_id: 'turn_001',
    role: 'dev',
  });
  writeJson(join(root, '.agentxchain', 'staging', 'turn_001', 'turn-result.json'), {
    turn_id: 'turn_001',
    status: 'completed',
  });
  writeJson(join(root, '.agentxchain', 'transactions', 'accept', 'txn_001', 'journal.json'), {
    turn_id: 'turn_001',
    action: 'accept',
  });
  writeJson(join(root, '.agentxchain', 'multirepo', 'state.json'), {
    super_run_id: 'srun_001',
    status: 'active',
  });

  return root;
}

function createGovernedRepo(repoRoot, repoId, status) {
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
  const root = mkdtempSync(join(tmpdir(), 'axc-report-cli-coord-'));
  createGovernedRepo(join(root, 'repos', 'web'), 'web-app', 'linked');
  createGovernedRepo(join(root, 'repos', 'cli'), 'cli-tool', 'initialized');

  writeJson(join(root, 'agentxchain-multi.json'), {
    schema_version: '0.1',
    project: { id: 'coord-report', name: 'Coordinator Report' },
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
    super_run_id: 'srun_coord_report_001',
    project_id: 'coord-report',
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
    { type: 'run_initialized', super_run_id: 'srun_coord_report_001' },
  ]);
  writeJsonl(join(root, '.agentxchain', 'multirepo', 'decision-ledger.jsonl'), [
    { id: 'DEC-COORD-001', statement: 'Coordinator ready.' },
  ]);
  writeJsonl(join(root, '.agentxchain', 'multirepo', 'barrier-ledger.jsonl'), [
    { barrier_id: 'barrier_001', to: 'pending' },
  ]);

  return root;
}

function exportArtifact(root, fileName = 'artifact.json') {
  const result = runCli(root, ['export', '--output', fileName]);
  assert.equal(result.status, 0, result.stderr);
  return join(root, fileName);
}

describe('report CLI', () => {
  it('AT-REPORT-001: report --help shows supported flags and formats', () => {
    const result = runCli(process.cwd(), ['report', '--help']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--input <path>/);
    assert.match(result.stdout, /--format <format>/);
    assert.match(result.stdout, /text, json, or markdown/i);
  });

  it('AT-REPORT-002/004: governed export produces text and JSON report surfaces', () => {
    const root = createGovernedProject();
    try {
      const artifactPath = exportArtifact(root);

      const textResult = runCli(root, ['report', '--input', artifactPath]);
      assert.equal(textResult.status, 0, textResult.stderr);
      assert.match(textResult.stdout, /AgentXchain Governance Report/);
      assert.match(textResult.stdout, /Verification: PASS/);
      assert.match(textResult.stdout, /Project: Report Test \(report-test\)/);
      assert.match(textResult.stdout, /Status: blocked/);
      assert.match(textResult.stdout, /Blocked on: operator_escalation/);
      assert.match(textResult.stdout, /Active turns: 1 \(turn_001\)/);
      assert.match(textResult.stdout, /Retained turns: 1 \(turn_000\)/);
      assert.match(textResult.stdout, /Budget: spent \$1\.20, remaining \$8\.80/);

      const jsonResult = runCli(root, ['report', '--input', artifactPath, '--format', 'json']);
      assert.equal(jsonResult.status, 0, jsonResult.stderr);
      const report = JSON.parse(jsonResult.stdout);
      assert.equal(report.report_version, '0.1');
      assert.equal(report.overall, 'pass');
      assert.equal(report.export_kind, 'agentxchain_run_export');
      assert.equal(report.verification.overall, 'pass');
      assert.equal(report.subject.kind, 'governed_run');
      assert.equal(report.subject.project.id, 'report-test');
      assert.equal(report.subject.run.active_turn_count, 1);
      assert.deepEqual(report.subject.run.active_roles, ['dev']);
      assert.equal(report.subject.artifacts.notification_audit_entries, 1);
      assert.equal(report.subject.artifacts.intake_present, true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-REPORT-003: markdown output is paste-ready and supports stdin', () => {
    const root = createGovernedProject();
    try {
      const rawArtifact = runCli(root, ['export']);
      assert.equal(rawArtifact.status, 0, rawArtifact.stderr);

      const result = runCli(root, ['report', '--format', 'markdown'], { input: rawArtifact.stdout });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /^# AgentXchain Governance Report/m);
      assert.match(result.stdout, /- Verification: `pass`/);
      assert.match(result.stdout, /- Project: Report Test \(`report-test`\)/);
      assert.match(result.stdout, /- Active roles: `dev`/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-REPORT-005: coordinator export produces repo and barrier summary', () => {
    const root = createCoordinatorWorkspace();
    try {
      const artifactPath = exportArtifact(root);
      const result = runCli(root, ['report', '--input', artifactPath, '--format', 'json']);
      assert.equal(result.status, 0, result.stderr);

      const report = JSON.parse(result.stdout);
      assert.equal(report.subject.kind, 'coordinator_workspace');
      assert.equal(report.subject.coordinator.repo_count, 2);
      assert.equal(report.subject.coordinator.workstream_count, 1);
      assert.equal(report.subject.run.barrier_count, 1);
      assert.deepEqual(report.subject.run.repo_status_counts, {
        initialized: 1,
        linked: 1,
      });
      assert.equal(report.subject.run.repo_ok_count, 2);
      assert.equal(report.subject.run.repo_error_count, 0);
      assert.equal(report.subject.repos.length, 2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-REPORT-006: invalid export fails closed and surfaces verifier errors', () => {
    const root = createGovernedProject();
    try {
      const artifactPath = exportArtifact(root);
      const broken = JSON.parse(runCli(root, ['export']).stdout);
      broken.summary.status = 'completed';
      writeJson(artifactPath, broken);

      const result = runCli(root, ['report', '--input', artifactPath, '--format', 'json']);
      assert.equal(result.status, 1, result.stderr);

      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'fail');
      assert.match(report.message, /Cannot build governance report from invalid export artifact/);
      assert.equal(report.verification.overall, 'fail');
      assert.match(report.verification.errors.join('\n'), /summary\.status/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-REPORT-007: unreadable input returns command-error shape', () => {
    const root = createGovernedProject();
    try {
      const result = runCli(root, ['report', '--input', 'missing/export.json', '--format', 'json']);
      assert.equal(result.status, 2, result.stderr);

      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'error');
      assert.match(report.input, /missing\/export\.json$/);
      assert.match(report.message, /ENOENT|no such file/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
