import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');
const mockAgentPath = join(cliRoot, 'test-support', 'mock-agent.mjs');
const tempDirs = [];

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-builtin-json-report-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Built-In JSON Report E2E', `builtin-json-report-${Date.now()}`);

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

function runCli(root, args) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, NODE_NO_WARNINGS: '1', NO_COLOR: '1' },
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('E2E built-in json-report plugin proof', () => {
  it('AT-BUILTIN-JSON-001: short-name install plus governed run writes report artifacts through real hook execution', () => {
    const project = makeProject();

    const install = runCli(project, ['plugin', 'install', 'json-report', '--json']);
    assert.equal(install.status, 0, `plugin install failed:\n${install.stdout}\n${install.stderr}`);
    const installData = JSON.parse(install.stdout);
    assert.equal(installData.name, '@agentxchain/plugin-json-report');
    assert.equal(installData.source.type, 'builtin');
    assert.equal(installData.source.spec, 'json-report');

    const run = runCli(project, ['run', '--auto-approve', '--max-turns', '5']);
    assert.equal(run.status, 0, `run failed:\n${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /Run completed/);

    const reportsDir = join(project, '.agentxchain', 'reports');
    const latestPath = join(reportsDir, 'latest.json');
    const latestAfterPath = join(reportsDir, 'latest-after_acceptance.json');
    const latestBeforeGatePath = join(reportsDir, 'latest-before_gate.json');

    assert.ok(existsSync(latestPath), 'latest.json should exist');
    assert.ok(existsSync(latestAfterPath), 'latest-after_acceptance.json should exist');
    assert.ok(existsSync(latestBeforeGatePath), 'latest-before_gate.json should exist');

    const latest = readJson(latestPath);
    const latestAfter = readJson(latestAfterPath);
    const latestBeforeGate = readJson(latestBeforeGatePath);
    const state = readJson(join(project, '.agentxchain', 'state.json'));

    for (const report of [latest, latestAfter, latestBeforeGate]) {
      assert.equal(report.plugin_name, '@agentxchain/plugin-json-report');
      assert.equal(report.run_id, state.run_id);
      assert.ok(report.timestamp, 'report should include a timestamp');
      assert.ok(report.payload, 'report should include payload');
    }

    assert.equal(latestAfter.hook_phase, 'after_acceptance');
    assert.equal(latestBeforeGate.hook_phase, 'before_gate');
    assert.equal(latest.hook_phase, 'before_gate');
  });
});
