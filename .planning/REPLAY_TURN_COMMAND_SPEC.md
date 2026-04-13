> **Status:** shipped
> **Decision:** `DEC-REPLAY-TURN-001`

# Replay Turn Command Spec

## Purpose

Provide a first-party governed CLI surface for replaying an already accepted turn's declared verification evidence from `.agentxchain/history.jsonl`.

This closes the gap between:

- `verify turn` proving the **staged** turn still reproduces before acceptance
- `history` and `report` showing accepted-turn summaries without a direct reproducibility rerun surface

The command is intentionally narrow. It is not a generic run re-executor, not a historical stdout/stderr recorder, and not a coordinator replay surface.

## Interface

### Command

```bash
agentxchain replay turn [turn_id] [--json] [--timeout <ms>]
```

### Inputs

- Optional positional `turn_id`
  - Accepts a full accepted-turn id or a unique prefix from `.agentxchain/history.jsonl`
  - If omitted, the command targets the most recent accepted turn in history
- Optional `--json`
  - Emits structured replay results instead of text
- Optional `--timeout <ms>`
  - Per-command replay timeout in milliseconds
  - Default: `30000`

## Behavior

1. The command is available only inside governed repo roots with `agentxchain.json`.
2. The command reads accepted turn entries from `.agentxchain/history.jsonl`.
3. If no positional `turn_id` is provided, the command targets the most recent accepted turn.
4. If a positional `turn_id` is provided, the command resolves exact match first, then unique prefix match, and fails closed on ambiguity.
5. Replay input comes only from `verification.machine_evidence[].command` on the accepted history entry.
6. Each replay command runs in the current repo root using the local shell and current workspace state.
7. The command compares actual exit code to declared `verification.machine_evidence[].exit_code`.
8. The command does not compare stdout/stderr text.
9. The command reports one of three overall outcomes:
   - `match`: every replayed command exited with the declared exit code
   - `mismatch`: one or more replayed commands drifted, errored, or timed out
   - `not_reproducible`: the accepted turn declared no `machine_evidence` commands to replay
10. Exit codes:
   - `0`: overall outcome is `match`
   - `1`: overall outcome is `mismatch` or `not_reproducible`
   - `2`: command/input/config error
11. The command never mutates state, history, ledgers, or gate status.
12. The command surfaces accepted-turn metadata alongside replay results:
   - `turn_id`
   - `run_id`
   - `role`
   - `phase`
   - `runtime_id`
   - `runtime_type`
   - `accepted_at`
13. The command may surface any prior acceptance-time `verification_replay` summary from the accepted history entry, but that historical summary is informational only. The command's exit code is based on the current replay result.

## Error Cases

- No `agentxchain.json` in scope
- Legacy or non-governed repo
- Missing or non-positive `--timeout`
- No accepted turn history found
- Unknown accepted `turn_id`
- Ambiguous accepted-turn prefix
- Replay command spawn error or timeout

## Acceptance Tests

1. **AT-RTURN-001**: `replay turn --json` with no explicit `turn_id` targets the most recent accepted turn and exits `0` with `overall: "match"` when its machine evidence reproduces.
2. **AT-RTURN-002**: `replay turn <unique_prefix>` resolves an accepted turn by unique prefix and text output includes accepted-turn metadata plus the replay outcome.
3. **AT-RTURN-003**: Ambiguous accepted-turn prefixes fail closed with exit code `2`.
4. **AT-RTURN-004**: Accepted turns with no `verification.machine_evidence` exit `1` with `overall: "not_reproducible"`.
5. **AT-RTURN-005**: Current-workspace drift against an accepted turn exits `1` with `overall: "mismatch"`.
6. **AT-RTURN-006**: Missing history or unknown accepted `turn_id` exits `2` with explicit operator guidance.
7. **AT-RTURN-007**: JSON output includes accepted-turn metadata (`run_id`, `role`, `phase`, `accepted_at`) and any previously recorded acceptance-time `verification_replay` summary when present.

## Open Questions

1. Should a future slice support coordinator-history replay across child repos, or should historical replay remain repo-local in v1?
2. Should a future slice allow replaying accepted turns from export artifacts offline, or is live repo-local history sufficient today?
