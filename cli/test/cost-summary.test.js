import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computeCostSummary,
  formatGovernanceReportText,
  formatGovernanceReportMarkdown,
} from '../src/lib/report.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

describe('computeCostSummary', () => {
  // AT-COST-SUMMARY-001
  it('returns null when there are zero turns', () => {
    assert.equal(computeCostSummary([]), null);
    assert.equal(computeCostSummary(null), null);
    assert.equal(computeCostSummary(undefined), null);
  });

  // AT-COST-SUMMARY-002
  it('computes total_usd and costed_turn_count correctly', () => {
    const turns = [
      { role: 'dev', phase: 'impl', cost_usd: 1.50, input_tokens: null, output_tokens: null },
      { role: 'dev', phase: 'impl', cost_usd: 2.50, input_tokens: null, output_tokens: null },
      { role: 'qa', phase: 'qa', cost_usd: null, input_tokens: null, output_tokens: null },
    ];
    const cs = computeCostSummary(turns);
    assert.equal(cs.total_usd, 4.00);
    assert.equal(cs.costed_turn_count, 2);
    assert.equal(cs.turn_count, 3);
  });

  // AT-COST-SUMMARY-003
  it('breaks down cost by role correctly', () => {
    const turns = [
      { role: 'dev', phase: 'impl', cost_usd: 5.00, input_tokens: 10000, output_tokens: 3000 },
      { role: 'qa', phase: 'qa', cost_usd: 2.00, input_tokens: 5000, output_tokens: 1000 },
      { role: 'dev', phase: 'qa', cost_usd: 3.00, input_tokens: 8000, output_tokens: 2000 },
    ];
    const cs = computeCostSummary(turns);
    assert.equal(cs.by_role.length, 2);
    const dev = cs.by_role.find((r) => r.role === 'dev');
    const qa = cs.by_role.find((r) => r.role === 'qa');
    assert.equal(dev.usd, 8.00);
    assert.equal(dev.turns, 2);
    assert.equal(dev.input_tokens, 18000);
    assert.equal(dev.output_tokens, 5000);
    assert.equal(qa.usd, 2.00);
    assert.equal(qa.turns, 1);
  });

  // AT-COST-SUMMARY-004
  it('breaks down cost by phase correctly', () => {
    const turns = [
      { role: 'dev', phase: 'planning', cost_usd: 1.00 },
      { role: 'dev', phase: 'impl', cost_usd: 4.00 },
      { role: 'qa', phase: 'impl', cost_usd: 2.00 },
    ];
    const cs = computeCostSummary(turns);
    assert.equal(cs.by_phase.length, 2);
    const impl = cs.by_phase.find((p) => p.phase === 'impl');
    const planning = cs.by_phase.find((p) => p.phase === 'planning');
    assert.equal(impl.usd, 6.00);
    assert.equal(impl.turns, 2);
    assert.equal(planning.usd, 1.00);
    assert.equal(planning.turns, 1);
  });

  // AT-COST-SUMMARY-005
  it('returns null token totals when no turns report tokens', () => {
    const turns = [
      { role: 'dev', phase: 'impl', cost_usd: 1.00 },
    ];
    const cs = computeCostSummary(turns);
    assert.equal(cs.total_input_tokens, null);
    assert.equal(cs.total_output_tokens, null);
  });

  it('sums tokens correctly when some turns have them', () => {
    const turns = [
      { role: 'dev', phase: 'impl', cost_usd: 1.00, input_tokens: 5000, output_tokens: 1000 },
      { role: 'dev', phase: 'impl', cost_usd: 2.00, input_tokens: null, output_tokens: null },
      { role: 'qa', phase: 'qa', cost_usd: 0.50, input_tokens: 3000, output_tokens: 800 },
    ];
    const cs = computeCostSummary(turns);
    assert.equal(cs.total_input_tokens, 8000);
    assert.equal(cs.total_output_tokens, 1800);
  });

  it('sorts by_role and by_phase alphabetically', () => {
    const turns = [
      { role: 'qa', phase: 'qa', cost_usd: 1.00 },
      { role: 'dev', phase: 'impl', cost_usd: 2.00 },
      { role: 'architect', phase: 'planning', cost_usd: 0.50 },
    ];
    const cs = computeCostSummary(turns);
    assert.deepEqual(cs.by_role.map((r) => r.role), ['architect', 'dev', 'qa']);
    assert.deepEqual(cs.by_phase.map((p) => p.phase), ['impl', 'planning', 'qa']);
  });
});

describe('cost summary in report formatters', () => {
  function makeReport(costSummary) {
    return {
      report_version: '0.1',
      overall: 'pass',
      generated_at: '2026-04-12T00:00:00Z',
      input: '/tmp/test',
      export_kind: 'agentxchain_run_export',
      verification: { ok: true },
      subject: {
        kind: 'governed_run',
        project: { id: 'p1', name: 'Test', goal: null, template: 'generic', protocol_mode: 'governed', schema_version: '1.0' },
        run: {
          run_id: 'run_001',
          status: 'completed',
          phase: 'qa',
          blocked_on: null,
          blocked_reason: null,
          provenance: null,
          inherited_context: null,
          active_turn_count: 0,
          retained_turn_count: 0,
          active_turn_ids: [],
          retained_turn_ids: [],
          active_roles: [],
          budget_status: null,
          cost_summary: costSummary,
          created_at: null,
          completed_at: null,
          duration_seconds: null,
          turns: [],
          decisions: [],
          approval_policy_events: [],
          governance_events: [],
          gate_failures: [],
          timeout_events: [],
          hook_summary: null,
          gate_summary: [],
          intake_links: [],
          recovery_summary: null,
          continuity: null,
          workflow_kit_artifacts: null,
        },
        artifacts: {
          history_entries: 0,
          decision_entries: 0,
          hook_audit_entries: 0,
          notification_audit_entries: 0,
          dispatch_artifact_files: 0,
          staging_artifact_files: 0,
          intake_present: false,
          coordinator_present: false,
        },
      },
    };
  }

  // AT-COST-SUMMARY-006
  it('text format includes Cost Summary section with role and phase breakdowns', () => {
    const cs = {
      total_usd: 10.00,
      total_input_tokens: 50000,
      total_output_tokens: 15000,
      turn_count: 3,
      costed_turn_count: 3,
      by_role: [
        { role: 'dev', usd: 7.00, turns: 2, input_tokens: 35000, output_tokens: 10000 },
        { role: 'qa', usd: 3.00, turns: 1, input_tokens: 15000, output_tokens: 5000 },
      ],
      by_phase: [
        { phase: 'impl', usd: 7.00, turns: 2 },
        { phase: 'qa', usd: 3.00, turns: 1 },
      ],
    };
    const text = formatGovernanceReportText(makeReport(cs));
    assert.match(text, /Cost Summary:/);
    assert.match(text, /Total: \$10\.00 across 3 turns/);
    assert.match(text, /Tokens: 50,000 input \/ 15,000 output/);
    assert.match(text, /By role:/);
    assert.match(text, /dev: \$7\.00 \(2 turns/);
    assert.match(text, /qa: \$3\.00 \(1 turn/);
    assert.match(text, /By phase:/);
    assert.match(text, /impl: \$7\.00 \(2 turns\)/);
    assert.match(text, /qa: \$3\.00 \(1 turn\)/);
  });

  // AT-COST-SUMMARY-007
  it('markdown format includes Cost Summary heading with role and phase tables', () => {
    const cs = {
      total_usd: 5.50,
      total_input_tokens: 20000,
      total_output_tokens: 6000,
      turn_count: 2,
      costed_turn_count: 2,
      by_role: [
        { role: 'dev', usd: 5.50, turns: 2, input_tokens: 20000, output_tokens: 6000 },
      ],
      by_phase: [
        { phase: 'impl', usd: 5.50, turns: 2 },
      ],
    };
    const md = formatGovernanceReportMarkdown(makeReport(cs));
    assert.match(md, /## Cost Summary/);
    assert.match(md, /\*\*Total:\*\* \$5\.50 across 2 turns/);
    assert.match(md, /\*\*Tokens:\*\*/);
    assert.match(md, /\| Role \| Cost \| Turns \| Input Tokens \| Output Tokens \|/);
    assert.match(md, /\| dev \| \$5\.50 \| 2 \|/);
    assert.match(md, /\| Phase \| Cost \| Turns \|/);
    assert.match(md, /\| impl \| \$5\.50 \| 2 \|/);
  });

  // AT-COST-SUMMARY-008
  it('JSON report includes cost_summary in subject.run', () => {
    const cs = {
      total_usd: 1.00,
      total_input_tokens: null,
      total_output_tokens: null,
      turn_count: 1,
      costed_turn_count: 1,
      by_role: [{ role: 'dev', usd: 1.00, turns: 1, input_tokens: 0, output_tokens: 0 }],
      by_phase: [{ phase: 'impl', usd: 1.00, turns: 1 }],
    };
    const report = makeReport(cs);
    assert.deepEqual(report.subject.run.cost_summary, cs);
    assert.equal(report.subject.run.cost_summary.total_usd, 1.00);
  });

  it('text format omits Cost Summary when cost_summary is null', () => {
    const text = formatGovernanceReportText(makeReport(null));
    assert.ok(!text.includes('Cost Summary:'));
  });

  it('text format omits token line when tokens are null', () => {
    const cs = {
      total_usd: 1.00,
      total_input_tokens: null,
      total_output_tokens: null,
      turn_count: 1,
      costed_turn_count: 1,
      by_role: [{ role: 'dev', usd: 1.00, turns: 1, input_tokens: 0, output_tokens: 0 }],
      by_phase: [{ phase: 'impl', usd: 1.00, turns: 1 }],
    };
    const text = formatGovernanceReportText(makeReport(cs));
    assert.match(text, /Cost Summary:/);
    assert.ok(!text.includes('Tokens:'));
  });
});

// AT-COST-SUMMARY-009
describe('cost summary docs contract', () => {
  const CLI_DOCS = readFileSync(join(REPO_ROOT, 'website-v2/docs/cli.mdx'), 'utf8');
  const REPORT_DOCS = readFileSync(join(REPO_ROOT, 'website-v2/docs/governance-report.mdx'), 'utf8');

  it('CLI docs mention cost summary in audit/report descriptions', () => {
    assert.match(CLI_DOCS, /cost.summary/i);
  });

  it('governance report reference page documents cost_summary', () => {
    assert.match(REPORT_DOCS, /cost_summary/);
    assert.match(REPORT_DOCS, /by_role/);
    assert.match(REPORT_DOCS, /by_phase/);
  });
});
