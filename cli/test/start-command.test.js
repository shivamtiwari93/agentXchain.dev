import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

const tempDirs = new Set();

function createLegacyProject(opts = {}) {
  const dir = join(tmpdir(), `agentxchain-start-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.add(dir);

  const config = {
    version: 3,
    project: opts.project ?? 'Start Test',
    agents: opts.agents ?? {
      pm: { name: 'Product Manager', mandate: 'Plan work' },
      dev: { name: 'Developer', mandate: 'Build work' },
      qa: { name: 'QA', mandate: 'Verify work' },
    },
    talk_file: 'TALK.md',
    state_file: 'state.md',
    history_file: 'history.jsonl',
  };

  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(dir, 'TALK.md'), '## Turn 1\n- Next owner: pm\n');
  writeFileSync(join(dir, 'state.md'), '# state\n');
  writeFileSync(join(dir, 'history.jsonl'), '');
  writeFileSync(join(dir, 'lock.json'), JSON.stringify({
    holder: null,
    last_released_by: null,
    turn_number: 0,
    claimed_at: null,
  }, null, 2));
  writeFileSync(join(dir, 'state.json'), JSON.stringify({
    phase: 'planning',
    blocked: false,
    blocked_on: null,
    project: config.project,
  }, null, 2));

  if (opts.includePlanning !== false) {
    seedPlanningFiles(dir, { approved: opts.approved !== false });
  }

  return dir;
}

function seedPlanningFiles(dir, { approved }) {
  mkdirSync(join(dir, '.planning', 'qa'), { recursive: true });
  mkdirSync(join(dir, '.planning', 'phases', 'phase-1'), { recursive: true });

  writeFileSync(join(dir, '.planning', 'PROJECT.md'), '# Project\n');
  writeFileSync(join(dir, '.planning', 'REQUIREMENTS.md'), '# Requirements\n');
  writeFileSync(join(dir, '.planning', 'ROADMAP.md'), '# Roadmap\n\n## Wave 1\n\n### Phase 1\n- Ship kickoff\n');
  writeFileSync(
    join(dir, '.planning', 'PM_SIGNOFF.md'),
    `# PM Signoff\n\nApproved: ${approved ? 'YES' : 'NO'}\n`,
  );
  writeFileSync(join(dir, '.planning', 'phases', 'phase-1', 'PLAN.md'), '# Plan\n');
  writeFileSync(join(dir, '.planning', 'phases', 'phase-1', 'TESTS.md'), '# Tests\n');
  writeFileSync(join(dir, '.planning', 'qa', 'TEST-COVERAGE.md'), '# Coverage\n');
  writeFileSync(join(dir, '.planning', 'qa', 'BUGS.md'), '# Bugs\n');
  writeFileSync(join(dir, '.planning', 'qa', 'UX-AUDIT.md'), '# UX\n');
  writeFileSync(join(dir, '.planning', 'qa', 'ACCEPTANCE-MATRIX.md'), '# Acceptance\n');
  writeFileSync(join(dir, '.planning', 'qa', 'REGRESSION-LOG.md'), '# Regression\n');
}

function createStubBinDir() {
  const dir = join(tmpdir(), `agentxchain-start-bin-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.add(dir);

  writeExecutable(dir, 'pbcopy', '#!/bin/sh\ncat > "${STUB_LOG_DIR}/pbcopy.txt"\n');
  writeExecutable(dir, 'xclip', '#!/bin/sh\ncat > "${STUB_LOG_DIR}/xclip.txt"\n');
  writeExecutable(dir, 'open', '#!/bin/sh\nprintf "%s\\n" "$@" > "${STUB_LOG_DIR}/open.txt"\n');
  writeExecutable(dir, 'cursor', '#!/bin/sh\nprintf "%s\\n" "$@" > "${STUB_LOG_DIR}/cursor.txt"\n');
  writeExecutable(dir, 'claude', '#!/bin/sh\nprintf "%s\\n" "$@" > "${STUB_LOG_DIR}/claude.txt"\n');

  return dir;
}

function writeExecutable(dir, name, content) {
  const file = join(dir, name);
  writeFileSync(file, content);
  chmodSync(file, 0o755);
}

function runCli(cwd, args, extraEnv = {}) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 20_000,
    env: { ...process.env, NO_COLOR: '1', ...extraEnv },
  });
}

async function waitForFile(path, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(path)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

afterEach(() => {
  for (const dir of [...tempDirs]) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    tempDirs.delete(dir);
  }
});

describe('agentxchain start', () => {
  it('AT-START-001: missing project root exits non-zero', () => {
    const dir = join(tmpdir(), `agentxchain-start-missing-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    tempDirs.add(dir);

    const result = runCli(dir, ['start']);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /No agentxchain\.json found/);
    assert.match(result.stdout, /Run `agentxchain init` first/);
  });

  it('AT-START-002: no agents configured exits non-zero', () => {
    const dir = createLegacyProject({ agents: {} });

    const result = runCli(dir, ['start']);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /No agents configured/);
    assert.match(result.stdout, /config --add-agent/);
  });

  it('AT-START-003: unknown --agent exits non-zero with available IDs', () => {
    const dir = createLegacyProject();

    const result = runCli(dir, ['start', '--agent', 'ops']);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Agent "ops" not found/);
    assert.match(result.stdout, /Available: pm, dev, qa/);
  });

  it('AT-START-004: --agent and --remaining fail closed together', () => {
    const dir = createLegacyProject();

    const result = runCli(dir, ['start', '--agent', 'pm', '--remaining']);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /--agent and --remaining cannot be used together/);
  });

  it('AT-START-005: --remaining fails while PM kickoff validation is incomplete', () => {
    const dir = createLegacyProject({ approved: false });

    const result = runCli(dir, ['start', '--remaining']);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /PM kickoff is incomplete/);
    assert.match(result.stdout, /PM signoff is not approved/);
    assert.match(result.stdout, /Approved: NO/);
    assert.match(result.stdout, /agentxchain validate --mode kickoff/);
  });

  it('AT-START-006: approved --remaining --dry-run excludes PM and lists only remaining agents', () => {
    const dir = createLegacyProject({ approved: true });

    const result = runCli(dir, ['start', '--remaining', '--dry-run', '--ide', 'cursor']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Launch mode: remaining agents \(2\)/);
    assert.match(result.stdout, /dev — Developer/);
    assert.match(result.stdout, /qa — QA/);
    assert.doesNotMatch(result.stdout, /pm — Product Manager/);
  });

  it('AT-START-007: plain --dry-run prints the PM-first launch tip', () => {
    const dir = createLegacyProject({ approved: true });

    const result = runCli(dir, ['start', '--dry-run']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /DRY RUN — showing agents/);
    assert.match(result.stdout, /pm — Product Manager/);
    assert.match(result.stdout, /dev — Developer/);
    assert.match(result.stdout, /qa — QA/);
  });

  it('AT-START-008: --ide vscode prints usage guidance for a single agent launch', () => {
    const dir = createLegacyProject({ approved: true });

    const result = runCli(dir, ['start', '--ide', 'vscode', '--agent', 'pm']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Launch mode: single agent \(pm\)/);
    assert.match(result.stdout, /VS Code custom agents/);
    assert.match(result.stdout, /\.github\/agents\/:/);
    assert.match(result.stdout, /agentxchain release/);
    assert.ok(!existsSync(join(dir, '.agentxchain-session.json')), 'VS Code path should not create a session file');
  });

  it('AT-START-009: --ide cursor --agent pm writes kickoff prompt and workspace files', () => {
    const dir = createLegacyProject({ approved: true });
    const stubDir = createStubBinDir();
    const logDir = join(dir, '.stub-logs');
    mkdirSync(logDir, { recursive: true });

    const result = runCli(dir, ['start', '--ide', 'cursor', '--agent', 'pm'], {
      PATH: `${stubDir}:${process.env.PATH}`,
      STUB_LOG_DIR: logDir,
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /PM kickoff mode/);
    assert.match(result.stdout, /Prompt copied to clipboard|Clipboard copy failed/);
    assert.match(result.stdout, /Cursor window opened|Could not open Cursor window automatically/);
    assert.match(result.stdout, /agentxchain start --remaining/);

    const prompt = readFileSync(join(dir, '.agentxchain-prompts', 'pm.prompt.md'), 'utf8');
    assert.match(prompt, /Please describe your product idea in one paragraph/);

    const workspace = JSON.parse(readFileSync(join(dir, '.agentxchain-workspaces', 'pm.code-workspace'), 'utf8'));
    assert.equal(workspace.settings['agentxchain.agentId'], 'pm');

    const clipboardLog = process.platform === 'darwin'
      ? join(logDir, 'pbcopy.txt')
      : join(logDir, 'xclip.txt');
    const launcherLog = process.platform === 'darwin'
      ? join(logDir, 'open.txt')
      : join(logDir, 'cursor.txt');
    assert.ok(existsSync(clipboardLog), 'clipboard helper should be invoked');
    assert.ok(existsSync(launcherLog), 'window launcher should be invoked');
  });

  it('AT-START-010: --ide claude-code --agent dev writes a session file', async () => {
    const dir = createLegacyProject({ approved: true });
    const stubDir = createStubBinDir();
    const logDir = join(dir, '.stub-logs');
    mkdirSync(logDir, { recursive: true });

    const result = runCli(dir, ['start', '--ide', 'claude-code', '--agent', 'dev'], {
      PATH: `${stubDir}:${process.env.PATH}`,
      STUB_LOG_DIR: logDir,
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Launch mode: single agent \(dev\)/);
    assert.match(result.stdout, /Launched dev \(Developer\) — PID:/);
    assert.match(result.stdout, /Session saved to \.agentxchain-session\.json/);

    const sessionPath = join(dir, '.agentxchain-session.json');
    assert.ok(existsSync(sessionPath), 'session file should exist');
    const session = JSON.parse(readFileSync(sessionPath, 'utf8'));
    assert.equal(session.ide, 'claude-code');
    assert.equal(session.launched.length, 1);
    assert.equal(session.launched[0].id, 'dev');

    const claudeLogPath = join(logDir, 'claude.txt');
    await waitForFile(claudeLogPath);
    const claudeLog = readFileSync(claudeLogPath, 'utf8');
    assert.match(claudeLog, /--system-prompt/);
    assert.match(claudeLog, /You are "dev"/);
  });
});
