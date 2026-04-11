import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const CLI_BIN = join(ROOT, 'cli', 'bin', 'agentxchain.js');
const SPEC = readFileSync(join(ROOT, '.planning', 'GOVERNED_CONFIG_COMMAND_SPEC.md'), 'utf8');
const BUDGET_SPEC = readFileSync(join(ROOT, '.planning', 'BUDGET_CONFIG_VALIDATION_SPEC.md'), 'utf8');

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
  });
}

function createGovernedProject() {
  const dir = mkdtempSync(join(tmpdir(), 'agentxchain-config-governed-'));
  const init = runCli(ROOT, ['init', '--governed', '--dir', dir, '-y']);
  assert.equal(init.status, 0, init.stderr || init.stdout);
  return dir;
}

describe('governed config command', () => {
  it('AT-CFGG-001: config --set <key> <value...> works in governed repos', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['config', '--set', 'project.goal', 'Build', 'a', 'test', 'app']);
      assert.equal(result.status, 0, result.stderr || result.stdout);

      const config = JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8'));
      assert.equal(config.project.goal, 'Build a test app');

      const status = runCli(dir, ['status', '--json']);
      assert.equal(status.status, 0, status.stderr || status.stdout);
      assert.equal(JSON.parse(status.stdout).project_goal, 'Build a test app');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-CFGG-002: config --set keeps backward compatibility with the quoted single-argument form', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['config', '--set', 'project.goal Build a quoted test app']);
      assert.equal(result.status, 0, result.stderr || result.stdout);

      const config = JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8'));
      assert.equal(config.project.goal, 'Build a quoted test app');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-CFGG-003: config --json returns the governed config instead of rejecting v4 repos', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['config', '--json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);

      const config = JSON.parse(result.stdout);
      assert.equal(config.schema_version, '1.0');
      assert.equal(typeof config.project.name, 'string');
      assert.ok(config.project.name.length > 0);
      assert.ok(config.roles.pm);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-CFGG-004: invalid governed edits fail closed and do not write broken config', () => {
    const dir = createGovernedProject();
    try {
      const longGoal = 'x'.repeat(501);
      const result = runCli(dir, ['config', '--set', 'project.goal', longGoal]);
      assert.notEqual(result.status, 0, 'invalid governed config edit must fail');
      assert.match(result.stdout, /Refusing to save invalid config/);

      const config = JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8'));
      assert.equal(config.project.goal, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-CFGG-005: plain config output works on governed repos', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['config']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /AgentXchain Governed Config/);
      assert.match(result.stdout, /agentxchain config --set project\.goal/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-CFGG-006: invalid budget limits fail closed and do not mutate governed config', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['config', '--set', 'budget.per_turn_max_usd', 'banana']);
      assert.notEqual(result.status, 0, 'invalid budget edit must fail');
      assert.match(result.stdout, /Refusing to save invalid config/);

      const config = JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8'));
      assert.equal(config.budget.per_turn_max_usd, 2.0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-CFGG-007: supported budget edits save through config --set', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['config', '--set', 'budget.per_run_max_usd', '75']);
      assert.equal(result.status, 0, result.stderr || result.stdout);

      const config = JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8'));
      assert.equal(config.budget.per_run_max_usd, 75);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('governed config command spec', () => {
  it('records the governed config mutation contract', () => {
    assert.match(SPEC, /## Purpose/);
    assert.match(SPEC, /## Interface/);
    assert.match(SPEC, /## Behavior/);
    assert.match(SPEC, /## Acceptance Tests/);
    assert.match(SPEC, /AT-CFGG-001/);
    assert.match(SPEC, /AT-CFGG-005/);
  });

  it('records the governed budget config validation contract', () => {
    assert.match(BUDGET_SPEC, /## Purpose/);
    assert.match(BUDGET_SPEC, /## Interface/);
    assert.match(BUDGET_SPEC, /## Behavior/);
    assert.match(BUDGET_SPEC, /## Error Cases/);
    assert.match(BUDGET_SPEC, /## Acceptance Tests/);
    assert.match(BUDGET_SPEC, /AT-BCV-001/);
    assert.match(BUDGET_SPEC, /AT-BCV-006/);
  });
});
