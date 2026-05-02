import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { emitRunEvent } from '../src/lib/run-events.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

const tempDirs = new Set();

function createProject(opts = {}) {
  const dir = join(tmpdir(), `agentxchain-events-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.add(dir);

  const config = {
    version: 3,
    project: 'Events Test',
    agents: {
      pm: { name: 'PM', mandate: 'Plan work' },
      dev: { name: 'Dev', mandate: 'Build work' },
    },
    talk_file: 'TALK.md',
    state_file: 'state.md',
    history_file: 'history.jsonl',
  };

  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));

  if (opts.events) {
    const eventsDir = join(dir, '.agentxchain');
    mkdirSync(eventsDir, { recursive: true });
    const lines = opts.events.map((e) => JSON.stringify(e)).join('\n') + '\n';
    writeFileSync(join(eventsDir, 'events.jsonl'), lines);
  }

  return dir;
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function makeEvent(overrides = {}) {
  return {
    event_id: `evt_${Math.random().toString(16).slice(2, 18)}`,
    event_type: 'run_started',
    timestamp: new Date().toISOString(),
    run_id: 'run_abc123def456',
    phase: 'planning',
    status: 'active',
    turn: null,
    payload: {},
    ...overrides,
  };
}

afterEach(() => {
  for (const dir of [...tempDirs]) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    tempDirs.delete(dir);
  }
});

describe('agentxchain events', () => {
  it('AT-EVENTS-001: fails outside a project root', () => {
    const dir = join(tmpdir(), `agentxchain-events-noproj-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    tempDirs.add(dir);

    const result = runCli(dir, ['events']);
    assert.notEqual(result.status, 0, 'should fail without project root');
    assert.match(result.stderr, /No AgentXchain project found/);
  });

  it('AT-EVENTS-002: shows "No events found" when events.jsonl is missing', () => {
    const dir = createProject();
    const result = runCli(dir, ['events']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /No events found/);
  });

  it('AT-EVENTS-003: reads and displays events from events.jsonl', () => {
    const dir = createProject({
      events: [
        makeEvent({ event_type: 'run_started', run_id: 'run_aabbccdd1122' }),
        makeEvent({ event_type: 'turn_dispatched', run_id: 'run_aabbccdd1122', turn: { role_id: 'pm' } }),
        makeEvent({ event_type: 'turn_accepted', run_id: 'run_aabbccdd1122', turn: { role_id: 'pm' } }),
      ],
    });

    const result = runCli(dir, ['events']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /run_started/);
    assert.match(result.stdout, /turn_dispatched/);
    assert.match(result.stdout, /turn_accepted/);
    assert.match(result.stdout, /run_aabbccdd/); // 12-char prefix
  });

  it('AT-EVENTS-004: --type filter restricts output to matching event types', () => {
    const dir = createProject({
      events: [
        makeEvent({ event_type: 'run_started' }),
        makeEvent({ event_type: 'turn_dispatched' }),
        makeEvent({ event_type: 'turn_accepted' }),
        makeEvent({ event_type: 'run_completed' }),
      ],
    });

    const result = runCli(dir, ['events', '--type', 'turn_dispatched,turn_accepted']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /turn_dispatched/);
    assert.match(result.stdout, /turn_accepted/);
    assert.ok(!result.stdout.includes('run_started'), 'should not include run_started');
    assert.ok(!result.stdout.includes('run_completed'), 'should not include run_completed');
  });

  it('AT-EVENTS-005: --since filter restricts output to events after timestamp', () => {
    const oldTime = '2025-01-01T00:00:00Z';
    const newTime = '2026-04-12T12:00:00Z';
    const dir = createProject({
      events: [
        makeEvent({ event_type: 'run_started', timestamp: oldTime }),
        makeEvent({ event_type: 'turn_dispatched', timestamp: newTime }),
      ],
    });

    const result = runCli(dir, ['events', '--since', '2026-01-01T00:00:00Z']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /turn_dispatched/);
    assert.ok(!result.stdout.includes('run_started'), 'old event should be filtered out');
  });

  it('AT-EVENTS-006: --limit restricts output to N most recent events', () => {
    const events = [];
    for (let i = 0; i < 10; i++) {
      events.push(makeEvent({
        event_type: 'turn_dispatched',
        run_id: `run_limit_${String(i).padStart(2, '0')}000000`,
        timestamp: new Date(2026, 3, 12, 0, 0, i).toISOString(),
      }));
    }
    const dir = createProject({ events });

    const result = runCli(dir, ['events', '--limit', '3']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    // Should only show the 3 most recent (indices 7, 8, 9)
    const lines = result.stdout.trim().split('\n').filter((l) => l.includes('turn_dispatched'));
    assert.equal(lines.length, 3, `expected 3 events but got ${lines.length}`);
    assert.ok(result.stdout.includes('run_limit_09'), 'should include last event');
    assert.ok(!result.stdout.includes('run_limit_00'), 'should not include first event');
  });

  it('AT-EVENTS-007: --json outputs raw JSONL', () => {
    const dir = createProject({
      events: [
        makeEvent({ event_type: 'run_started', run_id: 'run_json_test_00' }),
      ],
    });

    const result = runCli(dir, ['events', '--json']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const parsed = JSON.parse(result.stdout.trim());
    assert.equal(parsed.event_type, 'run_started');
    assert.equal(parsed.run_id, 'run_json_test_00');
  });

  it('AT-EVENTS-008: --type hint shown when filtered result is empty', () => {
    const dir = createProject({
      events: [
        makeEvent({ event_type: 'run_started' }),
      ],
    });

    const result = runCli(dir, ['events', '--type', 'gate_failed']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /No events found/);
    assert.match(result.stdout, /filtered by type: gate_failed/);
  });

  it('AT-EVENTS-009: turn_rejected rendering includes reason and failed_stage', () => {
    const dir = createProject({
      events: [
        makeEvent({
          event_type: 'turn_rejected',
          turn: { role_id: 'dev' },
          payload: { reason: 'validation failed', failed_stage: 'schema_check' },
        }),
      ],
    });

    const result = runCli(dir, ['events']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /turn_rejected/);
    assert.match(result.stdout, /validation failed/);
    assert.match(result.stdout, /schema_check/);
  });

  it('AT-EVENTS-010: --dir flag overrides project root', () => {
    const dir = createProject({
      events: [
        makeEvent({ event_type: 'run_started', run_id: 'run_dirflag_0000' }),
      ],
    });

    // Run from a different directory but point --dir at the project
    const otherDir = join(tmpdir(), `agentxchain-events-other-${Date.now()}`);
    mkdirSync(otherDir, { recursive: true });
    tempDirs.add(otherDir);

    const result = runCli(otherDir, ['events', '--dir', dir]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /run_started/);
    assert.match(result.stdout, /run_dirflag_/);
  });

  it('AT-EVENTS-011: --type turn_conflicted surfaces durable conflict metadata inline', () => {
    const dir = createProject();
    emitRunEvent(dir, 'turn_conflicted', {
      run_id: 'run_conflict_001',
      phase: 'implementation',
      status: 'active',
      turn: { turn_id: 'turn_conflict_001', role_id: 'dev' },
      payload: {
        conflicting_files: ['src/shared.js', 'src/conflict.js'],
        accepted_since_turn_ids: ['turn_prev_001'],
        overlap_ratio: 1,
        detection_count: 2,
      },
    });

    const result = runCli(dir, ['events', '--type', 'turn_conflicted']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /turn_conflicted/);
    assert.match(result.stdout, /src\/shared\.js, src\/conflict\.js/);
    assert.match(result.stdout, /100% overlap/);
    assert.match(result.stdout, /detection 2/);
    assert.match(result.stdout, /accepted since turn_prev_001/);
    assert.ok(!result.stdout.includes('run_started'), 'filter should only show turn_conflicted events');
  });
});
