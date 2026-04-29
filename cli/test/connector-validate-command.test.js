import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const tempDirs = [];

function createProject(mutator, extraSetup) {
  const root = mkdtempSync(join(tmpdir(), 'axc-connector-validate-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Connector Validate Fixture', `connector-validate-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  mutator(config);
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  extraSetup?.(root);
  return root;
}

function runCli(root, args, env = {}) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, NO_COLOR: '1', ...env },
  });
}

function writeValidationAgent(root, name, body) {
  const scriptsDir = join(root, 'scripts');
  mkdirSync(scriptsDir, { recursive: true });
  writeFileSync(join(scriptsDir, name), body);
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

describe('agentxchain connector validate', () => {
  it('AT-CCV-001: --json fails closed outside a governed project', () => {
    const root = mkdtempSync(join(tmpdir(), 'axc-connector-validate-missing-'));
    tempDirs.push(root);

    const result = runCli(root, ['connector', 'validate', 'local-dev', '--json']);
    assert.equal(result.status, 2, result.stdout);
    const output = JSON.parse(result.stdout);
    assert.match(output.error, /No governed agentxchain\.json found/i);
  });

  it('AT-CCV-002 and AT-CCV-003: unknown runtimes fail closed and manual runtimes are rejected', () => {
    const root = createProject((config) => {
      config.runtimes['manual-only'] = { type: 'manual' };
      config.roles.pm.runtime = 'manual-only';
    });

    const unknown = runCli(root, ['connector', 'validate', 'does-not-exist', '--json']);
    assert.equal(unknown.status, 2, unknown.stdout);
    const unknownOutput = JSON.parse(unknown.stdout);
    assert.match(unknownOutput.error, /Unknown connector runtime/);

    const manual = runCli(root, ['connector', 'validate', 'manual-only', '--json']);
    assert.equal(manual.status, 2, manual.stdout);
    const manualOutput = JSON.parse(manual.stdout);
    assert.match(manualOutput.error, /manual/i);
  });

  it('AT-CCV-004: local_cli runtime passes synthetic dispatch validation', () => {
    const root = createProject((config) => {
      config.runtimes['local-dev'] = {
        type: 'local_cli',
        command: ['node', 'scripts/valid-agent.mjs'],
        cwd: '.',
        prompt_transport: 'dispatch_bundle_only',
      };
      config.roles.dev.runtime = 'local-dev';
      config.roles.dev.write_authority = 'authoritative';
    }, (projectRoot) => {
      writeValidationAgent(projectRoot, 'valid-agent.mjs', `
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const turnId = process.env.AGENTXCHAIN_TURN_ID;
const assignmentPath = join(process.cwd(), '.agentxchain', 'dispatch', 'turns', turnId, 'ASSIGNMENT.json');
const assignment = JSON.parse(readFileSync(assignmentPath, 'utf8'));
const result = {
  schema_version: '1.0',
  run_id: assignment.run_id,
  turn_id: assignment.turn_id,
  role: assignment.role,
  runtime_id: assignment.runtime_id,
  status: 'completed',
  summary: 'Synthetic connector validation turn completed.',
  decisions: [{
    id: 'DEC-900',
    category: 'process',
    statement: 'The runtime emitted a valid synthetic result.',
    rationale: 'Validation agent staged governed output.'
  }],
  objections: [],
  files_changed: [],
  verification: { status: 'skipped', evidence_summary: 'synthetic validation' },
  artifact: { type: 'review', ref: null },
  proposed_next_role: 'human'
};
const stagingPath = join(process.cwd(), assignment.staging_result_path);
mkdirSync(dirname(stagingPath), { recursive: true });
writeFileSync(stagingPath, JSON.stringify(result, null, 2) + '\\n');
`);
    });

    const result = runCli(root, ['connector', 'validate', 'local-dev', '--role', 'dev', '--json']);
    assert.equal(result.status, 0, result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.overall, 'pass');
    assert.equal(output.runtime_id, 'local-dev');
    assert.equal(output.role_id, 'dev');
    assert.equal(output.schema_contract.ok, true);
    assert.equal(output.schema_contract.config_schema_artifact, 'agentxchain/schemas/agentxchain-config');
    assert.equal(output.schema_contract.capabilities_output_schema_artifact, 'agentxchain/schemas/connector-capabilities-output');
    assert.equal(output.schema_contract.continuity.raw_config_runtime_present, true);
    assert.equal(output.schema_contract.continuity.raw_role_present, true);
    assert.equal(output.schema_contract.continuity.raw_role_binding_matches_runtime, true);
    assert.equal(output.schema_contract.continuity.capabilities_report_runtime_matches, true);
    assert.equal(output.schema_contract.continuity.capabilities_report_role_binding_matches, true);
    assert.equal(output.dispatch.ok, true);
    assert.equal(output.validation.ok, true);
    assert.equal(output.scratch_root, null);
  });

  it('AT-CCV-004b: slow local_cli runtimes do not fail closed at the short spawn-probe stage', () => {
    const root = createProject((config) => {
      config.runtimes['local-dev'] = {
        type: 'local_cli',
        command: ['node', 'scripts/slow-valid-agent.mjs', '{prompt}'],
        cwd: '.',
        prompt_transport: 'argv',
      };
      config.roles.dev.runtime = 'local-dev';
      config.roles.dev.write_authority = 'authoritative';
    }, (projectRoot) => {
      writeValidationAgent(projectRoot, 'slow-valid-agent.mjs', `
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

await sleep(800);
const turnId = process.env.AGENTXCHAIN_TURN_ID;
const assignmentPath = join(process.cwd(), '.agentxchain', 'dispatch', 'turns', turnId, 'ASSIGNMENT.json');
const assignment = JSON.parse(readFileSync(assignmentPath, 'utf8'));
const result = {
  schema_version: '1.0',
  run_id: assignment.run_id,
  turn_id: assignment.turn_id,
  role: assignment.role,
  runtime_id: assignment.runtime_id,
  status: 'completed',
  summary: 'Slow synthetic connector validation turn completed.',
  decisions: [{
    id: 'DEC-902',
    category: 'process',
    statement: 'The runtime stayed alive past the short spawn probe and still produced a valid result.',
    rationale: 'Slow-start local runtimes must not be treated as unresolved.'
  }],
  objections: [],
  files_changed: [],
  verification: { status: 'skipped', evidence_summary: 'slow synthetic validation' },
  artifact: { type: 'review', ref: null },
  proposed_next_role: 'human'
};
const stagingPath = join(process.cwd(), assignment.staging_result_path);
mkdirSync(dirname(stagingPath), { recursive: true });
writeFileSync(stagingPath, JSON.stringify(result, null, 2) + '\\n');
`);
    });

    const result = runCli(root, ['connector', 'validate', 'local-dev', '--role', 'dev', '--json']);
    assert.equal(result.status, 0, result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.overall, 'pass');
    assert.equal(output.schema_contract.ok, true);
    assert.equal(output.dispatch.ok, true);
    assert.equal(output.validation.ok, true);
  });

  it('AT-DEV-CMD-003: init preserves a path-with-spaces arg that stays runnable through connector validate', () => {
    const root = mkdtempSync(join(tmpdir(), 'axc-connector-validate-init-'));
    tempDirs.push(root);

    const fixturesDir = join(root, 'agent fixtures');
    mkdirSync(fixturesDir, { recursive: true });
    const agentPath = join(fixturesDir, 'valid-agent.mjs');
    writeFileSync(agentPath, `
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const turnId = process.env.AGENTXCHAIN_TURN_ID;
const assignmentPath = join(process.cwd(), '.agentxchain', 'dispatch', 'turns', turnId, 'ASSIGNMENT.json');
const assignment = JSON.parse(readFileSync(assignmentPath, 'utf8'));
const result = {
  schema_version: '1.0',
  run_id: assignment.run_id,
  turn_id: assignment.turn_id,
  role: assignment.role,
  runtime_id: assignment.runtime_id,
  status: 'completed',
  summary: 'Path-with-spaces agent completed validation.',
  decisions: [{
    id: 'DEC-901',
    category: 'process',
    statement: 'The path-with-spaces agent emitted a valid result.',
    rationale: 'Regression proof for init command normalization.'
  }],
  objections: [],
  files_changed: [],
  verification: { status: 'skipped', evidence_summary: 'synthetic validation' },
  artifact: { type: 'review', ref: null },
  proposed_next_role: 'human'
};
const stagingPath = join(process.cwd(), assignment.staging_result_path);
mkdirSync(dirname(stagingPath), { recursive: true });
writeFileSync(stagingPath, JSON.stringify(result, null, 2) + '\\n');
`);

    const init = runCli(root, [
      'init',
      '--governed',
      '--dir', 'project',
      '--goal', 'Connector validate spaced-path regression',
      '--dev-command', 'node', agentPath,
      '--dev-prompt-transport', 'dispatch_bundle_only',
      '--yes',
    ]);
    assert.equal(init.status, 0, init.stderr);

    const config = JSON.parse(readFileSync(join(root, 'project', 'agentxchain.json'), 'utf8'));
    assert.deepEqual(config.runtimes['local-dev'].command, ['node', agentPath]);

    const result = runCli(join(root, 'project'), ['connector', 'validate', 'local-dev', '--role', 'dev', '--json']);
    assert.equal(result.status, 0, result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.overall, 'pass');
    assert.equal(output.schema_contract.ok, true);
    assert.equal(output.dispatch.ok, true);
    assert.equal(output.validation.ok, true);
  });

  it('AT-CCV-005: invalid staged results fail validator and preserve scratch workspace', () => {
    const root = createProject((config) => {
      config.runtimes['local-dev'] = {
        type: 'local_cli',
        command: ['node', 'scripts/invalid-agent.mjs'],
        cwd: '.',
        prompt_transport: 'dispatch_bundle_only',
      };
      config.roles.dev.runtime = 'local-dev';
      config.roles.dev.write_authority = 'authoritative';
    }, (projectRoot) => {
      writeValidationAgent(projectRoot, 'invalid-agent.mjs', `
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const turnId = process.env.AGENTXCHAIN_TURN_ID;
const assignmentPath = join(process.cwd(), '.agentxchain', 'dispatch', 'turns', turnId, 'ASSIGNMENT.json');
const assignment = JSON.parse(readFileSync(assignmentPath, 'utf8'));
const stagingPath = join(process.cwd(), assignment.staging_result_path);
mkdirSync(dirname(stagingPath), { recursive: true });
writeFileSync(stagingPath, JSON.stringify({
  schema_version: '1.0',
  run_id: assignment.run_id,
  turn_id: assignment.turn_id,
  role: assignment.role,
  runtime_id: assignment.runtime_id,
  status: 'invalid_not_a_valid_status',
  decisions: [],
  objections: [],
  files_changed: [],
  verification: { status: 'skipped' },
  artifact: { type: 'review', ref: null },
  proposed_next_role: 'human'
}, null, 2) + '\\n');
`);
    });

    const result = runCli(root, ['connector', 'validate', 'local-dev', '--role', 'dev', '--json']);
    assert.equal(result.status, 1, result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.overall, 'fail');
    assert.equal(output.schema_contract.ok, true);
    assert.equal(output.dispatch.ok, true);
    assert.equal(output.validation.ok, false);
    assert.equal(output.validation.stage, 'schema');
    assert.ok(output.scratch_root, 'expected scratch_root on failure');
    assert.equal(existsSync(output.scratch_root), true);
  });

  it('AT-CCV-007: Claude local_cli validation allows no-env/no-bare when the smoke probe observes stdout', () => {
    let shim;
    const root = createProject((config) => {
      config.runtimes['local-dev'] = {
        type: 'local_cli',
        command: ['claude', '--print', '--dangerously-skip-permissions'],
        cwd: '.',
        prompt_transport: 'stdin',
      };
      config.roles.dev.runtime = 'local-dev';
      config.roles.dev.write_authority = 'authoritative';
    }, (projectRoot) => {
      shim = writeClaudeShim(projectRoot, `#!/bin/sh
cat > /dev/null
turn_id="$AGENTXCHAIN_TURN_ID"
[ -z "$turn_id" ] && echo READY && exit 0
node <<'NODE'
const fs = require('fs');
const path = require('path');
const turnId = process.env.AGENTXCHAIN_TURN_ID;
const assignmentPath = path.join(process.cwd(), '.agentxchain', 'dispatch', 'turns', turnId, 'ASSIGNMENT.json');
const assignment = JSON.parse(fs.readFileSync(assignmentPath, 'utf8'));
const stagingPath = path.join(process.cwd(), assignment.staging_result_path);
fs.mkdirSync(path.dirname(stagingPath), { recursive: true });
fs.writeFileSync(stagingPath, JSON.stringify({
  schema_version: '1.0',
  run_id: assignment.run_id,
  turn_id: assignment.turn_id,
  role: assignment.role,
  runtime_id: assignment.runtime_id,
  status: 'completed',
  summary: 'Working Claude shim completed validation.',
  decisions: [],
  objections: [],
  files_changed: [],
  verification: { status: 'skipped', evidence_summary: 'shim validation' },
  artifact: { type: 'review', ref: null },
  proposed_next_role: 'human'
}, null, 2) + '\\n');
NODE
echo READY
exit 0
`);
    });

    // Strip every env-based Claude auth signal; the positive smoke probe must
    // still allow this working Claude Max-style shim through.
    const env = { ...process.env, PATH: `${dirname(shim)}:${process.env.PATH || ''}` };
    for (const key of [
      'ANTHROPIC_API_KEY',
      'CLAUDE_API_KEY',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'CLAUDE_CODE_USE_VERTEX',
      'CLAUDE_CODE_USE_BEDROCK',
    ]) {
      env[key] = '';
    }

    const result = runCli(root, ['connector', 'validate', 'local-dev', '--role', 'dev', '--json'], env);
    assert.equal(result.status, 0, result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.overall, 'pass');
    assert.equal(output.error_code, undefined);
    assert.equal(output.auth_env_present, undefined);
    assert.equal(output.dispatch.ok, true);
    assert.equal(output.validation.ok, true);
  });

  it('AT-CCV-007b: Claude local_cli validation fails fast when the auth smoke probe hangs before scratch workspace setup', () => {
    let shim;
    const root = createProject((config) => {
      config.runtimes['local-dev'] = {
        type: 'local_cli',
        command: ['claude', '--print', '--dangerously-skip-permissions'],
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
      PATH: `${dirname(shim)}:${process.env.PATH || ''}`,
      ANTHROPIC_API_KEY: '',
      CLAUDE_API_KEY: '',
      CLAUDE_CODE_OAUTH_TOKEN: '',
      CLAUDE_CODE_USE_VERTEX: '',
      CLAUDE_CODE_USE_BEDROCK: '',
    };

    const result = runCli(root, ['connector', 'validate', 'local-dev', '--role', 'dev', '--json'], env);
    assert.equal(result.status, 1, result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.overall, 'fail');
    assert.equal(output.error_code, 'claude_auth_preflight_failed');
    assert.equal(output.runtime_id, 'local-dev');
    assert.equal(output.role_id, 'dev');
    assert.equal(output.dispatch, null, 'no synthetic dispatch should run on auth preflight failure');
    assert.equal(output.validation, null, 'no validator should run on auth preflight failure');
    assert.equal(output.scratch_root, null, 'no scratch workspace should be created on auth preflight failure');
    assert.match(output.error, /Claude local_cli runtime has no env-based auth/);
    assert.match(output.fix, /ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN|--bare/);
    assert.equal(output.auth_env_present.ANTHROPIC_API_KEY, false);
    assert.equal(output.auth_env_present.CLAUDE_CODE_OAUTH_TOKEN, false);
    assert.equal(output.smoke_probe.kind, 'hang');
    const preflightWarn = (output.warnings || []).find((w) => w.probe_kind === 'auth_preflight');
    assert.ok(preflightWarn, 'expected auth_preflight warning row in warnings array');
    assert.equal(preflightWarn.level, 'fail');
  });

  it('AT-CCV-008: Claude local_cli validation skips the auth-preflight refusal when --bare is declared', () => {
    const root = createProject((config) => {
      // --bare opts out of keychain-backed auth; preflight must allow it
      // through to the regular spawn-resolution check (which will fail on
      // a missing binary, but NOT on auth_preflight).
      config.runtimes['local-dev'] = {
        type: 'local_cli',
        command: ['claude', '--bare', '--print', '--dangerously-skip-permissions'],
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

    const result = runCli(root, ['connector', 'validate', 'local-dev', '--role', 'dev', '--json'], env);
    const output = JSON.parse(result.stdout);
    // The expected outcome is NOT auth_preflight refusal — the test asserts
    // the preflight relaxation, not what happens downstream when claude is
    // not actually installed in the test environment.
    assert.notEqual(output.error_code, 'claude_auth_preflight_failed');
    assert.equal(output.auth_env_present, undefined,
      'auth_env_present should not appear unless preflight fired');
  });

  it('AT-CCV-006: api_proxy validation fails closed when auth env is missing', () => {
    const root = createProject((config) => {
      config.runtimes['api-check'] = {
        type: 'api_proxy',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        auth_env: 'AXC_VALIDATE_MISSING_KEY',
        base_url: 'http://127.0.0.1:9999',
      };
      config.roles.qa.runtime = 'api-check';
      config.roles.qa.write_authority = 'review_only';
    });

    const env = { ...process.env };
    delete env.AXC_VALIDATE_MISSING_KEY;
    const result = runCli(root, ['connector', 'validate', 'api-check', '--role', 'qa', '--json'], env);
    assert.equal(result.status, 1, result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.overall, 'fail');
    assert.equal(output.schema_contract.ok, true);
    assert.equal(output.dispatch.ok, false);
    assert.match(output.dispatch.error, /AXC_VALIDATE_MISSING_KEY/);
    assert.ok(output.scratch_root, 'expected scratch_root on failed validation');
  });
});
