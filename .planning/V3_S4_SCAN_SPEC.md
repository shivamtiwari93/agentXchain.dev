# V3-S4 Spec — Deterministic Intake Scan

> Standalone implementation spec for the shipped v3 slice that added `agentxchain intake scan` as an additive source-scanning command that converts structured source snapshots into repo-native intake events through the existing intake pipeline.

---

## Purpose

S1 through S3 already cover repo-native signal recording, governed triage, approval, planning, and explicit execution start.

S4 added the smaller additive slice: deterministic source scanning.

`intake scan` should let operators or automation feed structured snapshots from supported sources into the existing intake pipeline without inventing a hosted daemon, without live API dependencies, and without bypassing governance.

---

## Interface

### CLI Command

```bash
agentxchain intake scan --source <ci_failure|git_ref_change|schedule> (--file <path> | --stdin) [--json]
```

**Options:**

- `--source <id>` — required; one of `ci_failure`, `git_ref_change`, `schedule`
- `--file <path>` — required unless `--stdin` is used; path to a source snapshot JSON file
- `--stdin` — read the source snapshot from stdin
- `--json` — emit machine-readable scan results

### Snapshot Contract

Each scan invocation consumes one source-specific snapshot object:

```json
{
  "source": "ci_failure",
  "captured_at": "2026-04-03T23:00:00Z",
  "items": [
    {
      "signal": {
        "workflow": "publish-npm-on-tag",
        "run_id": "23944719936",
        "status": "failed"
      },
      "evidence": [
        {
          "type": "url",
          "value": "https://github.com/shivamtiwari93/agentXchain.dev/actions/runs/23944719936"
        }
      ],
      "category": "delivery_regression"
    }
  ]
}
```

The command does not define a live polling contract. It only consumes explicit snapshots.

### Output Contract

**JSON output:**

```json
{
  "ok": true,
  "source": "ci_failure",
  "scanned": 2,
  "created": 1,
  "deduplicated": 1,
  "rejected": 0,
  "results": [
    {
      "status": "created",
      "event_id": "evt_1712273200000_a1b2",
      "intent_id": "intent_1712273200100_c3d4"
    },
    {
      "status": "deduplicated",
      "event_id": "evt_1712273199000_e5f6",
      "intent_id": "intent_1712273199100_a7b8"
    }
  ]
}
```

---

## Behavior

1. `intake scan` only works inside a repo with a valid `agentxchain.json`.
2. The provided `--source` must match `snapshot.source`.
3. The snapshot must contain a non-empty `items` array.
4. Each item must contain:
   - `signal` as a non-empty object
   - `evidence` as a non-empty array compatible with `recordEvent()`
   - optional `category`, `repo`, and `ref`
5. `captured_at` is accepted as informational metadata only. S4 does not validate it and does not persist it into intake artifacts.
6. For each valid item, `intake scan` must reuse the existing `recordEvent()` path. It must not reimplement deduplication or intent creation.
7. Scan is additive only:
   - create events and linked `detected` intents when the signal is new
   - return `deduplicated` when the signal already exists
   - do not triage, approve, plan, or start execution
8. Scan processing is per-item deterministic:
   - one bad item must not corrupt or roll back previously recorded good items
   - rejected items are reported in the result set with their validation error
9. Supported source semantics for S4:
   - `ci_failure`: snapshot describes failed workflow or job signals
   - `git_ref_change`: snapshot describes new tags, release branches, or protected-branch divergence
   - `schedule`: snapshot describes timed checks such as stale release evidence or unresolved blocked runs
10. `manual` is intentionally out of scope for `scan`. Manual input already has `intake record`.

---

## Error Cases

1. **No project root**: exit 2 with `agentxchain.json not found`
2. **Unknown source**: exit 1 listing supported scan sources
3. **Missing input mode**: exit 1 when neither `--file` nor `--stdin` is provided
4. **Conflicting input mode**: exit 1 when both `--file` and `--stdin` are provided
5. **Unreadable snapshot file**: exit 2 with the file path
6. **Invalid JSON snapshot**: exit 1 with the parse error
7. **Source mismatch**: exit 1 when `--source` and `snapshot.source` disagree
8. **Empty `items` array**: exit 1 because an empty scan has no meaningful intake result
9. **Malformed snapshot item**: report the item as `rejected` with a deterministic validation error
10. **Zero valid items**: exit 1 only when every scanned item is rejected

---

## Acceptance Tests

- `AT-V3S4-001`: `intake scan --source ci_failure --file <snapshot>` creates a new event and linked detected intent for a valid failure item
- `AT-V3S4-002`: scanning the same snapshot twice returns `deduplicated` on the second run and does not create duplicate intents
- `AT-V3S4-003`: `intake scan --source git_ref_change --stdin` accepts stdin snapshots and records new events
- `AT-V3S4-004`: malformed items are reported as `rejected` without preventing valid sibling items from being recorded
- `AT-V3S4-005`: source mismatch between CLI flag and snapshot body fails deterministically
- `AT-V3S4-006`: `manual` is rejected as a scan source because `record` already covers manual ingestion
- `AT-V3S4-007`: `intake scan` never transitions intents past `detected`
- `AT-V3S4-008`: `intake scan` rejects an empty `items` array with exit 1 instead of treating it as a no-op success

---

## Open Questions

None for S4 itself. Live polling, scheduled daemon behavior, and post-release observation reopen logic remain deferred beyond this slice.
