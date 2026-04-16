import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const CLI_DOCS = read('website-v2/docs/cli.mdx');
const AUDIT_DOCS = read('website-v2/docs/governance-audit.mdx');
const CLI_ENTRY = read('cli/bin/agentxchain.js');
const SIDEBAR = read('website-v2/sidebars.ts');
const SPEC = read('.planning/GOVERNANCE_AUDIT_SPEC.md');
const RUNTIME_PARITY_SPEC = read('.planning/RUNTIME_BLOCKED_DASHBOARD_AUDIT_PARITY_SPEC.md');
const COORDINATOR_ACTION_PARITY_SPEC = read('.planning/COORDINATOR_BLOCKED_ACTION_PARITY_SPEC.md');
const TERMINAL_DRIFT_SPEC = read('.planning/COORDINATOR_AUDIT_TERMINAL_DRIFT_SPEC.md');

describe('governance audit docs contract', () => {
  it('registers the audit command in the CLI entrypoint with format flag', () => {
    const block = CLI_ENTRY.match(/\.command\('audit'\)[\s\S]*?\.action\(auditCommand\)/);
    assert.ok(block, 'audit command block found');
    assert.match(block[0], /--format <format>/);
  });

  it('documents audit in the command map and CLI reference section', () => {
    assert.match(CLI_DOCS, /\| `audit` \| Inspection \|/);
    assert.match(CLI_DOCS, /### `audit`/);
    assert.match(CLI_DOCS, /agentxchain audit \[--format text\|json\|markdown\|html]/);
    assert.match(CLI_DOCS, /live repo state/i);
    assert.match(CLI_DOCS, /`report` remains the export-artifact path/i);
  });

  it('ships a dedicated governance audit reference page and docs navigation entry', () => {
    assert.match(SIDEBAR, /'governance-audit'/);
    assert.match(AUDIT_DOCS, /# Governance Audit Reference/);
    assert.match(AUDIT_DOCS, /live governed project or coordinator workspace/i);
    assert.match(AUDIT_DOCS, /same report contract as `agentxchain report`/i);
    assert.match(AUDIT_DOCS, /subject\.run\.next_actions/);
    assert.match(AUDIT_DOCS, /runtime_guidance/);
    assert.match(AUDIT_DOCS, /pending_gate/);
    assert.match(AUDIT_DOCS, /multi resync/i);
    assert.match(AUDIT_DOCS, /repo_status_drifts/);
    assert.match(AUDIT_DOCS, /terminal_observability_note/);
    assert.match(AUDIT_DOCS, /summary\.repo_run_statuses/);
    assert.match(AUDIT_DOCS, /raw coordinator snapshot metadata/i);
    assert.match(AUDIT_DOCS, /authority-first child repo status/i);
    assert.match(AUDIT_DOCS, /raw coordinator snapshot metadata only/i);
    assert.match(AUDIT_DOCS, /nested child export or repo-local state is readable/i);
    assert.match(AUDIT_DOCS, /linked` \/ `initialized` remain metadata only/i);
    assert.match(AUDIT_DOCS, /freshly built coordinator export is partial/i);
    assert.match(AUDIT_DOCS, /repo_ok_count.*repo_error_count.*export-health totals/i);
    assert.match(AUDIT_DOCS, /must not invent child drill-down sections/i);
    assert.match(AUDIT_DOCS, /turn timelines, decisions, gate outcomes, hook activity, and recovery details stay absent/i);
    assert.match(AUDIT_DOCS, /`html` follows the same repo-detail contract as the other human-readable audit formats/i);
    assert.match(AUDIT_DOCS, /`text`, `markdown`, and `html` all keep the failed repo row visible without fabricated child sections/i);
    assert.match(AUDIT_DOCS, /Approval Policy, Governance Events, Timeout Events, Hook Activity, Recovery, and Continuity/i);
    assert.match(AUDIT_DOCS, /must not fabricate `?<h4>`? child sections/i);
    assert.match(AUDIT_DOCS, /Terminal drift note:/);
    assert.match(AUDIT_DOCS, /`html` for portable, self-contained audit records with inline styles/i);
    assert.match(AUDIT_DOCS, /agentxchain audit --format html > governance-audit\.html/);
    assert.match(AUDIT_DOCS, /Governance Report Reference/);
    assert.match(AUDIT_DOCS, /Export Schema Reference/);
    assert.match(CLI_DOCS, /completed coordinator audit still shows child repo drift/i);
    assert.match(CLI_DOCS, /subject\.run\.terminal_observability_note/);
  });
});

describe('governance audit spec alignment', () => {
  it('ships a standalone governance audit spec with acceptance tests', () => {
    assert.match(SPEC, /\*\*Status:\*\*\s+shipped/i);
    assert.match(SPEC, /AT-AUDIT-001/);
    assert.match(SPEC, /AT-AUDIT-007/);
    assert.match(SPEC, /AT-AUDIT-012/);
    assert.match(SPEC, /AT-AUDIT-013/);
    assert.match(SPEC, /AT-AUDIT-014/);
    assert.match(SPEC, /AT-AUDIT-015/);
    assert.match(SPEC, /live repo state/i);
    assert.match(SPEC, /governed project or coordinator workspace/i);
    assert.match(SPEC, /partial coordinator audits stay readable/i);
    assert.match(SPEC, /repo_ok_count.*repo_error_count.*preserve export health/i);
    assert.match(SPEC, /successful child repos keep any available drill-down sections in HTML/i);
    assert.match(SPEC, /text, markdown, and html all keep failed child repos row-only plus error/i);
  });

  it('freezes blocked-run audit parity in a standalone runtime spec', () => {
    assert.match(RUNTIME_PARITY_SPEC, /Runtime Blocked Dashboard And Audit Parity Spec/);
    assert.match(RUNTIME_PARITY_SPEC, /AT-RBDAP-003/);
    assert.match(RUNTIME_PARITY_SPEC, /subject\.run\.next_actions/);
    assert.match(RUNTIME_PARITY_SPEC, /runtime_guidance/);
  });

  it('freezes coordinator blocked-action parity in a standalone spec', () => {
    assert.match(COORDINATOR_ACTION_PARITY_SPEC, /Coordinator Blocked Action Parity Spec/);
    assert.match(COORDINATOR_ACTION_PARITY_SPEC, /AT-CBAP-004/);
    assert.match(COORDINATOR_ACTION_PARITY_SPEC, /subject\.run\.next_actions/);
  });

  it('freezes completed coordinator audit terminal drift in a standalone spec', () => {
    assert.match(TERMINAL_DRIFT_SPEC, /Coordinator Audit Terminal Drift Spec/);
    assert.match(TERMINAL_DRIFT_SPEC, /\*\*Status:\*\*\s+shipped/i);
    assert.match(TERMINAL_DRIFT_SPEC, /AT-AUDIT-009/);
    assert.match(TERMINAL_DRIFT_SPEC, /AT-AUDIT-010/);
    assert.match(TERMINAL_DRIFT_SPEC, /AT-AUDIT-011/);
    assert.match(TERMINAL_DRIFT_SPEC, /terminal_observability_note/);
    assert.match(TERMINAL_DRIFT_SPEC, /Terminal drift note:/);
  });

  it('keeps AT-AUDIT ids unique inside audit-command command tests', () => {
    const auditCli = read('cli/test/audit-command.test.js');
    const ids = [...auditCli.matchAll(/it\('((AT-AUDIT-\d{3})(?:\/AT-AUDIT-\d{3})*):/g)].flatMap(
      (match) => match[1].split('/'),
    );
    const seen = new Set();
    const duplicates = new Set();
    for (const id of ids) {
      if (seen.has(id)) duplicates.add(id);
      seen.add(id);
    }
    assert.deepEqual(
      [...duplicates],
      [],
      `duplicate audit acceptance ids in audit-command.test.js: ${[...duplicates].join(', ')}`,
    );
    assert.match(auditCli, /AT-AUDIT-009: completed coordinator audit keeps terminal child drift observable without recovery guidance/);
    assert.match(auditCli, /AT-AUDIT-010: completed coordinator audit html keeps terminal child drift observable without next actions/);
    assert.match(auditCli, /AT-AUDIT-011: completed coordinator audit text and markdown keep terminal child drift observable without next actions/);
    assert.match(auditCli, /AT-AUDIT-014: partial coordinator audit html keeps export health, failed repo row, and successful child drill-down sections/);
    assert.match(auditCli, /AT-AUDIT-015: partial coordinator audit text and markdown keep export health, failed repo row-only output, and successful child drill-down sections/);
  });
});
