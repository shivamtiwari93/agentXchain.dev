# BUG-74: charter_materialization_pending not set when a new run starts from idle-expansion intake

## Status: FIXED (v2.155.21)

## Discovery

Found during DOGFOOD-EXTENDED-10-CYCLES cycle 03 on `agentxchain@2.155.20`.

After cycle 02 completed, the continuous perpetual loop auto-approved idle-expansion intent `intent_1777117477235_c5f2` (M29: Auth Scheme Classification) and started a new governed run (`run_44a179ccf81697c3`). The PM turn received the full intake context (11 acceptance criteria, charter text) but `charter_materialization_pending` was `false` in the initial state.

Result: the PM prompt did NOT include the "You MUST create or update these planning artifacts" directive from `dispatch-bundle.js:305-333`. The PM attempted to request `phase_transition_request: "implementation"` without modifying `PM_SIGNOFF.md`, `ROADMAP.md`, `SYSTEM_SPEC.md`, or `command-surface.md`. Acceptance correctly rejected (planning_signoff gate failing).

Three PM attempts all failed with the same pattern:
- **Attempt 1:** Intent coverage incomplete — PM addressed only 3 of 11 acceptance criteria
- **Attempt 2:** PM produced an `idle_expansion_result` instead of charter materialization (wrong output format entirely)
- **Attempt 3:** PM requested phase transition without modifying any gate artifacts

## Root Cause

The `charter_materialization_pending` flag is set by the acceptance pipeline when an idle-expansion `new_intake_intent` is processed WITHIN a running governed cycle (BUG-70/72/73 fix path). But when the continuous loop starts a NEW run from an already-approved idle-expansion intent, the initial state does not carry `charter_materialization_pending: true`.

The flag path:
1. Idle-expansion PM produces `new_intake_intent` → accepted → `charter_materialization_pending: true` set in state → next PM turn gets materialization directive ✅ (this works, proven in cycle 01)
2. Continuous loop finds approved idle-expansion intent → starts NEW run → PM turn gets intake context but `charter_materialization_pending: false` → PM prompt missing materialization directive ❌ (BUG-74)

## Fix

When `startNewRun()` (or equivalent) initializes a new governed run from an intake intent that has `category: "pm_idle_expansion_derived"` (or any idle-expansion-sourced category), the initial state MUST set `charter_materialization_pending: true` so the first PM turn receives the materialization directive.

### Surfaces to check

- `cli/src/lib/governed-state.js` — `startNewRun()` or equivalent run initialization
- `cli/src/lib/run.js` — where the continuous loop creates a new run from a queued intent
- `cli/src/lib/continuous-session.js` — intent-to-run bridging logic

### Acceptance criteria

1. When a new run starts from an idle-expansion-derived intent, `charter_materialization_pending` is `true` in the initial state.
2. The first PM turn in the new run receives the "You MUST create or update these planning artifacts" directive.
3. The PM turn produces modifications to `PM_SIGNOFF.md`, `ROADMAP.md`, `SYSTEM_SPEC.md`, and `command-surface.md`.
4. Acceptance passes on the first PM attempt (no reissue needed for charter materialization).
5. Dogfood cycle 03+ completes through all four phases with product code.

### Regression test

A command-chain test that:
1. Creates a governed state with a queued idle-expansion-derived intent
2. Starts a new run via `run --continuous`
3. Asserts the initial state has `charter_materialization_pending: true`
4. Asserts the PM prompt includes the materialization directive text

## Evidence

- Dogfood worktree: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev-agentxchain-dogfood`
- Run ID: `run_44a179ccf81697c3`
- Intent: `intent_1777117477235_c5f2` (category: `pm_idle_expansion_derived`)
- Three failed PM turns: `turn_ce4fd9d1bfd384f9` (attempt 1), `turn_9a77f24280c686a1` (attempt 2), `turn_f7013cc85dd95e74` (attempt 3)
- State snapshot: `charter_materialization_pending: false` throughout all three attempts
