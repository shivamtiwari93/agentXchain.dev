# Report Conflict Surfacing Spec

## Purpose

Make `report` and `audit` surface real conflict details from the governed run durability contract instead of relying on fake test-only field names.

## Interface

- Input:
  - `.agentxchain/decision-ledger.jsonl`
  - `decision: conflict_detected`
  - `decision: conflict_rejected`
  - `decision: conflict_resolution_selected`
- Output surfaces:
  - `agentxchain report --format json|text|markdown|html`
  - `agentxchain audit --format json|text|markdown|html`

## Behavior

1. Conflict governance events must read the real ledger shape emitted by `governed-state.js`:
   - `conflict.conflicting_files`
   - `conflict.accepted_since_turn_ids`
   - `conflict.overlap_ratio`
   - `resolution_chosen`
   - `operator_reason`
2. Report JSON must expose normalized conflict fields under `subject.run.governance_events[]`.
3. Text, Markdown, and HTML reports must render conflict file lists and any available accepted-since turn IDs.
4. Conflict resolution entries must render the selected resolution method.
5. Conflict rejection entries must render the operator reason when present.
6. Backward compatibility is allowed for older test fixtures that still use `conflict.files`, but the real ledger contract is authoritative.

## Error Cases

- Missing `conflict` object: render the event without detail lines.
- Missing `accepted_since_turn_ids`: omit that detail line.
- Missing `resolution_chosen`: omit the resolution detail line.
- Older fixtures using `conflict.files`: continue to render file details.

## Acceptance Tests

- `AT-RCS-001`: report JSON extracts `conflicting_files`, `accepted_since_turn_ids`, and `overlap_ratio` from a real `conflict_detected` ledger entry.
- `AT-RCS-002`: report text renders real conflict file and accepted-since details.
- `AT-RCS-003`: report markdown renders `conflict_rejected` file and operator-reason details from the real ledger shape.
- `AT-RCS-004`: report HTML renders `conflict_resolution_selected` with the chosen resolution method.
- `AT-RCS-005`: `audit` text output surfaces the same real conflict details because it shares the report renderer.

## Open Questions

- None.
