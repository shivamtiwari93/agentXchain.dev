# BUG-83 Non-Progress Recovery Command Spec

## Purpose

Prevent non-progress recovery guidance from telling operators to run a command flag that does not exist. The non-progress guard may block a run correctly, but its recovery text must point to a valid AgentXchain command.

## Interface

- Input: a governed run reaches the configured `run_loop.non_progress_threshold`.
- Output: `state.blocked_reason.recovery.recovery_action` contains a valid command from the shipped CLI surface.
- Current valid operator command: `agentxchain resume`.

## Behavior

- When the non-progress guard blocks a run, the blocked reason must still use category `non_progress`.
- The recovery action must not mention `--acknowledge-non-progress` on `resume`, because the `resume` command does not expose that flag.
- `reactivateGovernedRun()` continues to reset non-progress tracking internally when the recovery path acknowledges non-progress.

## Error Cases

- If the CLI later adds an explicit `resume --acknowledge-non-progress` flag, this spec and regression must be updated together.
- If the run has a different blocker category, BUG-83 does not change its recovery command.

## Acceptance Tests

- A fixture that trips the non-progress threshold must produce `state.blocked_reason.recovery.recovery_action === "agentxchain resume"`.
- The same fixture must prove the action does not contain `--acknowledge-non-progress`.
- Existing BUG-38 behavior must remain intact: acknowledged reactivation resets the non-progress counter and allows the run to continue.

## Open Questions

- None for this patch. A future UX pass can add richer role-specific resume guidance, but this fix only removes the invalid flag.
