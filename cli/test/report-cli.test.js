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
    budget: {
      per_run_max_usd: 10.0,
      per_turn_max_usd: 2.0,
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
    phase_gate_status: {
      implementation_complete: 'passed',
      planning_signoff: 'pending',
    },
    budget_status: { spent_usd: 1.2, remaining_usd: 8.8 },
    protocol_mode: 'governed',
    created_at: '2026-04-03T00:00:00.000Z',
  });

  writeJsonl(join(root, '.agentxchain', 'history.jsonl'), [
    {
      turn_id: 'turn_000', role: 'qa', status: 'failed',
      summary: 'Ran quality checks on initial scaffold',
      decisions: [], objections: [], files_changed: ['test/qa.js'],
      cost: { total_usd: 0.05 }, started_at: '2026-04-03T00:00:20.000Z', duration_ms: 40000, accepted_at: '2026-04-03T00:01:00.000Z', accepted_sequence: 1,
    },
    {
      turn_id: 'turn_001', role: 'dev', status: 'running',
      summary: 'Implemented report command',
      decisions: [{ id: 'DEC-001' }], objections: [],
      files_changed: ['src/report.js', 'src/cli.js'], phase_transition_request: 'qa',
      cost: { total_usd: 0.12 }, started_at: '2026-04-03T00:01:05.000Z', duration_ms: 55000, accepted_at: '2026-04-03T00:02:00.000Z', accepted_sequence: 2,
    },
  ]);
  writeJsonl(join(root, '.agentxchain', 'decision-ledger.jsonl'), [
    { id: 'DEC-001', turn_id: 'turn_001', role: 'dev', phase: 'implementation', statement: 'Ship report command.' },
  ]);
  writeJsonl(join(root, '.agentxchain', 'hook-audit.jsonl'), [
    { event: 'after_acceptance', hook: 'notify', result: 'ok' },
    { event: 'after_acceptance', hook: 'lint', result: 'blocked', blocked: true },
  ]);
  writeJsonl(join(root, '.agentxchain', 'notification-audit.jsonl'), [
    { event_type: 'run_blocked', notification_name: 'ops_webhook', delivered: true },
  ]);
  writeJsonl(join(root, '.agentxchain', 'intake', 'events', 'events.jsonl'), [
    { event_id: 'evt_001', category: 'schedule' },
  ]);
  writeJson(join(root, '.agentxchain', 'intake', 'intents', 'intent_1234_abcd.json'), {
    intent_id: 'intent_1234_abcd',
    event_id: 'evt_001',
    status: 'executing',
    priority: 'p1',
    template: 'cli-tool',
    target_run: 'run_report_001',
    target_turn: 'turn_001',
    started_at: '2026-04-03T00:00:30.000Z',
    updated_at: '2026-04-03T00:02:30.000Z',
  });
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

function writeDelegationHistory(root) {
  writeJsonl(join(root, '.agentxchain', 'history.jsonl'), [
    {
      turn_id: 'turn_010',
      role: 'director',
      status: 'completed',
      summary: 'Delegated implementation and QA',
      phase: 'implementation',
      decisions: [],
      objections: [],
      files_changed: ['plans/delegation.md'],
      accepted_at: '2026-04-03T00:10:00.000Z',
      accepted_sequence: 1,
      delegations_issued: [
        { id: 'del-001', to_role: 'dev', charter: 'Build the API', required_decision_ids: ['DEC-101'] },
        { id: 'del-002', to_role: 'qa', charter: 'Test the API', required_decision_ids: ['DEC-201'] },
      ],
    },
    {
      turn_id: 'turn_011',
      role: 'dev',
      status: 'completed',
      summary: 'Built the API',
      phase: 'implementation',
      decisions: [],
      objections: [],
      files_changed: ['src/api.js'],
      accepted_at: '2026-04-03T00:12:00.000Z',
      accepted_sequence: 2,
      delegation_context: {
        delegation_id: 'del-001',
        parent_turn_id: 'turn_010',
        parent_role: 'director',
        charter: 'Build the API',
        acceptance_contract: 'API works and tests pass',
        required_decision_ids: ['DEC-101'],
      },
    },
    {
      turn_id: 'turn_012',
      role: 'qa',
      status: 'failed',
      summary: 'Found a blocking regression',
      phase: 'implementation',
      decisions: [],
      objections: [],
      files_changed: ['test/api.test.js'],
      accepted_at: '2026-04-03T00:14:00.000Z',
      accepted_sequence: 3,
      delegation_context: {
        delegation_id: 'del-002',
        parent_turn_id: 'turn_010',
        parent_role: 'director',
        charter: 'Test the API',
        acceptance_contract: 'Critical regressions identified',
        required_decision_ids: ['DEC-201'],
      },
    },
    {
      turn_id: 'turn_013',
      role: 'director',
      status: 'completed',
      summary: 'Reviewed delegation results',
      phase: 'implementation',
      decisions: [],
      objections: [],
      files_changed: ['docs/delegation-review.md'],
      accepted_at: '2026-04-03T00:16:00.000Z',
      accepted_sequence: 4,
      delegation_review: {
        parent_turn_id: 'turn_010',
        results: [
          {
            delegation_id: 'del-001',
            status: 'completed',
            summary: 'Built the API',
            required_decision_ids: ['DEC-101'],
            satisfied_decision_ids: ['DEC-101'],
            missing_decision_ids: [],
          },
          {
            delegation_id: 'del-002',
            status: 'failed',
            summary: 'Regression found',
            required_decision_ids: ['DEC-201'],
            satisfied_decision_ids: [],
            missing_decision_ids: ['DEC-201'],
          },
        ],
      },
    },
  ]);
}

function createGovernedRepo(repoRoot, repoId, status, opts = {}) {
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
    budget: {
      per_run_max_usd: 10.0,
      per_turn_max_usd: 2.0,
    },
    gates: {},
    hooks: {},
  });
  const stateOverrides = opts.state || {};
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
    ...stateOverrides,
  });
  const history = opts.history || [
    { turn_id: 'turn_000', role: 'dev', status: 'completed' },
  ];
  writeJsonl(join(repoRoot, '.agentxchain', 'history.jsonl'), history);
  const decisions = opts.decisions || [
    { id: 'DEC-001', statement: 'Repo ready.' },
  ];
  writeJsonl(join(repoRoot, '.agentxchain', 'decision-ledger.jsonl'), decisions);
  if (opts.hookAudit) {
    writeJsonl(join(repoRoot, '.agentxchain', 'hook-audit.jsonl'), opts.hookAudit);
  }
}

function createCoordinatorWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'axc-report-cli-coord-'));
  createGovernedRepo(join(root, 'repos', 'web'), 'web-app', 'linked', {
    state: {
      run_id: 'run_web_001',
    },
  });
  createGovernedRepo(join(root, 'repos', 'cli'), 'cli-tool', 'initialized', {
    state: {
      run_id: 'run_cli_001',
    },
  });

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
    assert.match(result.stdout, /text, json, markdown, or html/i);
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
      assert.match(textResult.stdout, /Gate Outcomes:/);
      assert.match(textResult.stdout, /implementation_complete: passed/);
      assert.match(textResult.stdout, /Intake Linkage:/);
      assert.match(textResult.stdout, /intent_1234_abcd/);
      assert.match(textResult.stdout, /Recovery:/);
      assert.match(textResult.stdout, /Action: agentxchain step --resume/);
      assert.match(textResult.stdout, /2026-04-03T00:02:00\.000Z \(55s\)/);

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
      assert.equal(report.subject.run.turns[0].started_at, '2026-04-03T00:00:20.000Z');
      assert.equal(report.subject.run.turns[0].duration_ms, 40000);
      assert.equal(report.subject.run.turns[1].started_at, '2026-04-03T00:01:05.000Z');
      assert.equal(report.subject.run.turns[1].duration_ms, 55000);
      assert.deepEqual(report.subject.run.gate_summary, [
        { gate_id: 'implementation_complete', status: 'passed' },
        { gate_id: 'planning_signoff', status: 'pending' },
      ]);
      assert.equal(report.subject.run.intake_links.length, 1);
      assert.equal(report.subject.run.intake_links[0].intent_id, 'intent_1234_abcd');
      assert.equal(report.subject.run.recovery_summary.recovery_action, 'agentxchain step --resume');
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

  it('AT-REPORT-REPO-001: report surfaces compact repo-decision summary and keeps overridden-only history visible', () => {
    const root = createGovernedProject();
    try {
      writeJsonl(join(root, '.agentxchain', 'repo-decisions.jsonl'), [
        {
          id: 'DEC-900',
          status: 'overridden',
          category: 'architecture',
          statement: 'Use PostgreSQL',
          role: 'architect',
          run_id: 'run_prev_001',
          overridden_by: 'DEC-901',
        },
        {
          id: 'DEC-901',
          status: 'active',
          category: 'architecture',
          statement: 'Move to SQLite for local-first mode',
          role: 'architect',
          run_id: 'run_curr_001',
          overrides: 'DEC-900',
        },
      ]);
      writeJson(join(root, 'agentxchain.json'), {
        schema_version: '1.0',
        template: 'generic',
        project: { id: 'report-test', name: 'Report Test', default_branch: 'main' },
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

      const artifactPath = exportArtifact(root);

      let textResult = runCli(root, ['report', '--input', artifactPath, '--format', 'text']);
      assert.equal(textResult.status, 0, textResult.stderr);
      assert.match(textResult.stdout, /Repo Decisions:/);
      assert.match(textResult.stdout, /Categories: architecture/);
      assert.match(textResult.stdout, /Highest authority: 40 \(architect\)/);
      assert.match(textResult.stdout, /Lineage: 1 active superseding earlier decision \| 1 overridden with recorded successor/);
      assert.match(textResult.stdout, /DEC-900 \(overridden by DEC-901/);

      let markdownResult = runCli(root, ['report', '--input', artifactPath, '--format', 'markdown']);
      assert.equal(markdownResult.status, 0, markdownResult.stderr);
      assert.match(markdownResult.stdout, /## Repo Decisions/);
      assert.match(markdownResult.stdout, /Categories: architecture/);

      let jsonResult = runCli(root, ['report', '--input', artifactPath, '--format', 'json']);
      assert.equal(jsonResult.status, 0, jsonResult.stderr);
      let report = JSON.parse(jsonResult.stdout);
      assert.equal(report.subject.run.repo_decisions.operator_summary.highest_active_authority_level, 40);
      assert.equal(report.subject.run.repo_decisions.operator_summary.superseding_active_count, 1);

      writeJsonl(join(root, '.agentxchain', 'repo-decisions.jsonl'), [
        {
          id: 'DEC-900',
          status: 'overridden',
          category: 'architecture',
          statement: 'Use PostgreSQL',
          role: 'architect',
          run_id: 'run_prev_001',
          overridden_by: 'DEC-901',
        },
      ]);

      const overriddenOnlyArtifactPath = exportArtifact(root, 'artifact-overridden-only.json');
      textResult = runCli(root, ['report', '--input', overriddenOnlyArtifactPath, '--format', 'text']);
      assert.equal(textResult.status, 0, textResult.stderr);
      assert.match(textResult.stdout, /Repo Decisions:/);
      assert.match(textResult.stdout, /Active: 0  Overridden: 1/);
      assert.match(textResult.stdout, /Highest authority: —/);
      assert.match(textResult.stdout, /DEC-900 \(overridden by DEC-901/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-REPORT-RUNTIME-001: governed run report derives runtime-aware next actions from gate failures', () => {
    const root = createGovernedProject();
    try {
      const configPath = join(root, 'agentxchain.json');
      const statePath = join(root, '.agentxchain', 'state.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      const state = JSON.parse(readFileSync(statePath, 'utf8'));

      config.roles.dev.write_authority = 'proposed';
      config.roles.dev.runtime = 'remote-dev';
      config.runtimes['remote-dev'] = {
        type: 'api_proxy',
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        auth_env: 'ANTHROPIC_API_KEY',
      };
      config.routing.implementation.exit_gate = 'implementation_complete';
      config.gates.implementation_complete = {
        requires_files: ['.planning/IMPLEMENTATION_NOTES.md'],
      };

      state.status = 'blocked';
      state.phase = 'implementation';
      state.blocked_on = 'escalation:operator:dev';
      state.blocked_reason = {
        category: 'operator_escalation',
        blocked_at: '2026-04-03T00:03:00.000Z',
        turn_id: 'turn_001',
        recovery: {
          typed_reason: 'operator_escalation',
          owner: 'human',
          recovery_action: 'agentxchain step --resume',
          turn_retained: true,
          detail: 'Operator halted the run for review.',
        },
      };
      state.last_gate_failure = {
        gate_type: 'phase_transition',
        gate_id: 'implementation_complete',
        phase: 'implementation',
        from_phase: 'implementation',
        to_phase: 'qa',
        requested_by_turn: 'turn_001',
        failed_at: '2026-04-03T00:02:30.000Z',
        queued_request: false,
        reasons: ['Missing file: .planning/IMPLEMENTATION_NOTES.md'],
        missing_files: ['.planning/IMPLEMENTATION_NOTES.md'],
        missing_verification: false,
      };

      writeJson(configPath, config);
      writeJson(statePath, state);

      const artifactPath = exportArtifact(root);
      const jsonResult = runCli(root, ['report', '--input', artifactPath, '--format', 'json']);
      assert.equal(jsonResult.status, 0, jsonResult.stderr);
      const report = JSON.parse(jsonResult.stdout);

      assert.equal(report.subject.run.next_actions.length, 2);
      assert.equal(report.subject.run.next_actions[0].command, 'agentxchain proposal apply turn_001');
      assert.match(report.subject.run.next_actions[0].reason, /stages required files behind proposal apply/i);
      assert.equal(report.subject.run.next_actions[1].command, 'agentxchain step --resume');
      assert.match(report.subject.run.next_actions[1].reason, /After resolving the proposal_apply_required blocker/i);
      assert.equal(report.subject.run.recovery_summary.runtime_guidance[0].code, 'proposal_apply_required');

      const textResult = runCli(root, ['report', '--input', artifactPath]);
      assert.equal(textResult.status, 0, textResult.stderr);
      assert.match(textResult.stdout, /Next Actions:/);
      assert.match(textResult.stdout, /agentxchain proposal apply turn_001/);
      assert.match(textResult.stdout, /proposal_apply_required/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-RQ-001/002/003 + AT-RC-001: markdown report includes operator evidence sections', () => {
    const root = createGovernedProject();
    try {
      const rawArtifact = runCli(root, ['export']);
      assert.equal(rawArtifact.status, 0, rawArtifact.stderr);

      const result = runCli(root, ['report', '--format', 'markdown'], { input: rawArtifact.stdout });
      assert.equal(result.status, 0, result.stderr);

      // AT-RQ-001: Turn Timeline table
      assert.match(result.stdout, /## Turn Timeline/, 'markdown must include Turn Timeline section');
      assert.match(result.stdout, /\| # \| Role \| Phase \| Summary \| Files \| Cost \| Time \|/, 'timeline must have table header');
      assert.match(result.stdout, /\| 1 \| qa /, 'first timeline row must be qa turn');
      assert.match(result.stdout, /\| 2 \| dev /, 'second timeline row must be dev turn');
      assert.match(result.stdout, /Implemented report command/, 'timeline must include turn summary');
      assert.match(result.stdout, /\$0\.12/, 'timeline must include cost');
      assert.match(result.stdout, /2026-04-03T00:02:00\.000Z \(55s\)/, 'timeline must include accepted time plus duration when present');

      // AT-RQ-002: Decisions section
      assert.match(result.stdout, /## Decisions/, 'markdown must include Decisions section');
      assert.match(result.stdout, /DEC-001/, 'decisions must list decision ID');
      assert.match(result.stdout, /Ship report command/, 'decisions must include statement');
      assert.match(result.stdout, /dev, implementation phase/, 'decisions must include role and phase');

      // AT-RQ-003: Hook Activity section
      assert.match(result.stdout, /## Hook Activity/, 'markdown must include Hook Activity section');
      assert.match(result.stdout, /Total hook executions: 2/, 'hook summary must show total');
      assert.match(result.stdout, /Blocked: 1/, 'hook summary must show blocked count');
      assert.match(result.stdout, /after_acceptance\(2\)/, 'hook summary must show event breakdown');

      // AT-RC-001: operator context sections
      assert.match(result.stdout, /## Gate Outcomes/, 'markdown must include Gate Outcomes section');
      assert.match(result.stdout, /`implementation_complete`: `passed`/, 'gate outcomes must list passed gate');
      assert.match(result.stdout, /## Intake Linkage/, 'markdown must include Intake Linkage section');
      assert.match(result.stdout, /`intent_1234_abcd`/, 'intake linkage must identify linked intent');
      assert.match(result.stdout, /## Recovery/, 'markdown must include Recovery section');
      assert.match(result.stdout, /agentxchain step --resume/, 'recovery must include actionable command');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-RQ-004/005/006 + AT-RC-002: JSON report includes turns, decisions, timing, and operator context', () => {
    const root = createGovernedProject();
    try {
      const artifactPath = exportArtifact(root);
      const result = runCli(root, ['report', '--input', artifactPath, '--format', 'json']);
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);

      // AT-RQ-004: turns array
      assert.ok(Array.isArray(report.subject.run.turns), 'subject.run.turns must be an array');
      assert.equal(report.subject.run.turns.length, 2, 'turns must have 2 entries');
      assert.equal(report.subject.run.turns[0].role, 'qa', 'first turn must be qa');
      assert.equal(report.subject.run.turns[1].role, 'dev', 'second turn must be dev');
      assert.equal(report.subject.run.turns[1].summary, 'Implemented report command');
      assert.equal(report.subject.run.turns[1].phase_transition, 'qa');
      assert.equal(report.subject.run.turns[1].files_changed_count, 2);
      assert.equal(report.subject.run.turns[1].cost_usd, 0.12);

      // AT-RQ-005: decisions array
      assert.ok(Array.isArray(report.subject.run.decisions), 'subject.run.decisions must be an array');
      assert.equal(report.subject.run.decisions.length, 1);
      assert.equal(report.subject.run.decisions[0].id, 'DEC-001');
      assert.equal(report.subject.run.decisions[0].role, 'dev');
      assert.equal(report.subject.run.decisions[0].phase, 'implementation');
      assert.equal(report.subject.run.decisions[0].statement, 'Ship report command.');

      // AT-RQ-006: timing
      assert.equal(report.subject.run.created_at, '2026-04-03T00:00:00.000Z');

      // AT-RQ-004 continued: hook_summary
      assert.ok(report.subject.run.hook_summary, 'subject.run.hook_summary must exist');
      assert.equal(report.subject.run.hook_summary.total, 2);
      assert.equal(report.subject.run.hook_summary.blocked, 1);
      assert.deepEqual(report.subject.run.hook_summary.events, { after_acceptance: 2 });

      // AT-RC-002: intake, gates, recovery
      assert.equal(report.subject.run.intake_links[0].target_turn, 'turn_001');
      assert.equal(report.subject.run.gate_summary[0].gate_id, 'implementation_complete');
      assert.equal(report.subject.run.gate_summary[1].status, 'pending');
      assert.equal(report.subject.run.recovery_summary.owner, 'human');
      assert.equal(report.subject.run.recovery_summary.turn_retained, true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-RQ-007 + AT-RC-004: report omits empty evidence sections', () => {
    const root = createGovernedProject();
    try {
      // Overwrite history with empty
      writeJsonl(join(root, '.agentxchain', 'history.jsonl'), []);
      // Also clear decisions and hooks
      writeJsonl(join(root, '.agentxchain', 'decision-ledger.jsonl'), []);
      writeJsonl(join(root, '.agentxchain', 'hook-audit.jsonl'), []);
      writeJson(join(root, '.agentxchain', 'state.json'), {
        ...JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8')),
        status: 'active',
        blocked_reason: null,
        blocked_on: null,
        phase_gate_status: {},
      });
      rmSync(join(root, '.agentxchain', 'intake', 'intents', 'intent_1234_abcd.json'), { force: true });

      const rawArtifact = runCli(root, ['export']);
      assert.equal(rawArtifact.status, 0, rawArtifact.stderr);

      const mdResult = runCli(root, ['report', '--format', 'markdown'], { input: rawArtifact.stdout });
      assert.equal(mdResult.status, 0, mdResult.stderr);
      assert.doesNotMatch(mdResult.stdout, /## Turn Timeline/, 'empty history must not produce timeline section');
      assert.doesNotMatch(mdResult.stdout, /## Decisions/, 'no decisions must not produce decisions section');
      assert.doesNotMatch(mdResult.stdout, /## Hook Activity/, 'no hooks must not produce hook section');
      assert.doesNotMatch(mdResult.stdout, /## Intake Linkage/, 'no linked intake must not produce intake section');
      assert.doesNotMatch(mdResult.stdout, /## Gate Outcomes/, 'no gate status must not produce gate section');
      assert.doesNotMatch(mdResult.stdout, /## Recovery/, 'no recovery must not produce recovery section');

      const jsonResult = runCli(root, ['report', '--format', 'json'], { input: rawArtifact.stdout });
      assert.equal(jsonResult.status, 0, jsonResult.stderr);
      const report = JSON.parse(jsonResult.stdout);
      assert.deepEqual(report.subject.run.turns, [], 'turns array must be empty');
      assert.deepEqual(report.subject.run.decisions, [], 'decisions array must be empty');
      assert.deepEqual(report.subject.run.delegation_summary, {
        total_delegations_issued: 0,
        delegation_chains: [],
      }, 'delegation_summary must preserve empty shape when history exists without delegation data');
      assert.equal(report.subject.run.hook_summary, null, 'hook_summary must be null when no hooks');
      assert.deepEqual(report.subject.run.intake_links, [], 'intake_links must be empty when no linked intents');
      assert.deepEqual(report.subject.run.gate_summary, [], 'gate_summary must be empty when no gate state exists');
      assert.equal(report.subject.run.recovery_summary, null, 'recovery_summary must be null when no recovery exists');
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
      assert.equal(report.subject.run.blocked_reason, null);
      assert.equal(report.subject.run.pending_gate, null);
      assert.equal(report.subject.run.created_at, '2026-04-03T00:00:00Z');
      assert.equal(report.subject.run.completed_at, null);
      assert.equal(report.subject.run.duration_seconds, null);
      assert.equal(report.subject.run.next_actions.length, 1);
      assert.equal(report.subject.run.next_actions[0].command, 'agentxchain multi step');
      assert.deepEqual(report.subject.run.repo_status_counts, {
        initialized: 1,
        linked: 1,
      });
      assert.equal(report.subject.run.repo_ok_count, 2);
      assert.equal(report.subject.run.repo_error_count, 0);
      assert.equal(report.subject.repos.length, 2);

      const textResult = runCli(root, ['report', '--input', artifactPath]);
      assert.equal(textResult.status, 0, textResult.stderr);
      assert.match(textResult.stdout, /Next Actions:/);
      assert.match(textResult.stdout, /agentxchain multi step/);
      assert.match(textResult.stdout, /Recent coordinator events: unknown timing/);
      assert.match(textResult.stdout, /Started: 2026-04-03T00:00:00Z/);
      assert.doesNotMatch(textResult.stdout, /Completed:/);
      assert.doesNotMatch(textResult.stdout, /Duration:/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-REPORT-006: completed coordinator export stays terminal even when child repos drift', () => {
    const root = createCoordinatorWorkspace();
    try {
      writeJson(join(root, '.agentxchain', 'multirepo', 'state.json'), {
        schema_version: '0.1',
        super_run_id: 'srun_coord_report_001',
        project_id: 'coord-report',
        status: 'completed',
        phase: 'implementation',
        repo_runs: {
          web: { run_id: 'run_web_001', status: 'linked', phase: 'implementation' },
          cli: { run_id: 'run_cli_001', status: 'initialized', phase: 'implementation' },
        },
        pending_gate: null,
        phase_gate_status: {},
        created_at: '2026-04-03T00:00:00Z',
        updated_at: '2026-04-03T00:20:00Z',
      });
      writeJson(join(root, 'repos', 'web', '.agentxchain', 'state.json'), {
        ...JSON.parse(readFileSync(join(root, 'repos', 'web', '.agentxchain', 'state.json'), 'utf8')),
        status: 'active',
      });
      writeJson(join(root, 'repos', 'cli', '.agentxchain', 'state.json'), {
        ...JSON.parse(readFileSync(join(root, 'repos', 'cli', '.agentxchain', 'state.json'), 'utf8')),
        run_id: 'run_cli_999',
        status: 'blocked',
        blocked_on: 'dispatch:awaiting_followup',
      });
      writeJsonl(join(root, '.agentxchain', 'multirepo', 'history.jsonl'), [
        { type: 'run_initialized', super_run_id: 'srun_coord_report_001', timestamp: '2026-04-03T00:00:00Z' },
        { type: 'run_completed', super_run_id: 'srun_coord_report_001', timestamp: '2026-04-03T00:20:00Z' },
      ]);

      const artifactPath = exportArtifact(root, 'completed-terminal-artifact.json');
      const jsonResult = runCli(root, ['report', '--input', artifactPath, '--format', 'json']);
      assert.equal(jsonResult.status, 0, jsonResult.stderr);
      const report = JSON.parse(jsonResult.stdout);
      assert.equal(report.subject.kind, 'coordinator_workspace');
      assert.equal(report.subject.run.status, 'completed');
      assert.deepEqual(report.subject.run.next_actions, []);
      assert.equal(
        report.subject.run.terminal_observability_note,
        'Child repo run-id drift remains visible for audit, but this coordinator is already completed, so no recovery command is emitted.',
      );

      const textResult = runCli(root, ['report', '--input', artifactPath]);
      assert.equal(textResult.status, 0, textResult.stderr);
      assert.match(textResult.stdout, /Terminal drift note: Child repo run-id drift remains visible for audit/);
      assert.doesNotMatch(textResult.stdout, /Next Actions:/);
      assert.doesNotMatch(textResult.stdout, /agentxchain multi (resync|resume|step)/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-COORD-DRILL-001: coordinator report surfaces child-repo turn timeline and decisions', () => {
    const root = mkdtempSync(join(tmpdir(), 'axc-report-coord-drill-'));
    try {
      createGovernedRepo(join(root, 'repos', 'web'), 'web-app', 'linked', {
        history: [
          { turn_id: 'turn_w1', role: 'dev', status: 'completed', summary: 'Set up routes', phase: 'implementation', accepted_sequence: 1, files_changed: ['src/app.js'], accepted_at: '2026-04-03T01:00:00Z' },
          { turn_id: 'turn_w2', role: 'dev', status: 'completed', summary: 'Add tests', phase: 'implementation', accepted_sequence: 2, files_changed: ['test/app.test.js'], accepted_at: '2026-04-03T02:00:00Z' },
        ],
        decisions: [
          { id: 'DEC-WEB-001', role: 'dev', phase: 'implementation', statement: 'Use express router' },
          { id: 'DEC-WEB-002', role: 'dev', phase: 'implementation', statement: 'Add health check' },
        ],
        hookAudit: [
          { event: 'after_acceptance', result: 'ok' },
          { event: 'after_acceptance', result: 'blocked', blocked: true },
        ],
        state: {
          phase_gate_status: { planning_signoff: 'passed', qa_ship_verdict: 'passed' },
        },
      });
      createGovernedRepo(join(root, 'repos', 'cli'), 'cli-tool', 'initialized', {
        history: [
          { turn_id: 'turn_c1', role: 'dev', status: 'completed', summary: 'Init CLI', phase: 'implementation', accepted_sequence: 1, files_changed: ['bin/cli.js'], accepted_at: '2026-04-03T01:30:00Z' },
        ],
        decisions: [
          { id: 'DEC-CLI-001', role: 'dev', phase: 'implementation', statement: 'Use commander' },
        ],
      });

      writeJson(join(root, 'agentxchain-multi.json'), {
        schema_version: '0.1',
        project: { id: 'coord-drill', name: 'Coordinator Drill' },
        repos: {
          web: { path: './repos/web', default_branch: 'main', required: true },
          cli: { path: './repos/cli', default_branch: 'main', required: true },
        },
        workstreams: {
          sync: { phase: 'implementation', repos: ['web', 'cli'], entry_repo: 'web', depends_on: [], completion_barrier: 'all_repos_accepted' },
        },
        routing: { implementation: { entry_workstream: 'sync' } },
        gates: {},
        hooks: {},
      });
      writeJson(join(root, '.agentxchain', 'multirepo', 'state.json'), {
        schema_version: '0.1', super_run_id: 'srun_drill_001', project_id: 'coord-drill',
        status: 'active', phase: 'implementation',
        repo_runs: {
          web: { run_id: 'run_web-app_001', status: 'linked', phase: 'implementation' },
          cli: { run_id: 'run_cli-tool_001', status: 'initialized', phase: 'implementation' },
        },
        pending_gate: null, phase_gate_status: {},
        created_at: '2026-04-03T00:00:00Z', updated_at: '2026-04-03T00:00:00Z',
      });
      writeJson(join(root, '.agentxchain', 'multirepo', 'barriers.json'), {
        barrier_001: { workstream_id: 'sync', type: 'all_repos_accepted', status: 'pending', required_repos: ['web', 'cli'], satisfied_repos: [] },
      });
      writeJsonl(join(root, '.agentxchain', 'multirepo', 'history.jsonl'), [{ type: 'run_initialized', super_run_id: 'srun_drill_001' }]);
      writeJsonl(join(root, '.agentxchain', 'multirepo', 'decision-ledger.jsonl'), [{ id: 'DEC-COORD-001', statement: 'Ready.' }]);
      writeJsonl(join(root, '.agentxchain', 'multirepo', 'barrier-ledger.jsonl'), [{ barrier_id: 'barrier_001', to: 'pending' }]);

      const artifactPath = exportArtifact(root);

      // JSON drill-down assertions
      const jsonResult = runCli(root, ['report', '--input', artifactPath, '--format', 'json']);
      assert.equal(jsonResult.status, 0, jsonResult.stderr);
      const report = JSON.parse(jsonResult.stdout);

      const webRepo = report.subject.repos.find((r) => r.repo_id === 'web');
      const cliRepo = report.subject.repos.find((r) => r.repo_id === 'cli');

      // AT-COORD-DRILL-001: turns extracted
      assert.equal(webRepo.turns.length, 2, 'web repo should have 2 turns');
      assert.equal(webRepo.turns[0].role, 'dev');
      assert.equal(webRepo.turns[0].summary, 'Set up routes');
      assert.equal(webRepo.turns[1].summary, 'Add tests');
      assert.equal(cliRepo.turns.length, 1, 'cli repo should have 1 turn');
      assert.equal(cliRepo.turns[0].summary, 'Init CLI');

      // AT-COORD-DRILL-002: decisions extracted
      assert.equal(webRepo.decisions.length, 2, 'web repo should have 2 decisions');
      assert.equal(webRepo.decisions[0].id, 'DEC-WEB-001');
      assert.equal(webRepo.decisions[1].statement, 'Add health check');
      assert.equal(cliRepo.decisions.length, 1);
      assert.equal(cliRepo.decisions[0].id, 'DEC-CLI-001');

      // hook summary extracted for web (has hook audit), null for cli (no hooks)
      assert.ok(webRepo.hook_summary, 'web repo should have hook_summary');
      assert.equal(webRepo.hook_summary.total, 2);
      assert.equal(webRepo.hook_summary.blocked, 1);
      assert.equal(cliRepo.hook_summary, null, 'cli repo should have null hook_summary');

      // gate summary extracted for web
      assert.equal(webRepo.gate_summary.length, 2, 'web repo should have 2 gate outcomes');
      assert.equal(webRepo.gate_summary[0].gate_id, 'planning_signoff');
      assert.equal(webRepo.gate_summary[0].status, 'passed');

      // AT-COORD-DRILL-003: text output per-repo drill-down
      const textResult = runCli(root, ['report', '--input', artifactPath, '--format', 'text']);
      assert.equal(textResult.status, 0, textResult.stderr);
      assert.match(textResult.stdout, /Turn Timeline:/);
      assert.match(textResult.stdout, /Set up routes/);
      assert.match(textResult.stdout, /Add tests/);
      assert.match(textResult.stdout, /Init CLI/);
      assert.match(textResult.stdout, /Decisions:/);
      assert.match(textResult.stdout, /DEC-WEB-001/);
      assert.match(textResult.stdout, /DEC-CLI-001/);
      assert.match(textResult.stdout, /Hook Activity:/);
      assert.match(textResult.stdout, /Gate Outcomes:/);
      assert.match(textResult.stdout, /planning_signoff/);

      // AT-COORD-DRILL-004: markdown output per-repo headings and tables
      const mdResult = runCli(root, ['report', '--input', artifactPath, '--format', 'markdown']);
      assert.equal(mdResult.status, 0, mdResult.stderr);
      assert.match(mdResult.stdout, /### web/);
      assert.match(mdResult.stdout, /### cli/);
      assert.match(mdResult.stdout, /#### Turn Timeline/);
      assert.match(mdResult.stdout, /Set up routes/);
      assert.match(mdResult.stdout, /#### Decisions/);
      assert.match(mdResult.stdout, /\*\*DEC-WEB-001\*\*/);
      assert.match(mdResult.stdout, /#### Gate Outcomes/);
      assert.match(mdResult.stdout, /#### Hook Activity/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-COORD-DRILL-005: failed child repo has no drill-down fields', () => {
    const root = createCoordinatorWorkspace();
    try {
      const artifactPath = exportArtifact(root);
      // Tamper the export to simulate a failed child repo
      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
      artifact.repos.cli = { ok: false, path: './repos/cli', error: 'permission denied' };
      writeJson(artifactPath, artifact);

      const result = runCli(root, ['report', '--input', artifactPath, '--format', 'json']);
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);

      const failedRepo = report.subject.repos.find((r) => r.repo_id === 'cli');
      assert.equal(failedRepo.ok, false);
      assert.equal(failedRepo.error, 'permission denied');
      assert.equal(failedRepo.turns, undefined, 'failed repo must not have turns');
      assert.equal(failedRepo.decisions, undefined, 'failed repo must not have decisions');
      assert.equal(failedRepo.hook_summary, undefined, 'failed repo must not have hook_summary');
      assert.equal(failedRepo.gate_summary, undefined, 'failed repo must not have gate_summary');
      assert.equal(failedRepo.recovery_summary, undefined, 'failed repo must not have recovery_summary');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-COORD-DRILL-006: child repo with empty history has empty turns and no rendered section', () => {
    const root = mkdtempSync(join(tmpdir(), 'axc-report-coord-empty-'));
    try {
      createGovernedRepo(join(root, 'repos', 'empty'), 'empty-app', 'linked', {
        history: [],
        decisions: [],
      });
      writeJson(join(root, 'agentxchain-multi.json'), {
        schema_version: '0.1',
        project: { id: 'coord-empty', name: 'Coordinator Empty' },
        repos: { empty: { path: './repos/empty', default_branch: 'main', required: true } },
        workstreams: { sync: { phase: 'implementation', repos: ['empty'], entry_repo: 'empty', depends_on: [], completion_barrier: 'all_repos_accepted' } },
        routing: { implementation: { entry_workstream: 'sync' } },
        gates: {},
        hooks: {},
      });
      writeJson(join(root, '.agentxchain', 'multirepo', 'state.json'), {
        schema_version: '0.1', super_run_id: 'srun_empty_001', project_id: 'coord-empty',
        status: 'active', phase: 'implementation',
        repo_runs: { empty: { run_id: 'run_empty-app_001', status: 'linked', phase: 'implementation' } },
        pending_gate: null, phase_gate_status: {},
        created_at: '2026-04-03T00:00:00Z', updated_at: '2026-04-03T00:00:00Z',
      });
      writeJson(join(root, '.agentxchain', 'multirepo', 'barriers.json'), {});
      writeJsonl(join(root, '.agentxchain', 'multirepo', 'history.jsonl'), [{ type: 'run_initialized' }]);
      writeJsonl(join(root, '.agentxchain', 'multirepo', 'decision-ledger.jsonl'), []);
      writeJsonl(join(root, '.agentxchain', 'multirepo', 'barrier-ledger.jsonl'), []);

      const artifactPath = exportArtifact(root);
      const jsonResult = runCli(root, ['report', '--input', artifactPath, '--format', 'json']);
      assert.equal(jsonResult.status, 0, jsonResult.stderr);
      const report = JSON.parse(jsonResult.stdout);
      const emptyRepo = report.subject.repos.find((r) => r.repo_id === 'empty');
      assert.deepEqual(emptyRepo.turns, [], 'empty history produces empty turns');
      assert.deepEqual(emptyRepo.decisions, [], 'empty decisions produces empty array');
      assert.equal(emptyRepo.hook_summary, null, 'no hooks produces null');

      const mdResult = runCli(root, ['report', '--input', artifactPath, '--format', 'markdown']);
      assert.equal(mdResult.status, 0, mdResult.stderr);
      assert.doesNotMatch(mdResult.stdout, /#### Turn Timeline/, 'empty history must not render timeline');
      assert.doesNotMatch(mdResult.stdout, /#### Decisions/, 'empty decisions must not render section');
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

  it('AT-REPORT-008: report surfaces warn-mode budget state across all formats', () => {
    const root = createGovernedProject();
    try {
      // Patch state to include warn-mode budget fields
      const statePath = join(root, '.agentxchain', 'state.json');
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      state.budget_status = {
        spent_usd: 12.50,
        remaining_usd: -2.50,
        warn_mode: true,
        exhausted: true,
        exhausted_at: '2026-04-11T20:00:00.000Z',
        exhausted_after_turn: 'turn_001',
      };
      writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');

      const artifactPath = exportArtifact(root, 'warn-artifact.json');

      // Text format must show [OVER BUDGET]
      const textResult = runCli(root, ['report', '--input', artifactPath]);
      assert.equal(textResult.status, 0, textResult.stderr);
      assert.match(textResult.stdout, /Budget: spent \$12\.50, remaining \$-2\.50 \[OVER BUDGET\]/);

      // JSON format must preserve warn_mode and exhaustion fields
      const jsonResult = runCli(root, ['report', '--input', artifactPath, '--format', 'json']);
      assert.equal(jsonResult.status, 0, jsonResult.stderr);
      const report = JSON.parse(jsonResult.stdout);
      assert.equal(report.subject.run.budget_status.warn_mode, true);
      assert.equal(report.subject.run.budget_status.exhausted, true);
      assert.equal(report.subject.run.budget_status.exhausted_at, '2026-04-11T20:00:00.000Z');
      assert.equal(report.subject.run.budget_status.exhausted_after_turn, 'turn_001');

      // Markdown format must show **[OVER BUDGET]**
      const mdResult = runCli(root, ['report', '--input', artifactPath, '--format', 'markdown']);
      assert.equal(mdResult.status, 0, mdResult.stderr);
      assert.match(mdResult.stdout, /Budget: spent \$12\.50, remaining \$-2\.50 \*\*\[OVER BUDGET\]\*\*/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-REPORT-DEL-001/002/003: report surfaces delegation summary across json, text, and markdown', () => {
    const root = createGovernedProject();
    try {
      writeDelegationHistory(root);
      const artifactPath = exportArtifact(root, 'delegation-artifact.json');

      const jsonResult = runCli(root, ['report', '--input', artifactPath, '--format', 'json']);
      assert.equal(jsonResult.status, 0, jsonResult.stderr);
      const report = JSON.parse(jsonResult.stdout);
      assert.deepEqual(report.subject.run.delegation_summary, {
        total_delegations_issued: 2,
        delegation_chains: [
          {
            parent_turn_id: 'turn_010',
            parent_role: 'director',
            delegations: [
              {
                delegation_id: 'del-001',
                to_role: 'dev',
                charter: 'Build the API',
                required_decision_ids: ['DEC-101'],
                satisfied_decision_ids: ['DEC-101'],
                missing_decision_ids: [],
                status: 'completed',
                child_turn_id: 'turn_011',
              },
              {
                delegation_id: 'del-002',
                to_role: 'qa',
                charter: 'Test the API',
                required_decision_ids: ['DEC-201'],
                satisfied_decision_ids: [],
                missing_decision_ids: ['DEC-201'],
                status: 'failed',
                child_turn_id: 'turn_012',
              },
            ],
            review_turn_id: 'turn_013',
            outcome: 'mixed',
          },
        ],
      });

      const textResult = runCli(root, ['report', '--input', artifactPath, '--format', 'text']);
      assert.equal(textResult.status, 0, textResult.stderr);
      assert.match(textResult.stdout, /Delegation Summary:/);
      assert.match(textResult.stdout, /Total delegations issued: 2/);
      assert.match(textResult.stdout, /director \(turn_010\) \| outcome: mixed \| review: turn_013/);
      assert.match(textResult.stdout, /del-001 -> dev \| completed \| child: turn_011 \| Build the API/);
      assert.match(textResult.stdout, /required decisions: DEC-101/);
      assert.match(textResult.stdout, /del-002 -> qa \| failed \| child: turn_012 \| Test the API/);
      assert.match(textResult.stdout, /missing decisions: DEC-201/);

      const markdownResult = runCli(root, ['report', '--input', artifactPath, '--format', 'markdown']);
      assert.equal(markdownResult.status, 0, markdownResult.stderr);
      assert.match(markdownResult.stdout, /## Delegation Summary/);
      assert.match(markdownResult.stdout, /\| Parent Role \| Parent Turn \| Outcome \| Review Turn \| Delegation \| Child Turn \| Status \| Required Decisions \| Missing Decisions \| Charter \|/);
      assert.match(markdownResult.stdout, /\| director \| `turn_010` \| `mixed` \| `turn_013` \| `del-001` → `dev` \| `turn_011` \| `completed` \| DEC-101 \| — \| Build the API \|/);
      assert.match(markdownResult.stdout, /\|  \|  \|  \|  \| `del-002` → `qa` \| `turn_012` \| `failed` \| DEC-201 \| DEC-201 \| Test the API \|/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-REPORT-DASH-001/002/003: report surfaces dashboard session snapshot truthfully', () => {
    const root = createGovernedProject();
    try {
      let artifactPath = exportArtifact(root, 'dashboard-none.json');
      let jsonResult = runCli(root, ['report', '--input', artifactPath, '--format', 'json']);
      assert.equal(jsonResult.status, 0, jsonResult.stderr);
      let report = JSON.parse(jsonResult.stdout);
      assert.deepEqual(report.subject.run.dashboard_session, {
        status: 'not_running',
        pid: null,
        url: null,
        started_at: null,
      });

      writeFileSync(join(root, '.agentxchain-dashboard.pid'), `${process.pid}\n`);
      writeJson(join(root, '.agentxchain-dashboard.json'), {
        pid: process.pid,
        port: 3847,
        url: 'http://localhost:3847',
        started_at: '2026-04-14T12:35:00.000Z',
      });

      artifactPath = exportArtifact(root, 'dashboard-running.json');
      jsonResult = runCli(root, ['report', '--input', artifactPath, '--format', 'json']);
      assert.equal(jsonResult.status, 0, jsonResult.stderr);
      report = JSON.parse(jsonResult.stdout);
      assert.deepEqual(report.subject.run.dashboard_session, {
        status: 'running',
        pid: process.pid,
        url: 'http://localhost:3847',
        started_at: '2026-04-14T12:35:00.000Z',
      });

      const textResult = runCli(root, ['report', '--input', artifactPath, '--format', 'text']);
      assert.equal(textResult.status, 0, textResult.stderr);
      assert.match(textResult.stdout, /Dashboard session: running at http:\/\/localhost:3847 \(PID: /);

      const markdownResult = runCli(root, ['report', '--input', artifactPath, '--format', 'markdown']);
      assert.equal(markdownResult.status, 0, markdownResult.stderr);
      assert.match(markdownResult.stdout, /- Dashboard session: `running at http:\/\/localhost:3847 \(PID: /);

      const legacyArtifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
      delete legacyArtifact.summary.dashboard_session;
      const legacyPath = join(root, 'dashboard-legacy.json');
      writeJson(legacyPath, legacyArtifact);

      jsonResult = runCli(root, ['report', '--input', legacyPath, '--format', 'json']);
      assert.equal(jsonResult.status, 0, jsonResult.stderr);
      report = JSON.parse(jsonResult.stdout);
      assert.equal(report.subject.run.dashboard_session, null);
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
