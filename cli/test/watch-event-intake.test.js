import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const tempDirs = new Set();

function createProject() {
  const dir = join(tmpdir(), `agentxchain-watch-event-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.add(dir);
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'watch-event-test', name: 'Watch Event Test' },
    roles: [
      { id: 'pm', title: 'PM', mandate: 'Plan work' },
      { id: 'dev', title: 'Dev', mandate: 'Build work' },
      { id: 'qa', title: 'QA', mandate: 'Verify work' },
    ],
  }, null, 2));
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

afterEach(() => {
  for (const dir of [...tempDirs]) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    tempDirs.delete(dir);
  }
});

describe('agentxchain watch event intake', () => {
  it('AT-WATCH-EVENT-001: dry-run normalizes a GitHub PR event without writing intake files', () => {
    const dir = createProject();
    const eventFile = writeJson(dir, 'pr-opened.json', githubPrOpened());

    const result = runCli(dir, ['watch', '--event-file', eventFile, '--dry-run', '--json']);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.dry_run, true);
    assert.equal(parsed.payload.source, 'git_ref_change');
    assert.equal(parsed.payload.category, 'github_pull_request_opened');
    assert.equal(parsed.payload.signal.number, 42);
    assert.equal(parsed.payload.signal.repository, 'acme/widgets');
    assert.equal(parsed.payload.evidence[0].type, 'url');
    assert.equal(parsed.payload.evidence[0].value, 'https://github.com/acme/widgets/pull/42');
    assert.equal(existsSync(join(dir, '.agentxchain', 'intake')), false, 'dry-run must not create intake files');
  });

  it('AT-WATCH-EVENT-002: records a GitHub PR event as one detected intent', () => {
    const dir = createProject();
    const eventFile = writeJson(dir, 'pr-opened.json', githubPrOpened());

    const result = runCli(dir, ['watch', '--event-file', eventFile, '--json']);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.deduplicated, false);
    assert.equal(parsed.event.source, 'git_ref_change');
    assert.equal(parsed.event.category, 'github_pull_request_opened');
    assert.equal(parsed.intent.status, 'detected');

    const events = readdirSync(join(dir, '.agentxchain', 'intake', 'events'));
    const intents = readdirSync(join(dir, '.agentxchain', 'intake', 'intents'));
    assert.equal(events.length, 1);
    assert.equal(intents.length, 1);
  });

  it('AT-WATCH-EVENT-003: duplicate GitHub PR events deduplicate to the existing intent', () => {
    const dir = createProject();
    const eventFile = writeJson(dir, 'pr-opened.json', githubPrOpened());

    const first = runCli(dir, ['watch', '--event-file', eventFile, '--json']);
    const second = runCli(dir, ['watch', '--event-file', eventFile, '--json']);

    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
    const firstParsed = JSON.parse(first.stdout);
    const secondParsed = JSON.parse(second.stdout);
    assert.equal(secondParsed.deduplicated, true);
    assert.equal(secondParsed.event.event_id, firstParsed.event.event_id);
    assert.equal(secondParsed.intent.intent_id, firstParsed.intent.intent_id);
  });

  it('AT-WATCH-EVENT-004: failed GitHub workflow events map to ci_failure', () => {
    const dir = createProject();
    const eventFile = writeJson(dir, 'workflow-failed.json', {
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
    });

    const result = runCli(dir, ['watch', '--event-file', eventFile, '--dry-run', '--json']);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.payload.source, 'ci_failure');
    assert.equal(parsed.payload.category, 'github_workflow_run_failed');
    assert.equal(parsed.payload.signal.workflow_name, 'CI');
    assert.equal(parsed.payload.signal.conclusion, 'failure');
  });

  it('AT-WATCH-EVENT-005: unsupported event JSON exits non-zero with supported classes', () => {
    const dir = createProject();
    const eventFile = writeJson(dir, 'unsupported.json', { provider: 'github', event: 'star', action: 'created' });

    const result = runCli(dir, ['watch', '--event-file', eventFile, '--json']);

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /supported events are GitHub pull_request, issues\.labeled, failed workflow_run, and schedule/);
  });

  it('AT-WATCH-EVENT-006: daemon mode cannot combine with event ingestion', () => {
    const dir = createProject();
    const eventFile = writeJson(dir, 'pr-opened.json', githubPrOpened());

    const result = runCli(dir, ['watch', '--daemon', '--event-file', eventFile, '--json']);

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /--daemon cannot be combined with --event-file/);
    assert.equal(existsSync(join(dir, '.agentxchain-watch.pid')), false);
  });
});
