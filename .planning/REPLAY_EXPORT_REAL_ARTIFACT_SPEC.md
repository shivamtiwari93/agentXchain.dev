# Replay Export Real Artifact Spec

## Purpose

Make `agentxchain replay export` trustworthy against the **actual** export contract instead of toy fixtures. The command must restore the same file bytes that `agentxchain export` emitted and must support both single-repo run exports and coordinator exports with embedded child repo exports.

## Interface

Command:

```bash
agentxchain replay export <export-file> [--port <port>] [--json] [--no-open]
```

Accepted artifact shapes:

1. **Run export**: `export_kind: "agentxchain_run_export"`
2. **Coordinator export**: `export_kind: "agentxchain_coordinator_export"`

Accepted file-entry shapes inside `files`:

1. **Current contract**: export file object with `content_base64`
2. **Legacy compatibility**: raw string content

## Behavior

### File restoration

- For object-shaped file entries, replay must restore bytes from `content_base64`.
- Replay must not stringify export metadata objects back to disk.
- For raw string file entries, replay may continue restoring the string directly for backward compatibility.
- If a file entry is an object but lacks a usable `content_base64` string, replay fails closed with a command error.

### Run export replay

- Restore every file in `export.files` relative to a temp workspace root.
- Preserve `.agentxchain/` layout so dashboard endpoints (`/api/state`, `/api/history`, `/api/events`, etc.) read the restored snapshot directly.

### Coordinator export replay

- Restore coordinator-level files from `export.files` at the temp workspace root.
- For each `repos.<repoId>` entry where `ok === true` and a nested `export.files` object exists:
  - create the repo directory at `repos.<repoId>.path`
  - restore the nested run-export files relative to that repo root
- For failed child repos (`ok === false`), create a minimal governed placeholder repo at the declared path so coordinator dashboard validation still passes while making it obvious that the nested repo export was unavailable.
- After restoration, dashboard coordinator endpoints must work against the temp workspace:
  - `/api/coordinator/state`
  - `/api/coordinator/history`
  - `/api/coordinator/barriers`
  - `/api/coordinator/events`

### Session output

- `--json` output continues to include `port`, `url`, `export_file`, `run_id`, `export_schema_version`, `files_restored`, and `temp_dir`.
- Coordinator replay may report `run_id: null` when the export has only `summary.super_run_id`.

## Error Cases

- Missing export file path
- Invalid JSON export artifact
- Missing top-level `files` object
- Object-shaped file entry without `content_base64`
- Coordinator repo entry marked `ok: true` but missing nested `export.files`

## Acceptance Tests

- `AT-REPLAY-REAL-001`: replay restores a real run-export file entry object using `content_base64`; `/api/state` and `/api/events` return the original snapshot.
- `AT-REPLAY-REAL-002`: replay rejects an object-shaped file entry that lacks `content_base64`.
- `AT-REPLAY-REAL-003`: replay restores a coordinator export and rehydrates successful child repo exports under their declared repo paths.
- `AT-REPLAY-REAL-004`: replayed coordinator dashboard serves `/api/coordinator/events` from restored child repo event files.
- `AT-REPLAY-REAL-005`: failed child repo exports do not block coordinator replay when other repos are restorable.

## Open Questions

- None for this slice. Replay remains read-only and does not attempt coordinator mutation support.
