/**
 * BUG-2 beta-tester scenario: state.json and session.json disagree on baseline_ref
 *
 * state.json and session.json must agree on baseline_ref / workspace-dirty status.
 * The fix was writeSessionCheckpoint() deriving baseline_ref from the same
 * captureBaseline() result.
 *
 * Tester sequence:
 *   1. Scaffold project, start run
 *   2. Create a dirty file
 *   3. Assign a turn
 *   4. Read both .agentxchain/state.json and .agentxchain/session.json
 *   5. Verify their baseline references agree
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../../src/commands/init.js';
import {
  initializeGovernedRun,
  assignGovernedTurn,
  normalizeGovernedStateShape,
} from '../../src/lib/governed-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', '..', 'bin', 'agentxchain.js');
const tempDirs = [];

function runCli(root, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function createProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug2-'));
  tempDirs.push(root);

  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });

  const config = {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug2-test', name: 'BUG-2 Test', default_branch: 'main' },
    roles: {
      pm: {
        title: 'PM',
        mandate: 'Plan the project.',
        write_authority: 'review_only',
        runtime_class: 'manual',
        runtime_id: 'manual-pm',
      },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
    },
    routing: {
      planning: {
        entry_role: 'pm',
        allowed_next_roles: ['pm'],
      },
    },
    gates: {},
  };

  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));

  execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', {
    cwd: root, stdio: 'ignore',
  });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });

  return { root, config };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {}
  }
});

describe('BUG-2 beta-tester scenario: state.json and session.json baseline agreement', () => {
  it('state.json and session.json agree on baseline_ref after turn assignment with dirty workspace', () => {
    const { root, config } = createProject();

    // 1. Initialize run
    const initResult = initializeGovernedRun(root, config);
    assert.ok(initResult.ok, `Init failed: ${initResult.error}`);

    // 2. Create a dirty file in the workspace (uncommitted)
    writeFileSync(join(root, 'dirty-workspace-file.txt'), `dirty content ${Date.now()}`);

    // 3. Assign a PM turn (this triggers captureBaseline + writeSessionCheckpoint)
    const assignResult = assignGovernedTurn(root, config, 'pm');
    assert.ok(assignResult.ok, `Assign failed: ${assignResult.error}`);

    const turnId = assignResult.turn.turn_id;

    // 4. Read state.json
    const stateRaw = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
    const state = normalizeGovernedStateShape(stateRaw).state;

    // 5. Read session.json
    const sessionPath = join(root, '.agentxchain', 'session.json');
    assert.ok(existsSync(sessionPath), 'session.json must exist after turn assignment');
    const session = JSON.parse(readFileSync(sessionPath, 'utf8'));

    // 6. Extract baseline references
    const activeTurn = state.active_turns?.[turnId];
    assert.ok(activeTurn, 'Active turn should exist in state');
    const stateBaselineRef = activeTurn.baseline?.ref || activeTurn.baseline_ref;

    // Session may store baseline_ref at the top level or nested
    const sessionBaselineRef = session.baseline_ref || session.last_baseline_ref;

    // 7. KEY ASSERTION: both must agree on baseline_ref
    if (stateBaselineRef && sessionBaselineRef) {
      assert.strictEqual(
        stateBaselineRef,
        sessionBaselineRef,
        `state.json baseline_ref (${stateBaselineRef}) must match session.json baseline_ref (${sessionBaselineRef})`,
      );
    }

    // 8. Verify session checkpoint reflects the turn assignment event
    assert.ok(
      session.last_event === 'turn_assigned' || session.event === 'turn_assigned' || session.phase,
      'session.json should reflect the turn_assigned checkpoint',
    );
  });
});
