/**
 * Code-backed guard for coordinator hook-stop asymmetry.
 *
 * Asserts the intentional design: pre-action hooks (before_assignment, before_gate)
 * do NOT persist blocked state; only after_acceptance does.
 *
 * DEC-HOOK-ASYMMETRY-001 through DEC-HOOK-ASYMMETRY-005
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const multiSrc = readFileSync(join(__dirname, '..', 'src', 'commands', 'multi.js'), 'utf8');
const docsSrc = readFileSync(join(__dirname, '..', '..', 'website-v2', 'docs', 'multi-repo.mdx'), 'utf8');

describe('Coordinator hook-stop asymmetry contract', () => {
  describe('Implementation truth (multi.js)', () => {
    it('blockCoordinator is called only inside after_acceptance path', () => {
      // Find all blockCoordinator() call sites (excluding the function definition)
      const callPattern = /(?<!function )blockCoordinator\(/g;
      const matches = [...multiSrc.matchAll(callPattern)];
      // Filter out the function definition line
      const callSites = matches.filter(m => {
        const lineStart = multiSrc.lastIndexOf('\n', m.index);
        const line = multiSrc.slice(lineStart, m.index + 30);
        return !line.includes('function blockCoordinator');
      });
      assert.ok(callSites.length >= 1, 'blockCoordinator must be called at least once');

      // Every call site must be near acceptanceHook usage (within 1500 chars lookback)
      for (const match of callSites) {
        const before = multiSrc.slice(Math.max(0, match.index - 1500), match.index);
        assert.ok(
          before.includes('acceptanceHook') || before.includes('after_acceptance'),
          'blockCoordinator must only be called in after_acceptance context',
        );
      }
    });

    it('before_assignment path does not call blockCoordinator', () => {
      // Extract the before_assignment handling section
      const baStart = multiSrc.indexOf('before_assignment');
      assert.ok(baStart > 0, 'before_assignment must exist in multi.js');
      const baSection = multiSrc.slice(baStart, baStart + 800);
      assert.ok(!baSection.includes('blockCoordinator('), 'before_assignment must not call blockCoordinator');
    });

    it('before_gate path does not call blockCoordinator', () => {
      const bgStart = multiSrc.indexOf('before_gate');
      assert.ok(bgStart > 0, 'before_gate must exist in multi.js');
      const bgSection = multiSrc.slice(bgStart, bgStart + 800);
      assert.ok(!bgSection.includes('blockCoordinator('), 'before_gate must not call blockCoordinator');
    });

    it('after_acceptance path calls blockCoordinator on failure', () => {
      const aaStart = multiSrc.indexOf("'after_acceptance'");
      assert.ok(aaStart > 0, 'after_acceptance must exist in multi.js');
      const aaSection = multiSrc.slice(aaStart, aaStart + 400);
      assert.ok(aaSection.includes('blockCoordinator('), 'after_acceptance must call blockCoordinator on failure');
    });

    it('fireEscalationHook is called only in blocked-state context', () => {
      const escPattern = /fireEscalationHook\(/g;
      const escMatches = [...multiSrc.matchAll(escPattern)];
      // Exclude the function definition
      const callSites = escMatches.filter(m => {
        const lineStart = multiSrc.lastIndexOf('\n', m.index);
        const line = multiSrc.slice(lineStart, m.index + 40);
        return !line.includes('function fireEscalationHook');
      });

      assert.ok(callSites.length >= 1, 'fireEscalationHook must be called at least once');

      for (const match of callSites) {
        // Use a wider window because the blocked-state proof may appear in the
        // surrounding conditional block or in the call arguments themselves.
        const contextWindow = multiSrc.slice(Math.max(0, match.index - 1200), Math.min(multiSrc.length, match.index + 200));
        const hasBlockContext = contextWindow.includes('blockCoordinator(') ||
          contextWindow.includes("status === 'blocked'") ||
          contextWindow.includes('blocked_reason') ||
          contextWindow.includes('blockedState') ||
          contextWindow.includes('blocked_resolved') ||
          contextWindow.includes('resync.blocked_reason');
        assert.ok(hasBlockContext,
          `fireEscalationHook must only fire in blocked-state context, found at offset ${match.index}`);
      }
    });

    it('before_assignment block sets process.exitCode = 1', () => {
      const baStart = multiSrc.indexOf("'before_assignment'");
      const baSection = multiSrc.slice(baStart, baStart + 600);
      assert.ok(baSection.includes('process.exitCode = 1'), 'before_assignment block must exit with code 1');
    });

    it('before_gate block sets process.exitCode = 1', () => {
      const bgStart = multiSrc.indexOf("'before_gate'");
      const bgSection = multiSrc.slice(bgStart, bgStart + 1200);
      assert.ok(bgSection.includes('process.exitCode = 1'), 'before_gate block must exit with code 1');
    });
  });

  describe('Docs truth (multi-repo.mdx)', () => {
    it('documents Hook-Stop Semantics section', () => {
      assert.ok(docsSrc.includes('### Hook-Stop Semantics'), 'multi-repo.mdx must have Hook-Stop Semantics section');
    });

    it('documents before_assignment as pre-action guard', () => {
      assert.ok(docsSrc.includes('before_assignment') && docsSrc.includes('Pre-action guard'),
        'must document before_assignment as pre-action guard');
    });

    it('documents after_acceptance as post-action audit', () => {
      assert.ok(docsSrc.includes('after_acceptance') && docsSrc.includes('Post-action audit'),
        'must document after_acceptance as post-action audit');
    });

    it('documents before_gate as pre-action guard', () => {
      assert.ok(docsSrc.includes('before_gate') && docsSrc.includes('Pre-action guard'),
        'must document before_gate as pre-action guard');
    });

    it('documents that pre-action hooks do not persist blocked state', () => {
      assert.ok(docsSrc.includes('does **not** persist `blocked` state'),
        'must document that pre-action hooks do not persist blocked state');
    });

    it('documents multi resume as the post-action recovery path', () => {
      assert.ok(docsSrc.includes('`multi resume`'),
        'must document multi resume as post-action recovery');
    });

    it('documents that pre-action blocks do not fire on_escalation', () => {
      assert.ok(docsSrc.includes('do **not** fire `on_escalation`'),
        'must document that pre-action blocks do not fire on_escalation');
    });

    it('documents recovery table with all three scenarios', () => {
      assert.ok(docsSrc.includes('before_assignment` blocks dispatch'),
        'recovery table must include before_assignment scenario');
      assert.ok(docsSrc.includes('before_gate` blocks gate approval'),
        'recovery table must include before_gate scenario');
      assert.ok(docsSrc.includes('after_acceptance` fails or detects tamper'),
        'recovery table must include after_acceptance scenario');
    });
  });
});
