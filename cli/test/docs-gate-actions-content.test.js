import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

const read = (rel) => readFileSync(resolve(REPO_ROOT, rel), 'utf8');

const DOC = read('website-v2/docs/gate-actions.mdx');
const SIDEBARS = read('website-v2/sidebars.ts');
const LLMS = read('website-v2/static/llms.txt');
const CLI_DOC = read('website-v2/docs/cli.mdx');
const APPROVAL_POLICY_DOC = read('website-v2/docs/approval-policy.mdx');
const SPEC = read('.planning/GATE_ACTIONS_DOCS_SPEC.md');

describe('gate actions docs surface', () => {
  it('AT-GADOC-001: ships the page and wires it into the sidebar', () => {
    assert.ok(existsSync(resolve(REPO_ROOT, 'website-v2/docs/gate-actions.mdx')), 'gate-actions.mdx must exist');
    assert.match(SIDEBARS, /'gate-actions'/, 'sidebars.ts must include the gate-actions page');
  });

  it('AT-GADOC-002: documents the real config shape and human-approval requirement', () => {
    assert.match(DOC, /gates\.<gate_id>/);
    assert.match(DOC, /gate_actions/);
    assert.match(DOC, /requires_human_approval:\s*true/);
    assert.match(DOC, /non-empty `run` string/i);
  });

  it('AT-GADOC-003: documents sequential execution, dry-run, and gate_action_failed', () => {
    assert.match(DOC, /`before_gate` hooks run first/i);
    assert.match(DOC, /execute sequentially/i);
    assert.match(DOC, /approval finalizes only after \*\*all\*\* gate actions succeed/i);
    assert.match(DOC, /--dry-run/);
    assert.match(DOC, /without executing hooks, actions, or state mutation/i);
    assert.match(DOC, /gate_action_failed/);
  });

  it('AT-GADOC-004: documents evidence surfaces and exported environment variables', () => {
    assert.match(DOC, /\.agentxchain\/decision-ledger\.jsonl/);
    assert.match(DOC, /type:\s*"gate_action"/);
    assert.match(DOC, /agentxchain status/);
    assert.match(DOC, /agentxchain report/);
    assert.match(DOC, /agentxchain audit/);
    for (const envName of [
      'AGENTXCHAIN_GATE_ID',
      'AGENTXCHAIN_GATE_TYPE',
      'AGENTXCHAIN_PHASE',
      'AGENTXCHAIN_REQUESTED_BY_TURN',
      'AGENTXCHAIN_TRIGGER_COMMAND',
    ]) {
      assert.ok(DOC.includes(envName), `gate-actions docs must mention ${envName}`);
    }
  });

  it('AT-GADOC-005: distinguishes gate actions from adjacent governance mechanisms', () => {
    assert.match(DOC, /\[Approval Policy\]\(\/docs\/approval-policy\)/);
    assert.match(DOC, /\[Policies\]\(\/docs\/policies\)/);
    assert.match(DOC, /\[Notifications\]\(\/docs\/notifications\)/);
    assert.match(DOC, /repo-local post-approval automation/i);
  });

  it('AT-GADOC-006: is listed in llms.txt', () => {
    assert.match(LLMS, /\/docs\/gate-actions/, 'llms.txt must include the gate-actions route');
  });

  it('AT-GADOC-007: CLI and approval-policy docs cross-link to the dedicated page', () => {
    assert.match(CLI_DOC, /\/docs\/gate-actions/);
    assert.match(APPROVAL_POLICY_DOC, /\/docs\/gate-actions/);
  });

  it('documents rerunnable wrapper scripts instead of unsafe one-shot defaults', () => {
    assert.match(DOC, /rerunnable|idempotent/i);
    assert.match(DOC, /npm version patch/i);
    assert.match(DOC, /git tag/i);
    assert.match(DOC, /bad examples|unsafe defaults/i);
    assert.match(DOC, /scripts\/release\/publish-npm-if-needed\.sh/);
  });

  it('has a shipped spec with acceptance coverage', () => {
    assert.match(SPEC, /\*\*Status:\*\*\s+shipped/i);
    assert.match(SPEC, /AT-GADOC-001/);
    assert.match(SPEC, /AT-GADOC-007/);
  });
});
