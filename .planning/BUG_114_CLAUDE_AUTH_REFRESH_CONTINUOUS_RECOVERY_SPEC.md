# BUG-114: Claude Auth Refresh Continuous Recovery

## Purpose

During `agentxchain@2.155.69` DOGFOOD reverify, BUG-113 correctly recovered retained Claude Node runtime ghost blocker `turn_07b1ca892daef9dc` and reissued QA turn `turn_aa521bedd41f1655`. The reissued Claude subprocess then authenticated with stale/invalid credentials from the operator environment and AgentXchain blocked as `dispatch:claude_auth_failed`.

The typed blocker was correct, but the recovery action still required `agentxchain step --resume` after credentials were refreshed. DOGFOOD-100 requires continuous full-auto recovery without operator-side resume commands when credentials are already available to the resumed process.

## Interface

- Input:
  - `state.status === "blocked"`.
  - `state.blocked_on === "dispatch:claude_auth_failed"`.
  - `state.blocked_reason.category === "dispatch_error"`.
  - retained active turn runtime is Claude `local_cli`.
  - retained dispatch log contains Claude authentication failure evidence.
  - current process environment contains non-empty Claude auth (`ANTHROPIC_API_KEY`, `CLAUDE_API_KEY`, or `CLAUDE_CODE_OAUTH_TOKEN`).
- Output:
  - continuous startup reissues the retained turn via governed `reissueTurn()`.
  - state returns to `active`.
  - session returns to `running`.
  - `auto_retried_ghost` records `recovery_class: "claude_auth_refreshed"`.
  - no `agentxchain step --resume`, `agentxchain unblock`, staging JSON edit, or manual state surgery is required.

## Behavior

Continuous startup should treat a retained Claude auth dispatch blocker as recoverable only when the current process now has auth credentials. If credentials are still absent, the existing typed blocker and recovery guidance remain unchanged.

This recovery must run before generic blocker preservation and after retained auth escalation reclassification, so both pre-fix retries-exhausted auth states and post-fix `dispatch:claude_auth_failed` states can resume once credentials are available.

## Error Cases

- Non-Claude runtime: preserve the blocker.
- Missing dispatch log: preserve the blocker.
- Dispatch log lacks auth failure markers: preserve the blocker.
- Current process has no non-empty Claude auth env: preserve the blocker.
- `reissueTurn()` fails: preserve the blocker and log the skip.

## Acceptance Tests

- `cli/test/continuous-run.test.js` proves a retained `dispatch:claude_auth_failed` Claude blocker auto-reissues when `ANTHROPIC_API_KEY` is present.
- Existing BUG-111 retained auth escalation reclassification tests still pass.
- Existing BUG-112 provider-timeout recovery tests still pass.
- Existing BUG-113 Node-runtime recovery tests still pass.

## Open Questions

- Whether a future release should introduce a distinct `auto_retried_claude_auth_refreshed` event type. For this patch, the existing `auto_retried_ghost` event with `recovery_class: "claude_auth_refreshed"` avoids event-registry churn while preserving machine-readable recovery evidence.
