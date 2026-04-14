import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'os';

import { scaffoldGoverned } from '../src/commands/init.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const dirs = [];

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function setupProject() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-status-connector-health-'));
  dirs.push(dir);
  scaffoldGoverned(dir, 'Status Connector Health Fixture', 'status-connector-health-fixture');

  // Tests need non-manual runtimes; generic template is now manual-first
  const config = JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8'));
  config.runtimes['local-dev'] = { type: 'local_cli', command: 'echo', prompt_transport: 'stdin' };
  config.runtimes['api-qa'] = { type: 'api_proxy', provider: 'anthropic', model: 'claude-sonnet-4-6', auth_env: 'MOCK_ANTHROPIC_KEY' };
  config.roles.dev.runtime = 'local-dev';
  config.roles.qa.runtime = 'api-qa';
  writeJson(join(dir, 'agentxchain.json'), config);

  const state = JSON.parse(readFileSync(join(dir, '.agentxchain/state.json'), 'utf8'));
  state.run_id = 'run_status_connectors';
  state.status = 'active';
  state.phase = 'qa';
  state.turn_sequence = 2;
  state.active_turns = {
    'turn-dev-002': {
      turn_id: 'turn-dev-002',
      assigned_role: 'dev',
      runtime_id: 'local-dev',
      status: 'running',
      attempt: 1,
      assigned_sequence: 2,
    },
  };
  writeJson(join(dir, '.agentxchain/state.json'), state);

  writeFileSync(join(dir, '.agentxchain', 'history.jsonl'), [
    JSON.stringify({
      turn_id: 'turn-qa-003',
      role: 'qa',
      runtime_id: 'api-qa',
      phase: 'qa',
      accepted_at: '2026-04-10T14:00:03Z',
    }),
  ].join('\n') + '\n');

  mkdirSync(join(dir, '.agentxchain', 'staging', 'turn-qa-003'), { recursive: true });
  writeJson(join(dir, '.agentxchain', 'staging', 'turn-qa-003', 'retry-trace.json'), {
    runtime_id: 'api-qa',
    turn_id: 'turn-qa-003',
    attempts_made: 2,
    final_outcome: 'success',
    attempts: [
      {
        attempt: 2,
        started_at: '2026-04-10T14:00:01.000Z',
        completed_at: '2026-04-10T14:00:01.500Z',
        outcome: 'success',
      },
    ],
  });

  return dir;
}

after(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('status connector health surface', () => {
  it('AT-CHS-001: status --json exposes additive connector health for non-manual runtimes', () => {
    const dir = setupProject();
    const result = runCli(dir, ['status', '--json']);

    assert.equal(result.status, 0, `status --json failed: ${result.stdout}\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.ok(payload.connector_health);
    assert.ok(Array.isArray(payload.connector_health.connectors));

    const runtimeIds = payload.connector_health.connectors.map((entry) => entry.runtime_id);
    assert.deepEqual(runtimeIds, ['api-qa', 'local-dev']);

    const apiQa = payload.connector_health.connectors.find((entry) => entry.runtime_id === 'api-qa');
    assert.equal(apiQa.state, 'healthy');
    assert.equal(apiQa.target, 'anthropic / claude-sonnet-4-6');
  });

  it('AT-CHS-005: human-readable status prints connector section with state, target, and activity', () => {
    const dir = setupProject();
    const result = runCli(dir, ['status']);

    assert.equal(result.status, 0, `status failed: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Connectors:/);
    assert.match(result.stdout, /api-qa — api_proxy \(anthropic \/ claude-sonnet-4-6\)/);
    assert.match(result.stdout, /local-dev — local_cli/);
    assert.match(result.stdout, /Last success:\s+2026-04-10T14:00:03Z/);
    assert.match(result.stdout, /Active turns:\s+turn-dev-002/);
  });
});
