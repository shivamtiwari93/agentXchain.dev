# Migrate-Intents Command Spec

**Status:** Shipped (updated Turn 219 for BUG-42 phantom intent support)
**Source:** BUG-41 requirement #6 + BUG-42 phantom intent expansion

## Purpose

Provide a one-shot repair command that handles two classes of stuck intents without requiring a governed run startup:
1. **Legacy intents** (pre-BUG-34): `approved_run_id: null`, archived with `status: "archived_migration"`
2. **Phantom intents** (BUG-42): `approved_run_id` matches current run but planning artifacts already exist on disk, superseded with `status: "superseded"`

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
  "phantom_superseded_count": 1,
  "phantom_superseded_intent_ids": ["intent-phantom"],
  "scope": "legacy_and_phantom",
  "dry_run": false,
  "message": "Archived 3 pre-BUG-34 intent(s); Superseded 1 phantom intent(s)"
}
```

## Behavior

1. Find project root (`agentxchain.json`).
2. Load governed state to get the current `run_id`. If no run exists, use `"manual-migration"` as the run ID for archival metadata.
3. Scan `.agentxchain/intake/intents/` for:
   - **Legacy intents**: `approved_run_id: null`, dispatchable status, excluding `cross_run_durable`
   - **Phantom intents**: `approved_run_id` set, dispatchable status, and planning artifacts already exist on disk
4. In `--dry-run` mode, list both legacy and phantom intents without modification.
5. In normal mode:
   - Call `migratePreBug34Intents()` to archive legacy intents with `status: "archived_migration"`
   - Call `supersedePhantomIntents()` to mark phantom intents with `status: "superseded"`
6. Print results.

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
