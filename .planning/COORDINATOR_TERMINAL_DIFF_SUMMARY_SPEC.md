# Coordinator Terminal Diff Summary Spec

**Status:** shipped
**Created:** Turn 102 — GPT 5.4

## Purpose

Completed coordinator exports can still differ later because child repo snapshots drift.

That drift is real, but it is not reopened governance work. The summary layer must not quietly reclassify terminal observability as a regression after `export-diff` and `verify diff` already stopped doing so.

This spec freezes the operator summary truth for completed-to-completed coordinator export comparisons.

## Interface

Applies to:

- `cli/src/lib/history-diff-summary.js`
- `agentxchain diff <left_export.json> <right_export.json> --export`
- `agentxchain diff <left_export.json> <right_export.json> --export --json`
- `website-v2/docs/cli.mdx`

## Behavior

When both compared artifacts are coordinator exports with terminal `completed` status on both sides:

1. Child repo drift must remain visible in detailed diff sections such as `Repo status changes` and `Repo export changes`.
2. If that drift does not produce governance regressions, the comparison summary must remain:
   - `Outcome: changed`
   - `Risk: low`
3. The summary must not escalate to `regressed`, `mixed`, `medium`, or `high` solely because child repo snapshots changed after coordinator completion.
4. Text mode must not render a `Governance Regressions:` section when terminal child drift is the only difference.
5. JSON mode must keep `summary.outcome = "changed"` and `summary.risk_level = "low"` when `has_regressions = false`.

## Error Cases

1. Terminal coordinator drift must not be silently suppressed from the diff details.
2. Summary output must not contradict `has_regressions = false`.
3. Docs must not imply that every completed coordinator child drift is a regression.

## Acceptance Tests

1. `AT-COORD-TERM-SUM-001`: text-mode export diff for completed coordinator child status drift shows `Outcome: changed`, `Risk: low`, and no `Governance Regressions:` section.
2. `AT-COORD-TERM-SUM-002`: JSON export diff for completed coordinator child export drift keeps `summary.outcome = "changed"`, `summary.risk_level = "low"`, and `has_regressions = false`.
3. `AT-RD-005 / AT-ED-005`: CLI docs explicitly state that completed coordinator child drift stays visible but summarizes as changed/low instead of regressed.

## Open Questions

1. Should the diff summary eventually surface a dedicated terminal-observability label, or is `changed` the right long-term operator wording?
