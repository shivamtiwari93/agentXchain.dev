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

function addCoordinatorRepoEvents(root, eventsByRepo = {}) {
  for (const [repoId, entries] of Object.entries(eventsByRepo)) {
    writeJsonl(join(root, 'repos', repoId, '.agentxchain', 'events.jsonl'), entries);
  }
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
      assert.equal(report.schema_version, '0.3');
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

  it('AT-PHASE-CONF-001: verify export rejects empty workflow_phase_order', () => {
    const root = createGovernedProject();
    try {
      const artifactPath = exportToFile(root);
      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
      artifact.summary.workflow_phase_order = [];
      writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n');

      const result = runCli(root, ['verify', 'export', '--input', artifactPath, '--format', 'json']);
      assert.equal(result.status, 1);
      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'fail');
      assert.ok(report.errors.some((error) => error.includes('summary.workflow_phase_order: must not be empty when present')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-PHASE-CONF-002: verify export rejects duplicate workflow phases', () => {
    const root = createGovernedProject();
    try {
      const artifactPath = exportToFile(root);
      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
      artifact.summary.workflow_phase_order = ['implementation', 'implementation'];
      writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n');

      const result = runCli(root, ['verify', 'export', '--input', artifactPath, '--format', 'json']);
      assert.equal(result.status, 1);
      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'fail');
      assert.ok(report.errors.some((error) => error.includes('summary.workflow_phase_order: must not contain duplicate phase "implementation"')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-PHASE-CONF-003: verify export rejects phase missing from workflow_phase_order', () => {
    const root = createGovernedProject();
    try {
      const artifactPath = exportToFile(root);
      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
      artifact.summary.workflow_phase_order = ['planning', 'qa'];
      writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n');

      const result = runCli(root, ['verify', 'export', '--input', artifactPath, '--format', 'json']);
      assert.equal(result.status, 1);
      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'fail');
      assert.ok(report.errors.some((error) => error.includes('summary.phase: must appear in summary.workflow_phase_order when workflow_phase_order is present')));
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

  it('AT-VERIFY-EXPORT-008: coordinator aggregated_events total drift fails verification', () => {
    const root = createCoordinatorWorkspace();
    try {
      addCoordinatorRepoEvents(root, {
        web: [
          { event_id: 'evt_web_001', event_type: 'run_started', timestamp: '2026-04-15T09:00:00Z' },
          { event_id: 'evt_web_002', event_type: 'run_completed', timestamp: '2026-04-15T09:01:00Z' },
        ],
        cli: [
          { event_id: 'evt_cli_001', event_type: 'run_started', timestamp: '2026-04-15T09:00:30Z' },
        ],
      });

      const artifactPath = exportToFile(root, 'coordinator-export.json');
      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
      artifact.summary.aggregated_events.total_events = 99;
      writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n');

      const result = runCli(root, ['verify', 'export', '--input', artifactPath, '--format', 'json']);
      assert.equal(result.status, 1);
      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'fail');
      assert.ok(report.errors.some((error) => error.includes('summary.aggregated_events.total_events')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-VERIFY-EXPORT-009: coordinator aggregated_events order drift fails verification', () => {
    const root = createCoordinatorWorkspace();
    try {
      addCoordinatorRepoEvents(root, {
        web: [
          { event_id: 'evt_web_001', event_type: 'run_started', timestamp: '2026-04-15T09:00:00Z' },
          { event_id: 'evt_web_002', event_type: 'run_completed', timestamp: '2026-04-15T09:01:00Z' },
        ],
        cli: [
          { event_id: 'evt_cli_001', event_type: 'run_started', timestamp: '2026-04-15T09:00:30Z' },
          { event_id: 'evt_cli_002', event_type: 'run_completed', timestamp: '2026-04-15T09:01:30Z' },
        ],
      });

      const artifactPath = exportToFile(root, 'coordinator-export.json');
      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
      artifact.summary.aggregated_events.events.reverse();
      writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n');

      const result = runCli(root, ['verify', 'export', '--input', artifactPath, '--format', 'json']);
      assert.equal(result.status, 1);
      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'fail');
      assert.ok(report.errors.some((error) => error.includes('summary.aggregated_events.events')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-VERIFY-DEL-001: export with delegations verifies when summary matches history', () => {
    const root = createGovernedProject();
    try {
      // Add delegation history entries
      writeJsonl(join(root, '.agentxchain', 'history.jsonl'), [
        { turn_id: 'turn_001', role: 'dev', status: 'completed' },
        {
          turn_id: 'turn_002', role: 'lead', status: 'completed',
          delegations_issued: [
            { id: 'del_001', to_role: 'dev', charter: 'Build feature', required_decision_ids: [] },
          ],
        },
        {
          turn_id: 'turn_003', role: 'dev', status: 'completed',
          delegation_context: { delegation_id: 'del_001', parent_turn_id: 'turn_002' },
        },
        {
          turn_id: 'turn_004', role: 'lead', status: 'completed',
          delegation_review: {
            parent_turn_id: 'turn_002',
            results: [{ delegation_id: 'del_001', status: 'completed', satisfied_decision_ids: [], missing_decision_ids: [] }],
          },
        },
      ]);

      const artifactPath = exportToFile(root);
      const result = runCli(root, ['verify', 'export', '--input', artifactPath, '--format', 'json']);
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'pass');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-VERIFY-DEL-002: tampered total_delegations_issued fails verification', () => {
    const root = createGovernedProject();
    try {
      writeJsonl(join(root, '.agentxchain', 'history.jsonl'), [
        { turn_id: 'turn_001', role: 'dev', status: 'completed' },
        {
          turn_id: 'turn_002', role: 'lead', status: 'completed',
          delegations_issued: [
            { id: 'del_001', to_role: 'dev', charter: 'Build feature', required_decision_ids: [] },
          ],
        },
        {
          turn_id: 'turn_003', role: 'dev', status: 'completed',
          delegation_context: { delegation_id: 'del_001', parent_turn_id: 'turn_002' },
        },
      ]);

      const artifactPath = exportToFile(root);
      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
      artifact.summary.delegation_summary.total_delegations_issued = 99;
      writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n');

      const result = runCli(root, ['verify', 'export', '--input', artifactPath, '--format', 'json']);
      assert.equal(result.status, 1);
      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'fail');
      assert.ok(report.errors.some((e) => e.includes('summary.delegation_summary.total_delegations_issued')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-VERIFY-DEL-003: tampered delegation chain outcome fails verification', () => {
    const root = createGovernedProject();
    try {
      writeJsonl(join(root, '.agentxchain', 'history.jsonl'), [
        {
          turn_id: 'turn_002', role: 'lead', status: 'completed',
          delegations_issued: [
            { id: 'del_001', to_role: 'dev', charter: 'Build feature', required_decision_ids: [] },
          ],
        },
        {
          turn_id: 'turn_003', role: 'dev', status: 'completed',
          delegation_context: { delegation_id: 'del_001', parent_turn_id: 'turn_002' },
        },
        {
          turn_id: 'turn_004', role: 'lead', status: 'completed',
          delegation_review: {
            parent_turn_id: 'turn_002',
            results: [{ delegation_id: 'del_001', status: 'completed', satisfied_decision_ids: [], missing_decision_ids: [] }],
          },
        },
      ]);

      const artifactPath = exportToFile(root);
      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
      artifact.summary.delegation_summary.delegation_chains[0].outcome = 'failed';
      writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n');

      const result = runCli(root, ['verify', 'export', '--input', artifactPath, '--format', 'json']);
      assert.equal(result.status, 1);
      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'fail');
      assert.ok(report.errors.some((e) => e.includes('summary.delegation_summary.delegation_chains')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-VERIFY-DEL-004: no delegations in history passes verification', () => {
    const root = createGovernedProject();
    try {
      // Default history has no delegations — summary should have zero count
      const artifactPath = exportToFile(root);
      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
      assert.equal(artifact.summary.delegation_summary.total_delegations_issued, 0);
      assert.deepStrictEqual(artifact.summary.delegation_summary.delegation_chains, []);

      const result = runCli(root, ['verify', 'export', '--input', artifactPath, '--format', 'json']);
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'pass');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-VERIFY-REPO-001: export with repo decisions verifies when summary matches file', () => {
    const root = createGovernedProject();
    try {
      writeJsonl(join(root, '.agentxchain', 'repo-decisions.jsonl'), [
        {
          id: 'DEC-100',
          status: 'overridden',
          category: 'architecture',
          statement: 'Use REST',
          role: 'dev',
          run_id: 'run_001',
          durability: 'repo',
          overridden_by: 'DEC-101',
        },
        {
          id: 'DEC-101',
          status: 'active',
          category: 'architecture',
          statement: 'Use GraphQL',
          role: 'architect',
          run_id: 'run_002',
          durability: 'repo',
          overrides: 'DEC-100',
        },
      ]);

      const artifactPath = exportToFile(root);
      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
      assert.equal(artifact.summary.repo_decisions.active[0].overrides, 'DEC-100');
      assert.equal(artifact.summary.repo_decisions.overridden[0].overridden_by, 'DEC-101');
      assert.equal(artifact.summary.repo_decisions.active[0].authority_level, 0);
      assert.equal(artifact.summary.repo_decisions.active[0].authority_source, 'unknown_role');
      const result = runCli(root, ['verify', 'export', '--input', artifactPath, '--format', 'json']);
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'pass');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-VERIFY-REPO-002: tampered active_count fails verification', () => {
    const root = createGovernedProject();
    try {
      writeJsonl(join(root, '.agentxchain', 'repo-decisions.jsonl'), [
        { id: 'DEC-100', status: 'active', category: 'architecture', statement: 'Use REST', role: 'dev', run_id: 'run_001' },
      ]);

      const artifactPath = exportToFile(root);
      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
      artifact.summary.repo_decisions.active_count = 99;
      writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n');

      const result = runCli(root, ['verify', 'export', '--input', artifactPath, '--format', 'json']);
      assert.equal(result.status, 1);
      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'fail');
      assert.ok(report.errors.some((e) => e.includes('summary.repo_decisions.active_count')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-VERIFY-REPO-003: fabricated active decision not in JSONL fails verification', () => {
    const root = createGovernedProject();
    try {
      writeJsonl(join(root, '.agentxchain', 'repo-decisions.jsonl'), [
        { id: 'DEC-100', status: 'active', category: 'architecture', statement: 'Use REST', role: 'dev', run_id: 'run_001' },
      ]);

      const artifactPath = exportToFile(root);
      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
      artifact.summary.repo_decisions.active.push({
        id: 'DEC-FAKE', category: 'security', statement: 'Fabricated decision', role: 'admin', run_id: 'run_fake',
      });
      artifact.summary.repo_decisions.total = 2;
      artifact.summary.repo_decisions.active_count = 2;
      writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n');

      const result = runCli(root, ['verify', 'export', '--input', artifactPath, '--format', 'json']);
      assert.equal(result.status, 1);
      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'fail');
      assert.ok(report.errors.some((e) => e.includes('summary.repo_decisions')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-VERIFY-REPO-004: no repo-decisions.jsonl with null summary passes', () => {
    const root = createGovernedProject();
    try {
      // Default project has no repo-decisions.jsonl
      const artifactPath = exportToFile(root);
      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
      assert.equal(artifact.summary.repo_decisions, null);

      const result = runCli(root, ['verify', 'export', '--input', artifactPath, '--format', 'json']);
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'pass');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-VERIFY-REPO-005: tampered authority metadata fails verification', () => {
    const root = createGovernedProject();
    try {
      writeJson(join(root, 'agentxchain.json'), {
        schema_version: '1.0',
        template: 'generic',
        project: { id: 'verify-export', name: 'Verify Export', default_branch: 'main' },
        roles: {
          architect: {
            title: 'Architect',
            mandate: 'Set direction.',
            write_authority: 'authoritative',
            decision_authority: 40,
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
            entry_role: 'architect',
            allowed_next_roles: ['architect', 'human'],
          },
        },
        gates: {},
        hooks: {},
      });

      writeJsonl(join(root, '.agentxchain', 'repo-decisions.jsonl'), [
        { id: 'DEC-100', status: 'active', category: 'architecture', statement: 'Use REST', role: 'architect', run_id: 'run_001' },
      ]);

      const artifactPath = exportToFile(root, 'authority-artifact.json');
      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
      assert.equal(artifact.summary.repo_decisions.active[0].authority_level, 40);
      artifact.summary.repo_decisions.active[0].authority_level = 99;
      writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n');

      const result = runCli(root, ['verify', 'export', '--input', artifactPath, '--format', 'json']);
      assert.equal(result.status, 1);
      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'fail');
      assert.ok(report.errors.some((e) => e.includes('summary.repo_decisions.active')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-VERIFY-REPO-006: tampered repo decision operator summary fails verification', () => {
    const root = createGovernedProject();
    try {
      writeJson(join(root, 'agentxchain.json'), {
        schema_version: '1.0',
        template: 'generic',
        project: { id: 'verify-export', name: 'Verify Export', default_branch: 'main' },
        roles: {
          architect: {
            title: 'Architect',
            mandate: 'Set direction.',
            write_authority: 'authoritative',
            decision_authority: 40,
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
            entry_role: 'architect',
            allowed_next_roles: ['architect', 'human'],
          },
        },
        gates: {},
        hooks: {},
      });

      writeJsonl(join(root, '.agentxchain', 'repo-decisions.jsonl'), [
        { id: 'DEC-100', status: 'overridden', category: 'architecture', statement: 'Use REST', role: 'architect', run_id: 'run_001', overridden_by: 'DEC-101' },
        { id: 'DEC-101', status: 'active', category: 'architecture', statement: 'Use GraphQL', role: 'architect', run_id: 'run_002', overrides: 'DEC-100' },
      ]);

      const artifactPath = exportToFile(root, 'operator-summary-artifact.json');
      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
      artifact.summary.repo_decisions.operator_summary.superseding_active_count = 99;
      writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n');

      const result = runCli(root, ['verify', 'export', '--input', artifactPath, '--format', 'json']);
      assert.equal(result.status, 1);
      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'fail');
      assert.ok(report.errors.some((e) => e.includes('summary.repo_decisions.operator_summary')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-VERIFY-DASH-001: valid dashboard_session schema passes verification', () => {
    const root = createGovernedProject();
    try {
      const artifactPath = exportToFile(root);
      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
      // Dashboard should be not_running in temp dir
      assert.equal(artifact.summary.dashboard_session.status, 'not_running');

      const result = runCli(root, ['verify', 'export', '--input', artifactPath, '--format', 'json']);
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'pass');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-VERIFY-DASH-002: invalid dashboard_session status enum fails verification', () => {
    const root = createGovernedProject();
    try {
      const artifactPath = exportToFile(root);
      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
      artifact.summary.dashboard_session.status = 'bogus_status';
      writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n');

      const result = runCli(root, ['verify', 'export', '--input', artifactPath, '--format', 'json']);
      assert.equal(result.status, 1);
      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'fail');
      assert.ok(report.errors.some((e) => e.includes('summary.dashboard_session.status')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-VERIFY-DASH-003: running status with null PID fails verification', () => {
    const root = createGovernedProject();
    try {
      const artifactPath = exportToFile(root);
      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
      artifact.summary.dashboard_session = {
        status: 'running', pid: null, url: 'http://localhost:4200', started_at: '2026-04-15T00:00:00Z',
      };
      writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n');

      const result = runCli(root, ['verify', 'export', '--input', artifactPath, '--format', 'json']);
      assert.equal(result.status, 1);
      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'fail');
      assert.ok(report.errors.some((e) => e.includes('summary.dashboard_session.pid')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-VERIFY-DASH-004: not_running status with non-null PID fails verification', () => {
    const root = createGovernedProject();
    try {
      const artifactPath = exportToFile(root);
      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
      artifact.summary.dashboard_session = {
        status: 'not_running', pid: 12345, url: null, started_at: null,
      };
      writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n');

      const result = runCli(root, ['verify', 'export', '--input', artifactPath, '--format', 'json']);
      assert.equal(result.status, 1);
      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'fail');
      assert.ok(report.errors.some((e) => e.includes('summary.dashboard_session.pid')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-VERIFY-EXPORT-010: coordinator aggregated_events cannot claim failed child repo events', () => {
    const root = createCoordinatorWorkspace();
    try {
      addCoordinatorRepoEvents(root, {
        web: [
          { event_id: 'evt_web_001', event_type: 'run_started', timestamp: '2026-04-15T09:00:00Z' },
        ],
        cli: [
          { event_id: 'evt_cli_001', event_type: 'run_started', timestamp: '2026-04-15T09:00:30Z' },
        ],
      });
      rmSync(join(root, 'repos', 'cli', 'agentxchain.json'));

      const artifactPath = exportToFile(root, 'coordinator-export.json');
      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
      assert.equal(artifact.repos.cli.ok, false);
      assert.ok(artifact.summary.aggregated_events.repos_with_events.includes('cli'));

      const result = runCli(root, ['verify', 'export', '--input', artifactPath, '--format', 'json']);
      assert.equal(result.status, 1);
      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'fail');
      assert.ok(report.errors.some((error) => error.includes('summary.aggregated_events.repos_with_events')));
      assert.ok(report.errors.some((error) => error.includes('repos.cli.ok is false')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
