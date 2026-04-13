import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function run(args, cwd) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function makeGoverned(dir, extraConfig = {}) {
  const base = {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'test-doctor-plugins', name: 'Test', default_branch: 'main' },
    roles: {
      dev: { title: 'Dev', mandate: 'Build.', write_authority: 'full', runtime_class: 'manual', runtime_id: 'manual-dev' },
    },
    runtimes: { 'manual-dev': { type: 'manual' } },
    routing: { planning: { dev: {} } },
    ...extraConfig,
  };
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(base, null, 2));
}

function installFakePlugin(dir, pluginName, manifest, hookFiles = {}) {
  const installPath = `.agentxchain/plugins/${pluginName}`;
  const absPath = join(dir, installPath);
  mkdirSync(absPath, { recursive: true });

  writeFileSync(join(absPath, 'agentxchain-plugin.json'), JSON.stringify(manifest, null, 2));

  for (const [file, content] of Object.entries(hookFiles)) {
    const hookDir = dirname(join(absPath, file));
    mkdirSync(hookDir, { recursive: true });
    writeFileSync(join(absPath, file), content);
  }

  return { installPath, absPath };
}

describe('doctor plugin health checks', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'doctor-plugin-'));
    mkdirSync(join(tmpDir, '.agentxchain'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // AT-DOCTOR-PLUGIN-005: doctor omits plugin checks when no plugins installed
  it('omits plugin checks when no plugins are installed', () => {
    makeGoverned(tmpDir);
    const result = run(['doctor', '--json'], tmpDir);
    const output = JSON.parse(result.stdout);
    const pluginChecks = output.checks.filter(c => c.id.startsWith('plugin_'));
    assert.equal(pluginChecks.length, 0, 'should have no plugin checks');
  });

  // AT-DOCTOR-PLUGIN-001: doctor --json includes plugin health when plugins installed
  it('reports pass for a healthy installed plugin', () => {
    const { installPath } = installFakePlugin(tmpDir, 'test-plugin', {
      schema_version: '0.1',
      name: 'test-plugin',
      version: '1.0.0',
      hooks: {
        on_turn_accepted: { command: ['./hooks/on_turn_accepted.js'] },
      },
    }, {
      'hooks/on_turn_accepted.js': '#!/usr/bin/env node\nconsole.log("ok");',
    });

    makeGoverned(tmpDir, {
      plugins: {
        'test-plugin': {
          version: '1.0.0',
          install_path: installPath,
          hooks: { on_turn_accepted: { command: ['node', '.agentxchain/plugins/test-plugin/hooks/on_turn_accepted.js'] } },
        },
      },
    });

    const result = run(['doctor', '--json'], tmpDir);
    const output = JSON.parse(result.stdout);
    const pluginCheck = output.checks.find(c => c.id.startsWith('plugin_'));
    assert.ok(pluginCheck, 'should have a plugin check');
    assert.equal(pluginCheck.level, 'pass');
    assert.match(pluginCheck.detail, /1\.0\.0/);
    assert.match(pluginCheck.detail, /1 hook/);
  });

  // AT-DOCTOR-PLUGIN-002: doctor reports fail when install path is missing
  it('reports fail when plugin install path is missing', () => {
    makeGoverned(tmpDir, {
      plugins: {
        'missing-plugin': {
          version: '1.0.0',
          install_path: '.agentxchain/plugins/missing-plugin',
          hooks: {},
        },
      },
    });

    const result = run(['doctor', '--json'], tmpDir);
    const output = JSON.parse(result.stdout);
    const pluginCheck = output.checks.find(c => c.id.startsWith('plugin_'));
    assert.ok(pluginCheck, 'should have a plugin check');
    assert.equal(pluginCheck.level, 'fail');
    assert.match(pluginCheck.detail, /Install path missing/i);
  });

  // AT-DOCTOR-PLUGIN-003: doctor reports fail when manifest is corrupt
  it('reports fail when plugin manifest is corrupt JSON', () => {
    const installPath = '.agentxchain/plugins/corrupt-plugin';
    const absPath = join(tmpDir, installPath);
    mkdirSync(absPath, { recursive: true });
    writeFileSync(join(absPath, 'agentxchain-plugin.json'), '{ broken json !!!');

    makeGoverned(tmpDir, {
      plugins: {
        'corrupt-plugin': {
          version: '1.0.0',
          install_path: installPath,
          hooks: {},
        },
      },
    });

    const result = run(['doctor', '--json'], tmpDir);
    const output = JSON.parse(result.stdout);
    const pluginCheck = output.checks.find(c => c.id.startsWith('plugin_'));
    assert.ok(pluginCheck, 'should have a plugin check');
    assert.equal(pluginCheck.level, 'fail');
    assert.match(pluginCheck.detail, /corrupt JSON/i);
  });

  // AT-DOCTOR-PLUGIN-004: doctor reports warn when env var is unset
  it('reports warn when plugin config env var is unset', () => {
    const { installPath } = installFakePlugin(tmpDir, 'env-plugin', {
      schema_version: '0.1',
      name: 'env-plugin',
      version: '1.0.0',
      hooks: {},
    });

    // Use an env var name that is definitely not set
    const envVarName = 'AGENTXCHAIN_TEST_DOCTOR_MISSING_VAR_' + Date.now();

    makeGoverned(tmpDir, {
      plugins: {
        'env-plugin': {
          version: '1.0.0',
          install_path: installPath,
          hooks: {},
          config: { webhook_env: envVarName },
        },
      },
    });

    const result = run(['doctor', '--json'], tmpDir);
    const output = JSON.parse(result.stdout);
    const pluginCheck = output.checks.find(c => c.id.startsWith('plugin_'));
    assert.ok(pluginCheck, 'should have a plugin check');
    assert.equal(pluginCheck.level, 'warn');
    assert.match(pluginCheck.detail, /not set/i);
  });

  // AT-DOCTOR-PLUGIN-006: doctor --json plugin check includes plugin_name
  it('includes plugin_name field in JSON output', () => {
    const { installPath } = installFakePlugin(tmpDir, 'named-plugin', {
      schema_version: '0.1',
      name: 'named-plugin',
      version: '0.5.0',
      hooks: {},
    });

    makeGoverned(tmpDir, {
      plugins: {
        'named-plugin': {
          version: '0.5.0',
          install_path: installPath,
          hooks: {},
        },
      },
    });

    const result = run(['doctor', '--json'], tmpDir);
    const output = JSON.parse(result.stdout);
    const pluginCheck = output.checks.find(c => c.id.startsWith('plugin_'));
    assert.ok(pluginCheck, 'should have a plugin check');
    assert.equal(pluginCheck.plugin_name, 'named-plugin');
  });
});
