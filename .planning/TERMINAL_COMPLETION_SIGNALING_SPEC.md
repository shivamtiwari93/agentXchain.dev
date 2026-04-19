# Terminal Completion Signaling Spec

## Status
Shipped — prompt hardening and review_only terminal normalization now route ship-ready QA through `run_completion_request`.

## Problem

In a governed run, when `review_only` QA reaches the terminal phase and determines the run is ship-ready, it should set `run_completion_request: true` to trigger the `pending_run_completion` → `approve-completion` protocol flow. Instead, live QA consistently emits `status: "needs_human"` with a reason like "human must review and approve the final release" — which is semantically correct (human should approve) but protocol-incorrect (it never enters `pending_run_completion`).

This creates a dead-end: the run stays `active` with a `needs_human` turn, the operator must manually diagnose why the run didn't advance, and the governed completion protocol is never exercised.

### Root Cause

The model conflates two distinct concepts:
- **"needs human"** = genuine blocker requiring human intervention (e.g., "critical security issue", "test failures I cannot fix")
- **"ready for human approval gate"** = ship-ready, requesting the protocol's human approval step

Both result in "a human needs to do something," but they are different protocol actions. `run_completion_request: true` triggers the governed approval gate. `needs_human` creates an unstructured escalation.

## Fix — Two Layers

### Layer 1: Prompt Hardening

Rewrite the review_only terminal-phase guidance to explicitly distinguish ship-ready from blocked:

> **If your review verdict is ship-ready (no blocking issues):** set `run_completion_request: true` and `status: "completed"`. This triggers the human approval gate — it does NOT bypass human review.
>
> **If you found genuine blocking issues that prevent shipping:** set `status: "needs_human"` and explain the blockers in `needs_human_reason`.
>
> Do NOT use `needs_human` to mean "human should approve the release." That is what `run_completion_request: true` is for.

### Layer 2: Narrow Normalization (Rule 3)

Extend `normalizeTurnResult` to accept optional state context. New rule fires only when ALL conditions hold:

1. Role `write_authority` is `review_only`
2. Current phase is terminal (last in routing order)
3. `status` is `"needs_human"`
4. `run_completion_request` is NOT explicitly `false`
5. `needs_human_reason` matches an affirmative ship-ready pattern (contains "approve", "ship", "release", "sign off", "no block" — case insensitive) AND does NOT contain blocker signals ("critical", "security", "fail", "block", "cannot", "must fix", "regression")

When all conditions match, normalize:
- `status` → `"completed"`
- `run_completion_request` → `true`
- `needs_human_reason` → removed (preserved in corrections log)
- Log: `[normalized] status: corrected review_only terminal "needs_human" to run_completion_request — reason indicated ship readiness, not a genuine blocker`

When conditions 1-4 match but 5 does NOT (reason contains blocker signals or lacks affirmative signals): do NOT normalize. The `needs_human` is genuine.

### Why normalization is safe here

`run_completion_request: true` does not auto-complete the run. It enters `pending_run_completion` state, which requires explicit `approve-completion` from the operator. So the normalization is semantically equivalent to what `needs_human` already implies ("human should approve") but routes through the correct protocol path.

## Error Cases / Failure Modes

1. **Genuine blocker in needs_human_reason** → NOT normalized. Blocker keywords prevent rule from firing.
2. **Non-terminal phase** → NOT normalized. Rule only fires in the last routing phase.
3. **Non-review_only role** → NOT normalized. Authoritative roles should not have their completion intent overridden.
4. **Ambiguous reason (no affirmative signals, no blocker signals)** → NOT normalized. Fail closed on ambiguity.
5. **Explicit `run_completion_request: false`** → NOT normalized. Model explicitly declined completion.
6. **No routing config** → NOT normalized. Cannot determine terminal phase.

## Acceptance Tests

- `AT-TCS-001`: Prompt for review_only in terminal phase includes explicit "ship-ready → run_completion_request" vs "blocked → needs_human" guidance.
- `AT-TCS-002`: Normalization converts `needs_human` + affirmative reason to `run_completion_request: true` for review_only terminal.
- `AT-TCS-003`: Normalization does NOT fire when reason contains blocker keywords.
- `AT-TCS-004`: Normalization does NOT fire for non-review_only roles.
- `AT-TCS-005`: Normalization does NOT fire in non-terminal phases.
- `AT-TCS-006`: Normalization does NOT fire when `run_completion_request: false` is explicit.
- `AT-TCS-007`: Normalization does NOT fire when reason is ambiguous (no affirmative signals).
- `AT-TCS-008`: Full validator pipeline passes with normalized terminal completion.

## Scope Boundary

- No protocol changes. No schema changes.
- Normalization is pre-validation recovery, same as existing Rules 0-2.
- Prompt changes are in `dispatch-bundle.js` only.
- No changes to `governed-state.js` or gate evaluation.
