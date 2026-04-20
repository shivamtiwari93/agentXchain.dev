import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';

const ROOT = join(import.meta.dirname, '..');
const SCHEMA_PATH = join(ROOT, 'src', 'lib', 'schemas', 'agentxchain-config.schema.json');
const PACKAGE_PATH = join(ROOT, 'package.json');
const FIXTURE_PATH = join(ROOT, 'test', 'fixtures', 'config-v4-governed.json');
const PROTOCOL_REFERENCE_DOCS = read(join(ROOT, '..', 'website-v2', 'docs', 'protocol-reference.mdx'));
const CLI_DOCS = read(join(ROOT, '..', 'website-v2', 'docs', 'cli.mdx'));

const ajv = new Ajv2020({ strict: false, allErrors: true });
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const validate = ajv.compile(schema);

function read(path) {
  return readFileSync(path, 'utf8');
}

function readJson(path) {
  return JSON.parse(read(path));
}

describe('agentxchain config schema', () => {
  it('AT-CONFIG-SCHEMA-001: validates a real governed fixture config', () => {
    const fixture = readJson(FIXTURE_PATH);
    const ok = validate(fixture);
    assert.equal(ok, true, JSON.stringify(validate.errors, null, 2));
  });

  it('AT-CONFIG-SCHEMA-002: rejects raw roles that use runtime_id instead of runtime', () => {
    const fixture = readJson(FIXTURE_PATH);
    fixture.roles.dev.runtime_id = fixture.roles.dev.runtime;
    delete fixture.roles.dev.runtime;

    const ok = validate(fixture);
    assert.equal(ok, false, 'schema should fail when raw role uses runtime_id');
    assert.match(JSON.stringify(validate.errors), /runtime|additionalProperties/);
  });

  it('AT-CONFIG-SCHEMA-003: accepts declared runtime capabilities on raw runtimes', () => {
    const fixture = readJson(FIXTURE_PATH);
    fixture.runtimes['local-dev'].capabilities = {
      can_write_files: 'direct',
      proposal_support: 'optional',
      workflow_artifact_ownership: 'yes'
    };

    const ok = validate(fixture);
    assert.equal(ok, true, JSON.stringify(validate.errors, null, 2));
  });

  it('AT-CONFIG-SCHEMA-004: publishes the schema through package exports', () => {
    const pkg = readJson(PACKAGE_PATH);
    assert.equal(
      pkg.exports['./schemas/agentxchain-config'],
      './src/lib/schemas/agentxchain-config.schema.json'
    );
  });

  it('AT-CONFIG-SCHEMA-005: protocol docs state raw runtime vs normalized runtime_id truth', () => {
    assert.match(PROTOCOL_REFERENCE_DOCS, /agentxchain\/schemas\/agentxchain-config/);
    assert.match(PROTOCOL_REFERENCE_DOCS, /roles\.<role>\.runtime/);
    assert.match(PROTOCOL_REFERENCE_DOCS, /`runtime_id`/);
    assert.match(PROTOCOL_REFERENCE_DOCS, /normaliz/i);
  });

  it('AT-CONFIG-SCHEMA-006: CLI docs include the connector capabilities command surface', () => {
    assert.match(CLI_DOCS, /`connector capabilities`/);
    assert.match(CLI_DOCS, /agentxchain connector capabilities \[runtime_id\] \[--all\] \[--json\]/);
    assert.match(CLI_DOCS, /merged_contract/);
    assert.match(CLI_DOCS, /role_bindings/);
  });

  it('AT-CONFIG-SCHEMA-007: publishes run_loop watchdog knobs as schema-backed operator contract', () => {
    const runLoop = schema.properties?.run_loop;
    const localCliRuntime = schema.$defs?.local_cli_runtime;
    assert.ok(runLoop, 'schema must publish run_loop');
    assert.ok(localCliRuntime, 'schema must publish local_cli_runtime');
    assert.equal(runLoop.type, 'object');
    assert.equal(runLoop.properties?.startup_watchdog_ms?.type, 'integer');
    assert.equal(runLoop.properties?.stale_turn_threshold_ms?.type, 'integer');
    assert.equal(localCliRuntime.properties?.startup_watchdog_ms?.type, 'integer');
    assert.match(
      runLoop.properties?.startup_watchdog_ms?.description || '',
      /failed_start|30000/i,
      'startup watchdog schema entry must describe the BUG-51 fast-startup contract'
    );
    assert.match(
      localCliRuntime.properties?.startup_watchdog_ms?.description || '',
      /local_cli|run_loop\.startup_watchdog_ms/i,
      'local_cli runtime schema entry must describe the BUG-54 per-runtime override contract'
    );
    assert.match(
      runLoop.properties?.stale_turn_threshold_ms?.description || '',
      /stale|600000|300000/i,
      'stale threshold schema entry must describe the BUG-47 stale-turn contract'
    );
    assert.match(PROTOCOL_REFERENCE_DOCS, /run_loop\.startup_watchdog_ms/);
    assert.match(PROTOCOL_REFERENCE_DOCS, /runtimes\.<id>\.startup_watchdog_ms/);
    assert.match(PROTOCOL_REFERENCE_DOCS, /run_loop\.stale_turn_threshold_ms/);
    assert.match(CLI_DOCS, /config --set run_loop\.startup_watchdog_ms 45000/);
    assert.match(CLI_DOCS, /config --set runtimes\.local-qa\.startup_watchdog_ms 60000/);
    assert.match(CLI_DOCS, /config --set run_loop\.stale_turn_threshold_ms 600000/);
  });
});
