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

import {
  buildGovernanceReport,
  formatGovernanceReportHtml,
} from '../src/lib/report.js';

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
  const root = mkdtempSync(join(tmpdir(), 'axc-report-html-'));
  mkdirSync(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'staging', 'turn_001'), { recursive: true });

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: 'html-test', name: 'HTML Report Test', default_branch: 'main' },
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
    project_id: 'html-test',
    run_id: 'run_html_001',
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
    phase_gate_status: { implementation_complete: 'passed' },
    budget_status: { spent_usd: 1.5, remaining_usd: 8.5 },
    protocol_mode: 'governed',
    created_at: '2026-04-14T00:00:00.000Z',
  });

  writeJsonl(join(root, '.agentxchain', 'history.jsonl'), [
    {
      turn_id: 'turn_001', role: 'dev', status: 'completed',
      summary: 'Implemented HTML report format',
      decisions: [{ id: 'DEC-HTML-001' }], objections: [],
      files_changed: ['src/report.js', 'src/commands/report.js'],
      cost: { total_usd: 0.25, input_tokens: 5000, output_tokens: 3000 },
      started_at: '2026-04-14T00:01:00.000Z',
      duration_ms: 60000,
      accepted_at: '2026-04-14T00:02:00.000Z',
      accepted_sequence: 1,
    },
  ]);

  writeJsonl(join(root, '.agentxchain', 'decision-ledger.jsonl'), [
    { id: 'DEC-HTML-001', turn_id: 'turn_001', role: 'dev', phase: 'implementation', statement: 'Ship HTML report format.' },
  ]);

  writeFileSync(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001', 'PROMPT.md'), '# Prompt\n');
  writeJson(join(root, '.agentxchain', 'staging', 'turn_001', 'turn-result.json'), {
    turn_id: 'turn_001',
    status: 'completed',
  });

  return root;
}

function createCoordinatorWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'axc-report-html-coord-'));
  const repoRoot = join(root, 'repos', 'web');
  mkdirSync(join(repoRoot, '.agentxchain'), { recursive: true });

  writeJson(join(repoRoot, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: 'web-app', name: 'web-app', default_branch: 'main' },
    roles: { dev: { title: 'Dev', mandate: 'Build.', write_authority: 'authoritative', runtime: 'local-dev' } },
    runtimes: { 'local-dev': { type: 'local_cli', command: ['echo'], prompt_transport: 'argv' } },
    routing: { implementation: { entry_role: 'dev', allowed_next_roles: ['dev'] } },
    gates: {},
    hooks: {},
  });
  writeJson(join(repoRoot, '.agentxchain', 'state.json'), {
    schema_version: '1.1', project_id: 'web-app', run_id: 'run_web_001',
    status: 'blocked', phase: 'implementation', active_turns: {}, retained_turns: {},
    turn_sequence: 0, blocked_on: 'operator_escalation', phase_gate_status: { implementation_complete: 'failed' }, budget_status: {},
    protocol_mode: 'governed',
    blocked_reason: {
      category: 'operator_escalation',
      blocked_at: '2026-04-14T00:07:00Z',
      turn_id: 't1',
      recovery: {
        typed_reason: 'approval_policy_blocked',
        owner: 'operator',
        recovery_action: 'agentxchain approve-transition',
        detail: 'Release approval still required.',
        turn_retained: true,
      },
    },
  });
  writeJsonl(join(repoRoot, '.agentxchain', 'history.jsonl'), [{
    turn_id: 't1',
    role: 'dev',
    status: 'completed',
    summary: 'Prepared release candidate.',
    accepted_at: '2026-04-14T00:05:00Z',
  }]);
  writeJsonl(join(repoRoot, '.agentxchain', 'decision-ledger.jsonl'), [
    { id: 'DEC-1', statement: 'Ready.' },
    {
      type: 'approval_policy',
      action: 'blocked',
      gate_type: 'phase_transition',
      from_phase: 'implementation',
      to_phase: 'release',
      reason: 'Release approval still required.',
      timestamp: '2026-04-14T00:06:00Z',
    },
    {
      decision: 'operator_escalated',
      role: 'dev',
      phase: 'implementation',
      blocked_on: 'operator_escalation',
      escalation: { reason: 'Need release approval before handoff.' },
      timestamp: '2026-04-14T00:07:00Z',
    },
    {
      type: 'timeout_warning',
      scope: 'run',
      phase: 'implementation',
      limit_minutes: 30,
      elapsed_minutes: 35,
      exceeded_by_minutes: 5,
      action: 'notify',
      timestamp: '2026-04-14T00:08:00Z',
    },
  ]);
  writeJsonl(join(repoRoot, '.agentxchain', 'hook-audit.jsonl'), [
    { event: 'before_step', result: 'allowed' },
    { event: 'before_transition', result: 'blocked', blocked: true },
  ]);
  writeJson(join(repoRoot, '.agentxchain', 'session.json'), {
    session_id: 'session_web_html',
    run_id: 'run_web_old',
    started_at: '2026-04-14T00:00:00Z',
    last_checkpoint_at: '2026-04-14T00:09:00Z',
    last_turn_id: 't1',
    last_phase: 'implementation',
    last_role: 'dev',
    checkpoint_reason: 'awaiting_operator',
  });

  writeJson(join(root, 'agentxchain-multi.json'), {
    schema_version: '0.1',
    project: { id: 'coord-html', name: 'Coordinator HTML' },
    repos: {
      web: { path: './repos/web', default_branch: 'main', required: true },
      cli: { path: './repos/cli', default_branch: 'main', required: true },
    },
    workstreams: { sync: { phase: 'implementation', repos: ['web', 'cli'], entry_repo: 'web', depends_on: [], completion_barrier: 'all_repos_accepted' } },
    routing: { implementation: { entry_workstream: 'sync' } },
    gates: {},
    hooks: {},
  });
  writeJson(join(root, '.agentxchain', 'multirepo', 'state.json'), {
    schema_version: '0.1', super_run_id: 'srun_001', project_id: 'coord-html',
    status: 'active', phase: 'implementation',
    repo_runs: {
      web: { run_id: 'run_web_001', status: 'linked', phase: 'implementation' },
      cli: { run_id: 'run_cli_001', status: 'initialized', phase: 'implementation' },
    },
    pending_gate: null, phase_gate_status: {},
    created_at: '2026-04-14T00:00:00Z', updated_at: '2026-04-14T00:00:00Z',
  });
  writeJson(join(root, '.agentxchain', 'multirepo', 'barriers.json'), {
    barrier_001: { workstream_id: 'sync', type: 'all_repos_accepted', status: 'pending', required_repos: ['web', 'cli'], satisfied_repos: [] },
  });
  writeJsonl(join(root, '.agentxchain', 'multirepo', 'history.jsonl'), [{ type: 'run_initialized' }]);
  writeJsonl(join(root, '.agentxchain', 'multirepo', 'decision-ledger.jsonl'), [{ id: 'DEC-C1', statement: 'Go.' }]);
  writeJsonl(join(root, '.agentxchain', 'multirepo', 'barrier-ledger.jsonl'), [{ barrier_id: 'barrier_001', to: 'pending' }]);

  return root;
}

function exportArtifact(root, fileName = 'artifact.json') {
  const result = runCli(root, ['export', '--output', fileName]);
  assert.equal(result.status, 0, result.stderr);
  return join(root, fileName);
}

describe('HTML governance report', () => {
  it('AT-HTML-001: report --format html accepted and produces HTML output', () => {
    const root = createGovernedProject();
    try {
      const artifactPath = exportArtifact(root);
      const result = runCli(root, ['report', '--input', artifactPath, '--format', 'html']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /<!DOCTYPE html>/);
      assert.match(result.stdout, /<html/);
      assert.match(result.stdout, /AgentXchain Governance Report/);
    } finally {
      try { rmSync(root, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('AT-HTML-002: HTML contains project, run, and turn data', () => {
    const root = createGovernedProject();
    try {
      const artifactPath = exportArtifact(root);
      const result = runCli(root, ['report', '--input', artifactPath, '--format', 'html']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /html-test/);
      assert.match(result.stdout, /HTML Report Test/);
      assert.match(result.stdout, /run_html_001/);
      assert.match(result.stdout, /Implemented HTML report format/);
      assert.match(result.stdout, /DEC-HTML-001/);
    } finally {
      try { rmSync(root, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('AT-HTML-003: HTML contains cost summary with role/phase tables', () => {
    const root = createGovernedProject();
    try {
      const artifactPath = exportArtifact(root);
      const result = runCli(root, ['report', '--input', artifactPath, '--format', 'html']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Cost Summary/);
      assert.match(result.stdout, /\$0\.25/);
      assert.match(result.stdout, /\$1\.50/); // budget spent
    } finally {
      try { rmSync(root, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('AT-HTML-004: HTML is self-contained (no external references)', () => {
    const root = createGovernedProject();
    try {
      const artifactPath = exportArtifact(root);
      const result = runCli(root, ['report', '--input', artifactPath, '--format', 'html']);
      assert.equal(result.status, 0, result.stderr);
      // Must have inline styles
      assert.match(result.stdout, /<style>/);
      // Must NOT reference external CSS/JS
      assert.doesNotMatch(result.stdout, /href="http/);
      assert.doesNotMatch(result.stdout, /src="http/);
    } finally {
      try { rmSync(root, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('AT-HTML-005: error report renders error badge', () => {
    const errorReport = {
      overall: 'error',
      input: 'test.json',
      message: 'File not found',
    };
    const html = formatGovernanceReportHtml(errorReport);
    assert.match(html, /<!DOCTYPE html>/);
    assert.match(html, /error/);
    assert.match(html, /File not found/);
  });

  it('AT-HTML-006: fail report renders verification errors', () => {
    const failReport = {
      overall: 'fail',
      input: 'bad.json',
      message: 'Verification failed',
      verification: { errors: ['Missing state.json', 'Invalid schema'] },
    };
    const html = formatGovernanceReportHtml(failReport);
    assert.match(html, /<!DOCTYPE html>/);
    assert.match(html, /fail/);
    assert.match(html, /Missing state\.json/);
    assert.match(html, /Invalid schema/);
  });

  it('AT-HTML-007: coordinator export produces HTML', () => {
    const root = createCoordinatorWorkspace();
    try {
      const artifactPath = exportArtifact(root);
      const result = runCli(root, ['report', '--input', artifactPath, '--format', 'html']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /<!DOCTYPE html>/);
      assert.match(result.stdout, /coord-html/);
      assert.match(result.stdout, /Coordinator HTML/);
      assert.match(result.stdout, /Barrier Summary/);
      assert.match(result.stdout, /barrier_001/);
      assert.match(result.stdout, /Repo Details/);
      // Repo ID in coordinator config is "web" (not project.id "web-app")
      assert.match(result.stdout, /web/);
    } finally {
      try { rmSync(root, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('AT-HTML-008: HTML escapes special characters', () => {
    const errorReport = {
      overall: 'error',
      input: '<script>alert("xss")</script>',
      message: 'Bad & dangerous <input>',
    };
    const html = formatGovernanceReportHtml(errorReport);
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /Bad &amp; dangerous/);
  });

  it('AT-HTML-009: --help shows html as a format option', () => {
    const result = runCli(process.cwd(), ['report', '--help']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /html/);
  });

  it('AT-HTML-010: HTML has dark mode and print CSS', () => {
    const root = createGovernedProject();
    try {
      const artifactPath = exportArtifact(root);
      const result = runCli(root, ['report', '--input', artifactPath, '--format', 'html']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /prefers-color-scheme:dark/);
      assert.match(result.stdout, /@media print/);
    } finally {
      try { rmSync(root, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('AT-HTML-011: gate outcomes render with status badges', () => {
    const root = createGovernedProject();
    try {
      const artifactPath = exportArtifact(root);
      const result = runCli(root, ['report', '--input', artifactPath, '--format', 'html']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Gate Outcomes/);
      assert.match(result.stdout, /implementation_complete/);
    } finally {
      try { rmSync(root, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('AT-HTML-012: partial coordinator html keeps export health, failed repo row, and successful child drill-down sections', () => {
    const root = createCoordinatorWorkspace();
    const childRoot = createGovernedProject();
    try {
      const artifactPath = exportArtifact(root);
      writeJson(join(childRoot, '.agentxchain', 'state.json'), {
        schema_version: '1.1',
        project_id: 'html-test',
        run_id: 'run_web_001',
        status: 'blocked',
        phase: 'implementation',
        active_turns: {},
        retained_turns: {},
        turn_sequence: 1,
        blocked_on: 'operator_escalation',
        phase_gate_status: { implementation_complete: 'failed' },
        budget_status: { spent_usd: 1.5, remaining_usd: 8.5 },
        protocol_mode: 'governed',
        created_at: '2026-04-14T00:00:00.000Z',
        blocked_reason: {
          category: 'operator_escalation',
          blocked_at: '2026-04-14T00:07:00Z',
          turn_id: 'turn_001',
          recovery: {
            typed_reason: 'approval_policy_blocked',
            owner: 'operator',
            recovery_action: 'agentxchain approve-transition',
            detail: 'Release approval still required.',
            turn_retained: true,
          },
        },
      });
      writeJsonl(join(childRoot, '.agentxchain', 'decision-ledger.jsonl'), [
        { id: 'DEC-HTML-001', turn_id: 'turn_001', role: 'dev', phase: 'implementation', statement: 'Ship HTML report format.' },
        {
          type: 'approval_policy',
          action: 'blocked',
          gate_type: 'phase_transition',
          from_phase: 'implementation',
          to_phase: 'release',
          reason: 'Release approval still required.',
          timestamp: '2026-04-14T00:06:00Z',
        },
        {
          decision: 'operator_escalated',
          role: 'dev',
          phase: 'implementation',
          blocked_on: 'operator_escalation',
          escalation: { reason: 'Need release approval before handoff.' },
          timestamp: '2026-04-14T00:07:00Z',
        },
        {
          type: 'timeout_warning',
          scope: 'run',
          phase: 'implementation',
          limit_minutes: 30,
          elapsed_minutes: 35,
          exceeded_by_minutes: 5,
          action: 'notify',
          timestamp: '2026-04-14T00:08:00Z',
        },
      ]);
      writeJsonl(join(childRoot, '.agentxchain', 'hook-audit.jsonl'), [
        { event: 'before_step', result: 'allowed' },
        { event: 'before_transition', result: 'blocked', blocked: true },
      ]);
      writeJson(join(childRoot, '.agentxchain', 'session.json'), {
        session_id: 'session_web_html',
        run_id: 'run_web_old',
        started_at: '2026-04-14T00:00:00Z',
        last_checkpoint_at: '2026-04-14T00:09:00Z',
        last_turn_id: 'turn_001',
        last_phase: 'implementation',
        last_role: 'dev',
        checkpoint_reason: 'awaiting_operator',
      });
      const childArtifactPath = exportArtifact(childRoot);
      const childArtifact = JSON.parse(readFileSync(childArtifactPath, 'utf8'));
      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
      artifact.repos.web = { ok: true, path: './repos/web', export: childArtifact };
      artifact.repos.cli = { ok: false, path: './repos/cli', error: 'permission denied' };
      writeJson(artifactPath, artifact);

      const result = runCli(root, ['report', '--input', artifactPath, '--format', 'html']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /2 total, 1 exported, 1 failed/);
      assert.match(result.stdout, /permission denied/);
      assert.match(result.stdout, /<h4>Approval Policy<\/h4>/);
      assert.match(result.stdout, /<h4>Governance Events<\/h4>/);
      assert.match(result.stdout, /<h4>Timeout Events<\/h4>/);
      assert.match(result.stdout, /<h4>Hook Activity<\/h4>/);
      assert.match(result.stdout, /<h4>Recovery<\/h4>/);
      assert.match(result.stdout, /<h4>Continuity<\/h4>/);
      assert.match(result.stdout, /checkpoint tracks run <code>run_web_old<\/code>, but repo export tracks <code>run_web_001<\/code>/);

      const failedRepoBlock = result.stdout.match(/<h3>cli<\/h3>([\s\S]*?)<h3>web<\/h3>/);
      assert.ok(failedRepoBlock, 'failed repo block must be isolated before the next repo');
      assert.doesNotMatch(failedRepoBlock[1], /<h4>Turn Timeline<\/h4>/);
      assert.doesNotMatch(failedRepoBlock[1], /<h4>Decisions<\/h4>/);
      assert.doesNotMatch(failedRepoBlock[1], /<h4>Gate Outcomes<\/h4>/);
      assert.doesNotMatch(failedRepoBlock[1], /<h4>Hook Activity<\/h4>/);
      assert.doesNotMatch(failedRepoBlock[1], /<h4>Recovery<\/h4>/);
      assert.doesNotMatch(failedRepoBlock[1], /<h4>Continuity<\/h4>/);
    } finally {
      try { rmSync(root, { recursive: true }); } catch { /* ignore */ }
      try { rmSync(childRoot, { recursive: true }); } catch { /* ignore */ }
    }
  });
});
