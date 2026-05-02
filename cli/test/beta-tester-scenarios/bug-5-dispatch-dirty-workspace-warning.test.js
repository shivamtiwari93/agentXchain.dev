/**
 * BUG-5 beta-tester scenario: dispatch bundle must warn about uncommitted files
 *
 * When dispatching a turn, if there are uncommitted files not in the baseline,
 * the dispatch should produce a warning (in CLI output or the dispatch bundle)
 * about dirty workspace files.
 *
 * Tester sequence:
 *   1. Scaffold project, start run
 *   2. Write a dirty file to the repo (uncommitted)
 *   3. Assign a turn (triggers dispatch)
 *   4. Check CLI output or dispatch bundle for dirty file warning
 */

import { describe, it, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function createProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug5-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'BUG-5 Fixture', `bug5-${Date.now()}`);

  execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', {
    cwd: root, stdio: 'ignore',
  });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });

  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {}
  }
});

describe('BUG-5 beta-tester scenario: dispatch dirty workspace warning', () => {
  it('dispatch warns about uncommitted files not in baseline', () => {
    const root = createProject();

    // 1. Start a governed run
    const runResult = runCli(root, ['run', '--dry-run']);

    // 2. Write a dirty file to the repo (do NOT commit)
    writeFileSync(join(root, 'uncommitted-dirty-file.txt'), `dirty content ${Date.now()}`);

    // 3. Assign a turn via CLI (triggers dispatch)
    const resume = runCli(root, ['resume', '--role', 'pm']);
    const step = runCli(root, ['step', '--role', 'pm']);

    // Collect all CLI output
    const allOutput = [
      runResult.stdout || '', runResult.stderr || '',
      resume.stdout || '', resume.stderr || '',
      step.stdout || '', step.stderr || '',
    ].join('\n');

    // 4. Check for dirty workspace warnings in CLI output
    const hasDirtyWarning = (
      allOutput.toLowerCase().includes('uncommitted') ||
      allOutput.toLowerCase().includes('dirty') ||
      allOutput.toLowerCase().includes('untracked') ||
      allOutput.toLowerCase().includes('workspace')
    );

    // 5. Also check dispatch bundle metadata for dirty workspace info
    const dispatchDir = join(root, '.agentxchain', 'dispatch', 'turns');
    let bundleMentionsDirty = false;

    if (existsSync(dispatchDir)) {
      const turnDirs = readdirSync(dispatchDir);
      for (const turnDir of turnDirs) {
        const assignmentPath = join(dispatchDir, turnDir, 'ASSIGNMENT.json');
        if (existsSync(assignmentPath)) {
          const assignment = readFileSync(assignmentPath, 'utf8');
          if (
            assignment.includes('uncommitted') ||
            assignment.includes('dirty') ||
            assignment.includes('untracked') ||
            assignment.includes('uncommitted-dirty-file.txt')
          ) {
            bundleMentionsDirty = true;
          }
        }
      }
    }

    // 6. Also check state.json for workspace_dirty indicators
    const statePath = join(root, '.agentxchain', 'state.json');
    let stateHasDirtyInfo = false;
    if (existsSync(statePath)) {
      const stateContent = readFileSync(statePath, 'utf8');
      stateHasDirtyInfo = (
        stateContent.includes('workspace_dirty') ||
        stateContent.includes('dirty_files') ||
        stateContent.includes('uncommitted')
      );
    }

    // At least one of the signals should indicate awareness of dirty workspace
    assert.ok(
      hasDirtyWarning || bundleMentionsDirty || stateHasDirtyInfo,
      `Dispatch should warn about uncommitted files. ` +
      `CLI output warning: ${hasDirtyWarning}, bundle mentions dirty: ${bundleMentionsDirty}, ` +
      `state has dirty info: ${stateHasDirtyInfo}. CLI output:\n${allOutput.slice(0, 500)}`,
    );
  });
});
