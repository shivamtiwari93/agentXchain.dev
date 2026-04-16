# Coordinator Audit Terminal Drift Spec

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-15

## Purpose

Freeze the `agentxchain audit` contract for completed coordinator workspaces that still show child repo run-id drift.

The shared report builder already renders terminal child drift correctly, but `audit` had only weak proof: it checked that `next_actions` was empty. That was not enough. A later change could drop the explicit terminal note while still keeping `next_actions: []`, which would reintroduce the same ambiguity already removed from `report`, `diff`, and `verify diff`.

## Interface

Applies to:

```bash
agentxchain audit [--format text|json|markdown|html]
```

Affected fields and rendered output for coordinator workspaces:

- `subject.run.run_id_mismatches`
- `subject.run.terminal_observability_note`
- `subject.run.next_actions`
- text/markdown rendered `Terminal drift note: ...` line
- HTML rendered `Terminal drift note` metadata row

## Behavior

When all of the following are true:

- `subject.kind = "coordinator_workspace"`
- `subject.run.status = "completed"`
- child repo `run_id` no longer matches the coordinator's recorded `repo_runs[*].run_id`

Then `audit` must:

- keep `subject.run.run_id_mismatches` visible for audit
- populate `subject.run.terminal_observability_note`
- keep `subject.run.next_actions = []`
- render the same terminal drift note in text and markdown output
- render the same terminal drift note in HTML output
- omit `Next Actions:` from text and markdown output
- omit the `Next Actions` section from HTML output

This is observability-only terminal drift. It must not imply the completed coordinator has recovery work left to do.

## Error Cases

- Completed coordinator drift renders `run_id_mismatches` but omits `terminal_observability_note`
- Completed coordinator drift renders the note but still prints `Next Actions:`
- Completed coordinator drift renders the note in HTML metadata but still includes an HTML `Next Actions` section
- `audit` docs only describe blocked recovery flows and fail to mention terminal completed-drift behavior

## Acceptance Tests

- `AT-AUDIT-009`: completed coordinator audit keeps child drift visible, sets `terminal_observability_note`, and keeps `next_actions` empty.
- `AT-AUDIT-011`: text and markdown audit output render `Terminal drift note: ...` and omit `Next Actions:`.
- `AT-AUDIT-010`: HTML audit output renders `Terminal drift note` and omits the `Next Actions` section for a completed coordinator with child run-id drift.
- `governance audit docs contract`: CLI docs and Governance Audit Reference both document terminal completed coordinator drift as observability-only.

## Open Questions

- Whether a later slice should expose a broader terminal observability note for completed coordinator child status/export drift beyond run-id mismatch, or keep this scoped to the already-shipped run-identity contract.
