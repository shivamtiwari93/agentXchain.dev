# Run Terminal Status Alignment Spec

## Purpose

Align the governed run terminal-status contract across specs, operator surfaces, and implementation.

The current repo has mixed truth:

- actual governed writers emit run-level terminal states `completed` and `blocked`
- turn-level failures are represented as `current_turn.status = "failed"` while the run remains `paused` or becomes `blocked`
- several docs and helper surfaces still advertise run-level `failed` as if it were a live governed outcome

That is contract drift. Operators should not have to infer which surfaces are descriptive versus historical or reserved.

## Interface

### Current governed writer truth

Run-level terminal statuses produced by first-party governed writers are:

- `completed`
- `blocked`

Run-level `failed` remains reserved/unreached in the current governed implementation.

### Compatibility boundary

- Validators may continue to accept run-level `failed` for backward/forward compatibility.
- Read-only surfaces may continue to tolerate historical or manually-authored `failed` records.
- First-party writers must not advertise or emit run-level `failed` unless the state machine is explicitly extended in a future spec.

## Behavior

1. Specs must describe `blocked` as the current non-success terminal/failure outcome for governed runs.
2. Operator-facing docs for run history must advertise terminal recording as `completed | blocked`, not `completed | blocked | failed`.
3. `recordRunHistory(...)` must reject unsupported terminal statuses instead of silently legitimizing reserved states.
4. Continuity/recovery surfaces must treat run-level `failed` as a reserved unsupported state, not as a normal live outcome and not as a restartable active state.
5. Restart surfaces must fail closed on run-level `failed` with a truthful message that this status is reserved and not emitted by current governed writers.

## Error Cases

- If a caller passes `recordRunHistory(..., 'failed')`, recording returns `{ ok: false, error }` and does not append a ledger line.
- If a workspace contains a run-level `state.status = "failed"`, operator surfaces must not pretend that restart is the normal path. They should explain that the status is reserved and requires manual inspection or migration.
- Historical/manual `run-history.jsonl` lines with `status: "failed"` may still be read and rendered; this spec only constrains first-party writer truth.

## Acceptance Tests

- `AT-RTSA-001`: `.planning/STATE_MACHINE_SPEC.md` names `blocked` in the run-level status union and describes `failed` as reserved/unreached.
- `AT-RTSA-002`: `.planning/RUN_HISTORY_SPEC.md` advertises recorded terminal statuses as `completed | blocked`, not `failed`.
- `AT-RTSA-003`: `recordRunHistory(..., 'failed')` returns `{ ok: false }` and does not write `run-history.jsonl`.
- `AT-RTSA-004`: continuity/status surfaces return a reserved-state reason for run-level `failed` instead of treating it as a normal produced terminal outcome.
- `AT-RTSA-005`: `agentxchain restart` fails closed on run-level `failed` with a reserved-status message.

## Open Questions

1. Should a future governed state-machine version make run-level `failed` reachable for unrecoverable corruption or runner-crash semantics, or should all non-success governed outcomes remain `blocked` plus explicit recovery evidence?
