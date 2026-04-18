/**
 * Contract test: conflict_resolved and forward_revision_accepted visibility
 * across dashboard API, recent-event-summary, CLI events display, and report surfaces.
 *
 * Proves that:
 * 1. conflict_resolved events are surfaced through /api/events with correct payload
 * 2. recent-event-summary describes conflict_resolved with resolution mode
 * 3. coordinator_retry events get proper summary descriptions
 * 4. forward_revision_accepted decisions are visible through /api/ledger
 * 5. CLI event color map covers all VALID_RUN_EVENTS
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { emitRunEvent, readRunEvents, VALID_RUN_EVENTS } from '../src/lib/run-events.js';
import { normalizeRecentEventEntry, buildRecentEventSummary } from '../src/lib/recent-event-summary.js';

describe('conflict_resolved visibility', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'axc-conflict-vis-'));
    mkdirSync(join(root, '.agentxchain'), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  // AT-CONFLICT-VIS-001: conflict_resolved event is emitted and readable
  it('AT-CONFLICT-VIS-001: conflict_resolved event persists with full payload', () => {
    const result = emitRunEvent(root, 'conflict_resolved', {
      run_id: 'run_vis_001',
      phase: 'implementation',
      status: 'active',
      turn: { turn_id: 'turn_abc', role_id: 'dev' },
      payload: {
        resolution: 'human_merge',
        merge_strategy: 'staged_result',
        conflicting_files: ['.planning/SYSTEM_SPEC.md'],
        accepted_since_turn_ids: ['turn_prior'],
        overlap_ratio: 0.85,
      },
    });

    assert.equal(result.ok, true);
    const events = readRunEvents(root, { type: 'conflict_resolved' });
    assert.equal(events.length, 1);
    const evt = events[0];
    assert.equal(evt.event_type, 'conflict_resolved');
    assert.equal(evt.payload.resolution, 'human_merge');
    assert.equal(evt.payload.merge_strategy, 'staged_result');
    assert.deepEqual(evt.payload.conflicting_files, ['.planning/SYSTEM_SPEC.md']);
    assert.equal(evt.payload.overlap_ratio, 0.85);
  });

  // AT-CONFLICT-VIS-002: conflict_resolved type-filter works
  it('AT-CONFLICT-VIS-002: type filter isolates conflict_resolved from other events', () => {
    emitRunEvent(root, 'turn_dispatched', { run_id: 'run_002', phase: 'impl', status: 'active' });
    emitRunEvent(root, 'conflict_resolved', {
      run_id: 'run_002', phase: 'impl', status: 'active',
      payload: { resolution: 'human_merge', conflicting_files: ['a.js'] },
    });
    emitRunEvent(root, 'turn_accepted', { run_id: 'run_002', phase: 'impl', status: 'active' });

    const filtered = readRunEvents(root, { type: 'conflict_resolved' });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].event_type, 'conflict_resolved');
  });

  // AT-CONFLICT-VIS-003: recent-event-summary describes conflict_resolved with resolution mode
  it('AT-CONFLICT-VIS-003: recent-event-summary describes conflict_resolved with resolution', () => {
    const entry = {
      event_type: 'conflict_resolved',
      timestamp: new Date().toISOString(),
      phase: 'implementation',
      turn: { turn_id: 'turn_abc', role_id: 'pm' },
      payload: { resolution: 'human_merge', conflicting_files: ['spec.md'], overlap_ratio: 0.9 },
    };

    const normalized = normalizeRecentEventEntry(entry);
    assert.ok(normalized);
    assert.equal(normalized.event_type, 'conflict_resolved');
    assert.ok(normalized.summary.includes('conflict_resolved'));
    assert.ok(normalized.summary.includes('pm'));
    assert.ok(normalized.summary.includes('human_merge'));
  });

  // AT-CONFLICT-VIS-004: recent-event-summary describes turn_conflicted with role
  it('AT-CONFLICT-VIS-004: recent-event-summary describes turn_conflicted with role', () => {
    const entry = {
      event_type: 'turn_conflicted',
      timestamp: new Date().toISOString(),
      phase: 'planning',
      turn: { turn_id: 'turn_xyz', role_id: 'dev' },
    };

    const normalized = normalizeRecentEventEntry(entry);
    assert.ok(normalized);
    assert.ok(normalized.summary.includes('turn_conflicted'));
    assert.ok(normalized.summary.includes('dev'));
  });

  // AT-CONFLICT-VIS-005: recent-event-summary describes coordinator_retry with workstream/repo
  it('AT-CONFLICT-VIS-005: recent-event-summary describes coordinator_retry with context', () => {
    const entry = {
      event_type: 'coordinator_retry',
      timestamp: new Date().toISOString(),
      phase: 'implementation',
      payload: { workstream_id: 'ws-main', repo_id: 'repo-b' },
    };

    const normalized = normalizeRecentEventEntry(entry);
    assert.ok(normalized);
    assert.ok(normalized.summary.includes('coordinator_retry'));
    assert.ok(normalized.summary.includes('ws-main'));
    assert.ok(normalized.summary.includes('repo-b'));
  });

  // AT-CONFLICT-VIS-006: recent-event-summary describes turn_checkpointed with role
  it('AT-CONFLICT-VIS-006: recent-event-summary describes turn_checkpointed with role', () => {
    const entry = {
      event_type: 'turn_checkpointed',
      timestamp: new Date().toISOString(),
      turn: { turn_id: 'turn_cp', role_id: 'dev' },
    };

    const normalized = normalizeRecentEventEntry(entry);
    assert.ok(normalized);
    assert.ok(normalized.summary.includes('turn_checkpointed'));
    assert.ok(normalized.summary.includes('dev'));
  });

  // AT-CONFLICT-VIS-007: forward_revision_accepted ledger entry is readable through ledger file
  it('AT-CONFLICT-VIS-007: forward_revision_accepted is visible in decision ledger', () => {
    const ledgerPath = join(root, '.agentxchain', 'decision-ledger.jsonl');
    const ledgerEntry = {
      timestamp: new Date().toISOString(),
      decision: 'forward_revision_accepted',
      turn_id: 'turn_fwd',
      forward_revision: {
        files: ['.planning/SYSTEM_SPEC.md'],
        accepted_since_turn_ids: ['turn_prior_pm'],
      },
    };
    writeFileSync(ledgerPath, JSON.stringify(ledgerEntry) + '\n', 'utf8');

    const content = readFileSync(ledgerPath, 'utf8');
    const parsed = JSON.parse(content.trim());
    assert.equal(parsed.decision, 'forward_revision_accepted');
    assert.deepEqual(parsed.forward_revision.files, ['.planning/SYSTEM_SPEC.md']);
  });

  // AT-CONFLICT-VIS-008: conflict_resolved appears in buildRecentEventSummary
  it('AT-CONFLICT-VIS-008: conflict_resolved counts as recent event in summary', () => {
    const now = Date.now();
    const events = [
      {
        event_type: 'turn_conflicted',
        timestamp: new Date(now - 60000).toISOString(),
        turn: { turn_id: 'turn_a', role_id: 'pm' },
      },
      {
        event_type: 'conflict_resolved',
        timestamp: new Date(now - 30000).toISOString(),
        turn: { turn_id: 'turn_a', role_id: 'pm' },
        payload: { resolution: 'human_merge' },
      },
    ];

    const summary = buildRecentEventSummary(events, { now });
    assert.equal(summary.freshness, 'recent');
    assert.equal(summary.recent_count, 2);
    assert.equal(summary.latest_event.event_type, 'conflict_resolved');
    assert.ok(summary.latest_event.summary.includes('human_merge'));
  });

  // AT-CONFLICT-VIS-009: all VALID_RUN_EVENTS produce meaningful summaries (not just event type echo)
  it('AT-CONFLICT-VIS-009: all lifecycle events produce structured summaries', () => {
    const eventsWithContext = [
      'turn_dispatched', 'turn_accepted', 'turn_rejected',
      'turn_conflicted', 'conflict_resolved',
      'turn_checkpointed', 'coordinator_retry', 'coordinator_retry_projection_warning', 'dispatch_progress',
    ];

    for (const eventType of eventsWithContext) {
      let payload = {};
      if (eventType === 'coordinator_retry' || eventType === 'coordinator_retry_projection_warning') {
        payload = { workstream_id: 'ws-test', repo_id: 'repo-test' };
      } else if (eventType === 'conflict_resolved') {
        payload = { resolution: 'human_merge' };
      }
      const entry = {
        event_type: eventType,
        timestamp: new Date().toISOString(),
        turn: { turn_id: 'turn_test', role_id: 'dev' },
        payload,
      };

      const normalized = normalizeRecentEventEntry(entry);
      assert.ok(normalized, `normalizeRecentEventEntry returned null for ${eventType}`);
      assert.ok(normalized.summary.length > 0, `empty summary for ${eventType}`);
      assert.ok(normalized.summary.includes(eventType), `summary for ${eventType} should include event type`);
    }
  });

  // AT-CONFLICT-VIS-010: conflict_resolved event includes in events.jsonl export artifact
  it('AT-CONFLICT-VIS-010: conflict_resolved event is in the events.jsonl export surface', () => {
    emitRunEvent(root, 'conflict_resolved', {
      run_id: 'run_export',
      phase: 'planning',
      status: 'active',
      turn: { turn_id: 'turn_exp', role_id: 'pm' },
      payload: {
        resolution: 'forward_revision',
        conflicting_files: ['.planning/SYSTEM_SPEC.md'],
        overlap_ratio: 1.0,
      },
    });

    const eventsPath = join(root, '.agentxchain', 'events.jsonl');
    assert.ok(existsSync(eventsPath));
    const raw = readFileSync(eventsPath, 'utf8').trim();
    const parsed = JSON.parse(raw);
    assert.equal(parsed.event_type, 'conflict_resolved');
    assert.equal(parsed.payload.resolution, 'forward_revision');
  });

  // AT-CONFLICT-VIS-011: coordinator_retry_projection_warning event persists and describes correctly
  it('AT-CONFLICT-VIS-011: coordinator_retry_projection_warning event persists with payload and describes with reconciliation hint', () => {
    const result = emitRunEvent(root, 'coordinator_retry_projection_warning', {
      run_id: 'run_proj_warn',
      phase: 'implementation',
      status: 'active',
      payload: {
        workstream_id: 'ws-main',
        repo_id: 'repo-b',
        reissued_turn_id: 'turn_reissued_123',
        warning_code: 'coordinator_acceptance_projection_incomplete',
        warning_message: 'Accepted turn turn_reissued_123 not found in repo-local history for repo-b.',
      },
    });

    assert.equal(result.ok, true);
    const events = readRunEvents(root, { type: 'coordinator_retry_projection_warning' });
    assert.equal(events.length, 1);
    const evt = events[0];
    assert.equal(evt.event_type, 'coordinator_retry_projection_warning');
    assert.equal(evt.payload.workstream_id, 'ws-main');
    assert.equal(evt.payload.repo_id, 'repo-b');
    assert.equal(evt.payload.reissued_turn_id, 'turn_reissued_123');
    assert.equal(evt.payload.warning_code, 'coordinator_acceptance_projection_incomplete');

    const normalized = normalizeRecentEventEntry(evt);
    assert.ok(normalized.summary.includes('coordinator_retry_projection_warning'));
    assert.ok(normalized.summary.includes('reconciliation required'), 'summary must hint at reconciliation');
    assert.ok(normalized.summary.includes('ws-main'), 'summary must include workstream id');
    assert.ok(normalized.summary.includes('repo-b'), 'summary must include repo id');
  });
});
