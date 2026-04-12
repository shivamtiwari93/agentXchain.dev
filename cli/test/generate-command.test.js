import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

const tempDirs = new Set();

function createProject(opts = {}) {
  const dir = join(tmpdir(), `agentxchain-gen-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.add(dir);

  const config = {
    version: 3,
    project: 'Generate Test',
    agents: opts.agents ?? {
      pm: { name: 'PM', mandate: 'Plan work' },
      dev: { name: 'Dev', mandate: 'Build work' },
    },
    talk_file: 'TALK.md',
    state_file: 'state.md',
    history_file: 'history.jsonl',
  };

  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(dir, 'TALK.md'), '');
  writeFileSync(join(dir, 'state.md'), '');
  writeFileSync(join(dir, 'history.jsonl'), '');

  return dir;
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

afterEach(() => {
  for (const dir of [...tempDirs]) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    tempDirs.delete(dir);
  }
});

describe('agentxchain generate', () => {
  it('AT-GENERATE-001: missing project root exits non-zero', () => {
    const dir = join(tmpdir(), `agentxchain-gen-missing-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    tempDirs.add(dir);

    const result = runCli(dir, ['generate']);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /No agentxchain\.json found/);
  });

  it('AT-GENERATE-002: no agents configured exits non-zero', () => {
    const dir = createProject({ agents: {} });

    const result = runCli(dir, ['generate']);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /No agents configured/);
  });

  it('AT-GENERATE-003: generates VS Code agent files for all agents', () => {
    const dir = createProject();

    const result = runCli(dir, ['generate']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Generated 2 agent files/);

    // Agent markdown files should exist
    assert.ok(existsSync(join(dir, '.github', 'agents', 'pm.agent.md')), 'pm agent file missing');
    assert.ok(existsSync(join(dir, '.github', 'agents', 'dev.agent.md')), 'dev agent file missing');
  });

  it('AT-GENERATE-004: output lists each agent with name', () => {
    const dir = createProject();

    const result = runCli(dir, ['generate']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /pm\.agent\.md/);
    assert.match(result.stdout, /dev\.agent\.md/);
    assert.match(result.stdout, /PM/);
    assert.match(result.stdout, /Dev/);
  });

  it('AT-GENERATE-005: output shows file locations', () => {
    const dir = createProject();

    const result = runCli(dir, ['generate']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /\.github\/agents\//);
    assert.match(result.stdout, /\.github\/hooks\//);
    assert.match(result.stdout, /scripts\//);
    assert.match(result.stdout, /VS Code will auto-discover/);
  });
});
