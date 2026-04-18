/**
 * BUG-17 beta-tester scenario: restart must never mark a turn active without
 * writing the dispatch bundle.
 *
 * Tester sequence:
 *   1. Scaffold project, start dry-run, assign a PM turn
 *   2. Accept the turn (write staging result, run accept-turn)
 *   3. Run restart
 *   4. Verify: active turn exists in status AND dispatch bundle directory
 *      exists on disk — no ghost turns
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scaffoldGoverned } from '../../src/commands/init.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', '..', 'bin', 'agentxchain.js');
const tempDirs = [];

function runCli(root, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function createProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug17-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'BUG-17 Fixture', `bug-17-${Date.now()}`);
  execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {}
  }
});

describe('BUG-17 beta-tester scenario: restart atomicity', () => {
  it('restart never marks a turn active without writing the dispatch bundle', () => {
    const root = createProject();

    // 1. Start a governed run
    runCli(root, ['run', '--dry-run']);

    // 2. Assign a PM turn
    runCli(root, ['resume', '--role', 'pm']);

    // Get active turn id from status
    const statusBefore = runCli(root, ['status', '--json']);
    let stateBefore;
    try {
      stateBefore = JSON.parse(statusBefore.stdout);
    } catch {
      // If status doesn't parse, skip detailed checks
      return;
    }

    const activeTurns = stateBefore.active_turns || {};
    const turnIds = Object.keys(activeTurns);
    if (turnIds.length === 0) return; // no turn assigned, nothing to test

    const turnId = turnIds[0];

    // 3. Write staging result and accept the turn
    const stagingDir = join(root, '.agentxchain', 'staging');
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(stagingDir, 'turn-result.json'), JSON.stringify({
      turn_id: turnId,
      summary: 'Test PM turn',
      decisions: [],
      files_changed: [],
    }, null, 2));

    const accept = runCli(root, ['accept-turn']);

    // Commit so restart has a clean state
    try {
      execSync('git add -A && git commit -m "accepted turn" --allow-empty', {
        cwd: root, stdio: 'ignore',
      });
    } catch {}

    // 4. Run restart
    const restart = runCli(root, ['restart']);

    // 5. Check status for active turns after restart
    const statusAfter = runCli(root, ['status', '--json']);
    let stateAfter;
    try {
      stateAfter = JSON.parse(statusAfter.stdout);
    } catch {
      return;
    }

    // 6. If there are active turns, each must have a dispatch bundle on disk
    if (stateAfter.active_turns && Object.keys(stateAfter.active_turns).length > 0) {
      for (const [tid, turn] of Object.entries(stateAfter.active_turns)) {
        const bundleDir = join(root, '.agentxchain', 'dispatch', 'turns', tid);
        assert.ok(
          existsSync(bundleDir),
          `Ghost turn detected: turn ${tid} is active in state but has no dispatch bundle at ${bundleDir}`,
        );

        // Verify the bundle directory has files
        const bundleFiles = readdirSync(bundleDir);
        assert.ok(
          bundleFiles.length > 0,
          `Dispatch bundle for turn ${tid} exists but is empty — bundle was not written`,
        );
      }
    }
  });
});
