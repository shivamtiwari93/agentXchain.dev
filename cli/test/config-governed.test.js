import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const CLI_BIN = join(ROOT, 'cli', 'bin', 'agentxchain.js');
const SPEC = readFileSync(join(ROOT, '.planning', 'GOVERNED_CONFIG_COMMAND_SPEC.md'), 'utf8');
const GET_SPEC = readFileSync(join(ROOT, '.planning', 'CONFIG_GET_COMMAND_SPEC.md'), 'utf8');
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

  it('AT-CFGG-008: config --set saves successfully even with dead-end gate topology (admission control is in validate/doctor)', () => {
    const dir = createGovernedProject();
    try {
      const configPath = join(dir, 'agentxchain.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      for (const runtimeId of Object.keys(config.runtimes || {})) {
        config.runtimes[runtimeId] = {
          type: 'remote_agent',
          url: `https://example.com/${runtimeId}/turn`,
        };
      }
      for (const role of Object.values(config.roles || {})) {
        role.write_authority = 'review_only';
      }
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

      // config --set is schema validation only — admission control (ADM-001..004)
      // is surfaced by validate, doctor, and run commands instead
      const result = runCli(dir, ['config', '--set', 'project.goal', 'Warn', 'about', 'dead-end', 'gates']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-CFGG-009: config --set rejects non-string project.default_branch values before writing', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['config', '--set', 'project.default_branch', '123']);
      assert.notEqual(result.status, 0, 'numeric default_branch must fail');
      assert.match(result.stdout, /Refusing to save invalid config/);
      assert.match(result.stdout, /project\.default_branch must be a non-empty string when provided/);

      const config = JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8'));
      assert.equal(config.project.default_branch, 'main');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-CFGGET-001: config --get project.goal prints a governed scalar value', () => {
    const dir = createGovernedProject();
    try {
      const set = runCli(dir, ['config', '--set', 'project.goal', 'Ship', 'a', 'governed', 'CLI']);
      assert.equal(set.status, 0, set.stderr || set.stdout);

      const result = runCli(dir, ['config', '--get', 'project.goal']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(result.stdout.trim(), 'Ship a governed CLI');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-CFGGET-002: config --get roles.qa --json prints structured JSON for an object path', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['config', '--get', 'roles.qa', '--json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);

      const value = JSON.parse(result.stdout);
      const config = JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8'));
      assert.deepEqual(value, config.roles.qa);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-CFGGET-003: config --get missing.path fails closed with a clear missing-path error', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['config', '--get', 'missing.path']);
      assert.notEqual(result.status, 0, 'missing config path must fail');
      assert.match(result.stdout, /Config path not found: missing\.path/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-CFGGET-004: config --get and --set together fail as mutually exclusive', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['config', '--get', 'project.goal', '--set', 'project.goal', 'Ship']);
      assert.notEqual(result.status, 0, 'ambiguous config invocation must fail');
      assert.match(result.stdout, /--get and --set are mutually exclusive/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-CFGG-RL-001: config --set accepts a valid BUG-51 startup_watchdog_ms', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['config', '--set', 'run_loop.startup_watchdog_ms', '45000']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const config = JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8'));
      assert.equal(config.run_loop.startup_watchdog_ms, 45000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-CFGG-RL-002: config --set rejects startup_watchdog_ms=0 (schema minimum 1)', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['config', '--set', 'run_loop.startup_watchdog_ms', '0']);
      assert.notEqual(result.status, 0, 'invalid watchdog edit must fail');
      assert.match(result.stdout, /Refusing to save invalid config/);
      assert.match(result.stdout, /run_loop\.startup_watchdog_ms/);
      const config = JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8'));
      assert.equal(config.run_loop?.startup_watchdog_ms, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-CFGG-RL-003: config --set rejects negative startup_watchdog_ms (quoted form so commander does not swallow the leading dash)', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['config', '--set', 'run_loop.startup_watchdog_ms -1']);
      assert.notEqual(result.status, 0, 'negative watchdog must fail');
      assert.match(result.stdout, /Refusing to save invalid config/);
      assert.match(result.stdout, /run_loop\.startup_watchdog_ms/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-CFGG-RL-004: config --set rejects non-integer startup_watchdog_ms (string coerced to NaN)', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['config', '--set', 'run_loop.startup_watchdog_ms', 'banana']);
      assert.notEqual(result.status, 0, 'non-integer watchdog must fail');
      assert.match(result.stdout, /Refusing to save invalid config/);
      assert.match(result.stdout, /run_loop\.startup_watchdog_ms/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-CFGG-RL-005: config --set rejects stale_turn_threshold_ms=0 (BUG-47 contract)', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['config', '--set', 'run_loop.stale_turn_threshold_ms', '0']);
      assert.notEqual(result.status, 0, 'invalid stale threshold must fail');
      assert.match(result.stdout, /Refusing to save invalid config/);
      assert.match(result.stdout, /run_loop\.stale_turn_threshold_ms/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-CFGG-RL-006: validate surfaces invalid run_loop values written directly to the config file', () => {
    const dir = createGovernedProject();
    try {
      const configPath = join(dir, 'agentxchain.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      // Operator hand-edits the JSON to something bogus — validate must catch it.
      config.run_loop = { startup_watchdog_ms: -30000, stale_turn_threshold_ms: 0 };
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

      const result = runCli(dir, ['validate', '--json']);
      const stdout = result.stdout || '';
      const parsed = JSON.parse(stdout);
      assert.equal(parsed.ok, false, 'validate must fail on invalid run_loop');
      const errorText = JSON.stringify(parsed.errors || []);
      assert.match(errorText, /run_loop\.startup_watchdog_ms/);
      assert.match(errorText, /run_loop\.stale_turn_threshold_ms/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // --- api_proxy max_output_tokens (silent-fallback defect class) ---

  function addApiProxyRuntime(config, overrides = {}) {
    config.runtimes = config.runtimes || {};
    config.runtimes['api-qa'] = {
      type: 'api_proxy',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      auth_env: 'ANTHROPIC_API_KEY',
      ...overrides,
    };
    return config;
  }

  it('AT-CFGG-MOT-001: validate rejects api_proxy max_output_tokens=0 (silent-fallback to 4096 in adapter)', () => {
    const dir = createGovernedProject();
    try {
      const configPath = join(dir, 'agentxchain.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      addApiProxyRuntime(config, { max_output_tokens: 0 });
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

      const result = runCli(dir, ['validate', '--json']);
      const parsed = JSON.parse(result.stdout || '');
      assert.equal(parsed.ok, false, 'validate must fail on max_output_tokens=0');
      const errorText = JSON.stringify(parsed.errors || []);
      assert.match(errorText, /max_output_tokens must be a positive integer/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-CFGG-MOT-002: validate rejects negative api_proxy max_output_tokens (adapter would pass it raw to provider)', () => {
    const dir = createGovernedProject();
    try {
      const configPath = join(dir, 'agentxchain.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      addApiProxyRuntime(config, { max_output_tokens: -4096 });
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

      const result = runCli(dir, ['validate', '--json']);
      const parsed = JSON.parse(result.stdout || '');
      assert.equal(parsed.ok, false);
      assert.match(JSON.stringify(parsed.errors || []), /max_output_tokens must be a positive integer/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-CFGG-MOT-003: validate accepts a valid positive-integer api_proxy max_output_tokens', () => {
    const dir = createGovernedProject();
    try {
      const configPath = join(dir, 'agentxchain.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      addApiProxyRuntime(config, { max_output_tokens: 4096 });
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

      const result = runCli(dir, ['validate', '--json']);
      const parsed = JSON.parse(result.stdout || '');
      // validate may still flag other issues (role binding, routing) depending on init template,
      // but the max_output_tokens error specifically must not appear.
      const errorText = JSON.stringify(parsed.errors || []);
      assert.doesNotMatch(errorText, /max_output_tokens must be a positive integer/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-CFGG-PDB-001: validate rejects hand-edited blank project.default_branch', () => {
    const dir = createGovernedProject();
    try {
      const configPath = join(dir, 'agentxchain.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      config.project.default_branch = '   ';
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

      const result = runCli(dir, ['validate', '--json']);
      const parsed = JSON.parse(result.stdout || '');
      assert.equal(parsed.ok, false, 'validate must fail on blank project.default_branch');
      assert.match(
        JSON.stringify(parsed.errors || []),
        /project\.default_branch must be a non-empty string when provided/,
      );
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

  it('records the config --get inspection contract', () => {
    assert.match(GET_SPEC, /## Purpose/);
    assert.match(GET_SPEC, /## Interface/);
    assert.match(GET_SPEC, /## Behavior/);
    assert.match(GET_SPEC, /## Error Cases/);
    assert.match(GET_SPEC, /## Acceptance Tests/);
    assert.match(GET_SPEC, /AT-CFGGET-001/);
    assert.match(GET_SPEC, /AT-CFGGET-005/);
  });
});
