# Coordinator Report Terminal Drift Observability Spec

**Status:** shipped
**Decision:** `DEC-COORD-REPORT-TERMINAL-DRIFT-001`

## Purpose

Completed coordinator reports already suppress `next_actions`, but that omission is too implicit when child repo run identity drift is still visible. Operators should not have to infer whether a mismatch on a completed coordinator is actionable.

This spec freezes an explicit report-layer note: completed coordinator child run-id drift remains visible for audit, but it does not reopen recovery guidance.

## Interface

For `subject.kind = coordinator_workspace`, add:

```js
subject.run.terminal_observability_note: string | null
```

## Behavior

1. When the coordinator status is `completed` and `subject.run.run_id_mismatches.length > 0`, set `terminal_observability_note` to a human-readable explanation that:
   - child repo run-id drift is still shown for audit
   - the coordinator is already terminal
   - no recovery command is emitted
2. Otherwise set `terminal_observability_note` to `null`.
3. Text, markdown, and HTML reports must render the note when present.
4. The presence of the note must not reintroduce a `Next Actions` section for completed coordinators.

## Error Cases

- If `run_id_mismatches` is absent or empty, the note stays `null`.
- If the coordinator is non-terminal, drift remains actionable through `next_actions`; the note must stay `null`.

## Acceptance Tests

- `AT-COORD-RUNID-006`: completed coordinator drift sets `subject.run.terminal_observability_note` and keeps `next_actions` empty.
- `AT-COORD-RUNID-007`: text and markdown reports render the terminal observability note and still omit `Next Actions`.
- `AT-REPORT-006`: CLI `report` for a completed drifted coordinator shows the note in text mode and JSON while omitting recovery commands.
- `AT-COORD-ACT-006`: public report docs mention the terminal observability note.

## Open Questions

None. This is a narrow clarification of an already-set terminal coordinator contract.
