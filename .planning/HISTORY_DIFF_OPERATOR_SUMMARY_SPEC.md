# History + Diff Operator Summary Spec

**Status:** shipped
**Created:** Turn 60 — GPT 5.4

## Purpose

`agentxchain history` and `agentxchain diff` already expose raw cross-run facts, but they still make operators do too much interpretation in their heads.

That is weak tooling.

- `history` should remain a list surface, but each row must make the run's outcome obvious without forcing operators to open a report.
- `diff` should remain a comparison surface, but it must classify whether the right-hand run/export improved, regressed, or merely changed instead of dumping field deltas with no verdict.

This slice adds summary-level meaning without turning either command into a second `report`.

## Interface

### `agentxchain history`

Text mode keeps the table, but adds two new operator-facing behaviors:

1. an `Outcome` column with a compact derived label:
   - `clean`
   - `follow-on`
   - `operator`
   - `blocked`
   - `unknown`
2. a single indented `next:` line below a row when the run recorded a follow-on hint or next operator action

`--json` remains an array of run-history entries, but each emitted element also includes:

```json
{
  "inheritable": true,
  "outcome_summary": {
    "label": "follow-on",
    "status": "completed",
    "next_action": "agentxchain run --continue-from run_123 --inherit-context"
  }
}
```

### `agentxchain diff`

Text mode prints a `Comparison Summary` section before detailed field deltas:

- `Outcome`: `unchanged | improved | changed | regressed | mixed`
- `Risk`: `none | low | medium | high`
- up to three prioritized `Highlights`

`--json` includes the same summary as a top-level `summary` object for both run-history diffs and export diffs.

## Behavior

### History outcome derivation

- `blocked` + recorded next operator action => `operator`
- `blocked` without a next action => `blocked`
- `completed` + recorded follow-on hint or next action => `follow-on`
- `completed` without follow-on action => `clean`
- anything else => `unknown`

The optional `next:` line must be trimmed to a readable single line and must not print when no action exists.

### Diff summary derivation

The summary is a significance layer over the existing detailed diff. It must not suppress field-level sections.

Run-history diffs:

- treat terminal status downgrades, newly blocked states, new blocked reasons, and gate regressions as regression signals
- treat blocked/failed -> completed and gate recovery as improvement signals
- treat action changes, phase/role set changes, and numeric deltas as change signals
- derive the verdict from the strongest signal class present

Export diffs:

- if `has_regressions=true`, the verdict must not claim `improved`
- `error` regressions => `high` risk
- warning-only regressions => `medium` risk
- changed-without-regressions => `low` risk
- unchanged => `none`

Highlights must prioritize:

1. status / regression signals
2. operator-action changes
3. major phase/gate/repo-state changes
4. lower-priority numeric drift

## Error Cases

1. Commands with no differences still print a summary with `Outcome: unchanged` and `Risk: none`
2. Missing next-action metadata must not produce placeholder junk like `next: —`
3. Multi-line follow-on hints must be normalized to one line before terminal rendering
4. Diff summaries must never contradict export regression truth (`has_regressions`)

## Acceptance Tests

- `AT-HDOS-001`: `agentxchain history` text output shows the derived `Outcome` column
- `AT-HDOS-002`: `agentxchain history` prints an indented `next:` line when a run recorded a follow-on hint or next operator action
- `AT-HDOS-003`: `agentxchain history --json` includes `outcome_summary`
- `AT-HDOS-004`: `agentxchain diff` text output shows `Comparison Summary` with outcome, risk, and highlights for a regressed run comparison
- `AT-HDOS-005`: `agentxchain diff --json` includes `summary.outcome`, `summary.risk_level`, and `summary.highlights`
- `AT-HDOS-006`: `agentxchain diff --export` summary reflects governance regressions instead of claiming a neutral improvement
- `AT-HDOS-007`: `website-v2/docs/cli.mdx` documents the new history outcome digest and diff comparison summary truthfully

## Open Questions

1. Should a later slice add `--only-highlights` for terse automation output?
2. Should dashboard run-history rows reuse the exact same outcome labels?
