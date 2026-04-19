# Proposal Apply / Reject Spec

**Status:** Shipped
**Author:** Claude Opus 4.6
**Date:** 2026-04-07
**Decision:** DEC-PROPOSAL-APPLY-001 through DEC-PROPOSAL-APPLY-006

## Purpose

After an `api_proxy` agent with `proposed` write authority completes a turn, its proposed changes are materialized to `.agentxchain/proposed/<turn_id>/` for human review. Currently there is no operator command to apply or reject those proposals. This spec defines that surface.

## Commands

### `agentxchain proposal list`

Lists all pending proposals under `.agentxchain/proposed/`.

**Output:** One line per proposal: turn ID, role, file count, status (pending/applied/rejected).

### `agentxchain proposal diff <turn_id>`

Shows a unified diff of each proposed file against the current workspace version (or marks as new/deleted).

**Options:**
- `--file <path>` — show diff for a single file only

### `agentxchain proposal apply <turn_id>`

Copies proposed files from `.agentxchain/proposed/<turn_id>/` into the workspace. Deletes files marked as `delete` in PROPOSAL.md.

**Options:**
- `--file <path>` — apply only a specific file (selective apply)
- `--dry-run` — show what would change without writing

**Behavior:**
1. Validate that `.agentxchain/proposed/<turn_id>/` exists and contains `PROPOSAL.md`.
2. Parse `PROPOSAL.md` to extract file actions (create/modify/delete).
3. For each file action:
   - `create` / `modify`: copy from proposal dir to workspace path.
   - `delete`: remove the workspace file if it exists.
4. Write `.agentxchain/proposed/<turn_id>/APPLIED.json` with timestamp, operator, applied files.
5. Record `proposal_applied` entry in `decision-ledger.jsonl`.
6. Print summary of applied changes.

**Constraints:**
- Cannot apply a proposal that has already been applied (APPLIED.json exists).
- Cannot apply a proposal that has been rejected (REJECTED.json exists).
- If `--file` targets a file not in the proposal, error.

### `agentxchain proposal reject <turn_id>`

Marks a proposal as rejected without applying changes.

**Options:**
- `--reason <reason>` — required rejection reason

**Behavior:**
1. Validate proposal dir exists.
2. Write `.agentxchain/proposed/<turn_id>/REJECTED.json` with timestamp, reason.
3. Record `proposal_rejected` entry in `decision-ledger.jsonl`.
4. Print confirmation.

**Constraints:**
- Cannot reject an already-applied proposal.
- Cannot reject an already-rejected proposal.
- `--reason` is required.

## State Model

Proposals have three states tracked by sentinel files:
- **pending**: No APPLIED.json or REJECTED.json.
- **applied**: APPLIED.json exists.
- **rejected**: REJECTED.json exists.

No changes to `state.json` or the run state machine. Proposals are post-acceptance artifacts — they exist outside the turn lifecycle.

## Ledger Integration

Both apply and reject write to `decision-ledger.jsonl`:

```json
{
  "id": "DEC-PROP-APPLY-<turn_id>",
  "category": "proposal",
  "action": "applied",
  "turn_id": "<turn_id>",
  "files": ["src/foo.js", "src/bar.js"],
  "timestamp": "2026-04-07T..."
}
```

## Error Cases

| Condition | Error |
|-----------|-------|
| Proposal dir missing | `No proposal found for turn <id>` |
| Already applied | `Proposal <id> has already been applied` |
| Already rejected | `Proposal <id> has already been rejected` |
| --file not in proposal | `File <path> is not part of proposal <id>` |
| No PROPOSAL.md | `Proposal <id> is malformed (missing PROPOSAL.md)` |
| --reason missing on reject | `--reason is required to reject a proposal` |

## Acceptance Tests

1. `proposal list` shows pending proposals with correct metadata.
2. `proposal list` shows applied/rejected status after those actions.
3. `proposal apply <id>` copies files to workspace and creates APPLIED.json.
4. `proposal apply <id> --file <path>` applies only that file.
5. `proposal apply <id> --dry-run` shows changes without writing.
6. `proposal apply` on already-applied proposal errors.
7. `proposal reject <id> --reason "..."` creates REJECTED.json.
8. `proposal reject` on already-rejected proposal errors.
9. `proposal reject` without `--reason` errors.
10. `proposal diff <id>` shows unified diff against workspace.
11. Both apply and reject write decision-ledger entries.
12. `proposal apply` with delete action removes workspace file.

## Open Questions

None. This is a narrow, well-scoped operator surface.
