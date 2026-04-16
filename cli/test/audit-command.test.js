import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
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
  const root = mkdtempSync(join(tmpdir(), 'axc-audit-'));
  tempDirs.add(root);

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: 'audit-test', name: 'Audit Test', goal: 'Ship a first-class audit command', default_branch: 'main' },
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
    budget: {
      per_run_max_usd: 10.0,
      per_turn_max_usd: 2.0,
    },
    gates: {},
    hooks: {},
  });

  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: 'audit-test',
    run_id: 'run_audit_001',
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
        started_at: '2026-04-12T15:00:00.000Z',
      },
    },
    retained_turns: {},
    turn_sequence: 1,
    blocked_on: 'human_approval:planning_signoff',
    blocked_reason: {
      category: 'human_approval',
      blocked_at: '2026-04-12T15:00:45.000Z',
      turn_id: 'turn_001',
      gate: 'planning_signoff',
      recovery: {
        typed_reason: 'human_approval',
        owner: 'human',
        recovery_action: 'agentxchain approve-transition',
        turn_retained: true,
        detail: 'Waiting on planning gate approval.',
      },
    },
    phase_gate_status: {
      planning_signoff: 'pending',
    },
    budget_status: { spent_usd: 0.85, remaining_usd: 9.15 },
    protocol_mode: 'governed',
    created_at: '2026-04-12T14:59:00.000Z',
  });

  writeJsonl(join(root, '.agentxchain', 'history.jsonl'), [
    {
      turn_id: 'turn_001',
      role: 'dev',
      status: 'running',
      summary: 'Implemented the first audit slice',
      decisions: [{ id: 'DEC-AUDIT-001' }],
      objections: [],
      files_changed: ['cli/src/commands/audit.js'],
      cost: { total_usd: 0.85 },
      started_at: '2026-04-12T15:00:00.000Z',
      duration_ms: 45000,
      accepted_at: '2026-04-12T15:00:45.000Z',
      accepted_sequence: 1,
    },
  ]);

  writeJsonl(join(root, '.agentxchain', 'decision-ledger.jsonl'), [
    {
      id: 'DEC-AUDIT-001',
      turn_id: 'turn_001',
      role: 'dev',
      phase: 'implementation',
      statement: 'Add a live audit command for governed projects.',
    },
  ]);

  return root;
}

function createGovernedProjectWithRuntimeGuidance() {
  const root = mkdtempSync(join(tmpdir(), 'axc-audit-runtime-'));
  tempDirs.add(root);

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: 4,
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'audit-runtime-test', name: 'Audit Runtime Test', goal: 'Surface runtime-aware blocked guidance everywhere', default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Build safely.',
        write_authority: 'proposed',
        runtime: 'remote-dev',
      },
    },
    runtimes: {
      'remote-dev': {
        type: 'api_proxy',
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        auth_env: 'ANTHROPIC_API_KEY',
      },
    },
    routing: {
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
        exit_gate: 'implementation_complete',
      },
      qa: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
      },
    },
    gates: {
      implementation_complete: {
        requires_files: ['.planning/IMPLEMENTATION_NOTES.md'],
      },
    },
    budget: {
      per_run_max_usd: 10.0,
      per_turn_max_usd: 2.0,
    },
    hooks: {},
    files: {
      talk: 'TALK.md',
      history: '.agentxchain/history.jsonl',
      state: '.agentxchain/state.json',
    },
  });

  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: 'audit-runtime-test',
    run_id: 'run_audit_runtime_001',
    status: 'blocked',
    phase: 'implementation',
    active_turns: {},
    retained_turns: {},
    turn_sequence: 1,
    last_completed_turn_id: 'turn_dev_001',
    blocked_on: 'dispatch:awaiting_operator_followup',
    blocked_reason: {
      category: 'dispatch_error',
      blocked_at: '2026-04-15T19:00:45.000Z',
      turn_id: 'turn_dev_001',
      recovery: {
        typed_reason: 'dispatch_error',
        owner: 'human',
        recovery_action: 'agentxchain step --resume',
        turn_retained: true,
        detail: 'Dispatch paused until required files are materialized.',
      },
    },
    last_gate_failure: {
      gate_type: 'phase_transition',
      gate_id: 'implementation_complete',
      phase: 'implementation',
      from_phase: 'implementation',
      to_phase: 'qa',
      requested_by_turn: 'turn_dev_001',
      failed_at: '2026-04-15T19:00:00.000Z',
      queued_request: false,
      reasons: ['Missing file: .planning/IMPLEMENTATION_NOTES.md'],
      missing_files: ['.planning/IMPLEMENTATION_NOTES.md'],
      missing_verification: false,
    },
    phase_gate_status: {
      implementation_complete: 'failed',
    },
    budget_status: { spent_usd: 0.25, remaining_usd: 9.75 },
    protocol_mode: 'governed',
    created_at: '2026-04-15T18:59:00.000Z',
  });

  writeJsonl(join(root, '.agentxchain', 'history.jsonl'), [
    {
      turn_id: 'turn_dev_001',
      role: 'dev',
      status: 'blocked',
      summary: 'Prepared implementation notes proposal but it still needs apply.',
      decisions: [{ id: 'DEC-AUDIT-RUNTIME-001' }],
      objections: [],
      files_changed: [],
      cost: { total_usd: 0.25 },
      started_at: '2026-04-15T19:00:00.000Z',
      duration_ms: 45000,
      accepted_sequence: 1,
    },
  ]);

  writeJsonl(join(root, '.agentxchain', 'decision-ledger.jsonl'), [
    {
      id: 'DEC-AUDIT-RUNTIME-001',
      turn_id: 'turn_dev_001',
      role: 'dev',
      phase: 'implementation',
      statement: 'Remote proposal ownership should surface proposal apply guidance.',
    },
  ]);

  writeFileSync(join(root, 'TALK.md'), '# Talk\n');
  return root;
}

function createCoordinatorWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'axc-audit-coord-'));
  tempDirs.add(root);

  writeJson(join(root, 'agentxchain-multi.json'), {
    schema_version: '0.1',
    project: { id: 'coord-audit', name: 'Coordinator Audit' },
    repos: {
      app: { path: './repos/app', default_branch: 'main', required: true },
    },
    workstreams: {
      default: {
        repos: ['app'],
      },
    },
  });

  writeJson(join(root, '.agentxchain', 'multirepo', 'state.json'), {
    schema_version: '0.1',
    super_run_id: 'srun_audit_001',
    status: 'active',
    phase: 'implementation',
    repo_runs: {
      app: {
        status: 'active',
        run_id: 'run_app_001',
      },
    },
  });

  writeJsonl(join(root, '.agentxchain', 'multirepo', 'history.jsonl'), [
    {
      type: 'repo_initialized',
      repo_id: 'app',
      timestamp: '2026-04-12T15:10:00.000Z',
      message: 'Initialized child repo.',
    },
  ]);

  writeJsonl(join(root, '.agentxchain', 'multirepo', 'decision-ledger.jsonl'), [
    {
      id: 'DEC-COORD-AUDIT-001',
      statement: 'Track the app repo as active.',
      timestamp: '2026-04-12T15:10:05.000Z',
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
    budget: {
      per_run_max_usd: 10.0,
      per_turn_max_usd: 2.0,
    },
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
    turn_sequence: 0,
    blocked_on: null,
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

  return root;
}

function createPartialCoordinatorWorkspace() {
  const root = createCoordinatorWorkspace();

  writeJson(join(root, 'agentxchain-multi.json'), {
    schema_version: '0.1',
    project: { id: 'coord-audit', name: 'Coordinator Audit' },
    repos: {
      app: { path: './repos/app', default_branch: 'main', required: true },
      broken: { path: './repos/missing', default_branch: 'main', required: true },
    },
    workstreams: {
      default: {
        repos: ['app', 'broken'],
      },
    },
  });

  writeJson(join(root, '.agentxchain', 'multirepo', 'state.json'), {
    schema_version: '0.1',
    super_run_id: 'srun_audit_001',
    status: 'active',
    phase: 'implementation',
    repo_runs: {
      app: {
        status: 'active',
        run_id: 'run_app_001',
      },
      broken: {
        status: 'linked',
        run_id: 'run_missing_001',
      },
    },
  });

  return root;
}

function createCompletedCoordinatorWorkspaceWithRunIdDrift() {
  const root = createCoordinatorWorkspace();

  writeJson(join(root, '.agentxchain', 'multirepo', 'state.json'), {
    schema_version: '0.1',
    super_run_id: 'srun_audit_001',
    status: 'completed',
    phase: 'implementation',
    blocked_reason: 'Repo "app" drifted earlier',
    repo_runs: {
      app: {
        status: 'linked',
        run_id: 'run_app_001',
      },
    },
    pending_gate: null,
  });

  writeJson(join(root, 'repos', 'app', '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: 'child-app',
    run_id: 'run_app_999',
    status: 'blocked',
    phase: 'implementation',
    active_turns: {},
    retained_turns: {},
    turn_sequence: 0,
    blocked_on: 'dispatch:awaiting_followup',
    phase_gate_status: {},
    budget_status: {},
    protocol_mode: 'governed',
  });

  return root;
}

function cleanup() {
  for (const dir of [...tempDirs]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
    tempDirs.delete(dir);
  }
}

describe('agentxchain audit', () => {
  it('AT-AUDIT-002: governed project audit renders a live governance report', () => {
    const root = createGovernedProject();
    const result = runCli(root, ['audit']);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /AgentXchain Governance Report/);
    assert.match(result.stdout, /Project: Audit Test \(audit-test\)/);
    assert.match(result.stdout, /Goal: Ship a first-class audit command/);
    assert.match(result.stdout, /Verification: PASS/);
    assert.match(result.stdout, /Input: .*axc-audit-/);
  });

  it('AT-AUDIT-003: governed project audit --format json returns governed_run contract', () => {
    const root = createGovernedProject();
    const result = runCli(root, ['audit', '--format', 'json']);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.overall, 'pass');
    assert.equal(parsed.subject.kind, 'governed_run');
    assert.equal(parsed.subject.project.goal, 'Ship a first-class audit command');
    assert.match(parsed.input, /axc-audit-/);
  });

  it('AT-AUDIT-004: coordinator workspace audit returns coordinator_workspace contract', () => {
    const root = createCoordinatorWorkspace();
    const result = runCli(root, ['audit', '--format', 'json']);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.overall, 'pass');
    assert.equal(parsed.subject.kind, 'coordinator_workspace');
    assert.equal(parsed.subject.coordinator.project_name, 'Coordinator Audit');
    assert.equal(parsed.subject.run.repo_ok_count, 1);
  });

  it('AT-AUDIT-013: partial coordinator audit keeps export health visible and failed child drill-down absent', () => {
    const root = createPartialCoordinatorWorkspace();
    const result = runCli(root, ['audit', '--format', 'json']);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.subject.kind, 'coordinator_workspace');
    assert.equal(parsed.subject.run.repo_ok_count, 1);
    assert.equal(parsed.subject.run.repo_error_count, 1);
    assert.ok(Array.isArray(parsed.subject.coordinator_timeline));
    assert.ok(parsed.subject.coordinator_timeline.length > 0);

    const brokenRepo = parsed.subject.repos.find((repo) => repo.repo_id === 'broken');
    assert.equal(brokenRepo.ok, false);
    assert.match(brokenRepo.error, /no governed project found/i);
    assert.equal(brokenRepo.turns, undefined);
    assert.equal(brokenRepo.decisions, undefined);
    assert.equal(brokenRepo.hook_summary, undefined);
    assert.equal(brokenRepo.gate_summary, undefined);
    assert.equal(brokenRepo.recovery_summary, undefined);
  });

  it('AT-CBAP-004: coordinator audit json preserves repo_run_id_mismatch next actions', () => {
    const root = createCoordinatorWorkspace();

    writeJson(join(root, '.agentxchain', 'multirepo', 'state.json'), {
      schema_version: '0.1',
      super_run_id: 'srun_audit_001',
      status: 'blocked',
      phase: 'implementation',
      blocked_reason: 'Repo "app" run identity drifted from run_app_001 to run_app_999',
      repo_runs: {
        app: {
          status: 'linked',
          run_id: 'run_app_001',
        },
      },
      pending_gate: null,
    });

    writeJson(join(root, 'repos', 'app', '.agentxchain', 'state.json'), {
      schema_version: '1.1',
      project_id: 'child-app',
      run_id: 'run_app_999',
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

    const result = runCli(root, ['audit', '--format', 'json']);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.subject.kind, 'coordinator_workspace');
    assert.equal(parsed.subject.run.run_id_mismatches[0].repo_id, 'app');
    assert.equal(parsed.subject.run.next_actions[0].code, 'repo_run_id_mismatch');
    assert.equal(parsed.subject.run.next_actions[0].command, 'agentxchain multi resume');
    assert.match(parsed.subject.run.next_actions[1].reason, /Repo "app" run identity drifted/);
  });

  it('coordinator audit json preserves resync next action for status drift', () => {
    const root = createCoordinatorWorkspace();

    writeJson(join(root, '.agentxchain', 'multirepo', 'state.json'), {
      schema_version: '0.1',
      super_run_id: 'srun_audit_001',
      status: 'active',
      phase: 'implementation',
      blocked_reason: null,
      repo_runs: {
        app: {
          status: 'linked',
          run_id: 'run_app_001',
        },
      },
      pending_gate: null,
    });

    writeJson(join(root, 'repos', 'app', '.agentxchain', 'state.json'), {
      schema_version: '1.1',
      project_id: 'child-app',
      run_id: 'run_app_001',
      status: 'blocked',
      phase: 'implementation',
      active_turns: {},
      retained_turns: {},
      turn_sequence: 0,
      blocked_on: 'dispatch:awaiting_followup',
      blocked_reason: {
        category: 'dispatch_error',
        blocked_at: '2026-04-15T19:00:45.000Z',
        turn_id: null,
        recovery: {
          typed_reason: 'dispatch_error',
          owner: 'human',
          recovery_action: 'agentxchain step --resume',
          turn_retained: true,
          detail: 'Dispatch paused',
        },
      },
      phase_gate_status: {},
      budget_status: {},
      protocol_mode: 'governed',
    });

    const result = runCli(root, ['audit', '--format', 'json']);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.subject.kind, 'coordinator_workspace');
    assert.equal(parsed.subject.run.next_actions[0].code, 'resync');
    assert.equal(parsed.subject.run.next_actions[0].command, 'agentxchain multi resync');
    assert.match(parsed.subject.run.next_actions[0].reason, /repo authority/i);
  });

  it('AT-AUDIT-008: blocked governed audit json preserves runtime guidance and next actions', () => {
    const root = createGovernedProjectWithRuntimeGuidance();
    const result = runCli(root, ['audit', '--format', 'json']);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.subject.kind, 'governed_run');
    assert.equal(parsed.subject.run.next_actions[0].command, 'agentxchain proposal apply turn_dev_001');
    assert.match(parsed.subject.run.next_actions[0].reason, /proposal apply/i);
    assert.equal(parsed.subject.run.next_actions[1].command, 'agentxchain step --resume');
    assert.equal(parsed.subject.run.recovery_summary.runtime_guidance[0].code, 'proposal_apply_required');
    assert.equal(parsed.subject.run.recovery_summary.runtime_guidance[0].role_id, 'dev');
  });

  it('AT-AUDIT-009: completed coordinator audit keeps terminal child drift observable without recovery guidance', () => {
    const root = createCompletedCoordinatorWorkspaceWithRunIdDrift();
    const result = runCli(root, ['audit', '--format', 'json']);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.subject.kind, 'coordinator_workspace');
    assert.equal(parsed.subject.run.status, 'completed');
    assert.deepEqual(parsed.subject.run.run_id_mismatches, [{
      repo_id: 'app',
      expected_run_id: 'run_app_001',
      actual_run_id: 'run_app_999',
    }]);
    assert.equal(
      parsed.subject.run.terminal_observability_note,
      'Child repo run-id drift and status drift remain visible for audit, but this coordinator is already completed, so no recovery command is emitted.',
    );
    assert.deepEqual(parsed.subject.run.repo_status_drifts, [{
      repo_id: 'app',
      coordinator_status: 'linked',
      repo_status: 'blocked',
    }]);
    assert.deepEqual(parsed.subject.run.next_actions, []);
  });

  it('AT-AUDIT-011: completed coordinator audit text and markdown keep terminal child drift observable without next actions', () => {
    const root = createCompletedCoordinatorWorkspaceWithRunIdDrift();
    const textResult = runCli(root, ['audit']);
    assert.equal(textResult.status, 0, `${textResult.stdout}\n${textResult.stderr}`);
    assert.match(textResult.stdout, /Repo status drift: 1/);
    assert.match(textResult.stdout, /app: coordinator linked, repo blocked/);
    assert.match(textResult.stdout, /Terminal drift note: Child repo run-id drift and status drift remain visible for audit/);
    assert.doesNotMatch(textResult.stdout, /Next Actions:/);

    const markdownResult = runCli(root, ['audit', '--format', 'markdown']);
    assert.equal(markdownResult.status, 0, `${markdownResult.stdout}\n${markdownResult.stderr}`);
    assert.match(markdownResult.stdout, /Repo status drift: 1/);
    assert.match(markdownResult.stdout, /Terminal drift note: Child repo run-id drift and status drift remain visible for audit/);
    assert.doesNotMatch(markdownResult.stdout, /Next Actions:/);
  });

  it('AT-AUDIT-010: completed coordinator audit html keeps terminal child drift observable without next actions', () => {
    const root = createCompletedCoordinatorWorkspaceWithRunIdDrift();
    const htmlResult = runCli(root, ['audit', '--format', 'html']);
    assert.equal(htmlResult.status, 0, `${htmlResult.stdout}\n${htmlResult.stderr}`);
    assert.match(htmlResult.stdout, /<!DOCTYPE html>/);
    assert.match(htmlResult.stdout, /<dt>Repo status drift<\/dt>/);
    assert.match(htmlResult.stdout, /<h2>Repo Status Drift<\/h2>/);
    assert.match(htmlResult.stdout, /<dt>Terminal drift note<\/dt>/);
    assert.match(htmlResult.stdout, /Child repo run-id drift and status drift remain visible for audit, but this coordinator is already completed, so no recovery command is emitted\./);
    assert.doesNotMatch(htmlResult.stdout, />Next Actions</);
  });

  it('AT-AUDIT-005: unsupported format fails closed', () => {
    const root = createGovernedProject();
    const result = runCli(root, ['audit', '--format', 'yaml']);

    assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /Unsupported audit format "yaml"/);
  });

  it('AT-AUDIT-006: running outside a governed surface fails closed', () => {
    const root = mkdtempSync(join(tmpdir(), 'axc-audit-missing-'));
    tempDirs.add(root);
    const result = runCli(root, ['audit', '--format', 'json']);

    assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.overall, 'error');
    assert.match(parsed.message, /No governed project found|No agentxchain-multi\.json found/);
  });
});

process.on('exit', cleanup);
