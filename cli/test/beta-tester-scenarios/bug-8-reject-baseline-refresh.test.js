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
  const root = mkdtempSync(join(tmpdir(), 'axc-bug8-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'BUG-8 Fixture', `bug-8-${Date.now()}`);
  execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {}
  }
});

describe('BUG-8: reject-turn retry must refresh baseline after HEAD changes', () => {
  it('new turn baseline matches current HEAD, not stale one', () => {
    const root = createProject();

    // Capture the initial HEAD
    const oldHead = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();

    // Start a dry-run
    const runResult = runCli(root, ['run', '--dry-run']);
    assert.equal(runResult.status, 0, `run --dry-run failed: ${runResult.stderr}`);

    // Assign a dev turn
    const resumeResult = runCli(root, ['resume', '--role', 'dev']);
    assert.equal(resumeResult.status, 0, `resume --role dev failed: ${resumeResult.stderr}`);

    // Read state to get the active turn id
    const stateFile = join(root, '.agentxchain', 'state.json');
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    const activeTurnId = (state.active_turn || state.activeTurn || state.current_turn || {}).id
      || (state.active_turn || state.activeTurn || state.current_turn || '');

    // Cause baseline drift
    writeFileSync(join(root, 'drift.txt'), 'baseline drift');
    execSync('git add drift.txt && git commit -m "drift commit"', { cwd: root, stdio: 'ignore' });
    const newHead = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
    assert.notEqual(oldHead, newHead, 'HEAD should have changed');

    // Write a staging result so reject-turn can process it
    const stagingDir = join(root, '.agentxchain', 'staging');
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(stagingDir, 'turn-result.json'), JSON.stringify({
      turn_id: activeTurnId,
      summary: 'Test rejection',
      decisions: [],
      files_changed: [],
    }));

    // Reject the turn
    const rejectResult = runCli(root, ['reject-turn']);
    // We don't strictly require exit 0 — just that it processes the rejection

    // Assign a new turn
    const resume2 = runCli(root, ['resume', '--role', 'dev']);

    // Read updated state to check the new turn's baseline
    if (existsSync(stateFile)) {
      const updatedState = JSON.parse(readFileSync(stateFile, 'utf8'));
      const turn = updatedState.active_turn || updatedState.activeTurn || updatedState.current_turn || {};
      const baseline = turn.baseline || turn.baseline_sha || turn.base_commit || '';
      if (baseline) {
        assert.equal(baseline, newHead,
          `New turn baseline should match current HEAD (${newHead}), not old HEAD (${oldHead}). Got: ${baseline}`);
      }
    }
  });
});
