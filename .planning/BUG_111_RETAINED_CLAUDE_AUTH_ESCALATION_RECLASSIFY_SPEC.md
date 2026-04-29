# BUG-111 — Retained Claude Auth Escalations Reclassify On Continuous Startup

## Purpose

`agentxchain@2.155.65` correctly classifies new Claude local CLI authentication failures as typed dispatch blockers, but DOGFOOD-100 exposed a retained live-session gap: Tusq had already been blocked by a pre-fix `escalation:retries-exhausted:qa` state from the same auth failure. Re-running `agentxchain run --continuous` preserved the stale escalation guidance instead of recovering the typed blocker.

The continuous loop must reclassify retained retries-exhausted dispatch escalations when the retained dispatch log proves a Claude authentication failure.

## Interface

- Input: existing `.agentxchain/state.json` during `agentxchain run --continuous` startup.
- Trigger shape:
  - `state.status === "blocked"`
  - `state.blocked_reason.category === "retries_exhausted"`
  - `state.blocked_on` starts with `escalation:retries-exhausted:`
  - retained failed active turn has `last_rejection.failed_stage === "dispatch"`
  - retained turn runtime is a Claude `local_cli` runtime
  - retained dispatch log contains Claude auth failure markers such as `authentication_failed`, `authentication_error`, `Invalid authentication credentials`, or `API Error: 401`
- Output: rewrite the retained blocker to:
  - `blocked_on: "dispatch:claude_auth_failed"`
  - `blocked_reason.category: "dispatch_error"`
  - recovery action telling the operator to refresh Claude credentials and resume
  - active turn retained

## Behavior

1. Continuous startup inspects a blocked retained run before returning `still_blocked`.
2. If the retained blocker matches the trigger shape, AgentXchain reads `.agentxchain/dispatch/turns/<turn>/stdout.log`.
3. If the log proves Claude auth failure, AgentXchain rewrites the blocked state to the same typed dispatch blocker used for fresh BUG-110 dispatches.
4. AgentXchain emits a `retained_claude_auth_escalation_reclassified` run event for audit.
5. The continuous step returns `still_blocked` with the typed credential recovery action.

## Error Cases

- Missing active turn: do not reclassify.
- Non-Claude runtime: do not reclassify.
- Missing dispatch log: do not reclassify.
- Dispatch log without auth markers: do not reclassify.
- Existing staged result file: do not reclassify, because a retained staged result may need normal acceptance/rejection handling.

## Acceptance Tests

- AT-BUG111-001: a retained retries-exhausted Claude auth escalation is reclassified to `dispatch:claude_auth_failed` during `advanceContinuousRunOnce`.
- AT-BUG111-002: a retained retries-exhausted dispatch escalation without auth markers remains unchanged.
- AT-BUG111-003: the typed recovery action names `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` and tells the operator to resume after refreshing credentials.

## Open Questions

- None. This is a compatibility repair for retained pre-BUG-110 states and does not broaden automatic credential management.
