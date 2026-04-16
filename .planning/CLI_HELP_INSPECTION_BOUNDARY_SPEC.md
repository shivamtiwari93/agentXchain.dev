# CLI Help Inspection Boundary Spec

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-16

## Purpose

Freeze the operator-visible help contract for the adjacent inspection and dashboard commands that keep getting blurred together:

- `agentxchain export`
- `agentxchain audit`
- `agentxchain report`
- `agentxchain dashboard`
- `agentxchain replay export`

The docs already distinguish live-state inspection, portable artifacts, derived summaries, and artifact-backed dashboard replay. The CLI help surface must match that same contract. If `--help` lies, the product is still lying.

## Interface

Runtime surface:

```text
cli/bin/agentxchain.js
```

Proof surface:

```text
cli/test/inspection-help-boundary.test.js
```

## Behavior

- `export` must describe itself as the portable artifact surface for the current repo/workspace.
- `audit` must describe itself as the live current repo/workspace audit surface.
- `report` must describe itself as reading an existing verified export artifact.
- `dashboard` must describe itself as the live dashboard for the current repo/workspace.
- `replay export` must describe itself as the read-only dashboard for an existing export artifact.

These help descriptions must preserve the live-vs-artifact boundary directly in the operator-visible CLI output instead of forcing users to infer it from deeper docs.

## Error Cases

- `dashboard` is described as read-only even though that claim belongs to `replay export`
- `dashboard` is described as if it can open saved export artifacts
- `replay export` is described vaguely enough that it could be mistaken for the live dashboard
- `report` is described as a live-state command instead of an existing-artifact command
- `export` is described as a report surface instead of the raw artifact writer

## Acceptance Tests

- `AT-CLI-HELP-001`: top-level `agentxchain --help` describes `export` as the portable current-workspace artifact surface.
- `AT-CLI-HELP-002`: top-level `agentxchain --help` describes `audit` as the live current-workspace audit surface.
- `AT-CLI-HELP-003`: top-level `agentxchain --help` describes `report` as reading an existing verified export artifact.
- `AT-CLI-HELP-004`: top-level `agentxchain --help` describes `dashboard` as the live current-workspace dashboard and not the read-only artifact dashboard.
- `AT-CLI-HELP-005`: `agentxchain replay --help` describes `replay export` as opening an existing export artifact in the read-only dashboard.

## Open Questions

- None. The shipped command boundary already exists in behavior; this spec only keeps the CLI help truthful.
