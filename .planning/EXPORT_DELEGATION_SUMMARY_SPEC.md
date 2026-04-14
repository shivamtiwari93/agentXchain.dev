# Export Delegation Summary Spec

## Purpose

Extend the `agentxchain export` summary to surface delegation chain metadata explicitly, so operators and compliance reviewers can see delegation activity at a glance without parsing raw `history.jsonl` entries.

## Interface

The `summary` object in `agentxchain_run_export` gains a new `delegation_summary` field:

```json
{
  "summary": {
    "...existing fields...",
    "delegation_summary": {
      "total_delegations_issued": 2,
      "delegation_chains": [
        {
          "parent_turn_id": "turn_001",
          "parent_role": "director",
          "delegations": [
            {
              "delegation_id": "del-001",
              "to_role": "dev",
              "charter": "Implement feature X",
              "status": "completed",
              "child_turn_id": "turn_002"
            },
            {
              "delegation_id": "del-002",
              "to_role": "qa",
              "charter": "Verify feature X",
              "status": "failed",
              "child_turn_id": "turn_003"
            }
          ],
          "review_turn_id": "turn_004",
          "outcome": "mixed"
        }
      ]
    }
  }
}
```

When no delegation activity exists, the field is:

```json
{
  "delegation_summary": {
    "total_delegations_issued": 0,
    "delegation_chains": []
  }
}
```

## Behavior

1. Scan `history.jsonl` entries (already parsed as `files['.agentxchain/history.jsonl'].data`) for:
   - Entries with `delegations_issued` → parent turns that started chains
   - Entries with `delegation_context` → child turns that executed delegations
   - Entries with `delegation_review` → review turns that closed chains

2. Build chains by grouping on `parent_turn_id`:
   - Each chain has one parent, N delegated children, and optionally one review turn
   - Each delegation entry includes the `delegation_id`, `to_role`, `charter`, `status` (from review results or from delegation_context presence), and `child_turn_id`
   - The review turn's `delegation_review.results` provides per-delegation status

3. `outcome` is derived:
   - `"completed"` if all delegations completed
   - `"failed"` if all delegations failed
   - `"mixed"` if some completed and some failed
   - `"pending"` if no review turn exists yet (chain still in progress)

4. `total_delegations_issued` is the sum of all `delegations_issued` arrays across all parent turns.

## Error Cases

- If `history.jsonl` is missing or unparseable, `delegation_summary` is `null`.
- Orphaned delegation context (child turn references a parent_turn_id not in history) is included but the chain may have incomplete parent info.

## Acceptance Tests

- AT-EXPORT-DEL-001: Export of a project with no delegations has `delegation_summary.total_delegations_issued === 0` and empty `delegation_chains`.
- AT-EXPORT-DEL-002: Export of a project with a completed delegation chain has correct `parent_turn_id`, `parent_role`, delegation entries with `to_role`/`charter`/`status`, and `review_turn_id`.
- AT-EXPORT-DEL-003: Export of a project with a mixed-outcome chain has `outcome: "mixed"`.
- AT-EXPORT-DEL-004: Export of a project with an in-progress chain (no review turn yet) has `outcome: "pending"`.
- AT-EXPORT-DEL-005: Docs page names `delegation_summary` and its fields.

## Open Questions

None. The delegation history retention contract is already frozen by `DEC-DASHBOARD-DELEGATION-001`.
