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
    assert.match(AUDIT_DOCS, /Governance Report Reference/);
    assert.match(AUDIT_DOCS, /Export Schema Reference/);
  });
});

describe('governance audit spec alignment', () => {
  it('ships a standalone governance audit spec with acceptance tests', () => {
    assert.match(SPEC, /\*\*Status:\*\*\s+shipped/i);
    assert.match(SPEC, /AT-AUDIT-001/);
    assert.match(SPEC, /AT-AUDIT-007/);
    assert.match(SPEC, /live repo state/i);
    assert.match(SPEC, /governed project or coordinator workspace/i);
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
});
