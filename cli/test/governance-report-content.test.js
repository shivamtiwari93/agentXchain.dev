import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const CLI_DOCS = read('website-v2/docs/cli.mdx');
const REPORT_DOCS = read('website-v2/docs/governance-report.mdx');
const CLI_ENTRY = read('cli/bin/agentxchain.js');
const REPORT_LIB = read('cli/src/lib/report.js');
const SIDEBAR = read('website-v2/sidebars.ts');
const SPEC = read('.planning/GOVERNANCE_REPORT_SPEC.md');

describe('governance report docs contract', () => {
  it('registers the report command in the CLI entrypoint with input and format flags', () => {
    const block = CLI_ENTRY.match(/\.command\('report'\)[\s\S]*?\.action\(reportCommand\)/);
    assert.ok(block, 'report command block found');
    assert.match(block[0], /--input <path>/);
    assert.match(block[0], /--format <format>/);
  });

  it('documents report in the command map and CLI reference section', () => {
    assert.match(CLI_DOCS, /\| `report` \| Inspection \|/);
    assert.match(CLI_DOCS, /### `report`/);
    assert.match(CLI_DOCS, /agentxchain report \[--input <path>\|-] \[--format text\|json\|markdown\|html]/);
    assert.match(CLI_DOCS, /verifies the export artifact first/i);
  });

  it('ships a dedicated governance report reference page and docs navigation entry', () => {
    assert.match(SIDEBAR, /'governance-report'/);
    assert.match(REPORT_DOCS, /# Governance Report Reference/);
    assert.match(REPORT_DOCS, /Export Schema Reference/);
    assert.match(REPORT_DOCS, /markdown/i);
    assert.match(REPORT_DOCS, /report_version/);
    assert.match(REPORT_DOCS, /governed_run/);
    assert.match(REPORT_DOCS, /coordinator_workspace/);
    assert.match(REPORT_DOCS, /blocked_reason/);
    assert.match(REPORT_DOCS, /pending_gate/);
    assert.match(REPORT_DOCS, /next_actions/);
    assert.match(REPORT_DOCS, /runtime_guidance/);
    assert.match(REPORT_DOCS, /coordinator_timeline/);
    assert.match(REPORT_DOCS, /barrier_summary/);
    assert.match(REPORT_DOCS, /barrier_ledger_timeline/);
    assert.match(REPORT_DOCS, /decision_digest/);
    assert.match(REPORT_DOCS, /subject\.run\.repo_decisions/);
    assert.match(REPORT_DOCS, /operator_summary/);
    assert.match(REPORT_DOCS, /timeout_events/);
    assert.match(REPORT_DOCS, /continuity/);
    assert.match(REPORT_DOCS, /delegation_summary/);
    assert.match(REPORT_DOCS, /dashboard_session/);
    assert.match(REPORT_DOCS, /recent_event_summary/);
    assert.match(REPORT_DOCS, /recent_coordinator_events/);
    assert.match(REPORT_DOCS, /recent_child_repo_events/);
    assert.match(REPORT_DOCS, /terminal_observability_note/);
    assert.match(REPORT_DOCS, /Barrier Transitions/);
    assert.match(REPORT_DOCS, /Coordinator Decisions/);
    assert.match(REPORT_DOCS, /Repo Decisions/);
    assert.match(REPORT_DOCS, /Timeout Events/);
    assert.match(REPORT_DOCS, /Next Actions/);
    assert.match(REPORT_DOCS, /Delegation Summary/);
    assert.match(REPORT_DOCS, /Dashboard session/);
    assert.match(REPORT_DOCS, /Recent Event Summary/);
    assert.match(REPORT_DOCS, /#### Continuity/);
    assert.match(REPORT_DOCS, /created_at.*completed_at.*duration_seconds/);
  });

  it('documents recovery report rendering in coordinator exports', () => {
    assert.match(REPORT_DOCS, /recovery_report/);
    assert.match(REPORT_DOCS, /RECOVERY_REPORT\.md/);
    assert.match(REPORT_DOCS, /## Recovery Report/);
    assert.match(REPORT_DOCS, /trigger/);
    assert.match(REPORT_DOCS, /impact/);
    assert.match(REPORT_DOCS, /mitigation/);
    assert.match(REPORT_DOCS, /exit_condition/);
  });
});

describe('governance report implementation contract', () => {
  it('defines a dedicated report version and verification-first builder', () => {
    assert.match(REPORT_LIB, /GOVERNANCE_REPORT_VERSION = '0\.1'/);
    assert.match(REPORT_LIB, /verifyExportArtifact/);
    assert.match(REPORT_LIB, /Cannot build governance report from invalid export artifact/);
  });

  it('supports text and markdown renderers', () => {
    assert.match(REPORT_LIB, /formatGovernanceReportText/);
    assert.match(REPORT_LIB, /formatGovernanceReportMarkdown/);
    assert.match(REPORT_LIB, /AgentXchain Governance Report/);
  });
});

describe('governance report spec alignment', () => {
  it('ships a standalone governance report spec with acceptance tests', () => {
    assert.match(SPEC, /\*\*Status:\*\*\s+shipped/i);
    assert.match(SPEC, /AT-REPORT-001/);
    assert.match(SPEC, /AT-REPORT-008/);
    assert.match(SPEC, /markdown/);
    assert.match(SPEC, /report_version/);
  });

  it('ships a runtime blocked-guidance spec for governed run next actions', () => {
    const runtimeSpec = read('.planning/RUNTIME_BLOCKED_GUIDANCE_SPEC.md');
    assert.match(runtimeSpec, /Runtime-Aware Blocked Guidance Spec/);
    assert.match(runtimeSpec, /proposal_apply_required/);
    assert.match(runtimeSpec, /tool_defined_proof_not_strong_enough/);
    assert.match(runtimeSpec, /subject\.run\.next_actions/);
  });

  it('ships a coordinator timing spec for the coordinator report surface', () => {
    const timingSpec = read('.planning/COORDINATOR_REPORT_TIMING_SPEC.md');
    assert.match(timingSpec, /DEC-COORD-REPORT-TIME-001/);
    assert.match(timingSpec, /AT-COORD-TIME-001/);
    assert.match(timingSpec, /AT-COORD-TIME-006/);
  });

  it('ships a coordinator decision-digest spec for coordinator-level decisions', () => {
    const digestSpec = read('.planning/COORDINATOR_DECISION_DIGEST_SPEC.md');
    assert.match(digestSpec, /Coordinator Decision Digest/);
    assert.match(digestSpec, /AT-COORD-DECISION-001/);
    assert.match(digestSpec, /AT-COORD-DECISION-007/);
    assert.match(digestSpec, /decision_digest/);
  });

  it('ships a coordinator action-guidance spec for operator next steps', () => {
    const actionsSpec = read('.planning/COORDINATOR_REPORT_ACTIONS_SPEC.md');
    assert.match(actionsSpec, /DEC-COORD-ACTIONS-001/);
    assert.match(actionsSpec, /AT-COORD-ACT-001/);
    assert.match(actionsSpec, /AT-COORD-ACT-006/);
  });

  it('ships a coordinator terminal-drift report spec for completed-child drift observability', () => {
    const terminalDriftSpec = read('.planning/COORDINATOR_REPORT_TERMINAL_DRIFT_SPEC.md');
    assert.match(terminalDriftSpec, /DEC-COORD-REPORT-TERMINAL-DRIFT-001/);
    assert.match(terminalDriftSpec, /AT-COORD-RUNID-006/);
    assert.match(terminalDriftSpec, /AT-COORD-RUNID-007/);
    assert.match(terminalDriftSpec, /AT-REPORT-009/);
    assert.match(terminalDriftSpec, /terminal_observability_note/);
  });

  it('ships a coordinator continuity spec for child repo checkpoints', () => {
    const continuitySpec = read('.planning/COORDINATOR_REPORT_CONTINUITY_SPEC.md');
    assert.match(continuitySpec, /Coordinator Report Continuity/);
    assert.match(continuitySpec, /AT-COORD-CONT-001/);
    assert.match(continuitySpec, /AT-COORD-CONT-005/);
    assert.match(continuitySpec, /subject\.repos\[\]\.continuity/);
  });

  it('ships a delegation-report spec for delegation-aware audit output', () => {
    const delegationSpec = read('.planning/GOVERNANCE_REPORT_DELEGATION_SPEC.md');
    assert.match(delegationSpec, /Governance Report Delegation Summary Spec/);
    assert.match(delegationSpec, /AT-REPORT-DEL-001/);
    assert.match(delegationSpec, /AT-REPORT-DEL-004/);
    assert.match(delegationSpec, /subject\.run\.delegation_summary/);
  });

  it('ships a dashboard-session report spec for dashboard snapshot audit output', () => {
    const dashboardSpec = read('.planning/GOVERNANCE_REPORT_DASHBOARD_SESSION_SPEC.md');
    assert.match(dashboardSpec, /Governance Report Dashboard Session Spec/);
    assert.match(dashboardSpec, /AT-REPORT-DASH-001/);
    assert.match(dashboardSpec, /AT-REPORT-DASH-003/);
    assert.match(dashboardSpec, /subject\.run\.dashboard_session/);
    assert.match(dashboardSpec, /summary\.dashboard_session/);
  });
});
