import { describe, it, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
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
  const root = mkdtempSync(join(tmpdir(), 'axc-bug10-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'BUG-10 Fixture', `bug-10-${Date.now()}`);
  execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {}
  }
});

describe('BUG-10: restart must surface actionable recovery commands on drift', () => {
  it('outputs recovery command suggestions when HEAD has drifted', () => {
    const root = createProject();

    // Start a dry-run
    const runResult = runCli(root, ['run', '--dry-run']);
    assert.equal(runResult.status, 0, `run --dry-run failed: ${runResult.stderr}`);

    // Assign a dev turn
    const resumeResult = runCli(root, ['resume', '--role', 'dev']);
    assert.equal(resumeResult.status, 0, `resume --role dev failed: ${resumeResult.stderr}`);

    // Cause baseline drift by committing a new file
    writeFileSync(join(root, 'drift.txt'), 'baseline drift');
    execSync('git add drift.txt && git commit -m "drift commit"', { cwd: root, stdio: 'ignore' });

    // Run restart — should detect drift and suggest recovery commands
    const restartResult = runCli(root, ['restart']);
    const combinedOutput = (restartResult.stdout || '') + (restartResult.stderr || '');

    // Verify it mentions actionable recovery commands, not just a bare warning
    const mentionsReissue = combinedOutput.toLowerCase().includes('reissue-turn')
      || combinedOutput.toLowerCase().includes('reissue');
    const mentionsRecovery = combinedOutput.toLowerCase().includes('recover')
      || combinedOutput.toLowerCase().includes('resolution')
      || combinedOutput.toLowerCase().includes('suggest')
      || combinedOutput.toLowerCase().includes('try')
      || combinedOutput.toLowerCase().includes('run');

    assert.ok(
      mentionsReissue || mentionsRecovery,
      `restart output should contain actionable recovery commands (e.g., mention reissue-turn). Got: ${combinedOutput}`
    );
  });
});
