import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { buildConnectorSchemaContract } from '../src/lib/connector-schema-contract.js';

function makeConfigs() {
  const rawConfig = {
    runtimes: {
      local_dev: {
        type: 'local_cli',
        command: ['node', 'agent.mjs'],
      },
    },
    roles: {
      dev: {
        runtime: 'local_dev',
        write_authority: 'authoritative',
      },
    },
  };

  const normalizedConfig = {
    runtimes: {
      local_dev: {
        type: 'local_cli',
        command: ['node', 'agent.mjs'],
      },
    },
    roles: {
      dev: {
        runtime_id: 'local_dev',
        write_authority: 'authoritative',
      },
    },
  };

  return { rawConfig, normalizedConfig };
}

describe('connector schema contract', () => {
  it('AT-CSC-001: valid runtime+role continuity returns a passing schema contract', () => {
    const { rawConfig, normalizedConfig } = makeConfigs();
    const result = buildConnectorSchemaContract(rawConfig, normalizedConfig, 'local_dev', 'dev');

    assert.equal(result.ok, true);
    assert.equal(result.config_schema_artifact, 'agentxchain/schemas/agentxchain-config');
    assert.equal(result.capabilities_output_schema_artifact, 'agentxchain/schemas/connector-capabilities-output');
    assert.deepEqual(result.continuity, {
      raw_config_runtime_present: true,
      raw_role_present: true,
      raw_role_binding_matches_runtime: true,
      capabilities_report_runtime_matches: true,
      capabilities_report_role_binding_matches: true,
    });
    assert.deepEqual(result.failures, []);
  });

  it('AT-CSC-002: raw role/runtime mismatch fails closed with a named failure', () => {
    const { rawConfig, normalizedConfig } = makeConfigs();
    rawConfig.roles.dev.runtime = 'other_runtime';

    const result = buildConnectorSchemaContract(rawConfig, normalizedConfig, 'local_dev', 'dev');

    assert.equal(result.ok, false);
    assert.equal(result.continuity.raw_role_binding_matches_runtime, false);
    assert.match(result.failures.join('\n'), /roles\.dev\.runtime/);
  });

  it('AT-CSC-003: missing capability-report binding fails closed', () => {
    const { rawConfig, normalizedConfig } = makeConfigs();
    delete normalizedConfig.roles.dev.runtime_id;
    normalizedConfig.roles.dev.runtime = 'other_runtime';

    const result = buildConnectorSchemaContract(rawConfig, normalizedConfig, 'local_dev', 'dev');

    assert.equal(result.ok, false);
    assert.equal(result.continuity.capabilities_report_role_binding_matches, false);
    assert.match(result.failures.join('\n'), /omitted the "dev" binding/);
  });
});
