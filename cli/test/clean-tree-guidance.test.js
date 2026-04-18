import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const DOCS_ROOT = join(__dirname, '..', '..', 'website-v2', 'docs');
const tempDirs = [];

function createGitProject(mutator) {
  const root = mkdtempSync(join(tmpdir(), 'axc-clean-tree-'));
  tempDirs.push(root);
  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: root, stdio: 'ignore' });

  scaffoldGoverned(root, 'Clean Tree Fixture', `clean-tree-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  if (mutator) mutator(config);
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  execSync('git add -A', { cwd: root, stdio: 'ignore' });
  execSync('git commit -m "initial scaffold"', { cwd: root, stdio: 'ignore' });
  return root;
}

function runCli(root, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

describe('B-8: Clean working tree docs content contracts', () => {
  it('AT-B8-001: getting-started mentions clean working tree requirement for authoritative turns', () => {
    const content = readFileSync(join(DOCS_ROOT, 'getting-started.mdx'), 'utf8');
    assert.match(content, /clean.*baseline|clean.*working tree/i, 'getting-started must mention clean baseline/working tree');
    assert.match(content, /commit.*scaffold.*changes.*before.*automated/i, 'must advise committing before first automated turn');
  });

  it('AT-B8-002: quickstart mentions clean working tree caution', () => {
    const content = readFileSync(join(DOCS_ROOT, 'quickstart.mdx'), 'utf8');
    assert.match(content, /clean.*working tree/i, 'quickstart must mention clean working tree');
    assert.match(content, /authoritative.*proposed.*turns.*require/i, 'must state which turn types require it');
  });

  it('AT-B8-003: automation-patterns explains WHY clean baseline is required', () => {
    const content = readFileSync(join(DOCS_ROOT, 'automation-patterns.mdx'), 'utf8');
    assert.match(content, /files_changed.*diff.*baseline/i, 'must explain the diff-baseline mechanism');
    assert.match(content, /artifact.observation/i, 'must mention artifact observation as the validation layer');
    assert.match(content, /false.negative.*rejection/i, 'must explain false-negative rejections from dirty state');
  });
});

describe('B-8: Doctor clean_baseline pre-flight check', () => {
  it('AT-B8-004: doctor reports pass on clean working tree with authoritative roles', () => {
    const root = createGitProject((config) => {
      config.runtimes['local-dev'] = {
        type: 'local_cli',
        command: ['node', '--version'],
        cwd: '.',
        prompt_transport: 'stdin',
      };
      config.roles.dev.runtime = 'local-dev';
      config.roles.dev.write_authority = 'authoritative';
    });

    const result = runCli(root, ['doctor', '--json']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const output = JSON.parse(result.stdout);
    const cleanCheck = output.checks.find((c) => c.id === 'clean_baseline');
    assert.ok(cleanCheck, 'doctor must include clean_baseline check');
    assert.equal(cleanCheck.level, 'pass');
    assert.match(cleanCheck.detail, /clean/i);
  });

  it('AT-B8-005: doctor warns on dirty working tree with authoritative roles', () => {
    const root = createGitProject((config) => {
      config.runtimes['local-dev'] = {
        type: 'local_cli',
        command: ['node', '--version'],
        cwd: '.',
        prompt_transport: 'stdin',
      };
      config.roles.dev.runtime = 'local-dev';
      config.roles.dev.write_authority = 'authoritative';
    });

    // Make tree dirty with a non-exempt file
    writeFileSync(join(root, 'dirty-file.txt'), 'dirty content\n');

    const result = runCli(root, ['doctor', '--json']);
    const output = JSON.parse(result.stdout);
    const cleanCheck = output.checks.find((c) => c.id === 'clean_baseline');
    assert.ok(cleanCheck, 'doctor must include clean_baseline check');
    assert.equal(cleanCheck.level, 'warn');
    assert.match(cleanCheck.detail, /uncommitted changes/i);
    assert.match(cleanCheck.detail, /dev/); // should list writable roles
  });

  it('AT-B8-006: doctor skips clean_baseline check when all roles are review_only', () => {
    const root = createGitProject((config) => {
      for (const role of Object.values(config.roles || {})) {
        role.write_authority = 'review_only';
        role.runtime = 'manual-pm'; // avoid local_cli + review_only invalid combo
      }
    });

    const result = runCli(root, ['doctor', '--json']);
    const output = JSON.parse(result.stdout);
    const cleanCheck = output.checks.find((c) => c.id === 'clean_baseline');
    assert.ok(!cleanCheck, 'clean_baseline check should not appear when no writable roles exist');
  });
});
