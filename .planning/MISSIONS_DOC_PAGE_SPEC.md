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
- `agentxchain mission start --plan`
- `agentxchain mission list`
- `agentxchain mission show`
- `agentxchain mission attach-chain`
- `agentxchain mission plan`
- `agentxchain mission plan show`
- `agentxchain mission plan list`
- `agentxchain mission plan approve`
- `agentxchain mission plan launch`
- `agentxchain run --chain --mission <mission_id|latest>`
- dashboard `Mission` view backed by `GET /api/missions`
- dashboard plan visibility backed by `GET /api/plans`

## Behavior

### 1. Explain the real hierarchy

The page must state clearly that mission is the repo-local long-horizon grouping layer above chained runs and is intentionally separate from coordinator initiative.

### 2. Show the primary operator flow

The page must make both real operator paths explicit:

1. **Direct chained execution**
   - start a mission
   - run a chained sequence with `--mission latest` or an explicit mission ID
   - inspect the result through `mission show` or the dashboard `Mission` view

2. **Decomposed planning flow**
   - create the mission and first proposed plan in one command with `mission start --plan`, or generate a plan later with `mission plan`
   - review and approve the latest plan
   - launch one approved workstream at a time, retry failed workstreams explicitly, or batch-launch all currently ready workstreams
   - inspect workstream launch state and chain linkage in the dashboard Mission view
   - use `mission show` as the terminal summary for latest plan status, completion percentage, and workstream counts

Manual `mission attach-chain` should be documented as a fallback path for chains that were not mission-bound at run start, not as the primary workflow.

### 3. Document real artifact and API surfaces

The page must reference the actual mission artifacts and derived dashboard/API surfaces:

- `.agentxchain/missions/<mission_id>.json`
- `.agentxchain/missions/plans/<mission_id>/<plan_id>.json`
- `.agentxchain/reports/chain-<id>.json`
- `GET /api/missions`
- `GET /api/plans`

The page must also document the real offline planning input path:

- `--planner-output-file <path>` on `mission start --plan` and `mission plan`

### 4. Document derived status truthfully

The page must explain the shipped derived mission states:

- `planned`
- `progressing`
- `needs_attention`
- `degraded`

It must describe the evidence behind them rather than inventing lifecycle verbs that the implementation does not expose.

The page should also explain the shipped mission-plan and workstream execution states instead of hand-waving them:

- plan states such as `proposed`, `approved`, `superseded`, `needs_attention`, and `completed`
- workstream launch states `ready`, `blocked`, `launched`, `completed`, and `needs_attention`

### 5. Document decomposition execution truthfully

The page must say plainly that `mission plan launch` is a one-command execution surface:

- it records `workstream_id -> chain_id` launch linkage
- it executes the workstream immediately through the existing governed run/chaining path
- `--auto-approve` passes through to the launched governed run
- `--retry` is the explicit repair path for `needs_attention` workstreams
- successful execution marks the workstream `completed`
- all-completed plans auto-transition to `completed`
- failed or blocked execution marks the workstream and plan `needs_attention`

### 6. Document failure behavior

The page must distinguish:

- explicit mission ID binding fails closed when the mission does not exist
- `--mission latest` warns and continues when no missions exist
- `mission plan launch` fails closed for unapproved plans, missing workstream IDs, and unsatisfied dependencies
- missing referenced chain reports degrade the mission view instead of crashing it

## Error Cases

| Condition | Required docs behavior |
|---|---|
| Operator confuses mission with initiative | State the repo-local vs multi-repo boundary explicitly. |
| Operator thinks `mission attach-chain` is required every time | Make `run --chain --mission ...` the preferred flow and label manual attach as fallback. |
| Operator thinks mission planning only writes bookkeeping | State that `mission plan launch` executes immediately through the governed run path and records real `chain_id` linkage. |
| Operator wants deterministic or offline planning input | Document `--planner-output-file <path>` instead of implying planner calls are the only supported path. |
| Operator looks for plan artifacts or dashboard data | Document `.agentxchain/missions/plans/<mission_id>/<plan_id>.json` and `GET /api/plans`. |
| Operator passes a missing explicit mission ID | Document that the chain aborts fail-closed. |
| Operator uses `--mission latest` before creating any missions | Document the warning-only bootstrap behavior. |
| Operator launches a blocked or unapproved workstream | Document the fail-closed dependency/approval boundary. |
| Attached chain report goes missing | Document degraded mission visibility instead of silent omission. |

## Acceptance Tests

1. `/docs/missions` exists as a Docusaurus docs route sourced from `website-v2/docs/missions.mdx`.
2. The docs sidebar includes `missions` under the Continuous Delivery section.
3. The page documents all shipped mission commands, including the decomposition flow, and the preferred `run --chain --mission` operator flow.
4. The page keeps mission explicitly separate from coordinator initiative.
5. The page documents `.agentxchain/missions/<mission_id>.json`, mission-plan artifacts, chain reports, `GET /api/missions`, and `GET /api/plans`.
6. The page documents `mission plan launch` as immediate execution with real `workstream_id -> chain_id` linkage and launch/workstream state visibility.
7. `llms.txt` includes the missions page.
8. The page documents `mission start --plan` and `--planner-output-file <path>` as shipped planning-entry surfaces.
9. The page documents explicit retry, plan auto-completion, and `mission show` latest-plan summary truthfully.

## Open Questions

1. Should a future `/docs/missions` follow-up include a full end-to-end worked example showing multiple launched workstreams across one mission?
