import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');
const tempDirs = [];

function sha256(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function runCli(root, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binPath, ...args], {
      cwd: root,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function createProposal(root, turnId, proposedContent) {
  const proposalDir = join(root, '.agentxchain', 'proposed', turnId);
  mkdirSync(join(proposalDir, 'src'), { recursive: true });

  writeFileSync(join(proposalDir, 'PROPOSAL.md'), [
    `# Proposed Changes — ${turnId}`,
    '',
    '**Role:** dev',
    '**Runtime:** api-dev',
    '**Status:** completed',
    '',
    '## Summary',
    '',
    'Conflicting proposal fixture',
    '',
    '## Files',
    '',
    '- `src/shared.js` — modify',
    '',
  ].join('\n'));

  const baselineContent = readFileSync(join(root, 'src', 'shared.js'));
  writeFileSync(join(proposalDir, 'SOURCE_SNAPSHOT.json'), JSON.stringify({
    captured_at: new Date().toISOString(),
    files: [{
      path: 'src/shared.js',
      action: 'modify',
      existed: true,
      sha256: sha256(baselineContent),
    }],
  }, null, 2) + '\n');
  writeFileSync(join(proposalDir, 'src', 'shared.js'), proposedContent);
}

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-proposal-conflict-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Proposal Conflict E2E', `proposal-conflict-${Date.now()}`);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'shared.js'), 'base\n');
  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "test@example.com"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "Test User"', { cwd: root, stdio: 'ignore' });
  execSync('git add .', { cwd: root, stdio: 'ignore' });
  execSync('git commit -m "baseline"', { cwd: root, stdio: 'ignore' });
  createProposal(root, 'turn-prop-a', 'proposal a\n');
  createProposal(root, 'turn-prop-b', 'proposal b\n');
  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('proposal conflict detection — CLI integration', () => {
  it('AT-PROP-CONFLICT-005: conflicting proposal apply fails closed, then succeeds with --force', async () => {
    const root = makeProject();

    const firstApply = await runCli(root, ['proposal', 'apply', 'turn-prop-a']);
    assert.equal(firstApply.status, 0, `First proposal apply failed.\nstdout: ${firstApply.stdout}\nstderr: ${firstApply.stderr}`);
    assert.match(firstApply.stdout, /Proposal Applied/);
    assert.equal(readFileSync(join(root, 'src', 'shared.js'), 'utf8'), 'proposal a\n');

    const conflictingApply = await runCli(root, ['proposal', 'apply', 'turn-prop-b']);
    assert.notEqual(conflictingApply.status, 0, 'Second proposal apply should fail on divergence');
    assert.match(conflictingApply.stdout, /conflicts with the current workspace/);
    assert.match(conflictingApply.stdout, /src\/shared\.js/);
    assert.equal(readFileSync(join(root, 'src', 'shared.js'), 'utf8'), 'proposal a\n');

    const forcedApply = await runCli(root, ['proposal', 'apply', 'turn-prop-b', '--force']);
    assert.equal(forcedApply.status, 0, `Forced proposal apply failed.\nstdout: ${forcedApply.stdout}\nstderr: ${forcedApply.stderr}`);
    assert.match(forcedApply.stdout, /Proposal Applied With Force/);
    assert.match(forcedApply.stdout, /Forced:\s+1 conflicts overridden/);
    assert.equal(readFileSync(join(root, 'src', 'shared.js'), 'utf8'), 'proposal b\n');

    const appliedRecord = JSON.parse(readFileSync(join(root, '.agentxchain', 'proposed', 'turn-prop-b', 'APPLIED.json'), 'utf8'));
    assert.equal(appliedRecord.forced, true);
    assert.deepStrictEqual(appliedRecord.overridden_conflicts.map((conflict) => conflict.path), ['src/shared.js']);
    assert.ok(existsSync(join(root, '.agentxchain', 'proposed', 'turn-prop-b', 'APPLIED.json')));
  });
});
