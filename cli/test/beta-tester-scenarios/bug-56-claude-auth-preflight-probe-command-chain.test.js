/**
 * BUG-56 command-chain regression proof.
 *
 * The Claude auth preflight must observe subprocess behavior. A no-env,
 * no-`--bare` Claude Max-style runtime that produces stdout must pass
 * connector check, connector validate, and the governed run dispatch path.
 * A no-env, no-`--bare` runtime that hangs silently must fail all three
 * surfaces with `claude_auth_preflight_failed`.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../../src/commands/init.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', '..', 'bin', 'agentxchain.js');
const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function makeProject(shimBody) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug56-chain-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'BUG-56 command chain', `bug56-${Date.now()}`);

  const shimDir = join(root, 'shim-bin');
  mkdirSync(shimDir, { recursive: true });
  const shimPath = join(shimDir, 'claude');
  writeFileSync(shimPath, shimBody);
  chmodSync(shimPath, 0o755);

  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.runtimes['local-dev'] = {
    type: 'local_cli',
    command: ['claude', '--print', '--dangerously-skip-permissions'],
    cwd: '.',
    prompt_transport: 'stdin',
  };
  for (const role of Object.values(config.roles || {})) {
    role.runtime = 'local-dev';
    role.runtime_id = 'local-dev';
    role.write_authority = 'authoritative';
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, '.planning', 'VISION.md'), [
    '# Vision',
    '',
    '## Delivery',
    '- Build one BUG-56 smoke-test improvement for governed delivery.',
    '',
  ].join('\n'));

  return { root, shimDir };
}

function commandEnv(shimDir) {
  const env = {
    ...process.env,
    NO_COLOR: '1',
    PATH: `${shimDir}:${process.env.PATH || ''}`,
    AGENTXCHAIN_CLAUDE_AUTH_PROBE_TIMEOUT_MS: '500',
  };
  for (const key of [
    'ANTHROPIC_API_KEY',
    'CLAUDE_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_BEDROCK',
  ]) {
    delete env[key];
  }
  return env;
}

function runCli(root, shimDir, args, timeout = 20_000) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    env: commandEnv(shimDir),
    encoding: 'utf8',
    timeout,
  });
}

const WORKING_CLAUDE_SHIM = `#!/bin/sh
cat > /dev/null
if [ -z "$AGENTXCHAIN_TURN_ID" ]; then
  echo READY
  exit 0
fi
node <<'NODE'
const fs = require('fs');
const path = require('path');
const turnId = process.env.AGENTXCHAIN_TURN_ID;
const assignment = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.agentxchain', 'dispatch', 'turns', turnId, 'ASSIGNMENT.json'), 'utf8'));
const stagingPath = path.join(process.cwd(), assignment.staging_result_path);
fs.mkdirSync(path.dirname(stagingPath), { recursive: true });
fs.writeFileSync(stagingPath, JSON.stringify({
  schema_version: '1.0',
  run_id: assignment.run_id,
  turn_id: assignment.turn_id,
  role: assignment.role,
  runtime_id: assignment.runtime_id,
  status: 'completed',
  summary: 'BUG-56 working Claude shim completed a governed turn.',
  decisions: [{
    id: 'DEC-001',
    category: 'process',
    statement: 'The working Claude shim dispatched without auth-preflight refusal.',
    rationale: 'The smoke probe observed stdout before governed dispatch.'
  }],
  objections: [],
  files_changed: [],
  verification: { status: 'skipped', evidence_summary: 'BUG-56 shim proof' },
  artifact: { type: 'review', ref: null },
  proposed_next_role: 'human'
}, null, 2) + '\\n');
NODE
echo TURN_READY
exit 0
`;

const HANGING_CLAUDE_SHIM = `#!/bin/sh
cat > /dev/null
exec sleep 30
`;

describe('BUG-56 Claude auth preflight command chain', () => {
  it('positive: working no-env/no-bare Claude shim passes check, validate, and continuous dispatch', () => {
    const { root, shimDir } = makeProject(WORKING_CLAUDE_SHIM);

    const check = runCli(root, shimDir, ['connector', 'check', 'local-dev', '--json']);
    assert.equal(check.status, 0, check.stdout || check.stderr);
    const checkJson = JSON.parse(check.stdout);
    assert.equal(checkJson.overall, 'pass');
    assert.equal(checkJson.connectors[0].error_code, undefined);

    const validate = runCli(root, shimDir, ['connector', 'validate', 'local-dev', '--role', 'dev', '--json']);
    assert.equal(validate.status, 0, validate.stdout || validate.stderr);
    const validateJson = JSON.parse(validate.stdout);
    assert.equal(validateJson.overall, 'pass');
    assert.equal(validateJson.error_code, undefined);

    const continuous = execFileSync(process.execPath, [
      CLI_BIN,
      'run',
      '--continuous',
      '--max-runs', '1',
      '--max-turns', '1',
      '--auto-approve',
      '--no-report',
      '--poll-seconds', '0',
      '--max-idle-cycles', '1',
      '--triage-approval', 'auto',
    ], {
      cwd: root,
      env: commandEnv(shimDir),
      encoding: 'utf8',
      timeout: 20_000,
    });
    assert.match(continuous, /Dispatching to local CLI: claude,--print,--dangerously-skip-permissions/);
    assert.doesNotMatch(continuous, /claude_auth_preflight_failed|no env-based auth/);
  });

  it('negative: hanging no-env/no-bare Claude shim fails check, validate, and run with auth preflight diagnostic', () => {
    const { root, shimDir } = makeProject(HANGING_CLAUDE_SHIM);

    const check = runCli(root, shimDir, ['connector', 'check', 'local-dev', '--json']);
    assert.equal(check.status, 1, check.stdout || check.stderr);
    assert.equal(JSON.parse(check.stdout).connectors[0].error_code, 'claude_auth_preflight_failed');

    const validate = runCli(root, shimDir, ['connector', 'validate', 'local-dev', '--role', 'dev', '--json']);
    assert.equal(validate.status, 1, validate.stdout || validate.stderr);
    assert.equal(JSON.parse(validate.stdout).error_code, 'claude_auth_preflight_failed');

    const run = runCli(root, shimDir, ['run', '--role', 'dev', '--max-turns', '1', '--auto-approve', '--no-report']);
    assert.notEqual(run.status, 0, run.stdout || run.stderr);
    assert.match(`${run.stdout}\n${run.stderr}`, /claude_auth_preflight_failed|no env-based auth/);
  });
});
