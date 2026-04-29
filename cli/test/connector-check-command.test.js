import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const tempDirs = [];

function createProject(mutator, extraSetup) {
  const root = mkdtempSync(join(tmpdir(), 'axc-connector-check-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Connector Check Fixture', `connector-check-${Date.now()}`);
  extraSetup?.(root);

  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  mutator(config);
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return root;
}

function runCli(root, args, env = {}) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, NO_COLOR: '1', ...env },
  });
}

function writeClaudeShim(root, contents) {
  const shimDir = join(root, 'shim-bin');
  mkdirSync(shimDir, { recursive: true });
  const shimPath = join(shimDir, 'claude');
  writeFileSync(shimPath, contents);
  chmodSync(shimPath, 0o755);
  return shimPath;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

describe('agentxchain connector check', () => {
  it('AT-CCP-001: --json fails closed outside a project root', () => {
    const root = mkdtempSync(join(tmpdir(), 'axc-connector-check-missing-'));
    tempDirs.push(root);

    const result = runCli(root, ['connector', 'check', '--json']);
    assert.equal(result.status, 2, result.stdout);
    const output = JSON.parse(result.stdout);
    assert.match(output.error, /No governed agentxchain\.json found/i);
  });

  it('AT-CCP-002: project with only manual runtimes returns pass with zero checked connectors', () => {
    const root = createProject((config) => {
      config.runtimes = {
        'manual-pm': { type: 'manual' },
      };
      for (const role of Object.values(config.roles || {})) {
        role.runtime = 'manual-pm';
        role.write_authority = 'review_only';
      }
    });

    const result = runCli(root, ['connector', 'check', '--json']);
    assert.equal(result.status, 0, result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.overall, 'pass');
    assert.equal(output.connectors.length, 0);
  });

  it('AT-CCP-003: api_proxy missing auth env fails without making a network call', async () => {
    const root = createProject((config) => {
      config.runtimes['api-check'] = {
        type: 'api_proxy',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        auth_env: 'AXC_MISSING_TEST_KEY',
        base_url: 'http://127.0.0.1:9999',
      };
      config.roles.qa.runtime = 'api-check';
      config.roles.qa.write_authority = 'review_only';
    });

    const env = { ...process.env };
    delete env.AXC_MISSING_TEST_KEY;
    const result = runCli(root, ['connector', 'check', 'api-check', '--json'], env);
    assert.equal(result.status, 1, result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.fail_count, 1);
    assert.equal(output.connectors[0].auth_env, 'AXC_MISSING_TEST_KEY');
    assert.match(output.connectors[0].detail, /not set/);
  });

  it('AT-CCP-006: runtime filter checks one named runtime and unknown ids fail closed', () => {
    const root = createProject((config) => {
      config.runtimes['local-dev'] = {
        type: 'local_cli',
        command: ['node', '--version'],
        cwd: '.',
        prompt_transport: 'stdin',
      };
      config.runtimes['api-check'] = {
        type: 'api_proxy',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        auth_env: 'AXC_TEST_KEY',
        base_url: 'http://127.0.0.1:9999',
      };
      config.roles.qa.runtime = 'api-check';
      config.roles.qa.write_authority = 'review_only';
    });

    const filtered = runCli(root, ['connector', 'check', 'local-dev', '--json']);
    assert.equal(filtered.status, 0, filtered.stdout);
    const filteredOutput = JSON.parse(filtered.stdout);
    assert.deepEqual(filteredOutput.connectors.map((entry) => entry.runtime_id), ['local-dev']);

    const unknown = runCli(root, ['connector', 'check', 'does-not-exist', '--json']);
    assert.equal(unknown.status, 2, unknown.stdout);
    const unknownOutput = JSON.parse(unknown.stdout);
    assert.match(unknownOutput.error, /Unknown connector runtime/);
  });

  it('AT-CCP-010: text mode prints per-runtime progress while --json stays progress-free', () => {
    const root = createProject((config) => {
      config.runtimes = {
        'manual-pm': config.runtimes['manual-pm'],
        'local-dev': {
          type: 'local_cli',
          command: ['node', '--version'],
          cwd: '.',
          prompt_transport: 'stdin',
        },
        'manual-qa': { type: 'manual' },
        'manual-director': config.runtimes['manual-director'],
      };
      config.roles.pm.runtime = 'manual-pm';
      config.roles.dev.runtime = 'local-dev';
      config.roles.qa.runtime = 'manual-qa';
      config.roles.qa.write_authority = 'review_only';
      config.roles.eng_director.runtime = 'manual-director';
    });

    const textResult = runCli(root, ['connector', 'check']);
    assert.equal(textResult.status, 0, textResult.stdout);
    assert.match(textResult.stdout, /Probing local-dev \(local_cli\)/);
    assert.match(textResult.stdout, /Timeout: 8000ms per connector/);

    const jsonResult = runCli(root, ['connector', 'check', '--json']);
    assert.equal(jsonResult.status, 0, jsonResult.stdout);
    assert.doesNotMatch(jsonResult.stdout, /Probing local-dev/);
    const output = JSON.parse(jsonResult.stdout);
    assert.equal(output.timeout_ms, 8000);
  });

  it('AT-CC-006: connector check handles space-containing command array elements', () => {
    // Simulate a hand-edited config where the command is ["echo test"] (single element with space)
    const root = createProject((config) => {
      config.runtimes['local-dev'] = {
        type: 'local_cli',
        command: ['echo test'],
        cwd: '.',
        prompt_transport: 'dispatch_bundle_only',
      };
      config.roles.dev.runtime = 'local-dev';
    });

    const result = runCli(root, ['connector', 'check', '--json']);
    assert.equal(result.status, 0, `connector check should pass — commandHead must extract "echo" from "echo test": ${result.stdout}`);
    const output = JSON.parse(result.stdout);
    const localDev = output.connectors.find((c) => c.runtime_id === 'local-dev');
    assert.equal(localDev.level, 'pass');
    assert.match(localDev.detail, /"echo" is resolvable in the dispatch spawn context/);
  });

  it('AT-CCP-011: Claude local_cli without env auth passes connector check when the smoke probe observes stdout', () => {
    let shim;
    const root = createProject((config) => {
      config.runtimes['local-dev'] = {
        type: 'local_cli',
        command: [shim, '--print', '--dangerously-skip-permissions'],
        cwd: '.',
        prompt_transport: 'stdin',
      };
      config.roles.dev.runtime = 'local-dev';
      config.roles.dev.write_authority = 'authoritative';
    }, (projectRoot) => {
      shim = writeClaudeShim(projectRoot, `#!/bin/sh
cat
exit 0
`);
    });

    const env = { ...process.env };
    env.ANTHROPIC_API_KEY = '';
    env.CLAUDE_API_KEY = '';
    env.CLAUDE_CODE_OAUTH_TOKEN = '';
    env.CLAUDE_CODE_USE_VERTEX = '';
    env.CLAUDE_CODE_USE_BEDROCK = '';

    const result = runCli(root, ['connector', 'check', 'local-dev', '--json'], env);
    assert.equal(result.status, 0, result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.overall, 'pass');
    const localDev = output.connectors.find((c) => c.runtime_id === 'local-dev');
    assert.equal(localDev.level, 'pass');
    assert.notEqual(localDev.probe_kind, 'auth_preflight');
    assert.notEqual(localDev.error_code, 'claude_auth_preflight_failed');
    assert.equal(localDev.auth_env_present, undefined);
  });

  it('AT-CCP-011b: Claude local_cli without env auth fails connector check when the smoke probe hangs', () => {
    let shim;
    const root = createProject((config) => {
      config.runtimes['local-dev'] = {
        type: 'local_cli',
        command: [shim, '--print', '--dangerously-skip-permissions'],
        cwd: '.',
        prompt_transport: 'stdin',
      };
      config.roles.dev.runtime = 'local-dev';
      config.roles.dev.write_authority = 'authoritative';
    }, (projectRoot) => {
      shim = writeClaudeShim(projectRoot, `#!/bin/sh
cat > /dev/null
exec sleep 30
`);
    });

    const env = {
      AGENTXCHAIN_CLAUDE_AUTH_PROBE_TIMEOUT_MS: '500',
      ANTHROPIC_API_KEY: '',
      CLAUDE_API_KEY: '',
      CLAUDE_CODE_OAUTH_TOKEN: '',
      CLAUDE_CODE_USE_VERTEX: '',
      CLAUDE_CODE_USE_BEDROCK: '',
    };

    const result = runCli(root, ['connector', 'check', 'local-dev', '--json'], env);
    assert.equal(result.status, 1, result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.overall, 'fail');
    assert.equal(output.fail_count, 1);
    const localDev = output.connectors.find((c) => c.runtime_id === 'local-dev');
    assert.equal(localDev.level, 'fail');
    assert.equal(localDev.probe_kind, 'auth_preflight');
    assert.equal(localDev.error_code, 'claude_auth_preflight_failed');
    assert.match(localDev.detail, /no env-based auth/i);
    assert.match(localDev.fix, /ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN/);
    assert.match(localDev.fix, /--bare/);
    assert.equal(localDev.auth_env_present.ANTHROPIC_API_KEY, false);
    assert.equal(localDev.smoke_probe.kind, 'hang');
  });

  it('AT-CCP-012: connector check does not auth-preflight-fail when Claude runtime declares --bare', () => {
    const root = createProject((config) => {
      config.runtimes['local-dev'] = {
        type: 'local_cli',
        command: ['claude', '--print', '--dangerously-skip-permissions', '--bare'],
        cwd: '.',
        prompt_transport: 'stdin',
      };
      config.roles.dev.runtime = 'local-dev';
      config.roles.dev.write_authority = 'authoritative';
    });

    const env = {
      ANTHROPIC_API_KEY: '',
      CLAUDE_API_KEY: '',
      CLAUDE_CODE_OAUTH_TOKEN: '',
      CLAUDE_CODE_USE_VERTEX: '',
      CLAUDE_CODE_USE_BEDROCK: '',
    };

    const result = runCli(root, ['connector', 'check', 'local-dev', '--json'], env);
    assert.equal(result.status, 0, result.stdout);
    const output = JSON.parse(result.stdout);
    const localDev = output.connectors.find((c) => c.runtime_id === 'local-dev');
    assert.ok(localDev, result.stdout);
    assert.notEqual(localDev.error_code, 'claude_auth_preflight_failed');
    assert.equal(localDev.auth_env_present, undefined);
  });
});
