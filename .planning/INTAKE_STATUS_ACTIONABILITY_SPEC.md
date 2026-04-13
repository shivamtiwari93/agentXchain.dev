# Intake Status Actionability Spec

## Purpose

Make `agentxchain intake status` actionable instead of merely descriptive. Today the command shows lifecycle state, but it still forces operators to remember the next intake command from memory or reopen the docs. That is weak product behavior for a governed intake pipeline.

This slice adds derived next-step guidance to both the text and JSON surfaces so operators and tooling can move an intent forward without reconstructing the lifecycle manually.

## Interface

No new commands.

### `agentxchain intake status --intent <id> --json`

Adds a top-level `next_action` object:

```json
{
  "ok": true,
  "intent": { "...": "existing intent payload" },
  "event": { "...": "existing linked event payload" },
  "next_action": {
    "label": "triage | approve | plan | start | resolve | recover | inspect | none",
    "summary": "human-readable explanation",
    "command": "agentxchain ... | null",
    "alternatives": ["agentxchain ..."],
    "recovery": "free-text recovery guidance | null",
    "action_required": true
  }
}
```

### `agentxchain intake status --json`

Each summary intent row adds the same `next_action` object so dashboards and scripts can sort actionable work without opening every intent individually.

## Behavior

`next_action` is derived from the current intent state, not persisted in the intent artifact.

Status mapping:

| Intent status | `next_action.label` | Primary command |
|---|---|---|
| `detected` | `triage` | `agentxchain intake triage --intent <id> ...` |
| `triaged` | `approve` | `agentxchain intake approve --intent <id>` |
| `approved` | `plan` | `agentxchain intake plan --intent <id>` |
| `planned` | `start` | `agentxchain intake start --intent <id>` |
| `executing` | `resolve` | `agentxchain intake resolve --intent <id>` |
| `blocked` | `recover` | `agentxchain intake resolve --intent <id>` after resolving the linked run/coordinator block |
| `completed` | `none` | `null` |
| `suppressed` | `none` | `null` |
| `rejected` | `none` | `null` |
| `failed` | `inspect` | `null` |

Additional rules:

1. `detected` includes a suppress alternative.
2. `triaged` includes a reject alternative.
3. `planned` includes the coordinator handoff command as an alternative because the product supports both repo-local start and coordinator handoff from that state.
4. `blocked` includes `intent.run_blocked_recovery` in `next_action.recovery` when present.
5. Text detail mode renders a `Next Action` section showing the summary, primary command, alternatives, and recovery note.
6. Text list mode appends a compact actionable hint for non-terminal intents (for example `→ triage`, `→ plan`, `→ recover`).

## Error Cases

1. Unknown/manual intent status: return `label: "inspect"` with `command: null` and a summary that manual inspection is required.
2. Missing `run_blocked_recovery` on a blocked intent: still show `recover` with the `intake resolve` command; omit the recovery note.
3. Terminal states must not invent a command just to fill the field.

## Acceptance Tests

1. Detected intent detail JSON includes a `triage` next action with the exact `intake triage` command and suppress alternative.
2. Triaged intent detail text shows approve as the primary action and reject as the alternative.
3. Planned intent detail JSON shows repo-local `start` as primary and coordinator `handoff` as an alternative.
4. Blocked intent detail JSON surfaces the stored recovery note plus the `intake resolve` follow-up command.
5. Summary JSON rows include `next_action` for actionable intents.

## Open Questions

None. This is a pure operator/tooling surface derived from existing lifecycle state.
