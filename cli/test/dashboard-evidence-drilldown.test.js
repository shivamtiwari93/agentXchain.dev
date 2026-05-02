/**
 * Dashboard evidence drill-down tests — V2.1-F3
 *
 * AT-V21-007: turn detail renders hook annotations and audit context for a turn
 * AT-V21-008: decision and hook-audit views honor phase/verdict/date filters
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { render as renderTimeline } from '../dashboard/components/timeline.js';
import { filterEntries, render as renderLedger } from '../dashboard/components/ledger.js';
import { filterAudit, render as renderHooks } from '../dashboard/components/hooks.js';

// ── AT-V21-007: Turn detail panels ──────────────────────────────────────

describe('AT-V21-007: Turn detail panels with hook evidence', () => {
  const annotations = [
    { turn_id: 'turn_001', hook_name: 'policy', annotations: [{ key: 'schema', value: 'normalized to v1.1' }] },
    { turn_id: 'turn_001', hook_name: 'sast', annotations: [{ key: 'result', value: 'clean' }] },
    { turn_id: 'turn_002', hook_name: 'lint', annotations: [{ key: 'status', value: 'passed' }] },
  ];

  const audit = [
    { turn_id: 'turn_001', hook_phase: 'before_validation', hook_name: 'lint', verdict: 'allow' },
    { turn_id: 'turn_001', hook_phase: 'after_validation', hook_name: 'policy', verdict: 'warn' },
    { turn_id: 'turn_002', hook_phase: 'before_acceptance', hook_name: 'sast', verdict: 'block' },
  ];

  const history = [
    { turn_id: 'turn_001', role: 'pm', summary: 'Defined scope' },
    { turn_id: 'turn_002', role: 'dev', summary: 'Implemented feature' },
  ];

  const state = { run_id: 'run_001', status: 'running', phase: 'development', active_turns: {} };

  it('renders turn cards with data-turn-expand attribute', () => {
    const html = renderTimeline({ state, history, annotations, audit });
    assert.ok(html.includes('data-turn-expand="turn_001"'));
    assert.ok(html.includes('data-turn-expand="turn_002"'));
  });

  it('renders turn detail panel with annotations filtered by turn_id', () => {
    const html = renderTimeline({ state, history, annotations, audit });
    // turn_001 should have policy and sast annotations
    assert.ok(html.includes('policy: schema = normalized to v1.1'));
    assert.ok(html.includes('sast: result = clean'));
  });

  it('renders turn detail panel with audit entries filtered by turn_id', () => {
    const html = renderTimeline({ state, history, annotations, audit });
    // turn_001 panel should show its audit (before_validation + after_validation)
    assert.ok(html.includes('before_validation'));
    assert.ok(html.includes('after_validation'));
  });

  it('shows audit count per turn in detail panel', () => {
    const html = renderTimeline({ state, history, annotations, audit });
    assert.ok(html.includes('Hook Audit Log (2)'));
    assert.ok(html.includes('Hook Audit Log (1)'));
  });

  it('shows annotation count per turn in detail panel', () => {
    const html = renderTimeline({ state, history, annotations, audit });
    assert.ok(html.includes('Hook Annotations (2)'));
    assert.ok(html.includes('Hook Annotations (1)'));
  });

  it('renders detail panel with no evidence message when no hooks for a turn', () => {
    const html = renderTimeline({
      state,
      history: [{ turn_id: 'turn_999', role: 'pm', summary: 'No hooks' }],
      annotations: [],
      audit: [],
    });
    assert.ok(html.includes('No hook evidence for this turn'));
  });

  it('works when annotations and audit are omitted (backwards compat)', () => {
    const html = renderTimeline({ state, history });
    assert.ok(html.includes('turn_001'));
    assert.ok(html.includes('No hook evidence for this turn'));
  });
});

// ── AT-V21-008: Decision and hook-audit filters ─────────────────────────

describe('AT-V21-008: Decision ledger filters (phase, date range)', () => {
  const ledger = [
    { turn: 1, agent: 'pm', decision: 'Scope auth', phase: 'planning', timestamp: '2026-04-01T10:00:00Z' },
    { turn: 2, agent: 'dev', decision: 'Implement JWT', phase: 'development', timestamp: '2026-04-02T10:00:00Z' },
    { turn: 3, agent: 'qa', decision: 'Approve coverage', phase: 'development', timestamp: '2026-04-03T10:00:00Z' },
    { turn: 4, agent: 'pm', decision: 'Ship approval', phase: 'delivery', timestamp: '2026-04-04T10:00:00Z' },
  ];

  it('filterEntries filters by phase', () => {
    const result = filterEntries(ledger, { phase: 'development' });
    assert.equal(result.length, 2);
    assert.ok(result.every((e) => e.phase === 'development'));
  });

  it('filterEntries filters by dateFrom', () => {
    const result = filterEntries(ledger, { dateFrom: '2026-04-03' });
    assert.equal(result.length, 2);
    assert.ok(result.every((e) => e.timestamp >= '2026-04-03'));
  });

  it('filterEntries filters by dateTo', () => {
    const result = filterEntries(ledger, { dateTo: '2026-04-02' });
    // entries on or before 2026-04-02
    const filtered = result.filter((e) => e.timestamp <= '2026-04-02');
    assert.equal(result.length, filtered.length);
  });

  it('filterEntries combines phase + dateFrom + dateTo', () => {
    const result = filterEntries(ledger, {
      phase: 'development',
      dateFrom: '2026-04-02',
      dateTo: '2026-04-04',
    });
    assert.equal(result.length, 2);
  });

  it('filterEntries combines agent + phase', () => {
    const result = filterEntries(ledger, { agent: 'pm', phase: 'planning' });
    assert.equal(result.length, 1);
    assert.equal(result[0].turn, 1);
  });

  it('render includes phase filter dropdown', () => {
    const html = renderLedger({ ledger });
    assert.ok(html.includes('data-view-control="ledger-phase"'));
    assert.ok(html.includes('All phases'));
  });

  it('render includes date range inputs', () => {
    const html = renderLedger({ ledger });
    assert.ok(html.includes('data-view-control="ledger-date-from"'));
    assert.ok(html.includes('data-view-control="ledger-date-to"'));
  });

  it('render includes timestamp column', () => {
    const html = renderLedger({ ledger });
    assert.ok(html.includes('<th>Timestamp</th>'));
    assert.ok(html.includes('2026-04-01T10:00:00Z'));
  });

  it('render shows objection badge for entries with objections', () => {
    const ledgerWithObjections = [
      { turn: 1, agent: 'pm', decision: 'Scope', objections: [{ statement: 'Risk' }] },
      { turn: 2, agent: 'dev', decision: 'Build' },
    ];
    const html = renderLedger({ ledger: ledgerWithObjections });
    assert.ok(html.includes('objection-badge'));
    // Only one badge for the entry with objections
    const badgeCount = (html.match(/objection-badge/g) || []).length;
    assert.equal(badgeCount, 1);
  });

  it('render preserves selected phase in dropdown after rerender', () => {
    const html = renderLedger({ ledger, filter: { phase: 'development' } });
    assert.ok(html.includes('value="development" selected'));
  });
});

describe('AT-V21-008: Hook audit filters (phase, verdict, hook name)', () => {
  const audit = [
    { timestamp: '2026-04-02T12:00:00Z', hook_phase: 'before_validation', hook_name: 'lint', verdict: 'allow', orchestrator_action: 'continued', duration_ms: 120 },
    { timestamp: '2026-04-02T12:00:01Z', hook_phase: 'before_validation', hook_name: 'schema-check', verdict: 'allow', orchestrator_action: 'continued', duration_ms: 60 },
    { timestamp: '2026-04-02T12:00:02Z', hook_phase: 'after_validation', hook_name: 'policy', verdict: 'warn', orchestrator_action: 'warned', duration_ms: 25 },
    { timestamp: '2026-04-02T12:00:03Z', hook_phase: 'before_acceptance', hook_name: 'sast', verdict: 'allow', orchestrator_action: 'continued', duration_ms: 410 },
    { timestamp: '2026-04-02T12:00:04Z', hook_phase: 'before_gate', hook_name: 'release-guard', verdict: 'block', orchestrator_action: 'blocked', duration_ms: 95 },
  ];

  it('filterAudit returns all entries with no filters', () => {
    const result = filterAudit(audit, {});
    assert.equal(result.length, 5);
  });

  it('filterAudit filters by phase', () => {
    const result = filterAudit(audit, { phase: 'before_validation' });
    assert.equal(result.length, 2);
    assert.ok(result.every((e) => e.hook_phase === 'before_validation'));
  });

  it('filterAudit filters by verdict', () => {
    const result = filterAudit(audit, { verdict: 'block' });
    assert.equal(result.length, 1);
    assert.equal(result[0].hook_name, 'release-guard');
  });

  it('filterAudit filters by hookName', () => {
    const result = filterAudit(audit, { hookName: 'lint' });
    assert.equal(result.length, 1);
    assert.equal(result[0].hook_name, 'lint');
  });

  it('filterAudit combines phase + verdict', () => {
    const result = filterAudit(audit, { phase: 'before_validation', verdict: 'allow' });
    assert.equal(result.length, 2);
  });

  it('filterAudit handles null input', () => {
    const result = filterAudit(null, { phase: 'before_validation' });
    assert.deepEqual(result, []);
  });

  it('filterAudit is a pure function', () => {
    const a = filterAudit(audit, { verdict: 'warn' });
    const b = filterAudit(audit, { verdict: 'warn' });
    assert.deepStrictEqual(a, b);
  });

  it('render includes filter bar with phase, verdict, hookname dropdowns', () => {
    const html = renderHooks({ audit, annotations: [] });
    assert.ok(html.includes('data-view-control="hooks-phase"'));
    assert.ok(html.includes('data-view-control="hooks-verdict"'));
    assert.ok(html.includes('data-view-control="hooks-hookname"'));
  });

  it('render shows filtered count', () => {
    const html = renderHooks({ audit, annotations: [], filter: { verdict: 'block' } });
    assert.ok(html.includes('1 of 5'));
  });

  it('render shows all when no filter applied', () => {
    const html = renderHooks({ audit, annotations: [] });
    assert.ok(html.includes('5 of 5'));
  });

  it('render preserves selected verdict in dropdown after rerender', () => {
    const html = renderHooks({ audit, annotations: [], filter: { verdict: 'warn' } });
    assert.ok(html.includes('value="warn" selected'));
  });
});
