/**
 * E2E plugin lifecycle
 *
 * Proves the real CLI-subprocess path from plugin install/upgrade/remove
 * into actual governed-run hook execution.
 *
 * See: .planning/PLUGIN_LIFECYCLE_E2E_SPEC.md
 */

import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
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

import { scaffoldGoverned } from '../src/commands/init.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');
const mockAgentPath = join(cliRoot, 'test-support', 'mock-agent.mjs');
const tempDirs = [];

function writeJson(filePath, value) {
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readJsonl(filePath) {
  const content = readFileSync(filePath, 'utf8').trim();
  if (!content) {
    return [];
  }
  return content.split('\n').map((line) => JSON.parse(line));
}

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-plugin-e2e-project-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Plugin Lifecycle E2E', `plugin-e2e-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = readJson(configPath);
  const mockRuntime = {
    type: 'local_cli',
    command: process.execPath,
    args: [mockAgentPath],
    prompt_transport: 'dispatch_bundle_only',
  };

  for (const key of Object.keys(config.runtimes)) {
    config.runtimes[key] = { ...mockRuntime };
  }
  for (const role of Object.values(config.roles)) {
    role.write_authority = 'authoritative';
  }

  writeJson(configPath, config);
  return root;
}

function createPluginVersion(name, version, marker) {
  const root = mkdtempSync(join(tmpdir(), 'axc-plugin-e2e-src-'));
  tempDirs.push(root);
  mkdirSync(join(root, 'hooks'), { recursive: true });

  writeJson(join(root, 'package.json'), {
    name,
    version,
    type: 'module',
  });

  writeJson(join(root, 'agentxchain-plugin.json'), {
    schema_version: '0.1',
    name,
    version,
    description: 'Plugin lifecycle E2E fixture',
    hooks: {
      after_acceptance: [
        {
          name: 'plugin_lifecycle_audit',
          type: 'process',
          command: ['node', './hooks/after-acceptance.js'],
          timeout_ms: 5000,
          mode: 'advisory',
        },
      ],
    },
    config_schema: {
      type: 'object',
      required: ['output_file'],
      additionalProperties: false,
      properties: {
        output_file: { type: 'string' },
      },
    },
  });

  writeFileSync(join(root, 'hooks', 'after-acceptance.js'), `
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let raw = '';
for await (const chunk of process.stdin) {
  raw += chunk;
}

const envelope = raw ? JSON.parse(raw) : {};
const config = JSON.parse(process.env.AGENTXCHAIN_PLUGIN_CONFIG || '{}');
const outputFile = config.output_file;

if (outputFile) {
  mkdirSync(dirname(outputFile), { recursive: true });
  appendFileSync(outputFile, JSON.stringify({
    marker: ${JSON.stringify(marker)},
    plugin_name: process.env.AGENTXCHAIN_PLUGIN_NAME || null,
    plugin_version: process.env.AGENTXCHAIN_PLUGIN_VERSION || null,
    hook_phase: envelope.hook_phase || null,
    turn_id: envelope.payload?.turn_id || null,
    role_id: envelope.payload?.role_id || null,
    phase: envelope.payload?.phase || null
  }) + '\\n');
}

process.stdout.write(JSON.stringify({
  verdict: 'allow',
  message: ${JSON.stringify(`plugin ${marker} executed`)}
}));
`);

  return root;
}

function runCli(root, args, opts = {}) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: opts.timeout || 30000,
    input: opts.input || undefined,
    env: { ...process.env, NODE_NO_WARNINGS: '1', NO_COLOR: '1' },
  });
}

function parseJsonResult(result, label) {
  assert.equal(result.status, 0, `${label} failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON:\n${result.stdout}\n${error.message}`);
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('E2E plugin lifecycle', () => {
  it('AT-PLUGIN-E2E-001: plugin install executes through real governed run and records hook audit', () => {
    const project = makeProject();
    const plugin = createPluginVersion('@agentxchain/plugin-lifecycle-e2e', '1.0.0', 'v1');
    const outputPath = join(project, '.agentxchain', 'plugin-events.jsonl');
    const configPath = join(project, 'plugin-config.json');
    writeJson(configPath, { output_file: outputPath });

    parseJsonResult(runCli(project, [
      'plugin', 'install', plugin,
      '--config-file', configPath,
      '--json',
    ]), 'plugin install');

    const runResult = runCli(project, ['run', '--auto-approve', '--max-turns', '5']);
    assert.equal(runResult.status, 0, `run failed:\nstdout:\n${runResult.stdout}\nstderr:\n${runResult.stderr}`);
    assert.match(runResult.stdout, /Run completed/);

    assert.ok(existsSync(outputPath), 'plugin hook must write runtime evidence file');
    const events = readJsonl(outputPath);
    assert.equal(events.length, 3, `expected 3 plugin events, got ${events.length}`);
    assert.deepEqual(events.map((entry) => entry.marker), ['v1', 'v1', 'v1']);
    assert.deepEqual(events.map((entry) => entry.plugin_version), ['1.0.0', '1.0.0', '1.0.0']);
    assert.deepEqual(events.map((entry) => entry.role_id), ['pm', 'dev', 'qa']);
    assert.ok(events.every((entry) => entry.hook_phase === 'after_acceptance'));

    const auditPath = join(project, '.agentxchain', 'hook-audit.jsonl');
    assert.ok(existsSync(auditPath), 'hook audit must exist after plugin execution');
    const auditEntries = readJsonl(auditPath).filter((entry) => entry.hook_name === 'plugin_lifecycle_audit');
    assert.equal(auditEntries.length, 3, `expected 3 plugin hook audit entries, got ${auditEntries.length}`);
    assert.ok(auditEntries.every((entry) => entry.hook_phase === 'after_acceptance'));
    assert.ok(auditEntries.every((entry) => entry.verdict === 'allow'));
  });

  it('AT-PLUGIN-E2E-002: plugin upgrade preserves config/install path and executes upgraded code in real run', () => {
    const project = makeProject();
    const v1 = createPluginVersion('@agentxchain/plugin-lifecycle-e2e', '1.0.0', 'v1');
    const v2 = createPluginVersion('@agentxchain/plugin-lifecycle-e2e', '2.0.0', 'v2');
    const outputPath = join(project, '.agentxchain', 'plugin-events.jsonl');
    const configPath = join(project, 'plugin-config.json');
    writeJson(configPath, { output_file: outputPath });

    const install = parseJsonResult(runCli(project, [
      'plugin', 'install', v1,
      '--config-file', configPath,
      '--json',
    ]), 'plugin install v1');

    const upgrade = parseJsonResult(runCli(project, [
      'plugin', 'upgrade', '@agentxchain/plugin-lifecycle-e2e', v2,
      '--json',
    ]), 'plugin upgrade v2');

    assert.equal(upgrade.install_path, install.install_path, 'upgrade must keep stable install path');
    const config = readJson(join(project, 'agentxchain.json'));
    assert.equal(config.plugins['@agentxchain/plugin-lifecycle-e2e'].version, '2.0.0');
    assert.deepEqual(config.plugins['@agentxchain/plugin-lifecycle-e2e'].config, { output_file: outputPath });

    const runResult = runCli(project, ['run', '--auto-approve', '--max-turns', '5']);
    assert.equal(runResult.status, 0, `run failed:\nstdout:\n${runResult.stdout}\nstderr:\n${runResult.stderr}`);
    assert.match(runResult.stdout, /Run completed/);

    const events = readJsonl(outputPath);
    assert.equal(events.length, 3, `expected 3 plugin events after upgrade, got ${events.length}`);
    assert.deepEqual(events.map((entry) => entry.marker), ['v2', 'v2', 'v2']);
    assert.deepEqual(events.map((entry) => entry.plugin_version), ['2.0.0', '2.0.0', '2.0.0']);
  });

  it('AT-PLUGIN-E2E-003: plugin remove strips hook execution from the real run path', () => {
    const project = makeProject();
    const plugin = createPluginVersion('@agentxchain/plugin-lifecycle-e2e', '1.0.0', 'v1');
    const outputPath = join(project, '.agentxchain', 'plugin-events.jsonl');
    const configPath = join(project, 'plugin-config.json');
    writeJson(configPath, { output_file: outputPath });

    parseJsonResult(runCli(project, [
      'plugin', 'install', plugin,
      '--config-file', configPath,
      '--json',
    ]), 'plugin install');

    parseJsonResult(runCli(project, [
      'plugin', 'remove', '@agentxchain/plugin-lifecycle-e2e',
      '--json',
    ]), 'plugin remove');

    const config = readJson(join(project, 'agentxchain.json'));
    assert.equal(config.plugins, undefined);
    assert.equal(config.hooks?.after_acceptance, undefined);

    const runResult = runCli(project, ['run', '--auto-approve', '--max-turns', '5']);
    assert.equal(runResult.status, 0, `run failed:\nstdout:\n${runResult.stdout}\nstderr:\n${runResult.stderr}`);
    assert.match(runResult.stdout, /Run completed/);

    assert.equal(existsSync(outputPath), false, 'removed plugin must not write runtime evidence');
    const auditPath = join(project, '.agentxchain', 'hook-audit.jsonl');
    assert.equal(existsSync(auditPath), false, 'removed plugin must not create hook audit entries');
  });
});
