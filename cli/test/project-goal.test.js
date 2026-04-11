import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'bin', 'agentxchain.js');
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@test.com', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@test.com' };

function tmpDir() {
  const d = join(tmpdir(), `axc-goal-${randomBytes(4).toString('hex')}`);
  mkdirSync(d, { recursive: true });
  return d;
}

function run(args, opts = {}) {
  return spawnSync('node', [CLI, ...args], {
    encoding: 'utf8',
    timeout: 15_000,
    ...opts,
  });
}

describe('project.goal — config validation', () => {
  it('AT-PG-001: init --governed --goal persists project.goal', () => {
    const root = join(tmpDir(), 'p1');
    try {
      run(['init', '--governed', '-y', '--dir', root, '--goal', 'Build a token rotator']);
      const config = JSON.parse(readFileSync(join(root, 'agentxchain.json'), 'utf8'));
      assert.equal(config.project.goal, 'Build a token rotator');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-PG-001b: init --governed without --goal omits project.goal', () => {
    const root = join(tmpDir(), 'p2');
    try {
      run(['init', '--governed', '-y', '--dir', root]);
      const config = JSON.parse(readFileSync(join(root, 'agentxchain.json'), 'utf8'));
      assert.equal(config.project.goal, undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-PG-002: non-string project.goal is caught by validation', () => {
    const root = join(tmpDir(), 'p3');
    try {
      run(['init', '--governed', '-y', '--dir', root, '--goal', 'placeholder']);
      const configPath = join(root, 'agentxchain.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      config.project.goal = 42;
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      const r = run(['status', '--json'], { cwd: root });
      const combined = (r.stdout || '') + (r.stderr || '');
      assert.match(combined, /project\.goal must be a string/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-PG-003: project.goal over 500 chars fails validation', () => {
    const root = join(tmpDir(), 'p4');
    try {
      run(['init', '--governed', '-y', '--dir', root, '--goal', 'placeholder']);
      const configPath = join(root, 'agentxchain.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      config.project.goal = 'x'.repeat(501);
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      const r = run(['status', '--json'], { cwd: root });
      const combined = (r.stdout || '') + (r.stderr || '');
      assert.match(combined, /500 characters/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('project.goal — dispatch bundle', () => {
  it('AT-PG-004: CONTEXT.md includes Project Goal when goal is set', () => {
    const root = join(tmpDir(), 'p5');
    try {
      run(['init', '--governed', '-y', '--dir', root, '--goal', 'Build a secure token rotation service']);
      execSync('git init && git add -A && git commit -m init', { cwd: root, stdio: 'ignore', env: GIT_ENV });
      run(['step'], { cwd: root });
      const turnsDir = join(root, '.agentxchain/dispatch/turns');
      assert.ok(existsSync(turnsDir), 'dispatch/turns dir should exist');
      const turns = readdirSync(turnsDir).filter(d => d.startsWith('turn_'));
      assert.ok(turns.length > 0, 'should have at least one turn');
      const ctx = readFileSync(join(turnsDir, turns[0], 'CONTEXT.md'), 'utf8');
      assert.match(ctx, /## Project Goal/);
      assert.match(ctx, /Build a secure token rotation service/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-PG-005: CONTEXT.md omits Project Goal when absent', () => {
    const root = join(tmpDir(), 'p6');
    try {
      run(['init', '--governed', '-y', '--dir', root]);
      execSync('git init && git add -A && git commit -m init', { cwd: root, stdio: 'ignore', env: GIT_ENV });
      run(['step'], { cwd: root });
      const turnsDir = join(root, '.agentxchain/dispatch/turns');
      const turns = readdirSync(turnsDir).filter(d => d.startsWith('turn_'));
      assert.ok(turns.length > 0);
      const ctx = readFileSync(join(turnsDir, turns[0], 'CONTEXT.md'), 'utf8');
      assert.ok(!ctx.includes('## Project Goal'), 'CONTEXT.md should NOT contain Project Goal');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('project.goal — status', () => {
  it('AT-PG-006: status --json includes project_goal when set', () => {
    const root = join(tmpDir(), 'p7');
    try {
      run(['init', '--governed', '-y', '--dir', root, '--goal', 'Build a token rotator']);
      const r = run(['status', '--json'], { cwd: root });
      const json = JSON.parse(r.stdout);
      assert.equal(json.project_goal, 'Build a token rotator');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-PG-006b: status --json returns null project_goal when absent', () => {
    const root = join(tmpDir(), 'p8');
    try {
      run(['init', '--governed', '-y', '--dir', root]);
      const r = run(['status', '--json'], { cwd: root });
      const json = JSON.parse(r.stdout);
      assert.equal(json.project_goal, null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('project.goal — export', () => {
  it('AT-PG-008: export includes project_goal in project and summary', () => {
    const root = join(tmpDir(), 'p9');
    try {
      run(['init', '--governed', '-y', '--dir', root, '--goal', 'Build a token rotator']);
      execSync('git init && git add -A && git commit -m init', { cwd: root, stdio: 'ignore', env: GIT_ENV });
      const r = run(['export', '--format', 'json'], { cwd: root });
      const artifact = JSON.parse(r.stdout);
      assert.equal(artifact.project.goal, 'Build a token rotator');
      assert.equal(artifact.summary.project_goal, 'Build a token rotator');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('project.goal — demo', () => {
  it('demo succeeds with project.goal in config', () => {
    const r = run(['demo', '--json']);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, true, 'demo should succeed');
  });
});
