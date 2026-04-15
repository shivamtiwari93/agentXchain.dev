## Purpose

Tighten two cross-run operator surfaces that still make users infer significance from raw data:

- `agentxchain decisions`
- dashboard `Run History`

Both surfaces must stay compact. Neither is allowed to turn into a second `report`.

## Interface

### `agentxchain decisions`

- Default text mode remains the primary list surface for active repo decisions.
- `--all` continues to include overridden decisions.
- `--json` must remain machine-readable and list-oriented.
- `--show <DEC-NNN>` remains the detailed single-decision drill-down surface.

### Dashboard `Run History`

- The dashboard view continues to read `/api/run-history`.
- The view remains a table surface, not a narrative report.
- Existing `Ctx` and `Headline` columns remain.

## Behavior

### `agentxchain decisions`

Default text mode must surface first-glance binding significance before the row list:

- show how many decisions are currently binding (`active`)
- show whether override churn exists outside the current filtered view
- show category spread for active decisions when available

Default text rows must stay compact but include enough context to avoid drill-down for basic triage:

- decision id
- active/overridden status
- category
- statement
- override lineage when present
- origin role and run id
- authority level when resolvable from config

`--json` output must stay list-shaped. Each decision entry may be enriched with compact derived metadata, but the top-level payload must remain an array for backward compatibility.

### Dashboard `Run History`

The table must align with the documented contract already claimed in `website-v2/docs/cli.mdx`:

- show `Outcome`
- show `Trigger`
- continue showing `Ctx`, `Headline`, status, phases, turns, cost, duration, and date

The view header must expose compact outcome totals so operators can judge the history mix without scanning every row:

- total runs
- completed count
- blocked count
- clean / follow-on / operator outcome counts when non-zero

Rows may include one compact follow-up cue when a next action exists, but this must remain subordinate to the table row, not a prose block.

## Error Cases

- Missing or unreadable repo decisions file still yields an empty list / empty-state message.
- Missing or malformed run history still yields the current empty-state placeholder.
- Unknown role authority must render as absent or unknown, never as a fabricated numeric level.
- Decisions with missing category/role/run metadata must degrade cleanly to `—` instead of breaking table layout.

## Acceptance Tests

1. `agentxchain decisions` text mode shows summary counts for binding and overridden decisions.
2. `agentxchain decisions` text mode surfaces authority when it can be resolved.
3. `agentxchain decisions --json` remains an array payload.
4. Dashboard `Run History` render output includes `Outcome` and `Trigger` columns.
5. Dashboard `Run History` renders outcome summary badges/counts in the header.
6. Dashboard `Run History` shows a compact next-action hint when a row has follow-on/operator work.
7. CLI docs document the `decisions` command and the run-history outcome/trigger contract truthfully.

## Open Questions

- Whether `agentxchain decisions --json` should eventually expose a sibling summary object is deferred. This slice keeps the top-level payload as an array.
- Whether dashboard `Run History` should support interactive filtering by outcome is deferred. This slice is visibility-only.
