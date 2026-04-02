import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function writeJson(filePath, value) {
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
    timeout: 30000,
  });
}

function createGovernedProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-plugin-project-'));
  mkdirSync(join(root, '.agentxchain', 'prompts'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    project: { id: 'plugin-test', name: 'Plugin Test', default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement safely.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
    },
    runtimes: {
      'local-dev': {
        type: 'local_cli',
        command: ['echo', '{prompt}'],
        prompt_transport: 'argv',
      },
    },
    routing: {
      planning: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
      },
    },
    gates: {},
    hooks: {},
  });

  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: 'plugin-test',
    run_id: null,
    status: 'idle',
    phase: 'planning',
    active_turns: {},
    turn_sequence: 0,
    accepted_count: 0,
    rejected_count: 0,
    blocked_on: null,
    blocked_reason: null,
    next_recommended_role: null,
    protocol_mode: 'governed',
  });

  return root;
}

function createLegacyProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-plugin-legacy-'));
  writeJson(join(root, 'agentxchain.json'), {
    version: 3,
    project: 'Legacy Project',
    agents: {
      dev: { name: 'Developer', mandate: 'Build.' },
    },
  });
  return root;
}

function createPluginSource(name, hookName = 'plugin_notify_acceptance') {
  const root = mkdtempSync(join(tmpdir(), 'axc-plugin-src-'));
  mkdirSync(join(root, 'hooks'), { recursive: true });
  writeFileSync(join(root, 'hooks', 'after-acceptance.js'), 'process.stdout.write(JSON.stringify({ verdict: "allow" }));\n');
  writeJson(join(root, 'package.json'), {
    name,
    version: '1.0.0',
    type: 'module',
  });
  writeJson(join(root, 'agentxchain-plugin.json'), {
    schema_version: '0.1',
    name,
    version: '1.0.0',
    description: 'Test plugin',
    hooks: {
      after_acceptance: [
        {
          name: hookName,
          type: 'process',
          command: ['node', './hooks/after-acceptance.js'],
          timeout_ms: 1000,
          mode: 'advisory',
        },
      ],
    },
    config_schema: {
      type: 'object',
    },
  });
  return root;
}

describe('plugin CLI', () => {
  it('AT-PLUGIN-001: installs a plugin from a local directory and rewrites hook paths', () => {
    const project = createGovernedProject();
    const plugin = createPluginSource('@agentxchain/plugin-local-install');

    try {
      const result = runCli(project, ['plugin', 'install', plugin, '--json']);
      assert.equal(result.status, 0, result.stderr);

      const payload = JSON.parse(result.stdout);
      assert.equal(payload.action, 'installed');
      assert.equal(payload.name, '@agentxchain/plugin-local-install');

      const config = readJson(join(project, 'agentxchain.json'));
      assert.ok(config.plugins['@agentxchain/plugin-local-install']);
      assert.equal(config.hooks.after_acceptance.length, 1);
      assert.equal(config.hooks.after_acceptance[0].name, 'plugin_notify_acceptance');
      assert.equal(config.hooks.after_acceptance[0].command[0], 'node');
      assert.match(config.hooks.after_acceptance[0].command[1], /^\.agentxchain\/plugins\//);
      assert.ok(existsSync(join(project, config.plugins['@agentxchain/plugin-local-install'].install_path, 'agentxchain-plugin.json')));
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(plugin, { recursive: true, force: true });
    }
  });

  it('AT-PLUGIN-002: installs a plugin through the npm pack path using a file: spec', () => {
    const project = createGovernedProject();
    const plugin = createPluginSource('@agentxchain/plugin-file-spec');

    try {
      const result = runCli(project, ['plugin', 'install', `file:${plugin}`, '--json']);
      assert.equal(result.status, 0, result.stderr);

      const payload = JSON.parse(result.stdout);
      assert.equal(payload.source.type, 'npm_package');

      const config = readJson(join(project, 'agentxchain.json'));
      assert.ok(config.plugins['@agentxchain/plugin-file-spec']);
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(plugin, { recursive: true, force: true });
    }
  });

  it('AT-PLUGIN-003: refuses install when plugin hook names collide with existing config', () => {
    const project = createGovernedProject();
    const plugin = createPluginSource('@agentxchain/plugin-conflict');

    try {
      const config = readJson(join(project, 'agentxchain.json'));
      config.hooks.after_acceptance = [
        {
          name: 'plugin_notify_acceptance',
          type: 'process',
          command: ['node', '--version'],
          timeout_ms: 1000,
          mode: 'advisory',
        },
      ];
      writeJson(join(project, 'agentxchain.json'), config);

      const before = readFileSync(join(project, 'agentxchain.json'), 'utf8');
      const result = runCli(project, ['plugin', 'install', plugin]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /conflicts with existing config/);
      assert.equal(readFileSync(join(project, 'agentxchain.json'), 'utf8'), before);
      assert.ok(!existsSync(join(project, '.agentxchain', 'plugins')));
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(plugin, { recursive: true, force: true });
    }
  });

  it('AT-PLUGIN-004: lists installed plugins and hook bindings', () => {
    const project = createGovernedProject();
    const plugin = createPluginSource('@agentxchain/plugin-list');

    try {
      const install = runCli(project, ['plugin', 'install', plugin]);
      assert.equal(install.status, 0, install.stderr);

      const result = runCli(project, ['plugin', 'list', '--json']);
      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.plugins.length, 1);
      assert.equal(payload.plugins[0].name, '@agentxchain/plugin-list');
      assert.deepStrictEqual(payload.plugins[0].hooks.after_acceptance, ['plugin_notify_acceptance']);
      assert.equal(payload.plugins[0].installed, true);
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(plugin, { recursive: true, force: true });
    }
  });

  it('AT-PLUGIN-005: removes a plugin and only deletes that plugin hooks', () => {
    const project = createGovernedProject();
    const plugin = createPluginSource('@agentxchain/plugin-remove');

    try {
      const config = readJson(join(project, 'agentxchain.json'));
      config.hooks.before_gate = [
        {
          name: 'operator_gate_guard',
          type: 'process',
          command: ['node', '--version'],
          timeout_ms: 1000,
          mode: 'blocking',
        },
      ];
      writeJson(join(project, 'agentxchain.json'), config);

      const install = runCli(project, ['plugin', 'install', plugin, '--json']);
      assert.equal(install.status, 0, install.stderr);
      const installPath = JSON.parse(install.stdout).install_path;

      const remove = runCli(project, ['plugin', 'remove', '@agentxchain/plugin-remove', '--json']);
      assert.equal(remove.status, 0, remove.stderr);

      const nextConfig = readJson(join(project, 'agentxchain.json'));
      assert.equal(nextConfig.plugins, undefined);
      assert.deepStrictEqual(nextConfig.hooks.before_gate.map((hook) => hook.name), ['operator_gate_guard']);
      assert.equal(nextConfig.hooks.after_acceptance, undefined);
      assert.ok(!existsSync(join(project, installPath)));
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(plugin, { recursive: true, force: true });
    }
  });

  it('AT-PLUGIN-006: rejects plugin commands in legacy projects', () => {
    const legacy = createLegacyProject();
    const plugin = createPluginSource('@agentxchain/plugin-legacy-reject');

    try {
      const install = runCli(legacy, ['plugin', 'install', plugin]);
      assert.notEqual(install.status, 0);
      assert.match(install.stderr, /only support governed projects/);

      const list = runCli(legacy, ['plugin', 'list']);
      assert.notEqual(list.status, 0);
      assert.match(list.stderr, /only support governed projects/);
    } finally {
      rmSync(legacy, { recursive: true, force: true });
      rmSync(plugin, { recursive: true, force: true });
    }
  });
});
