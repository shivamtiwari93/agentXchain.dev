/**
 * BUG-43: checkpoint-turn fails after phase advance because staging file is
 * already gone.
 *
 * Tester's state: accepted dev turn advanced the run to QA phase, but
 * checkpoint-turn fails with: "Failed to stage accepted files for checkpoint:
 * fatal: pathspec '.agentxchain/staging/turn_e20130cc31c3b5b3/turn-result.json'
 * did not match any files"
 *
 * Root cause: files_changed in history includes staging paths that were
 * cleaned up after acceptance. checkpoint-turn tries to git-add those paths.
 *
 * Fix: checkpoint-turn filters out ephemeral .agentxchain/staging/ and
 * .agentxchain/dispatch/ paths from files_changed before staging.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { checkpointAcceptedTurn } from '../../src/lib/turn-checkpoint.js';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * Seeds a git repo with:
 * - An accepted turn in history.jsonl whose files_changed includes both
 *   real working-tree files AND ephemeral staging paths
 * - The staging files are already deleted (as happens after acceptance)
 * - The real files exist on disk
 */
function seedTesterState() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-bug43-'));

  // Init git repo
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@test.com']);
  git(dir, ['config', 'user.name', 'Test']);

  // Create initial commit
  writeFileSync(join(dir, 'README.md'), '# Test\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-m', 'initial']);

  // Create agentxchain state
  const stateDir = join(dir, '.agentxchain');
  mkdirSync(stateDir, { recursive: true });

  const TURN_ID = 'turn_e20130cc31c3b5b3';
  const RUN_ID = 'run_test_001';

  // Create state.json
  writeFileSync(join(stateDir, 'state.json'), JSON.stringify({
    run_id: RUN_ID,
    phase: 'qa',
    status: 'active',
  }));

  // Create a real file that the turn modified (exists on disk)
  const planningDir = join(dir, '.planning');
  mkdirSync(planningDir, { recursive: true });
  writeFileSync(join(planningDir, 'IMPLEMENTATION_NOTES.md'), '# Implementation Notes\n## Changes\n- Modified API\n');

  // Create history entry with files_changed that includes BOTH real files
  // AND ephemeral staging paths (the staging paths were deleted after acceptance)
  const historyEntry = {
    turn_id: TURN_ID,
    role: 'dev',
    phase: 'implementation',
    runtime_id: 'local-dev',
    status: 'accepted',
    accepted_at: '2026-04-18T20:00:00Z',
    summary: 'Implemented API changes',
    files_changed: [
      '.planning/IMPLEMENTATION_NOTES.md',
      `.agentxchain/staging/${TURN_ID}/turn-result.json`,
      `.agentxchain/dispatch/${TURN_ID}/ASSIGNMENT.json`,
    ],
    // No checkpoint_sha — not yet checkpointed
  };

  writeFileSync(join(stateDir, 'history.jsonl'), JSON.stringify(historyEntry) + '\n');

  // Stage the real file so git knows about it
  git(dir, ['add', '.planning/IMPLEMENTATION_NOTES.md']);
  git(dir, ['add', '.agentxchain/state.json']);
  git(dir, ['add', '.agentxchain/history.jsonl']);

  return { dir, TURN_ID, RUN_ID };
}

describe('BUG-43: checkpoint-turn after staging cleanup', () => {
  it('checkpoint-turn succeeds when staging paths are in files_changed but no longer on disk', () => {
    const { dir, TURN_ID } = seedTesterState();

    const result = checkpointAcceptedTurn(dir, { turnId: TURN_ID });

    // Should succeed — the fix filters out .agentxchain/staging/ and
    // .agentxchain/dispatch/ paths before running git add
    assert.ok(
      result.ok || result.skipped,
      `Expected checkpoint to succeed or skip, got error: ${result.error}`,
    );

    // If it produced a commit, verify the staging paths are NOT in the commit
    if (result.checkpoint_sha) {
      const commitFiles = git(dir, ['diff-tree', '--no-commit-id', '--name-only', '-r', result.checkpoint_sha]);
      assert.ok(!commitFiles.includes('.agentxchain/staging/'), 'staging paths should not be in checkpoint commit');
      assert.ok(!commitFiles.includes('.agentxchain/dispatch/'), 'dispatch paths should not be in checkpoint commit');
    }
  });

  it('checkpoint-turn still works normally for files without ephemeral paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'axc-bug43-clean-'));

    git(dir, ['init', '-b', 'main']);
    git(dir, ['config', 'user.email', 'test@test.com']);
    git(dir, ['config', 'user.name', 'Test']);
    writeFileSync(join(dir, 'README.md'), '# Test\n');
    git(dir, ['add', 'README.md']);
    git(dir, ['commit', '-m', 'initial']);

    const stateDir = join(dir, '.agentxchain');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, 'state.json'), JSON.stringify({
      run_id: 'run_clean', phase: 'implementation', status: 'active',
    }));

    const planningDir = join(dir, '.planning');
    mkdirSync(planningDir, { recursive: true });
    writeFileSync(join(planningDir, 'NOTES.md'), '# Notes\nReal content\n');

    const TURN_ID = 'turn_clean_001';
    writeFileSync(join(stateDir, 'history.jsonl'), JSON.stringify({
      turn_id: TURN_ID,
      role: 'dev',
      phase: 'implementation',
      status: 'accepted',
      accepted_at: '2026-04-18T20:00:00Z',
      summary: 'Clean turn',
      files_changed: ['.planning/NOTES.md'],
    }) + '\n');

    git(dir, ['add', '.']);

    const result = checkpointAcceptedTurn(dir, { turnId: TURN_ID });
    assert.ok(result.ok, `Expected success, got: ${result.error}`);
    assert.ok(result.checkpoint_sha, 'Should produce a commit');
  });
});
