import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { describe, it } from 'vitest';
import {
  buildGovernanceReport,
  formatGovernanceReportHtml,
  formatGovernanceReportMarkdown,
  formatGovernanceReportText,
} from '../src/lib/report.js';
import {
  buildRecoveryClassificationReport,
  classifyRecoveryEvent,
} from '../src/lib/recovery-classification.js';

function jsonFileEntry(data) {
  const raw = JSON.stringify(data, null, 2) + '\n';
  const buf = Buffer.from(raw, 'utf8');
  return {
    format: 'json',
    data,
    bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
    content_base64: buf.toString('base64'),
  };
}

function jsonlFileEntry(dataArray) {
  const raw = dataArray.length > 0
    ? dataArray.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
    : '';
  const buf = Buffer.from(raw, 'utf8');
  return {
    format: 'jsonl',
    data: dataArray,
    bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
    content_base64: buf.toString('base64'),
  };
}

function event(event_type, payload = {}, timestamp = '2026-05-02T10:00:00.000Z') {
  return {
    event_id: `evt_${event_type}`,
    event_type,
    timestamp,
    run_id: 'run_recovery_001',
    phase: 'implementation',
    status: 'active',
    turn: null,
    intent_id: null,
    payload,
  };
}

function buildRunExport(events) {
  const config = {
    schema_version: '1.0',
    template: 'governed',
    project: { id: 'recovery-test', name: 'Recovery Test', default_branch: 'main' },
    roles: { dev: { title: 'Dev', mandate: 'Build.', write_authority: 'authoritative', runtime: 'local' } },
    runtimes: { local: { type: 'local_cli', command: ['echo', 'ok'], prompt_transport: 'argv' } },
    routing: { implementation: { entry_role: 'dev', allowed_next_roles: ['qa'] } },
    gates: {},
    hooks: {},
  };
  const state = {
    schema_version: '1.1',
    project_id: 'recovery-test',
    run_id: 'run_recovery_001',
    status: 'active',
    phase: 'implementation',
    active_turns: {},
    retained_turns: {},
    turn_sequence: 0,
  };
  return {
    schema_version: '0.2',
    export_kind: 'agentxchain_run_export',
    exported_at: '2026-05-02T10:00:00.000Z',
    project_root: '/tmp/recovery-test',
    project: {
      id: 'recovery-test',
      name: 'Recovery Test',
      template: 'governed',
      schema_version: '1.0',
      protocol_mode: 'governed',
    },
    summary: {
      run_id: 'run_recovery_001',
      status: 'active',
      phase: 'implementation',
      active_turn_ids: [],
      retained_turn_ids: [],
      history_entries: 0,
      decision_entries: 0,
      hook_audit_entries: 0,
      notification_audit_entries: 0,
      dispatch_artifact_files: 0,
      staging_artifact_files: 0,
      intake_present: false,
      coordinator_present: false,
    },
    state,
    config,
    files: {
      'agentxchain.json': jsonFileEntry(config),
      '.agentxchain/state.json': jsonFileEntry(state),
      '.agentxchain/events.jsonl': jsonlFileEntry(events),
    },
  };
}

describe('recovery classification taxonomy', () => {
  it('classifies each supported recovery event type', () => {
    const cases = [
      ['auto_retried_ghost', { domain: 'ghost', severity: 'medium', outcome: 'recovered', mechanism: 'auto_retry' }],
      ['ghost_retry_exhausted', { domain: 'ghost', severity: 'high', outcome: 'exhausted', mechanism: 'auto_retry' }],
      ['auto_retried_productive_timeout', { domain: 'ghost', severity: 'medium', outcome: 'recovered', mechanism: 'auto_retry' }],
      ['productive_timeout_retry_exhausted', { domain: 'ghost', severity: 'high', outcome: 'exhausted', mechanism: 'auto_retry' }],
      ['budget_exceeded_warn', { domain: 'budget', severity: 'medium', outcome: 'pending', mechanism: 'config_change' }],
      ['retained_claude_auth_escalation_reclassified', { domain: 'credential', severity: 'medium', outcome: 'pending', mechanism: 'env_refresh' }],
      ['continuous_paused_active_run_recovered', { domain: 'crash', severity: 'medium', outcome: 'recovered', mechanism: 'loop_guard' }],
      ['session_failed_recovered_active_run', { domain: 'crash', severity: 'medium', outcome: 'recovered', mechanism: 'loop_guard' }],
    ];

    for (const [eventType, expected] of cases) {
      assert.deepEqual(classifyRecoveryEvent(event(eventType)), expected);
    }
  });

  it('returns null for non-recovery events', () => {
    assert.equal(classifyRecoveryEvent(event('turn_dispatched')), null);
  });

  it('escalates severity for same-signature ghost exhaustion and exhausted budgets', () => {
    assert.equal(
      classifyRecoveryEvent(event('ghost_retry_exhausted', { exhaustion_reason: 'same_signature_repeat' })).severity,
      'critical',
    );
    assert.equal(
      classifyRecoveryEvent(event('budget_exceeded_warn', { remaining_usd: 0 })).severity,
      'high',
    );
  });

  it('aggregates mixed recovery events and derives health scores', () => {
    const report = buildRecoveryClassificationReport([
      event('auto_retried_ghost', {}, '2026-05-02T10:01:00.000Z'),
      event('budget_exceeded_warn', { remaining_usd: 4 }, '2026-05-02T10:02:00.000Z'),
      event('productive_timeout_retry_exhausted', {}, '2026-05-02T10:03:00.000Z'),
      event('turn_accepted', {}, '2026-05-02T10:04:00.000Z'),
    ]);

    assert.equal(report.total_recovery_events, 3);
    assert.equal(report.by_domain.ghost.total, 2);
    assert.equal(report.by_domain.budget.pending, 1);
    assert.equal(report.by_outcome.recovered, 1);
    assert.equal(report.by_outcome.exhausted, 1);
    assert.equal(report.by_outcome.pending, 1);
    assert.equal(report.health_score, 'degraded');
  });

  it('returns healthy for zero or non-exhausted recovery events and critical for systemic exhaustion', () => {
    assert.equal(buildRecoveryClassificationReport([]).health_score, 'healthy');
    assert.equal(buildRecoveryClassificationReport([event('auto_retried_ghost')]).health_score, 'healthy');
    assert.equal(
      buildRecoveryClassificationReport([
        event('ghost_retry_exhausted', { exhaustion_reason: 'same_signature_repeat' }),
      ]).health_score,
      'critical',
    );
  });
});

describe('governance report recovery classification', () => {
  it('adds recovery classification to run subject and text, markdown, and html reports', () => {
    const result = buildGovernanceReport(buildRunExport([
      event('auto_retried_ghost', { recovery_class: 'claude_node_runtime_recovered' }, '2026-05-02T10:01:00.000Z'),
      event('ghost_retry_exhausted', { exhaustion_reason: 'retry_budget_exhausted' }, '2026-05-02T10:02:00.000Z'),
      event('budget_exceeded_warn', { remaining_usd: 3, warning: 'Budget warning' }, '2026-05-02T10:03:00.000Z'),
    ]), { input: 'test-export' });

    assert.equal(result.ok, true);
    const classification = result.report.subject.run.recovery_classification;
    assert.equal(classification.total_recovery_events, 3);
    assert.equal(classification.by_domain.ghost.exhausted, 1);
    assert.equal(classification.by_domain.budget.pending, 1);

    const text = formatGovernanceReportText(result.report);
    assert.match(text, /Recovery Classification:/);
    assert.match(text, /Health: degraded/);
    assert.match(text, /Ghost: 2 \(1 recovered, 1 exhausted, 0 manual, 0 pending\)/);

    const markdown = formatGovernanceReportMarkdown(result.report);
    assert.match(markdown, /## Recovery Classification/);
    assert.match(markdown, /\| Ghost \| 2 \| 1 \| 1 \| 0 \| 0 \|/);

    const html = formatGovernanceReportHtml(result.report);
    assert.match(html, /Recovery Classification/);
    assert.match(html, /claude_node_runtime_recovered/);
  });

  it('omits recovery classification when the run has no recovery events', () => {
    const result = buildGovernanceReport(buildRunExport([event('turn_dispatched')]), { input: 'test-export' });
    assert.equal(result.ok, true);
    assert.equal(result.report.subject.run.recovery_classification, null);
    assert.doesNotMatch(formatGovernanceReportText(result.report), /Recovery Classification:/);
  });
});
