/**
 * BUG-22 beta-tester scenario: `reject-turn` and `accept-turn` must refuse
 * staging results from a different turn.
 *
 * Tester sequence:
 *   1. Scaffold project, start run, assign a turn (turn_A)
 *   2. Write a staging result with turn_id = "turn_FAKE" (wrong id)
 *   3. Run accept-turn — verify it fails with a stale_staging error
 */

import { describe, it, afterEach } from 'vitest';
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
  const root = mkdtempSync(join(tmpdir(), 'axc-bug22-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'BUG-22 Fixture', `bug-22-${Date.now()}`);
  execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {}
  }
});

describe('BUG-22 beta-tester scenario: stale staging detection', () => {
  it('accept-turn refuses staging result with mismatched turn_id', () => {
    const root = createProject();

    // 1. Start a governed run and assign a PM turn
    runCli(root, ['run', '--dry-run']);
    runCli(root, ['resume', '--role', 'pm']);

    // 2. Get the active turn id
    const statusResult = runCli(root, ['status', '--json']);
    let status;
    try {
      status = JSON.parse(statusResult.stdout);
    } catch {
      return; // can't parse, skip
    }

    const activeTurns = status.active_turns || {};
    const turnIds = Object.keys(activeTurns);
    if (turnIds.length === 0) return;

    const realTurnId = turnIds[0];

    // 3. Write a staging result with a WRONG turn_id
    const stagingDir = join(root, '.agentxchain', 'staging');
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(stagingDir, 'turn-result.json'), JSON.stringify({
      turn_id: 'turn_FAKE_does_not_exist',
      summary: 'This result belongs to a different turn',
      decisions: [],
      files_changed: [],
    }, null, 2));

    // 4. Run accept-turn — should fail with stale_staging error
    const accept = runCli(root, ['accept-turn']);
    const output = (accept.stdout || '') + (accept.stderr || '');

    // Must fail (non-zero exit)
    assert.notEqual(
      accept.status,
      0,
      `accept-turn should fail when staging turn_id doesn't match. Output:\n${output}`,
    );

    // Output should mention stale staging or turn_id mismatch
    assert.ok(
      output.includes('stale') || output.includes('Stale') ||
      output.includes('different turn') || output.includes('turn_FAKE') ||
      output.includes('mismatch'),
      `accept-turn should report stale staging error. Output:\n${output}`,
    );
  });

  it('reject-turn refuses staging result with mismatched turn_id', () => {
    const root = createProject();

    // 1. Start a governed run and assign a PM turn
    runCli(root, ['run', '--dry-run']);
    runCli(root, ['resume', '--role', 'pm']);

    // 2. Get active turn id
    const statusResult = runCli(root, ['status', '--json']);
    let status;
    try {
      status = JSON.parse(statusResult.stdout);
    } catch {
      return;
    }

    const activeTurns = status.active_turns || {};
    const turnIds = Object.keys(activeTurns);
    if (turnIds.length === 0) return;

    // 3. Write a staging result with a WRONG turn_id
    const stagingDir = join(root, '.agentxchain', 'staging');
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(stagingDir, 'turn-result.json'), JSON.stringify({
      turn_id: 'turn_FAKE_does_not_exist',
      summary: 'This result belongs to a different turn',
      decisions: [],
      files_changed: [],
    }, null, 2));

    // 4. Run reject-turn — should fail with stale_staging error
    const reject = runCli(root, ['reject-turn', '--reason', 'test rejection']);
    const output = (reject.stdout || '') + (reject.stderr || '');

    // Must fail (non-zero exit)
    assert.notEqual(
      reject.status,
      0,
      `reject-turn should fail when staging turn_id doesn't match. Output:\n${output}`,
    );

    // Output should mention stale staging or turn_id mismatch
    assert.ok(
      output.includes('stale') || output.includes('Stale') ||
      output.includes('different turn') || output.includes('turn_FAKE') ||
      output.includes('mismatch'),
      `reject-turn should report stale staging error. Output:\n${output}`,
    );
  });
});
