import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const tempDirs = new Set();

function createGovernedProject(watchRoutes = []) {
  const dir = join(tmpdir(), `axc-watch-start-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.add(dir);

  const config = {
    schema_version: '1.0',
    protocol_mode: 'governed',
    project: { id: 'watch-start-test', name: 'Watch Auto-Start Test' },
    roles: {
      pm: {
        title: 'PM',
        mandate: 'Plan work',
        write_authority: 'review_only',
        runtime: 'manual-pm',
      },
      dev: {
        title: 'Dev',
        mandate: 'Build work',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
      qa: {
        title: 'QA',
        mandate: 'Verify work',
        write_authority: 'review_only',
        runtime: 'manual-qa',
      },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'local-dev': { type: 'local_cli', command: ['echo', 'dev'], cwd: '.' },
      'manual-qa': { type: 'manual' },
    },
    routing: {
      planning: {
        entry_role: 'pm',
        allowed_next_roles: ['pm', 'dev', 'qa'],
        max_concurrent_turns: 1,
      },
    },
    watch: { routes: watchRoutes },
    rules: {
      challenge_required: true,
      max_turn_retries: 2,
      max_deadlock_cycles: 2,
    },
  };

  const state = {
    schema_version: '1.0',
    run_id: null,
    project_id: 'watch-start-test',
    status: 'idle',
    phase: 'planning',
    accepted_integration_ref: null,
    active_turns: {},
    turn_sequence: 0,
    last_completed_turn_id: null,
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
    phase_gate_status: {
      planning_signoff: 'pending',
    },
  };

  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
  mkdirSync(join(dir, '.agentxchain', 'dispatch', 'turns'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(dir, '.planning'), { recursive: true });
  writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2));
  writeFileSync(join(dir, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(dir, '.agentxchain', 'decision-ledger.jsonl'), '');
  return dir;
}

function writeJson(dir, name, value) {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value, null, 2));
  return path;
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function githubPrOpened() {
  return {
    action: 'opened',
    repository: { full_name: 'acme/widgets' },
    pull_request: {
      number: 42,
      title: 'Add governed review',
      html_url: 'https://github.com/acme/widgets/pull/42',
      head: { ref: 'feature/review', sha: 'abc123' },
      base: { ref: 'main' },
      draft: false,
    },
  };
}

function githubWorkflowFailed() {
  return {
    action: 'completed',
    repository: { full_name: 'acme/widgets' },
    workflow_run: {
      id: 99,
      run_number: 12,
      name: 'CI',
      status: 'completed',
      conclusion: 'failure',
      html_url: 'https://github.com/acme/widgets/actions/runs/99',
      head_branch: 'feature/review',
      head_sha: 'abc123',
    },
  };
}

afterEach(() => {
  for (const dir of [...tempDirs]) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    tempDirs.delete(dir);
  }
});

describe('watch auto_start — Slice 4', () => {
  it('AT-WATCH-START-001: auto_start plans and starts a governed run', () => {
    const dir = createGovernedProject([
      {
        match: { category: 'github_workflow_run_failed' },
        triage: {
          priority: 'p0',
          template: 'generic',
          charter: 'Fix failed CI: {{workflow_name}} ({{conclusion}})',
          acceptance_contract: ['CI workflow passes after fix'],
        },
        auto_approve: true,
        auto_start: true,
        preferred_role: 'dev',
      },
    ]);
    const eventFile = writeJson(dir, 'ci-failed.json', githubWorkflowFailed());

    const result = runCli(dir, ['watch', '--event-file', eventFile, '--json']);
    assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);

    assert.equal(parsed.routed.triaged, true);
    assert.equal(parsed.routed.approved, true);
    assert.equal(parsed.routed.planned, true);
    assert.equal(parsed.routed.started, true);
    assert.equal(parsed.intent.status, 'executing');
    assert.ok(parsed.routed.role, 'should have a dispatch role');

    // Verify governed state was initialized
    const state = JSON.parse(readFileSync(join(dir, '.agentxchain', 'state.json'), 'utf8'));
    assert.ok(state.run_id, 'run should be initialized');
    assert.ok(Object.keys(state.active_turns).length > 0, 'should have active turn');

    // Verify turn was assigned the preferred role
    const turnId = Object.keys(state.active_turns)[0];
    assert.equal(state.active_turns[turnId].assigned_role, 'dev');
  });

  it('AT-WATCH-START-002: auto_start without auto_approve is skipped', () => {
    const dir = createGovernedProject([
      {
        match: { category: 'github_pull_request_opened' },
        triage: {
          priority: 'p1',
          template: 'generic',
          charter: 'Review PR #{{number}}',
          acceptance_contract: ['PR reviewed'],
        },
        auto_approve: false,
        auto_start: true,
        preferred_role: 'qa',
      },
    ]);
    const eventFile = writeJson(dir, 'pr-opened.json', githubPrOpened());

    const result = runCli(dir, ['watch', '--event-file', eventFile, '--json']);
    assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);

    assert.equal(parsed.routed.triaged, true);
    assert.equal(parsed.routed.approved, false);
    assert.equal(parsed.routed.auto_start_skipped, 'requires auto_approve');
    assert.equal(parsed.intent.status, 'triaged');
  });

  it('AT-WATCH-START-003: auto_start with invalid template fails at triage, auto_start never reached', () => {
    const dir = createGovernedProject([
      {
        match: { category: 'github_pull_request_opened' },
        triage: {
          priority: 'p1',
          template: 'nonexistent-template-xyz',
          charter: 'Review PR #{{number}}',
          acceptance_contract: ['PR reviewed'],
        },
        auto_approve: true,
        auto_start: true,
        preferred_role: 'qa',
      },
    ]);
    const eventFile = writeJson(dir, 'pr-opened.json', githubPrOpened());

    const result = runCli(dir, ['watch', '--event-file', eventFile, '--json']);
    assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);

    // Route matched but triage validation rejected the bad template,
    // so routed is never set (triage failed before routing could be recorded)
    assert.equal(parsed.routed, undefined);
    assert.equal(parsed.intent.status, 'detected');
  });

  it('AT-WATCH-START-004: auto_start with active turns reports start error', () => {
    const dir = createGovernedProject([
      {
        match: { category: 'github_workflow_run_failed' },
        triage: {
          priority: 'p0',
          template: 'generic',
          charter: 'Fix CI: {{workflow_name}}',
          acceptance_contract: ['CI passes'],
        },
        auto_approve: true,
        auto_start: true,
        preferred_role: 'dev',
      },
    ]);

    // First event auto-starts successfully, creating an active turn
    const firstEvent = writeJson(dir, 'ci-failed-1.json', githubWorkflowFailed());
    const first = runCli(dir, ['watch', '--event-file', firstEvent, '--json']);
    assert.equal(first.status, 0, `first stdout: ${first.stdout}\nfirst stderr: ${first.stderr}`);
    const firstParsed = JSON.parse(first.stdout);
    assert.equal(firstParsed.routed.started, true, 'first event should auto-start');

    // Second event (different payload to avoid dedup) tries to auto-start but active turns exist
    const secondPayload = {
      ...githubWorkflowFailed(),
      workflow_run: {
        ...githubWorkflowFailed().workflow_run,
        id: 100,
        run_number: 13,
        name: 'Deploy',
      },
    };
    const secondEvent = writeJson(dir, 'ci-failed-2.json', secondPayload);
    const second = runCli(dir, ['watch', '--event-file', secondEvent, '--json']);
    assert.equal(second.status, 0, `second stdout: ${second.stdout}\nsecond stderr: ${second.stderr}`);
    const secondParsed = JSON.parse(second.stdout);

    assert.equal(secondParsed.routed.approved, true);
    assert.equal(secondParsed.routed.planned, true);
    assert.equal(secondParsed.routed.started, false);
    assert.ok(secondParsed.routed.auto_start_error, 'should have auto_start_error about active turns');
    assert.match(secondParsed.routed.auto_start_error, /active turn|cannot start/i);
  });

  it('AT-WATCH-START-008: auto_start preserves existing planning artifacts by default', () => {
    const dir = createGovernedProject([
      {
        match: { category: 'github_workflow_run_failed' },
        triage: {
          priority: 'p0',
          template: 'api-service',
          charter: 'Fix API CI: {{workflow_name}}',
          acceptance_contract: ['API CI passes'],
        },
        auto_approve: true,
        auto_start: true,
        preferred_role: 'dev',
      },
    ]);
    const existingContent = '# Operator Planning\n\nDo not overwrite this work.\n';
    writeFileSync(join(dir, '.planning', 'api-contract.md'), existingContent);
    const eventFile = writeJson(dir, 'ci-failed.json', githubWorkflowFailed());

    const result = runCli(dir, ['watch', '--event-file', eventFile, '--json']);
    assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);

    assert.equal(parsed.routed.approved, true);
    assert.equal(parsed.routed.planned, false);
    assert.equal(parsed.routed.started, false);
    assert.match(parsed.routed.auto_start_error, /existing planning artifacts would be overwritten/);
    assert.equal(parsed.intent.status, 'approved');
    assert.equal(readFileSync(join(dir, '.planning', 'api-contract.md'), 'utf8'), existingContent);
  });

  it('AT-WATCH-START-009: auto_start overwrites planning artifacts only when explicitly enabled', () => {
    const dir = createGovernedProject([
      {
        match: { category: 'github_workflow_run_failed' },
        triage: {
          priority: 'p0',
          template: 'api-service',
          charter: 'Fix API CI: {{workflow_name}}',
          acceptance_contract: ['API CI passes'],
        },
        auto_approve: true,
        auto_start: true,
        overwrite_planning_artifacts: true,
        preferred_role: 'dev',
      },
    ]);
    writeFileSync(join(dir, '.planning', 'api-contract.md'), '# Operator Planning\n\nOld work.\n');
    const eventFile = writeJson(dir, 'ci-failed.json', githubWorkflowFailed());

    const result = runCli(dir, ['watch', '--event-file', eventFile, '--json']);
    assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);

    assert.equal(parsed.routed.planned, true);
    assert.equal(parsed.routed.started, true);
    assert.equal(parsed.intent.status, 'executing');
    assert.match(readFileSync(join(dir, '.planning', 'api-contract.md'), 'utf8'), /# API Contract/);
  });

  it('AT-WATCH-START-005: auto_start with preferred_role dispatches that role', () => {
    const dir = createGovernedProject([
      {
        match: { category: 'github_pull_request_opened' },
        triage: {
          priority: 'p1',
          template: 'generic',
          charter: 'Review PR #{{number}} — {{title}}',
          acceptance_contract: ['PR reviewed'],
        },
        auto_approve: true,
        auto_start: true,
        preferred_role: 'qa',
      },
    ]);
    const eventFile = writeJson(dir, 'pr-opened.json', githubPrOpened());

    const result = runCli(dir, ['watch', '--event-file', eventFile, '--json']);
    assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);

    assert.equal(parsed.routed.started, true);
    assert.equal(parsed.routed.role, 'qa');

    const state = JSON.parse(readFileSync(join(dir, '.agentxchain', 'state.json'), 'utf8'));
    const turnId = Object.keys(state.active_turns)[0];
    assert.equal(state.active_turns[turnId].assigned_role, 'qa');
  });

  it('AT-WATCH-START-006: deduplicated events skip auto_start', () => {
    const dir = createGovernedProject([
      {
        match: { category: 'github_workflow_run_failed' },
        triage: {
          priority: 'p0',
          template: 'generic',
          charter: 'Fix CI',
          acceptance_contract: ['CI passes'],
        },
        auto_approve: true,
        auto_start: true,
        preferred_role: 'dev',
      },
    ]);
    const eventFile = writeJson(dir, 'ci-failed.json', githubWorkflowFailed());

    // First call — should auto_start
    const first = runCli(dir, ['watch', '--event-file', eventFile, '--json']);
    assert.equal(first.status, 0, `stdout: ${first.stdout}\nstderr: ${first.stderr}`);
    const firstParsed = JSON.parse(first.stdout);
    assert.equal(firstParsed.routed.started, true);

    // Second call — deduplicated, should NOT auto_start
    const second = runCli(dir, ['watch', '--event-file', eventFile, '--json']);
    assert.equal(second.status, 0, `stdout: ${second.stdout}\nstderr: ${second.stderr}`);
    const secondParsed = JSON.parse(second.stdout);
    assert.equal(secondParsed.deduplicated, true);
    assert.equal(secondParsed.routed, undefined);
  });

  it('AT-WATCH-START-007: dry-run with auto_start does not plan or start', () => {
    const dir = createGovernedProject([
      {
        match: { category: 'github_workflow_run_failed' },
        triage: {
          priority: 'p0',
          template: 'generic',
          charter: 'Fix CI',
          acceptance_contract: ['CI passes'],
        },
        auto_approve: true,
        auto_start: true,
        preferred_role: 'dev',
      },
    ]);
    const eventFile = writeJson(dir, 'ci-failed.json', githubWorkflowFailed());

    const result = runCli(dir, ['watch', '--event-file', eventFile, '--dry-run', '--json']);
    assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // State should still be idle
    const state = JSON.parse(readFileSync(join(dir, '.agentxchain', 'state.json'), 'utf8'));
    assert.equal(state.status, 'idle');
    assert.equal(Object.keys(state.active_turns).length, 0);
  });
});
