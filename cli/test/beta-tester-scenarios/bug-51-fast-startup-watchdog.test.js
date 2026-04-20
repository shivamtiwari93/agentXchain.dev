/**
 * BUG-51 beta-tester scenario: fast-startup watchdog — detect ghost-dispatched
 * turns within 30 seconds, not 10 minutes.
 *
 * Tester's evidence: turn dispatched, marked running, connector shown active,
 * but NO stdout.log, NO staged result, NO progress events, NO failure event.
 * Stayed in "fake running" state for 11 minutes before BUG-47's watchdog fired.
 *
 * The fast-startup watchdog detects turns where the subprocess never started
 * (no dispatch-progress file) within 30 seconds, transitions to failed_start,
 * and releases budget reservations.
 *
 * Tester sequences:
 *   1. Dispatch bundle exists but subprocess never wrote output → detect within 30s
 *   2. Subprocess stays alive but never writes stdout → detect within 30s
 *   3. Budget reservation released on ghost detection
 *   4. Configurable via run_loop.startup_watchdog_ms
 *   5. Ghost detection does NOT fire when dispatch-progress exists (subprocess started)
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  initializeGovernedRun,
  assignGovernedTurn,
} from '../../src/lib/governed-state.js';
import {
  detectGhostTurns,
  detectStaleTurns,
  reconcileStaleTurns,
} from '../../src/lib/stale-turn-watchdog.js';
import { getDispatchProgressRelativePath } from '../../src/lib/dispatch-progress.js';

const ROOT = join(import.meta.dirname, '..', '..');
const CLI_PATH = join(ROOT, 'bin', 'agentxchain.js');
const tempDirs = [];

function makeConfig(overrides = {}) {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug51-test', name: 'BUG-51 Test', default_branch: 'main' },
    roles: {
      product_marketing: {
        title: 'Product Marketing',
        mandate: 'Draft marketing copy.',
        write_authority: 'authoritative',
        runtime: 'local-cli',
      },
    },
    runtimes: {
      'local-cli': { type: 'local_cli', command: 'echo "test"' },
    },
    routing: {
      planning: { entry_role: 'product_marketing', allowed_next_roles: ['product_marketing'], exit_gate: 'planning_signoff' },
    },
    gates: { planning_signoff: {} },
    budget: { limit_usd: 10.00 },
    ...overrides,
  };
}

function createProject(configOverrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug51-'));
  tempDirs.push(root);

  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  writeFileSync(join(root, 'README.md'), '# BUG-51\n');

  const config = makeConfig(configOverrides);
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));

  execSync('git init -b main', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });

  const init = initializeGovernedRun(root, config);
  assert.ok(init.ok, init.error);
  return { root, config, state: init.state };
}

function backdateTurn(root, turnId, secondsAgo) {
  const stateData = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
  const backdated = new Date(Date.now() - secondsAgo * 1000).toISOString();
  stateData.active_turns[turnId].started_at = backdated;
  writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify(stateData, null, 2));

  // Also backdate the turn_dispatched event
  const eventsPath = join(root, '.agentxchain', 'events.jsonl');
  if (existsSync(eventsPath)) {
    const rewritten = readFileSync(eventsPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parsed = JSON.parse(line);
        if (parsed?.turn?.turn_id === turnId) {
          parsed.timestamp = backdated;
        }
        return JSON.stringify(parsed);
      })
      .join('\n');
    writeFileSync(eventsPath, rewritten ? `${rewritten}\n` : '');
  }

  return JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('BUG-51: fast-startup watchdog detects ghost turns within 30 seconds', () => {
  it('detects ghost turn with no dispatch-progress file after 30s', () => {
    const { root, config } = createProject();

    const assign = assignGovernedTurn(root, config, 'product_marketing');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    // Backdate to 45 seconds ago — past 30s startup threshold
    const stateData = backdateTurn(root, turnId, 45);

    // No dispatch-progress file exists (subprocess never started)
    const progressPath = join(root, getDispatchProgressRelativePath(turnId));
    assert.ok(!existsSync(progressPath), 'No dispatch-progress file should exist');

    const ghosts = detectGhostTurns(root, stateData, config);
    assert.equal(ghosts.length, 1, 'Expected exactly one ghost turn');
    assert.equal(ghosts[0].turn_id, turnId);
    assert.equal(ghosts[0].failure_type, 'no_subprocess_output');
    assert.ok(ghosts[0].running_ms >= 40 * 1000, 'Expected running_ms >= 40 seconds');
    assert.ok(ghosts[0].recommendation.includes('reissue-turn'), 'Expected reissue-turn recommendation');
    assert.ok(ghosts[0].recommendation.includes('ghost'), 'Expected ghost reason in recommendation');
  });

  it('does NOT flag turn as ghost within the 30s threshold', () => {
    const { root, config } = createProject();

    const assign = assignGovernedTurn(root, config, 'product_marketing');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    // Only 10 seconds ago — within 30s startup threshold
    const stateData = backdateTurn(root, turnId, 10);

    const ghosts = detectGhostTurns(root, stateData, config);
    assert.equal(ghosts.length, 0, 'Expected no ghost turns within startup threshold');
  });

  it('does NOT flag turn as ghost when dispatch-progress file exists', () => {
    const { root, config } = createProject();

    const assign = assignGovernedTurn(root, config, 'product_marketing');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    // Backdate to 45 seconds ago
    const stateData = backdateTurn(root, turnId, 45);

    // Write a dispatch-progress file — subprocess started
    const progressPath = join(root, getDispatchProgressRelativePath(turnId));
    mkdirSync(join(root, '.agentxchain'), { recursive: true });
    writeFileSync(progressPath, JSON.stringify({
      turn_id: turnId,
      started_at: new Date(Date.now() - 45 * 1000).toISOString(),
      last_activity_at: new Date(Date.now() - 40 * 1000).toISOString(),
      output_lines: 1,
    }));

    const ghosts = detectGhostTurns(root, stateData, config);
    assert.equal(ghosts.length, 0, 'Expected no ghost turns when dispatch-progress exists');
  });

  it('reconciles ghost turn to failed_start and releases budget reservation', () => {
    const { root, config } = createProject();

    const assign = assignGovernedTurn(root, config, 'product_marketing');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    // Add a budget reservation for this turn
    const stateData = backdateTurn(root, turnId, 45);
    stateData.budget_reservations = {
      [turnId]: { reserved_usd: 2.00, role_id: 'product_marketing', created_at: stateData.active_turns[turnId].started_at },
    };
    stateData.budget_status = { spent_usd: 0, remaining_usd: 10.00 };
    writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify(stateData, null, 2));

    const result = reconcileStaleTurns(root, stateData, config);
    assert.ok(result.changed, 'Expected state change');
    assert.equal(result.ghost_turns.length, 1, 'Expected one ghost turn');
    assert.equal(result.ghost_turns[0].turn_id, turnId);

    // Verify turn transitioned to failed_start
    const reconciledTurn = result.state.active_turns[turnId];
    assert.equal(reconciledTurn.status, 'failed_start');
    assert.ok(reconciledTurn.failed_start_at, 'Expected failed_start_at timestamp');
    assert.equal(reconciledTurn.failed_start_reason, 'no_subprocess_output');
    assert.ok(reconciledTurn.recovery_command.includes('ghost'), 'Expected ghost recovery command');

    // Verify state is blocked
    assert.equal(result.state.status, 'blocked');
    assert.ok(result.state.blocked_on.includes('failed_start'), 'Expected blocked_on to include failed_start');
    assert.equal(result.state.blocked_reason.category, 'ghost_turn');

    // BUG-51 fix #6: Verify budget reservation released
    assert.ok(
      !result.state.budget_reservations[turnId],
      'Budget reservation for ghost turn must be released'
    );
    assert.equal(
      Object.keys(result.state.budget_reservations).length,
      0,
      'No budget reservations should remain'
    );
  });

  it('emits turn_start_failed event for ghost turns', () => {
    const { root, config } = createProject();

    const assign = assignGovernedTurn(root, config, 'product_marketing');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    const stateData = backdateTurn(root, turnId, 45);

    reconcileStaleTurns(root, stateData, config);

    // Read events and find turn_start_failed
    const eventsPath = join(root, '.agentxchain', 'events.jsonl');
    const events = readFileSync(eventsPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l));

    const startFailedEvents = events.filter(e => e.event_type === 'turn_start_failed');
    assert.equal(startFailedEvents.length, 1, 'Expected exactly one turn_start_failed event');
    assert.equal(startFailedEvents[0].turn.turn_id, turnId);
    assert.equal(startFailedEvents[0].payload.failure_type, 'no_subprocess_output');
    assert.ok(startFailedEvents[0].payload.running_ms >= 40000);

    // Also verify run_blocked event
    const blockedEvents = events.filter(e => e.event_type === 'run_blocked');
    const lastBlocked = blockedEvents[blockedEvents.length - 1];
    assert.ok(lastBlocked, 'Expected run_blocked event');
    assert.equal(lastBlocked.payload.category, 'ghost_turn');
    assert.ok(lastBlocked.payload.ghost_turn_ids.includes(turnId));
  });

  it('surfaces ghost turn via CLI status --json', () => {
    const { root, config } = createProject();

    const assign = assignGovernedTurn(root, config, 'product_marketing');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    backdateTurn(root, turnId, 45);

    const result = execSync(`node "${CLI_PATH}" status --json`, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const json = JSON.parse(result);

    assert.ok(Array.isArray(json.ghost_turns), 'Expected ghost_turns array in status JSON');
    assert.equal(json.ghost_turns.length, 1, 'Expected one ghost turn');
    assert.equal(json.ghost_turns[0].turn_id, turnId);
    assert.equal(json.ghost_turns[0].failure_type, 'no_subprocess_output');
    assert.equal(json.state.status, 'blocked');
    assert.equal(json.state.active_turns[turnId].status, 'failed_start');
  });

  it('resume surfaces ghost-turn recovery instead of generic guidance', () => {
    const { root, config } = createProject();
    const assign = assignGovernedTurn(root, config, 'product_marketing');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    backdateTurn(root, turnId, 45);

    const result = spawnSync('node', [CLI_PATH, 'resume'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    const output = result.stdout + result.stderr;
    assert.match(output, /ghost turn detected/i);
    assert.match(output, /reissue-turn --turn .* --reason ghost/i);
  });

  it('step --resume surfaces ghost-turn recovery', () => {
    const { root, config } = createProject();
    const assign = assignGovernedTurn(root, config, 'product_marketing');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    backdateTurn(root, turnId, 45);

    const result = spawnSync('node', [CLI_PATH, 'step', '--resume'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    const output = result.stdout + result.stderr;
    assert.match(output, /ghost turn detected/i);
    assert.match(output, /reissue-turn --turn .* --reason ghost/i);
  });

  it('respects configurable startup_watchdog_ms', () => {
    const { root, config } = createProject();

    const assign = assignGovernedTurn(root, config, 'product_marketing');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    // Backdate to 20 seconds ago
    const stateData = backdateTurn(root, turnId, 20);

    // Default 30s threshold → not ghost yet
    const ghostsDefault = detectGhostTurns(root, stateData, config);
    assert.equal(ghostsDefault.length, 0, 'Expected no ghost with default 30s threshold');

    // With 15s threshold → should be ghost
    const lowConfig = { ...config, run_loop: { startup_watchdog_ms: 15000 } };
    const ghostsLow = detectGhostTurns(root, stateData, lowConfig);
    assert.equal(ghostsLow.length, 1, 'Expected ghost with 15s threshold');
    assert.equal(ghostsLow[0].turn_id, turnId);
  });

  it('ghost turn does NOT fire for the same turn as stale-turn detection', () => {
    // A turn with no dispatch-progress, backdated 15 minutes, should be caught
    // by ghost detection (30s threshold), NOT stale detection (10m threshold).
    // reconcileStaleTurns should deduplicate.
    const { root, config } = createProject();

    const assign = assignGovernedTurn(root, config, 'product_marketing');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    const stateData = backdateTurn(root, turnId, 15 * 60); // 15 minutes

    const result = reconcileStaleTurns(root, stateData, config);
    // Should be caught by ghost detection (earlier, stricter check), not stale
    assert.equal(result.ghost_turns.length, 1, 'Expected one ghost turn');
    assert.equal(result.stale_turns.length, 0, 'Expected zero stale turns (ghost takes precedence)');
    assert.equal(result.ghost_turns[0].turn_id, turnId);
    assert.equal(result.state.active_turns[turnId].status, 'failed_start');
    assert.equal(result.state.blocked_reason.category, 'ghost_turn');
  });

  it('stale-turn detection still works for turns with dispatch-progress but no recent activity', () => {
    // BUG-47 path: subprocess started (has dispatch-progress) but went silent > 10 minutes
    const { root, config } = createProject();

    const assign = assignGovernedTurn(root, config, 'product_marketing');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    const stateData = backdateTurn(root, turnId, 15 * 60); // 15 minutes

    // Write a dispatch-progress file with old activity timestamp
    const progressPath = join(root, getDispatchProgressRelativePath(turnId));
    mkdirSync(join(root, '.agentxchain'), { recursive: true });
    writeFileSync(progressPath, JSON.stringify({
      turn_id: turnId,
      started_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      last_activity_at: new Date(Date.now() - 14 * 60 * 1000).toISOString(),
      output_lines: 5,
    }));

    const result = reconcileStaleTurns(root, stateData, config);
    // Ghost detection should NOT fire (dispatch-progress exists)
    assert.equal(result.ghost_turns.length, 0, 'Expected no ghost turns when dispatch-progress exists');
    // Stale detection should fire (>10m with no recent activity)
    assert.equal(result.stale_turns.length, 1, 'Expected one stale turn');
    assert.equal(result.stale_turns[0].turn_id, turnId);
    assert.equal(result.state.active_turns[turnId].status, 'stalled');
  });
});
