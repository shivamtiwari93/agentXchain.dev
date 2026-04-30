import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const SCRIPT = resolve(REPO_ROOT, 'cli', 'scripts', 'dogfood-claude-smoke.mjs');

function writeExecutable(path, content) {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'dogfood-claude-smoke-'));
  const fakeNodeLog = join(dir, 'fake-node.log');
  const fakeNode = join(dir, 'node20');
  writeExecutable(fakeNode, `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf 'v20.20.2\\n'
  exit 0
fi
printf '%s\\n' "$*" > ${JSON.stringify(fakeNodeLog)}
exec ${JSON.stringify(process.execPath)} "$@"
`);
  return { dir, fakeNode, fakeNodeLog };
}

function runSmoke(args, env = {}) {
  return spawnSync(process.execPath, [SCRIPT, '--json', ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
    },
    timeout: 20_000,
  });
}

function parsePayload(result) {
  assert.equal(result.stderr, '');
  assert.ok(result.stdout.trim(), 'expected JSON stdout');
  return JSON.parse(result.stdout);
}

test('dogfood-claude-smoke launches Node-shebang Claude through compatible Node wrapper', () => {
  const fixture = makeFixture();
  const claude = join(fixture.dir, 'claude');
  writeExecutable(claude, `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on('end', () => {
  process.stdout.write('READY\\n');
});
`);
  try {
    const result = runSmoke(['--claude', claude, '--node', fixture.fakeNode, '--cwd', fixture.dir]);
    const payload = parsePayload(result);

    assert.equal(result.status, 0);
    assert.equal(payload.ok, true);
    assert.equal(payload.classification, 'success');
    assert.equal(payload.claude.spawn_wrapper, 'claude_compatible_node');
    assert.equal(payload.node.compatible, true);
    assert.match(readFileSync(fixture.fakeNodeLog, 'utf8'), /claude --print/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('dogfood-claude-smoke classifies Anthropic 401 text from stdout without leaking env-file secrets', () => {
  const fixture = makeFixture();
  const claude = join(fixture.dir, 'claude');
  const envFile = join(fixture.dir, '.env');
  writeExecutable(claude, `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on('end', () => {
  process.stdout.write('{"type":"error","error":{"type":"authentication_error","message":"Invalid authentication credentials"}}\\n');
  process.exit(1);
});
`);
  writeFileSync(envFile, 'ANTHROPIC_API_KEY=super-secret-test-key\nCLAUDE_CODE_OAUTH_TOKEN=\n');
  try {
    const result = runSmoke([
      '--claude', claude,
      '--node', fixture.fakeNode,
      '--cwd', fixture.dir,
      '--credential-env-file', envFile,
    ]);
    const payload = parsePayload(result);

    assert.equal(result.status, 3);
    assert.equal(payload.ok, false);
    assert.equal(payload.classification, 'anthropic_auth_failed');
    assert.equal(payload.auth_env_present.ANTHROPIC_API_KEY, true);
    assert.equal(payload.auth_env_present.CLAUDE_CODE_OAUTH_TOKEN, false);
    assert.doesNotMatch(result.stdout, /super-secret-test-key/);
    assert.equal(result.stderr, '');
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('dogfood-claude-smoke classifies Claude Node runtime incompatibility distinctly', () => {
  const fixture = makeFixture();
  const claude = join(fixture.dir, 'claude');
  writeExecutable(claude, `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on('end', () => {
  process.stderr.write('TypeError: Object not disposable\\nNode.js v18.13.0\\n');
  process.exit(1);
});
`);
  try {
    const result = runSmoke(['--claude', claude, '--node', fixture.fakeNode, '--cwd', fixture.dir]);
    const payload = parsePayload(result);

    assert.equal(result.status, 4);
    assert.equal(payload.ok, false);
    assert.equal(payload.classification, 'node_runtime_incompatible');
    assert.match(payload.stderr_snippet, /Object not disposable/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('dogfood-claude-smoke reports missing env file as a typed diagnostic', () => {
  const fixture = makeFixture();
  try {
    const missing = join(fixture.dir, 'missing.env');
    const result = runSmoke(['--credential-env-file', missing, '--cwd', fixture.dir]);
    const payload = parsePayload(result);

    assert.equal(result.status, 66);
    assert.equal(payload.ok, false);
    assert.equal(payload.classification, 'env_file_missing');
    assert.match(payload.message, /Env file not found/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('dogfood-claude-smoke --help documents the DOGFOOD use flags', () => {
  const output = execFileSync(process.execPath, [SCRIPT, '--help'], {
    encoding: 'utf8',
  });

  assert.match(output, /dogfood-claude-smoke/);
  assert.match(output, /--credential-env-file/);
  assert.match(output, /--node/);
  assert.match(output, /--json/);
});

test('dogfood-claude-smoke is included in the npm package artifact', () => {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: resolve(REPO_ROOT, 'cli'),
    encoding: 'utf8',
    timeout: 20_000,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  const files = payload[0].files.map((file) => file.path);

  assert.ok(
    files.includes('scripts/dogfood-claude-smoke.mjs'),
    'DOGFOOD credential smoke helper must ship in the npm package',
  );
});
