import { strict as assert } from 'node:assert';
import { describe, it, after } from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 20000,
    env: { ...process.env, NODE_NO_WARNINGS: '1', NO_COLOR: '1' },
  });
}

function initGitRepo(dir) {
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  configureGitIdentity(dir);
  execSync('git add .', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "baseline"', { cwd: dir, stdio: 'ignore' });
}

function configureGitIdentity(dir) {
  execSync('git config user.email "test@example.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test User"', { cwd: dir, stdio: 'ignore' });
}

function getHeadSha(dir) {
  return execSync('git rev-parse HEAD', {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function readState(dir) {
  return JSON.parse(readFileSync(join(dir, '.agentxchain', 'state.json'), 'utf8'));
}

function stageTurnResult(dir, turn, runId) {
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  writeFileSync(join(dir, '.agentxchain', 'staging', 'turn-result.json'), JSON.stringify({
    schema_version: '1.0',
    run_id: runId,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: `Restore proof for ${turn.assigned_role}.`,
    decisions: [{
      id: 'DEC-001',
      category: 'implementation',
      statement: 'Cross-machine restore proof.',
      rationale: 'Restore must continue the same run.',
    }],
    objections: [{
      id: 'OBJ-001',
      severity: 'low',
      statement: 'No blocker.',
      status: 'raised',
    }],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['echo ok'],
      evidence_summary: 'Fixture pass.',
      machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
    },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'pm',
    phase_transition_request: null,
    run_completion_request: false,
    needs_human_reason: null,
    cost: { input_tokens: 10, output_tokens: 5, usd: 0.01 },
  }, null, 2));
}

function createSourceProject() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-restore-source-'));
  scaffoldGoverned(dir, 'Restore Fixture', 'restore-fixture');
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  initGitRepo(dir);
  return dir;
}

function exportArtifact(sourceDir, fileName = 'run-export.json') {
  const exportResult = runCli(sourceDir, ['export', '--output', fileName]);
  assert.equal(exportResult.status, 0, exportResult.stderr);
  return join(sourceDir, fileName);
}

const dirs = [];

after(() => {
  for (const dir of dirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

describe('restore CLI', () => {
  it('AT-XRESTORE-001: restore --help documents --input', () => {
    const result = runCli(process.cwd(), ['restore', '--help']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--input <path>/);
  });

  it('AT-XRESTORE-002/005: run export records restore metadata and restore continues the same run in another checkout', () => {
    const source = createSourceProject();
    dirs.push(source);

    const resume = runCli(source, ['resume', '--role', 'pm']);
    assert.equal(resume.status, 0, resume.stderr);
    const sourceState = readState(source);
    const runId = sourceState.run_id;
    const turn = Object.values(sourceState.active_turns || {})[0];
    stageTurnResult(source, turn, runId);
    const accept = runCli(source, ['accept-turn']);
    assert.equal(accept.status, 0, `${accept.stdout}\n${accept.stderr}`);

    const artifactPath = exportArtifact(source);
    const exported = JSON.parse(readFileSync(artifactPath, 'utf8'));
    assert.equal(exported.schema_version, '0.3');
    assert.equal(exported.workspace.git.is_repo, true);
    assert.equal(exported.workspace.git.head_sha, getHeadSha(source));
    assert.equal(exported.workspace.git.restore_supported, true);
    assert.deepEqual(exported.workspace.git.restore_blockers, []);

    const target = mkdtempSync(join(tmpdir(), 'axc-restore-target-'));
    dirs.push(target);
    const clone = spawnSync('git', ['clone', source, target], { encoding: 'utf8', timeout: 20000 });
    assert.equal(clone.status, 0, clone.stderr);

    const restore = runCli(target, ['restore', '--input', artifactPath]);
    assert.equal(restore.status, 0, `${restore.stdout}\n${restore.stderr}`);
    assert.match(restore.stdout, /Restored governed continuity state/);
    assert.match(restore.stdout, new RegExp(runId));

    const restoredState = readState(target);
    assert.equal(restoredState.run_id, runId);
    assert.equal(restoredState.last_completed_turn_id, readState(source).last_completed_turn_id);

    const resumeTarget = runCli(target, ['resume', '--role', 'pm']);
    assert.equal(resumeTarget.status, 0, `${resumeTarget.stdout}\n${resumeTarget.stderr}`);
    const resumedState = readState(target);
    assert.equal(resumedState.run_id, runId, 'resume after restore must continue the same run_id');
  });

  it('preserves empty governed files during restore', () => {
    const source = createSourceProject();
    dirs.push(source);
    mkdirSync(join(source, '.agentxchain', 'reports'), { recursive: true });
    writeFileSync(join(source, '.agentxchain', 'reports', 'empty.txt'), '');

    const artifactPath = exportArtifact(source, 'empty-file-export.json');

    const target = mkdtempSync(join(tmpdir(), 'axc-restore-empty-target-'));
    dirs.push(target);
    const clone = spawnSync('git', ['clone', source, target], { encoding: 'utf8', timeout: 20000 });
    assert.equal(clone.status, 0, clone.stderr);

    const restore = runCli(target, ['restore', '--input', artifactPath]);
    assert.equal(restore.status, 0, `${restore.stdout}\n${restore.stderr}`);
    assert.equal(readFileSync(join(target, '.agentxchain', 'reports', 'empty.txt'), 'utf8'), '');
  });

  it('AT-XRESTORE-003: restore rejects exports with dirty non-restorable source files', () => {
    const source = createSourceProject();
    dirs.push(source);
    writeFileSync(join(source, 'README.md'), '# dirty source file\n');

    const artifactPath = exportArtifact(source, 'dirty-export.json');
    const exported = JSON.parse(readFileSync(artifactPath, 'utf8'));
    assert.equal(exported.workspace.git.restore_supported, false);
    assert.ok(exported.workspace.git.restore_blockers.some((entry) => entry.includes('README.md')));

    const target = mkdtempSync(join(tmpdir(), 'axc-restore-dirty-target-'));
    dirs.push(target);
    const clone = spawnSync('git', ['clone', source, target], { encoding: 'utf8', timeout: 20000 });
    assert.equal(clone.status, 0, clone.stderr);

    const restore = runCli(target, ['restore', '--input', artifactPath]);
    assert.notEqual(restore.status, 0);
    assert.match(restore.stderr, /Export cannot be restored safely/i);
    assert.match(restore.stderr, /README\.md/);
  });

  it('AT-XRESTORE-004: restore rejects target HEAD mismatch', () => {
    const source = createSourceProject();
    dirs.push(source);
    const artifactPath = exportArtifact(source, 'head-check.json');

    const target = mkdtempSync(join(tmpdir(), 'axc-restore-head-target-'));
    dirs.push(target);
    const clone = spawnSync('git', ['clone', source, target], { encoding: 'utf8', timeout: 20000 });
    assert.equal(clone.status, 0, clone.stderr);
    configureGitIdentity(target);
    writeFileSync(join(target, 'notes.txt'), 'head mismatch\n');
    execSync('git add notes.txt', { cwd: target, stdio: 'ignore' });
    execSync('git commit -m "head mismatch"', { cwd: target, stdio: 'ignore' });

    const restore = runCli(target, ['restore', '--input', artifactPath]);
    assert.notEqual(restore.status, 0);
    assert.match(restore.stderr, /Target HEAD mismatch/i);
  });

  it('AT-XRESTORE-006: restore rejects coordinator exports', () => {
    const source = createSourceProject();
    dirs.push(source);
    const artifactPath = exportArtifact(source, 'wrong-kind.json');
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
    artifact.export_kind = 'agentxchain_coordinator_export';
    writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n');

    const restore = runCli(source, ['restore', '--input', artifactPath]);
    assert.notEqual(restore.status, 0);
    assert.match(restore.stderr, /Restore input failed export verification|Restore only supports run exports/i);
  });
});
