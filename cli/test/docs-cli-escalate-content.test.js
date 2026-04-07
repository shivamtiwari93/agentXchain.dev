import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const CLI_DOCS = read('website-v2/docs/cli.mdx');
const CLI_ENTRY = read('cli/bin/agentxchain.js');
const COMMAND = read('cli/src/commands/escalate.js');
const GOVERNED_STATE = read('cli/src/lib/governed-state.js');
const BLOCKED_STATE = read('cli/src/lib/blocked-state.js');
const SPEC = read('.planning/ESCALATION_SURFACE_SPEC.md');

describe('Escalate CLI docs contract', () => {
  it('registers escalate with the shipped flag contract', () => {
    const block = CLI_ENTRY.match(/\.command\('escalate'\)[\s\S]*?\.action\(escalateCommand\)/);
    assert.ok(block, 'escalate command block found');
    assert.match(block[0], /requiredOption\('--reason <reason>'/);
    assert.match(block[0], /--detail <detail>/);
    assert.match(block[0], /--action <action>/);
    assert.match(block[0], /--turn <id>/);
  });

  it('documents escalate in the command map and dedicated section', () => {
    assert.match(CLI_DOCS, /\| `escalate` \| Turn lifecycle \|/);
    assert.match(CLI_DOCS, /### `escalate`/);
  });

  it('documents active-only scope, multi-turn targeting, and resolution semantics', () => {
    assert.match(CLI_DOCS, /active-run-only/i);
    assert.match(CLI_DOCS, /If multiple active turns exist, `--turn` is required/i);
    assert.match(CLI_DOCS, /agentxchain resume/);
    assert.match(CLI_DOCS, /agentxchain step --resume/);
    assert.match(CLI_DOCS, /decision = "operator_escalated"/);
    assert.match(CLI_DOCS, /decision = "escalation_resolved"/);
  });
});

describe('Escalate implementation contract', () => {
  it('ships a dedicated escalate command implementation', () => {
    assert.match(COMMAND, /raiseOperatorEscalation/);
    assert.match(COMMAND, /Run Escalated/);
  });

  it('persists operator_escalation distinctly from retries_exhausted', () => {
    assert.match(GOVERNED_STATE, /category:\s+'operator_escalation'/);
    assert.match(BLOCKED_STATE, /typed_reason:\s+isOperatorEscalation \? 'operator_escalation' : 'retries_exhausted'/);
  });

  it('records both operator_escalated and escalation_resolved decisions in the ledger', () => {
    assert.match(GOVERNED_STATE, /decision:\s+'operator_escalated'/);
    assert.match(GOVERNED_STATE, /decision:\s+'escalation_resolved'/);
  });
});

describe('Escalation spec alignment', () => {
  it('ships a standalone escalation surface spec with acceptance tests', () => {
    assert.match(SPEC, /\*\*Status:\*\*\s+shipped/i);
    assert.match(SPEC, /AT-ESC-001/);
    assert.match(SPEC, /AT-ESC-008/);
    assert.match(SPEC, /operator_escalated/);
    assert.match(SPEC, /escalation_resolved/);
  });
});
