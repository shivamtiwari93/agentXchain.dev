import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const MOCK_AGENT = join(__dirname, '..', 'test-support', 'mock-agent.mjs');

function runCli(cwd, args) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function gitInitAndCommit(cwd, message) {
  execSync('git init', { cwd, stdio: 'ignore' });
  execSync('git config user.email "test@example.com"', { cwd, stdio: 'ignore' });
  execSync('git config user.name "Test User"', { cwd, stdio: 'ignore' });
  execSync('git add -A', { cwd, stdio: 'ignore' });
  execSync(`git commit -m "${message}"`, { cwd, stdio: 'ignore' });
}

function commitAll(cwd, message) {
  execSync('git add -A', { cwd, stdio: 'ignore' });
  execSync(`git commit -m "${message}"`, { cwd, stdio: 'ignore' });
}

describe('full-local-cli human-gated E2E', () => {
  it('AT-FULL-LOCAL-005: completes three automated turns with human gate pauses', () => {
    const root = mkdtempSync(join(tmpdir(), 'axc-full-local-'));
    try {
      const init = runCli(root, [
        'init',
        '--governed',
        '--template',
        'full-local-cli',
        '--goal',
        'Prove the human-gated full-local-cli lifecycle',
        '--dir',
        '.',
        '--dev-command',
        'node',
        MOCK_AGENT,
        '--dev-prompt-transport',
        'dispatch_bundle_only',
        '-y',
      ]);
      assert.equal(init.status, 0, init.combined);

      const config = JSON.parse(readFileSync(join(root, 'agentxchain.json'), 'utf8'));
      for (const runtimeId of ['local-pm', 'local-dev', 'local-qa', 'local-director']) {
        assert.deepEqual(config.runtimes[runtimeId].command, ['node', MOCK_AGENT]);
        assert.equal(config.runtimes[runtimeId].prompt_transport, 'dispatch_bundle_only');
      }

      gitInitAndCommit(root, 'initial governed scaffold');

      const validate = runCli(root, ['template', 'validate']);
      assert.equal(validate.status, 0, validate.combined);

      const planning = runCli(root, ['step']);
      assert.equal(planning.status, 0, planning.combined);
      assert.match(planning.combined, /Turn accepted/i);
      commitAll(root, 'accept pm turn');

      const statusAfterPlanning = runCli(root, ['status']);
      assert.equal(statusAfterPlanning.status, 0, statusAfterPlanning.combined);
      assert.match(statusAfterPlanning.combined, /approve-transition/);

      const approvePlanning = runCli(root, ['approve-transition']);
      assert.equal(approvePlanning.status, 0, approvePlanning.combined);

      const implementation = runCli(root, ['step']);
      assert.equal(implementation.status, 0, implementation.combined);
      assert.match(implementation.combined, /Turn accepted/i);
      commitAll(root, 'accept dev turn');

      const qa = runCli(root, ['step']);
      assert.equal(qa.status, 0, qa.combined);
      assert.match(qa.combined, /Turn accepted/i);
      commitAll(root, 'accept qa turn');

      const statusAfterQa = runCli(root, ['status']);
      assert.equal(statusAfterQa.status, 0, statusAfterQa.combined);
      assert.match(statusAfterQa.combined, /approve-completion/);

      const approveCompletion = runCli(root, ['approve-completion']);
      assert.equal(approveCompletion.status, 0, approveCompletion.combined);

      const finalState = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
      assert.equal(finalState.status, 'completed');

      const history = readFileSync(join(root, '.agentxchain', 'history.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      assert.ok(history.length >= 3, `expected at least 3 accepted turns, got ${history.length}`);
      assert.deepEqual(history.slice(-3).map((entry) => entry.role), ['pm', 'dev', 'qa']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
