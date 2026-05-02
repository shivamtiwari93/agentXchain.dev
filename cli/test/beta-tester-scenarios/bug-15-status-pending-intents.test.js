/**
 * BUG-15 beta-tester scenario: `status` must surface pending approved intents.
 *
 * Tester sequence:
 *   1. Scaffold a governed project, start run
 *   2. Inject intent, auto-approve
 *   3. Run status --json
 *   4. Verify output includes pending_intents with the injected intent
 */

import { describe, it, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
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
    cwd: root, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function createProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug15-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'BUG-15 Fixture', `bug-15-${Date.now()}`);
  execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {}
  }
});

describe('BUG-15 beta-tester scenario: status surfaces pending approved intents', () => {
  it('status --json includes pending_intents with the injected intent', () => {
    const root = createProject();

    // 1. Initialize a governed run so status works
    const initResume = runCli(root, ['resume', '--role', 'pm']);
    assert.equal(initResume.status, 0,
      `Initial resume failed: ${initResume.stdout}\n${initResume.stderr}`);

    // 2. Inject an intent (it auto-approves by default)
    const inject = runCli(root, [
      'inject', 'Fix sidebar ordering bug',
      '--priority', 'p1',
      '--charter', 'Fix sidebar ordering',
      '--acceptance', 'Sidebar items render in correct order,No regression in navigation',
      '--json',
    ]);
    assert.equal(inject.status, 0, `Inject failed: ${inject.stdout}\n${inject.stderr}`);
    const injectResult = JSON.parse(inject.stdout);
    assert.ok(injectResult.ok, `Inject not ok: ${JSON.stringify(injectResult)}`);
    const intentId = injectResult.intent_id;

    // 3. Run status --json (the intent is approved but NOT yet consumed)
    const status = runCli(root, ['status', '--json']);
    assert.equal(status.status, 0,
      `Status failed: ${status.stdout}\n${status.stderr}`);

    let statusJson;
    try {
      statusJson = JSON.parse(status.stdout);
    } catch (e) {
      assert.fail(`status --json did not return valid JSON. Output:\n${status.stdout}`);
    }

    // 4. Verify pending_intents field exists and contains the intent
    assert.ok(
      statusJson.pending_intents !== undefined,
      `status --json must include a pending_intents field. Keys: ${Object.keys(statusJson).join(', ')}`,
    );
    assert.ok(
      Array.isArray(statusJson.pending_intents),
      `pending_intents must be an array. Got: ${typeof statusJson.pending_intents}`,
    );
    assert.ok(
      statusJson.pending_intents.length > 0,
      'pending_intents should contain at least one intent',
    );

    const pendingIntent = statusJson.pending_intents.find(i => i.intent_id === intentId);
    assert.ok(
      pendingIntent,
      `pending_intents should contain the injected intent ${intentId}. Got: ${JSON.stringify(statusJson.pending_intents)}`,
    );
    assert.equal(
      pendingIntent.priority, 'p1',
      `Pending intent priority should be p1. Got: ${pendingIntent.priority}`,
    );
    assert.ok(
      pendingIntent.charter === 'Fix sidebar ordering' || pendingIntent.charter?.includes('sidebar'),
      `Pending intent charter should reference the injected charter. Got: ${pendingIntent.charter}`,
    );
  });

  it('status --json shows empty pending_intents when no approved intents exist', () => {
    const root = createProject();

    // Initialize run
    const initResume = runCli(root, ['resume', '--role', 'pm']);
    assert.equal(initResume.status, 0,
      `Initial resume failed: ${initResume.stdout}\n${initResume.stderr}`);

    // No injection — just check status
    const status = runCli(root, ['status', '--json']);
    assert.equal(status.status, 0,
      `Status failed: ${status.stdout}\n${status.stderr}`);

    const statusJson = JSON.parse(status.stdout);
    assert.ok(
      statusJson.pending_intents !== undefined,
      'status --json must include pending_intents even when empty',
    );
    assert.ok(
      Array.isArray(statusJson.pending_intents),
      `pending_intents must be an array. Got: ${typeof statusJson.pending_intents}`,
    );
    assert.equal(
      statusJson.pending_intents.length, 0,
      `pending_intents should be empty when no intents are approved. Got: ${JSON.stringify(statusJson.pending_intents)}`,
    );
  });
});
