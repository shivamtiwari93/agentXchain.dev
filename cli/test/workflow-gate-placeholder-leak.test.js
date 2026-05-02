import { describe, it, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  evaluateWorkflowGateSemantics,
  evaluateArtifactSemantics,
  SYSTEM_SPEC_PATH,
} from '../src/lib/workflow-gate-semantics.js';

describe('Workflow gate placeholder leak prevention', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'wg-placeholder-'));
    mkdirSync(join(root, '.planning'), { recursive: true });
  });

  // ── evaluateSectionCheck ──────────────────────────────────────────────

  describe('evaluateSectionCheck placeholder rejection', () => {
    const architectureArtifact = {
      path: '.planning/ARCHITECTURE.md',
      semantics: 'section_check',
      semantics_config: {
        required_sections: ['## Context', '## Proposed Design', '## Trade-offs', '## Risks'],
      },
    };

    it('AT-WGPL-001: rejects artifact where all required sections contain only (Content here.)', () => {
      writeFileSync(
        join(root, '.planning', 'ARCHITECTURE.md'),
        `# Architecture\n\n## Context\n\n(Content here.)\n\n## Proposed Design\n\n(Content here.)\n\n## Trade-offs\n\n(Content here.)\n\n## Risks\n\n(Content here.)\n`
      );

      const result = evaluateArtifactSemantics(root, architectureArtifact);
      assert.ok(result);
      assert.equal(result.ok, false);
      assert.ok(result.reason.includes('placeholder'), `Expected placeholder mention, got: ${result.reason}`);
    });

    it('AT-WGPL-001b: rejects artifact where sections contain only (Operator fills this in.)', () => {
      writeFileSync(
        join(root, '.planning', 'ARCHITECTURE.md'),
        `# Architecture\n\n## Context\n\n(Operator fills this in.)\n\n## Proposed Design\n\n(Operator fills this in.)\n\n## Trade-offs\n\n(Operator fills this in.)\n\n## Risks\n\n(Operator fills this in.)\n`
      );

      const result = evaluateArtifactSemantics(root, architectureArtifact);
      assert.ok(result);
      assert.equal(result.ok, false);
      assert.ok(result.reason.includes('placeholder'));
    });

    it('AT-WGPL-002: accepts artifact where required sections have real content', () => {
      writeFileSync(
        join(root, '.planning', 'ARCHITECTURE.md'),
        `# Architecture\n\n## Context\n\nWe need a caching layer to reduce API latency.\n\n## Proposed Design\n\nRedis-backed LRU cache with 5-minute TTL.\n\n## Trade-offs\n\nAdds operational complexity but reduces p99 by 40%.\n\n## Risks\n\nCache invalidation bugs could serve stale data.\n`
      );

      const result = evaluateArtifactSemantics(root, architectureArtifact);
      assert.ok(result);
      assert.equal(result.ok, true);
    });

    it('AT-WGPL-002b: rejects when some sections are real and some are placeholder', () => {
      writeFileSync(
        join(root, '.planning', 'ARCHITECTURE.md'),
        `# Architecture\n\n## Context\n\nReal context about the problem.\n\n## Proposed Design\n\n(Content here.)\n\n## Trade-offs\n\nReal trade-off analysis.\n\n## Risks\n\n(Content here.)\n`
      );

      const result = evaluateArtifactSemantics(root, architectureArtifact);
      assert.ok(result);
      assert.equal(result.ok, false);
      assert.ok(result.reason.includes('## Proposed Design'));
      assert.ok(result.reason.includes('## Risks'));
    });
  });

  // ── evaluateSystemSpec ────────────────────────────────────────────────

  describe('evaluateSystemSpec placeholder rejection', () => {
    it('AT-WGPL-003: rejects SYSTEM_SPEC.md containing only scaffold guidance placeholders', () => {
      writeFileSync(
        join(root, '.planning', 'SYSTEM_SPEC.md'),
        `# System Spec — TestProject\n\n## Purpose\n\n(Describe the problem this slice solves and why it exists.)\n\n## Interface\n\n(List the user-facing commands, files, APIs, or contracts this slice changes.)\n\n## Behavior\n\n(Describe the expected behavior, including important edge cases.)\n\n## Error Cases\n\n(List the failure modes and how the system should respond.)\n\n## Acceptance Tests\n\n- [ ] Name the executable checks that prove this slice works.\n\n## Open Questions\n\n- (Capture unresolved product or implementation questions here.)\n`
      );

      const result = evaluateWorkflowGateSemantics(root, SYSTEM_SPEC_PATH);
      assert.ok(result);
      assert.equal(result.ok, false);
      assert.ok(result.reason.includes('placeholder'), `Expected placeholder mention, got: ${result.reason}`);
    });

    it('AT-WGPL-003b: rejects when Purpose is real but Interface and Acceptance Tests are placeholder', () => {
      writeFileSync(
        join(root, '.planning', 'SYSTEM_SPEC.md'),
        `# System Spec — TestProject\n\n## Purpose\n\nAdd a rate-limiting middleware to protect the API from abuse.\n\n## Interface\n\n(List the user-facing commands, files, APIs, or contracts this slice changes.)\n\n## Acceptance Tests\n\n- [ ] Name the executable checks that prove this slice works.\n`
      );

      const result = evaluateWorkflowGateSemantics(root, SYSTEM_SPEC_PATH);
      assert.ok(result);
      assert.equal(result.ok, false);
      assert.ok(result.reason.includes('## Interface'));
      assert.ok(result.reason.includes('## Acceptance Tests'));
    });

    it('AT-WGPL-004: accepts SYSTEM_SPEC.md where sections have real content', () => {
      writeFileSync(
        join(root, '.planning', 'SYSTEM_SPEC.md'),
        `# System Spec — TestProject\n\n## Purpose\n\nAdd a rate-limiting middleware to protect the API from abuse.\n\n## Interface\n\n- POST /api/* endpoints get a 429 response after 100 requests per minute per IP.\n- GET /api/health is exempt from rate limiting.\n\n## Behavior\n\nThe middleware uses a sliding window counter stored in Redis.\n\n## Error Cases\n\n- If Redis is unavailable, the middleware fails open (allows all requests).\n\n## Acceptance Tests\n\n- [ ] 101st request within 60s returns HTTP 429\n- [ ] /api/health always returns HTTP 200 regardless of rate\n\n## Open Questions\n\n- Should rate limits be configurable per-tenant?\n`
      );

      const result = evaluateWorkflowGateSemantics(root, SYSTEM_SPEC_PATH);
      assert.ok(result);
      assert.equal(result.ok, true);
    });

    it('AT-WGPL-005: real content with parenthetical text mid-line passes (not a scaffold placeholder)', () => {
      writeFileSync(
        join(root, '.planning', 'SYSTEM_SPEC.md'),
        `# System Spec — TestProject\n\n## Purpose\n\nThe auth module (described in RFC-12) needs rate limiting.\n\n## Interface\n\nThe middleware wraps Express routes (see docs for details).\n\n## Acceptance Tests\n\n- [ ] POST /login returns 429 after threshold\n`
      );

      const result = evaluateWorkflowGateSemantics(root, SYSTEM_SPEC_PATH);
      assert.ok(result);
      assert.equal(result.ok, true);
    });
  });
});
