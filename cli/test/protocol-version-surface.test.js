import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const MOCK_AGENT = join(__dirname, '..', 'test-support', 'mock-agent.mjs');
const tempDirs = [];

function makeGovernedRoot() {
  const root = mkdtempSync(join(tmpdir(), 'axc-pvs-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Version Surface Test', `version-surface-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const mockRuntime = {
    type: 'local_cli',
    command: process.execPath,
    args: [MOCK_AGENT],
    prompt_transport: 'dispatch_bundle_only',
  };

  for (const runtimeId of Object.keys(config.runtimes || {})) {
    config.runtimes[runtimeId] = { ...mockRuntime };
  }
  for (const role of Object.values(config.roles || {})) {
    role.write_authority = 'authoritative';
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return root;
}

function runCli(root, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15000,
  });
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

describe('Protocol version surfaces', () => {
  it('AT-PVS-001: doctor --json exposes protocol, generation, and schema separately', () => {
    const root = makeGovernedRoot();
    const result = runCli(root, ['doctor', '--json']);
    assert.equal(result.status, 0, `doctor failed: ${result.stderr}`);

    const output = JSON.parse(result.stdout);
    assert.equal(output.protocol_version, 'v7');
    assert.equal(output.config_generation, 4);
    assert.equal(output.config_schema_version, '1.0');
    assert.equal(output.config_version, 4, 'legacy alias should remain for compatibility');
  });

  it('AT-PVS-002: human doctor output distinguishes protocol from config generation', () => {
    const root = makeGovernedRoot();
    const result = runCli(root, ['doctor']);
    assert.equal(result.status, 0, `doctor failed: ${result.stderr}`);
    assert.match(result.stdout, /Versioning:\s+protocol v7, config generation v4, config schema 1\.0/);
  });

  it('AT-PVS-003: validate --json exposes protocol, generation, and schema separately', () => {
    const root = makeGovernedRoot();
    const result = runCli(root, ['validate', '--mode', 'kickoff', '--json']);
    assert.equal(result.status, 0, `validate failed: ${result.stderr}\n${result.stdout}`);

    const output = JSON.parse(result.stdout);
    assert.equal(output.protocol_version, 'v7');
    assert.equal(output.config_generation, 4);
    assert.equal(output.config_schema_version, '1.0');
    assert.equal(output.version, 4, 'legacy alias should remain for compatibility');
  });

  it('AT-PVS-004: human validate output distinguishes protocol from config generation', () => {
    const root = makeGovernedRoot();
    const result = runCli(root, ['validate', '--mode', 'kickoff']);
    assert.equal(result.status, 0, `validate failed: ${result.stderr}\n${result.stdout}`);
    assert.match(result.stdout, /Protocol:\s+governed \(protocol v7, config generation v4, config schema 1\.0\)/);
  });
});
