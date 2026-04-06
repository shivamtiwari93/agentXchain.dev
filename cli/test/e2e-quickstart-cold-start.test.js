/**
 * E2E Quickstart Cold Start
 *
 * Validates the documented governed quickstart from a cold temp directory.
 *
 * See: .planning/E2E_QUICKSTART_COLD_START_SPEC.md
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    timeout: 20000,
  });
}

function gitCommitAll(cwd, message) {
  execSync('git add -A', { cwd, stdio: 'ignore' });
  execSync(`git -c user.name="test" -c user.email="test@test" commit -m "${message}"`, {
    cwd,
    stdio: 'ignore',
  });
}

describe('quickstart cold-start E2E', () => {
  it('bootstraps an existing repo in place with --dir . -y', () => {
    const root = mkdtempSync(join(tmpdir(), 'axc-quickstart-existing-'));
    try {
      execSync('git init', { cwd: root, stdio: 'ignore' });

      const init = runCli(root, ['init', '--governed', '--template', 'web-app', '--dir', '.', '-y']);
      assert.equal(init.status, 0, init.stderr);
      assert.ok(existsSync(join(root, 'agentxchain.json')));
      assert.ok(!existsSync(join(root, 'my-agentxchain-project', 'agentxchain.json')));

      const validate = runCli(root, ['template', 'validate']);
      assert.equal(validate.status, 0, validate.stderr);
      assert.match(validate.stdout, /Project:\s+OK/i);
      assert.doesNotMatch(validate.stdout, /registry-only validation/i);

      gitCommitAll(root, 'bootstrap AgentXchain governed scaffold');

      const status = runCli(root, ['status']);
      assert.equal(status.status, 0, status.stderr);
      assert.match(status.stdout, /Protocol:\s+governed/i);
      assert.match(status.stdout, /Template:\s+web-app/i);
      assert.match(status.stdout, /Phase:\s+planning/i);
      assert.match(status.stdout, /Roles:\s+4/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('bootstraps a new project with an explicit target directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'axc-quickstart-new-'));
    const projectDir = join(root, 'my-agentxchain-project');
    try {
      const init = runCli(root, [
        'init',
        '--governed',
        '--template',
        'web-app',
        '--dir',
        'my-agentxchain-project',
        '-y',
      ]);
      assert.equal(init.status, 0, init.stderr);
      assert.ok(existsSync(join(projectDir, 'agentxchain.json')));

      execSync('git init', { cwd: projectDir, stdio: 'ignore' });

      const validate = runCli(projectDir, ['template', 'validate']);
      assert.equal(validate.status, 0, validate.stderr);
      assert.match(validate.stdout, /Project:\s+OK/i);
      assert.match(validate.stdout, /web-app/i);

      gitCommitAll(projectDir, 'initial governed scaffold');

      const status = runCli(projectDir, ['status']);
      assert.equal(status.status, 0, status.stderr);
      assert.match(status.stdout, /Protocol:\s+governed/i);
      assert.match(status.stdout, /Template:\s+web-app/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
