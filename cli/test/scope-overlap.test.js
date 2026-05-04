import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractScopeFingerprint, computeScopeOverlap, checkIntentScopeOverlap } from '../src/lib/scope-overlap.js';
import { approveIntent, recordEvent, triageIntent } from '../src/lib/intake.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function createTestProject() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-scope-overlap-'));
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({
    project: 'test-scope-overlap',
    protocol_mode: 'governed',
    version: '1.0',
  }, null, 2));
  mkdirSync(join(dir, '.agentxchain', 'intake', 'intents'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain', 'intake', 'events'), { recursive: true });
  return dir;
}

function writeState(dir, state) {
  writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2));
}

function writeIntent(dir, intent) {
  writeFileSync(
    join(dir, '.agentxchain', 'intake', 'intents', `${intent.intent_id}.json`),
    JSON.stringify(intent, null, 2),
  );
}

// ── AT-SOG-001: extractScopeFingerprint extracts milestone refs ──────────────

describe('scope-overlap', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTestProject();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('AT-SOG-001: extractScopeFingerprint extracts milestone refs (M1, M5, M10)', () => {
    const fp = extractScopeFingerprint('Implement M1 ghost elimination and M5 parallel support plus M10 overlap guard');
    assert.ok(fp.has('m1'), 'should contain m1');
    assert.ok(fp.has('m5'), 'should contain m5');
    assert.ok(fp.has('m10'), 'should contain m10');
  });

  it('AT-SOG-002: extractScopeFingerprint extracts bug refs and module keywords', () => {
    const fp = extractScopeFingerprint('Fix BUG-78 in the connector validator module and BUG-54 ghost detection');
    assert.ok(fp.has('bug-78'), 'should contain bug-78');
    assert.ok(fp.has('bug-54'), 'should contain bug-54');
    assert.ok(fp.has('connector'), 'should contain keyword connector');
    assert.ok(fp.has('validator'), 'should contain keyword validator');
    assert.ok(fp.has('ghost'), 'should contain keyword ghost');
    assert.ok(fp.has('detection'), 'should contain keyword detection');
  });

  it('AT-SOG-003: extractScopeFingerprint strips stop words and short tokens', () => {
    const fp = extractScopeFingerprint('the validator is on a module and it should be fixed');
    assert.ok(!fp.has('the'), 'should not contain "the"');
    assert.ok(!fp.has('and'), 'should not contain "and"');
    assert.ok(!fp.has('is'), 'should not contain "is"');
    assert.ok(!fp.has('a'), 'should not contain "a"');
    assert.ok(!fp.has('on'), 'should not contain "on"');
    assert.ok(!fp.has('it'), 'should not contain "it"');
    // Should contain significant words
    assert.ok(fp.has('validator'), 'should contain "validator"');
    assert.ok(fp.has('module'), 'should contain "module"');
    assert.ok(fp.has('fixed'), 'should contain "fixed"');
  });

  it('AT-SOG-004: computeScopeOverlap returns 0 for disjoint sets', () => {
    const score = computeScopeOverlap(new Set(['a', 'b']), new Set(['c', 'd']));
    assert.equal(score, 0);
  });

  it('AT-SOG-005: computeScopeOverlap returns 1 for identical sets', () => {
    const score = computeScopeOverlap(new Set(['a', 'b']), new Set(['a', 'b']));
    assert.equal(score, 1);
  });

  it('AT-SOG-006: computeScopeOverlap returns correct Jaccard for partial overlap', () => {
    // {a,b,c} vs {b,c,d} → intersection=2, union=4 → 0.5
    const score = computeScopeOverlap(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd']));
    assert.equal(score, 0.5);
  });

  it('AT-SOG-007: checkIntentScopeOverlap returns non-overlapping for distinct charters', () => {
    // Write a completed intent about connectors
    writeIntent(tmpDir, {
      intent_id: 'intent_001_abcd',
      status: 'completed',
      charter: 'Add Windsurf connector with IDE detection',
      acceptance_contract: ['Windsurf detected by doctor'],
      updated_at: '2026-05-01T00:00:00Z',
    });

    // Check a completely unrelated charter
    const result = checkIntentScopeOverlap(
      tmpDir,
      'Implement CI pipeline reporter with JUnit XML output',
      ['CI report generates valid XML'],
    );

    assert.equal(result.overlapping, false);
    assert.equal(result.max_score < 0.4, true, `max_score ${result.max_score} should be below 0.4`);
  });

  it('AT-SOG-008: checkIntentScopeOverlap detects overlap with active run charter', () => {
    // Write active state with a charter about scope overlap
    writeState(tmpDir, {
      status: 'active',
      run_id: 'run_test_001',
      active_turns: [{
        turn_id: 'turn_001',
        intake_context: {
          charter: 'Implement scope overlap guard for cross-run detection using Jaccard similarity',
        },
      }],
    });

    // Check a charter that overlaps significantly
    const result = checkIntentScopeOverlap(
      tmpDir,
      'Add scope overlap detection with Jaccard coefficient for cross-run charter matching',
      ['Scope overlap guard prevents duplicate runs'],
    );

    assert.equal(result.overlapping, true);
    assert.ok(result.matches.some(m => m.source === 'active_run'), 'should match active_run');
    assert.ok(result.max_score >= 0.4, `max_score ${result.max_score} should be >= 0.4`);
  });

  it('AT-SOG-009: checkIntentScopeOverlap detects overlap with recently completed intent', () => {
    // Write a completed intent about connector validation
    writeIntent(tmpDir, {
      intent_id: 'intent_002_efgh',
      status: 'completed',
      charter: 'Add Windsurf connector with detection probe and doctor annotation',
      acceptance_contract: ['Windsurf connector detected', 'Doctor passes for Windsurf'],
      updated_at: '2026-05-03T00:00:00Z',
    });

    // Check a charter that overlaps (same connector work)
    const result = checkIntentScopeOverlap(
      tmpDir,
      'Implement Windsurf connector detection and doctor integration',
      ['Windsurf detected by doctor annotation'],
    );

    assert.equal(result.overlapping, true);
    assert.ok(result.matches.some(m => m.source === 'intent:intent_002_efgh'), 'should match completed intent');
    assert.ok(result.max_score >= 0.4, `max_score ${result.max_score} should be >= 0.4`);
  });

  it('AT-SOG-011: extractScopeFingerprint strips template noise words to prevent false overlap', () => {
    // Template noise words (vision, goal, addressed, section) appear in every
    // vision-derived charter template and were creating false overlap (DEC-002
    // from original M10 delivery). They must be stripped.
    const fp = extractScopeFingerprint('vision goal addressed section connector validator');
    assert.ok(!fp.has('vision'), 'should not contain template noise "vision"');
    assert.ok(!fp.has('goal'), 'should not contain template noise "goal"');
    assert.ok(!fp.has('addressed'), 'should not contain template noise "addressed"');
    assert.ok(!fp.has('section'), 'should not contain template noise "section"');
    // Real keywords should survive
    assert.ok(fp.has('connector'), 'should contain real keyword "connector"');
    assert.ok(fp.has('validator'), 'should contain real keyword "validator"');
  });

  it('AT-SOG-012: checkIntentScopeOverlap skips comparison when fingerprint is below minimum size', () => {
    // Charters with fewer than 3 tokens after filtering should not trigger
    // overlap detection (minimum fingerprint size guard at scope-overlap.js:175).
    writeIntent(tmpDir, {
      intent_id: 'intent_min_fp',
      status: 'completed',
      charter: 'the and it',  // all stop words → empty fingerprint
      acceptance_contract: [],
      updated_at: '2026-05-03T00:00:00Z',
    });

    // Candidate also has very few meaningful tokens
    const result = checkIntentScopeOverlap(tmpDir, 'ab cd', []);
    assert.equal(result.overlapping, false, 'should not overlap with minimal fingerprint');
    assert.equal(result.matches.length, 0, 'should have no matches');
  });

  it('AT-SOG-010: approveIntent returns scope_overlap_detected when threshold exceeded, forceScope bypasses', () => {
    // Create a completed intent with specific scope
    writeIntent(tmpDir, {
      intent_id: 'intent_003_ijkl',
      status: 'completed',
      charter: 'M10 scope overlap guard with Jaccard similarity detection in intake approval',
      acceptance_contract: ['scope overlap guard blocks duplicate charters', 'Jaccard similarity threshold enforced'],
      updated_at: '2026-05-02T00:00:00Z',
    });

    // Create a triaged intent with nearly identical charter (high overlap)
    const triagedIntentId = 'intent_004_mnop';
    writeIntent(tmpDir, {
      intent_id: triagedIntentId,
      status: 'triaged',
      charter: 'M10 scope overlap detection with Jaccard similarity guard in intake approval',
      acceptance_contract: ['scope overlap detection blocks overlapping charters', 'Jaccard similarity threshold validated'],
      created_at: '2026-05-03T00:00:00Z',
      updated_at: '2026-05-03T00:00:00Z',
      history: [{ from: null, to: 'triaged', at: '2026-05-03T00:00:00Z' }],
    });

    // Attempt approval without forceScope — should fail with scope_overlap_detected
    const result1 = approveIntent(tmpDir, triagedIntentId, {
      approver: 'test',
      reason: 'test overlap detection',
    });
    assert.equal(result1.ok, false);
    assert.equal(result1.error, 'scope_overlap_detected');
    assert.ok(result1.overlap, 'should include overlap details');
    assert.equal(result1.exitCode, 3);

    // Re-read the intent (it should still be triaged since approval failed)
    const intentAfterFail = JSON.parse(
      readFileSync(join(tmpDir, '.agentxchain', 'intake', 'intents', `${triagedIntentId}.json`), 'utf8'),
    );
    assert.equal(intentAfterFail.status, 'triaged', 'intent should remain triaged after overlap rejection');

    // Attempt approval with forceScope — should succeed
    const result2 = approveIntent(tmpDir, triagedIntentId, {
      approver: 'test',
      reason: 'test force override',
      forceScope: true,
    });
    assert.equal(result2.ok, true);
  });
});
