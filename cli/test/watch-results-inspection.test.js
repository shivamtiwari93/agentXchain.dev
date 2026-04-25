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

function createGovernedProject() {
  const dir = join(tmpdir(), `axc-watch-inspect-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.add(dir);

  const config = {
    schema_version: '1.0',
    protocol_mode: 'governed',
    project: { id: 'watch-inspect-test', name: 'Watch Inspect Test' },
    roles: {
      pm: { title: 'PM', mandate: 'Plan work', write_authority: 'review_only', runtime: 'manual-pm' },
      dev: { title: 'Dev', mandate: 'Build work', write_authority: 'authoritative', runtime: 'local-dev' },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'local-dev': { type: 'local_cli', command: ['echo', 'dev'], cwd: '.' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev'], max_concurrent_turns: 1 },
    },
    rules: { challenge_required: true, max_turn_retries: 2, max_deadlock_cycles: 2 },
  };

  const state = {
    schema_version: '1.0',
    run_id: null,
    project_id: 'watch-inspect-test',
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
  mkdirSync(join(dir, '.agentxchain', 'intake', 'events'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain', 'intake', 'intents'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(dir, '.planning'), { recursive: true });
  writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2));
  writeFileSync(join(dir, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(dir, '.agentxchain', 'decision-ledger.jsonl'), '');
  return dir;
}

function seedWatchResults(dir, records) {
  const resultsDir = join(dir, '.agentxchain', 'watch-results');
  mkdirSync(resultsDir, { recursive: true });
  for (const record of records) {
    writeFileSync(join(resultsDir, `${record.result_id}.json`), JSON.stringify(record, null, 2));
  }
}

function makeResult(overrides = {}) {
  const ts = Date.now() + Math.floor(Math.random() * 10000);
  const suffix = Math.random().toString(16).slice(2, 10);
  return {
    result_id: `wr_${ts}_${suffix}`,
    timestamp: new Date(ts).toISOString(),
    event_id: `evt_${ts}_${suffix}`,
    intent_id: `intent_${ts}_${suffix}`,
    intent_status: 'approved',
    deduplicated: false,
    payload: {
      source: 'git_ref_change',
      category: 'github_pull_request_opened',
      repo: 'acme/widgets',
      ref: 'feature/foo',
    },
    route: {
      matched: true,
      triaged: true,
      approved: true,
      planned: false,
      started: false,
      auto_start: false,
      preferred_role: 'qa',
      run_id: null,
      role: null,
    },
    errors: [],
    ...overrides,
  };
}

afterEach(() => {
  for (const d of tempDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch {}
  }
  tempDirs.clear();
});

describe('watch --results (list)', () => {
  it('AT-WATCH-INSPECT-001: lists all watch results as JSON', () => {
    const dir = createGovernedProject();
    const r1 = makeResult({ timestamp: '2026-04-25T10:00:00.000Z' });
    const r2 = makeResult({ timestamp: '2026-04-25T11:00:00.000Z', deduplicated: true });
    const r3 = makeResult({ timestamp: '2026-04-25T12:00:00.000Z', errors: ['plan failed'] });
    seedWatchResults(dir, [r1, r2, r3]);

    const result = spawnSync(process.execPath, [CLI_BIN, 'watch', '--results', '--json'], {
      cwd: dir, env: { ...process.env, NO_COLOR: '1' },
    });
    assert.equal(result.status, 0, `stderr: ${result.stderr?.toString()}`);
    const output = JSON.parse(result.stdout.toString());
    assert.equal(output.ok, true);
    assert.equal(output.total, 3);
    assert.equal(output.results.length, 3);
    // Most recent first
    assert.equal(output.results[0].timestamp, '2026-04-25T12:00:00.000Z');
    assert.equal(output.results[2].timestamp, '2026-04-25T10:00:00.000Z');
  });

  it('AT-WATCH-INSPECT-002: empty results dir returns empty list', () => {
    const dir = createGovernedProject();

    const result = spawnSync(process.execPath, [CLI_BIN, 'watch', '--results', '--json'], {
      cwd: dir, env: { ...process.env, NO_COLOR: '1' },
    });
    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout.toString());
    assert.equal(output.ok, true);
    assert.deepEqual(output.results, []);
  });

  it('AT-WATCH-INSPECT-003: --limit restricts output count', () => {
    const dir = createGovernedProject();
    const records = Array.from({ length: 5 }, (_, i) =>
      makeResult({ timestamp: new Date(Date.now() + i * 1000).toISOString() })
    );
    seedWatchResults(dir, records);

    const result = spawnSync(process.execPath, [CLI_BIN, 'watch', '--results', '--limit', '2', '--json'], {
      cwd: dir, env: { ...process.env, NO_COLOR: '1' },
    });
    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout.toString());
    assert.equal(output.total, 5);
    assert.equal(output.results.length, 2);
  });
});

describe('watch --result <id> (show)', () => {
  it('AT-WATCH-INSPECT-004: shows a single result by exact ID', () => {
    const dir = createGovernedProject();
    const r = makeResult();
    seedWatchResults(dir, [r]);

    const result = spawnSync(process.execPath, [CLI_BIN, 'watch', '--result', r.result_id, '--json'], {
      cwd: dir, env: { ...process.env, NO_COLOR: '1' },
    });
    assert.equal(result.status, 0, `stderr: ${result.stderr?.toString()}`);
    const output = JSON.parse(result.stdout.toString());
    assert.equal(output.ok, true);
    assert.equal(output.result_id, r.result_id);
    assert.equal(output.event_id, r.event_id);
    assert.equal(output.intent_status, 'approved');
  });

  it('AT-WATCH-INSPECT-005: shows a single result by ID prefix', () => {
    const dir = createGovernedProject();
    const r = makeResult();
    seedWatchResults(dir, [r]);
    const prefix = r.result_id.slice(0, 12);

    const result = spawnSync(process.execPath, [CLI_BIN, 'watch', '--result', prefix, '--json'], {
      cwd: dir, env: { ...process.env, NO_COLOR: '1' },
    });
    assert.equal(result.status, 0, `stderr: ${result.stderr?.toString()}`);
    const output = JSON.parse(result.stdout.toString());
    assert.equal(output.ok, true);
    assert.equal(output.result_id, r.result_id);
  });

  it('AT-WATCH-INSPECT-006: nonexistent ID returns error', () => {
    const dir = createGovernedProject();
    seedWatchResults(dir, [makeResult()]);

    const result = spawnSync(process.execPath, [CLI_BIN, 'watch', '--result', 'wr_nonexistent', '--json'], {
      cwd: dir, env: { ...process.env, NO_COLOR: '1' },
    });
    assert.equal(result.status, 1);
    const output = JSON.parse(result.stdout.toString());
    assert.equal(output.ok, false);
    assert.ok(output.error.includes('not found'));
  });

  it('AT-WATCH-INSPECT-007: shows result with errors and route details', () => {
    const dir = createGovernedProject();
    const r = makeResult({
      errors: ['plan failed: planning artifacts exist'],
      route: {
        matched: true,
        triaged: true,
        approved: true,
        planned: false,
        started: false,
        auto_start: true,
        preferred_role: 'dev',
        run_id: null,
        role: null,
      },
    });
    seedWatchResults(dir, [r]);

    const result = spawnSync(process.execPath, [CLI_BIN, 'watch', '--result', r.result_id, '--json'], {
      cwd: dir, env: { ...process.env, NO_COLOR: '1' },
    });
    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout.toString());
    assert.equal(output.ok, true);
    assert.deepEqual(output.errors, ['plan failed: planning artifacts exist']);
    assert.equal(output.route.auto_start, true);
    assert.equal(output.route.preferred_role, 'dev');
  });

  it('AT-WATCH-INSPECT-008: human-readable output for --result without --json', () => {
    const dir = createGovernedProject();
    const r = makeResult();
    seedWatchResults(dir, [r]);

    const result = spawnSync(process.execPath, [CLI_BIN, 'watch', '--result', r.result_id], {
      cwd: dir, env: { ...process.env, NO_COLOR: '1' },
    });
    assert.equal(result.status, 0);
    const stdout = result.stdout.toString();
    assert.ok(stdout.includes('Watch Result'), 'should contain header');
    assert.ok(stdout.includes(r.result_id), 'should contain result ID');
    assert.ok(stdout.includes(r.event_id), 'should contain event ID');
    assert.ok(stdout.includes('Triaged'), 'should contain route details');
  });
});
