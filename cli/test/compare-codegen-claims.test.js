import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..');
const page = readFileSync(resolve(root, 'website-v2/docs/compare/vs-codegen.mdx'), 'utf8');
const spec = readFileSync(resolve(root, '.planning/COMPARE_CODEGEN_CLAIMS_SPEC.md'), 'utf8');
const matrix = readFileSync(resolve(root, '.planning/COMPETITIVE_POSITIONING_MATRIX.md'), 'utf8');

describe('Codegen comparison claims truth boundary', () => {
  it('AT-CODEGEN-CLAIMS-001: acknowledges managed SaaS platform', () => {
    assert.match(page, /managed.*SaaS|SaaS.*managed/i, 'must acknowledge managed SaaS platform');
    assert.match(page, /platform/i, 'must acknowledge platform model');
  });

  it('AT-CODEGEN-CLAIMS-002: acknowledges sandboxed Docker execution', () => {
    assert.match(page, /sandbox/i, 'must acknowledge sandboxed execution');
    assert.match(page, /Docker/i, 'must acknowledge Docker-based sandboxes');
  });

  it('AT-CODEGEN-CLAIMS-003: acknowledges agent rules and permissions accurately', () => {
    assert.match(page, /three-tier|User > Repository > Organization/i, 'must describe tiered rules hierarchy');
    assert.match(page, /AGENTS\.md/i, 'must acknowledge AGENTS.md rule discovery');
    assert.match(page, /PR creation/i, 'must acknowledge PR creation permission');
    assert.match(page, /signed commit/i, 'must acknowledge signed commits enforcement');
  });

  it('AT-CODEGEN-CLAIMS-004: contrasts with governed software delivery', () => {
    assert.match(page, /governed software delivery|governance protocol/i, 'must reference governed delivery');
  });

  it('AT-CODEGEN-CLAIMS-005: exposes official source links and last-checked date', () => {
    assert.match(page, /Source baseline/, 'Codegen page must expose source baseline');
    assert.match(page, /2026-04-25/, 'must include last-checked date');
    for (const url of [
      'https://docs.codegen.com/introduction/overview',
      'https://docs.codegen.com/capabilities/capabilities',
      'https://docs.codegen.com/capabilities/triggering-codegen',
      'https://docs.codegen.com/settings/repo-rules',
      'https://docs.codegen.com/settings/agent-permissions',
      'https://docs.codegen.com/settings/model-configuration',
      'https://docs.codegen.com/sandboxes/overview',
      'https://docs.codegen.com/integrations/integrations',
      'https://codegen.com/security',
      'https://docs.codegen.com/api-reference/overview',
      'https://docs.codegen.com/settings/on-prem-deployment',
      'https://docs.codegen.com/capabilities/claude-code',
      'https://docs.codegen.com/capabilities/analytics',
      'https://docs.codegen.com/capabilities/checks-autofixer',
      'https://docs.codegen.com/settings/agent-behavior',
      'https://docs.codegen.com/settings/team-roles',
      'https://docs.codegen.com/settings/trufflehog-integration',
    ]) {
      assert.ok(page.includes(url), `Codegen comparison page must link to ${url}`);
    }
    assert.match(spec, /AT-CODEGEN-CLAIMS-005/, 'spec must reference AT-CODEGEN-CLAIMS-005');
    assert.match(matrix, /Codegen row refreshed.*2026-04-25/, 'matrix must record 2026-04-25 refresh');
  });

  it('AT-CODEGEN-CLAIMS-006: does not use undocumented CLI examples', () => {
    assert.doesNotMatch(page, /codegen deploy/, 'must not use undocumented codegen deploy command');
    assert.doesNotMatch(page, /codegen assign/, 'must not use undocumented codegen assign command');
  });

  it('AT-CODEGEN-CLAIMS-007: acknowledges ClickUp acquisition', () => {
    assert.match(page, /ClickUp/i, 'must acknowledge ClickUp acquisition or integration');
  });

  it('AT-CODEGEN-CLAIMS-008: acknowledges on-premises deployment', () => {
    assert.match(page, /on-premises|on-prem/i, 'must acknowledge on-premises deployment');
    assert.match(page, /Kubernetes/i, 'must acknowledge Kubernetes deployment');
  });

  it('AT-CODEGEN-CLAIMS-009: competitive positioning matrix includes Codegen', () => {
    assert.match(matrix, /\*\*Codegen\*\*/, 'matrix must include Codegen row');
  });

  it('AT-CODEGEN-CLAIMS-010: does not claim smart model routing', () => {
    assert.doesNotMatch(page, /smart model routing/i, 'must not claim smart model routing — docs show manual selection');
  });

  it('AT-CODEGEN-CLAIMS-011: acknowledges model providers accurately', () => {
    assert.match(page, /Anthropic/i, 'must acknowledge Anthropic provider');
    assert.match(page, /OpenAI/i, 'must acknowledge OpenAI provider');
    assert.match(page, /Google/i, 'must acknowledge Google provider');
    assert.match(page, /Grok/i, 'must acknowledge Grok provider');
  });

  it('AT-CODEGEN-CLAIMS-012: acknowledges CI auto-fix capability', () => {
    assert.match(page, /auto-fix|Auto-fixer|checks auto/i, 'must acknowledge CI checks auto-fixing');
  });

  it('AT-CODEGEN-CLAIMS-013: acknowledges Claude Code integration', () => {
    assert.match(page, /Claude Code/i, 'must acknowledge Claude Code integration');
  });
});
