# Proposal Conflict Detection — Spec

**Status:** Shipped
**Author:** GPT 5.4 — Turn 122

## Purpose

Prevent `agentxchain proposal apply` from silently overwriting workspace changes that diverged after a proposal was staged.

## Interface

- Proposal materialization writes `.agentxchain/proposed/<turn_id>/SOURCE_SNAPSHOT.json`.
- `agentxchain proposal apply <turn_id>` performs divergence checks before writing.
- `agentxchain proposal apply <turn_id> --force` allows an explicit operator override when conflicts are detected or legacy proposals cannot be verified.

## Behavior

1. When an `api_proxy` turn with `write_authority: "proposed"` is accepted, the proposal directory records a source snapshot for every proposed file:
   - `path`
   - `action`
   - whether the file existed in the workspace when the proposal was materialized
   - `sha256` of the workspace content when it existed
2. `proposal apply` compares the current workspace state against that stored source snapshot before writing:
   - `create` is safe when the file is still absent, or when the current file already matches the proposed content
   - `modify` is safe when the current file still matches the captured source content, or when it already matches the proposed content
   - `delete` is safe when the current file still matches the captured source content, or when it is already absent
3. If the current workspace state matches neither the captured source state nor the proposed result, `proposal apply` fails closed with a conflict error.
4. If a legacy proposal has no `SOURCE_SNAPSHOT.json`, `proposal apply` attempts a fallback:
   - recover the turn from `.agentxchain/history.jsonl`
   - derive source hashes from `observed_artifact.baseline_ref` when it is a git ref
5. If neither a stored snapshot nor a truthful fallback is available, `proposal apply` fails closed unless the operator passes `--force`.
6. Forced applies remain auditable:
   - `APPLIED.json` records `forced: true`
   - `decision-ledger.jsonl` records `forced: true`
   - overridden conflict details or unverifiable paths are recorded in both places

## Error Cases

- Proposal directory missing
- `PROPOSAL.md` missing
- Proposal already applied
- Proposal already rejected
- `--file` targets a path not present in the proposal
- Workspace divergence detected for one or more targeted files
- Legacy proposal cannot be verified because no source snapshot or truthful history/git fallback exists

## Acceptance Tests

- [ ] AT-PROP-CONFLICT-001: accepted proposals materialize `SOURCE_SNAPSHOT.json`
- [ ] AT-PROP-CONFLICT-002: applying a stale proposal that targets a file changed since proposal capture fails closed
- [ ] AT-PROP-CONFLICT-003: applying an identical proposal onto a workspace already at the proposed content succeeds without false conflict
- [ ] AT-PROP-CONFLICT-004: `proposal apply --force` applies a conflicted proposal and records `forced: true` in `APPLIED.json` and the decision ledger
- [ ] AT-PROP-CONFLICT-005: subprocess CLI proof shows `proposal apply` rejects the second conflicting proposal, then succeeds with `--force`

## Open Questions

- None for this slice. Multi-proposal merge assistance stays out of scope; this slice is detection plus explicit operator override, not automatic reconciliation.
