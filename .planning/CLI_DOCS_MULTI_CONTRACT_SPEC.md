# CLI Docs `multi` Command Family Contract

**Status:** shipped
**Slice:** CLI docs truthfulness — `multi` subcommands
**Created:** Turn 9 — Claude Opus 4.6

## Purpose

The `agentxchain multi` command family (5 subcommands) is shipped and registered in `cli/bin/agentxchain.js` but completely absent from the CLI reference (`website-v2/docs/cli.mdx`). The only mention is `agentxchain multi approve-gate` in the dashboard section — a single reference that proves the command exists while the docs hide it.

This is the same defect class as the intake omission (DEC-CLI-INTAKE-001): a shipped top-level command family hidden from the CLI reference.

## Current State (defective)

- Command map in `cli.mdx`: **no `multi` row**
- Dedicated `multi` section in `cli.mdx`: **does not exist**
- Sidebar / dedicated multi-repo page: **does not exist**
- The only docs reference: `agentxchain multi approve-gate` in the dashboard approval commands list (line ~287)

## Shipped Command Surface (from `agentxchain.js` lines 339-372)

| Subcommand | Description | Flags |
|------------|-------------|-------|
| `multi init` | Bootstrap a multi-repo coordinator run | `--json` |
| `multi status` | Show coordinator status and repo-run snapshots | `--json` |
| `multi step` | Select the next workstream and dispatch a coordinator turn | `--json` |
| `multi approve-gate` | Approve a pending phase transition or completion gate | `--json` |
| `multi resync` | Detect divergence and rebuild coordinator state from repo authority | `--json`, `--dry-run` |

## Key Behavioral Contracts (from `cli/src/commands/multi.js`)

1. **`multi init`**: requires `coordinator.yaml` (or equivalent) — fails with config errors if absent
2. **`multi status`**: requires prior `multi init` — fails if no coordinator state exists
3. **`multi step`**: reconcile-then-dispatch — detects divergence, resyncs if needed, selects next workstream, dispatches coordinator turn, fires hooks
4. **`multi approve-gate`**: gate evaluation before approval — evaluates phase or completion gates, fires gate hooks
5. **`multi resync`**: dry-run-capable divergence detection and state rebuild from repo authority

## Fix Plan

1. Add `multi` row to the command map in `cli.mdx`
2. Add a `## Multi-repo coordinator` section with an `### multi` heading
3. Document all 5 subcommands with their flags in a table
4. Document the behavioral flow: `init` → `status`/`step` → `approve-gate`, with `resync` as recovery
5. Link to the dashboard Initiative/Cross-Repo views as the visualization surface
6. Add a code-backed guard test

## Acceptance Tests

- AT-MC-001: `cli.mdx` command map contains a `multi` row
- AT-MC-002: `cli.mdx` contains a dedicated `### multi` section
- AT-MC-003: all 5 subcommands from `agentxchain.js` are documented in the section
- AT-MC-004: bidirectional flag alignment — every docs flag exists in CLI, every CLI flag is documented
- AT-MC-005: the section references `coordinator.yaml` as the config prerequisite
- AT-MC-006: `resync` `--dry-run` flag is documented
