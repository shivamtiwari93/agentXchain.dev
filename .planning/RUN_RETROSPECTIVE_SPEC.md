# Run Retrospective Spec

## Purpose

`run-history.jsonl` already preserves terminal run metadata and bounded inheritance snapshots, but child runs still inherit only raw recent decisions and accepted-turn summaries. That is enough to prove lineage, not enough to explain what the parent run actually accomplished or what the next operator should do.

This slice adds a deterministic terminal retrospective so completed and blocked runs leave behind a durable handoff summary for future operators and child runs.

## Interface

### 1. Run-history entry

Each terminal `run-history.jsonl` entry gains an additive `retrospective` object:

```json
{
  "retrospective": {
    "headline": "Implemented governed doctor checks and fixed Accessibility timeout.",
    "terminal_reason": "completed",
    "next_operator_action": null,
    "follow_on_hint": "If more scope remains, start a child run with `agentxchain run --continue-from <run_id> --inherit-context`."
  }
}
```

- `headline`: short terminal handoff summary derived from the terminal state and accepted-turn history
- `terminal_reason`: `completed` for completed runs, otherwise the derived blocked typed reason
- `next_operator_action`: recovery action for blocked runs, otherwise `null`
- `follow_on_hint`: follow-up guidance for completed runs, otherwise `null`

### 2. Inherited context

When `agentxchain run --continue-from/--recover-from ... --inherit-context` targets a parent run with a retrospective, the child `state.json` gains:

```json
{
  "inherited_context": {
    "parent_retrospective": {
      "headline": "...",
      "terminal_reason": "...",
      "next_operator_action": "...",
      "follow_on_hint": "..."
    }
  }
}
```

### 3. Markdown rendering

`CONTEXT.md` adds a `### Parent Retrospective` subsection inside `## Inherited Run Context` when `parent_retrospective` exists.

## Behavior

### Retrospective derivation

1. **Completed run headline**
   - Use the last accepted turn summary when available.
   - Fallback: `Run completed after <n> accepted turn(s).`

2. **Blocked run headline**
   - Prefer the derived recovery detail from blocked-state truth.
   - Fallback to the last accepted turn summary.
   - Final fallback: `Run blocked.`

3. **Terminal reason**
   - `completed` for completed runs
   - blocked recovery `typed_reason` for blocked runs

4. **Next operator action**
   - blocked runs: the derived blocked recovery action
   - completed runs: `null`

5. **Follow-on hint**
   - completed runs: advise `agentxchain run --continue-from <run_id> --inherit-context`
   - if the last accepted turn proposed a non-human next role, mention it as a suggestion, not a guarantee
   - blocked runs: `null`

### Truth constraints

- Retrospectives are deterministic summaries of repo-native run truth. No model call is allowed.
- Older parent runs without a retrospective must continue to inherit cleanly; `parent_retrospective` becomes `null`.
- This slice is additive only. Existing inheritance snapshots, report output, and status/export surfaces must keep working unchanged.

## Error Cases

- If `run-history.jsonl` recording fails, the retrospective must fail with the existing non-fatal `recordRunHistory()` behavior.
- If a parent run predates retrospective recording, inheritance must remain metadata-only instead of synthesizing a fake retrospective from current repo state.
- If no accepted turns exist, fallback strings must be used instead of empty/null headlines.

## Acceptance Tests

- `AT-RR-001`: completed run-history entries record `retrospective.headline`, `terminal_reason: "completed"`, `next_operator_action: null`, and a `follow_on_hint`.
- `AT-RR-002`: blocked run-history entries record blocked `terminal_reason` and `next_operator_action` from the derived recovery descriptor.
- `AT-RR-003`: `--continue-from --inherit-context` carries the parent retrospective into child `state.json`.
- `AT-RR-004`: inherited `CONTEXT.md` renders a `Parent Retrospective` subsection with the headline and follow-on hint.
- `AT-RR-005`: public CLI docs describe the retrospective as part of run-history and inherited context.

## Open Questions

- Should a future `history` human-readable view grow an explicit retrospective column or detail mode? Not in this slice.
