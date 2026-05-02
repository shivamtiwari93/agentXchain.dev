import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

const tempDirs = new Set();

function createProject(opts = {}) {
  const dir = join(tmpdir(), `agentxchain-branch-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.add(dir);

  const config = {
    version: 3,
    project: 'Branch Test',
    agents: {
      pm: { name: 'PM', mandate: 'Plan work' },
      dev: { name: 'Dev', mandate: 'Build work' },
    },
    talk_file: 'TALK.md',
    state_file: 'state.md',
    history_file: 'history.jsonl',
    ...(opts.cursor ? { cursor: opts.cursor } : {}),
  };

  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(dir, 'TALK.md'), '## Turn 1\n- Next owner: pm\n');
  writeFileSync(join(dir, 'state.md'), '# state\n');
  writeFileSync(join(dir, 'history.jsonl'), '');

  if (opts.gitBranch) {
    initGitRepo(dir, opts.gitBranch);
  }

  return dir;
}

function initGitRepo(dir, branchName) {
  runGit(dir, ['init']);
  runGit(dir, ['config', 'user.name', 'AgentXchain Test']);
  runGit(dir, ['config', 'user.email', 'tests@example.com']);
  writeFileSync(join(dir, 'README.md'), '# Branch Test\n');
  runGit(dir, ['add', '.']);
  runGit(dir, ['commit', '-m', 'init']);
  runGit(dir, ['checkout', '-b', branchName]);
}

function runGit(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 15_000,
  });

  assert.equal(result.status, 0, `git ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function readConfig(dir) {
  return JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8'));
}

afterEach(() => {
  for (const dir of [...tempDirs]) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    tempDirs.delete(dir);
  }
});

describe('agentxchain branch', () => {
  it('AT-BRANCH-001: shows current and effective branch when no override exists', () => {
    const dir = createProject({ gitBranch: 'feature/current' });

    const result = runCli(dir, ['branch']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Current git branch:\s+feature\/current/);
    assert.match(result.stdout, /Cursor override:\s+none/);
    assert.match(result.stdout, /Effective branch:\s+feature\/current/);
  });

  it('AT-BRANCH-002: explicit branch name writes cursor.ref and reports mismatch from git branch', () => {
    const dir = createProject({ gitBranch: 'feature/current' });

    const result = runCli(dir, ['branch', 'release/hotfix']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Set Cursor branch override: release\/hotfix/);
    assert.match(result.stdout, /current git branch is feature\/current/);

    const config = readConfig(dir);
    assert.equal(config.cursor.ref, 'release/hotfix');
  });

  it('AT-BRANCH-003: --use-current stores the active git branch in cursor.ref', () => {
    const dir = createProject({ gitBranch: 'feature/current' });

    const result = runCli(dir, ['branch', '--use-current']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Set Cursor branch override to current git branch: feature\/current/);

    const config = readConfig(dir);
    assert.equal(config.cursor.ref, 'feature/current');
  });

  it('AT-BRANCH-004: --unset removes cursor.ref and cleans up an empty cursor object', () => {
    const dir = createProject({
      gitBranch: 'feature/current',
      cursor: { ref: 'release/hotfix' },
    });

    const result = runCli(dir, ['branch', '--unset']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Cleared branch override/);
    assert.match(result.stdout, /Effective branch now follows git: feature\/current/);

    const config = readConfig(dir);
    assert.equal(config.cursor, undefined);
  });

  it('AT-BRANCH-005: mutually exclusive argument combinations fail closed', () => {
    const dir = createProject({ gitBranch: 'feature/current' });

    const unsetConflict = runCli(dir, ['branch', 'release/hotfix', '--unset']);
    assert.equal(unsetConflict.status, 1, `${unsetConflict.stdout}\n${unsetConflict.stderr}`);
    assert.match(unsetConflict.stdout, /Use either --unset OR a branch value, not both/);

    const useCurrentConflict = runCli(dir, ['branch', 'release/hotfix', '--use-current']);
    assert.equal(useCurrentConflict.status, 1, `${useCurrentConflict.stdout}\n${useCurrentConflict.stderr}`);
    assert.match(useCurrentConflict.stdout, /Use either --use-current OR a branch value, not both/);

    const config = readConfig(dir);
    assert.equal(config.cursor, undefined);
  });

  it('AT-BRANCH-006: invalid branch names are rejected without mutating config', () => {
    const dir = createProject({ gitBranch: 'feature/current' });

    const result = runCli(dir, ['branch', 'bad branch name']);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Invalid branch name/);

    const config = readConfig(dir);
    assert.equal(config.cursor, undefined);
  });

  it('AT-BRANCH-007: missing project root exits non-zero', () => {
    const dir = join(tmpdir(), `agentxchain-branch-missing-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    tempDirs.add(dir);

    const result = runCli(dir, ['branch']);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /No agentxchain\.json found/);
  });
});
