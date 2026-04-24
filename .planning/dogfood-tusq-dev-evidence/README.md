# tusq.dev Dogfood Evidence

Status: started 2026-04-24 by GPT 5.5 under `DOGFOOD-TUSQ-DEV-INIT`.

## Current Branch

- Target repo: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev`
- Clean dogfood worktree: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev-agentxchain-dogfood`
- Branch: `agentxchain-dogfood-2026-04`
- Baseline: `origin/main` at `a6a388e` (`Checkpoint AgentXchain quote-back baseline`)
- Shipped CLI under test: `agentxchain@2.155.10`

The human `tusq.dev` main worktree was dirty at session start with existing tester state, so the dogfood branch was created in a clean linked worktree to avoid touching or stashing the operator baseline.

## Sessions

| Date | Log | Summary |
| --- | --- | --- |
| 2026-04-24 | [`session-2026-04-24.md`](./session-2026-04-24.md) | Initialized branch/evidence, shipped GAP-001 through GAP-007 fixes, and completed three full governed tusq.dev dogfood runs on `agentxchain@2.155.10`. |

## Gaps

| Gap | Status | Summary |
| --- | --- | --- |
| [`GAP-001-blocked-run-idle-expansion.md`](./GAP-001-blocked-run-idle-expansion.md) | Closed in `agentxchain@2.155.2` | Continuous perpetual queued an idle-expansion intent before detecting the inherited blocked run was ineligible to start. |
| [`GAP-002-bug62-governed-state-drift.md`](./GAP-002-bug62-governed-state-drift.md) | Fixed in `agentxchain@2.155.3` | After BUG-63 closed, the real tusq.dev baseline hit `governance_state_modified` reconcile refusal on `.agentxchain/SESSION_RECOVERY.md`. Fixed by reconcile-safe-paths allowlist. |
| [`GAP-003-bug64-idle-expansion-sidecar.md`](./GAP-003-bug64-idle-expansion-sidecar.md) | Closed in `agentxchain@2.155.6` | PM idle-expansion produced `idle-expansion-result.json`, but acceptance initially required top-level `turnResult.idle_expansion_result`; follow-up shipped fixes also covered false/null `vision_exhausted` sentinels and branch-aware idle-expansion intent coverage. |
| [`GAP-004-idle-expansion-charter-missing-output-format.md`](./GAP-004-idle-expansion-charter-missing-output-format.md) | Closed in `agentxchain@2.155.7` | Idle-expansion charter named the result concept but did not specify exact output location, JSON shape, or example. |
| [`GAP-005-charter-validator-schema-mismatch.md`](./GAP-005-charter-validator-schema-mismatch.md) | Closed in `agentxchain@2.155.8` | Charter specified object-shaped traceability and flat intent fields while the validator expected array traceability and nested `new_intake_intent`. |
| GAP-006 | Closed in `agentxchain@2.155.9` | Intent coverage handled branch-specific idle-expansion criteria but missed the top-level structured-result acceptance item. |
| [`GAP-007-embedded-idle-expansion-normalization-bypass.md`](./GAP-007-embedded-idle-expansion-normalization-bypass.md) | Closed in `agentxchain@2.155.10` | Embedded `idle_expansion_result` bypassed sidecar normalization, so legacy charter-shaped results failed schema validation. |

## Completed Runs

| Date | Run | CLI Version | Phases | Outcome |
| --- | --- | --- | --- | --- |
| 2026-04-24 | `run_71b762f4405c0fc5` | `agentxchain@2.155.3` | planning → implementation → QA → launch | COMPLETED — M28 Sensitivity Class Inference proposed via idle expansion. Dev turn executed by Claude Sonnet 4.6, QA and launch gates approved. First governed run completion on tusq.dev dogfood. |
| 2026-04-24 | `run_ce89ef5bd4b8cca8` | `agentxchain@2.155.6` | idle expansion | ACCEPTED THEN BLOCKED FOR HUMAN/LEGAL — shipped acceptor accepted `turn_e614e7a53ef67b3a`, emitted `intent_satisfied` + `turn_accepted`, and recorded `idle_expansion_result_summary`; new blocker is M28 human/legal triage, not BUG-64 validation. |
| 2026-04-24 | `run_e7c2e5668d6cfb6a` | `agentxchain@2.155.10` | planning → implementation → QA → launch | COMPLETED — first final-package full governed dogfood run after embedded idle-expansion normalization fix. |
| 2026-04-24 | `run_4e38dc0248fb17e6` | `agentxchain@2.155.10` | planning → implementation → QA → launch | COMPLETED — perpetual idle-expansion dispatched and accepted a next PM intent, then the run completed all phases. |
| 2026-04-24 | `run_6464f8d17e8dedcd` | `agentxchain@2.155.10` | planning → implementation → QA → launch | COMPLETED — third full governed dogfood run; DOGFOOD-TUSQ-DEV success criteria met. |
