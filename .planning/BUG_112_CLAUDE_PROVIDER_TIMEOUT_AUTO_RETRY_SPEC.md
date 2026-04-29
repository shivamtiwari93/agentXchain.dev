# BUG-112: Claude Provider Timeout Auto-Retry

## Purpose

During DOGFOOD-100 on tusq.dev session `cont-7dc5b5df`, QA turn `turn_aa9664d36f8cac23` failed twice before writing a staged result because Claude Code exhausted internal API retries and returned `Request timed out`. AgentXchain surfaced the retained state as generic `escalation:retries-exhausted:qa`, which requires a human decision even though the evidence is a transient provider timeout.

Full-auto dogfood must not require human unblock for a transient runtime timeout that produced output, retained a turn, and left no staged result. The substrate should classify this as the same recoverable productive-timeout family as BUG-100 and reissue the turn with an extended deadline.

## Interface

- Input state:
  - `state.status === "blocked"`
  - `state.blocked_reason.category === "retries_exhausted"`
  - retained active turn has `last_rejection.failed_stage === "dispatch"`
  - retained active turn has `first_output_at`
  - no staged result exists for the turn
  - dispatch log contains explicit Claude provider timeout evidence such as:
    - `Request timed out`
    - `timed out waiting for provider`
    - `provider request timed out`
    - `process_exit` with `staged_result_ready:false`
- Output:
  - continuous startup treats the blocker as recoverable.
  - `reissueTurn()` creates a new turn.
  - governed state returns to `active`.
  - continuous session remains `running`.
  - event `auto_retried_productive_timeout` records old/new turn IDs.

## Behavior

Provider request timeouts are not product-work failures and are not human decisions. If a turn made runtime progress but the provider timed out before a staged result, the continuous loop may reissue it once per run using the existing BUG-100 productive-timeout retry budget and extended deadline.

Authentication failures remain separate and must still reclassify to `dispatch:claude_auth_failed` via BUG-111. Silent subprocess failures with no first output remain blocked.

Internal Claude `api_retry` events are supporting evidence but are not sufficient on their own; the terminal log must contain an explicit timeout marker so unrelated provider retries do not get silently reissued.

## Error Cases

- No dispatch log: do not auto-retry.
- No first output: do not auto-retry.
- Staged result exists: do not auto-retry.
- Auth failure marker exists: BUG-111 auth classification wins before timeout retry.
- Retry budget exhausted: leave blocked and emit existing retry-exhausted behavior.

## Acceptance Tests

- `cli/test/continuous-run.test.js` includes a retained retries-exhausted Claude timeout fixture and asserts `advanceContinuousRunOnce()` returns `auto_retried_productive_timeout`.
- The test asserts state is active, old blocked turn is removed, new turn is assigned, and an `auto_retried_productive_timeout` event is emitted.
- Existing BUG-111 auth reclassification tests still pass.
- Existing BUG-100 silent failure test still passes.

## Open Questions

- Whether future releases should use a distinct event name such as `auto_retried_provider_timeout`. For this patch, reusing the productive-timeout path keeps behavior simple and avoids a new retry budget.
