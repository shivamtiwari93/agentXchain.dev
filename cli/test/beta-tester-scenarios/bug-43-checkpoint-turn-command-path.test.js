/**
 * BUG-43 command-path proof: checkpoint-turn CLI command after phase advance
 * and staging cleanup.
 *
 * This test exercises the EXACT CLI path — `node agentxchain.js checkpoint-turn
 * --turn turn_e20130cc31c3b5b3` — not the library function. It seeds the
 * tester's exact state:
 *   1. Accepted dev turn in history.jsonl with files_changed containing both
 *      real working-tree files AND ephemeral staging/dispatch paths
 *   2. Run advanced to QA phase
 *   3. Staging directory already cleaned up (files deleted)
 *   4. checkpoint-turn must succeed using only durable files_changed paths
 *
 * The test proves:
 *   - The CLI command exits 0
 *   - The checkpoint commit contains ONLY the durable files (no staging/dispatch)
 *   - The printed output confirms the checkpoint SHA
 *   - history.jsonl is updated with checkpoint_sha
 */

import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = join(import.meta.dirname, '..', '..');
const CLI_PATH = join(ROOT, 'bin', 'agentxchain.js');
const TURN_ID = 'turn_e20130cc31c3b5b3';
const RUN_ID = 'run_c8a4701ce0d4952d';
const tempDirs = [];

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Seeds the tester's exact state:
 *   - git repo with initial commit
 *   - agentxchain.json (governed, generic template)
 *   - state.json with phase: 'qa' (already advanced past dev)
 *   - history.jsonl with accepted dev turn whose files_changed includes
 *     real files + ephemeral staging/dispatch paths
 *   - The real files exist on disk
 *   - The staging/dispatch files do NOT exist (already cleaned up)
 */
function seedTesterState() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-bug43-cmdpath-'));
  tempDirs.push(dir);

  // Init git repo
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@test.com']);
  git(dir, ['config', 'user.name', 'Test']);

  // Create initial commit with README
  writeFileSync(join(dir, 'README.md'), '# Test Project\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-m', 'initial']);

  // Create agentxchain.json (governed project)
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug43-test', name: 'BUG-43 Test', default_branch: 'main' },
    roles: {
      dev: { title: 'Developer', mandate: 'Build.', write_authority: 'authoritative', runtime: 'manual-dev' },
      qa: { title: 'QA', mandate: 'Verify.', write_authority: 'review_only', runtime: 'manual-qa' },
    },
    runtimes: {
      'manual-dev': { type: 'manual' },
      'manual-qa': { type: 'manual' },
    },
    routing: {
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa'], exit_gate: 'implementation_complete' },
      qa: { entry_role: 'qa', allowed_next_roles: ['dev', 'qa'], exit_gate: 'qa_ship_verdict' },
    },
    gates: {
      implementation_complete: { requires_files: ['.planning/IMPLEMENTATION_NOTES.md'] },
      qa_ship_verdict: { requires_files: ['.planning/ship-verdict.md'] },
    },
  }, null, 2));

  // Create .agentxchain directory structure
  const stateDir = join(dir, '.agentxchain');
  mkdirSync(stateDir, { recursive: true });

  // state.json — run is already in QA phase (phase advanced after dev acceptance)
  writeFileSync(join(stateDir, 'state.json'), JSON.stringify({
    schema_version: '1.0',
    run_id: RUN_ID,
    project_id: 'bug43-test',
    status: 'active',
    phase: 'qa',
    turn_sequence: 3,
    last_completed_turn_id: null,
    phase_gate_status: {},
  }, null, 2));

  // Create the REAL files the dev turn modified (these exist on disk)
  const planningDir = join(dir, '.planning');
  mkdirSync(planningDir, { recursive: true });
  writeFileSync(join(planningDir, 'IMPLEMENTATION_NOTES.md'),
    '# Implementation Notes\n\n## API Changes\n- Added /v2/endpoint\n- Updated auth middleware\n');
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'api.js'),
    'export function handler(req, res) { res.json({ ok: true }); }\n');

  // history.jsonl — accepted dev turn with files_changed including
  // ephemeral staging/dispatch paths (the exact tester scenario)
  const historyEntry = {
    turn_id: TURN_ID,
    run_id: RUN_ID,
    role: 'dev',
    phase: 'implementation',
    runtime_id: 'manual-dev',
    status: 'accepted',
    accepted_at: '2026-04-18T20:00:00Z',
    summary: 'Implemented API v2 endpoint with auth middleware updates',
    files_changed: [
      '.planning/IMPLEMENTATION_NOTES.md',
      'src/api.js',
      // Ephemeral paths — these were cleaned up after acceptance
      `.agentxchain/staging/${TURN_ID}/turn-result.json`,
      `.agentxchain/dispatch/${TURN_ID}/ASSIGNMENT.json`,
    ],
    // No checkpoint_sha — this is the bug: checkpoint hasn't happened yet
  };
  writeFileSync(join(stateDir, 'history.jsonl'), JSON.stringify(historyEntry) + '\n');

  // events.jsonl (empty)
  writeFileSync(join(stateDir, 'events.jsonl'), '');

  // NOTE: We intentionally do NOT create the staging/dispatch files.
  // They were cleaned up after acceptance. This is the exact tester state.

  // Stage everything for git so checkpoint can commit
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'seed governed state with accepted dev turn']);

  // Now make the real files dirty (simulate dev turn output not yet committed)
  writeFileSync(join(planningDir, 'IMPLEMENTATION_NOTES.md'),
    '# Implementation Notes\n\n## API Changes\n- Added /v2/endpoint\n- Updated auth middleware\n- Added rate limiting\n');
  writeFileSync(join(dir, 'src', 'api.js'),
    'export function handler(req, res) { res.json({ ok: true, version: 2 }); }\n');

  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('BUG-43 command-path: checkpoint-turn CLI after phase advance + staging cleanup', () => {
  it('checkpoint-turn --turn succeeds when staging/dispatch paths are gone, commits only durable files', () => {
    const root = seedTesterState();

    // Run the EXACT CLI command the tester would run
    const result = spawnSync('node', [
      CLI_PATH,
      'checkpoint-turn',
      '--turn', TURN_ID,
    ], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NODE_NO_WARNINGS: '1',
      },
    });

    // 1. CLI must exit 0
    assert.equal(result.status, 0,
      `checkpoint-turn should succeed, stdout: ${result.stdout}, stderr: ${result.stderr}`);

    // 2. Output must confirm the checkpoint
    assert.match(result.stdout, /Checkpointed turn_e20130cc31c3b5b3 at [0-9a-f]+/,
      'Should print checkpoint confirmation with SHA');

    // 3. The checkpoint commit must contain ONLY durable files — no staging/dispatch
    const headSha = git(root, ['rev-parse', 'HEAD']);
    const commitFiles = git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', headSha]);
    const committedFiles = commitFiles.split('\n').filter(Boolean);

    assert.ok(committedFiles.includes('.planning/IMPLEMENTATION_NOTES.md'),
      'Checkpoint commit should include the real planning file');
    assert.ok(committedFiles.includes('src/api.js'),
      'Checkpoint commit should include the real source file');
    assert.ok(!committedFiles.some(f => f.startsWith('.agentxchain/staging/')),
      'Checkpoint commit must NOT include staging paths');
    assert.ok(!committedFiles.some(f => f.startsWith('.agentxchain/dispatch/')),
      'Checkpoint commit must NOT include dispatch paths');

    // 4. history.jsonl must be updated with checkpoint_sha
    const history = readFileSync(join(root, '.agentxchain', 'history.jsonl'), 'utf8')
      .trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    const turnEntry = history.find(e => e.turn_id === TURN_ID);
    assert.ok(turnEntry, 'Turn entry should exist in history');
    assert.ok(turnEntry.checkpoint_sha, 'Turn entry should have checkpoint_sha after checkpoint');
    assert.equal(turnEntry.checkpoint_sha, headSha, 'checkpoint_sha should match HEAD');

    // 5. Commit message should follow checkpoint format
    const commitMsg = git(root, ['log', '--format=%s', '-1']);
    assert.match(commitMsg, /checkpoint: turn_e20130cc31c3b5b3/,
      'Commit subject should follow checkpoint format');
  });

  it('checkpoint-turn (no --turn flag) resolves the latest accepted turn and succeeds', () => {
    const root = seedTesterState();

    // Run WITHOUT --turn flag — should resolve to the latest accepted turn
    const result = spawnSync('node', [
      CLI_PATH,
      'checkpoint-turn',
    ], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NODE_NO_WARNINGS: '1',
      },
    });

    assert.equal(result.status, 0,
      `checkpoint-turn without --turn should succeed, stdout: ${result.stdout}, stderr: ${result.stderr}`);
    assert.match(result.stdout, /Checkpointed turn_e20130cc31c3b5b3/,
      'Should resolve to the only accepted turn and checkpoint it');
  });
});
