import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import Ajv2020 from 'ajv/dist/2020.js';

const ROOT = join(import.meta.dirname, '..');
const CLI_PATH = join(ROOT, 'bin', 'agentxchain.js');
const require = createRequire(import.meta.url);

const configSchema = require('agentxchain/schemas/agentxchain-config');
const outputSchema = require('agentxchain/schemas/connector-capabilities-output');

const ajv = new Ajv2020({ strict: false, allErrors: true });
const validateConfig = ajv.compile(configSchema);
const validateOutput = ajv.compile(outputSchema);

function runCli(cwd, args) {
  return execFileSync('node', [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
    timeout: 15_000,
  });
}

function createProject() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-schema-roundtrip-'));
  runCli(ROOT, ['init', '--governed', '--dir', dir, '-y']);
  return dir;
}

function readConfig(dir) {
  return JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8'));
}

function writeConfig(dir, config) {
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2) + '\n');
}

function validateRoundTrip(config, output) {
  const configOk = validateConfig(config);
  assert.ok(configOk, `Config schema validation failed: ${JSON.stringify(validateConfig.errors, null, 2)}`);

  const outputOk = validateOutput(output);
  assert.ok(outputOk, `Output schema validation failed: ${JSON.stringify(validateOutput.errors, null, 2)}`);

  assert.ok(Array.isArray(output.runtimes), 'expected multi-runtime connector capabilities output');

  const expectedRuntimeIds = Object.keys(config.runtimes).sort();
  const emittedRuntimeIds = output.runtimes.map(runtime => runtime.runtime_id).sort();
  assert.deepEqual(emittedRuntimeIds, expectedRuntimeIds);

  for (const runtimeReport of output.runtimes) {
    const rawRuntime = config.runtimes[runtimeReport.runtime_id];
    assert.ok(rawRuntime, `runtime ${runtimeReport.runtime_id} missing from raw config`);
    assert.equal(runtimeReport.runtime_type, rawRuntime.type);

    for (const binding of runtimeReport.role_bindings) {
      const rawRole = config.roles[binding.role_id];
      assert.ok(rawRole, `role ${binding.role_id} missing from raw config`);
      assert.equal(
        rawRole.runtime,
        runtimeReport.runtime_id,
        `role ${binding.role_id} was reported under ${runtimeReport.runtime_id} but raw config binds it to ${rawRole.runtime}`
      );
    }
  }
}

describe('connector schema round-trip portability proof', () => {
  it('AT-CSR-001: default governed scaffold validates config and handshake together', () => {
    const dir = createProject();
    const config = readConfig(dir);
    const output = JSON.parse(runCli(dir, ['connector', 'capabilities', '--all', '--json']));

    validateRoundTrip(config, output);
  });

  it('AT-CSR-002: custom runtime and raw role preserve continuity across both schemas', () => {
    const dir = createProject();
    const config = readConfig(dir);

    config.runtimes.writer_mcp = {
      type: 'mcp',
      command: ['writer-mcp'],
      capabilities: {
        can_write_files: 'direct',
        proposal_support: 'optional',
        workflow_artifact_ownership: 'yes'
      }
    };
    config.roles.architect = {
      title: 'Architect',
      mandate: 'Owns technical design coherence.',
      write_authority: 'authoritative',
      runtime: 'writer_mcp'
    };

    writeConfig(dir, config);

    const output = JSON.parse(runCli(dir, ['connector', 'capabilities', '--all', '--json']));
    validateRoundTrip(config, output);

    const writerReport = output.runtimes.find(runtime => runtime.runtime_id === 'writer_mcp');
    assert.ok(writerReport, 'custom runtime should appear in handshake output');
    assert.equal(writerReport.merged_contract.can_write_files, 'direct');

    const architectBinding = writerReport.role_bindings.find(binding => binding.role_id === 'architect');
    assert.ok(architectBinding, 'custom raw role should bind to custom runtime in output');
    assert.equal(architectBinding.role_write_authority, 'authoritative');
  });
});
