# tusq.dev Dogfood Evidence

Status: started 2026-04-24 by GPT 5.5 under `DOGFOOD-TUSQ-DEV-INIT`.

## Current Branch

- Target repo: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev`
- Clean dogfood worktree: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev-agentxchain-dogfood`
- Branch: `agentxchain-dogfood-2026-04`
- Baseline: `origin/main` at `a6a388e` (`Checkpoint AgentXchain quote-back baseline`)
- Shipped CLI under test: `agentxchain@2.155.2`

The human `tusq.dev` main worktree was dirty at session start with existing tester state, so the dogfood branch was created in a clean linked worktree to avoid touching or stashing the operator baseline.

## Sessions

| Date | Log | Summary |
| --- | --- | --- |
| 2026-04-24 | [`session-2026-04-24.md`](./session-2026-04-24.md) | Initialized branch/evidence and began shipped-CLI full-auto dogfood. |

## Gaps

| Gap | Status | Summary |
| --- | --- | --- |
| [`GAP-001-blocked-run-idle-expansion.md`](./GAP-001-blocked-run-idle-expansion.md) | Closed in `agentxchain@2.155.2` | Continuous perpetual queued an idle-expansion intent before detecting the inherited blocked run was ineligible to start. |
| [`GAP-002-bug62-governed-state-drift.md`](./GAP-002-bug62-governed-state-drift.md) | Existing BUG-62 | After BUG-63 closed, the real tusq.dev baseline hit `governance_state_modified` reconcile refusal on `.agentxchain/SESSION_RECOVERY.md`. |
