import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../../src/commands/init.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', '..', 'bin', 'agentxchain.js');
const tempDirs = [];

function runCli(root, args, env = {}) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 20_000,
    env: { ...process.env, NO_COLOR: '1', ...env },
  });
}

function writeFakeCodex(homeDir) {
  const binDir = join(homeDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const codexPath = join(binDir, 'codex');
  writeFileSync(codexPath, `#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const turnId = process.env.AGENTXCHAIN_TURN_ID;
if (!turnId) {
  process.exit(0);
}

const assignmentPath = join(process.cwd(), '.agentxchain', 'dispatch', 'turns', turnId, 'ASSIGNMENT.json');
const assignment = JSON.parse(readFileSync(assignmentPath, 'utf8'));
const result = {
  schema_version: '1.0',
  run_id: assignment.run_id,
  turn_id: assignment.turn_id,
  role: assignment.role,
  runtime_id: assignment.runtime_id,
  status: 'completed',
  summary: 'Codex spawn-context validation completed.',
  decisions: [{
    id: 'DEC-926',
    category: 'process',
    statement: 'The absolute executable path resolved in the real spawn context.',
    rationale: 'Synthetic connector validation wrote a staged governed result.'
  }],
  objections: [],
  files_changed: [],
  verification: { status: 'skipped', evidence_summary: 'spawn-context proof' },
  artifact: { type: 'review', ref: null },
  proposed_next_role: 'human'
};
const stagingPath = join(process.cwd(), assignment.staging_result_path);
mkdirSync(dirname(stagingPath), { recursive: true });
writeFileSync(stagingPath, JSON.stringify(result, null, 2) + '\\n');
`);
  chmodSync(codexPath, 0o755);
  return codexPath;
}

function createProject(commandValue) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug26-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'BUG-26 Fixture', `bug26-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.runtimes['codex-dev'] = {
    type: 'local_cli',
    command: [commandValue, 'exec', '--dangerously-bypass-approvals-and-sandbox', '{prompt}'],
    cwd: '.',
    prompt_transport: 'argv',
  };
  config.roles.dev.runtime = 'codex-dev';
  config.roles.dev.write_authority = 'authoritative';
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    try {
      rmSync(tempDirs.pop(), { recursive: true, force: true });
    } catch {}
  }
});

describe('BUG-26 beta-tester scenario: doctor / connector spawn parity', () => {
  it('fails closed when the runtime only resolves through shell expansion, not real spawn resolution', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'axc-bug26-home-'));
    tempDirs.push(fakeHome);
    writeFakeCodex(fakeHome);
    const root = createProject('~/bin/codex');
    const env = { HOME: fakeHome };

    const doctor = runCli(root, ['doctor', '--json'], env);
    assert.equal(doctor.status, 1, doctor.stdout);
    const doctorJson = JSON.parse(doctor.stdout);
    const runtimeCheck = doctorJson.checks.find((entry) => entry.id === 'runtime_codex-dev');
    assert.ok(runtimeCheck, 'doctor must include the codex runtime check');
    assert.equal(runtimeCheck.level, 'fail');
    assert.match(runtimeCheck.detail, /spawn context/i);
    assert.match(runtimeCheck.detail, /absolute path/i);
    assert.match(runtimeCheck.detail, /Applications\/Codex\.app\/Contents\/Resources\/codex/);

    const check = runCli(root, ['connector', 'check', 'codex-dev', '--json'], env);
    assert.equal(check.status, 1, check.stdout);
    const checkJson = JSON.parse(check.stdout);
    assert.equal(checkJson.fail_count, 1);
    assert.equal(checkJson.connectors[0].level, 'fail');
    assert.match(checkJson.connectors[0].detail, /spawn context/i);
    assert.match(checkJson.connectors[0].detail, /absolute path/i);

    const validate = runCli(root, ['connector', 'validate', 'codex-dev', '--role', 'dev', '--json'], env);
    assert.equal(validate.status, 1, validate.stdout);
    const validateJson = JSON.parse(validate.stdout);
    assert.equal(validateJson.overall, 'fail');
    assert.match(validateJson.error, /spawn context/i);
    assert.match(validateJson.error, /absolute path/i);
    assert.equal(validateJson.dispatch, null);
  });

  it('passes once the runtime is configured with the real absolute executable path', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'axc-bug26-home-'));
    tempDirs.push(fakeHome);
    const absoluteCodexPath = writeFakeCodex(fakeHome);
    const root = createProject(absoluteCodexPath);
    const env = { HOME: fakeHome };

    const doctor = runCli(root, ['doctor', '--json'], env);
    assert.equal(doctor.status, 0, doctor.stdout);
    const doctorJson = JSON.parse(doctor.stdout);
    const runtimeCheck = doctorJson.checks.find((entry) => entry.id === 'runtime_codex-dev');
    assert.ok(runtimeCheck, 'doctor must include the codex runtime check');
    assert.equal(runtimeCheck.level, 'pass');
    assert.match(runtimeCheck.detail, /spawn context/i);

    const validate = runCli(root, ['connector', 'validate', 'codex-dev', '--role', 'dev', '--json'], env);
    assert.equal(validate.status, 0, validate.stdout);
    const validateJson = JSON.parse(validate.stdout);
    assert.equal(validateJson.overall, 'pass');
    assert.equal(validateJson.dispatch.ok, true);
    assert.equal(validateJson.validation.ok, true);
  });
});
