import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';

import {
  RECENT_EVENT_WINDOW_MS,
  buildRecentEventSummary,
} from '../src/lib/recent-event-summary.js';

describe('recent event summary helper', () => {
  it('AT-RES-001: reports recent freshness with count and latest event', () => {
    const now = Date.parse('2026-04-15T20:15:00.000Z');
    const summary = buildRecentEventSummary([
      {
        event_type: 'turn_dispatched',
        timestamp: '2026-04-15T20:05:00.000Z',
        phase: 'implementation',
        turn: { turn_id: 'turn_001', role_id: 'dev' },
      },
      {
        event_type: 'turn_accepted',
        timestamp: '2026-04-15T20:10:00.000Z',
        phase: 'implementation',
        turn: { turn_id: 'turn_001', role_id: 'dev' },
      },
    ], { now, windowMs: RECENT_EVENT_WINDOW_MS });

    assert.equal(summary.freshness, 'recent');
    assert.equal(summary.recent_count, 2);
    assert.equal(summary.latest_event.event_type, 'turn_accepted');
    assert.equal(summary.latest_event.role_id, 'dev');
    assert.equal(summary.latest_event.summary, 'turn_accepted [dev]');
  });

  it('AT-RES-002: reports quiet freshness when latest event is older than the window', () => {
    const now = Date.parse('2026-04-15T20:30:00.000Z');
    const summary = buildRecentEventSummary([
      {
        event_type: 'run_started',
        timestamp: '2026-04-15T19:00:00.000Z',
        phase: 'planning',
      },
    ], { now, windowMs: RECENT_EVENT_WINDOW_MS });

    assert.equal(summary.freshness, 'quiet');
    assert.equal(summary.recent_count, 0);
    assert.equal(summary.latest_event.event_type, 'run_started');
    assert.equal(summary.latest_event.summary, 'run_started');
  });

  it('AT-RES-003: renders session_continuation with previous/next run ids and objective', () => {
    const now = Date.parse('2026-04-20T12:00:00.000Z');
    const summary = buildRecentEventSummary([
      {
        event_type: 'session_continuation',
        timestamp: '2026-04-20T11:59:30.000Z',
        repo_id: 'repo_docs',
        payload: {
          previous_run_id: 'run_prev_001',
          next_run_id: 'run_next_002',
          next_objective: 'Docs: add version-history canonical artifact',
        },
      },
    ], { now, windowMs: RECENT_EVENT_WINDOW_MS });

    assert.equal(summary.freshness, 'recent');
    assert.equal(summary.recent_count, 1);
    assert.equal(summary.latest_event.event_type, 'session_continuation');
    assert.equal(
      summary.latest_event.summary,
      '[repo_docs] session_continuation run_prev_001 -> run_next_002 (Docs: add version-history canonical artifact)',
    );
  });
});
