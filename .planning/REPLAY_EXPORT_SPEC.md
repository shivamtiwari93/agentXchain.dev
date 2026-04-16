# Replay Export Spec

## Purpose

`agentxchain replay export <file>` lets operators browse a completed export artifact offline using the dashboard UI. It reads an export JSON file, restores the embedded governance files into a temporary workspace, starts the dashboard bridge-server against that workspace, and opens a browser. This enables post-mortem analysis without requiring the original project directory or a live run.

This command is intentionally broader than `restore`. `restore` is a governed continuity surface and accepts only governed run exports. `replay export` is a read-only observability surface and accepts both governed run exports and coordinator exports.

That does **not** make it interchangeable with the other artifact commands:

- `audit` inspects the live current repo/workspace.
- `report --input` reads an existing export artifact and renders a derived summary document.
- `replay export` reads an existing export artifact and renders the read-only dashboard instead of a summary document.

## Interface

```
agentxchain replay export <export-file>
  --port <port>     Dashboard port (default: 3847)
  --no-open         Do not auto-open browser
  --json            Output session info as JSON (for CI/automation)
```

### Input

- `<export-file>`: path to an export artifact produced by `agentxchain export`
- Accepted export kinds:
  - `agentxchain_run_export`
  - `agentxchain_coordinator_export`
- File must contain `schema_version`, `files` object (embedded file contents), and `summary`

### Output

- **Interactive mode (default)**: starts dashboard server, prints URL, waits for Ctrl+C
- **JSON mode**: prints `{ port, url, export_file, run_id, export_schema_version, files_restored, temp_dir }` and waits for Ctrl+C

## Behavior

1. Read and parse the export JSON file
2. Validate: must have `schema_version`, `files` object, and a replayable export structure
3. Create a temp directory for the replay workspace
4. Restore all embedded top-level files from `export.files` into the temp workspace, preserving relative paths and original bytes from `content_base64`
5. If the artifact is a coordinator export:
   - restore successful nested child repo exports under each declared `repos.<repoId>.path`
   - create a minimal placeholder governed repo for failed child repos (`ok: false`) so coordinator dashboard views remain readable
6. Start the dashboard bridge-server with `agentxchainDir` pointing to the replayed temp `.agentxchain/`
7. Print the dashboard URL
8. Optionally open browser
9. On SIGINT or SIGTERM: stop server, clean up temp directory

### Supported replay shapes

- **Run export replay** restores the governed repo snapshot so `/api/state`, `/api/history`, `/api/events`, and related read-only dashboard views work against the replayed files.
- **Coordinator export replay** restores the coordinator workspace plus successful nested child repo exports so `/api/coordinator/*` surfaces work offline against the replayed artifact.
- **Failed coordinator child repos** do not block replay. AgentXchain restores a minimal placeholder repo at the declared path so coordinator status, validation, and history remain inspectable even when the nested repo export was unavailable.

### Read-only mode

The replayed dashboard is inherently read-only:
- No file watcher (static snapshot, nothing will change)
- Gate approval endpoint returns 403 with message "Replay mode: gate approval is not available on exported snapshots"
- WebSocket clients receive no invalidation events (static state)
- The temporary replay workspace is disposable and is removed when the replay server stops

Coordinator partial artifacts remain valid replay inputs. If `repos.<repoId>.ok === false`, replay still starts with a placeholder governed repo at that path. That is the same artifact boundary `report --input` uses for readable partial summaries; it is not permission to treat replay as a restore path or to fabricate a missing child export.

## Error Cases

- Export file does not exist → exit 2 with clear message
- Export file is not valid JSON → exit 2 with parse error
- Export file missing `files` object → exit 2 with schema error
- Export file has an object-shaped file entry without `content_base64` → exit 2 with schema error
- Coordinator repo is marked `ok: true` but has no nested `export.files` → exit 2 with schema error
- Port already in use → exit 1 with port conflict message

## Acceptance Tests

- AT-REPLAY-EXPORT-001: `replay export valid-export.json` starts server and serves `/api/state`
- AT-REPLAY-EXPORT-002: dashboard serves state/history/events from the exported snapshot
- AT-REPLAY-EXPORT-003: gate approval returns 403 in replay mode
- AT-REPLAY-EXPORT-004: `--json` mode outputs structured session info
- AT-REPLAY-EXPORT-005: missing export file exits with code 2
- AT-REPLAY-EXPORT-006: invalid JSON exits with code 2
- AT-REPLAY-EXPORT-007: temp directory is cleaned up on server stop
- AT-REPLAY-EXPORT-008: run exports and coordinator exports are both valid replay inputs
- AT-REPLAY-EXPORT-009: failed coordinator child exports do not block replay; placeholder repos preserve readable coordinator inspection
- AT-REPLAY-EXPORT-010: docs keep `audit` live-state, `report --input` artifact-summary, and `replay export` artifact-dashboard boundaries explicit, including partial coordinator artifact truth

## Open Questions

None — this is a rendering surface over existing export data.
