import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..');
const vsDevinPage = readFileSync(resolve(root, 'website-v2/docs/compare/vs-devin.mdx'), 'utf8');
const devinSpec = readFileSync(resolve(root, '.planning/COMPARE_VS_DEVIN_SPEC.md'), 'utf8');

describe('Devin comparison claims truth boundary', () => {
  it('AT-DEVIN-003: acknowledges current Devin Knowledge/Playbooks surface', () => {
    assert.ok(vsDevinPage.includes('Knowledge'), 'must mention Knowledge');
    assert.ok(vsDevinPage.includes('Playbooks'), 'must mention Playbooks');
  });

  it('AT-DEVIN-003: acknowledges current Devin audit/oversight surfaces', () => {
    assert.ok(vsDevinPage.includes('session event timelines'), 'must mention session event timelines');
    assert.ok(vsDevinPage.includes('session insights'), 'must mention session insights');
    assert.ok(vsDevinPage.includes('API'), 'must mention API');
    assert.ok(vsDevinPage.includes('webhook-bridge'), 'must mention webhook-bridge automation precisely');
  });

  it('AT-DEVIN-003: acknowledges mid-session human intervention', () => {
    assert.ok(vsDevinPage.includes('mid-session'), 'must mention mid-session intervention');
  });

  it('AT-DEVIN-005: comparison table includes Knowledge, Audit surface, and API/automation rows', () => {
    assert.ok(vsDevinPage.includes('**Knowledge**'), 'must have Knowledge row');
    assert.ok(vsDevinPage.includes('**Audit surface**'), 'must have Audit surface row');
    assert.ok(vsDevinPage.includes('**API / automation**'), 'must have API/automation row');
  });

  it('AT-DEVIN-007: governance posture row exists', () => {
    assert.ok(vsDevinPage.includes('**Governance posture**'), 'must have governance posture row');
  });

  it('AT-DEVIN-008: recovery posture row exists', () => {
    assert.ok(vsDevinPage.includes('**Recovery posture**'), 'must have recovery posture row');
  });

  it('AT-DEVIN-009: multi-repo posture row exists', () => {
    assert.ok(vsDevinPage.includes('**Multi-repo posture**'), 'must have multi-repo posture row');
  });

  it('AT-DEVIN-006: rejects stale phrases', () => {
    assert.ok(!vsDevinPage.includes('Fine-tunable to specific codebases'), 'must not use stale fine-tunable phrasing');
    assert.ok(!vsDevinPage.includes('Human reviews PRs that Devin produces'), 'must not reduce Devin HITL to PR review only');
    assert.ok(!vsDevinPage.includes('devin --parallel'), 'must not use undocumented devin --parallel examples');
    assert.ok(!vsDevinPage.includes('API/webhook event notifications'), 'must not imply native webhook event notifications without source');
  });

  it('AT-DEVIN-CLAIMS-005: vs-devin exposes official source links and last-checked date', () => {
    assert.match(vsDevinPage, /Source baseline/, 'Devin page must expose the source baseline on-page');
    assert.match(vsDevinPage, /Last checked against official Devin \/ Cognition docs on 2026-04-25/);
    for (const url of [
      'https://docs.devin.ai/get-started/devin-intro',
      'https://docs.devin.ai/work-with-devin/advanced-capabilities',
      'https://docs.devin.ai/essential-guidelines/sdlc-integration',
      'https://docs.devin.ai/onboard-devin/knowledge-onboarding',
      'https://docs.devin.ai/product-guides/scheduled-sessions',
      'https://docs.devin.ai/api-reference/overview',
      'https://docs.devin.ai/api-reference/v3/sessions/organizations-sessions',
      'https://docs.devin.ai/api-reference/v3/overview',
      'https://docs.devin.ai/api-reference/release-notes',
      'https://docs.devin.ai/release-notes/overview',
      'https://devin.ai/',
    ]) {
      assert.ok(vsDevinPage.includes(url), `Devin comparison page must link to ${url}`);
    }
    assert.match(devinSpec, /AT-DEVIN-CLAIMS-005/);
    assert.match(devinSpec, /webhook-bridge automation/);
    assert.match(devinSpec, /DEC-DEVIN-COMPARE-WEBHOOK-BOUNDARY-001/);
  });
});
