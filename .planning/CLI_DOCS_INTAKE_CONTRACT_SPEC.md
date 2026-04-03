# CLI Intake Docs Contract Spec

> Status: **Shipped**
> Last updated: 2026-04-03 (Turn 8, GPT 5.4)

---

## Purpose

Make the CLI reference truthful about the shipped `agentxchain intake` command family. The dedicated intake page already documents the full artifact and lifecycle contract, but `website-v2/docs/cli.mdx` omitted the command family entirely. That omission made the CLI reference factually incomplete for a real top-level command surface.

## Interface

- Doc source: `website-v2/docs/cli.mdx`
- Supporting deep-dive page: `website-v2/docs/continuous-delivery-intake.mdx`
- CLI registration source: `cli/bin/agentxchain.js`
- Intake engine source: `cli/src/lib/intake.js`
- Guard test: `cli/test/docs-cli-intake-content.test.js`

## Discrepancies Found

1. `agentxchain.js` registers a top-level `intake` command family with eight subcommands, but `cli.mdx` did not mention `intake` in the command map or anywhere else.
2. Operators reading the CLI reference could not discover that continuous governed delivery is a first-class CLI surface.
3. The repo already had a detailed intake page, so the right fix was not another full duplicate page inside `cli.mdx`. The right fix was a concise command-family summary plus a link to the dedicated intake page.

## Behavior

The CLI reference must:

1. Add `intake` to the command map as a continuous-delivery command family.
2. Add a dedicated `### \`intake\`` section with:
   - the command-family shape `agentxchain intake <subcommand> [options]`
   - all eight shipped subcommands: `record`, `triage`, `approve`, `plan`, `start`, `resolve`, `scan`, `status`
   - a concise purpose line for each subcommand
3. Document the real ingestion boundary:
   - `record` supports `manual`, `ci_failure`, `git_ref_change`, `schedule`
   - `scan` supports only `ci_failure`, `git_ref_change`, `schedule`
   - `manual` is excluded from `scan`
4. Document the real governance boundary:
   - `approve` authorizes work but does not start a run
   - `plan` materializes planning artifacts but does not start a run
   - `start` is the explicit governed handoff from `planned` to execution
   - `resolve` reads governed run outcome back into intake state
5. Point readers to `/docs/continuous-delivery-intake` for the full artifact, state-machine, and lifecycle contract instead of duplicating that whole page in the CLI reference.

## Error Cases

- Do not document `intake` as a single command with hidden behavior. The subcommand surface must be explicit.
- Do not imply that `scan` accepts `manual`.
- Do not imply that `approve` or `plan` starts governed execution.
- Do not imply that `start` is automatic or triggered from raw signals.
- Do not duplicate the full intake page inside `cli.mdx`; that would create two detailed sources of truth for the same lifecycle.

## Acceptance Tests

- `AT-CLI-INTAKE-001`: `cli.mdx` command map includes `intake`
- `AT-CLI-INTAKE-002`: `cli.mdx` includes a dedicated `### \`intake\`` section
- `AT-CLI-INTAKE-003`: The section names all eight shipped intake subcommands
- `AT-CLI-INTAKE-004`: The section documents `record` sources from `VALID_SOURCES`
- `AT-CLI-INTAKE-005`: The section documents `scan` sources from `SCAN_SOURCES` and excludes `manual`
- `AT-CLI-INTAKE-006`: The section documents that `approve` and `plan` do not start execution, while `start` is the governed handoff
- `AT-CLI-INTAKE-007`: The section links to `/docs/continuous-delivery-intake`

## Open Questions

None. The scope is intentionally narrow: truthful CLI-reference coverage for an already-shipped command family.
