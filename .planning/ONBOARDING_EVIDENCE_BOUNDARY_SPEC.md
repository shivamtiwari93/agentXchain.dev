# Onboarding Evidence Boundary Spec

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-16

## Purpose

Freeze the evidence-surface contract across the public onboarding docs so new operators do not learn a fake "`report` shows my current run" story.

The deep CLI reference already distinguishes `audit`, `export`, and `report`. The onboarding pages must preserve the same truth in shorter form:

- `audit` is the live current repo/workspace summary
- `export` is the portable artifact
- `report` reads an existing export artifact

## Interface

The onboarding surfaces covered by this spec are:

- `website-v2/docs/quickstart.mdx`
- `website-v2/docs/getting-started.mdx`
- `website-v2/docs/five-minute-tutorial.mdx`
- `website-v2/docs/tutorial.mdx`

Primary guard:

- `cli/test/onboarding-evidence-boundary-content.test.js`

## Behavior

### Shared command boundary

The onboarding docs must teach the same operator choice as the CLI front door:

- use `agentxchain audit` when you want the live current repo/workspace summary
- use `agentxchain export` when you need the portable artifact
- use `agentxchain report --input ...` only when you already have an export artifact

### Shared partial coordinator boundary

The onboarding docs must state that partial coordinator artifacts are still valid evidence surfaces:

- `audit` and `report` keep `repo_ok_count` / `repo_error_count` export-health visibility
- failed child repos keep the repo row plus error
- failed child repos do not get fabricated drill-down sections when the nested child export is unavailable

### Page-specific scope

- `quickstart.mdx` must surface the boundary for both single-repo and coordinator onboarding, because it is the broadest front door.
- `getting-started.mdx` must teach the boundary immediately after the first complete governed run so operators know how to inspect live state versus share an artifact.
- `five-minute-tutorial.mdx` must teach the boundary as a follow-up after the first accepted PM turn, even though the page stops before completion.
- `tutorial.mdx` must show `audit`, `export`, and `report` together in the verification step and must not imply that `report` reads live repo state directly.

## Error Cases

- An onboarding page says or implies that `report` summarizes the current run directly.
- An onboarding page mentions `report` without naming `export` or the artifact boundary.
- An onboarding page teaches `audit` and `report` as interchangeable summary commands.
- An onboarding page omits the partial coordinator boundary and leaves operators to assume failed child repos disappear or gain fabricated detail.

## Acceptance Tests

- `AT-ONBOARD-EVID-001`: `quickstart`, `getting-started`, `five-minute-tutorial`, and `tutorial` all mention `audit` as the live repo/workspace summary surface.
- `AT-ONBOARD-EVID-002`: the same pages teach `report --input` as the export-artifact reader rather than a live-state command.
- `AT-ONBOARD-EVID-003`: the same pages preserve the partial coordinator boundary (`repo_ok_count` / `repo_error_count`, failed repo row + error, no fabricated failed-child drill-down).
- `AT-ONBOARD-EVID-004`: `tutorial.mdx` shows `audit`, `export`, and `report --input` together in the verification step.

## Open Questions

- None. The CLI boundary is already frozen elsewhere; this spec just keeps the onboarding layer truthful.
