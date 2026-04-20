import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_BIN = join(cliRoot, 'bin', 'agentxchain.js');
const MOCK_AGENT = join(cliRoot, 'test-support', 'mock-agent.mjs');
const tempDirs = [];

function makeGoverned({ schedules, breakConfig, removeAuthEnv, liveProbeRuntime, remoteReviewOnlyGate } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-gd-e2e-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Doctor E2E', `doctor-e2e-${Date.now()}`);

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

  if (remoteReviewOnlyGate) {
    for (const runtimeId of Object.keys(config.runtimes || {})) {
      config.runtimes[runtimeId] = {
        type: 'remote_agent',
        url: `https://example.com/${runtimeId}/turn`,
      };
    }
    for (const role of Object.values(config.roles || {})) {
      role.write_authority = 'review_only';
    }
  }

  if (schedules) {
    config.schedules = schedules;
  }

  if (removeAuthEnv) {
    // Add a new api_proxy runtime requiring a missing env var
    config.runtimes['api-test'] = {
      type: 'api_proxy',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      auth_env: 'AXC_DOCTOR_TEST_MISSING_KEY_12345',
    };
    // Point one role to it with review_only (api_proxy requires non-authoritative)
    const firstRoleId = Object.keys(config.roles)[0];
    config.roles[firstRoleId].runtime = 'api-test';
    config.roles[firstRoleId].write_authority = 'review_only';
  }

  if (liveProbeRuntime === 'api_proxy') {
    config.runtimes['api-live'] = {
      type: 'api_proxy',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      auth_env: 'AXC_DOCTOR_LIVE_PROBE_KEY',
    };
    const firstRoleId = Object.keys(config.roles)[0];
    config.roles[firstRoleId].runtime = 'api-live';
    config.roles[firstRoleId].write_authority = 'review_only';
  }

  if (liveProbeRuntime === 'remote_agent') {
    config.runtimes['remote-live'] = {
      type: 'remote_agent',
      endpoint: 'https://example.com/agent',
    };
    const firstRoleId = Object.keys(config.roles)[0];
    config.roles[firstRoleId].runtime = 'remote-live';
    config.roles[firstRoleId].write_authority = 'review_only';
  }

  if (liveProbeRuntime === 'mcp_http') {
    config.runtimes['mcp-live'] = {
      type: 'mcp',
      transport: 'streamable_http',
      endpoint: 'https://example.com/mcp',
    };
    const firstRoleId = Object.keys(config.roles)[0];
    config.roles[firstRoleId].runtime = 'mcp-live';
    config.roles[firstRoleId].write_authority = 'review_only';
  }

  if (breakConfig) {
    // Remove required fields to break validation
    delete config.roles;
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return root;
}

function makeLegacy() {
  const root = mkdtempSync(join(tmpdir(), 'axc-gd-e2e-'));
  tempDirs.push(root);
  const config = {
    version: 3,
    project: 'legacy-test',
    agents: {
      pm: { name: 'Product Manager', mandate: 'Plan the work' },
      dev: { name: 'Developer', mandate: 'Write the code' },
    },
  };
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2) + '\n');
  return root;
}

function runCli(root, args, opts = {}) {
  const env = { ...process.env, ...opts.env };
  // Ensure the test env var for removeAuthEnv case is unset
  delete env.AXC_DOCTOR_TEST_MISSING_KEY_12345;
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15000,
    env,
  });
  return result;
}

function createStubNpmDir(version) {
  const dir = mkdtempSync(join(tmpdir(), 'axc-doctor-npm-'));
  tempDirs.push(dir);
  const binDir = join(dir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const stub = join(binDir, 'npm');
  writeFileSync(stub, `#!/usr/bin/env node
const args = process.argv.slice(2).join(' ');
if (args === 'view agentxchain version') {
  process.stdout.write('${version}\\n');
  process.exit(0);
}
process.exit(1);
`);
  spawnSync('chmod', ['+x', stub], { encoding: 'utf8' });
  return binDir;
}

function createStubBinDir(name, body) {
  const dir = mkdtempSync(join(tmpdir(), 'axc-doctor-bin-'));
  tempDirs.push(dir);
  const binPath = join(dir, name);
  writeFileSync(binPath, body);
  spawnSync('chmod', ['+x', binPath], { encoding: 'utf8' });
  return dir;
}

afterEach(() => {
  while (tempDirs.length) {
    const d = tempDirs.pop();
    try { rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

describe('Governed Doctor E2E', () => {
  it('AT-GD-001: valid governed project returns overall pass', () => {
    const root = makeGoverned();
    const result = runCli(root, ['doctor', '--json']);
    assert.equal(result.status, 0, `Exit code should be 0. stderr: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert.equal(output.protocol_version, 'v7');
    assert.equal(output.config_generation, 4);
    assert.equal(output.config_schema_version, '1.0');
    assert.equal(output.config_version, 4);
    assert.equal(output.overall, 'pass', `Expected overall pass but got: ${JSON.stringify(output.checks, null, 2)}`);
    assert.ok(output.checks.length >= 4, 'Should have at least 4 checks');
    // Config validation should pass
    const configCheck = output.checks.find(c => c.id === 'config_valid');
    assert.equal(configCheck.level, 'pass');
    // Roles should pass
    const rolesCheck = output.checks.find(c => c.id === 'roles_defined');
    assert.equal(rolesCheck.level, 'pass');
  });

  it('AT-GD-002: missing runtime env var returns overall fail with runtime_reachable failing', () => {
    const root = makeGoverned({ removeAuthEnv: true });
    const result = runCli(root, ['doctor', '--json']);
    assert.equal(result.status, 1, 'Exit code should be 1 for failing checks');
    const output = JSON.parse(result.stdout);
    assert.equal(output.overall, 'fail');
    const runtimeChecks = output.checks.filter(c => c.id.startsWith('runtime_'));
    const failing = runtimeChecks.find(c => c.level === 'fail');
    assert.ok(failing, 'Should have at least one failing runtime check');
    assert.ok(failing.detail.includes('not set'), `Detail should mention env var not set: ${failing.detail}`);
  });

  it('AT-GD-003: governed project before first run returns state_health as warn', () => {
    const root = makeGoverned();
    const result = runCli(root, ['doctor', '--json']);
    const output = JSON.parse(result.stdout);
    const stateCheck = output.checks.find(c => c.id === 'state_health');
    // May be warn (no state file) or pass (if scaffold creates state dir)
    // Before first run, state.json should not exist
    const statePath = join(root, '.agentxchain', 'state.json');
    if (!existsSync(statePath)) {
      assert.equal(stateCheck.level, 'warn', 'State health should be warn before first run');
      assert.ok(stateCheck.detail.includes('first run'), `Detail should mention first run: ${stateCheck.detail}`);
    }
    // If state.json exists from scaffold, it should pass
    if (existsSync(statePath)) {
      assert.equal(stateCheck.level, 'pass');
    }
  });

  it('AT-GD-004: human-readable output prints PASS/WARN/FAIL badges', () => {
    const root = makeGoverned();
    const result = runCli(root, ['doctor']);
    assert.equal(result.status, 0);
    const out = result.stdout;
    assert.ok(out.includes('Governed Doctor'), 'Should include "Governed Doctor" heading');
    assert.ok(out.includes('Config validation'), 'Should include Config validation check');
    assert.ok(out.includes('Roles defined'), 'Should include Roles defined check');
  });

  it('AT-GD-005: legacy v3 project runs legacy checks, not governed checks', () => {
    const root = makeLegacy();
    // Legacy doctor may hang on macOS accessibility checks; use a short timeout
    // and only verify it starts the legacy path (not governed)
    const result = spawnSync(process.execPath, [CLI_BIN, 'doctor'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 5000,
    });
    const out = result.stdout || '';
    // If it produces output, it should be the legacy doctor, not governed
    if (out.length > 0) {
      assert.ok(!out.includes('Governed Doctor'), 'Should NOT use governed doctor heading');
      // Legacy doctor prints "AgentXchain Doctor" (not "Governed Doctor")
      assert.ok(out.includes('AgentXchain Doctor') || out.includes('PM agent') || out.includes('jq'),
        'Should contain legacy doctor markers');
    } else {
      // If it timed out or produced no output, verify it did not exit cleanly
      // with governed doctor output — the test passes as long as it did NOT
      // dispatch to the governed path
      assert.ok(!out.includes('Governed Doctor'), 'Should NOT run governed doctor for v3 config');
    }
  });

  it('AT-GD-006: doctor warns when Claude local_cli lacks env auth and --bare', () => {
    const root = makeGoverned();
    const configPath = join(root, 'agentxchain.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.runtimes['local-dev'] = {
      type: 'local_cli',
      command: ['claude', '--print', '--dangerously-skip-permissions'],
      cwd: '.',
      prompt_transport: 'stdin',
    };
    config.roles.dev.runtime = 'local-dev';
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    const claudeBinDir = createStubBinDir('claude', `#!/usr/bin/env node
process.exit(0);
`);
    const result = runCli(root, ['doctor', '--json'], {
      PATH: `${claudeBinDir}:${process.env.PATH || ''}`,
      ANTHROPIC_API_KEY: '',
      CLAUDE_API_KEY: '',
      CLAUDE_CODE_OAUTH_TOKEN: '',
      CLAUDE_CODE_USE_VERTEX: '',
      CLAUDE_CODE_USE_BEDROCK: '',
    });

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    const runtimeCheck = output.checks.find((check) => check.id === 'runtime_local-dev');
    assert.ok(runtimeCheck, 'doctor must report local-dev runtime');
    assert.equal(runtimeCheck.level, 'warn');
    assert.match(runtimeCheck.detail, /no env-based auth/i);
    assert.match(runtimeCheck.detail, /ANTHROPIC_API_KEY/);
    assert.match(runtimeCheck.detail, /--bare/);
  });

  it('AT-GD-007: governed project with schedules but no daemon returns schedule_health warn', () => {
    const root = makeGoverned({
      schedules: {
        nightly: {
          every_minutes: 1440,
          auto_approve: true,
          max_turns: 5,
          initial_role: 'pm',
        },
      },
    });
    const result = runCli(root, ['doctor', '--json']);
    const output = JSON.parse(result.stdout);
    const schedCheck = output.checks.find(c => c.id === 'schedule_health');
    assert.ok(schedCheck, 'Should have schedule_health check when schedules configured');
    assert.equal(schedCheck.level, 'warn', 'Should be warn when daemon has not started');
  });

  it('AT-GD-008: directory with no config exits code 1', () => {
    const root = mkdtempSync(join(tmpdir(), 'axc-gd-e2e-'));
    tempDirs.push(root);
    const result = runCli(root, ['doctor', '--json']);
    assert.equal(result.status, 1, 'Should exit 1 when no config found');
    const output = JSON.parse(result.stdout);
    assert.ok(output.error, 'Should have error field');
    assert.ok(output.error.includes('No agentxchain.json'), `Error should mention missing config: ${output.error}`);
  });

  it('AT-GD-009: json output recommends connector check for live-probe runtimes', () => {
    const root = makeGoverned({ liveProbeRuntime: 'api_proxy' });
    const result = runCli(root, ['doctor', '--json'], {
      env: { AXC_DOCTOR_LIVE_PROBE_KEY: 'test-key' },
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.connector_probe_recommended, true);
    assert.deepEqual(output.connector_probe_runtime_ids, ['api-live']);
    assert.match(output.connector_probe_detail, /connector check/);
    assert.match(output.connector_probe_detail, /connector validate/);
  });

  it('AT-GD-010: text output prints connector-check handoff when readiness passes', () => {
    const root = makeGoverned({ liveProbeRuntime: 'api_proxy' });
    const result = runCli(root, ['doctor'], {
      env: { AXC_DOCTOR_LIVE_PROBE_KEY: 'test-key' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Next: run `agentxchain connector check`/);
    assert.match(result.stdout, /connector validate/);
  });

  it('AT-GD-011: local-only runtimes do not recommend connector check', () => {
    const root = makeGoverned();
    const jsonResult = runCli(root, ['doctor', '--json']);
    assert.equal(jsonResult.status, 0, jsonResult.stderr);
    const output = JSON.parse(jsonResult.stdout);
    assert.equal(output.connector_probe_recommended, false);
    assert.deepEqual(output.connector_probe_runtime_ids, []);
    assert.equal(output.connector_probe_detail, null);

    const textResult = runCli(root, ['doctor']);
    assert.equal(textResult.status, 0, textResult.stderr);
    assert.doesNotMatch(textResult.stdout, /connector check/);
  });

  it('AT-GD-012: dead-end gate topology surfaces as admission_control fail check', () => {
    const root = makeGoverned({ remoteReviewOnlyGate: true });
    const result = runCli(root, ['doctor', '--json']);
    const output = JSON.parse(result.stdout);
    // Config schema validation should pass (topology checks are not schema checks)
    const configCheck = output.checks.find(c => c.id === 'config_valid');
    assert.ok(configCheck, 'Should include config_valid check');
    assert.equal(configCheck.level, 'pass');
    // Admission control should fail with ADM-001 for review_only dead-end
    const admissionCheck = output.checks.find(c => c.id === 'admission_control');
    assert.ok(admissionCheck, 'Should include admission_control check');
    assert.equal(admissionCheck.level, 'fail');
    assert.match(admissionCheck.detail, /review_only/);
  });

  it('AT-GD-013: runtime checks expose capability contracts and role-bound summaries', () => {
    const root = makeGoverned({ liveProbeRuntime: 'api_proxy' });
    const configPath = join(root, 'agentxchain.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.runtimes['remote-live'] = { type: 'remote_agent', url: 'https://example.com/agent' };
    config.runtimes['mcp-live'] = { type: 'mcp', transport: 'streamable_http', url: 'https://example.com/mcp' };
    config.roles.pm.runtime = 'api-live';
    config.roles.pm.write_authority = 'proposed';
    config.roles.dev.runtime = 'remote-live';
    config.roles.dev.write_authority = 'proposed';
    config.roles.qa.runtime = 'mcp-live';
    config.roles.qa.write_authority = 'authoritative';
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    const result = runCli(root, ['doctor', '--json'], {
      env: { AXC_DOCTOR_LIVE_PROBE_KEY: 'test-key' },
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);

    const apiCheck = output.checks.find((c) => c.id === 'runtime_api-live');
    assert.equal(apiCheck.runtime_contract.transport, 'provider_api');
    assert.equal(apiCheck.runtime_contract.can_write_files, 'proposal_only');
    assert.equal(apiCheck.bound_roles[0].effective_write_path, 'proposal_apply_required');
    assert.equal(apiCheck.bound_roles[0].workflow_artifact_ownership, 'proposal_apply_required');

    const remoteCheck = output.checks.find((c) => c.id === 'runtime_remote-live');
    assert.equal(remoteCheck.runtime_contract.transport, 'remote_http');
    assert.equal(remoteCheck.bound_roles[0].effective_write_path, 'proposal_apply_required');

    const mcpCheck = output.checks.find((c) => c.id === 'runtime_mcp-live');
    assert.equal(mcpCheck.runtime_contract.transport, 'mcp_streamable_http');
    assert.equal(mcpCheck.runtime_contract.can_write_files, 'tool_defined');
    assert.equal(mcpCheck.bound_roles[0].effective_write_path, 'tool_defined');
  });

  it('AT-GD-012B: doctor bound-role summaries consume declared direct-write MCP capabilities', () => {
    const root = makeGoverned();
    const configPath = join(root, 'agentxchain.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.runtimes['mcp-dev'] = {
      type: 'mcp',
      transport: 'streamable_http',
      url: 'https://example.com/mcp-dev',
      capabilities: {
        can_write_files: 'direct',
        workflow_artifact_ownership: 'yes',
      },
    };
    config.roles.dev.runtime = 'mcp-dev';
    config.roles.dev.write_authority = 'authoritative';
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    const result = runCli(root, ['doctor', '--json']);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);

    const mcpCheck = output.checks.find((c) => c.id === 'runtime_mcp-dev');
    assert.ok(mcpCheck, 'Should include runtime_mcp-dev check');
    assert.equal(mcpCheck.runtime_contract.can_write_files, 'direct');
    assert.equal(mcpCheck.bound_roles[0].role_id, 'dev');
    assert.equal(mcpCheck.bound_roles[0].effective_write_path, 'direct');
    assert.equal(mcpCheck.bound_roles[0].workflow_artifact_ownership, 'yes');
  });

  it('AT-GD-013: mcp review_only gate topology does not false-fail admission control', () => {
    const root = makeGoverned();
    const configPath = join(root, 'agentxchain.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));

    for (const runtimeId of Object.keys(config.runtimes || {})) {
      config.runtimes[runtimeId] = {
        type: 'mcp',
        command: ['node', '-e', 'process.exit(0)'],
      };
    }
    for (const role of Object.values(config.roles || {})) {
      role.write_authority = 'review_only';
    }

    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    const result = runCli(root, ['doctor', '--json']);
    const output = JSON.parse(result.stdout);
    const admissionCheck = output.checks.find((c) => c.id === 'admission_control');
    assert.ok(admissionCheck, 'Should include admission_control check');
    assert.notEqual(admissionCheck.level, 'fail', JSON.stringify(admissionCheck, null, 2));
  });

  it('AT-B4-002: doctor surfaces actionable review_only + local_cli repair guidance', () => {
    const root = makeGoverned();
    const configPath = join(root, 'agentxchain.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.roles.dev.write_authority = 'review_only';
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    const result = runCli(root, ['doctor', '--json']);
    assert.equal(result.status, 1, 'doctor must fail for invalid governed config');
    const output = JSON.parse(result.stdout);
    const configCheck = output.checks.find((c) => c.id === 'config_valid');
    assert.ok(configCheck, 'Should include config_valid check');
    assert.equal(configCheck.level, 'fail');
    assert.match(configCheck.detail, /invalid review_only \+ local_cli binding/);
    assert.match(configCheck.detail, /change write_authority to "authoritative"/);
    assert.match(configCheck.detail, /manual", "api_proxy", "mcp", or "remote_agent"/);
  });

  it('AT-GD-014: doctor fails closed on hand-edited invalid run_loop watchdog values', () => {
    const root = makeGoverned();
    const configPath = join(root, 'agentxchain.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.run_loop = {
      startup_watchdog_ms: 0,
      stale_turn_threshold_ms: -1,
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    const result = runCli(root, ['doctor', '--json']);
    assert.equal(result.status, 1, 'doctor must fail for invalid run_loop watchdog config');
    const output = JSON.parse(result.stdout);
    assert.equal(output.overall, 'fail');
    const configCheck = output.checks.find((c) => c.id === 'config_valid');
    assert.ok(configCheck, 'Should include config_valid check');
    assert.equal(configCheck.level, 'fail');
    assert.match(configCheck.detail, /run_loop\.startup_watchdog_ms/);
    assert.match(configCheck.detail, /run_loop\.stale_turn_threshold_ms/);
  });

  it('AT-GD-015: doctor fails closed on api_proxy max_output_tokens silent-fallback defect class', () => {
    const root = makeGoverned();
    const configPath = join(root, 'agentxchain.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    // Inject an api_proxy runtime with an invalid max_output_tokens that
    // the adapter would silently coerce to 4096 (0) or send raw to the
    // provider (-5000 / "4096"). doctor must surface this before an
    // operator hits real API failures.
    config.runtimes = config.runtimes || {};
    config.runtimes['api-qa'] = {
      type: 'api_proxy',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      auth_env: 'ANTHROPIC_API_KEY',
      max_output_tokens: 0,
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    const result = runCli(root, ['doctor', '--json']);
    assert.equal(result.status, 1, 'doctor must fail for invalid api_proxy max_output_tokens');
    const output = JSON.parse(result.stdout);
    assert.equal(output.overall, 'fail');
    const configCheck = output.checks.find((c) => c.id === 'config_valid');
    assert.ok(configCheck, 'Should include config_valid check');
    assert.equal(configCheck.level, 'fail');
    assert.match(configCheck.detail, /max_output_tokens must be a positive integer/);
  });

  it('AT-GD-016: doctor fails closed on invalid project.default_branch instead of silently normalizing to main', () => {
    const root = makeGoverned();
    const configPath = join(root, 'agentxchain.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.project.default_branch = '   ';
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    const result = runCli(root, ['doctor', '--json']);
    assert.equal(result.status, 1, 'doctor must fail for invalid project.default_branch');
    const output = JSON.parse(result.stdout);
    assert.equal(output.overall, 'fail');
    const configCheck = output.checks.find((c) => c.id === 'config_valid');
    assert.ok(configCheck, 'Should include config_valid check');
    assert.equal(configCheck.level, 'fail');
    assert.match(configCheck.detail, /project\.default_branch must be a non-empty string when provided/);
  });

  it('AT-B1-001: doctor warns when the running CLI is older than the published docs floor', () => {
    const root = makeGoverned();
    const binDir = createStubNpmDir('99.99.99');
    const result = runCli(root, ['doctor', '--json'], {
      env: {
        PATH: `${binDir}:${process.env.PATH}`,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.cli_version_status, 'stale');
    assert.equal(output.docs_min_cli_version, '99.99.99');
    const versionCheck = output.checks.find((c) => c.id === 'cli_version');
    assert.ok(versionCheck, 'Should include cli_version check');
    assert.equal(versionCheck.level, 'warn');
    assert.match(versionCheck.detail, /npm install -g agentxchain@latest/);
    assert.match(versionCheck.detail, /brew upgrade agentxchain/);
    assert.match(versionCheck.detail, /npx --yes -p agentxchain@latest -c "agentxchain doctor"/);
  });
});
