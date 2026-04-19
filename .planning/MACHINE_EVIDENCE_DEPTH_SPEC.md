# Machine Evidence Depth Spec

## Status
Shipped — dispatch log excerpts now render for review-only turns with bounded truncation and acceptance-test coverage.

## Problem

QA review turns see `machine_evidence` as a table of `command | exit_code` pairs. This is agent-self-reported metadata — it tells QA "npm test exited 0" but not "25 assertions passed" or what the test output actually said.

The subprocess stdout/stderr is **already captured** to `.agentxchain/dispatch/turn_{ID}/stdout.log` by the `local_cli` adapter (via `saveDispatchLogs()`). It is simply never surfaced in CONTEXT.md.

This means QA cannot distinguish a real test run from a stub that exits 0. The evidence gap is not in capture — it is in rendering.

## Scope

Rendering-only. No protocol, history schema, or observation-layer changes.

- Read the dispatch log from the last completed turn's dispatch directory
- Render a bounded tail excerpt in CONTEXT.md for `review_only` turns only
- Skip gracefully when the log file does not exist (e.g., `manual` or `api_proxy` turns)

## Design

### Source

`getDispatchLogPath(lastTurn.turn_id)` → `.agentxchain/dispatch/turns/{turn_id}/stdout.log`

### Rendering Location

After the existing `### Verification` section in `renderContext()`, before `### Observed Artifact`.

### Section Title

`### Dispatch Log Excerpt`

### Bounds

- **Max lines:** 50 (tail — the end of the log is most informative for test results)
- **Max bytes:** 8192 (guard against extremely long lines)
- **Truncation indicator:** `_Log truncated — showing last 50 lines of {total} total._` when the log exceeds the limit

### Eligibility

- Only rendered when `role.write_authority === 'review_only'` (same gate as file previews)
- Only rendered when the dispatch log file exists and is non-empty
- Authoritative turns do NOT see another turn's dispatch log

### Non-Goals

- Auto-populating `machine_evidence` from subprocess output (that would change protocol semantics)
- Parsing test framework output (grep for "passed", "failed", etc.)
- Rendering dispatch logs for `api_proxy` turns (they have `API_REQUEST.json` and `PROVIDER_RESPONSE.json` instead)

## Acceptance Tests

- **AT-MED-001:** Review-only turn CONTEXT.md includes `### Dispatch Log Excerpt` when the previous turn has a dispatch log
- **AT-MED-002:** Authoritative turns do NOT include the dispatch log section
- **AT-MED-003:** Long logs are truncated to the last 50 lines with a truncation indicator showing total line count
- **AT-MED-004:** Missing or empty dispatch log files are skipped cleanly (no section rendered)
- **AT-MED-005:** Logs exceeding 8192 bytes per line are truncated per-line

## Open Questions

None. The data is on disk, the rendering location is clear, the bounds are conservative.
