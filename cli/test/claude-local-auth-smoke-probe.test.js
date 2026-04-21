// Rule #13 positive + negative regression coverage for the BUG-56
// replacement smoke probe in `cli/src/lib/claude-local-auth.js`.
//
// These tests use shim scripts that impersonate the two shapes the probe
// must distinguish:
//   - "working Claude" (positive case): reads stdin, echoes bytes on stdout,
//     exits 0. The gate MUST classify this as `stdout_observed`.
//   - "hanging Claude" (negative case): reads stdin but emits nothing on
//     either stream until killed. The gate MUST classify this as `hang`
//     after the watchdog fires.
//
// The contract tested here is that the BUG-56 replacement gate is reality-
// checked: it observes subprocess behavior, not runtime config shape. A
// future regression that silently reverts to a shape-only check will fail
// the positive-case test immediately.
//
// See `.planning/BUG_56_FALSE_POSITIVE_RETRO.md` for context.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runClaudeSmokeProbe } from '../src/lib/claude-local-auth.js';

function writeShim(contents) {
  const dir = mkdtempSync(join(tmpdir(), 'claude-shim-'));
  const shimPath = join(dir, 'claude');
  writeFileSync(shimPath, contents, 'utf8');
  chmodSync(shimPath, 0o755);
  return shimPath;
}

const WORKING_SHIM = `#!/bin/sh
# Impersonates a non-hanging Claude CLI: reads stdin, echoes to stdout, exits.
cat
exit 0
`;

const HANGING_SHIM = `#!/bin/sh
# Impersonates the BUG-54 hang shape: reads stdin silently, never writes.
# exec so SIGTERM from the probe kills sleep directly instead of waiting
# on the shell to propagate the signal to its sleep child.
cat > /dev/null
exec sleep 30
`;

const AUTH_FAIL_SHIM = `#!/bin/sh
# Impersonates a fast auth failure: writes to stderr, exits non-zero.
cat > /dev/null
echo "Error: ANTHROPIC_API_KEY is required" >&2
exit 1
`;

test('runClaudeSmokeProbe — positive case: working Claude subprocess reports stdout_observed', async () => {
  const shim = writeShim(WORKING_SHIM);
  const result = await runClaudeSmokeProbe({
    runtime: { command: [shim] },
    env: {},
    timeoutMs: 5000,
  });

  assert.equal(result.kind, 'stdout_observed');
  assert.ok(result.elapsed_ms >= 0);
});

test('runClaudeSmokeProbe — negative case: hanging Claude subprocess reports hang after watchdog', async () => {
  const shim = writeShim(HANGING_SHIM);
  const result = await runClaudeSmokeProbe({
    runtime: { command: [shim] },
    env: {},
    timeoutMs: 500,
  });

  assert.equal(result.kind, 'hang');
  assert.ok(result.elapsed_ms >= 500);
  assert.ok(result.elapsed_ms < 5000, `elapsed_ms ${result.elapsed_ms} should be bounded by watchdog + kill latency`);
});

test('runClaudeSmokeProbe — auth-fail case: non-zero exit with no stdout reports exit_nonzero', async () => {
  const shim = writeShim(AUTH_FAIL_SHIM);
  const result = await runClaudeSmokeProbe({
    runtime: { command: [shim] },
    env: {},
    timeoutMs: 5000,
  });

  assert.equal(result.kind, 'exit_nonzero');
  assert.equal(result.exit_code, 1);
  assert.match(result.stderr_snippet, /ANTHROPIC_API_KEY/);
});

test('runClaudeSmokeProbe — skip case: non-Claude runtime returns skipped', async () => {
  const result = await runClaudeSmokeProbe({
    runtime: { command: ['echo'] },
    env: {},
    timeoutMs: 100,
  });

  assert.equal(result.kind, 'skipped');
  assert.equal(result.reason, 'not_claude_local_cli');
});

test('runClaudeSmokeProbe — skip case: empty command returns skipped', async () => {
  const result = await runClaudeSmokeProbe({
    runtime: { command: [] },
    env: {},
    timeoutMs: 100,
  });

  // command: [] is not a Claude runtime (first token missing), so the
  // earlier not_claude_local_cli branch fires before empty_command. This
  // is expected; the test locks in the ordering.
  assert.equal(result.kind, 'skipped');
  assert.equal(result.reason, 'not_claude_local_cli');
});

test('runClaudeSmokeProbe — spawn_error: missing binary reports spawn_error', async () => {
  const result = await runClaudeSmokeProbe({
    runtime: { command: ['/nonexistent/path/claude'] },
    env: {},
    timeoutMs: 2000,
  });

  assert.equal(result.kind, 'spawn_error');
  assert.ok(
    result.code === 'ENOENT' || result.code === 'EACCES' || result.code === null,
    `expected ENOENT/EACCES, got ${result.code}`,
  );
});
