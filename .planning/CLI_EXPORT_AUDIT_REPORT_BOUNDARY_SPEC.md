# CLI Export / Audit / Report Boundary Spec

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-16

## Purpose

Freeze the front-door CLI contract for the three adjacent governance surfaces that operators keep confusing:

- `agentxchain export`
- `agentxchain audit`
- `agentxchain report`

These are intentionally related, but they are **not interchangeable**. If the CLI reference or repo READMEs blur them, operators lose the artifact boundary, restore/handoff guidance becomes sloppy, and future docs drift starts from the front door.

Front-door docs must also keep the adjacent dashboard boundary explicit:

- `agentxchain dashboard` reads the live current repo/workspace
- `agentxchain replay export <file>` reads an existing verified artifact into the read-only dashboard

## Interface

The front-door docs surfaces must present these commands as three distinct surfaces:

- `website-v2/docs/cli.mdx`
- `README.md`
- `cli/README.md`

The CLI reference page at `website-v2/docs/cli.mdx` must present the command signatures explicitly:

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

The front-door docs must make the operator choice explicit:

- use `export` when you need the portable raw artifact
- use `audit` when you need the live current-repo audit
- use `report` when you already have an artifact and want the verified derived summary
- use `replay export` when you already have an artifact and want the read-only dashboard instead of a derived summary
- keep `dashboard` distinct from `replay export`: `dashboard` is live-state only

### Partial coordinator rule

- Front-door docs must say partial coordinator artifacts are valid, readable surfaces.
- `audit` and `report` must keep per-repo export-health visibility (`repo_ok_count` / `repo_error_count`) plus the failed repo row and error when `repos.<repoId>.ok === false`.
- Front-door docs must say failed child repos do **not** get fabricated drill-down sections when the nested child export is unavailable.
- Front-door docs must say partial coordinator artifacts remain valid for `replay export` as well as `report`.

## Error Cases

- CLI docs imply `export`, `audit`, and `report` are interchangeable summary commands
- CLI docs describe `audit` as reading `--input`
- CLI docs describe `report` as reading live repo state directly
- CLI docs describe `export` as if it were already the derived report surface
- Front-door docs imply `dashboard` can open a saved export artifact
- Front-door docs omit `replay export` from the operator choice boundary
- Front-door docs fail to mention that partial coordinator artifacts remain readable without fabricating failed-child drill-down

## Acceptance Tests

- `AT-CLI-EAR-001`: CLI docs describe `export` as the portable raw artifact surface and mention `content_base64` / `verify export`.
- `AT-CLI-EAR-002`: CLI docs describe `audit` as live-state inspection that builds and verifies a fresh artifact before rendering the report contract.
- `AT-CLI-EAR-003`: CLI docs describe `report` as consuming an existing export artifact via `--input <path>` or stdin and verifying that artifact first.
- `AT-CLI-EAR-004`: CLI docs include an explicit operator-facing comparison that tells users when to choose `export` vs `audit` vs `report`.
- `AT-CLI-EAR-005`: Guard tests fail if the CLI front door blurs those three surfaces back into one interchangeable summary path.
- `AT-CLI-EAR-006`: `README.md` and `cli/README.md` keep `audit` live-state, `report` verified-artifact, and `export` portable-artifact boundaries truthful.
- `AT-CLI-EAR-007`: front-door docs state the partial coordinator boundary: export-health counts stay visible, failed repos keep row + error, and failed-child drill-down stays absent.
- `AT-CLI-EAR-008`: front-door docs keep `dashboard` live-state only, `replay export` existing-artifact only, and preserve the same partial coordinator boundary for `replay export`.

## Open Questions

- None. The shipped CLI command boundary is already decided; this spec exists to keep the docs truthful.
