import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

import { scaffoldGoverned } from '../src/commands/init.js';
import { getConnectorHealth } from '../src/lib/connector-health.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dirs = [];

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function setupProject(stateOverrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'axc-connector-health-'));
  dirs.push(dir);
  scaffoldGoverned(dir, 'Connector Health Fixture', 'connector-health-fixture');
  const config = JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8'));
  // Tests need non-manual runtimes; generic template is now manual-first
  config.runtimes['local-dev'] = { type: 'local_cli', command: 'echo', prompt_transport: 'stdin' };
  config.runtimes['api-qa'] = { type: 'api_proxy', provider: 'anthropic', model: 'claude-sonnet-4-6', auth_env: 'MOCK_ANTHROPIC_KEY' };
  config.roles.dev.runtime = 'local-dev';
  config.roles.qa.runtime = 'api-qa';
  writeJson(join(dir, 'agentxchain.json'), config);
  const state = {
    ...JSON.parse(readFileSync(join(dir, '.agentxchain/state.json'), 'utf8')),
    run_id: 'run_connector_001',
    status: 'active',
    phase: 'qa',
    active_turns: {},
    ...stateOverrides,
  };
  writeJson(join(dir, '.agentxchain/state.json'), state);
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  return { dir, config, state };
}

after(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('connector health helper', () => {
  it('AT-CHS-002: derives healthy api_proxy runtime from retry trace plus accepted history', () => {
    const { dir, config, state } = setupProject();

    writeFileSync(join(dir, '.agentxchain', 'history.jsonl'), [
      JSON.stringify({
        turn_id: 'turn-qa-001',
        role: 'qa',
        runtime_id: 'api-qa',
        phase: 'qa',
        accepted_at: '2026-04-10T12:00:02Z',
      }),
    ].join('\n') + '\n');

    mkdirSync(join(dir, '.agentxchain', 'staging', 'turn-qa-001'), { recursive: true });
    writeJson(join(dir, '.agentxchain', 'staging', 'turn-qa-001', 'retry-trace.json'), {
      runtime_id: 'api-qa',
      turn_id: 'turn-qa-001',
      attempts_made: 2,
      final_outcome: 'success',
      attempts: [
        {
          attempt: 1,
          started_at: '2026-04-10T11:59:58Z',
          completed_at: '2026-04-10T11:59:59Z',
          outcome: 'rate_limited',
        },
        {
          attempt: 2,
          started_at: '2026-04-10T12:00:01.000Z',
          completed_at: '2026-04-10T12:00:01.842Z',
          outcome: 'success',
        },
      ],
    });

    const result = getConnectorHealth(dir, config, state);
    const apiQa = result.connectors.find((entry) => entry.runtime_id === 'api-qa');

    assert.ok(apiQa);
    assert.equal(apiQa.state, 'healthy');
    assert.equal(apiQa.reachable, 'yes');
    assert.equal(apiQa.attempts_made, 2);
    assert.equal(apiQa.latency_ms, 842);
    assert.equal(apiQa.last_turn_id, 'turn-qa-001');
    assert.equal(apiQa.last_role, 'qa');
    assert.equal(apiQa.last_phase, 'qa');
  });

  it('AT-CHS-003: derives failing runtime from staged API error and blocked turn evidence', () => {
    const { dir, config, state } = setupProject({
      status: 'blocked',
      active_turns: {
        'turn-qa-002': {
          turn_id: 'turn-qa-002',
          assigned_role: 'qa',
          runtime_id: 'api-qa',
          status: 'failed',
          attempt: 1,
        },
      },
      blocked_on: 'rate_limited',
      blocked_reason: {
        category: 'adapter_failure',
        blocked_at: '2026-04-10T13:00:03Z',
        turn_id: 'turn-qa-002',
        recovery: {
          detail: 'Rate limited by anthropic',
        },
      },
    });

    mkdirSync(join(dir, '.agentxchain', 'staging', 'turn-qa-002'), { recursive: true });
    writeJson(join(dir, '.agentxchain', 'staging', 'turn-qa-002', 'retry-trace.json'), {
      runtime_id: 'api-qa',
      turn_id: 'turn-qa-002',
      attempts_made: 3,
      final_outcome: 'failure',
      attempts: [
        {
          attempt: 3,
          started_at: '2026-04-10T13:00:00.000Z',
          completed_at: '2026-04-10T13:00:00.500Z',
          outcome: 'rate_limited',
        },
      ],
    });
    writeJson(join(dir, '.agentxchain', 'staging', 'turn-qa-002', 'api-error.json'), {
      error_class: 'rate_limited',
      message: 'Rate limited by anthropic',
    });

    const result = getConnectorHealth(dir, config, state);
    const apiQa = result.connectors.find((entry) => entry.runtime_id === 'api-qa');

    assert.ok(apiQa);
    assert.equal(apiQa.state, 'failing');
    assert.equal(apiQa.reachable, 'no');
    assert.equal(apiQa.last_error, 'Rate limited by anthropic');
    assert.equal(apiQa.last_failure_at, '2026-04-10T13:00:03Z');
    assert.equal(apiQa.active_turn_ids[0], 'turn-qa-002');
  });

  it('AT-CHS-004: active local_cli turn renders as active without fake reachability', () => {
    const { dir, config, state } = setupProject({
      active_turns: {
        'turn-dev-001': {
          turn_id: 'turn-dev-001',
          assigned_role: 'dev',
          runtime_id: 'local-dev',
          status: 'running',
          attempt: 1,
        },
      },
    });

    const result = getConnectorHealth(dir, config, state);
    const localDev = result.connectors.find((entry) => entry.runtime_id === 'local-dev');
    const runtimeIds = result.connectors.map((entry) => entry.runtime_id);

    assert.ok(localDev);
    assert.equal(localDev.state, 'active');
    assert.equal(localDev.reachable, 'unknown');
    assert.deepEqual(localDev.active_turn_ids, ['turn-dev-001']);
    assert.ok(!runtimeIds.includes('manual-pm'), 'manual runtimes must be excluded');
  });
});
