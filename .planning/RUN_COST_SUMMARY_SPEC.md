# Per-Run Cost Summary — Spec

> `DEC-COST-SUMMARY-001`: The governance report must include a dedicated cost summary section that aggregates per-turn cost data into per-role and per-phase breakdowns, plus run-level totals. This complements the existing per-turn `cost_usd` field and the budget status line.

## Purpose

Operators need to understand what a governed run cost them at a glance — not just total spent (which `budget_status.spent_usd` already provides), but **where the money went**: which roles consumed the most, which phases were expensive, and what the token volume looked like. This enables informed decisions about role budgets, phase timeouts, and model selection.

## Interface

### Report data contract

`buildRunSubject()` adds a `cost_summary` object to `report.subject.run`:

```json
{
  "cost_summary": {
    "total_usd": 12.34,
    "total_input_tokens": 150000,
    "total_output_tokens": 42000,
    "turn_count": 8,
    "costed_turn_count": 7,
    "by_role": [
      { "role": "dev", "usd": 8.50, "turns": 4, "input_tokens": 100000, "output_tokens": 28000 },
      { "role": "qa", "usd": 3.84, "turns": 3, "input_tokens": 50000, "output_tokens": 14000 }
    ],
    "by_phase": [
      { "phase": "implementation", "usd": 10.20, "turns": 5 },
      { "phase": "qa", "usd": 2.14, "turns": 2 }
    ]
  }
}
```

- `total_usd`: sum of all per-turn `cost_usd` values (null costs treated as 0)
- `total_input_tokens` / `total_output_tokens`: sum across turns (null when no turns report tokens)
- `turn_count`: total history entries
- `costed_turn_count`: turns where `cost_usd` is a finite number
- `by_role`: sorted alphabetically by role name
- `by_phase`: sorted alphabetically by phase name
- If no turns exist, `cost_summary` is `null`

### Text output

A new "Cost Summary" section appears after the existing "Budget" line and before "Turn Timeline":

```
Cost Summary:
  Total: $12.34 across 8 turns (7 with cost data)
  Tokens: 150,000 input / 42,000 output
  By role:
    dev: $8.50 (4 turns, 100,000 in / 28,000 out)
    qa: $3.84 (3 turns, 50,000 in / 14,000 out)
  By phase:
    implementation: $10.20 (5 turns)
    qa: $2.14 (2 turns)
```

### Markdown output

Same structure as text, formatted with markdown headers and tables.

### JSON output

The `cost_summary` object is included directly in `report.subject.run` — no formatting changes needed.

## Behavior

1. **Extraction**: `extractHistoryTimeline` is extended to also extract `input_tokens` and `output_tokens` from each history entry's `cost` object.
2. **Aggregation**: A new `computeCostSummary(turns)` function computes the summary from the turn timeline.
3. **Null handling**: If zero turns exist, `cost_summary` is `null`. If turns exist but none have cost data, `total_usd` is `0` and `costed_turn_count` is `0`.
4. **Token nullability**: `total_input_tokens` and `total_output_tokens` are `null` if no turns report token counts; otherwise they are the sum (treating null entries as 0).

## Error Cases

- Turns with `cost_usd: null` contribute to `turn_count` but not to `costed_turn_count` or `total_usd`.
- Turns with non-finite token counts are treated as 0 for that turn.
- Malformed cost objects are silently ignored (consistent with existing `extractHistoryTimeline` behavior).

## Acceptance Tests

- **AT-COST-SUMMARY-001**: `cost_summary` is `null` when there are zero history entries.
- **AT-COST-SUMMARY-002**: `cost_summary.total_usd` equals the sum of per-turn `cost_usd` values, and `costed_turn_count` equals the count of turns with finite `cost_usd`.
- **AT-COST-SUMMARY-003**: `by_role` breaks down cost correctly across multiple roles.
- **AT-COST-SUMMARY-004**: `by_phase` breaks down cost correctly across multiple phases.
- **AT-COST-SUMMARY-005**: Token totals are `null` when no turns report tokens; otherwise they sum correctly.
- **AT-COST-SUMMARY-006**: Text format includes "Cost Summary:" section with role and phase breakdowns.
- **AT-COST-SUMMARY-007**: Markdown format includes "Cost Summary" heading with role and phase breakdowns.
- **AT-COST-SUMMARY-008**: JSON format includes `cost_summary` in `report.subject.run`.
- **AT-COST-SUMMARY-009**: CLI docs mention cost summary in audit/report command descriptions.

## Open Questions

None — this is a read-only aggregation of data already captured per-turn.
