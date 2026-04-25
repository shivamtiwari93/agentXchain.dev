import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const tempDirs = new Set();

function createGovernedProject(watchRoutes = []) {
  const dir = join(tmpdir(), `axc-watch-result-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.add(dir);

  const config = {
    schema_version: '1.0',
    protocol_mode: 'governed',
    project: { id: 'watch-result-test', name: 'Watch Result Test' },
    roles: {
      pm: { title: 'PM', mandate: 'Plan work', write_authority: 'review_only', runtime: 'manual-pm' },
      dev: { title: 'Dev', mandate: 'Build work', write_authority: 'authoritative', runtime: 'local-dev' },
      qa: { title: 'QA', mandate: 'Verify work', write_authority: 'review_only', runtime: 'manual-qa' },
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
    rules: { challenge_required: true, max_turn_retries: 2, max_deadlock_cycles: 2 },
  };

  const state = {
    schema_version: '1.0',
    run_id: null,
    project_id: 'watch-result-test',
    status: 'idle',
    phase: 'planning',
    accepted_integration_ref: null,
    active_turns: {},
    turn_sequence: 0,
    last_completed_turn_id: null,
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
    phase_gate_status: { planning_signoff: 'pending' },
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

function getWatchResults(dir) {
  const resultsDir = join(dir, '.agentxchain', 'watch-results');
  if (!existsSync(resultsDir)) return [];
  return readdirSync(resultsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(readFileSync(join(resultsDir, f), 'utf8')));
}

afterEach(() => {
  for (const dir of [...tempDirs]) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    tempDirs.delete(dir);
  }
});

describe('watch result output — Slice 5', () => {
  it('AT-WATCH-RESULT-001: writes a result file for a routed auto-approved event', () => {
    const dir = createGovernedProject([
      {
        match: { category: 'github_pull_request_opened' },
        triage: {
          priority: 'p1',
          template: 'generic',
          charter: 'Review PR #{{number}} — {{title}}',
          acceptance_contract: ['PR reviewed under governance'],
        },
        auto_approve: true,
        preferred_role: 'qa',
      },
    ]);
    const eventFile = writeJson(dir, 'pr-opened.json', githubPrOpened());

    const result = runCli(dir, ['watch', '--event-file', eventFile, '--json']);
    assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);

    // CLI output includes the result ID
    assert.ok(parsed.watch_result_id, 'should include watch_result_id in output');
    assert.match(parsed.watch_result_id, /^wr_/);

    // Result file exists on disk
    const results = getWatchResults(dir);
    assert.equal(results.length, 1, 'should write exactly one result file');

    const record = results[0];
    assert.equal(record.result_id, parsed.watch_result_id);
    assert.ok(record.timestamp, 'should have ISO timestamp');
    assert.equal(record.event_id, parsed.event.event_id);
    assert.equal(record.intent_id, parsed.intent.intent_id);
    assert.equal(record.intent_status, 'approved');
    assert.equal(record.deduplicated, false);

    // Payload summary
    assert.equal(record.payload.source, 'git_ref_change');
    assert.equal(record.payload.category, 'github_pull_request_opened');
    assert.equal(record.payload.repo, 'acme/widgets');
    assert.equal(record.payload.ref, 'feature/review');

    // Route details
    assert.equal(record.route.matched, true);
    assert.equal(record.route.triaged, true);
    assert.equal(record.route.approved, true);
    assert.equal(record.route.preferred_role, 'qa');
    assert.deepEqual(record.errors, []);
  });

  it('AT-WATCH-RESULT-002: writes a result file for an unrouted event', () => {
    const dir = createGovernedProject([]); // no routes
    const eventFile = writeJson(dir, 'pr-opened.json', githubPrOpened());

    const result = runCli(dir, ['watch', '--event-file', eventFile, '--json']);
    assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);

    assert.ok(parsed.watch_result_id);

    const results = getWatchResults(dir);
    assert.equal(results.length, 1);

    const record = results[0];
    assert.equal(record.route.matched, false);
    assert.equal(record.intent_status, 'detected');
    assert.equal(record.deduplicated, false);
    assert.deepEqual(record.errors, []);
  });

  it('AT-WATCH-RESULT-003: writes a result file for a deduplicated event', () => {
    const dir = createGovernedProject([
      {
        match: { category: 'github_pull_request_opened' },
        triage: {
          priority: 'p1',
          template: 'generic',
          charter: 'Review PR #{{number}}',
          acceptance_contract: ['PR reviewed'],
        },
        auto_approve: true,
        preferred_role: 'qa',
      },
    ]);
    const eventFile = writeJson(dir, 'pr-opened.json', githubPrOpened());

    // First call
    runCli(dir, ['watch', '--event-file', eventFile, '--json']);

    // Second call — deduplicated
    const result = runCli(dir, ['watch', '--event-file', eventFile, '--json']);
    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);

    assert.ok(parsed.watch_result_id);
    assert.equal(parsed.deduplicated, true);

    // Two result files total
    const results = getWatchResults(dir);
    assert.equal(results.length, 2, 'each invocation writes its own result');

    const dedup = results.find(r => r.deduplicated === true);
    assert.ok(dedup, 'should have a deduplicated result record');
    assert.equal(dedup.route.matched, false);
    assert.equal(dedup.intent_status, 'approved'); // status from first call
  });

  it('AT-WATCH-RESULT-004: writes a result file capturing auto_start errors', () => {
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

    // First event auto-starts
    const first = writeJson(dir, 'ci-1.json', githubWorkflowFailed());
    runCli(dir, ['watch', '--event-file', first, '--json']);

    // Second event (different payload) — auto_start fails due to active turns
    const secondPayload = {
      ...githubWorkflowFailed(),
      workflow_run: { ...githubWorkflowFailed().workflow_run, id: 100, run_number: 13, name: 'Deploy' },
    };
    const second = writeJson(dir, 'ci-2.json', secondPayload);
    const result = runCli(dir, ['watch', '--event-file', second, '--json']);
    assert.equal(result.status, 0);

    const results = getWatchResults(dir);
    assert.equal(results.length, 2);

    // Find the second result (with the error)
    const errorResult = results.find(r => r.errors.length > 0);
    assert.ok(errorResult, 'should have a result with errors');
    assert.ok(errorResult.errors[0].match(/active turn|cannot start/i), `error: ${errorResult.errors[0]}`);
    assert.equal(errorResult.route.matched, true);
    assert.equal(errorResult.route.started, false);
  });

  it('AT-WATCH-RESULT-005: dry-run does not write a result file', () => {
    const dir = createGovernedProject([]);
    const eventFile = writeJson(dir, 'pr-opened.json', githubPrOpened());

    const result = runCli(dir, ['watch', '--event-file', eventFile, '--dry-run', '--json']);
    assert.equal(result.status, 0);

    const resultsDir = join(dir, '.agentxchain', 'watch-results');
    assert.equal(existsSync(resultsDir), false, 'watch-results directory should not exist after dry-run');
  });

  it('AT-WATCH-RESULT-006: result file contains correct auto_start success data', () => {
    const dir = createGovernedProject([
      {
        match: { category: 'github_workflow_run_failed' },
        triage: {
          priority: 'p0',
          template: 'generic',
          charter: 'Fix CI: {{workflow_name}} ({{conclusion}})',
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

    const results = getWatchResults(dir);
    assert.equal(results.length, 1);

    const record = results[0];
    assert.equal(record.route.matched, true);
    assert.equal(record.route.started, true);
    assert.equal(record.route.auto_start, true);
    assert.equal(record.route.role, 'dev');
    assert.ok(record.route.run_id, 'should have run_id');
    assert.equal(record.intent_status, 'executing');
    assert.equal(record.payload.source, 'ci_failure');
    assert.deepEqual(record.errors, []);
  });

  it('AT-WATCH-RESULT-007: multiple events produce unique result IDs', () => {
    const dir = createGovernedProject([]);

    const events = [
      { ...githubPrOpened() },
      {
        ...githubPrOpened(),
        pull_request: { ...githubPrOpened().pull_request, number: 43, title: 'Second PR' },
      },
      {
        ...githubPrOpened(),
        pull_request: { ...githubPrOpened().pull_request, number: 44, title: 'Third PR' },
      },
    ];

    for (let i = 0; i < events.length; i++) {
      const eventFile = writeJson(dir, `pr-${i}.json`, events[i]);
      const result = runCli(dir, ['watch', '--event-file', eventFile, '--json']);
      assert.equal(result.status, 0);
    }

    const results = getWatchResults(dir);
    assert.equal(results.length, 3);

    const ids = new Set(results.map(r => r.result_id));
    assert.equal(ids.size, 3, 'all result IDs must be unique');
  });
});
