import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';

import {
  buildGovernanceReport,
  formatGovernanceReportText,
  formatGovernanceReportMarkdown,
  formatGovernanceReportHtml,
  boundedSlice,
  MAX_REPORT_SECTION_ITEMS,
} from '../../src/lib/report.js';

// BUG-84: Governance report generation crashes with "Invalid string length" on large sessions.
// Root cause: unbounded array iteration in all three formatters + JSON.stringify of full export.
// Fix: per-section item limits via boundedSlice(), array-push HTML patterns, compact export JSON.

describe('BUG-84: bounded report section rendering', () => {
  it('boundedSlice returns full array when under limit', () => {
    const arr = [1, 2, 3];
    const { items, omitted } = boundedSlice(arr, 5);
    assert.deepStrictEqual(items, [1, 2, 3]);
    assert.strictEqual(omitted, 0);
  });

  it('boundedSlice truncates and reports omitted count', () => {
    const arr = Array.from({ length: 1000 }, (_, i) => i);
    const { items, omitted } = boundedSlice(arr, 200);
    assert.strictEqual(items.length, 200);
    assert.strictEqual(omitted, 800);
    assert.deepStrictEqual(items, arr.slice(0, 200));
  });

  it('boundedSlice handles non-array input', () => {
    const { items, omitted } = boundedSlice(null);
    assert.deepStrictEqual(items, []);
    assert.strictEqual(omitted, 0);
  });

  it('MAX_REPORT_SECTION_ITEMS is a reasonable positive integer', () => {
    assert.strictEqual(typeof MAX_REPORT_SECTION_ITEMS, 'number');
    assert.ok(MAX_REPORT_SECTION_ITEMS >= 100, 'section limit should be at least 100');
    assert.ok(MAX_REPORT_SECTION_ITEMS <= 10000, 'section limit should be at most 10000');
  });
});

describe('BUG-84: report formatters handle large sections without crash', () => {
  function buildLargeRunReport(turnCount, eventCount) {
    const turns = Array.from({ length: turnCount }, (_, i) => ({
      turn_id: `turn_${String(i).padStart(4, '0')}`,
      role: i % 3 === 0 ? 'pm' : i % 3 === 1 ? 'dev' : 'qa',
      status: 'accepted',
      summary: `Turn ${i} summary — completed milestone work for iteration ${i}`,
      phase: i < turnCount / 2 ? 'planning' : 'implementation',
      phase_transition: null,
      files_changed_count: i % 5,
      decisions: [],
      objections: [],
      cost_usd: 0.05,
      input_tokens: 1000,
      output_tokens: 500,
      started_at: `2026-04-26T00:${String(i % 60).padStart(2, '0')}:00Z`,
      duration_ms: 5000,
      accepted_at: `2026-04-26T00:${String(i % 60).padStart(2, '0')}:05Z`,
    }));

    const governance_events = Array.from({ length: eventCount }, (_, i) => ({
      type: i % 2 === 0 ? 'policy_escalation' : 'operator_escalated',
      timestamp: `2026-04-26T00:${String(i % 60).padStart(2, '0')}:00Z`,
      turn_id: `turn_${String(i % turnCount).padStart(4, '0')}`,
      role: 'dev',
      phase: 'implementation',
      violations: i % 2 === 0 ? [{ policy_id: 'p1', rule: 'r1', message: `violation ${i}` }] : undefined,
      reason: i % 2 === 1 ? `escalation reason ${i}` : undefined,
      blocked_on: i % 2 === 1 ? `blocker_${i}` : undefined,
    }));

    const decisions = Array.from({ length: Math.min(eventCount, 200) }, (_, i) => ({
      id: `DEC-${i}`,
      turn_id: `turn_${String(i % turnCount).padStart(4, '0')}`,
      role: 'pm',
      phase: 'planning',
      statement: `Decision ${i}: chose approach A over approach B for subsystem ${i}`,
    }));

    const gate_failures = Array.from({ length: Math.min(eventCount, 100) }, (_, i) => ({
      gate_type: 'phase_transition',
      gate_id: `gate_${i}`,
      phase: 'planning',
      from_phase: 'planning',
      to_phase: 'implementation',
      failed_at: `2026-04-26T00:${String(i % 60).padStart(2, '0')}:00Z`,
      reasons: [`gate file not modified: file_${i}.md`],
    }));

    return {
      report_version: '0.1',
      overall: 'pass',
      generated_at: '2026-04-26T12:00:00Z',
      input: '/test/export.json',
      export_kind: 'agentxchain_run_export',
      verification: { errors: [], warnings: [] },
      subject: {
        kind: 'governed_run',
        project: {
          id: 'test-project',
          name: 'Test Project',
          goal: 'Test goal',
          template: 'generic',
          protocol_mode: 'governed',
          schema_version: '1.0',
        },
        run: {
          run_id: 'run_test_large',
          status: 'completed',
          phase: 'launch',
          blocked_on: null,
          blocked_reason: null,
          provenance: { trigger: 'intake', created_by: 'test' },
          inherited_context: null,
          active_turn_count: 0,
          retained_turn_count: 0,
          active_turn_ids: [],
          retained_turn_ids: [],
          active_roles: [],
          budget_status: null,
          cost_summary: {
            total_usd: turnCount * 0.05,
            turn_count: turnCount,
            costed_turn_count: turnCount,
            total_input_tokens: turnCount * 1000,
            total_output_tokens: turnCount * 500,
            by_role: [
              { role: 'dev', usd: turnCount * 0.02, turns: Math.floor(turnCount / 3), input_tokens: 500, output_tokens: 250 },
            ],
            by_phase: [
              { phase: 'planning', usd: turnCount * 0.025, turns: Math.floor(turnCount / 2) },
            ],
          },
          dashboard_session: null,
          recent_event_summary: null,
          created_at: '2026-04-26T00:00:00Z',
          completed_at: '2026-04-26T12:00:00Z',
          duration_seconds: 43200,
          turns,
          decisions,
          approval_policy_events: [],
          governance_events,
          gate_failures,
          gate_actions: [],
          timeout_events: [],
          delegation_summary: null,
          hook_summary: null,
          gate_summary: [{ gate_id: 'planning_signoff', status: 'passed' }],
          intake_links: [],
          recovery_summary: null,
          next_actions: [],
          continuity: null,
          workflow_kit_artifacts: [],
          repo_decisions: null,
        },
        artifacts: {
          history_entries: turnCount,
          decision_entries: decisions.length,
          hook_audit_entries: 0,
          notification_audit_entries: 0,
          dispatch_artifact_files: turnCount,
          staging_artifact_files: turnCount,
          intake_present: false,
          coordinator_present: false,
        },
      },
    };
  }

  it('text formatter handles 600+ turns with truncation notice', () => {
    const report = buildLargeRunReport(600, 700);
    const text = formatGovernanceReportText(report);
    assert.ok(typeof text === 'string', 'output should be a string');
    assert.ok(text.length > 0, 'output should not be empty');
    assert.ok(text.includes('more turns omitted'), 'should include turns truncation notice');
    assert.ok(text.includes('more governance events omitted'), 'should include governance events truncation notice');
  });

  it('markdown formatter handles 600+ turns with truncation notice', () => {
    const report = buildLargeRunReport(600, 700);
    const md = formatGovernanceReportMarkdown(report);
    assert.ok(typeof md === 'string', 'output should be a string');
    assert.ok(md.length > 0, 'output should not be empty');
    assert.ok(md.includes('more turns omitted'), 'should include turns truncation notice');
    assert.ok(md.includes('more governance events omitted'), 'should include governance events truncation notice');
  });

  it('HTML formatter handles 600+ turns with truncation notice', () => {
    const report = buildLargeRunReport(600, 700);
    const html = formatGovernanceReportHtml(report);
    assert.ok(typeof html === 'string', 'output should be a string');
    assert.ok(html.includes('<!DOCTYPE html>'), 'should be valid HTML');
    assert.ok(html.includes('more turns omitted'), 'should include turns truncation notice');
    assert.ok(html.includes('more governance events omitted'), 'should include governance events truncation notice');
  });

  it('formatters do NOT truncate when sections are under the limit', () => {
    const report = buildLargeRunReport(10, 20);
    const text = formatGovernanceReportText(report);
    assert.ok(!text.includes('omitted'), 'should NOT include truncation notice for small sections');
    const md = formatGovernanceReportMarkdown(report);
    assert.ok(!md.includes('omitted'), 'should NOT include truncation notice for small sections');
    const html = formatGovernanceReportHtml(report);
    assert.ok(!html.includes('omitted'), 'should NOT include truncation notice for small sections');
  });

  it('HTML formatter uses array-join pattern (no string overflow from +=)', () => {
    // Verify the HTML output doesn't contain artifacts of broken string concatenation.
    // The real proof is that the formatter completes without RangeError.
    const report = buildLargeRunReport(MAX_REPORT_SECTION_ITEMS + 100, MAX_REPORT_SECTION_ITEMS + 200);
    const html = formatGovernanceReportHtml(report);
    assert.ok(html.includes('</html>'), 'HTML output should be complete');
    assert.ok(html.includes('Turn Timeline'), 'should include Turn Timeline section');
    assert.ok(html.includes('Governance Events'), 'should include Governance Events section');
  });
});
