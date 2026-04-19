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
const SCHEMA_PATH = join(ROOT, 'src', 'lib', 'schemas', 'workflow-kit-output.schema.json');

function runCli(cwd, args) {
  return execFileSync('node', [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
    timeout: 15_000,
  });
}

function createProject() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-wko-'));
  runCli(ROOT, ['init', '--governed', '--dir', dir, '-y']);
  return dir;
}

function readConfig(dir) {
  return JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8'));
}

function writeConfig(dir, config) {
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2) + '\n');
}

function loadSchema() {
  return JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
}

function createValidator() {
  const ajv = new Ajv2020({ strict: false });
  return ajv.compile(loadSchema());
}

describe('workflow-kit output schema', () => {
  it('AT-WKO-001: default governed project JSON output validates against the schema', () => {
    const dir = createProject();
    const out = runCli(dir, ['workflow-kit', 'describe', '--json']);
    const contract = JSON.parse(out);
    const validate = createValidator();
    const valid = validate(contract);
    assert.ok(valid, `Schema validation errors: ${JSON.stringify(validate.errors, null, 2)}`);

    // Verify the validated output has the expected structure
    assert.equal(contract.workflow_kit_version, '1.0');
    assert.equal(contract.source, 'default');
    assert.ok(contract.phase_templates.available.length >= 3);
    assert.ok(Object.keys(contract.phases).length >= 3);
    assert.ok(contract.semantic_validators.length >= 7);
  });

  it('AT-WKO-002: explicit workflow_kit config JSON output validates against the schema', () => {
    const dir = createProject();
    const config = readConfig(dir);
    config.workflow_kit = {
      phases: {
        planning: {
          template: 'planning-default',
          artifacts: [
            { path: '.planning/CUSTOM.md', required: true, semantics: null },
          ],
        },
      },
    };
    writeConfig(dir, config);

    const out = runCli(dir, ['workflow-kit', 'describe', '--json']);
    const contract = JSON.parse(out);
    const validate = createValidator();
    const valid = validate(contract);
    assert.ok(valid, `Schema validation errors: ${JSON.stringify(validate.errors, null, 2)}`);

    assert.equal(contract.source, 'mixed');
    assert.equal(contract.phases.planning.source, 'explicit');
  });

  it('AT-WKO-003: schema is importable via package export', () => {
    const require = createRequire(join(ROOT, 'package.json'));
    const schema = require('agentxchain/schemas/workflow-kit-output');
    assert.ok(schema.$schema);
    assert.ok(schema.$id);
    assert.ok(schema.properties);
  });

  it('AT-WKO-004: schema $id and title are correct', () => {
    const schema = loadSchema();
    assert.equal(schema.$id, 'https://agentxchain.dev/schemas/workflow-kit-output.schema.json');
    assert.equal(schema.title, 'AgentXchain Workflow Kit Output');
    assert.ok(schema.required.includes('workflow_kit_version'));
    assert.ok(schema.required.includes('phases'));
    assert.ok(schema.required.includes('semantic_validators'));
    assert.ok(schema.required.includes('gate_artifact_coverage'));
  });

  it('AT-WKO-005: end-to-end config-to-workflow-kit schema round-trip', () => {
    // Prove both schemas work together: config validates, then workflow-kit output validates
    const dir = createProject();

    // Config schema validates the raw config
    const configSchemaPath = join(ROOT, 'src', 'lib', 'schemas', 'agentxchain-config.schema.json');
    const configSchema = JSON.parse(readFileSync(configSchemaPath, 'utf8'));
    const rawConfig = readConfig(dir);
    const ajv = new Ajv2020({ strict: false });
    const validateConfig = ajv.compile(configSchema);
    assert.ok(validateConfig(rawConfig), `Config schema validation failed: ${JSON.stringify(validateConfig.errors)}`);

    // Workflow kit output schema validates the CLI output
    const out = runCli(dir, ['workflow-kit', 'describe', '--json']);
    const contract = JSON.parse(out);
    const wkSchema = loadSchema();
    const validateWk = ajv.compile(wkSchema);
    assert.ok(validateWk(contract), `WK output schema validation failed: ${JSON.stringify(validateWk.errors)}`);

    // Phase IDs in workflow-kit output should match routing phases in config
    const configPhases = Object.keys(rawConfig.routing || {});
    const wkPhases = Object.keys(contract.phases);
    assert.deepEqual(wkPhases.sort(), configPhases.sort(),
      'Workflow kit phases must match config routing phases');
  });
});
