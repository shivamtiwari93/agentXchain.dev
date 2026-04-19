import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyRepoPath,
  isOperationalPath,
  normalizeCheckpointableFiles,
  RUN_CONTINUITY_DIRECTORY_ROOTS,
  RUN_CONTINUITY_STATE_FILES,
} from '../src/lib/repo-observer.js';
import { RUN_EXPORT_INCLUDED_ROOTS, RUN_RESTORE_ROOTS } from '../src/lib/export.js';
import { HUMAN_ESCALATIONS_PATH, HUMAN_TASKS_PATH } from '../src/lib/human-escalations.js';
import { NOTIFICATION_AUDIT_PATH } from '../src/lib/notification-runner.js';
import { SCHEDULE_STATE_PATH, DAEMON_STATE_PATH } from '../src/lib/run-schedule.js';
import { RECOVERY_REPORT_PATH } from '../src/lib/workflow-gate-semantics.js';
import { SESSION_RECOVERY_PATH } from '../src/lib/continuity-status.js';
import {
  LEGACY_DISPATCH_PROGRESS_PATH,
  getDispatchProgressRelativePath,
} from '../src/lib/dispatch-progress.js';
import { RUN_EVENTS_PATH } from '../src/lib/run-events.js';

// ── Framework-Owned Write Paths ─────────────────────────────────────────────
// Every file path the framework writes to MUST be excluded from agent-attributed
// observation. If a framework-owned path is NOT operational, it poisons
// retained-turn artifact observation as an "undeclared file change."
//
// This test exists because of BUG-45 (HUMAN_TASKS.md was missing) and the
// broader audit the roadmap demanded. Any new framework write surface must
// be added here FIRST (test-driven), then to repo-observer.js.

describe('framework-owned write paths are excluded from agent observation', () => {

  // ── Prefix-excluded paths ───────────────────────────────────────────────
  const PREFIX_EXCLUDED_PATHS = [
    // dispatch lifecycle
    '.agentxchain/dispatch/turns/turn_abc123/MANIFEST.json',
    '.agentxchain/dispatch/rejected/turn_abc-attempt-1-2026-04-19.json',
    '.agentxchain/dispatch-progress-turn_abc123.json',
    // staging
    '.agentxchain/staging/turn_abc123/turn-result.json',
    // intake
    '.agentxchain/intake/intents/intent_123.json',
    '.agentxchain/intake/observations/intent_123/obs.json',
    '.agentxchain/intake/events/evt_123.json',
    '.agentxchain/intake/loop-state.json',
    '.agentxchain/intake/injected-priority.json',
    // locks / transactions
    '.agentxchain/locks/acceptance.lock',
    '.agentxchain/transactions/txn_123.json',
    // missions
    '.agentxchain/missions/mission_abc.json',
    // coordinator / multirepo
    '.agentxchain/multirepo/barriers.json',
    '.agentxchain/multirepo/barrier-ledger.jsonl',
    '.agentxchain/multirepo/history.jsonl',
    '.agentxchain/multirepo/context/ctx_123/COORDINATOR_CONTEXT.json',
    '.agentxchain/multirepo/context/ctx_123/COORDINATOR_CONTEXT.md',
    '.agentxchain/multirepo/handoffs/intent_123.json',
    // prompt scaffold (init/migrate-owned)
    '.agentxchain/prompts/pm.md',
    '.agentxchain/prompts/dev.md',
    '.agentxchain/prompts/qa.md',
  ];

  for (const path of PREFIX_EXCLUDED_PATHS) {
    it(`prefix-excluded: ${path}`, () => {
      assert.ok(isOperationalPath(path), `${path} should be operational but is NOT — framework writes here will poison observation`);
    });
  }

  // ── File-excluded paths ─────────────────────────────────────────────────
  const FILE_EXCLUDED_PATHS = [
    '.agentxchain/state.json',
    '.agentxchain/session.json',
    '.agentxchain/history.jsonl',
    '.agentxchain/decision-ledger.jsonl',
    '.agentxchain/repo-decisions.jsonl',
    '.agentxchain/lock.json',
    '.agentxchain/hook-audit.jsonl',
    '.agentxchain/hook-annotations.jsonl',
    '.agentxchain/run-history.jsonl',
    '.agentxchain/events.jsonl',
    '.agentxchain/notification-audit.jsonl',
    '.agentxchain/schedule-state.json',
    '.agentxchain/schedule-daemon.json',
    '.agentxchain/continuous-session.json',
    '.agentxchain/human-escalations.jsonl',
    '.agentxchain/sla-reminders.json',
    '.agentxchain/SESSION_RECOVERY.md',
    '.agentxchain/migration-report.md',
    'TALK.md',
    'HUMAN_TASKS.md',
  ];

  for (const path of FILE_EXCLUDED_PATHS) {
    it(`file-excluded: ${path}`, () => {
      assert.ok(isOperationalPath(path), `${path} should be operational but is NOT`);
    });
  }

  const EXPORTED_FRAMEWORK_WRITE_PATHS = [
    HUMAN_ESCALATIONS_PATH,
    HUMAN_TASKS_PATH,
    NOTIFICATION_AUDIT_PATH,
    SCHEDULE_STATE_PATH,
    DAEMON_STATE_PATH,
    RECOVERY_REPORT_PATH,
    SESSION_RECOVERY_PATH,
    LEGACY_DISPATCH_PROGRESS_PATH,
    getDispatchProgressRelativePath('turn_abc123'),
    RUN_EVENTS_PATH,
  ];

  for (const path of EXPORTED_FRAMEWORK_WRITE_PATHS) {
    it(`exported framework path is excluded: ${path}`, () => {
      assert.ok(
        isOperationalPath(path),
        `${path} is exported as a framework-owned path but is NOT excluded from observation`,
      );
    });
  }

  it('AT-PCLASS-003: exported legacy dispatch progress path is intentionally operational, not accidental prefix coverage', () => {
    const classification = classifyRepoPath(LEGACY_DISPATCH_PROGRESS_PATH);
    assert.equal(classification.operational, true);
    assert.equal(classification.baselineExempt, true);
    assert.equal(classification.continuityState, false);
    assert.equal(classification.projectOwned, false);
  });

  it('AT-PCLASS-003: review/proposed/report evidence paths are continuity state and baseline-exempt', () => {
    for (const relPath of [
      '.agentxchain/reviews/turn_1234-qa-review.md',
      '.agentxchain/proposed/turn_1234/PROPOSAL.md',
      '.agentxchain/reports/RECOVERY_REPORT.md',
    ]) {
      const classification = classifyRepoPath(relPath);
      assert.equal(classification.operational, false, `${relPath} should not be operational`);
      assert.equal(classification.baselineExempt, true, `${relPath} should be baseline-exempt`);
      assert.equal(classification.continuityState, true, `${relPath} should be continuity state`);
      assert.equal(classification.projectOwned, false, `${relPath} should be framework-owned`);
    }
  });

  // ── Agent-owned paths that MUST NOT be excluded ─────────────────────────
  const AGENT_OWNED_PATHS = [
    'src/index.js',
    'README.md',
    '.planning/ROADMAP.md',
    '.planning/IMPLEMENTATION_NOTES.md',
    'package.json',
    'agentxchain.json',
  ];

  for (const path of AGENT_OWNED_PATHS) {
    it(`agent-owned (not excluded): ${path}`, () => {
      assert.ok(!isOperationalPath(path), `${path} should NOT be operational — agent work here must be observed`);
    });
  }
});

// ── History persistence normalization ──────────────────────────────────────
// governed-state.js now normalizes files_changed via normalizeCheckpointableFiles()
// before writing history entries. This test proves operational paths declared by
// agents are stripped at persistence time, not just at checkpoint consumption.
// Without this, downstream consumers that read raw history.files_changed would
// trust operational garbage that checkpoint-turn knows to filter.

describe('normalizeCheckpointableFiles strips operational paths from declared files_changed', () => {
  it('preserves agent-owned files and strips operational paths from a mixed array', () => {
    const declared = [
      'src/api.js',
      '.planning/IMPLEMENTATION_NOTES.md',
      '.agentxchain/staging/turn_abc/turn-result.json',
      '.agentxchain/dispatch/turns/turn_abc/MANIFEST.json',
      '.agentxchain/state.json',
      '.agentxchain/events.jsonl',
      'TALK.md',
      'HUMAN_TASKS.md',
      '.agentxchain/intake/intents/intent_123.json',
      'tests/fixtures/express-sample/tusq.manifest.json',
      '.agentxchain/missions/mission_abc.json',
      '.agentxchain/multirepo/barriers.json',
      '.agentxchain/prompts/dev.md',
      '.agentxchain/dispatch-progress.json',
      '.agentxchain/SESSION_RECOVERY.md',
      '.agentxchain/migration-report.md',
    ];

    const normalized = normalizeCheckpointableFiles(declared);

    // Agent-owned files survive
    assert.ok(normalized.includes('src/api.js'), 'src/api.js must survive normalization');
    assert.ok(normalized.includes('.planning/IMPLEMENTATION_NOTES.md'), '.planning/IMPLEMENTATION_NOTES.md must survive');
    assert.ok(normalized.includes('tests/fixtures/express-sample/tusq.manifest.json'), 'test fixture must survive');

    // Operational paths are stripped
    assert.ok(!normalized.includes('.agentxchain/staging/turn_abc/turn-result.json'), 'staging path must be stripped');
    assert.ok(!normalized.includes('.agentxchain/dispatch/turns/turn_abc/MANIFEST.json'), 'dispatch path must be stripped');
    assert.ok(!normalized.includes('.agentxchain/state.json'), 'state.json must be stripped');
    assert.ok(!normalized.includes('.agentxchain/events.jsonl'), 'events.jsonl must be stripped');
    assert.ok(!normalized.includes('TALK.md'), 'TALK.md must be stripped');
    assert.ok(!normalized.includes('HUMAN_TASKS.md'), 'HUMAN_TASKS.md must be stripped');
    assert.ok(!normalized.includes('.agentxchain/intake/intents/intent_123.json'), 'intake path must be stripped');
    assert.ok(!normalized.includes('.agentxchain/missions/mission_abc.json'), 'missions path must be stripped');
    assert.ok(!normalized.includes('.agentxchain/multirepo/barriers.json'), 'multirepo path must be stripped');
    assert.ok(!normalized.includes('.agentxchain/prompts/dev.md'), 'prompts path must be stripped');
    assert.ok(!normalized.includes('.agentxchain/dispatch-progress.json'), 'legacy dispatch-progress path must be stripped');
    assert.ok(!normalized.includes('.agentxchain/SESSION_RECOVERY.md'), 'SESSION_RECOVERY.md must be stripped');
    assert.ok(!normalized.includes('.agentxchain/migration-report.md'), 'migration-report.md must be stripped');

    // Exactly 3 agent-owned files remain
    assert.strictEqual(normalized.length, 3, `Expected 3 normalized files, got ${normalized.length}: ${normalized.join(', ')}`);
  });

  it('deduplicates and trims whitespace', () => {
    const declared = ['src/api.js', '  src/api.js  ', 'src/api.js', 'src/lib.js'];
    const normalized = normalizeCheckpointableFiles(declared);
    assert.deepStrictEqual(normalized, ['src/api.js', 'src/lib.js']);
  });

  it('returns empty array when all paths are operational', () => {
    const declared = [
      '.agentxchain/staging/turn_abc/turn-result.json',
      '.agentxchain/state.json',
      'TALK.md',
    ];
    const normalized = normalizeCheckpointableFiles(declared);
    assert.strictEqual(normalized.length, 0, 'All-operational input must produce empty output');
  });
});

describe('run export/restore continuity roots stay aligned with repo-observer ownership truth', () => {
  const SHARED_CONTINUITY_ROOTS = [
    ...RUN_CONTINUITY_STATE_FILES,
    ...RUN_CONTINUITY_DIRECTORY_ROOTS,
  ];

  it('AT-EXPORT-CENT-001: export roots include every shared continuity root', () => {
    for (const relPath of SHARED_CONTINUITY_ROOTS) {
      assert.ok(
        RUN_EXPORT_INCLUDED_ROOTS.includes(relPath),
        `${relPath} must be included in RUN_EXPORT_INCLUDED_ROOTS`,
      );
    }
  });

  it('AT-EXPORT-CENT-002: restore roots include every shared continuity root', () => {
    for (const relPath of SHARED_CONTINUITY_ROOTS) {
      assert.ok(
        RUN_RESTORE_ROOTS.includes(relPath),
        `${relPath} must be included in RUN_RESTORE_ROOTS`,
      );
    }
  });

  it('AT-EXPORT-CENT-003: dashboard metadata stays export-only', () => {
    assert.ok(RUN_EXPORT_INCLUDED_ROOTS.includes('.agentxchain-dashboard.pid'));
    assert.ok(RUN_EXPORT_INCLUDED_ROOTS.includes('.agentxchain-dashboard.json'));
    assert.ok(!RUN_RESTORE_ROOTS.includes('.agentxchain-dashboard.pid'));
    assert.ok(!RUN_RESTORE_ROOTS.includes('.agentxchain-dashboard.json'));
  });

  it('AT-PCLASS-003: every continuity root is classified as continuity state and baseline-exempt', () => {
    for (const relPath of [
      ...RUN_CONTINUITY_STATE_FILES,
      ...RUN_CONTINUITY_DIRECTORY_ROOTS.map((root) => `${root}/fixture.txt`),
    ]) {
      const classification = classifyRepoPath(relPath);
      assert.equal(classification.continuityState, true, `${relPath} must classify as continuity state`);
      assert.equal(classification.baselineExempt, true, `${relPath} must be baseline-exempt`);
      assert.equal(classification.projectOwned, false, `${relPath} must not classify as project-owned`);
    }
  });
});
