# Migrate-Intents Command Spec

**Status:** Shipped
**Source:** BUG-41 requirement #6 — operator escape hatch for repos with stuck legacy intents

## Purpose

Provide a one-shot repair command that archives all legacy intents (pre-BUG-34 intents with `approved_run_id: null`) without requiring a governed run startup. This is belt-and-suspenders insurance: the BUG-41 fix makes automatic startup migration idempotent, but operators who already have stuck repos need a direct lever.

## Interface

```
agentxchain migrate-intents [--json] [--dry-run]
```

### Flags

- `--json` — structured JSON output
- `--dry-run` — list legacy intents that would be archived, without modifying them

### Output (JSON mode)

```json
{
  "archived_count": 3,
  "archived_intent_ids": ["intent-abc", "intent-def", "intent-ghi"],
  "scope": "legacy_null_run_only",
  "skipped_run_scoped_count": 1,
  "skipped_run_scoped_intent_ids": ["intent-run-bound"],
  "warnings": [
    "migrate-intents only archives legacy intents with no approved_run_id; run-scoped intents were left unchanged."
  ],
  "dry_run": false,
  "message": "Archived 3 pre-BUG-34 intent(s)"
}
```

## Behavior

1. Find project root (`agentxchain.json`).
2. Load governed state to get the current `run_id`. If no run exists, use `"manual-migration"` as the run ID for archival metadata.
3. Scan `.agentxchain/intake/intents/` for intent files with `approved_run_id: null` (or absent) and dispatchable status (`planned` or `approved`), excluding `cross_run_durable` intents.
4. Also scan for dispatchable intents that already have `approved_run_id` set. These run-scoped intents are explicitly out of scope for this command.
5. In `--dry-run` mode, list the legacy null-scoped intents without modification and report any skipped run-scoped intents.
6. In normal mode, call `migratePreBug34Intents()` from `intent-startup-migration.js` to archive only the legacy null-scoped intents with `status: "archived_migration"`.
7. Print results, including an explicit boundary warning when run-scoped intents were skipped.

## Error Cases

- No `agentxchain.json` found → error with guidance to run from inside a project.
- No intents directory → report 0 legacy intents found, exit cleanly.
- No legacy intents found → report 0, exit cleanly.
- Run-scoped dispatchable intents exist → do not modify them; report that they were skipped because `migrate-intents` only repairs legacy null-scoped intents.

## Acceptance Tests

- `AT-MI-001`: repo with 3 legacy intents → `migrate-intents` archives all 3, returns correct count and IDs.
- `AT-MI-002`: repo with 0 legacy intents → returns `archived_count: 0`, no error.
- `AT-MI-003`: `--dry-run` lists intents but does not modify them on disk.
- `AT-MI-004`: `cross_run_durable` intents are not archived.
- `AT-MI-005`: run-scoped dispatchable intents are not archived and are reported as skipped.
- `AT-MI-006`: JSON output includes the command boundary (`scope`) so external tooling does not infer stale-run cleanup support that the command does not provide.
- `AT-MI-007`: non-governed project → error.

## Open Questions

None. Run-scoped stale-intent archival remains a separate startup reconciliation concern, not part of `migrate-intents`.
