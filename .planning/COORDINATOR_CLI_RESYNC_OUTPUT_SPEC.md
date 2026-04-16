# Coordinator CLI Resync Output Spec

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-15

## Purpose

Freeze one truthful `multi resync` operator contract so divergence and recovery output stop collapsing into raw mismatch strings or a generic blocked reason while the dashboard already exposes typed coordinator blocker details and ordered next actions.

## Interface

- Shared helpers:
  - `getCoordinatorBlockerDetails(...)`
  - `getCoordinatorPendingGateDetails(...)`
  - `deriveCoordinatorNextActions(...)`
- CLI surface:
  - `agentxchain multi resync`

## Behavior

1. `multi resync --dry-run`
   - Human-readable output must list each mismatch under `Divergence detected (...)`.
   - Typed `run_id_mismatch` entries must be normalized onto the shared `repo_run_id_mismatch` detail contract, rendering canonical `Repo`, `Expected`, and `Actual` rows via `getCoordinatorBlockerDetails(...)`.
   - The command may keep the explicit `Run without --dry-run to resync.` handoff instead of inventing a second derived next-action list before any state changes occur.
2. Successful `multi resync`
   - Human-readable output must print `Resync complete.` plus any changed repo/barrier summaries.
   - If the coordinator still has a coherent `pending_gate`, the command must print the same canonical `Pending Gate:` detail rows used by `multi status` / `multi resume`.
   - The command must then print ordered next actions derived from the post-resync coordinator state.
   - `--json` output must expose `status`, `pending_gate`, `next_action`, and `next_actions` alongside the raw resync result fields.
3. Blocked `multi resync`
   - Human-readable output must print `Coordinator resync entered blocked state: ...`.
   - Typed mismatch rows must render through the shared blocker-detail helper instead of private `expected:` / `actual:` formatting.
   - Ordered next actions must derive from the post-resync blocked state so run-identity drift points to `agentxchain multi resume`.
4. Scope boundary
   - `multi status --json` was audited in this slice and remains unchanged. It already exposes raw coordinator state plus `next_actions`, which is the truthful contract for that command.

## Error Cases

- Mismatches without a shared typed-detail mapping must still print their message line, but must not invent fake rows.
- If post-resync state has no follow-up action, the command must omit the `Next Actions:` block rather than printing an empty heading.

## Acceptance Tests

- `AT-CLI-MR-026`: `multi resync --dry-run` with run-identity drift prints canonical `Repo` / `Expected` / `Actual` rows instead of raw private labels.
- `AT-CLI-MR-027`: blocked `multi resync` prints shared mismatch detail rows and ordered recovery next actions.
- `AT-CLI-MR-028`: successful `multi resync` prints preserved canonical `Pending Gate:` rows plus ordered next actions.
- `AT-CLI-MR-029`: successful `multi resync --json` returns `status`, `pending_gate`, `next_action`, and `next_actions`.
- `AT-DOCS-MULTI-011`: CLI docs explain the typed mismatch rows and post-resync handoff behavior.

## Open Questions

- None for this slice.
