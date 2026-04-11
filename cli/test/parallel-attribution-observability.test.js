import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

// ── helpers ─────────────────────────────────────────────────────────────────

function makeTmpGitRepo() {
  const dir = join(tmpdir(), `axc-par-obs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "agentxchain-test"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "agentxchain-test@example.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git commit --allow-empty -m "init"', { cwd: dir, stdio: 'ignore' });
  return dir;
}

import { captureBaseline, observeChanges, buildObservedArtifact, attributeObservedChangesToTurn } from '../src/lib/repo-observer.js';

// ── buildObservedArtifact preserves attribution ─────────────────────────────

describe('buildObservedArtifact parallel attribution persistence', () => {
  let dir;

  it('preserves attributed_to_concurrent_siblings in observed artifact', () => {
    dir = makeTmpGitRepo();
    try {
      const baseline = captureBaseline(dir);

      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'src', 'app.js'), 'console.log("sibling");\n');
      const siblingObs = observeChanges(dir, baseline);
      const siblingEntry = {
        turn_id: 'turn_sibling',
        accepted_sequence: 2,
        observed_artifact: buildObservedArtifact(siblingObs, baseline),
      };

      mkdirSync(join(dir, 'docs'), { recursive: true });
      writeFileSync(join(dir, 'docs', 'readme.md'), '# readme\n');

      const currentTurn = {
        turn_id: 'turn_current',
        assigned_sequence: 1,
        concurrent_with: ['turn_sibling'],
      };
      const attributed = attributeObservedChangesToTurn(
        observeChanges(dir, baseline),
        currentTurn,
        [siblingEntry],
      );

      assert.deepEqual(attributed.attributed_to_concurrent_siblings, ['src/app.js']);

      const artifact = buildObservedArtifact(attributed, baseline);
      assert.deepEqual(artifact.attributed_to_concurrent_siblings, ['src/app.js'],
        'buildObservedArtifact must persist attributed_to_concurrent_siblings');
      assert.deepEqual(artifact.files_changed, ['docs/readme.md'],
        'files_changed must contain only non-attributed files');
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });

  it('omits attributed_to_concurrent_siblings when empty', () => {
    dir = makeTmpGitRepo();
    try {
      const baseline = captureBaseline(dir);
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'src', 'app.js'), 'console.log("solo");\n');
      const obs = observeChanges(dir, baseline);

      const artifact = buildObservedArtifact(obs, baseline);
      assert.equal(artifact.attributed_to_concurrent_siblings, undefined,
        'non-parallel observations must not carry the attribution field');
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });
});

// ── Report timeline surfaces parallel attribution ───────────────────────────

describe('Report timeline parallel attribution', () => {
  // We test the extractHistoryTimeline data flow indirectly by verifying
  // the report module exposes sibling_attributed_files from history entries.

  it('report text/markdown formatters include sibling-attributed annotation', async () => {
    const { formatGovernanceReportText, formatGovernanceReportMarkdown } = await import('../src/lib/report.js');

    // Build a minimal report object with the timeline shape that includes
    // sibling_attributed_files — bypasses the export verifier entirely.
    const report = {
      overall: 'pass',
      report_version: '0.1',
      export_kind: 'agentxchain_run_export',
      generated_at: new Date().toISOString(),
      verification: { overall: 'pass', errors: [] },
      subject: {
        kind: 'governed_run',
        project: { id: null, name: 'test', template: 'generic', protocol_mode: 'governed', schema_version: '1.0' },
        run: {
          run_id: 'test-run-1', status: 'completed', phase: 'qa',
          active_turns: [], retained_turns: [], active_roles: [],
          active_turn_count: 0, active_turn_ids: [], retained_turn_count: 0, retained_turn_ids: [],
          turns: [
            { turn_id: 'turn-1', role: 'dev', status: 'accepted', summary: 'Impl',
              phase: 'implementation', phase_transition: null,
              files_changed_count: 2, concurrent_with: ['turn-2'],
              cost_usd: 0.05, accepted_at: '2026-04-10T12:00:00Z',
              decisions: [], objections: [] },
            { turn_id: 'turn-2', role: 'integrator', status: 'accepted', summary: 'Integration',
              phase: 'implementation', phase_transition: 'qa',
              files_changed_count: 1, concurrent_with: ['turn-1'],
              sibling_attributed_files: ['src/app.js'],
              cost_usd: 0.03, accepted_at: '2026-04-10T12:05:00Z',
              decisions: [], objections: [] },
          ],
          decisions: [], hooks: { audit_entries: 0, fired: [] },
          timing: {}, gates: {}, intake: {}, recovery: {},
          approval_policy_events: [], budget: null,
        },
        artifacts: {
          history_entries: 2, decision_entries: 0,
          hook_audit_entries: 0, notification_audit_entries: 0,
          dispatch_artifact_files: 0, staging_artifact_files: 0,
          intake_present: false, coordinator_present: false,
        },
      },
    };

    const text = formatGovernanceReportText(report);
    assert.ok(text.includes('1 sibling-attributed'),
      'text report must show sibling-attributed count for parallel turns');
    assert.ok(!text.includes('0 sibling-attributed'),
      'text report must not show sibling annotation for turns without attribution');

    const md = formatGovernanceReportMarkdown(report);
    assert.ok(md.includes('1 sibling'),
      'markdown report must show sibling count for parallel turns');
  });
});
