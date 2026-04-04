# Coordinator Workspace Export Spec

**Status**: Active
**Depends on**: `RUN_EXPORT_SPEC.md` (governed project export, shipped in Turn 12)

## Purpose

Extend `agentxchain export` to support coordinator workspaces. When run from a directory containing `agentxchain-multi.json`, the export must produce a single audit artifact that includes both coordinator-level evidence AND recursively embedded child repo governed exports.

## Non-Goals

- Tarball/zip output (JSON only, per `DEC-EXPORT-002`)
- Cross-network child repo fetching (repos must be locally accessible)
- Partial export with missing child repos succeeding silently

## Detection

`agentxchain export` currently calls `loadProjectContext(startDir)` which looks for `agentxchain.json`. Coordinator workspaces use `agentxchain-multi.json` instead.

Detection order:
1. If `agentxchain.json` exists → governed project export (existing behavior)
2. If `agentxchain-multi.json` exists → coordinator workspace export (new behavior)
3. Neither → error

## Coordinator Export Shape

```json
{
  "schema_version": "0.1",
  "export_kind": "agentxchain_coordinator_export",
  "exported_at": "<ISO timestamp>",
  "workspace_root": ".",
  "coordinator": {
    "project_id": "<from config>",
    "project_name": "<from config>",
    "schema_version": "0.1",
    "repo_count": 2,
    "workstream_count": 1
  },
  "summary": {
    "super_run_id": "<from state or null>",
    "status": "<from state or null>",
    "phase": "<from state or null>",
    "repo_run_statuses": { "web": "linked", "cli": "initialized" },
    "barrier_count": 1,
    "history_entries": 5,
    "decision_entries": 2
  },
  "files": {
    "agentxchain-multi.json": { "format": "json", "bytes": N, "sha256": "...", "data": {...} },
    ".agentxchain/multirepo/state.json": { ... },
    ".agentxchain/multirepo/history.jsonl": { ... },
    ".agentxchain/multirepo/barriers.json": { ... },
    ".agentxchain/multirepo/decision-ledger.jsonl": { ... },
    ".agentxchain/multirepo/barrier-ledger.jsonl": { ... }
  },
  "config": { "<raw agentxchain-multi.json>" },
  "repos": {
    "web": {
      "ok": true,
      "path": "./repos/web",
      "export": { "<full governed run export>" }
    },
    "cli": {
      "ok": true,
      "path": "./repos/cli",
      "export": { "<full governed run export>" }
    }
  }
}
```

## Child Repo Embedding

For each repo declared in `agentxchain-multi.json`:
1. Resolve the absolute path from the coordinator workspace root
2. Call `buildRunExport(repoAbsPath)` to get the governed project export
3. If the child export succeeds (`ok: true`), embed it under `repos[repoId].export`
4. If the child export fails (`ok: false`), record the error:
   ```json
   { "ok": false, "path": "./repos/web", "error": "No governed project found..." }
   ```
5. The coordinator export itself succeeds even if child repos fail — but the summary must reflect this

## Coordinator Files

The coordinator export includes these files from the workspace root:
- `agentxchain-multi.json` (config)
- `.agentxchain/multirepo/state.json`
- `.agentxchain/multirepo/history.jsonl`
- `.agentxchain/multirepo/barriers.json`
- `.agentxchain/multirepo/decision-ledger.jsonl`
- `.agentxchain/multirepo/barrier-ledger.jsonl`

Files that do not exist are simply omitted (coordinator may be pre-init).

## Failure Semantics

- No `agentxchain-multi.json` AND no `agentxchain.json` → `ok: false` with descriptive error
- `agentxchain-multi.json` exists but is invalid JSON → `ok: false`
- `agentxchain-multi.json` valid but child repo path does not exist → child entry `ok: false`, coordinator export `ok: true`
- `agentxchain-multi.json` valid but no `.agentxchain/multirepo/` yet → export still succeeds with empty `files` and `summary` showing null state

## Acceptance Tests

1. `AT-COORD-EXPORT-001`: Export from coordinator workspace produces `export_kind: "agentxchain_coordinator_export"`
2. `AT-COORD-EXPORT-002`: Coordinator files are included with correct format/sha256/data
3. `AT-COORD-EXPORT-003`: Child repo exports are recursively embedded under `repos[id].export`
4. `AT-COORD-EXPORT-004`: Child repo failure does not fail the coordinator export; `repos[id].ok` is false with error
5. `AT-COORD-EXPORT-005`: Pre-init coordinator (no `.agentxchain/multirepo/`) exports with null summary fields
6. `AT-COORD-EXPORT-006`: `--output` writes coordinator export to file
7. `AT-COORD-EXPORT-007`: Summary includes correct `repo_run_statuses`, `barrier_count`, `history_entries`
8. `AT-COORD-EXPORT-008`: Coordinator export from governed project root still produces governed export (detection order)

## Open Questions

None. The shape is constrained by `DEC-EXPORT-001` through `005` and the coordinator state schema.
