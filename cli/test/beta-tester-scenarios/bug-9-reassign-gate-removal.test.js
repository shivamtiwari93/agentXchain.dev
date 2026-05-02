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
  const root = mkdtempSync(join(tmpdir(), 'axc-bug9-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'BUG-9 Fixture', `bug-9-${Date.now()}`);
  execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {}
  }
});

describe('BUG-9: reject-turn --reassign no longer requires conflict_state', () => {
  it('does not fail with "conflict state required" error', () => {
    const root = createProject();

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

    // Write a staging result
    const stagingDir = join(root, '.agentxchain', 'staging');
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(stagingDir, 'turn-result.json'), JSON.stringify({
      turn_id: activeTurnId,
      summary: 'Test rejection',
      decisions: [],
      files_changed: [],
    }));

    // Run reject-turn --reassign without providing conflict_state
    const rejectResult = runCli(root, ['reject-turn', '--reassign']);
    const combinedOutput = (rejectResult.stdout || '') + (rejectResult.stderr || '');

    // The old gate error should NOT appear
    assert.ok(
      !combinedOutput.toLowerCase().includes('conflict state required'),
      `reject-turn --reassign should not fail with "conflict state required" gate error. Output: ${combinedOutput}`
    );
    assert.ok(
      !combinedOutput.toLowerCase().includes('conflict_state is required'),
      `reject-turn --reassign should not fail with "conflict_state is required" gate error. Output: ${combinedOutput}`
    );

    // It may fail for a legitimate reason (e.g., no other role available) — that's fine
    // The point is the old gate is gone
  });
});
