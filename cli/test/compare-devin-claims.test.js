import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..');
const vsDevinPage = readFileSync(resolve(root, 'website-v2/docs/compare/vs-devin.mdx'), 'utf8');

describe('Devin comparison claims truth boundary', () => {
  it('AT-DEVIN-003: acknowledges current Devin Knowledge/Playbooks surface', () => {
    assert.ok(vsDevinPage.includes('Knowledge'), 'must mention Knowledge');
    assert.ok(vsDevinPage.includes('Playbooks'), 'must mention Playbooks');
  });

  it('AT-DEVIN-003: acknowledges current Devin audit/oversight surfaces', () => {
    assert.ok(vsDevinPage.includes('session replay'), 'must mention session replay');
    assert.ok(vsDevinPage.includes('action logs'), 'must mention action logs');
    assert.ok(vsDevinPage.includes('API'), 'must mention API');
    assert.ok(vsDevinPage.includes('webhook'), 'must mention webhooks');
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
  });
});
