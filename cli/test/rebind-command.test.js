import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

const tempDirs = new Set();

function createProject(opts = {}) {
  const dir = join(tmpdir(), `agentxchain-rebind-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.add(dir);

  const config = {
    version: 3,
    project: 'Rebind Test',
    agents: opts.agents ?? {
      pm: { name: 'PM', mandate: 'Plan work', model: 'gpt-4' },
      dev: { name: 'Dev', mandate: 'Build work', model: 'claude-3' },
    },
    talk_file: 'TALK.md',
    state_file: 'state.md',
    history_file: 'history.jsonl',
  };

  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(dir, 'TALK.md'), '## Turn 1\n- Next owner: pm\n');
  writeFileSync(join(dir, 'state.md'), '# state\n');
  writeFileSync(join(dir, 'history.jsonl'), '');

  if (opts.autonudgeState) {
    writeFileSync(join(dir, '.agentxchain-autonudge.state'), JSON.stringify({ last: 'pm' }));
  }

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

describe('agentxchain rebind', () => {
  it('AT-REBIND-001: missing project root exits non-zero', () => {
    const dir = join(tmpdir(), `agentxchain-rebind-missing-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    tempDirs.add(dir);

    const result = runCli(dir, ['rebind']);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /No agentxchain\.json found/);
  });

  it('AT-REBIND-002: no agents configured exits non-zero', () => {
    const dir = createProject({ agents: {} });

    const result = runCli(dir, ['rebind']);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /No agents configured/);
  });

  it('AT-REBIND-003: rebind all agents creates prompt and workspace files for each', () => {
    const dir = createProject();

    const result = runCli(dir, ['rebind']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    // Prompt files
    assert.ok(existsSync(join(dir, '.agentxchain-prompts', 'pm.prompt.md')), 'pm prompt missing');
    assert.ok(existsSync(join(dir, '.agentxchain-prompts', 'dev.prompt.md')), 'dev prompt missing');

    // Workspace files
    const pmWs = JSON.parse(readFileSync(join(dir, '.agentxchain-workspaces', 'pm.code-workspace'), 'utf8'));
    assert.equal(pmWs.settings['agentxchain.agentId'], 'pm');
    assert.ok(pmWs.folders[0].path, 'workspace missing folder path');

    const devWs = JSON.parse(readFileSync(join(dir, '.agentxchain-workspaces', 'dev.code-workspace'), 'utf8'));
    assert.equal(devWs.settings['agentxchain.agentId'], 'dev');
  });

  it('AT-REBIND-004: --agent flag rebinds only the specified agent', () => {
    const dir = createProject();

    const result = runCli(dir, ['rebind', '--agent', 'pm']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    assert.ok(existsSync(join(dir, '.agentxchain-prompts', 'pm.prompt.md')), 'pm prompt missing');
    assert.ok(!existsSync(join(dir, '.agentxchain-prompts', 'dev.prompt.md')), 'dev prompt should not exist');

    assert.ok(existsSync(join(dir, '.agentxchain-workspaces', 'pm.code-workspace')), 'pm workspace missing');
    assert.ok(!existsSync(join(dir, '.agentxchain-workspaces', 'dev.code-workspace')), 'dev workspace should not exist');

    assert.match(result.stdout, /Rebound 1 agent session/);
  });

  it('AT-REBIND-005: unknown --agent ID exits non-zero', () => {
    const dir = createProject();

    const result = runCli(dir, ['rebind', '--agent', 'nonexistent']);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Agent "nonexistent" not found/);
  });

  it('AT-REBIND-006: autonudge state file is deleted after rebind', () => {
    const dir = createProject({ autonudgeState: true });
    assert.ok(existsSync(join(dir, '.agentxchain-autonudge.state')), 'autonudge state should exist before rebind');

    const result = runCli(dir, ['rebind']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(!existsSync(join(dir, '.agentxchain-autonudge.state')), 'autonudge state should be deleted');
    assert.match(result.stdout, /Auto-nudge dispatch state reset/);
  });

  it('AT-REBIND-007: summary output shows correct count and paths', () => {
    const dir = createProject();

    const result = runCli(dir, ['rebind']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Rebound 2 agent session/);
    assert.match(result.stdout, /\.agentxchain-prompts/);
    assert.match(result.stdout, /\.agentxchain-workspaces/);
    assert.match(result.stdout, /rebind --open/);
  });
});
