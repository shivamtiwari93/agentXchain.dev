import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import Ajv2020 from 'ajv/dist/2020.js';

const ROOT = join(import.meta.dirname, '..');
const CLI_PATH = join(ROOT, 'bin', 'agentxchain.js');

const schema = JSON.parse(
  readFileSync(join(ROOT, 'src', 'lib', 'schemas', 'connector-capabilities-output.schema.json'), 'utf8')
);

const ajv = new Ajv2020({ strict: false });
const validate = ajv.compile(schema);

function runCli(cwd, args) {
  return execFileSync('node', [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
    timeout: 15_000,
  });
}

function runCliFail(cwd, args) {
  try {
    execFileSync('node', [CLI_PATH, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
      timeout: 15_000,
    });
    assert.fail('Expected CLI to exit non-zero');
  } catch (err) {
    return err;
  }
}

function createProject() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-cap-schema-'));
  runCli(ROOT, ['init', '--governed', '--dir', dir, '-y']);
  return dir;
}

function readConfig(dir) {
  return JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8'));
}

function writeConfig(dir, config) {
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2) + '\n');
}

describe('connector capabilities output schema', () => {
  it('AT-CCO-001: single-runtime output validates against schema', () => {
    const dir = createProject();
    const out = runCli(dir, ['connector', 'capabilities', 'manual-dev', '--json']);
    const result = JSON.parse(out);
    const valid = validate(result);
    assert.ok(valid, `Schema validation failed: ${JSON.stringify(validate.errors, null, 2)}`);
    assert.equal(result.runtime_id, 'manual-dev');
  });

  it('AT-CCO-002: multi-runtime --all output validates against schema', () => {
    const dir = createProject();
    const config = readConfig(dir);
    config.runtimes.extra_mcp = { type: 'mcp', command: ['extra-tool'] };
    writeConfig(dir, config);

    const out = runCli(dir, ['connector', 'capabilities', '--all', '--json']);
    const result = JSON.parse(out);
    const valid = validate(result);
    assert.ok(valid, `Schema validation failed: ${JSON.stringify(validate.errors, null, 2)}`);
    assert.ok(Array.isArray(result.runtimes));
    assert.ok(result.runtimes.length >= 2);
  });

  it('AT-CCO-003: error output for unknown runtime validates against schema', () => {
    const dir = createProject();
    const err = runCliFail(dir, ['connector', 'capabilities', 'nonexistent', '--json']);
    const result = JSON.parse(err.stdout);
    const valid = validate(result);
    assert.ok(valid, `Schema validation failed: ${JSON.stringify(validate.errors, null, 2)}`);
    assert.ok(result.error);
    assert.ok(Array.isArray(result.available_runtimes));
  });

  it('AT-CCO-004: schema is importable via package export', () => {
    const require = createRequire(import.meta.url);
    const exported = require('agentxchain/schemas/connector-capabilities-output');
    assert.equal(exported.$id, schema.$id);
    assert.equal(exported.title, schema.title);
  });

  it('AT-CCO-005: schema $id and title are correct', () => {
    assert.equal(schema.$id, 'https://agentxchain.dev/schemas/connector-capabilities-output.schema.json');
    assert.equal(schema.title, 'AgentXchain Connector Capabilities Output');
    assert.ok(schema.oneOf.length === 3, 'oneOf has single, multi, and error shapes');
  });
});
