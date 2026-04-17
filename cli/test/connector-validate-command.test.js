import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
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
    assert.equal(output.dispatch.ok, true);
    assert.equal(output.validation.ok, true);
    assert.equal(output.scratch_root, null);
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
  status: 'completed',
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
    assert.equal(output.dispatch.ok, true);
    assert.equal(output.validation.ok, false);
    assert.equal(output.validation.stage, 'schema');
    assert.ok(output.scratch_root, 'expected scratch_root on failure');
    assert.equal(existsSync(output.scratch_root), true);
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
    assert.equal(output.dispatch.ok, false);
    assert.match(output.dispatch.error, /AXC_VALIDATE_MISSING_KEY/);
    assert.ok(output.scratch_root, 'expected scratch_root on failed validation');
  });
});
