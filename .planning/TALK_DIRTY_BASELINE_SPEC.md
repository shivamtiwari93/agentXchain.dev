# TALK.md Dirty-Baseline Gap — Spec

## Purpose

Fix the orchestration defect where `TALK.md`, written exclusively by the orchestrator during `acceptGovernedTurn`, is not classified as an operational path. This causes the next `assignGovernedTurn` for an authoritative/proposed role to fail with a spurious "dirty baseline" error when `TALK.md` is uncommitted.

## Root Cause

`appendTalk(root, talkSection)` is called at the end of `_acceptGovernedTurnLocked()` (governed-state.js:1936). The resulting file modification is visible to `checkCleanBaseline()`, which runs during the next `assignGovernedTurn()`. Because `TALK.md` is not listed in `ORCHESTRATOR_STATE_FILES` (repo-observer.js:35-42), it passes through the `isOperationalPath()` filter and is treated as an actor-owned dirty file.

## Fix

Add `'TALK.md'` to the `ORCHESTRATOR_STATE_FILES` array in `repo-observer.js`.

This aligns with the existing design rule (repo-observer.js comment, lines 20-23):
> "These paths are written by the orchestrator during dispatch/accept cycles. They must never be attributed to agents in observation or baseline checks."

## Behavior After Fix

- `isOperationalPath('TALK.md')` returns `true`
- `checkCleanBaseline()` filters out `TALK.md` from the dirty-files list
- `captureBaseline()` excludes `TALK.md` from the dirty snapshot
- An authoritative `assignGovernedTurn` succeeds even when `TALK.md` is uncommitted from a prior acceptance

## Acceptance Tests

1. `isOperationalPath('TALK.md')` === `true`
2. `checkCleanBaseline(root, 'authoritative')` returns `{ clean: true }` when the only dirty file is `TALK.md`
3. `captureBaseline(root)` reports `clean: true` when the only dirty file is `TALK.md`
4. A full accept → assign cycle succeeds without committing `TALK.md` between turns

## Related Gaps (Not In Scope)

- `.agentxchain/reviews/` — orchestrator-written during `review_only` acceptance, not in operational prefixes. Could cause the same dirty-baseline issue if followed by an authoritative turn without a commit. Tracked for follow-up investigation.
- `.agentxchain/reports/` — orchestrator-written on run completion. Less likely to cause issues since completion is terminal, but should be audited.

## Decision

`DEC-TALK-BASELINE-001`: `TALK.md` is an orchestrator-owned collaboration log. It must be classified as an operational path so it never blocks actor-facing baseline checks.
