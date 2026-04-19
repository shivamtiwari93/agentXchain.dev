# Migrate-Intents Command Spec

**Status:** Implementing
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
  "dry_run": false,
  "message": "Archived 3 pre-BUG-34 intent(s)"
}
```

## Behavior

1. Find project root (`agentxchain.json`).
2. Load governed state to get the current `run_id`. If no run exists, use `"manual-migration"` as the run ID for archival metadata.
3. Scan `.agentxchain/intake/intents/` for intent files with `approved_run_id: null` (or absent) and dispatchable status (`planned` or `approved`), excluding `cross_run_durable` intents.
4. In `--dry-run` mode, list them without modification.
5. In normal mode, call `migratePreBug34Intents()` from `intent-startup-migration.js` to archive them with `status: "archived_migration"`.
6. Print results.

## Error Cases

- No `agentxchain.json` found → error with guidance to run from inside a project.
- No intents directory → report 0 legacy intents found, exit cleanly.
- No legacy intents found → report 0, exit cleanly.

## Acceptance Tests

- `AT-MI-001`: repo with 3 legacy intents → `migrate-intents` archives all 3, returns correct count and IDs.
- `AT-MI-002`: repo with 0 legacy intents → returns `archived_count: 0`, no error.
- `AT-MI-003`: `--dry-run` lists intents but does not modify them on disk.
- `AT-MI-004`: `cross_run_durable` intents are not archived.
- `AT-MI-005`: non-governed project → error.

## Open Questions

None.
