# Coordinator Report Terminal Drift Observability Spec

**Status:** shipped
**Decision:** `DEC-COORD-REPORT-TERMINAL-DRIFT-001`

## Purpose

Completed coordinator reports already suppress `next_actions`, but that omission is too implicit when child repo drift is still visible. Operators should not have to infer whether a completed coordinator mismatch or status disagreement is actionable.

This spec freezes an explicit report-layer note: completed coordinator child drift remains visible for audit, but it does not reopen recovery guidance.

## Interface

For `subject.kind = coordinator_workspace`, add:

```js
subject.run.terminal_observability_note: string | null
```

## Behavior

1. When the coordinator status is `completed` and either `subject.run.run_id_mismatches` or `subject.run.repo_status_drifts` is non-empty, set `terminal_observability_note` to a human-readable explanation that:
   - child repo drift is still shown for audit
   - the coordinator is already terminal
   - no recovery command is emitted
2. Otherwise set `terminal_observability_note` to `null`.
3. Text, markdown, and HTML reports must render the note when present.
4. The presence of the note must not reintroduce a `Next Actions` section for completed coordinators.

## Error Cases

- If both `run_id_mismatches` and `repo_status_drifts` are absent or empty, the note stays `null`.
- If the coordinator is non-terminal, drift remains actionable through `next_actions`; the note must stay `null`.

## Acceptance Tests

- `AT-COORD-RUNID-006`: completed coordinator drift sets `subject.run.terminal_observability_note` and keeps `next_actions` empty.
- `AT-COORD-RUNID-007`: text and markdown reports render the terminal observability note and still omit `Next Actions`.
- `AT-COORD-DRIFT-001`: completed coordinator status drift without run-id mismatch still sets `subject.run.terminal_observability_note`.
- `AT-REPORT-010`: CLI `report` for a completed drifted coordinator shows the note in text mode and JSON while omitting recovery commands.
- `AT-REPORT-009`: CLI `report --format html` renders a visible `Terminal drift note` metadata row and omits the HTML `Next Actions` section for a completed drifted coordinator.
- `AT-COORD-ACT-006`: public report docs mention the terminal observability note.

## Open Questions

None. This is a narrow clarification of an already-set terminal coordinator contract.
