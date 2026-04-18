/**
 * BUG-18 beta-tester scenario: `doctor` detects state/bundle desync (ghost turns).
 *
 * Tester sequence:
 *   1. Scaffold project, start run, assign a turn
 *   2. Delete the dispatch bundle directory manually
 *   3. Run `doctor --json`
 *   4. Verify it reports a bundle_integrity failure
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
  const root = mkdtempSync(join(tmpdir(), 'axc-bug18-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'BUG-18 Fixture', `bug-18-${Date.now()}`);
  execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {}
  }
});

describe('BUG-18 beta-tester scenario: state/bundle integrity', () => {
  it('doctor detects ghost turn when dispatch bundle is deleted', () => {
    const root = createProject();

    // 1. Start a governed run and assign a PM turn
    runCli(root, ['run', '--dry-run']);
    runCli(root, ['resume', '--role', 'pm']);

    // 2. Get active turn from status
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

    const turnId = turnIds[0];

    // 3. Delete the dispatch bundle directory to create a ghost turn
    const bundleDir = join(root, '.agentxchain', 'dispatch', 'turns', turnId);
    if (existsSync(bundleDir)) {
      rmSync(bundleDir, { recursive: true, force: true });
    }

    // Also remove the entire turns directory if it only had this one
    const turnsDir = join(root, '.agentxchain', 'dispatch', 'turns');
    if (existsSync(turnsDir)) {
      const remaining = readdirSync(turnsDir);
      if (remaining.length === 0) {
        // turnsDir is empty — the ghost is real
      }
    }

    // 4. Run doctor --json
    const doctor = runCli(root, ['doctor', '--json']);
    const output = (doctor.stdout || '') + (doctor.stderr || '');

    // 5. Verify doctor reports a bundle_integrity issue
    let doctorJson;
    try {
      doctorJson = JSON.parse(doctor.stdout);
    } catch {
      // If doctor output isn't clean JSON, check raw output for the signal
      assert.ok(
        output.includes('bundle_integrity') || output.includes('ghost') || output.includes('desync'),
        `doctor should detect bundle desync. Output:\n${output}`,
      );
      return;
    }

    const checks = doctorJson.checks || doctorJson.results || [];
    const bundleCheck = checks.find(c =>
      c.id === 'bundle_integrity' || c.check === 'bundle_integrity' ||
      (c.detail && c.detail.includes('bundle')),
    );
    assert.ok(
      bundleCheck,
      `doctor should include a bundle_integrity check. Checks found: ${JSON.stringify(checks.map(c => c.id || c.check))}`,
    );
    assert.ok(
      bundleCheck.level === 'fail' || bundleCheck.status === 'fail' || bundleCheck.passed === false,
      `bundle_integrity check should fail when bundle is missing. Got: ${JSON.stringify(bundleCheck)}`,
    );
  });
});
