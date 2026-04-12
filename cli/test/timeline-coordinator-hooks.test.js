/**
 * Timeline coordinator hook evidence parity tests.
 *
 * Proves that the Timeline turn-detail panel renders coordinator hook audit
 * and annotation data when present, using separate titled sections when both
 * repo-local and coordinator sources exist.
 *
 * See: TIMELINE_COORDINATOR_HOOKS_SPEC.md
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { render as renderTimeline } from '../dashboard/components/timeline.js';

const BASE_STATE = {
  run_id: 'run_coord_001',
  status: 'running',
  phase: 'implementation',
  active_turns: {},
};

const HISTORY_ENTRY = {
  turn_id: 'turn_001',
  role: 'dev',
  summary: 'Implemented feature X',
  accepted_at: '2026-04-12T10:00:00Z',
};

const REPO_AUDIT = [
  { turn_id: 'turn_001', hook_phase: 'after_acceptance', hook_name: 'lint-check', verdict: 'pass' },
];

const REPO_ANNOTATIONS = [
  { turn_id: 'turn_001', hook_name: 'coverage', annotations: [{ key: 'coverage', value: '92%' }] },
];

const COORD_AUDIT = [
  { turn_id: 'turn_001', hook_phase: 'before_gate', hook_name: 'coord-policy', verdict: 'pass' },
];

const COORD_ANNOTATIONS = [
  { turn_id: 'turn_001', hook_name: 'coord-meta', annotation: 'Coordinator checkpoint recorded' },
];

describe('Timeline coordinator hook evidence', () => {
  it('renders coordinator audit section when coordinator audit data exists', () => {
    const html = renderTimeline({
      state: BASE_STATE,
      history: [HISTORY_ENTRY],
      coordinatorAudit: COORD_AUDIT,
      coordinatorAnnotations: null,
    });
    assert.ok(html.includes('coord-policy'), 'must show coordinator hook name');
    assert.ok(html.includes('before_gate'), 'must show coordinator hook phase');
    assert.ok(html.includes('Hook Audit'), 'must show audit section');
  });

  it('renders coordinator annotations section when coordinator annotation data exists', () => {
    const html = renderTimeline({
      state: BASE_STATE,
      history: [HISTORY_ENTRY],
      coordinatorAudit: null,
      coordinatorAnnotations: COORD_ANNOTATIONS,
    });
    assert.ok(html.includes('coord-meta'), 'must show coordinator annotation hook name');
    assert.ok(html.includes('Coordinator checkpoint recorded'), 'must show coordinator annotation text');
  });

  it('renders separate titled sections when both repo and coordinator audit exist', () => {
    const html = renderTimeline({
      state: BASE_STATE,
      history: [HISTORY_ENTRY],
      audit: REPO_AUDIT,
      annotations: REPO_ANNOTATIONS,
      coordinatorAudit: COORD_AUDIT,
      coordinatorAnnotations: COORD_ANNOTATIONS,
    });
    assert.ok(html.includes('Repo Hook Audit'), 'must show repo-prefixed audit title');
    assert.ok(html.includes('Coordinator Hook Audit'), 'must show coordinator-prefixed audit title');
    assert.ok(html.includes('Repo Annotations'), 'must show repo-prefixed annotations title');
    assert.ok(html.includes('Coordinator Annotations'), 'must show coordinator-prefixed annotations title');
  });

  it('renders without coordinator sections when coordinator data is null', () => {
    const html = renderTimeline({
      state: BASE_STATE,
      history: [HISTORY_ENTRY],
      audit: REPO_AUDIT,
      annotations: REPO_ANNOTATIONS,
      coordinatorAudit: null,
      coordinatorAnnotations: null,
    });
    assert.ok(html.includes('Hook Audit'), 'must show unprefixed audit title');
    assert.ok(!html.includes('Coordinator Hook Audit'), 'must not show coordinator audit section');
    assert.ok(!html.includes('Coordinator Annotations'), 'must not show coordinator annotations section');
    assert.ok(html.includes('lint-check'), 'must show repo-local audit data');
    assert.ok(html.includes('coverage'), 'must show repo-local annotation data');
  });

  it('shows "No hook evidence" when no data exists for any source', () => {
    const html = renderTimeline({
      state: BASE_STATE,
      history: [HISTORY_ENTRY],
      audit: [],
      annotations: [],
      coordinatorAudit: [],
      coordinatorAnnotations: [],
    });
    assert.ok(html.includes('No hook evidence'), 'must show no-evidence placeholder');
  });

  it('filters coordinator audit by turn_id', () => {
    const otherTurnAudit = [
      { turn_id: 'turn_999', hook_phase: 'after_acceptance', hook_name: 'other-hook', verdict: 'fail' },
    ];
    const html = renderTimeline({
      state: BASE_STATE,
      history: [HISTORY_ENTRY],
      coordinatorAudit: [...COORD_AUDIT, ...otherTurnAudit],
      coordinatorAnnotations: null,
    });
    assert.ok(html.includes('coord-policy'), 'must show matching turn coordinator audit');
    assert.ok(!html.includes('other-hook'), 'must not show non-matching turn coordinator audit');
  });
});
