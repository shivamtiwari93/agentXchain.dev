# Export Verification Completeness Spec

## Purpose

Extend `agentxchain verify export` to validate three currently-unverified summary fields — `delegation_summary`, `repo_decisions`, and `dashboard_session` — by reconstructing them from embedded export artifacts and failing closed on any mismatch.

Currently the verifier reconstructs counters, state fields, and `aggregated_events` from embedded files but trusts `delegation_summary`, `repo_decisions`, and `dashboard_session` as opaque summary JSON. This means a tampered export can claim false delegation chains, fabricated repo decisions, or impossible dashboard state and still pass verification.

## Interface

No new CLI commands. Extends existing `agentxchain verify export` behavior.

### Verification extensions (run exports only)

1. **`summary.delegation_summary`** — reconstructed from embedded `.agentxchain/history.jsonl`
2. **`summary.repo_decisions`** — reconstructed from embedded `.agentxchain/repo-decisions.jsonl`
3. **`summary.dashboard_session`** — schema-validated (structure/types only; ephemeral state cannot be reconstructed)

## Behavior

### delegation_summary verification

The verifier reconstructs the delegation summary using the same algorithm as `buildDelegationSummary(files)` in `export.js`:
- Index history entries by `delegations_issued` (parent turns), `delegation_context` (child turns), `delegation_review` (review turns)
- Correlate by `delegation_id` and `parent_turn_id`
- Derive `total_delegations_issued`, `delegation_chains` with per-delegation status/outcome

**Fail conditions:**
- `total_delegations_issued` mismatch
- `delegation_chains` length mismatch
- Any chain has different `parent_turn_id`, `parent_role`, `outcome`, or `review_turn_id`
- Any delegation within a chain has different `delegation_id`, `to_role`, `charter`, `status`, `child_turn_id`, `required_decision_ids`, `satisfied_decision_ids`, or `missing_decision_ids`
- Summary claims delegations when history.jsonl contains none (or vice versa)

**Skip conditions:**
- `delegation_summary` is `null` or absent AND no delegation-related entries exist in history — both sides agree there are no delegations, valid

### repo_decisions verification

The verifier reconstructs repo decisions from embedded `.agentxchain/repo-decisions.jsonl`:
- Parse the JSONL data
- Separate active vs overridden entries
- Build the same summary structure as `buildRepoDecisionsSummary()`

**Fail conditions:**
- `total` mismatch
- `active_count` or `overridden_count` mismatch
- `active` array content mismatch (id, category, statement, role, run_id)
- `overridden` array content mismatch (id, overridden_by, statement)
- Summary claims repo decisions when file is empty (or vice versa)

**Skip conditions:**
- `repo_decisions` is `null` AND no `.agentxchain/repo-decisions.jsonl` file exists in the export — valid
- `repo_decisions` is `null` AND the file exists but is empty — valid

### dashboard_session validation

Dashboard session is ephemeral — the PID/session files are outside the export archive and the dashboard may have restarted since export. Full reconstruction is not possible.

**Schema validation only:**
- `status` must be one of: `"running"`, `"pid_only"`, `"stale"`, `"not_running"`
- `pid` must be a positive integer or `null`
- `url` must be a string or `null`
- `started_at` must be a valid ISO timestamp string or `null`
- If `status` is `"not_running"`, `pid`, `url`, and `started_at` must all be `null`
- If `status` is `"running"`, `pid` must be a positive integer

**Skip conditions:**
- `dashboard_session` is absent or `undefined` — valid (older exports)

## Error Cases

- Tampered `delegation_summary` with inflated `total_delegations_issued` → fail
- Tampered `repo_decisions` with fabricated active decisions → fail
- `dashboard_session` with invalid status enum → fail
- `dashboard_session` claiming "running" with null PID → fail
- Missing `.agentxchain/repo-decisions.jsonl` in files map but non-null `repo_decisions` → fail

## Acceptance Tests

1. AT-VERIFY-DEL-001: Export with delegations — verifier reconstructs and passes when summary matches
2. AT-VERIFY-DEL-002: Tampered `total_delegations_issued` → verifier fails
3. AT-VERIFY-DEL-003: Tampered delegation chain outcome → verifier fails
4. AT-VERIFY-DEL-004: No delegations in history, null summary → verifier passes
5. AT-VERIFY-REPO-001: Export with repo decisions — verifier reconstructs and passes when summary matches
6. AT-VERIFY-REPO-002: Tampered `active_count` → verifier fails
7. AT-VERIFY-REPO-003: Fabricated active decision not in JSONL → verifier fails
8. AT-VERIFY-REPO-004: No repo-decisions.jsonl, null summary → verifier passes
9. AT-VERIFY-DASH-001: Valid dashboard_session schema → verifier passes
10. AT-VERIFY-DASH-002: Invalid status enum → verifier fails
11. AT-VERIFY-DASH-003: Status "running" with null PID → verifier fails
12. AT-VERIFY-DASH-004: Status "not_running" with non-null PID → verifier fails

## Open Questions

None. The verification patterns follow the established approach from `aggregated_events` verification.
