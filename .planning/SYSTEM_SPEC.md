# System Spec — M10: Cross-Run Scope Overlap Guard

**Run:** `run_2e96850371ff1a1c`
**Baseline:** git:187f3cb4d (latest checkpoint)
**Package version:** `agentxchain@2.155.72`

## Purpose

Prevent the continuous loop from spawning runs whose scope semantically overlaps with recently completed or currently active work. The existing event-level dedup (`computeDedupKey` in intake.js:64) catches identical signals but NOT semantically overlapping charters. This module adds charter-level overlap detection at `approveIntent()` time, causing the continuous loop to defer overlapping intents until the prior work clears.

This directly addresses VISION.md:30 ("work overlaps") — the cross-run dimension that M5's intra-run `classifyAcceptanceOverlap()` does not cover.

---

## Interface

### New Module: `cli/src/lib/scope-overlap.js`

```javascript
/**
 * Extract a scope fingerprint from charter/acceptance text.
 *
 * Extracts normalized significant tokens:
 * - Milestone references: M1, M2, ..., M10 (case-insensitive)
 * - Bug references: BUG-54, BUG-78, etc.
 * - MW reference (workflow kit milestone)
 * - File paths: patterns matching cli/src/..., cli/test/..., .planning/...
 * - Module keywords: significant words (>3 chars) after stop-word removal
 *
 * @param {string} text - Charter and/or acceptance contract text (concatenated)
 * @returns {Set<string>} - Set of normalized lowercase tokens
 */
export function extractScopeFingerprint(text)

/**
 * Compute Jaccard similarity between two scope fingerprints.
 *
 * Jaccard = |A ∩ B| / |A ∪ B|
 * Returns 0 when both sets are empty (no overlap by definition).
 *
 * @param {Set<string>} a - First fingerprint
 * @param {Set<string>} b - Second fingerprint
 * @returns {number} - Similarity score between 0.0 and 1.0
 */
export function computeScopeOverlap(a, b)

/**
 * Check if an intent's charter overlaps with active or recent work.
 *
 * Loads:
 * 1. Active run's charter from .agentxchain/state.json (intake_context.charter
 *    on any active turn, or provenance.trigger_reason)
 * 2. Recent completed intents from .agentxchain/intake/intents/*.json
 *    (status in ['completed', 'satisfied'], last N by updated_at)
 *
 * @param {string} root - Project root
 * @param {string} charter - The candidate intent's charter text
 * @param {string[]} acceptanceContract - The candidate intent's acceptance items
 * @param {object} [options]
 * @param {number} [options.threshold=0.4] - Jaccard score above which overlap is reported
 * @param {number} [options.lookbackIntents=10] - Max recent completed intents to check
 * @returns {{ overlapping: boolean, matches: Array<{ source: string, charter: string, score: number }>, max_score: number }}
 */
export function checkIntentScopeOverlap(root, charter, acceptanceContract, options = {})
```

### Fingerprint Extraction Rules

1. **Milestone refs:** Match `/\bM\d+\b/gi` → normalize to lowercase (`m5`, `m10`)
2. **Bug refs:** Match `/\bBUG-\d+\b/gi` → normalize to lowercase (`bug-78`)
3. **MW ref:** Match `/\bMW\b/gi` → `mw`
4. **File paths:** Match `/(?:cli\/(?:src|test|bin)\/\S+|\.planning\/\S+)/g` → as-is, lowercase
5. **Module keywords:** Split remaining text on whitespace and punctuation, lowercase, filter:
   - Length > 3 characters
   - Not in stop words set (reuse or align with `vision-reader.js:155` STOP_WORDS)
   - Not pure numbers

### Overlap Check Algorithm

```
candidateText = charter + ' ' + acceptanceContract.join(' ')
candidateFP = extractScopeFingerprint(candidateText)

if candidateFP.size === 0:
  return { overlapping: false, matches: [], max_score: 0 }

matches = []

// 1. Check active run
state = loadProjectState(root)
if state && state.status === 'active':
  activeCharter = extractActiveRunCharter(state)
  if activeCharter:
    activeFP = extractScopeFingerprint(activeCharter)
    score = computeScopeOverlap(candidateFP, activeFP)
    if score > 0:
      matches.push({ source: 'active_run', charter: activeCharter, score })

// 2. Check recent completed intents
recentIntents = loadRecentCompletedIntents(root, options.lookbackIntents)
for intent of recentIntents:
  intentText = (intent.charter || '') + ' ' + (intent.acceptance_contract || []).join(' ')
  intentFP = extractScopeFingerprint(intentText)
  score = computeScopeOverlap(candidateFP, intentFP)
  if score > 0:
    matches.push({ source: `intent:${intent.intent_id}`, charter: intent.charter, score })

max_score = Math.max(0, ...matches.map(m => m.score))
return { overlapping: max_score >= threshold, matches, max_score }
```

### Helper: `extractActiveRunCharter(state)`

Extract charter text from state.json. Check in order:
1. First active turn's `intake_context.charter` (from `state.active_turns`)
2. `state.provenance.trigger_reason`

Return the first non-empty value found, or `null`.

### Helper: `loadRecentCompletedIntents(root, limit)`

Read `.agentxchain/intake/intents/*.json`, filter to `status in ['completed', 'satisfied']`, sort by `updated_at` descending, take first `limit` entries.

---

## Integration Point 1: `cli/src/lib/intake.js` — `approveIntent()`

### Location

After the status check (line 886) and before the approver assignment (line 889).

### Insertion

```javascript
// --- Scope overlap guard (M10) ---
if (!options.forceScope) {
  const { checkIntentScopeOverlap } = await import('./scope-overlap.js');
  // Build charter text from intent (charter may be set during triage, not yet on intent at approve time)
  const charterText = intent.charter || '';
  const acceptanceItems = Array.isArray(intent.acceptance_contract) ? intent.acceptance_contract : [];
  if (charterText) {
    const overlapCheck = checkIntentScopeOverlap(root, charterText, acceptanceItems, {
      threshold: options.scopeOverlapThreshold ?? 0.4,
    });
    if (overlapCheck.overlapping) {
      return {
        ok: false,
        error: 'scope_overlap_detected',
        overlap: overlapCheck,
        exitCode: 3,
      };
    }
  }
}
```

**Note on import style:** If the codebase prefers static imports (check top of intake.js), use a static import at the top instead of dynamic `await import`. Since `approveIntent` is currently synchronous, and the `checkIntentScopeOverlap` function is also synchronous (file reads only), use a static import:

```javascript
import { checkIntentScopeOverlap } from './scope-overlap.js';
```

Add this with the other imports at the top of intake.js (around line 1-30).

### Important: Intent Charter Availability

The `charter` field is set during `triageIntent()` (not `approveIntent()`). By the time `approveIntent()` runs, `intent.charter` should already be populated. Verify this by checking that triaged intents have charter set before approval.

---

## Integration Point 2: `cli/src/lib/continuous-run.js` — `seedFromVision()`

### Location

Three auto-approval call sites. At each site, handle the `scope_overlap_detected` error by returning idle.

### Site 1: Roadmap-derived (line 1324-1331)

Current code:
```javascript
const approveResult = approveIntent(root, intentId, {
  approver: 'continuous_loop',
  reason: 'roadmap-open-work auto-approval',
});
if (!approveResult.ok) {
  return { ok: false, error: `approve failed: ${approveResult.error}` };
}
```

Change to:
```javascript
const approveResult = approveIntent(root, intentId, {
  approver: 'continuous_loop',
  reason: 'roadmap-open-work auto-approval',
});
if (!approveResult.ok) {
  if (approveResult.error === 'scope_overlap_detected') {
    return { ok: true, idle: true, deferred_reason: 'scope_overlap', overlap: approveResult.overlap };
  }
  return { ok: false, error: `approve failed: ${approveResult.error}` };
}
```

### Site 2: Roadmap-replenishment (line 1399-1405)

Same pattern — add scope_overlap_detected check before the generic error return.

### Site 3: Vision-derived (line 1482-1488)

Same pattern — add scope_overlap_detected check before the generic error return.

---

## Integration Point 3: CLI — `intake approve --force-scope`

### `cli/bin/agentxchain.js` (around line 1041)

Add option:
```javascript
.option('--force-scope', 'Bypass scope overlap guard')
```

### `cli/src/commands/intake-approve.js` (line 18)

Pass through:
```javascript
const result = approveIntent(root, opts.intent, {
  approver: opts.approver || undefined,
  reason: opts.reason || undefined,
  forceScope: opts.forceScope || false,
});
```

---

## Dev Charter

### Scope

1. Create `cli/src/lib/scope-overlap.js` with the three exported functions
2. Add static import of `checkIntentScopeOverlap` to `cli/src/lib/intake.js`
3. Insert scope overlap guard in `approveIntent()` at the specified location
4. Handle `scope_overlap_detected` at 3 sites in `seedFromVision()` in `cli/src/lib/continuous-run.js`
5. Add `--force-scope` option to CLI and command handler
6. Create `cli/test/scope-overlap.test.js` with 10 tests

### Files Changed (Expected)

| File | Change |
|------|--------|
| `cli/src/lib/scope-overlap.js` | New module |
| `cli/src/lib/intake.js` | Import + guard in `approveIntent()` |
| `cli/src/lib/continuous-run.js` | Handle `scope_overlap_detected` at 3 sites |
| `cli/src/commands/intake-approve.js` | Pass `forceScope` option |
| `cli/bin/agentxchain.js` | Add `--force-scope` CLI option |
| `cli/test/scope-overlap.test.js` | New test file |

### Architecture Invariants

1. **No changes to M5 parallel conflict detection** — `classifyAcceptanceOverlap()` in governed-state.js is untouched
2. **No changes to event deduplication** — `computeDedupKey()` in intake.js is untouched
3. **No changes to vision candidate derivation** — `isGoalAddressed()` and `deriveVisionCandidates()` in vision-reader.js are untouched
4. **Overlap is deferring, not blocking** — `approveIntent()` returns error, continuous loop returns idle, operator can `--force-scope`
5. **Synchronous implementation** — All functions use synchronous file reads (matching intake.js patterns)
6. **No new dependencies** — Uses only `node:fs`, `node:path`, existing project utilities

---

## Acceptance Tests

| # | Test ID | Description | Expected |
|---|---------|-------------|----------|
| 1 | AT-SOG-001 | `extractScopeFingerprint` extracts milestone refs (M1, M5, M10) | Set contains `m1`, `m5`, `m10` |
| 2 | AT-SOG-002 | `extractScopeFingerprint` extracts bug refs and module keywords | Set contains `bug-78`, `connector`, `validator` etc. |
| 3 | AT-SOG-003 | `extractScopeFingerprint` strips stop words and short tokens | Set does NOT contain `the`, `and`, `is`, `a` |
| 4 | AT-SOG-004 | `computeScopeOverlap` returns 0 for disjoint sets | `computeScopeOverlap(new Set(['a','b']), new Set(['c','d'])) === 0` |
| 5 | AT-SOG-005 | `computeScopeOverlap` returns 1 for identical sets | `computeScopeOverlap(new Set(['a','b']), new Set(['a','b'])) === 1` |
| 6 | AT-SOG-006 | `computeScopeOverlap` returns correct Jaccard for partial overlap | `{a,b,c}` vs `{b,c,d}` → 2/4 = 0.5 |
| 7 | AT-SOG-007 | `checkIntentScopeOverlap` returns non-overlapping for distinct charters | `overlapping === false` for unrelated charters |
| 8 | AT-SOG-008 | `checkIntentScopeOverlap` detects overlap with active run charter | `overlapping === true`, `matches` includes `source: 'active_run'` |
| 9 | AT-SOG-009 | `checkIntentScopeOverlap` detects overlap with recently completed intent | `overlapping === true`, `matches` includes `source: 'intent:...'` |
| 10 | AT-SOG-010 | `approveIntent` returns `scope_overlap_detected` when threshold exceeded, `forceScope` bypasses | Two assertions: error without force, ok with force |

---

## Verification Commands

```bash
# Dev verification
cd cli && npx vitest run test/scope-overlap.test.js
cd cli && npx vitest run test/intake.test.js
cd cli && npx vitest run test/continuous-run.test.js

# QA verification (same + broader regression)
cd cli && npx vitest run test/scope-overlap.test.js
cd cli && npx vitest run test/intake.test.js test/continuous-run.test.js test/vision-reader.test.js
```

---

## Key Architecture Invariants (Verification Checklist)

QA should confirm each invariant still holds:

1. [ ] `extractScopeFingerprint` extracts M-prefixed, BUG-prefixed, and MW tokens
2. [ ] `extractScopeFingerprint` extracts file path patterns (cli/src/..., .planning/...)
3. [ ] `computeScopeOverlap` handles empty sets (returns 0, no division by zero)
4. [ ] `checkIntentScopeOverlap` reads state.json for active run charter
5. [ ] `checkIntentScopeOverlap` reads intake/intents/*.json for completed intents
6. [ ] `approveIntent` scope guard fires before approval, after status check
7. [ ] `approveIntent` scope guard skipped when `forceScope: true`
8. [ ] `seedFromVision` returns idle (not error) on scope overlap
9. [ ] No changes to governed-state.js or turn-result-validator.js
10. [ ] No changes to vision-reader.js or event deduplication
