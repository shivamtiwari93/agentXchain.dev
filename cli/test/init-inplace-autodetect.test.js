import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'bin', 'agentxchain.js');

function run(args, cwd) {
  return execSync(`node "${CLI}" ${args}`, {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

describe('init --governed --yes in-place auto-detection', () => {
  it('AT-INIT-INPLACE-001: scaffolds in-place in empty git repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-init-inplace-'));
    execSync('git init', { cwd: dir, stdio: 'ignore' });

    const out = run('init --governed --yes --goal "test inplace"', dir);
    assert.match(out, /Created governed project \.\//, 'should show ./ as target');
    assert.ok(existsSync(join(dir, 'agentxchain.json')), 'config in cwd');
    assert.ok(existsSync(join(dir, '.agentxchain')), 'state dir in cwd');
    assert.ok(!existsSync(join(dir, 'my-agentxchain-project')), 'no subdirectory created');
  });

  it('AT-INIT-INPLACE-002: creates subdirectory in non-git directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-init-nogit-'));

    const out = run('init --governed --yes --goal "test nogit"', dir);
    assert.match(out, /Created governed project my-agentxchain-project/, 'should create subdir');
    assert.ok(existsSync(join(dir, 'my-agentxchain-project', 'agentxchain.json')), 'config in subdir');
    assert.ok(!existsSync(join(dir, 'agentxchain.json')), 'no config in cwd');
  });

  it('AT-INIT-INPLACE-003: creates subdirectory when agentxchain.json exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-init-existing-'));
    execSync('git init', { cwd: dir, stdio: 'ignore' });
    writeFileSync(join(dir, 'agentxchain.json'), '{}');

    const out = run('init --governed --yes --goal "test existing"', dir);
    assert.match(out, /Created governed project my-agentxchain-project/, 'should create subdir');
    assert.ok(existsSync(join(dir, 'my-agentxchain-project', 'agentxchain.json')), 'config in subdir');
  });

  it('AT-INIT-INPLACE-004: explicit --dir . still works', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-init-explicit-'));
    execSync('git init', { cwd: dir, stdio: 'ignore' });

    const out = run('init --governed --yes --dir . --goal "test explicit"', dir);
    assert.match(out, /Created governed project \.\//, 'should show ./ as target');
    assert.ok(existsSync(join(dir, 'agentxchain.json')), 'config in cwd');
  });
});
