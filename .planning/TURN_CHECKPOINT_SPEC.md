# Turn Checkpoint Spec

## Purpose

Close the accepted-turn handoff gap for writable governed turns. After a writable turn is accepted, AgentXchain needs a first-class way to checkpoint the accepted repo state into git so the next authoritative or proposed turn can start from a clean baseline without manual `git commit` intervention.

## Interface

- `agentxchain checkpoint-turn [--turn <turn_id>]`
- `agentxchain accept-turn --checkpoint`
- `agentxchain run --continuous --auto-checkpoint`
- `agentxchain run --continuous --no-auto-checkpoint`

## Behavior

- `checkpoint-turn` targets the latest accepted turn by default, or an explicit accepted turn via `--turn`.
- Checkpointing stages only the accepted turn's declared `files_changed` paths. It must not sweep unrelated dirty files into the commit.
- The checkpoint commit message uses the accepted turn identity:
  - subject: `checkpoint: <turn_id> (role=<role>, phase=<phase>)`
  - body includes summary, runtime, intent_id when present, and accepted timestamp.
- Successful checkpoint writes `checkpoint_sha` and `checkpointed_at` into the accepted history entry and stores the last checkpoint record in governed state.
- Successful checkpoint emits `turn_checkpointed` with the turn id and commit SHA.
- `accept-turn --checkpoint` accepts first, then checkpoints in the same command invocation. If checkpoint fails, acceptance remains durable and the operator gets a clear recovery command.
- Continuous execution with `--auto-checkpoint` checkpoints each accepted writable turn before the next writable role handoff.
- Clean-baseline rejection should upgrade to a checkpoint-specific message when the only dirty actor-owned files belong to the latest accepted, uncheckpointed turn.

## Error Cases

- Not a git repo: refuse checkpointing with a clear error.
- Accepted turn has no writable `files_changed`: treat as a no-op skip, not a failure.
- No accepted turn found: refuse with a clear error.
- Git commit fails (including hooks): keep accepted state, surface the git error, and tell the operator to rerun `agentxchain checkpoint-turn` after fixing the repo.
- Dirty files extend beyond the accepted turn's `files_changed`: fall back to the generic clean-baseline error instead of falsely claiming checkpoint eligibility.

## Acceptance Tests

- `checkpoint-turn` commits exactly the accepted turn's `files_changed` and leaves unrelated dirty files untouched.
- `accept-turn --checkpoint` produces an accepted history entry with `checkpoint_sha` and a `turn_checkpointed` event.
- Auto-checkpoint plumbing is available to multi-turn execution so accepted writable turns can checkpoint immediately after acceptance.

## Open Questions

- Whether checkpoint failure in auto modes should hard-block the run or remain a soft accepted-but-paused state for later recovery.
- Whether future checkpoint commits should support configurable authorship/trailers per runtime.
