# Governance Report Delegation Summary Spec

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-14

## Purpose

Expose delegation chains directly in `agentxchain report` so the CLI audit surface matches the delegation-aware dashboard and export surfaces.

Without this slice, delegation data exists in accepted history and export JSON, but the operator-facing report still reads like a flat run. That is the wrong audit boundary for a governed system that now supports delegation chains.

## Interface

No new CLI flags.

Existing command:

```bash
agentxchain report [--input <path>|-] [--format text|json|markdown]
```

Additive governed-run report field:

- `subject.run.delegation_summary`

Additive human-readable sections when delegation data exists:

- `Delegation Summary:` in `text`
- `## Delegation Summary` in `markdown`

## Behavior

### JSON

- Governed-run reports include `subject.run.delegation_summary`.
- Prefer the verified export artifact's `summary.delegation_summary` when it is well-formed.
- If the export artifact predates `summary.delegation_summary` or the field is malformed, derive the same summary from `.agentxchain/history.jsonl`.
- Preserve the export contract:
  - `null` when history is unavailable
  - object with `total_delegations_issued` and `delegation_chains` otherwise

### Text and markdown

- Omit delegation sections when there are zero delegation chains.
- When delegation chains exist, render:
  - total delegations issued
  - one row/item per parent delegation chain
  - parent role and parent turn id
  - chain outcome
  - review turn id when present
  - individual delegation entries with `delegation_id`, `to_role`, `status`, `charter`, and `child_turn_id`

### Backward compatibility

- Older export artifacts that verify cleanly must still render delegation summaries when delegation metadata exists in accepted history.
- Missing delegation data must not cause report failure.

## Error Cases

- Export contains malformed `summary.delegation_summary` data
- Export omits `summary.delegation_summary` because it predates the field
- History exists but contains no delegation metadata
- History is unavailable entirely

## Acceptance Tests

- `AT-REPORT-DEL-001`: JSON governed-run report includes `subject.run.delegation_summary` with chain outcome and child/review turn correlation.
- `AT-REPORT-DEL-002`: text and markdown report formats render a delegation summary section when delegation chains exist.
- `AT-REPORT-DEL-003`: report omits delegation sections when there are no delegation chains.
- `AT-REPORT-DEL-004`: docs surface truthfully documents `subject.run.delegation_summary` and the human-readable delegation summary sections.

## Open Questions

- Whether a later slice should include per-delegation review summaries in the export/report summary instead of only status/outcome.
- Whether coordinator reports should eventually aggregate child-repo delegation chains at the coordinator layer.
