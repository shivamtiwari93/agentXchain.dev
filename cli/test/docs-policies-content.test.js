import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VALID_POLICY_ACTIONS,
  VALID_POLICY_RULES,
  VALID_POLICY_TURN_STATUSES,
} from '../src/lib/policy-evaluator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const DOC_PATH = 'website-v2/docs/policies.mdx';
const DOC = read(DOC_PATH);
const SIDEBARS = read('website-v2/sidebars.ts');
const LLMS = read('website-v2/static/llms.txt');
const SITEMAP = read('website-v2/static/sitemap.xml');
const SPEC = read('.planning/POLICY_DOCS_SURFACE_SPEC.md');
const ENGINE_SPEC = read('.planning/POLICY_ENGINE_SPEC.md');
const GOVERNED_STATE = read('cli/src/lib/governed-state.js');
const ENTERPRISE_TEMPLATE = JSON.parse(
  read('cli/src/templates/governed/enterprise-app.json'),
);

describe('Policies docs surface', () => {
  it('AT-POLDOC-001: ships the docs page and sidebar entry', () => {
    assert.ok(existsSync(join(REPO_ROOT, DOC_PATH)), 'policies docs page must exist');
    assert.match(SIDEBARS, /'policies'/, 'sidebars.ts must include the policies page');
  });

  it('has correct frontmatter', () => {
    assert.match(DOC, /title:\s*Policies/);
    assert.match(DOC, /description:/);
  });

  it('AT-POLDOC-007: is discoverable in llms.txt and sitemap.xml', () => {
    assert.match(LLMS, /https:\/\/agentxchain\.dev\/docs\/policies/);
    assert.match(SITEMAP, /https:\/\/agentxchain\.dev\/docs\/policies/);
  });
});

describe('Policies docs contract', () => {
  it('AT-POLDOC-002: documents every shipped rule', () => {
    for (const rule of VALID_POLICY_RULES) {
      assert.match(DOC, new RegExp(`\`${rule}\``), `policies docs must mention rule "${rule}"`);
    }
  });

  it('AT-POLDOC-003: documents every shipped action', () => {
    for (const action of VALID_POLICY_ACTIONS) {
      assert.match(DOC, new RegExp(`\`${action}\``), `policies docs must mention action "${action}"`);
    }
  });

  it('AT-POLDOC-004: distinguishes policies from hooks and gates', () => {
    assert.match(DOC, /not the same thing as gates or hooks/i);
    assert.match(DOC, /Use policies when/i);
    assert.match(DOC, /Use hooks when/i);
    assert.match(DOC, /Use gates instead/i);
  });

  it('AT-POLDOC-005: documents the real require_status allowlist', () => {
    for (const status of VALID_POLICY_TURN_STATUSES) {
      assert.match(DOC, new RegExp(`\`${status}\``), `policies docs must mention status "${status}"`);
      assert.match(
        ENGINE_SPEC,
        new RegExp(`\`${status}\``),
        `policy engine spec must mention valid status "${status}"`,
      );
    }
  });

  it('documents the enterprise-app template default policy example truthfully', () => {
    const policyIds = ENTERPRISE_TEMPLATE.scaffold_blueprint.policies.map((policy) => policy.id);
    for (const policyId of policyIds) {
      assert.match(DOC, new RegExp(policyId), `policies docs must mention enterprise-app policy "${policyId}"`);
    }
    assert.match(DOC, /enterprise-app[\s`-]*template/i);
  });

  it('AT-POLDOC-006: states the real acceptance-flow placement', () => {
    assert.match(GOVERNED_STATE, /after_validation[\s\S]*evaluatePolicies[\s\S]*detectAcceptanceConflict/);
    assert.match(DOC, /passed validation[\s\S]*after `after_validation` hooks/i);
    assert.match(DOC, /before conflict detection/i);
  });

  it('documents the real max_consecutive_same_role semantics', () => {
    assert.match(DOC, /would exceed the limit/i);
    assert.match(SPEC, /max_consecutive_same_role/);
    assert.match(ENGINE_SPEC, /would exceed the limit/i);
  });

  it('documents the real cost field used by max_cost_per_turn', () => {
    assert.match(DOC, /cost\.usd/);
    assert.match(ENGINE_SPEC, /cost\.usd/);
  });

  it('documents runtime-aware policy escalation recovery', () => {
    assert.match(DOC, /retained `manual` turns recover with `agentxchain resume`/i);
    assert.match(DOC, /retained non-manual turns recover with `agentxchain step --resume`/i);
    assert.match(ENGINE_SPEC, /retained `manual` turn/i);
    assert.match(ENGINE_SPEC, /retained non-manual turn/i);
  });
});
