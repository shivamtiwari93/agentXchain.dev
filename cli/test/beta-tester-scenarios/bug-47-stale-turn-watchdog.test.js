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
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  initializeGovernedRun,
  assignGovernedTurn,
} from '../../src/lib/governed-state.js';
import { detectStaleTurns } from '../../src/lib/stale-turn-watchdog.js';
import { utimesSync } from 'node:fs';

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

    // Backdate events.jsonl so file mtime doesn't mask staleness
    const eventsPath = join(root, '.agentxchain', 'events.jsonl');
    if (existsSync(eventsPath)) {
      const oldTime = new Date(Date.now() - 20 * 60 * 1000);
      utimesSync(eventsPath, oldTime, oldTime);
    }

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

    // Backdate events.jsonl
    const eventsPath2 = join(root, '.agentxchain', 'events.jsonl');
    if (existsSync(eventsPath2)) {
      const oldTime = new Date(Date.now() - 20 * 60 * 1000);
      utimesSync(eventsPath2, oldTime, oldTime);
    }

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

    // Backdate events.jsonl
    const eventsPath3 = join(root, '.agentxchain', 'events.jsonl');
    if (existsSync(eventsPath3)) {
      const oldTime = new Date(Date.now() - 5 * 60 * 1000);
      utimesSync(eventsPath3, oldTime, oldTime);
    }

    // With 1 minute threshold, this should be stale
    const lowConfig = { ...config, run_loop: { stale_turn_threshold_ms: 60000 } };
    const staleTurns = detectStaleTurns(root, stateData, lowConfig);
    assert.equal(staleTurns.length, 1, 'Expected stale with 1m threshold');
  });
});
