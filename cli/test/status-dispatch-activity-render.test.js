/**
 * status-dispatch-activity-render.test.js
 *
 * BUG-54 Turn 91 regression: lock the operator-facing render of dispatch
 * progress activity lines. Before this turn, `formatDispatchActivityLine`
 * rendered a green "Producing output" line for ANY non-silent activity,
 * which meant a stderr-only subprocess (failing-startup, stdout never
 * attached) displayed as if it were healthily producing output.
 *
 * DEC-BUG54-DIAGNOSTIC-ACTIVITY-TYPE-001 codifies the fix: `activity_type`
 * must reflect whether operator-usable stdout proof has arrived, and the
 * status renderer must branch on `diagnostic_only` with a yellow
 * "Diagnostic output only" line.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { formatDispatchActivityLine } from '../src/commands/status.js';

describe('BUG-54 Turn 91: formatDispatchActivityLine render vocabulary', () => {
  it('renders diagnostic_only as yellow "Diagnostic output only" with stderr line count', () => {
    const line = formatDispatchActivityLine({
      activity_type: 'diagnostic_only',
      activity_summary: 'Diagnostic output only (7 stderr lines)',
      output_lines: 0,
      stderr_lines: 7,
      last_activity_at: new Date(Date.now() - 5000).toISOString(),
    });
    assert.ok(line, 'render must return a line');
    // Color codes may or may not be stripped depending on NO_COLOR, so we
    // assert semantic substrings, not exact ANSI sequences.
    assert.ok(
      line.includes('Diagnostic output only'),
      `expected Diagnostic output only in render, got: ${line}`,
    );
    assert.ok(
      line.includes('7 stderr lines'),
      `expected 7 stderr lines in render, got: ${line}`,
    );
    assert.ok(
      line.includes('no stdout yet'),
      `expected "no stdout yet" signal, got: ${line}`,
    );
    assert.ok(
      !line.includes('Producing output'),
      `diagnostic_only must NEVER render as Producing output, got: ${line}`,
    );
  });

  it('renders activity_type=output as green "Producing output" with output line count', () => {
    const line = formatDispatchActivityLine({
      activity_type: 'output',
      activity_summary: 'Producing output (42 lines)',
      output_lines: 42,
      stderr_lines: 0,
      last_activity_at: new Date().toISOString(),
    });
    assert.ok(line.includes('Producing output'), `got: ${line}`);
    assert.ok(line.includes('42 lines'), `got: ${line}`);
    assert.ok(
      !line.includes('Diagnostic output only'),
      `output activity must not leak diagnostic_only render, got: ${line}`,
    );
  });

  it('renders silent as yellow "Silent for Xs"', () => {
    const now = Date.now();
    const line = formatDispatchActivityLine({
      activity_type: 'silent',
      silent_since: new Date(now - 30000).toISOString(),
      last_activity_at: new Date(now - 30000).toISOString(),
      output_lines: 3,
      stderr_lines: 0,
    });
    assert.ok(line.includes('Silent for'), `got: ${line}`);
  });
});
