/**
 * Timeline turn timing tests
 *
 * Verifies that the dashboard Timeline view renders timing information
 * for both active turns (elapsed) and completed turns (duration + accepted_at).
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import {
  render as renderTimeline,
  formatDuration,
  computeElapsed,
  formatTimestamp,
} from '../dashboard/components/timeline.js';

// ── formatDuration ──────────────────────────────────────────────────────────

describe('formatDuration', () => {
  it('formats 0ms as "0s"', () => {
    assert.equal(formatDuration(0), '0s');
  });

  it('formats seconds only', () => {
    assert.equal(formatDuration(45000), '45s');
  });

  it('formats minutes and seconds', () => {
    assert.equal(formatDuration(135000), '2m 15s');
  });

  it('formats hours and minutes', () => {
    assert.equal(formatDuration(3720000), '1h 2m');
  });

  it('returns null for null/undefined/NaN', () => {
    assert.equal(formatDuration(null), null);
    assert.equal(formatDuration(undefined), null);
    assert.equal(formatDuration(NaN), null);
  });

  it('returns null for negative values', () => {
    assert.equal(formatDuration(-1000), null);
  });
});

// ── Active turn elapsed ─────────────────────────────────────────────────────

describe('Timeline active turn timing', () => {
  it('renders elapsed time when active turn has started_at', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const html = renderTimeline({
      state: {
        run_id: 'run_timing',
        status: 'running',
        phase: 'development',
        active_turns: {
          t1: { turn_id: 'turn_001', assigned_role: 'dev', status: 'assigned', started_at: fiveMinAgo },
        },
      },
      history: [],
    });
    assert.ok(html.includes('Elapsed:'), 'should show Elapsed label');
    assert.ok(html.includes('turn-timing'), 'should have turn-timing class');
  });

  it('renders without elapsed when active turn has no started_at', () => {
    const html = renderTimeline({
      state: {
        run_id: 'run_timing',
        status: 'running',
        phase: 'development',
        active_turns: {
          t1: { turn_id: 'turn_002', assigned_role: 'pm', status: 'assigned' },
        },
      },
      history: [],
    });
    assert.ok(!html.includes('Elapsed:'), 'should not show Elapsed for legacy turns');
  });
});

// ── History entry timing ────────────────────────────────────────────────────

describe('Timeline history entry timing', () => {
  it('renders duration and accepted_at for history entries with timing', () => {
    const html = renderTimeline({
      state: {
        run_id: 'run_timing',
        status: 'running',
        phase: 'development',
        active_turns: {},
      },
      history: [
        {
          turn_id: 'turn_hist_001',
          assigned_role: 'dev',
          summary: 'Implemented feature X',
          accepted_at: '2026-04-12T10:00:00Z',
          duration_ms: 135000,
        },
      ],
    });
    assert.ok(html.includes('turn-timing'), 'should have turn-timing class for duration');
    assert.ok(html.includes('2m 15s'), 'should render formatted duration');
    assert.ok(html.includes('turn-timestamp'), 'should have turn-timestamp class for accepted_at');
  });

  it('renders cleanly without timing fields on legacy entries', () => {
    const html = renderTimeline({
      state: {
        run_id: 'run_timing',
        status: 'running',
        phase: 'development',
        active_turns: {},
      },
      history: [
        {
          turn_id: 'turn_legacy',
          assigned_role: 'qa',
          summary: 'Reviewed code',
        },
      ],
    });
    assert.ok(html.includes('turn_legacy'), 'should render turn ID');
    assert.ok(!html.includes('turn-timing'), 'should not have timing class');
    assert.ok(!html.includes('turn-timestamp'), 'should not have timestamp class');
  });
});

// ── formatTimestamp ──────────────────────────────────────────────────────────

describe('formatTimestamp', () => {
  it('returns null for null/undefined', () => {
    assert.equal(formatTimestamp(null), null);
    assert.equal(formatTimestamp(undefined), null);
  });

  it('returns null for invalid ISO string', () => {
    assert.equal(formatTimestamp('not-a-date'), null);
  });

  it('returns a non-empty string for valid ISO', () => {
    const result = formatTimestamp('2026-04-12T10:00:00Z');
    assert.ok(result && result.length > 0, 'should produce a formatted string');
  });
});

// ── computeElapsed ──────────────────────────────────────────────────────────

describe('computeElapsed', () => {
  it('returns null for null/undefined', () => {
    assert.equal(computeElapsed(null), null);
    assert.equal(computeElapsed(undefined), null);
  });

  it('returns a non-negative number for a past timestamp', () => {
    const past = new Date(Date.now() - 10000).toISOString();
    const elapsed = computeElapsed(past);
    assert.ok(typeof elapsed === 'number' && elapsed >= 0);
  });

  it('returns null for invalid date string', () => {
    assert.equal(computeElapsed('not-a-date'), null);
  });
});
