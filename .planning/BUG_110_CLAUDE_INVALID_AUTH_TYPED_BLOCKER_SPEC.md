# BUG-110: Claude Invalid Auth Typed Blocker

## Purpose

DOGFOOD-100 exposed a local Claude CLI auth failure after BUG-109 recovery reached natural QA dispatch. The Claude subprocess emitted an explicit 401 `Invalid authentication credentials`, exited 1, and wrote no staged result. AgentXchain treated that as a normal turn rejection, retried QA, then raised `retries-exhausted:qa`.

Invalid runtime credentials are a dispatch infrastructure blocker, not a QA work product failure.

## Interface

- `dispatchLocalCli(root, state, config, options)` detects Claude local CLI authentication failures in stdout/stderr/log output.
- The adapter returns `ok: false`, `blocked: true`, and `classified.error_class: "claude_auth_failed"`.
- `agentxchain run` persists that result through `markRunBlocked()` instead of feeding it into `rejectTurn()`.

## Behavior

1. A Claude local CLI subprocess that exits non-zero without a staged result and emits `authentication_failed`, `authentication_error`, or `Invalid authentication credentials` is classified as auth failure.
2. The governed run transitions to `status: "blocked"` with `blocked_reason.category: "dispatch_error"`.
3. The active turn is retained for resume after credentials are fixed.
4. The turn attempt counter is not incremented by `rejectTurn()`.
5. Continuous mode stops on the typed blocker instead of retrying the same invalid credential path into a human escalation.

## Error Cases

- Non-Claude local CLI failures remain generic dispatch failures.
- Claude local CLI failures without auth markers remain ordinary subprocess failures and may follow existing rejection or startup-failure handling.
- Auth marker detection must not inspect prompts or staged files; only subprocess output/adapter diagnostics.

## Acceptance Tests

- `cli/test/local-cli-adapter.test.js` includes a Claude shim that writes a stream-json auth failure to stdout, exits 1, and asserts `dispatchLocalCli()` returns `blocked: true` with `classified.error_class === "claude_auth_failed"`.
- Run-command coverage proves `agentxchain run` treats adapter `blocked: true` as a terminal dispatch blocker, not a `rejectTurn()` retry.

## Open Questions

- Long term, connector validation should also probe credential validity before long-running sessions. This bug only closes the false retry/escalation behavior discovered in DOGFOOD-100.
