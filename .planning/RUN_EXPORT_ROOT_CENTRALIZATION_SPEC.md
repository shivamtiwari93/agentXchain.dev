## Run Export Root Centralization Spec

**Status:** proposed
**Created:** Turn 254 — GPT 5.4

### Purpose

Eliminate duplicated continuity-root lists between `repo-observer.js` and `export.js` so orchestrator-owned run state cannot silently drift out of `agentxchain export` / `agentxchain restore`.

### Interface

- `cli/src/lib/repo-observer.js`
  - exports `RUN_CONTINUITY_STATE_FILES`
  - exports `RUN_CONTINUITY_DIRECTORY_ROOTS`
- `cli/src/lib/export.js`
  - derives `RUN_EXPORT_INCLUDED_ROOTS`
  - derives `RUN_RESTORE_ROOTS`

### Behavior

1. `repo-observer.js` remains the source of truth for orchestrator-owned path ownership.
2. Export/restore do **not** blindly reuse every operational path prefix.
3. Export/restore reuse a repo-observer-owned **continuity subset**:
   - state files needed to move a governed run across checkouts
   - directory roots whose contents are part of governed continuity state
4. Export-only extras that are not part of governed continuity remain explicit in `export.js`:
   - `agentxchain.json`
   - dashboard snapshot files
   - `.planning`
5. Restore excludes export-only extras that should not be restored:
   - dashboard snapshot files
6. Previously drifted continuity paths must be covered explicitly:
   - `.agentxchain/repo-decisions.jsonl`
   - `.agentxchain/lock.json`
   - `.agentxchain/missions/**`

### Error Cases

1. A new orchestrator-owned continuity file is added to observation ownership but omitted from export/restore.
2. Export roots silently diverge from restore roots for continuity files.
3. Export/restore starts sweeping non-continuity operational prefixes such as `dispatch-progress-*`.

### Acceptance Tests

- `AT-EXPORT-CENT-001`: shared continuity roots are imported from `repo-observer.js`, not re-declared in `export.js`.
- `AT-EXPORT-CENT-002`: run export/restore include `.agentxchain/repo-decisions.jsonl`, `.agentxchain/lock.json`, and `.agentxchain/missions/**` when present.
- `AT-EXPORT-CENT-003`: dashboard snapshot files remain export-only and are not added to restore roots.
- `AT-XRESTORE-006`: restore reproduces `.agentxchain/repo-decisions.jsonl`, `.agentxchain/lock.json`, and `.agentxchain/missions/**` from a run export.

### Open Questions

None. This slice centralizes existing continuity truth; it does not widen export scope beyond governed continuity state plus already-documented export-only metadata.
