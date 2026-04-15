# Replay Export Spec

## Purpose

`agentxchain replay export <file>` lets operators browse a completed run's governance state offline using the dashboard UI. It reads an export JSON file, extracts the embedded `.agentxchain/` artifacts into a temp workspace, starts the dashboard bridge-server against that workspace, and opens a browser. This enables post-mortem analysis of governed runs without requiring the original project directory or a live run.

## Interface

```
agentxchain replay export <export-file>
  --port <port>     Dashboard port (default: 3847)
  --no-open         Do not auto-open browser
  --json            Output session info as JSON (for CI/automation)
```

### Input

- `<export-file>`: path to an `export.json` file produced by `agentxchain export`
- File must contain `schema_version`, `files` object (embedded file contents), and `summary`

### Output

- **Interactive mode (default)**: starts dashboard server, prints URL, waits for Ctrl+C
- **JSON mode**: prints `{ port, url, export_file, run_id, export_schema_version }` and waits for Ctrl+C

## Behavior

1. Read and parse the export JSON file
2. Validate: must have `schema_version`, `files` object
3. Create a temp directory with a synthetic `agentxchain.json` and `.agentxchain/` structure
4. Write all embedded files from `export.files` into the temp workspace, preserving relative paths
5. Start the dashboard bridge-server with `agentxchainDir` pointing to the temp `.agentxchain/`
6. Print the dashboard URL
7. Optionally open browser
8. On SIGINT: stop server, clean up temp directory

### Read-only mode

The replayed dashboard is inherently read-only:
- No file watcher (static snapshot, nothing will change)
- Gate approval endpoint returns 403 with message "Replay mode: gate approval is not available on exported snapshots"
- WebSocket clients receive no invalidation events (static state)

## Error Cases

- Export file does not exist → exit 2 with clear message
- Export file is not valid JSON → exit 2 with parse error
- Export file missing `files` object → exit 2 with schema error
- Port already in use → exit 1 with port conflict message

## Acceptance Tests

- AT-REPLAY-EXPORT-001: `replay export valid-export.json` starts server and serves `/api/state`
- AT-REPLAY-EXPORT-002: dashboard serves state/history/events from the exported snapshot
- AT-REPLAY-EXPORT-003: gate approval returns 403 in replay mode
- AT-REPLAY-EXPORT-004: `--json` mode outputs structured session info
- AT-REPLAY-EXPORT-005: missing export file exits with code 2
- AT-REPLAY-EXPORT-006: invalid JSON exits with code 2
- AT-REPLAY-EXPORT-007: temp directory is cleaned up on server stop

## Open Questions

None — this is a rendering surface over existing export data.
