# Missions Documentation Page Spec

> Public operator guide for the single-repo mission hierarchy above chained runs.

---

## Purpose

Expose a dedicated `/docs/missions` page so operators can understand the mission layer as a first-class product surface instead of piecing it together from CLI reference rows, chain-binding flags, dashboard descriptions, and release notes.

The page must keep the noun boundary explicit:

- **Mission** = single-repo hierarchy above chained runs
- **Initiative** = multi-repo coordinator hierarchy

## Interface

### Route

```text
/docs/missions
```

### Files

```text
website-v2/docs/missions.mdx
website-v2/sidebars.ts
website-v2/static/llms.txt
```

### Supporting product surfaces

- `agentxchain mission start`
- `agentxchain mission list`
- `agentxchain mission show`
- `agentxchain mission attach-chain`
- `agentxchain run --chain --mission <mission_id|latest>`
- dashboard `Mission` view backed by `GET /api/missions`

## Behavior

### 1. Explain the real hierarchy

The page must state clearly that mission is the repo-local long-horizon grouping layer above chained runs and is intentionally separate from coordinator initiative.

### 2. Show the primary operator flow

The page must make the preferred flow explicit:

1. start a mission
2. run a chained sequence with `--mission latest` or an explicit mission ID
3. inspect the result through `mission show` or the dashboard `Mission` view

Manual `mission attach-chain` should be documented as a fallback path for chains that were not mission-bound at run start, not as the primary workflow.

### 3. Document real artifact and API surfaces

The page must reference the actual mission artifacts and derived dashboard/API surfaces:

- `.agentxchain/missions/<mission_id>.json`
- `.agentxchain/reports/chain-<id>.json`
- `GET /api/missions`

### 4. Document derived status truthfully

The page must explain the shipped derived mission states:

- `planned`
- `progressing`
- `needs_attention`
- `degraded`

It must describe the evidence behind them rather than inventing lifecycle verbs that the implementation does not expose.

### 5. Document failure behavior

The page must distinguish:

- explicit mission ID binding fails closed when the mission does not exist
- `--mission latest` warns and continues when no missions exist
- missing referenced chain reports degrade the mission view instead of crashing it

## Error Cases

| Condition | Required docs behavior |
|---|---|
| Operator confuses mission with initiative | State the repo-local vs multi-repo boundary explicitly. |
| Operator thinks `mission attach-chain` is required every time | Make `run --chain --mission ...` the preferred flow and label manual attach as fallback. |
| Operator passes a missing explicit mission ID | Document that the chain aborts fail-closed. |
| Operator uses `--mission latest` before creating any missions | Document the warning-only bootstrap behavior. |
| Attached chain report goes missing | Document degraded mission visibility instead of silent omission. |

## Acceptance Tests

1. `/docs/missions` exists as a Docusaurus docs route sourced from `website-v2/docs/missions.mdx`.
2. The docs sidebar includes `missions` under the Continuous Delivery section.
3. The page documents all shipped mission commands and the preferred `run --chain --mission` operator flow.
4. The page keeps mission explicitly separate from coordinator initiative.
5. The page documents `.agentxchain/missions/<mission_id>.json`, chain reports, and `GET /api/missions`.
6. `llms.txt` includes the missions page.

## Open Questions

1. Should a future `/docs/missions` follow-up include worked examples for cross-run mission decomposition once that feature ships?
