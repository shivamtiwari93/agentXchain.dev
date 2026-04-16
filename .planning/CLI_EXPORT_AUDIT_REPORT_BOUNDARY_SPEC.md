# CLI Export / Audit / Report Boundary Spec

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-16

## Purpose

Freeze the front-door CLI contract for the three adjacent governance surfaces that operators keep confusing:

- `agentxchain export`
- `agentxchain audit`
- `agentxchain report`

These are intentionally related, but they are **not interchangeable**. If the CLI reference blurs them, operators lose the artifact boundary, restore/handoff guidance becomes sloppy, and future docs drift starts from the front door.

## Interface

The CLI reference page at `website-v2/docs/cli.mdx` must present these commands as three distinct surfaces:

```bash
agentxchain export [--format json] [--output <path>]
agentxchain audit [--format text|json|markdown|html]
agentxchain report [--input <path>|-] [--format text|json|markdown|html]
```

## Behavior

### `export`

- Produces the **raw portable artifact** from the current governed project or coordinator workspace.
- Writes JSON only in the current shipped slice.
- Prints to stdout by default or persists the artifact with `--output`.
- Preserves raw file bytes via `content_base64` so `verify export` can recompute integrity from the artifact itself.
- Is the source artifact for handoff, offline review, and restore paths.
- Must not be documented as a derived governance summary surface.

### `audit`

- Reads **live repo/workspace state** from the current directory.
- Builds the same export artifact that `export` would build for that directory.
- Verifies that fresh artifact before rendering output.
- Reuses the same derived governance report contract as `report`.
- Must not be documented as an offline input reader or as a portable artifact command.

### `report`

- Consumes an **existing export artifact** via `--input <path>` or stdin.
- Verifies that existing artifact before rendering output.
- Produces the derived governance summary in `text`, `json`, `markdown`, or `html`.
- Must not be documented as reading live repo state directly.

### Front-door comparison rule

The CLI reference must make the operator choice explicit:

- use `export` when you need the portable raw artifact
- use `audit` when you need the live current-repo audit
- use `report` when you already have an artifact and want the verified derived summary

## Error Cases

- CLI docs imply `export`, `audit`, and `report` are interchangeable summary commands
- CLI docs describe `audit` as reading `--input`
- CLI docs describe `report` as reading live repo state directly
- CLI docs describe `export` as if it were already the derived report surface

## Acceptance Tests

- `AT-CLI-EAR-001`: CLI docs describe `export` as the portable raw artifact surface and mention `content_base64` / `verify export`.
- `AT-CLI-EAR-002`: CLI docs describe `audit` as live-state inspection that builds and verifies a fresh artifact before rendering the report contract.
- `AT-CLI-EAR-003`: CLI docs describe `report` as consuming an existing export artifact via `--input <path>` or stdin and verifying that artifact first.
- `AT-CLI-EAR-004`: CLI docs include an explicit operator-facing comparison that tells users when to choose `export` vs `audit` vs `report`.
- `AT-CLI-EAR-005`: Guard tests fail if the CLI front door blurs those three surfaces back into one interchangeable summary path.

## Open Questions

- None. The shipped CLI command boundary is already decided; this spec exists to keep the docs truthful.
