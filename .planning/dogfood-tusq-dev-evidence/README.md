# tusq.dev Dogfood Evidence

Status: started 2026-04-24 by GPT 5.5 under `DOGFOOD-TUSQ-DEV-INIT`.

## Current Branch

- Target repo: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev`
- Clean dogfood worktree: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev-agentxchain-dogfood`
- Branch: `agentxchain-dogfood-2026-04`
- Baseline: `origin/main` at `a6a388e` (`Checkpoint AgentXchain quote-back baseline`)
- Shipped CLI under test: `agentxchain@2.155.6`

The human `tusq.dev` main worktree was dirty at session start with existing tester state, so the dogfood branch was created in a clean linked worktree to avoid touching or stashing the operator baseline.

## Sessions

| Date | Log | Summary |
| --- | --- | --- |
| 2026-04-24 | [`session-2026-04-24.md`](./session-2026-04-24.md) | Initialized branch/evidence and began shipped-CLI full-auto dogfood. |

## Gaps

| Gap | Status | Summary |
| --- | --- | --- |
| [`GAP-001-blocked-run-idle-expansion.md`](./GAP-001-blocked-run-idle-expansion.md) | Closed in `agentxchain@2.155.2` | Continuous perpetual queued an idle-expansion intent before detecting the inherited blocked run was ineligible to start. |
| [`GAP-002-bug62-governed-state-drift.md`](./GAP-002-bug62-governed-state-drift.md) | Fixed in `agentxchain@2.155.3` | After BUG-63 closed, the real tusq.dev baseline hit `governance_state_modified` reconcile refusal on `.agentxchain/SESSION_RECOVERY.md`. Fixed by reconcile-safe-paths allowlist. |
| [`GAP-003-bug64-idle-expansion-sidecar.md`](./GAP-003-bug64-idle-expansion-sidecar.md) | Closed in `agentxchain@2.155.6` | PM idle-expansion produced `idle-expansion-result.json`, but acceptance initially required top-level `turnResult.idle_expansion_result`; follow-up shipped fixes also covered false/null `vision_exhausted` sentinels and branch-aware idle-expansion intent coverage. |

## Completed Runs

| Date | Run | CLI Version | Phases | Outcome |
| --- | --- | --- | --- | --- |
| 2026-04-24 | `run_71b762f4405c0fc5` | `agentxchain@2.155.3` | planning → implementation → QA → launch | COMPLETED — M28 Sensitivity Class Inference proposed via idle expansion. Dev turn executed by Claude Sonnet 4.6, QA and launch gates approved. First governed run completion on tusq.dev dogfood. |
| 2026-04-24 | `run_ce89ef5bd4b8cca8` | `agentxchain@2.155.6` | idle expansion | ACCEPTED THEN BLOCKED FOR HUMAN/LEGAL — shipped acceptor accepted `turn_e614e7a53ef67b3a`, emitted `intent_satisfied` + `turn_accepted`, and recorded `idle_expansion_result_summary`; new blocker is M28 human/legal triage, not BUG-64 validation. |
