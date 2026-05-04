# Release Notes — M10: Cross-Run Scope Overlap Guard

**Run:** run_2e96850371ff1a1c
**Version:** agentxchain@2.155.72

## Summary

New cross-run scope overlap detection prevents the continuous loop from spawning runs whose charter semantically overlaps with active or recently completed work. Uses Jaccard similarity on extracted charter tokens (milestone refs, bug refs, file paths, module keywords) with a configurable threshold (default 0.4). Overlap is advisory/deferring — the continuous loop returns idle for overlapping intents, and operators can bypass with `--force-scope`.

## What Changed

### New Module: `cli/src/lib/scope-overlap.js`

- `extractScopeFingerprint(text)` — Extracts normalized tokens from charter/acceptance text: M-prefixed milestones, BUG-prefixed refs, MW, file paths, and significant keywords (>3 chars, stop-word and template-noise filtered)
- `computeScopeOverlap(a, b)` — Jaccard similarity between two fingerprint sets
- `checkIntentScopeOverlap(root, charter, acceptanceContract, options)` — Compares candidate intent against active run and recent completed intents

### Integration Points

- **intake.js `approveIntent()`** — Scope overlap guard fires after status check, before approval. Returns `scope_overlap_detected` error with overlap details when threshold exceeded
- **continuous-run.js `seedFromVision()`** — Three auto-approval sites (roadmap-derived, roadmap-replenishment, vision-derived) handle `scope_overlap_detected` by returning idle with `deferred_reason: 'scope_overlap'`
- **CLI `intake approve --force-scope`** — Bypasses the scope overlap guard for manual operator override

### Files Changed

| File | Change |
|------|--------|
| `cli/src/lib/scope-overlap.js` | New module (3 exports) |
| `cli/src/lib/intake.js` | Static import + scope guard in approveIntent() |
| `cli/src/lib/continuous-run.js` | Handle scope_overlap_detected at 3 seedFromVision() sites |
| `cli/src/commands/intake-approve.js` | Pass forceScope option |
| `cli/bin/agentxchain.js` | Add --force-scope CLI option |
| `cli/test/scope-overlap.test.js` | 10 acceptance tests |

## User Impact

- **Continuous loop operators:** Overlapping charters are now automatically deferred until prior work completes, preventing redundant runs. No configuration changes required — the guard activates automatically with default threshold 0.4.
- **Manual approval operators:** `agentxchain intake approve --force-scope` bypasses the guard when deliberate overlap is intended.
- **Existing workflows:** No breaking changes. The guard is advisory/deferring, not blocking. All existing event deduplication, M5 parallel conflict detection, and vision candidate derivation remain untouched.

## Verification Summary

QA independently verified all 10 SYSTEM_SPEC acceptance criteria (AT-SOG-001 through AT-SOG-010):

- **Fingerprint extraction** (AT-SOG-001 to AT-SOG-003): Milestone refs, bug refs, module keywords extracted correctly. Stop words and short tokens filtered.
- **Jaccard computation** (AT-SOG-004 to AT-SOG-006): Disjoint (0), identical (1), partial overlap (0.5) all correct.
- **Overlap detection** (AT-SOG-007 to AT-SOG-009): Distinct charters return non-overlapping. Active run overlap detected. Completed intent overlap detected.
- **End-to-end** (AT-SOG-010): approveIntent returns scope_overlap_detected without forceScope, succeeds with forceScope=true.

Test execution: 10/10 scope-overlap, 21/21 intake, 90/90 continuous-run, 51/51 intake-approve-plan + vision-reader. Total 172 tests, 0 failures. Exit code 0 for all commands.
