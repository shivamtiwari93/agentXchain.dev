import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

function read(relativePath) {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

const SPEC_PATH = '.planning/HN_LAUNCH_SURFACE_ALIGNMENT_SPEC.md';
const HN_SUBMISSION = read('.planning/MARKETING/HN_SUBMISSION.md');
const SHOW_HN_DRAFT = read('.planning/SHOW_HN_DRAFT.md');
const SPEC = read(SPEC_PATH);
const HN_SURFACES = [
  ['HN submission', HN_SUBMISSION],
  ['Show HN draft', SHOW_HN_DRAFT],
];
const DEMO_CMD = 'npx --yes -p agentxchain@latest -c "agentxchain demo"';
const EVIDENCE_PATH = '.planning/dogfood-tusq-dev-evidence/DOGFOOD-EXTENDED-10-CYCLES-EVIDENCE-INDEX.md';

describe('HN launch surface alignment', () => {
  it('AT-HN-LAUNCH-001: spec exists and records the launch contract', () => {
    assert.ok(existsSync(join(ROOT, SPEC_PATH)), 'HN launch alignment spec must exist');
    assert.match(SPEC, /## Purpose/);
    assert.match(SPEC, /## Interface/);
    assert.match(SPEC, /## Behavior/);
    assert.match(SPEC, /## Acceptance Tests/);
    assert.match(SPEC, /AT-HN-LAUNCH-001/);
  });

  it('AT-HN-LAUNCH-002: both HN surfaces point to the current version, homepage, and package-bound demo', () => {
    for (const [label, content] of HN_SURFACES) {
      assert.match(content, /v2\.155\.22/, `${label} must name the current launch version`);
      assert.match(content, /https:\/\/agentxchain\.dev\b/, `${label} must use the homepage URL`);
      assert.match(content, new RegExp(DEMO_CMD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${label} must use the package-bound demo command`);
      assert.doesNotMatch(content, /^npx agentxchain demo$/m, `${label} must not use bare npx demo`);
    }
  });

  it('AT-HN-LAUNCH-003: both HN surfaces include durable dogfood proof anchors', () => {
    for (const [label, content] of HN_SURFACES) {
      assert.match(content, /10-cycle governed dogfood/i, `${label} must name the 10-cycle dogfood proof`);
      assert.match(content, /987 lines product code/i, `${label} must include the product-code count`);
      assert.match(content, /42 checkpoint commits/i, `${label} must include the checkpoint count`);
      assert.match(content, /all 4 phases per cycle/i, `${label} must include phase traversal proof`);
      assert.match(content, new RegExp(EVIDENCE_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${label} must reference the durable evidence index`);
    }
  });

  it('AT-HN-LAUNCH-004: HN surfaces reject stale beta-cycle proof claims', () => {
    for (const [label, content] of HN_SURFACES) {
      assert.doesNotMatch(content, /v2\.149\.[12]/, `${label} must not describe stale v2.149.x launch copy`);
      assert.doesNotMatch(content, /pending tester verification/i, `${label} must not describe closed proof as pending`);
      assert.doesNotMatch(content, /108 conformance fixtures/i, `${label} must not retain stale proof counts`);
      assert.doesNotMatch(content, /172 tests/i, `${label} must not retain stale beta test counts`);
    }
  });

  it('AT-HN-LAUNCH-005: next exact posting window uses the correct weekday', () => {
    assert.match(SHOW_HN_DRAFT, /Wednesday 2026-04-29, 10-11am ET/);
    assert.doesNotMatch(SHOW_HN_DRAFT, /Tuesday 2026-04-29/);
  });
});
