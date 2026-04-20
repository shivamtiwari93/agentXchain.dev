/**
 * Reproduce-BUG-54 script integration test.
 *
 * Locks the diagnostic contract `cli/scripts/reproduce-bug-54.mjs` exposes to
 * the tester. Per HUMAN-ROADMAP BUG-54, this script is the only path to
 * closing the spawn/attach root-cause question without guessing — so its
 * output shape MUST stay stable.
 *
 * What this asserts (across several seeded failure shapes):
 *   1. `spawn_attach_failed`  — ENOENT for a non-existent binary; the JSON
 *      capture reports `process_error.code === 'ENOENT'` with errno + syscall.
 *   2. `exit_stderr_only`     — subprocess emits stderr only and exits non-zero;
 *      capture reports stderr text verbatim, `exit_code === 2`,
 *      `first_stdout_at === null`.
 *   3. `watchdog_no_output`   — silent subprocess killed by watchdog;
 *      capture reports `watchdog_fired: true`, `exit_signal: 'SIGTERM'`.
 *   4. `exit_clean_with_stdout` — control case; capture reports stdout text
 *      and `exit_code === 0`.
 *
 * If a future change widens or renames classifications, update both the
 * script and this test together. The classifications double as the BUG-54
 * triage vocabulary.
 */

import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import test from 'node:test';
import assert from 'node:assert/strict';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const SCRIPT = resolve(REPO_ROOT, 'cli', 'scripts', 'reproduce-bug-54.mjs');

function makeFixture(runtimes) {
  const dir = mkdtempSync(join(tmpdir(), 'bug54-repro-'));
  writeFileSync(
    join(dir, 'agentxchain.json'),
    JSON.stringify({ $schema: 'test', version: 'test', runtimes }, null, 2),
  );
  return dir;
}

function runRepro(dir, args) {
  const outPath = join(dir, 'out.json');
  // execFileSync — the script writes to outPath even if classifications fail.
  // We swallow non-zero exit codes here; the script itself only exits non-zero
  // for argv/config errors, not for spawn failures of the subject runtime.
  try {
    execFileSync(process.execPath, [SCRIPT, '--out', outPath, ...args], {
      cwd: dir,
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 30_000,
    });
  } catch (err) {
    // For failure-class scenarios the script still completes with code 0;
    // a non-zero here means the harness itself broke and the test should fail.
    throw new Error(`reproduce-bug-54.mjs harness failed: ${err.stderr?.toString() || err.message}`);
  }
  return JSON.parse(readFileSync(outPath, 'utf8'));
}

test('reproduce-bug-54: spawn_attach_failed (ENOENT) captures process_error with code/errno/syscall', () => {
  const dir = makeFixture({
    'enoent-runtime': {
      type: 'local_cli',
      command: ['/usr/bin/this-binary-definitely-does-not-exist-bug54-test'],
      prompt_transport: 'stdin',
    },
  });
  try {
    const payload = runRepro(dir, [
      '--runtime', 'enoent-runtime',
      '--synthetic', 'x',
      '--attempts', '1',
      '--watchdog-ms', '2000',
      '--delay-ms', '0',
    ]);
    assert.equal(payload.attempts.length, 1);
    const a = payload.attempts[0];
    assert.equal(a.classification, 'spawn_attach_failed');
    assert.equal(a.process_error?.code, 'ENOENT');
    assert.ok(a.process_error?.syscall?.startsWith('spawn '));
    assert.equal(a.spawn_attached_at, null);
    assert.equal(a.first_stdout_at, null);
    assert.equal(payload.summary.classification.spawn_attach_failed, 1);
    assert.equal(payload.summary.success_rate_first_stdout, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reproduce-bug-54: exit_stderr_only captures stderr text + non-zero exit + null first_stdout_at', () => {
  const dir = makeFixture({
    'stderr-only-runtime': {
      type: 'local_cli',
      command: ['/bin/sh', '-c', "printf 'auth error: missing key\\n' >&2; exit 2"],
      prompt_transport: 'stdin',
    },
  });
  try {
    const payload = runRepro(dir, [
      '--runtime', 'stderr-only-runtime',
      '--synthetic', 'x',
      '--attempts', '2',
      '--watchdog-ms', '5000',
      '--delay-ms', '0',
    ]);
    assert.equal(payload.attempts.length, 2);
    for (const a of payload.attempts) {
      assert.equal(a.classification, 'exit_stderr_only');
      assert.equal(a.exit_code, 2);
      assert.equal(a.first_stdout_at, null);
      assert.ok(a.first_stderr_at !== null);
      assert.match(a.stderr, /auth error: missing key/);
    }
    assert.equal(payload.summary.classification.exit_stderr_only, 2);
    assert.equal(payload.summary.success_rate_first_stdout, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reproduce-bug-54: watchdog_no_output kills silent subprocess and reports SIGTERM + watchdog_fired', () => {
  const dir = makeFixture({
    'silent-runtime': {
      type: 'local_cli',
      command: ['/bin/sh', '-c', 'sleep 10'],
      prompt_transport: 'stdin',
    },
  });
  try {
    const payload = runRepro(dir, [
      '--runtime', 'silent-runtime',
      '--synthetic', 'x',
      '--attempts', '1',
      '--watchdog-ms', '500',
      '--delay-ms', '0',
    ]);
    const a = payload.attempts[0];
    assert.equal(a.classification, 'watchdog_no_output');
    assert.equal(a.watchdog_fired, true);
    assert.ok(a.watchdog_elapsed_ms != null && a.watchdog_elapsed_ms >= 400);
    assert.equal(a.first_stdout_at, null);
    assert.equal(a.first_stderr_at, null);
    assert.equal(a.exit_signal, 'SIGTERM');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reproduce-bug-54: exit_clean_with_stdout (control) reports stdout + exit 0', () => {
  const dir = makeFixture({
    'echo-runtime': {
      type: 'local_cli',
      command: ['/bin/sh', '-c', "printf 'READY\\n'; exit 0"],
      prompt_transport: 'stdin',
    },
  });
  try {
    const payload = runRepro(dir, [
      '--runtime', 'echo-runtime',
      '--synthetic', 'x',
      '--attempts', '1',
      '--watchdog-ms', '5000',
      '--delay-ms', '0',
    ]);
    const a = payload.attempts[0];
    assert.equal(a.classification, 'exit_clean_with_stdout');
    assert.equal(a.exit_code, 0);
    assert.ok(a.first_stdout_at !== null);
    assert.match(a.stdout, /READY/);
    assert.equal(payload.summary.success_rate_first_stdout, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reproduce-bug-54: header captures redacted args, env-presence flags, and prompt-source kind', () => {
  const dir = makeFixture({
    'argv-runtime': {
      type: 'local_cli',
      command: ['/bin/echo', '{prompt}'],
      prompt_transport: 'argv',
    },
  });
  try {
    const payload = runRepro(dir, [
      '--runtime', 'argv-runtime',
      '--synthetic', 'this-is-the-secret-prompt',
      '--attempts', '1',
      '--watchdog-ms', '5000',
      '--delay-ms', '0',
    ]);
    // Prompt MUST NOT appear in the redacted args; placeholder MUST.
    const argsJson = JSON.stringify(payload.resolved_args_redacted);
    assert.ok(!argsJson.includes('this-is-the-secret-prompt'),
      'redacted args must not contain the raw prompt');
    assert.match(argsJson, /<prompt:\d+ bytes>/);
    // Auth env probe shape locked
    assert.equal(typeof payload.env_snapshot.auth_env_present.ANTHROPIC_API_KEY, 'boolean');
    assert.equal(typeof payload.env_snapshot.auth_env_present.CLAUDE_CODE_OAUTH_TOKEN, 'boolean');
    // Prompt-source kind locked
    assert.equal(payload.prompt_source.kind, 'synthetic');
    assert.equal(payload.runtime_id, 'argv-runtime');
    assert.equal(payload.prompt_transport, 'argv');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
