/**
 * BUG-6 beta-tester scenario: step command must support --stream flag
 *
 * The `step` command must advertise and accept a `--stream` flag.
 *
 * Tester sequence:
 *   1. Run `agentxchain step --help`
 *   2. Verify the output contains `--stream`
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../../src/commands/init.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', '..', 'bin', 'agentxchain.js');
const tempDirs = [];

function runCli(root, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function createProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug6-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'BUG-6 Fixture', `bug6-${Date.now()}`);

  execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', {
    cwd: root, stdio: 'ignore',
  });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });

  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {}
  }
});

describe('BUG-6 beta-tester scenario: step --stream flag', () => {
  it('step --help output contains --stream flag', () => {
    const root = createProject();

    // Run step --help
    const result = runCli(root, ['step', '--help']);
    const output = (result.stdout || '') + (result.stderr || '');

    // KEY ASSERTION: --stream must be documented in the help output
    assert.ok(
      output.includes('--stream'),
      `step --help must mention --stream flag. Got:\n${output}`,
    );
  });

  it('step accepts --stream flag without crashing', () => {
    const root = createProject();

    // Start a run first so step has something to work with
    runCli(root, ['run', '--dry-run']);

    // Run step with --stream — it should not crash with "unknown option"
    const result = runCli(root, ['step', '--stream']);
    const output = (result.stdout || '') + (result.stderr || '');

    // The command may fail for other reasons (no active run, no role, etc.)
    // but it must NOT fail because --stream is unknown
    assert.ok(
      !output.includes('unknown option') && !output.includes('Unknown option'),
      `step must accept --stream without "unknown option" error. Got:\n${output}`,
    );
    assert.ok(
      !output.includes('unrecognized option'),
      `step must accept --stream without "unrecognized option" error. Got:\n${output}`,
    );
  });
});
