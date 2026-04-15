# Step / Accept / Reject Recovery Descriptor Config Spec

## Purpose

Freeze the command-boundary contract for `agentxchain step`, `agentxchain accept-turn`, and `agentxchain reject-turn` when they render operator-facing recovery guidance.

`deriveRecoveryDescriptor(state, config)` is config-aware. Command surfaces that omit normalized governed config can silently fall back to stale persisted recovery commands, especially when retained-turn recovery actions were written by older versions.

## Interface

- `cli/src/commands/step.js`
  - `printRecoverySummary(state, heading, config)`
  - `printLifecycleHookFailure(title, result, { ..., config })`
  - `printAssignmentHookFailure(result, roleId, config)`
  - `printAcceptedHookFailure(result, config)`
  - `printAcceptSummary(result, config)`
  - `printEscalationSummary(result, config)`
- `cli/src/commands/accept-turn.js`
  - every operator-facing `deriveRecoveryDescriptor(result.state, config)` call
- `cli/src/commands/reject-turn.js`
  - escalated rejection recovery output must call `deriveRecoveryDescriptor(result.state, config)`

## Behavior

- Every operator-facing recovery render in these command files must pass normalized governed `config` into `deriveRecoveryDescriptor(...)`.
- `step` helper wrappers must not drop `config` between the main command body and recovery rendering.
- `accept-turn` must use config-aware recovery rendering for:
  - hook-blocked acceptance
  - conflicted acceptance summaries
  - successful acceptance summaries when the run remains blocked
- `reject-turn` must use config-aware recovery rendering when rejection exhausts retries and escalates.

## Error Cases

- Calling `deriveRecoveryDescriptor(state)` without config can preserve stale legacy commands such as `agentxchain step --resume` even when current runtime-aware guidance should refresh to a different command.
- Partial fixes are rejected. A file is still wrong if one branch passes config and another branch in the same operator surface drops it.
- Library correctness is not sufficient proof. This bug class lives at the CLI boundary.

## Acceptance Tests

- `cli/test/recovery-command-config.test.js`
  - proves `step.js` recovery helpers and call sites pass `config`
  - proves `accept-turn.js` recovery renders pass `config`
  - proves `reject-turn.js` escalated recovery renders pass `config`
- Existing recovery-path command tests continue to pass:
  - `cli/test/step-api-proxy-integration.test.js`
  - `cli/test/operator-recovery.test.js`
  - `cli/test/e2e-policy-escalation-recovery.test.js`

## Open Questions

- None. The contract is narrow: operator-facing recovery output uses `deriveRecoveryDescriptor(state, config)` everywhere in these command surfaces.
