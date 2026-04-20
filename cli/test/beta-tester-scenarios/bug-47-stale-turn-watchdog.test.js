/**
 * BUG-47 beta-tester scenario: stale "running" turns must be detected by
 * the watchdog on the next CLI invocation (status, resume, step --resume).
 *
 * Tester sequence:
 *   1. Seed a turn with status "running" and a started_at timestamp >threshold ago
 *   2. Run status
 *   3. Assert the output surfaces the stale turn and recommends reissue-turn
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
import { detectStaleTurns } from '../../src/lib/stale-turn-watchdog.js';
import { getDispatchProgressRelativePath } from '../../src/lib/dispatch-progress.js';

const ROOT = join(import.meta.dirname, '..', '..');
const CLI_PATH = join(ROOT, 'bin', 'agentxchain.js');
const tempDirs = [];

function makeConfig() {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug47-test', name: 'BUG-47 Test', default_branch: 'main' },
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
  };
}

function createProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug47-'));
  tempDirs.push(root);

  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  writeFileSync(join(root, 'README.md'), '# BUG-47\n');
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(makeConfig(), null, 2));

  execSync('git init -b main', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });

  const config = makeConfig();
  const init = initializeGovernedRun(root, config);
  assert.ok(init.ok, init.error);
  return { root, config, state: init.state };
}

function backdateTurnEvents(root, turnId, minutesAgo = 20) {
  const eventsPath = join(root, '.agentxchain', 'events.jsonl');
  if (!existsSync(eventsPath)) return;

  const backdated = new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
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

/**
 * BUG-51 introduced ghost-turn detection (30s threshold) for turns with
 * no dispatch-progress file. BUG-47 stale-turn tests must seed a
 * dispatch-progress file to test the "subprocess started but went silent"
 * path rather than the "subprocess never started" path.
 */
function seedOldDispatchProgress(root, turnId, minutesAgo = 20) {
  const progressPath = join(root, getDispatchProgressRelativePath(turnId));
  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  writeFileSync(progressPath, JSON.stringify({
    turn_id: turnId,
    started_at: new Date(Date.now() - minutesAgo * 60 * 1000).toISOString(),
    last_activity_at: new Date(Date.now() - (minutesAgo - 1) * 60 * 1000).toISOString(),
    output_lines: 3,
  }));
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('BUG-47: dead-turn watchdog detects stale running turns', () => {
  it('detects a turn running >threshold with no output', () => {
    const { root, config, state } = createProject();

    // Assign a turn
    const assign = assignGovernedTurn(root, config, 'product_marketing');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    // Manually backdate the turn's started_at to 15 minutes ago
    const stateData = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    stateData.active_turns[turnId].started_at = fifteenMinAgo;
    writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify(stateData, null, 2));

    backdateTurnEvents(root, turnId);

    // Run detectStaleTurns — should find the stale turn
    const staleTurns = detectStaleTurns(root, stateData, config);
    assert.equal(staleTurns.length, 1, 'Expected exactly one stale turn');
    assert.equal(staleTurns[0].turn_id, turnId);
    assert.ok(staleTurns[0].running_ms >= 15 * 60 * 1000, 'Expected running_ms >= 15 minutes');
    assert.ok(staleTurns[0].recommendation.includes('reissue-turn'), 'Expected reissue-turn recommendation');
    assert.ok(staleTurns[0].recommendation.includes(turnId), 'Expected turn_id in recommendation');
  });

  it('does NOT flag a turn within the threshold as stale', () => {
    const { root, config, state } = createProject();

    const assign = assignGovernedTurn(root, config, 'product_marketing');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    // Set started_at to 2 minutes ago (well within 10-minute default)
    const stateData = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    stateData.active_turns[turnId].started_at = twoMinAgo;
    writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify(stateData, null, 2));

    const staleTurns = detectStaleTurns(root, stateData, config);
    assert.equal(staleTurns.length, 0, 'Expected no stale turns within threshold');
  });

  it('surfaces stale turn via CLI status --json', () => {
    const { root, config, state } = createProject();

    const assign = assignGovernedTurn(root, config, 'product_marketing');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    // Backdate to 15 minutes ago
    const stateData = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    stateData.active_turns[turnId].started_at = fifteenMinAgo;
    writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify(stateData, null, 2));

    backdateTurnEvents(root, turnId);

    // Seed old dispatch-progress so this triggers stale detection (BUG-47),
    // not ghost detection (BUG-51). Subprocess started but went silent.
    seedOldDispatchProgress(root, turnId, 15);

    // Run CLI status --json
    const result = execSync(`node "${CLI_PATH}" status --json`, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const json = JSON.parse(result);
    assert.ok(Array.isArray(json.stale_turns), 'Expected stale_turns array in status JSON');
    assert.equal(json.stale_turns.length, 1, 'Expected one stale turn in status JSON');
    assert.equal(json.stale_turns[0].turn_id, turnId);
    assert.equal(json.state.status, 'blocked', 'status must reflect the reconciled blocked state');
    assert.equal(json.state.active_turns[turnId].status, 'stalled', 'active turn must be marked stalled after reconciliation');
  });

  it('does not let unrelated recent events mask a stale turn', () => {
    const { root, config } = createProject();

    const first = assignGovernedTurn(root, config, 'product_marketing');
    assert.ok(first.ok, first.error);
    const staleTurnId = first.turn.turn_id;

    const stateData = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
    stateData.active_turns[staleTurnId].started_at = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify(stateData, null, 2));

    // Seed old dispatch-progress (subprocess started but went silent)
    seedOldDispatchProgress(root, staleTurnId, 15);

    const eventsPath = join(root, '.agentxchain', 'events.jsonl');
    backdateTurnEvents(root, staleTurnId);
    writeFileSync(eventsPath, `${JSON.stringify({
      event_id: 'evt_bug47_unrelated',
      event_type: 'dispatch_progress',
      timestamp: new Date().toISOString(),
      run_id: stateData.run_id,
      phase: stateData.phase,
      status: stateData.status,
      turn: { turn_id: 'turn_unrelated_progress', role_id: 'product_marketing' },
      payload: { lines: 1 },
    })}\n`, { flag: 'a' });

    const staleTurns = detectStaleTurns(root, stateData, config);
    assert.equal(staleTurns.length, 1);
    assert.equal(staleTurns[0].turn_id, staleTurnId);
  });

  it('resume surfaces stale-turn recovery instead of generic active-turn guidance', () => {
    const { root, config } = createProject();
    const assign = assignGovernedTurn(root, config, 'product_marketing');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    const stateData = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
    stateData.active_turns[turnId].started_at = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify(stateData, null, 2));

    backdateTurnEvents(root, turnId);
    // Seed old dispatch-progress (subprocess started but went silent)
    seedOldDispatchProgress(root, turnId, 15);

    const result = spawnSync('node', [CLI_PATH, 'resume'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout + result.stderr, /stale turn detected/i);
    assert.match(result.stdout + result.stderr, /reissue-turn --turn .* --reason stale/i);
  });

  it('step --resume surfaces stale-turn recovery instead of redispatching', () => {
    const { root, config } = createProject();
    const assign = assignGovernedTurn(root, config, 'product_marketing');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    const stateData = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
    stateData.active_turns[turnId].started_at = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify(stateData, null, 2));

    backdateTurnEvents(root, turnId);
    // Seed old dispatch-progress (subprocess started but went silent)
    seedOldDispatchProgress(root, turnId, 15);

    const result = spawnSync('node', [CLI_PATH, 'step', '--resume'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout + result.stderr, /stale turn detected/i);
    assert.match(result.stdout + result.stderr, /reissue-turn --turn .* --reason stale/i);
  });

  it('respects configurable stale_turn_threshold_ms', () => {
    const { root, config, state } = createProject();

    const assign = assignGovernedTurn(root, config, 'product_marketing');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    // Set started_at to 2 minutes ago
    const stateData = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    stateData.active_turns[turnId].started_at = twoMinAgo;
    writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify(stateData, null, 2));

    backdateTurnEvents(root, turnId, 5);

    // With 1 minute threshold, this should be stale
    const lowConfig = { ...config, run_loop: { stale_turn_threshold_ms: 60000 } };
    const staleTurns = detectStaleTurns(root, stateData, lowConfig);
    assert.equal(staleTurns.length, 1, 'Expected stale with 1m threshold');
  });
});
