## Purpose

Tighten repo-decision visibility across three operator surfaces that currently undersignal significance:

- dashboard `Decisions`
- `agentxchain report`
- `agentxchain export` / `verify export`

The goal is first-glance truth, not a second narrative surface.

## Interface

### Shared summary contract

`summary.repo_decisions` remains the machine-readable export block for cross-run repo decisions. It is extended with:

- enriched active decision entries (authority metadata already present in code and now explicitly documented)
- enriched overridden decision entries
- `operator_summary`

`operator_summary` is a compact derived object:

- `active_categories`
- `highest_active_authority_level`
- `highest_active_authority_role`
- `highest_active_authority_source`
- `superseding_active_count`
- `overridden_with_successor_count`

### Dashboard `Decisions`

- stays a filterable ledger/table
- continues to show repo-local and coordinator turn-decision ledgers
- adds a compact repo-decision summary band when repo-level cross-run decisions exist
- must not add a second table or prose-heavy narrative for repo decisions

### `agentxchain report`

- text, markdown, and html formats continue rendering a `Repo Decisions` section
- the section must render whenever `subject.run.repo_decisions` is non-null, even if there are zero active decisions
- the section adds a compact operator summary ahead of the per-decision rows/tables

## Behavior

### Shared repo-decision summary

The shared repo-decision summary must expose:

- active vs overridden counts
- active category spread
- highest active authority when resolvable
- lineage pressure:
  - how many active decisions supersede earlier decisions
  - how many overridden decisions have a recorded successor

The values must be deterministic and reconstructible from `.agentxchain/repo-decisions.jsonl` plus the current config authority policy.

### Dashboard `Decisions`

When repo-level decisions exist, the view shows a compact summary band above the filter bar:

- active count
- overridden count
- categories
- highest authority
- lineage summary

This summary is additive. The existing decision-ledger tables remain the main surface.

### `agentxchain report`

Repo-decision rendering must stop hiding overridden-only history.

If `subject.run.repo_decisions` is present:

- text format prints the compact summary lines before repo-decision bullets
- markdown prints the compact summary lines before repo-decision tables
- html prints the compact summary before any repo-decision tables

If there are only overridden decisions, the section still renders the summary plus the overridden list/table.

### Export verification

`verify export` must fail when `summary.repo_decisions.operator_summary` drifts from what can be reconstructed from `.agentxchain/repo-decisions.jsonl`.

## Error Cases

- Missing `repo-decisions.jsonl` still yields `summary.repo_decisions: null`.
- Unknown roles must never fabricate authority values; unknown role authority remains `0` with source `unknown_role`.
- Overridden-only repo decision history must not disappear from report surfaces.
- Dashboard summary must degrade cleanly when no repo-level decisions exist.

## Acceptance Tests

1. Repo-decision export summaries include `operator_summary` with categories, highest authority, and lineage counts.
2. `verify export` fails if `summary.repo_decisions.operator_summary` is tampered.
3. Dashboard `Decisions` renders the compact repo-decision summary band when repo-level decisions exist.
4. Dashboard state-reader maps `.agentxchain/repo-decisions.jsonl` to a repo-decision summary API resource.
5. `agentxchain report` text/markdown/html render repo-decision summary lines.
6. `agentxchain report` still renders `Repo Decisions` when all repo decisions are overridden and zero are active.
7. Public docs describe the repo-decision operator-summary contract truthfully.

## Open Questions

- Whether the dashboard should eventually provide a dedicated repo-decision drill-down view is deferred. This slice is summary-only.
- Whether `agentxchain decisions --json` should grow a sibling summary object remains deferred; top-level array compatibility is preserved.
