import { strict as assert } from 'node:assert';
import { describe, it, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { gitInit } from '../test-support/git-test-helpers.js';

const created = [];

function makeTmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-git-helper-'));
  created.push(dir);
  return dir;
}

afterEach(() => {
  while (created.length > 0) {
    rmSync(created.pop(), { recursive: true, force: true });
  }
});

describe('git test helpers', () => {
  it('gitInit configures local git identity before committing', () => {
    const root = makeTmpDir();
    writeFileSync(join(root, 'README.md'), '# helper test\n');

    gitInit(root);

    const name = execSync('git config user.name', { cwd: root, encoding: 'utf8' }).trim();
    const email = execSync('git config user.email', { cwd: root, encoding: 'utf8' }).trim();
    const message = execSync('git log -1 --pretty=%s', { cwd: root, encoding: 'utf8' }).trim();

    assert.equal(name, 'AgentXchain Test Helper');
    assert.equal(email, 'agentxchain-tests@example.invalid');
    assert.equal(message, 'scaffold');
  });
});
