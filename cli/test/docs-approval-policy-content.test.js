import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const DOCS_ROOT = resolve(import.meta.dirname, '../../website-v2/docs');

function readDoc(name) {
  return readFileSync(resolve(DOCS_ROOT, name), 'utf8');
}

describe('Approval Policy docs content guard', () => {
  const content = readDoc('approval-policy.mdx');

  it('documents the approval_policy config shape', () => {
    assert.ok(content.includes('approval_policy'), 'must document approval_policy config key');
    assert.ok(content.includes('phase_transitions'), 'must document phase_transitions');
    assert.ok(content.includes('run_completion'), 'must document run_completion');
  });

  it('documents both actions', () => {
    assert.ok(content.includes('auto_approve'), 'must document auto_approve action');
    assert.ok(content.includes('require_human'), 'must document require_human action');
  });

  it('documents when conditions', () => {
    assert.ok(content.includes('gate_passed'), 'must document gate_passed condition');
    assert.ok(content.includes('roles_participated'), 'must document roles_participated condition');
    assert.ok(content.includes('all_phases_visited'), 'must document all_phases_visited condition');
  });

  it('documents the semantic guardrails for gate_passed and all_phases_visited', () => {
    assert.ok(content.includes('defense-in-depth'), 'must describe gate_passed as defense-in-depth');
    assert.ok(content.includes('declared in routing'), 'must document all_phases_visited as strict over declared routing phases');
    assert.ok(content.includes('just-accepted turn'), 'must document that roles_participated sees the just-accepted turn');
  });

  it('documents the invariant that --auto-approve overrides policy', () => {
    assert.ok(content.includes('--auto-approve'), 'must mention --auto-approve override');
  });

  it('documents auditability via decision ledger', () => {
    assert.ok(content.includes('decision ledger') || content.includes('ledger'), 'must mention decision ledger');
  });

  it('is linked from the sidebar', () => {
    const sidebars = readFileSync(resolve(DOCS_ROOT, '../sidebars.ts'), 'utf8');
    assert.ok(sidebars.includes("'approval-policy'"), 'approval-policy must be in sidebars.ts');
  });

  it('is linked from llms.txt', () => {
    const llms = readFileSync(resolve(DOCS_ROOT, '../static/llms.txt'), 'utf8');
    assert.ok(llms.includes('/docs/approval-policy'), 'approval-policy must be in llms.txt');
  });

  it('is in sitemap.xml', () => {
    const sitemap = readFileSync(resolve(DOCS_ROOT, '../static/sitemap.xml'), 'utf8');
    assert.ok(sitemap.includes('/docs/approval-policy'), 'approval-policy must be in sitemap.xml');
  });

  it('policies.mdx cross-links to approval policy', () => {
    const policies = readDoc('policies.mdx');
    assert.ok(policies.includes('/docs/approval-policy'), 'policies.mdx must link to approval-policy');
  });
});
