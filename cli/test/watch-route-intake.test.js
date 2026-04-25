import { strict as assert } from 'node:assert';
import { afterEach, before, describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const tempDirs = new Set();

function createProject(watchRoutes = []) {
  const dir = join(tmpdir(), `agentxchain-watch-route-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.add(dir);
  const config = {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'watch-route-test', name: 'Watch Route Test' },
    roles: [
      { id: 'pm', title: 'PM', mandate: 'Plan work' },
      { id: 'dev', title: 'Dev', mandate: 'Build work' },
      { id: 'qa', title: 'QA', mandate: 'Verify work' },
    ],
  };
  if (watchRoutes.length > 0) {
    config.watch = { routes: watchRoutes };
  }
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
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

describe('watch route intake — event-to-role routing', () => {
  it('AT-WATCH-ROUTE-001: PR opened event auto-triages to QA review intent', () => {
    const dir = createProject([
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

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.deduplicated, false);

    // Intent should be approved (auto-triage + auto-approve)
    assert.equal(parsed.intent.status, 'approved');
    assert.equal(parsed.intent.priority, 'p1');
    assert.equal(parsed.intent.template, 'generic');
    assert.equal(parsed.intent.charter, 'Review PR #42 — Add governed review');
    assert.deepEqual(parsed.intent.acceptance_contract, ['PR reviewed under governance']);
    assert.equal(parsed.intent.preferred_role, 'qa');
    assert.equal(parsed.intent.approved_by, 'watch_route');

    // Routing metadata
    assert.equal(parsed.routed.triaged, true);
    assert.equal(parsed.routed.approved, true);
    assert.equal(parsed.routed.preferred_role, 'qa');
  });

  it('AT-WATCH-ROUTE-002: failed CI workflow auto-triages to dev fix intent', () => {
    const dir = createProject([
      {
        match: { category: 'github_workflow_run_failed' },
        triage: {
          priority: 'p0',
          template: 'generic',
          charter: 'Fix failed CI: {{workflow_name}} ({{conclusion}})',
          acceptance_contract: ['CI workflow passes after fix'],
        },
        auto_approve: true,
        preferred_role: 'dev',
      },
    ]);
    const eventFile = writeJson(dir, 'ci-failed.json', githubWorkflowFailed());

    const result = runCli(dir, ['watch', '--event-file', eventFile, '--json']);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.intent.status, 'approved');
    assert.equal(parsed.intent.priority, 'p0');
    assert.equal(parsed.intent.charter, 'Fix failed CI: CI (failure)');
    assert.equal(parsed.intent.preferred_role, 'dev');
    assert.equal(parsed.routed.preferred_role, 'dev');
  });

  it('AT-WATCH-ROUTE-003: no matching route leaves intent as detected', () => {
    const dir = createProject([
      {
        match: { category: 'github_workflow_run_failed' },
        triage: {
          priority: 'p0',
          template: 'generic',
          charter: 'Fix CI',
          acceptance_contract: ['CI passes'],
        },
        auto_approve: true,
        preferred_role: 'dev',
      },
    ]);
    const eventFile = writeJson(dir, 'pr-opened.json', githubPrOpened());

    const result = runCli(dir, ['watch', '--event-file', eventFile, '--json']);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.intent.status, 'detected');
    assert.equal(parsed.routed, undefined);
  });

  it('AT-WATCH-ROUTE-004: glob category matching works for all PR actions', () => {
    const dir = createProject([
      {
        match: { category: 'github_pull_request_*' },
        triage: {
          priority: 'p2',
          template: 'generic',
          charter: 'Review PR {{action}}',
          acceptance_contract: ['PR reviewed'],
        },
        auto_approve: false,
        preferred_role: 'qa',
      },
    ]);
    const eventFile = writeJson(dir, 'pr-opened.json', githubPrOpened());

    const result = runCli(dir, ['watch', '--event-file', eventFile, '--json']);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    // Triaged but NOT approved (auto_approve: false)
    assert.equal(parsed.intent.status, 'triaged');
    assert.equal(parsed.intent.charter, 'Review PR opened');
    assert.equal(parsed.routed.triaged, true);
    assert.equal(parsed.routed.approved, false);
  });

  it('AT-WATCH-ROUTE-005: no watch config at all leaves intent as detected', () => {
    const dir = createProject(); // no routes
    const eventFile = writeJson(dir, 'pr-opened.json', githubPrOpened());

    const result = runCli(dir, ['watch', '--event-file', eventFile, '--json']);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.intent.status, 'detected');
    assert.equal(parsed.routed, undefined);
  });

  it('AT-WATCH-ROUTE-006: source filter restricts route matching', () => {
    const dir = createProject([
      {
        match: { source: 'ci_failure', category: 'github_workflow_run_failed' },
        triage: {
          priority: 'p0',
          template: 'generic',
          charter: 'Fix CI',
          acceptance_contract: ['CI passes'],
        },
        auto_approve: true,
        preferred_role: 'dev',
      },
    ]);

    // CI failure matches
    const ciFile = writeJson(dir, 'ci-failed.json', githubWorkflowFailed());
    const ciResult = runCli(dir, ['watch', '--event-file', ciFile, '--json']);
    assert.equal(ciResult.status, 0, `${ciResult.stdout}\n${ciResult.stderr}`);
    const ciParsed = JSON.parse(ciResult.stdout);
    assert.equal(ciParsed.intent.status, 'approved');

    // PR opened does NOT match (source is git_ref_change, not ci_failure)
    const prFile = writeJson(dir, 'pr-opened.json', githubPrOpened());
    const prResult = runCli(dir, ['watch', '--event-file', prFile, '--json']);
    assert.equal(prResult.status, 0, `${prResult.stdout}\n${prResult.stderr}`);
    const prParsed = JSON.parse(prResult.stdout);
    assert.equal(prParsed.intent.status, 'detected');
  });

  it('AT-WATCH-ROUTE-007: first matching route wins when multiple routes exist', () => {
    const dir = createProject([
      {
        match: { category: 'github_pull_request_opened' },
        triage: {
          priority: 'p1',
          template: 'generic',
          charter: 'Specific PR opened route',
          acceptance_contract: ['PR reviewed'],
        },
        preferred_role: 'qa',
        auto_approve: true,
      },
      {
        match: { category: 'github_pull_request_*' },
        triage: {
          priority: 'p2',
          template: 'generic',
          charter: 'Generic PR route',
          acceptance_contract: ['PR reviewed'],
        },
        preferred_role: 'dev',
        auto_approve: false,
      },
    ]);
    const eventFile = writeJson(dir, 'pr-opened.json', githubPrOpened());

    const result = runCli(dir, ['watch', '--event-file', eventFile, '--json']);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    // First route should win
    assert.equal(parsed.intent.priority, 'p1');
    assert.equal(parsed.intent.charter, 'Specific PR opened route');
    assert.equal(parsed.intent.preferred_role, 'qa');
    assert.equal(parsed.intent.status, 'approved'); // first route has auto_approve
  });

  it('AT-WATCH-ROUTE-008: deduplicated events do not re-triage', () => {
    const dir = createProject([
      {
        match: { category: 'github_pull_request_opened' },
        triage: {
          priority: 'p1',
          template: 'generic',
          charter: 'Review PR',
          acceptance_contract: ['PR reviewed'],
        },
        auto_approve: true,
        preferred_role: 'qa',
      },
    ]);
    const eventFile = writeJson(dir, 'pr-opened.json', githubPrOpened());

    // First call — should triage and approve
    const first = runCli(dir, ['watch', '--event-file', eventFile, '--json']);
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const firstParsed = JSON.parse(first.stdout);
    assert.equal(firstParsed.intent.status, 'approved');
    assert.equal(firstParsed.routed.triaged, true);

    // Second call — deduplicated, should NOT re-triage
    const second = runCli(dir, ['watch', '--event-file', eventFile, '--json']);
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
    const secondParsed = JSON.parse(second.stdout);
    assert.equal(secondParsed.deduplicated, true);
    assert.equal(secondParsed.routed, undefined);
  });
});

describe('watch route — unit: resolveWatchRoute', () => {
  // Import the function directly for unit tests
  let resolveWatchRoute;
  before(async () => {
    const mod = await import('../src/lib/watch-events.js');
    resolveWatchRoute = mod.resolveWatchRoute;
  });

  it('returns null for empty routes', () => {
    assert.equal(resolveWatchRoute({ source: 'ci_failure', category: 'test' }, []), null);
    assert.equal(resolveWatchRoute({ source: 'ci_failure', category: 'test' }, null), null);
    assert.equal(resolveWatchRoute({ source: 'ci_failure', category: 'test' }, undefined), null);
  });

  it('interpolates charter template with signal fields', () => {
    const payload = {
      source: 'git_ref_change',
      category: 'github_pull_request_opened',
      signal: { number: 7, title: 'Fix bug', repository: 'acme/repo' },
    };
    const routes = [{
      match: { category: 'github_pull_request_opened' },
      triage: {
        priority: 'p1',
        template: 'generic',
        charter: 'Review #{{number}}: {{title}} in {{repository}}',
        acceptance_contract: ['reviewed'],
      },
    }];

    const result = resolveWatchRoute(payload, routes);
    assert.equal(result.triage.charter, 'Review #7: Fix bug in acme/repo');
  });

  it('preserves unresolved template tokens', () => {
    const payload = {
      source: 'schedule',
      category: 'github_schedule',
      signal: {},
    };
    const routes = [{
      match: { category: 'github_schedule' },
      triage: {
        priority: 'p3',
        template: 'generic',
        charter: 'Scheduled: {{schedule_name}}',
        acceptance_contract: ['done'],
      },
    }];

    const result = resolveWatchRoute(payload, routes);
    assert.equal(result.triage.charter, 'Scheduled: {{schedule_name}}');
  });

  it('defaults to p2 priority and generic template when not specified', () => {
    const payload = {
      source: 'ci_failure',
      category: 'github_workflow_run_failed',
      signal: {},
    };
    const routes = [{
      match: { category: 'github_workflow_run_failed' },
      triage: {
        charter: 'Fix CI',
        acceptance_contract: ['CI passes'],
      },
    }];

    const result = resolveWatchRoute(payload, routes);
    assert.equal(result.triage.priority, 'p2');
    assert.equal(result.triage.template, 'generic');
  });
});
