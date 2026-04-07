import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';

import {
  captureBaseline,
  observeChanges,
  buildObservedArtifact,
  normalizeVerification,
  compareDeclaredVsObserved,
  deriveAcceptedRef,
  checkCleanBaseline,
  isOperationalPath,
} from '../src/lib/repo-observer.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpGitRepo() {
  const dir = join(tmpdir(), `axc-obs-test-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'ignore' });
  // Initial commit so HEAD exists
  writeFileSync(join(dir, 'README.md'), '# Test\n');
  execSync('git add .', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "initial"', { cwd: dir, stdio: 'ignore' });
  return dir;
}

function getHead(dir) {
  return execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

// ── Tests: captureBaseline ──────────────────────────────────────────────────

describe('captureBaseline', () => {
  let dir;
  beforeEach(() => { dir = makeTmpGitRepo(); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('captures HEAD ref and clean state', () => {
    const baseline = captureBaseline(dir);
    assert.equal(baseline.kind, 'git_worktree');
    assert.equal(baseline.head_ref, getHead(dir));
    assert.equal(baseline.clean, true);
    assert.ok(baseline.captured_at);
  });

  it('detects dirty working tree', () => {
    writeFileSync(join(dir, 'dirty.txt'), 'hello');
    const baseline = captureBaseline(dir);
    assert.equal(baseline.clean, false);
  });
});

// ── Tests: observeChanges ───────────────────────────────────────────────────

describe('observeChanges', () => {
  let dir;
  beforeEach(() => { dir = makeTmpGitRepo(); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('detects no changes on clean tree', () => {
    const baseline = captureBaseline(dir);
    const obs = observeChanges(dir, baseline);
    assert.deepEqual(obs.files_changed, []);
    assert.equal(obs.head_ref, baseline.head_ref);
  });

  it('detects new untracked files', () => {
    const baseline = captureBaseline(dir);
    writeFileSync(join(dir, 'new-file.txt'), 'content');
    const obs = observeChanges(dir, baseline);
    assert.ok(obs.files_changed.includes('new-file.txt'));
    assert.match(obs.diff_summary || '', /Untracked files:/);
    assert.match(obs.diff_summary || '', /new-file\.txt/);
  });

  it('detects modified tracked files', () => {
    const baseline = captureBaseline(dir);
    writeFileSync(join(dir, 'README.md'), '# Modified\n');
    const obs = observeChanges(dir, baseline);
    assert.ok(obs.files_changed.includes('README.md'));
  });

  it('detects committed changes since baseline', () => {
    const baseline = captureBaseline(dir);
    writeFileSync(join(dir, 'src.js'), 'code');
    execSync('git add .', { cwd: dir, stdio: 'ignore' });
    execSync('git commit -m "add src"', { cwd: dir, stdio: 'ignore' });
    const obs = observeChanges(dir, baseline);
    assert.ok(obs.files_changed.includes('src.js'));
    assert.notEqual(obs.head_ref, baseline.head_ref);
  });

  it('includes both committed and working tree changes', () => {
    const baseline = captureBaseline(dir);
    writeFileSync(join(dir, 'committed.js'), 'code');
    execSync('git add .', { cwd: dir, stdio: 'ignore' });
    execSync('git commit -m "add committed"', { cwd: dir, stdio: 'ignore' });
    writeFileSync(join(dir, 'uncommitted.js'), 'code');
    const obs = observeChanges(dir, baseline);
    assert.ok(obs.files_changed.includes('committed.js'));
    assert.ok(obs.files_changed.includes('uncommitted.js'));
  });

  it('handles null baseline gracefully', () => {
    writeFileSync(join(dir, 'new.txt'), 'content');
    const obs = observeChanges(dir, null);
    assert.ok(obs.files_changed.includes('new.txt'));
  });

  it('reports observation unavailable for non-git workspaces', () => {
    const nonGitDir = join(tmpdir(), `axc-obs-nogit-${randomBytes(6).toString('hex')}`);
    mkdirSync(nonGitDir, { recursive: true });
    writeFileSync(join(nonGitDir, 'README.md'), '# Test\n');
    const baseline = captureBaseline(nonGitDir);
    const obs = observeChanges(nonGitDir, baseline);
    assert.equal(baseline.kind, 'no_git');
    assert.equal(obs.observation_available, false);
    assert.equal(obs.kind, 'no_git');
    assert.deepEqual(obs.files_changed, []);
    rmSync(nonGitDir, { recursive: true, force: true });
  });
});

// ── Tests: normalizeVerification ────────────────────────────────────────────

describe('normalizeVerification', () => {
  it('manual + pass → attested_pass', () => {
    const result = normalizeVerification({ status: 'pass' }, 'manual');
    assert.equal(result.status, 'attested_pass');
    assert.equal(result.reproducible, false);
  });

  it('api_proxy + pass → attested_pass', () => {
    const result = normalizeVerification({ status: 'pass' }, 'api_proxy');
    assert.equal(result.status, 'attested_pass');
  });

  it('local_cli + pass + machine evidence all zero → pass', () => {
    const result = normalizeVerification({
      status: 'pass',
      machine_evidence: [{ command: 'npm test', exit_code: 0 }],
    }, 'local_cli');
    assert.equal(result.status, 'pass');
    assert.equal(result.reproducible, true);
  });

  it('mcp + pass + machine evidence all zero → pass', () => {
    const result = normalizeVerification({
      status: 'pass',
      machine_evidence: [{ command: 'npm test', exit_code: 0 }],
    }, 'mcp');
    assert.equal(result.status, 'pass');
    assert.equal(result.reproducible, true);
  });

  it('local_cli + pass + no machine evidence → not_reproducible', () => {
    const result = normalizeVerification({ status: 'pass' }, 'local_cli');
    assert.equal(result.status, 'not_reproducible');
  });

  it('local_cli + pass + nonzero exit → not_reproducible', () => {
    const result = normalizeVerification({
      status: 'pass',
      machine_evidence: [{ command: 'npm test', exit_code: 1 }],
    }, 'local_cli');
    assert.equal(result.status, 'not_reproducible');
  });

  it('any runtime + fail → fail', () => {
    assert.equal(normalizeVerification({ status: 'fail' }, 'local_cli').status, 'fail');
    assert.equal(normalizeVerification({ status: 'fail' }, 'manual').status, 'fail');
  });

  it('any runtime + skipped → skipped', () => {
    assert.equal(normalizeVerification({ status: 'skipped' }, 'local_cli').status, 'skipped');
    assert.equal(normalizeVerification({ status: 'skipped' }, 'manual').status, 'skipped');
  });

  it('null verification → skipped', () => {
    assert.equal(normalizeVerification(null, 'local_cli').status, 'skipped');
  });
});

// ── Tests: compareDeclaredVsObserved ────────────────────────────────────────

describe('compareDeclaredVsObserved', () => {
  it('authoritative: undeclared changes → error', () => {
    const result = compareDeclaredVsObserved(
      ['src/a.js'],
      ['src/a.js', 'src/b.js'],
      'authoritative',
    );
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0].includes('src/b.js'));
  });

  it('authoritative: phantom declared files → warning', () => {
    const result = compareDeclaredVsObserved(
      ['src/a.js', 'src/phantom.js'],
      ['src/a.js'],
      'authoritative',
    );
    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes('phantom.js'));
  });

  it('authoritative: exact match → no errors', () => {
    const result = compareDeclaredVsObserved(
      ['src/a.js', 'src/b.js'],
      ['src/a.js', 'src/b.js'],
      'authoritative',
    );
    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 0);
  });

  it('review_only: product file changes → error', () => {
    const result = compareDeclaredVsObserved(
      [],
      ['src/secret.js'],
      'review_only',
    );
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0].includes('review_only'));
  });

  it('review_only: .planning/ changes → no error', () => {
    const result = compareDeclaredVsObserved(
      ['.planning/notes.md'],
      ['.planning/notes.md'],
      'review_only',
    );
    assert.equal(result.errors.length, 0);
  });

  it('review_only: phantom declared review/planning files → error', () => {
    const result = compareDeclaredVsObserved(
      ['.planning/ship-verdict.md', '.agentxchain/reviews/turn_1-qa-review.md'],
      ['.agentxchain/reviews/turn_1-qa-review.md'],
      'review_only',
    );
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /declared file changes/);
    assert.match(result.errors[0], /ship-verdict\.md/);
  });

  it('degrades gracefully when observation is unavailable', () => {
    const result = compareDeclaredVsObserved(
      ['.planning/ship-verdict.md', '.agentxchain/reviews/turn_1-qa-review.md'],
      [],
      'review_only',
      { observation_available: false },
    );
    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /observation unavailable/i);
  });

  it('proposed: no strict checking', () => {
    const result = compareDeclaredVsObserved(
      ['src/a.js'],
      ['src/a.js', 'src/b.js'],
      'proposed',
    );
    assert.equal(result.errors.length, 0);
  });

  it('authoritative: unavailable observation skips diff mismatch checks', () => {
    const result = compareDeclaredVsObserved(
      ['src/a.js'],
      [],
      'authoritative',
      { observation_available: false },
    );
    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 1);
  });
});

// ── Tests: deriveAcceptedRef ────────────────────────────────────────────────

describe('deriveAcceptedRef', () => {
  it('workspace: derives from observed head_ref', () => {
    const ref = deriveAcceptedRef({ head_ref: 'abc123' }, 'workspace', 'old:ref');
    assert.equal(ref, 'git:abc123');
  });

  it('review: derives from observed head_ref', () => {
    const ref = deriveAcceptedRef({ head_ref: 'abc123' }, 'review', 'old:ref');
    assert.equal(ref, 'git:abc123');
  });

  it('workspace: falls back to workspace:dirty if no head', () => {
    const ref = deriveAcceptedRef({ head_ref: null }, 'workspace', 'old:ref');
    assert.equal(ref, 'workspace:dirty');
  });

  it('patch: prefers observed head if available', () => {
    const ref = deriveAcceptedRef({ head_ref: 'abc123' }, 'patch', 'old:ref');
    assert.equal(ref, 'git:abc123');
  });

  it('patch: falls back to currentRef if no head', () => {
    const ref = deriveAcceptedRef({ head_ref: null }, 'patch', 'old:ref');
    assert.equal(ref, 'old:ref');
  });
});

// ── Tests: checkCleanBaseline ───────────────────────────────────────────────

describe('checkCleanBaseline', () => {
  let dir;
  beforeEach(() => { dir = makeTmpGitRepo(); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('review_only: always clean', () => {
    writeFileSync(join(dir, 'dirty.txt'), 'hello');
    const result = checkCleanBaseline(dir, 'review_only');
    assert.equal(result.clean, true);
  });

  it('authoritative: clean on clean tree', () => {
    const result = checkCleanBaseline(dir, 'authoritative');
    assert.equal(result.clean, true);
  });

  it('authoritative: not clean on dirty tree', () => {
    writeFileSync(join(dir, 'dirty.txt'), 'hello');
    const result = checkCleanBaseline(dir, 'authoritative');
    assert.equal(result.clean, false);
    assert.ok(result.reason);
    assert.match(result.reason, /Commit or stash those changes before assigning the next code-writing turn\./);
  });

  it('proposed: not clean on dirty tree', () => {
    writeFileSync(join(dir, 'dirty.txt'), 'hello');
    const result = checkCleanBaseline(dir, 'proposed');
    assert.equal(result.clean, false);
  });
});

// ── Tests: buildObservedArtifact ────────────────────────────────────────────

describe('buildObservedArtifact', () => {
  it('builds correct structure', () => {
    const baseline = { head_ref: 'abc123' };
    const observation = { head_ref: 'def456', files_changed: ['a.js'], diff_summary: '1 file' };
    const artifact = buildObservedArtifact(observation, baseline);
    assert.equal(artifact.derived_by, 'orchestrator');
    assert.equal(artifact.baseline_ref, 'git:abc123');
    assert.equal(artifact.accepted_ref, 'git:def456');
    assert.deepEqual(artifact.files_changed, ['a.js']);
  });

  it('handles null baseline', () => {
    const observation = { head_ref: 'def456', files_changed: [], diff_summary: null };
    const artifact = buildObservedArtifact(observation, null);
    assert.equal(artifact.baseline_ref, null);
    assert.equal(artifact.accepted_ref, 'git:def456');
  });
});

// ── Tests: isOperationalPath ───────────────────────────────────────────────

describe('isOperationalPath', () => {
  it('identifies dispatch paths as operational', () => {
    assert.equal(isOperationalPath('.agentxchain/dispatch/current/PROMPT.md'), true);
    assert.equal(isOperationalPath('.agentxchain/dispatch/rejected/turn-0004/'), true);
  });

  it('identifies staging paths as operational', () => {
    assert.equal(isOperationalPath('.agentxchain/staging/turn-result.json'), true);
    assert.equal(isOperationalPath('.agentxchain/staging/provider-response.json'), true);
  });

  it('identifies intake lifecycle paths as operational', () => {
    assert.equal(isOperationalPath('.agentxchain/intake/events/evt_1234_abcd.json'), true);
    assert.equal(isOperationalPath('.agentxchain/intake/intents/intent_1234_abcd.json'), true);
    assert.equal(isOperationalPath('.agentxchain/intake/observations/intent_1234_abcd/'), true);
    assert.equal(isOperationalPath('.agentxchain/intake/loop-state.json'), true);
  });

  it('identifies orchestrator state files as operational', () => {
    assert.equal(isOperationalPath('.agentxchain/state.json'), true);
    assert.equal(isOperationalPath('.agentxchain/history.jsonl'), true);
    assert.equal(isOperationalPath('.agentxchain/decision-ledger.jsonl'), true);
    assert.equal(isOperationalPath('.agentxchain/lock.json'), true);
  });

  it('identifies TALK.md as operational (orchestrator-owned collaboration log)', () => {
    assert.equal(isOperationalPath('TALK.md'), true);
  });

  it('does not flag non-operational paths', () => {
    assert.equal(isOperationalPath('src/index.ts'), false);
    assert.equal(isOperationalPath('.planning/ROADMAP.md'), false);
    assert.equal(isOperationalPath('.agentxchain/reviews/turn-0004.md'), false);
    assert.equal(isOperationalPath('.agentxchain/reports/report-run_123.md'), false);
    assert.equal(isOperationalPath('.agentxchain/prompts/dev.md'), false);
  });
});

// ── Tests: operational path exclusion in observeChanges ────────────────────

describe('observeChanges — operational path exclusion', () => {
  let dir;
  beforeEach(() => { dir = makeTmpGitRepo(); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('excludes dispatch paths from observed changes', () => {
    const baseline = captureBaseline(dir);
    // Create orchestrator-owned operational files
    mkdirSync(join(dir, '.agentxchain/dispatch/current'), { recursive: true });
    writeFileSync(join(dir, '.agentxchain/dispatch/current/PROMPT.md'), '# prompt');
    // Also create an actor file
    writeFileSync(join(dir, 'src-file.js'), 'code');

    const observation = observeChanges(dir, baseline);
    assert.ok(observation.files_changed.includes('src-file.js'), 'actor file should be observed');
    assert.ok(!observation.files_changed.some(f => f.startsWith('.agentxchain/dispatch/')), 'dispatch paths should be excluded');
  });

  it('excludes staging paths from observed changes', () => {
    const baseline = captureBaseline(dir);
    mkdirSync(join(dir, '.agentxchain/staging'), { recursive: true });
    writeFileSync(join(dir, '.agentxchain/staging/turn-result.json'), '{}');

    const observation = observeChanges(dir, baseline);
    assert.ok(!observation.files_changed.some(f => f.startsWith('.agentxchain/staging/')), 'staging paths should be excluded');
  });

  it('excludes intake lifecycle paths from observed changes', () => {
    const baseline = captureBaseline(dir);
    mkdirSync(join(dir, '.agentxchain/intake/intents'), { recursive: true });
    writeFileSync(
      join(dir, '.agentxchain/intake/intents/intent_1234_abcd.json'),
      '{"status":"executing"}',
    );
    writeFileSync(join(dir, 'actor-file.js'), 'console.log("actor");\n');

    const observation = observeChanges(dir, baseline);
    assert.ok(observation.files_changed.includes('actor-file.js'), 'actor file should be observed');
    assert.ok(
      !observation.files_changed.some(f => f.startsWith('.agentxchain/intake/')),
      'intake lifecycle paths should be excluded',
    );
  });
});

// ── Tests: operational path exclusion in checkCleanBaseline ────────────────

describe('checkCleanBaseline — operational path exclusion', () => {
  let dir;
  beforeEach(() => { dir = makeTmpGitRepo(); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('authoritative: clean when only operational files are dirty', () => {
    mkdirSync(join(dir, '.agentxchain/dispatch/current'), { recursive: true });
    writeFileSync(join(dir, '.agentxchain/dispatch/current/PROMPT.md'), '# prompt');
    mkdirSync(join(dir, '.agentxchain/staging'), { recursive: true });
    writeFileSync(join(dir, '.agentxchain/staging/turn-result.json'), '{}');

    const result = checkCleanBaseline(dir, 'authoritative');
    assert.equal(result.clean, true, 'should be clean when only operational paths are dirty');
  });

  it('authoritative: clean when only TALK.md is dirty', () => {
    writeFileSync(join(dir, 'TALK.md'), '## Turn 1 — dev (planning)\n\n- **Status:** accepted\n');

    const result = checkCleanBaseline(dir, 'authoritative');
    assert.equal(result.clean, true, 'should be clean when only TALK.md is dirty — it is orchestrator-owned');
  });

  it('authoritative: clean when only review evidence is dirty', () => {
    mkdirSync(join(dir, '.agentxchain', 'reviews'), { recursive: true });
    writeFileSync(join(dir, '.agentxchain', 'reviews', 'turn_1234-qa-review.md'), '# Review\n');

    const result = checkCleanBaseline(dir, 'authoritative');
    assert.equal(result.clean, true, 'review evidence should not block the next code-writing turn');
  });

  it('authoritative: clean when only governance reports are dirty', () => {
    mkdirSync(join(dir, '.agentxchain', 'reports'), { recursive: true });
    writeFileSync(join(dir, '.agentxchain', 'reports', 'report-run_1234.md'), '# Report\n');

    const result = checkCleanBaseline(dir, 'authoritative');
    assert.equal(result.clean, true, 'governance report artifacts should not block the next code-writing turn');
  });

  it('authoritative: not clean when actor files are dirty alongside operational files', () => {
    mkdirSync(join(dir, '.agentxchain/dispatch/current'), { recursive: true });
    writeFileSync(join(dir, '.agentxchain/dispatch/current/PROMPT.md'), '# prompt');
    writeFileSync(join(dir, 'dirty-actor-file.txt'), 'hello');

    const result = checkCleanBaseline(dir, 'authoritative');
    assert.equal(result.clean, false, 'should be dirty when actor files exist');
  });
});

// ── Tests: dirty-snapshot baseline filtering ────────────────────────────────

describe('captureBaseline — dirty workspace snapshot', () => {
  let dir;
  beforeEach(() => { dir = makeTmpGitRepo(); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('records dirty snapshot for actor-owned files on dirty workspace', () => {
    writeFileSync(join(dir, 'dirty-actor.txt'), 'original content');
    const baseline = captureBaseline(dir);
    assert.equal(baseline.clean, false);
    assert.ok(baseline.dirty_snapshot, 'dirty_snapshot should be present');
    assert.ok('dirty-actor.txt' in baseline.dirty_snapshot, 'actor file should be in snapshot');
    assert.match(baseline.dirty_snapshot['dirty-actor.txt'], /^sha256:/);
  });

  it('does not include operational paths in dirty snapshot', () => {
    mkdirSync(join(dir, '.agentxchain/dispatch/current'), { recursive: true });
    writeFileSync(join(dir, '.agentxchain/dispatch/current/PROMPT.md'), '# prompt');
    writeFileSync(join(dir, 'actor-file.txt'), 'content');
    const baseline = captureBaseline(dir);
    assert.equal(baseline.clean, false);
    assert.ok(!('.agentxchain/dispatch/current/PROMPT.md' in baseline.dirty_snapshot),
      'operational paths should not appear in dirty_snapshot');
    assert.ok('actor-file.txt' in baseline.dirty_snapshot);
  });

  it('does not include TALK.md in dirty snapshot', () => {
    writeFileSync(join(dir, 'TALK.md'), '## Turn 1\n');
    const baseline = captureBaseline(dir);
    assert.ok(!('TALK.md' in (baseline.dirty_snapshot || {})),
      'TALK.md should not appear in dirty_snapshot — it is orchestrator-owned');
  });

  it('marks review evidence as baseline-clean while still tracking it in dirty snapshot', () => {
    mkdirSync(join(dir, '.agentxchain', 'reviews'), { recursive: true });
    writeFileSync(join(dir, '.agentxchain', 'reviews', 'turn_1234-qa-review.md'), '# Review\n');
    const baseline = captureBaseline(dir);
    assert.equal(baseline.clean, true, 'review evidence should not make the baseline fail clean-checks');
    assert.ok('.agentxchain/reviews/turn_1234-qa-review.md' in (baseline.dirty_snapshot || {}),
      'review evidence must remain in dirty_snapshot so later observation can filter unchanged baseline dirt');
  });

  it('marks report evidence as baseline-clean while still tracking it in dirty snapshot', () => {
    mkdirSync(join(dir, '.agentxchain', 'reports'), { recursive: true });
    writeFileSync(join(dir, '.agentxchain', 'reports', 'report-run_1234.md'), '# Report\n');
    const baseline = captureBaseline(dir);
    assert.equal(baseline.clean, true, 'report evidence should not make the baseline fail clean-checks');
    assert.ok('.agentxchain/reports/report-run_1234.md' in (baseline.dirty_snapshot || {}),
      'report evidence must remain in dirty_snapshot so later observation can filter unchanged baseline dirt');
  });

  it('records empty dirty snapshot for clean workspace', () => {
    const baseline = captureBaseline(dir);
    assert.equal(baseline.clean, true);
    assert.deepEqual(baseline.dirty_snapshot, {});
  });
});

describe('observeChanges — dirty-snapshot baseline filtering', () => {
  let dir;
  beforeEach(() => { dir = makeTmpGitRepo(); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('excludes unchanged dirty baseline files from same-HEAD observation', () => {
    // Dirty the workspace before capturing baseline
    writeFileSync(join(dir, 'pre-existing-dirty.txt'), 'original');
    const baseline = captureBaseline(dir);
    assert.equal(baseline.clean, false);

    // Observe without changing anything — the pre-existing dirty file
    // should be filtered out since its content matches the snapshot
    const obs = observeChanges(dir, baseline);
    assert.ok(!obs.files_changed.includes('pre-existing-dirty.txt'),
      'unchanged dirty baseline file should be filtered out');
  });

  it('re-includes a baseline-dirty file if its content changes after baseline', () => {
    // Dirty the workspace before capturing baseline
    writeFileSync(join(dir, 'evolving-file.txt'), 'original content');
    const baseline = captureBaseline(dir);

    // Now change the file's content after baseline capture
    writeFileSync(join(dir, 'evolving-file.txt'), 'modified content');
    const obs = observeChanges(dir, baseline);
    assert.ok(obs.files_changed.includes('evolving-file.txt'),
      'file whose content changed since baseline should be observed');
  });

  it('observes newly created files alongside unchanged dirty baseline files', () => {
    // Pre-existing dirty file
    writeFileSync(join(dir, 'pre-existing.txt'), 'old content');
    const baseline = captureBaseline(dir);

    // Add a new file during the turn — should be observed
    writeFileSync(join(dir, 'new-during-turn.txt'), 'new content');
    const obs = observeChanges(dir, baseline);
    assert.ok(obs.files_changed.includes('new-during-turn.txt'),
      'new file should be observed');
    assert.ok(!obs.files_changed.includes('pre-existing.txt'),
      'unchanged pre-existing dirty file should be filtered');
  });

  it('filters unchanged dirty review evidence from same-HEAD observation', () => {
    mkdirSync(join(dir, '.agentxchain', 'reviews'), { recursive: true });
    writeFileSync(join(dir, '.agentxchain', 'reviews', 'turn_1234-qa-review.md'), '# Review\n');
    const baseline = captureBaseline(dir);

    writeFileSync(join(dir, 'feature.js'), 'console.log("feature");\n');
    const obs = observeChanges(dir, baseline);
    assert.ok(obs.files_changed.includes('feature.js'));
    assert.ok(!obs.files_changed.includes('.agentxchain/reviews/turn_1234-qa-review.md'),
      'unchanged baseline-dirty review evidence must not leak into the next observed diff');
  });

  it('filters unchanged dirty review evidence when HEAD changes after baseline', () => {
    mkdirSync(join(dir, '.agentxchain', 'reviews'), { recursive: true });
    writeFileSync(join(dir, '.agentxchain', 'reviews', 'turn_1234-qa-review.md'), '# Review\n');
    const baseline = captureBaseline(dir);

    writeFileSync(join(dir, 'committed.js'), 'export const committed = true;\n');
    execSync('git add committed.js', { cwd: dir, stdio: 'ignore' });
    execSync('git commit -m "add committed change"', { cwd: dir, stdio: 'ignore' });

    const obs = observeChanges(dir, baseline);
    assert.ok(obs.files_changed.includes('committed.js'));
    assert.ok(!obs.files_changed.includes('.agentxchain/reviews/turn_1234-qa-review.md'),
      'unchanged baseline-dirty review evidence must stay filtered even when HEAD changed');
  });

  it('handles deleted file markers correctly under dirty-snapshot filtering', () => {
    // Create a file, commit it, then delete it before baseline
    writeFileSync(join(dir, 'will-delete.txt'), 'to be deleted');
    execSync('git add .', { cwd: dir, stdio: 'ignore' });
    execSync('git commit -m "add file"', { cwd: dir, stdio: 'ignore' });
    rmSync(join(dir, 'will-delete.txt'));

    // Capture baseline with the file already deleted (dirty state)
    const baseline = captureBaseline(dir);
    assert.equal(baseline.clean, false);
    assert.equal(baseline.dirty_snapshot['will-delete.txt'], 'deleted',
      'deleted file should be recorded as "deleted" marker');

    // Observe — the file is still deleted, so content matches baseline → filtered
    const obs = observeChanges(dir, baseline);
    assert.ok(!obs.files_changed.includes('will-delete.txt'),
      'already-deleted file matching baseline should be filtered');
  });

  it('observes a baseline-deleted file if it reappears', () => {
    // Create a file, commit it, then delete it before baseline
    writeFileSync(join(dir, 'will-delete.txt'), 'to be deleted');
    execSync('git add .', { cwd: dir, stdio: 'ignore' });
    execSync('git commit -m "add file"', { cwd: dir, stdio: 'ignore' });
    rmSync(join(dir, 'will-delete.txt'));

    const baseline = captureBaseline(dir);
    assert.equal(baseline.dirty_snapshot['will-delete.txt'], 'deleted');

    // Recreate the file — content no longer matches "deleted" marker
    writeFileSync(join(dir, 'will-delete.txt'), 'resurrected');
    const obs = observeChanges(dir, baseline);
    assert.ok(obs.files_changed.includes('will-delete.txt'),
      'resurrected file should be observed since content differs from "deleted" marker');
  });

  it('does not filter dirty files when baseline has no dirty_snapshot', () => {
    // Capture on a clean tree (no dirty_snapshot or empty)
    const baseline = captureBaseline(dir);
    assert.equal(baseline.clean, true);

    // Dirty the workspace after baseline
    writeFileSync(join(dir, 'new-dirty.txt'), 'content');
    const obs = observeChanges(dir, baseline);
    assert.ok(obs.files_changed.includes('new-dirty.txt'),
      'files should not be filtered when baseline had no dirty_snapshot');
  });
});

// ── Tests: compareDeclaredVsObserved — operational path in review_only ─────

describe('compareDeclaredVsObserved — operational path exclusion', () => {
  it('review_only: does not error on operational path changes', () => {
    const declared = [];
    const observed = ['.agentxchain/dispatch/current/PROMPT.md', '.agentxchain/staging/turn-result.json'];
    const result = compareDeclaredVsObserved(declared, observed, 'review_only');
    assert.equal(result.errors.length, 0, 'operational paths should not trigger review_only product file error');
  });

  it('review_only: still errors on real product file changes', () => {
    const declared = [];
    const observed = ['src/index.js'];
    const result = compareDeclaredVsObserved(declared, observed, 'review_only');
    assert.ok(result.errors.length > 0, 'product file changes should still error for review_only');
  });
});
