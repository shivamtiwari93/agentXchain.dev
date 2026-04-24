# Decisions — AgentXchain

Canonical decision ledger for durable repo-operating decisions. Older decisions still exist inline in `.planning/AGENT-TALK.md`; new or updated durable decisions should be added here when they affect release, CI/CD, governance, or protocol contracts.

## DEC-RELEASE-CUT-AND-PUSH-AS-ATOMIC-001

**Status:** Active, updated 2026-04-21 by CICD-SHRINK.

**Decision:** A release-cut turn is not complete until the version bump, release-surface alignment, commit, tag, push, publish workflow observation, downstream verification, and collaboration log are all handled in the same execution chain.

**Precondition added by CICD-SHRINK:** Before creating any release tag, the release-cut turn MUST run:

```bash
bash cli/scripts/prepublish-gate.sh <target-version>
```

The turn's Evidence block MUST include the gate's exact `PREPUBLISH GATE PASSED for <version>` line. If the gate fails, agents must not create the tag, push the tag, or trigger the publish workflow. The local gate replaces the per-commit CI coverage removed by restricting `ci.yml` to pull-request events.

**Why:** The v2.149.x release incident showed that push-to-main CI density can saturate GitHub Free concurrent slots and block the OIDC publish path for hours. Release safety now depends on a local, explicit, logged gate before tag creation.

## DEC-GITHUB-ACTIONS-FOOTPRINT-FLOOR-001

**Status:** Active as of 2026-04-21.

**Decision:** AgentXchain.dev's steady-state GitHub Actions footprint is intentionally small:

- `publish-npm-on-tag.yml` on `v*.*.*` tags and manual dispatch, because npm trusted publishing requires GitHub Actions OIDC.
- `deploy-gcs.yml` on `website-v2/**`, `docs/**`, or deploy-workflow changes, because production website deploy credentials live in GitHub Actions.
- `governed-todo-app-proof.yml` on nightly schedule and manual dispatch, because the public example proof is useful but too expensive for every push and npm release tags must trigger exactly one workflow.
- `publish-vscode-on-tag.yml` on `vsce-v*.*.*` tags and manual dispatch, because VS Code Marketplace publish is a separate release channel.
- `codeql.yml` on weekly schedule and manual dispatch. GitHub CodeQL default setup must stay disabled because it creates hidden push-triggered `dynamic` runs even when its schedule is weekly.

All other test/proof work is local-first through `cli/scripts/prepublish-gate.sh`.

Adding a workflow that fires on every push to `main` requires explicit human approval through `.planning/HUMAN-ROADMAP.md` and a written justification that the failure mode cannot be covered by the local prepublish gate.

**Why:** Push-to-main workflows created 19 zombie CI runs during the v2.149.x cycle, saturating the 20-slot GitHub Free account limit and stalling release publication. The repo should spend remote workflow capacity only on work that cannot be done locally or that is intentionally low-frequency.

## DEC-BUG59-APPROVAL-POLICY-GATE-COUPLING-001

**Status:** Active as of 2026-04-21.

**Decision:** BUG-59 full-auto gate closure is implemented as a layered governed-state contract, not by moving policy into the pure gate evaluator.

- `approval_policy` is the autonomy surface for routine gate closure; no top-level `full_auto` protocol mode is added.
- Gate definitions may set `credentialed: true | false`. `credentialed: true` is a hard stop: no policy rule, including catch-all `auto_approve`, can close the gate.
- Generated governed configs use explicit policy rules with `credentialed_gate: false` guards and `phase_transitions.default: "require_human"`, rather than broad default auto-approval.
- Policy coupling lives in governed-state paths that have state, ledger, and event context: the accepted-turn drain path and `reconcilePhaseAdvanceBeforeDispatch()`.
- `gate-evaluator.js` remains a pure structural/evidence evaluator. It still returns `awaiting_human_approval` for gates whose structural predicates pass but whose gate definition requires human approval.
- `attemptTimeoutPhaseSkip()` is excluded from BUG-59. Timeout is not positive gate evidence and must fail closed until a separate timeout-escalation policy exists.
- QA ship gates intended for routine auto-approval require both `requires_human_approval: true` and `requires_verification_pass: true`; acceptance-matrix semantics supply the "all ACs pass" proof, while turn verification supplies smoke/test evidence.

**Why:** Research showed the roadmap's original locator (`gate-evaluator.js` human-approval branch) was historically useful but incomplete. The accepted-turn path already consulted approval policy, while generated configs lacked safe defaults and reconcile could still pause on policy-closable gates. This decision ties together `DEC-BUG59-CREDENTIALED-GATE-HARD-STOP-001`, `DEC-BUG59-SCHEMA-NEGATIVE-GUARD-001`, and `DEC-BUG59-RECONCILE-POLICY-COUPLING-001` into the durable integration contract.

**Cross-reference (added 2026-04-24):** BUG-60 perpetual continuous mode depends on this decision. PM-synthesized increments that run through the full phase chain hit qa_ship_verdict and launch_ready gates; BUG-59's gate-closure coupling ensures those gates close correctly under full-auto approval policy. See `DEC-BUG60-IDLE-POLICY-ARCHITECTURE-001`.

## DEC-BUG59-CLOSURE-GATE-TESTER-QUOTEBACK-001

**Status:** Satisfied as of 2026-04-24. BUG-59 is checked in HUMAN-ROADMAP, shipped in `agentxchain@2.151.0`. BUG-60 implementation unblocked — Slice 1 committed at `ef9c4d32`.

**Original decision (preserved for audit):** BUG-59 is shipped and agent-verified in `agentxchain@2.151.0`, but it is not closed for BUG-60 implementation sequencing until the real tester quotes evidence from their own `tusq.dev` dogfood run.

**Gate satisfaction basis:** BUG-59 is independently checked in HUMAN-ROADMAP with `✅ Shipped 2026-04-21 in agentxchain@2.151.0`. The current-focus line says downstream validation is "now past BUG-52, BUG-59, and BUG-61." The tester's post-closure evidence (2026-04-21) confirmed BUG-59's scope shipped correctly — the broader defect was BUG-52 third variant, not BUG-59. V2's pending quote-back is BUG-54's closure evidence, not BUG-59's. All five BUG-60 implementation prerequisites are satisfied: BUG-59 shipped, BUG-52 closed on `agentxchain@2.154.11`, research (Turn 259), review (Turn 260), plan agreed (Turn 269).

**Why (original):** The product claim is "full-auto works on the tester's real project," not merely "the packaged regression test passes." Prior beta false closures came from proving synthetic paths while the dogfood path still failed. This decision froze the closure bar so agents stopped toggling between release-complete and tester-complete language.

## DEC-BUG59-TESTER-QUOTEBACK-RUNBOOK-001

**Status:** Active as of 2026-04-21.

**Decision:** `.planning/BUG_59_54_TESTER_QUOTEBACK_RUNBOOK.md` is the canonical tester checklist for the BUG-59 and BUG-54 quote-back. The unversioned filename is intentional — versioned runbook filenames created the BUG-52 closure-path rot; see Turn 207 for the prior correction. The runbook targets `agentxchain@2.154.7` as the recommended pin because it bundles the BUG-59 / BUG-54 / BUG-52 third-variant fixes together and prevents a BUG-52 third-variant loop from blocking BUG-59 evidence collection.

The runbook must include pinned `npx --yes -p agentxchain@2.154.7` commands, the version-matrix table explaining which earlier releases still carry BUG-52 loops, the exact `jq` filters for state and `approval_policy` ledger rows, the credentialed negative recipe, and the BUG-54 ten-dispatch watchdog evidence shape.

**Why:** The tester should not have to infer which fields close the bug from agent debate. A short installed-package runbook reduces ambiguity and keeps BUG-60 blocked on concrete evidence rather than narrative confidence.

## DEC-BUG59-RELEASE-BUMP-SEPARATION-001

**Status:** Active as of 2026-04-21.

**Decision:** Release bump commits must contain only version and release-surface outputs owned by `cli/scripts/release-bump.sh`. Full-suite repairs discovered during a release-bump gate must be committed independently before rerunning the bump.

Do not hide fixture repairs, behavior fixes, docs rewrites, or test expectation changes inside the generated bump commit. If the release gate discovers those changes are needed, reset or stash the bump outputs, land the repair as its own commit with its own proof, then rerun the release bump.

**Why:** The v2.151.0 BUG-59 release found a long tail of stale tests that depended on manual gates. Splitting those repairs from the final bump kept the release commit auditable and made it clear which changes were behavior/test repairs versus mechanical release outputs.

## DEC-BUG52-UNBLOCK-ADVANCES-PHASE-001

**Status:** Active as of 2026-04-22.

**Decision:** `agentxchain unblock <hesc_id>` on a phase-gate-tied human escalation is allowed to be the phase-advance trigger. It must not require a pre-existing `pending_phase_transition` object when the current phase has a standing pending exit gate and the gate evidence now passes.

When unblock reactivates a blocked run that still has a retained same-phase active turn, resume must attempt phase reconciliation before re-dispatching that retained turn. If reconciliation advances, the prior-phase retained turn is stale and must not be re-dispatched.

**Why:** The v2.151.0 `tusq.dev` dogfood reproduced seven approval loops where `pending_phase_transition` was `null`, `phase_gate_status.planning_signoff` was `pending`, and `unblock` resolved the escalation but reassigned PM instead of entering implementation. The human approval itself is the missing trigger; requiring a separately materialized pending object recreates the loop.

## DEC-BUG52-UNBLOCK-ADVANCES-PHASE-ACTIVECOUNT-AGNOSTIC-001

**Status:** Active as of 2026-04-22, added Turn 203 by Claude Opus 4.7.

**Decision:** The `operator_unblock` branch in `cli/src/commands/resume.js` must fire the standing-gate reconciliation path regardless of `activeCount`. Dropping the prior `activeCount > 0` guard is the contract: `blocked + resumeVia === 'operator_unblock'` always calls `reconcilePhaseAdvanceBeforeDispatch` with `allow_active_turn_cleanup: true` and `allow_standing_gate: true`, and exits blocked via `markRunBlocked` when reconciliation cannot materialize a transition.

**Why:** The v2.151.0 `tusq.dev` third-variant repro accepted + checkpointed a PM `needs_human` turn without declaring `phase_transition_request`, which leaves `active_turns: {}` at unblock time. The `activeCount > 0` guard made the standing-gate path unreachable in that shape; the fallback reconcile at the bottom of `resume.js` was called without `allow_standing_gate`, so `buildStandingPhaseTransitionSource` never ran and the dispatcher looped back to PM. The regression test `Turn 203: unblock advances standing pending gate when active_turns is empty AND PM history has no phase_transition_request` fails on the prior guard and passes once it is dropped. This supersedes nothing — it extends DEC-BUG52-UNBLOCK-ADVANCES-PHASE-001 into the activeCount=0 case that the original wording assumed was already covered.

## DEC-BUG52-UNBLOCK-STANDING-GATE-DISCRIMINATOR-001

**Status:** Active as of 2026-04-22, added Turn 204 by GPT 5.4.

**Decision:** The activeCount-agnostic `operator_unblock` standing-gate path must be gated by two predicates: the current phase has a standing pending exit gate, and the latest completed blocked turn was trying to continue into a non-human phase role (either by declaring `phase_transition_request` or by proposing a non-`human` next role). Generic human escalations with `proposed_next_role: "human"` keep the normal unblock/resume path.

**Why:** The first Turn 203 implementation correctly fixed BUG-52's empty-active phase-gate loop, but it over-applied the branch to OAuth/schedule/external-decision escalations that merely happened to be in a phase whose gate was still pending. Those escalations are asking the operator to unblock the agent so it can produce evidence later; they are not approvals that should immediately materialize a phase transition. The discriminator preserves BUG-52's positive and evidence-gap negative command-chain tests while restoring `human-escalation.test.js` and `run-schedule-e2e.test.js`.

## DEC-BUG52-UNBLOCK-GATE-ARTIFACT-CONTRIBUTION-DISCRIMINATOR-001

**Status:** Active as of 2026-04-22, added Turn 205 by Claude Opus 4.7. Extends DEC-BUG52-UNBLOCK-STANDING-GATE-DISCRIMINATOR-001.

**Decision:** When the latest completed blocked turn has `status: 'needs_human'`, `phase_transition_request: null`, and `proposed_next_role: 'human'` (the realistic PM gate-signoff shape), the activeCount-agnostic standing-gate path must still engage — but only when the turn itself contributed to the phase exit gate's artifacts. The discriminator adds a third predicate: the current phase's exit gate must (a) require human approval, (b) declare one or more `requires_files`, (c) have ALL of those files present on disk, AND (d) the accepted blocked turn's `files_changed` must include at least one of those required files. Generic `needs_decision` escalations that block BEFORE the agent writes gate artifacts correctly continue to re-dispatch the in-phase role instead of force-advancing the phase.

**Why:** Turn 204's discriminator (either `phase_transition_request` set, or `proposed_next_role !== 'human'`) closes the obvious generic-escalation hole but still under-fits the *realistic* BUG-52 third variant: a PM that finished writing the gate's required artifacts and escalates with `proposed_next_role: 'human'` because the PM is literally handing the decision to the operator. On shipped `v2.154.5` that shape still loops. File-existence alone isn't discriminating because `scaffoldGoverned` writes placeholder gate files at init time; the `files_changed` contribution check distinguishes an operator-approved gate closure (PM produced gate artifacts this turn) from a schedule-daemon generic block (PM blocked before producing any artifacts). New regression: `Turn 205: unblock advances standing pending gate when PM declares proposed_next_role: "human" (realistic needs_human shape)` in `cli/test/beta-tester-scenarios/bug-52-gate-unblock-phase-advance.test.js` — failed on `v2.154.5` and post-Turn-204 `main`, passes after this refinement; schedule-daemon tests `AT-SCHED-009` and `AT-SCHED-CONT-FAIL-001` stay green.

## DEC-BUG52-STANDING-GATE-SYNTHETIC-SOURCE-HONORS-VERIFICATION-001

**Status:** Active as of 2026-04-22, added Turn 206 by GPT 5.4. Extends DEC-BUG52-UNBLOCK-GATE-ARTIFACT-CONTRIBUTION-DISCRIMINATOR-001.

**Decision:** Any `operator_unblock` path that relies on a synthetic standing-gate transition source must preserve the current exit gate's verification predicate. If the gate declares `requires_verification_pass: true`, the latest accepted blocked turn must have `verification.status: "pass"` or `"attested_pass"` before `resume.js` may enter the standing-gate reconcile path through either the non-human `proposed_next_role` predicate or the Turn 205 artifact-contribution predicate. A real `phase_transition_request` remains evaluated through the original accepted turn, so it does not need this synthetic-source guard.

**Why:** `buildStandingPhaseTransitionSource()` synthesizes `verification: {status: "pass"}` because it exists to recover a missing transition source, not to re-run the original turn. That is safe for planning signoff gates with no verification predicate, but unsafe for gates like `qa_ship_verdict` that combine `requires_human_approval` and `requires_verification_pass`. Without this guard, a `needs_human` turn that touched QA verdict artifacts but declared failed verification could be advanced by operator unblock because the synthetic source fabricates a passing verification status. Regression: `Turn 206: unblock does not synthesize a verified phase advance for verification-gated needs_human turns` in `cli/test/beta-tester-scenarios/bug-52-gate-unblock-phase-advance.test.js`.

## DEC-BUG52-STATE-CLEANUP-ON-PHASE-ADVANCE-001

**Status:** Active as of 2026-04-22.

**Decision:** Every phase advance path must clear stale prior-phase active turns before dispatching the next phase. Cleanup includes active turn entries, matching budget reservations, best-effort dispatch bundle directories, and a refreshed session checkpoint whose `active_turn_ids` no longer retains the cleared turns. The cleanup emits a `phase_cleanup` run event with the removed turn ids and budget/dispatch cleanup details.

Completed or accepted turns are not removed by cleanup. The cleanup is for retained/dispatched/retrying artifacts from the phase being exited.

**Why:** The BUG-52 third variant left stale PM active turns and budget reservations in state after the operator had approved the planning gate. Without atomic cleanup, the dispatcher sees a retained same-phase turn and loops back to PM even though the phase gate has been approved.

## DEC-BUG61-GHOST-RETRY-STATE-OWNERSHIP-001

**Status:** Active as of 2026-04-22.

**Decision:** BUG-61 ghost-turn auto-retry is a continuous-session behavior, not a governed-state counter. `run_loop.continuous.auto_retry_on_ghost` defaults to primitive off, promotes on only when continuous mode runs under a full-auto approval-policy posture (`phase_transitions.default: "auto_approve"` and `run_completion.action: "auto_approve"`), and respects explicit CLI/config opt-out.

The mutable retry budget belongs in `.agentxchain/continuous-session.json`. When the retry budget is exhausted, governed state may mirror only the exhaustion outcome in `blocked_reason.recovery.detail` so `agentxchain status` and dashboards show that automatic recovery already failed.

**Why:** Manual continuous sessions should keep manual ghost recovery visible. Full-auto sessions have already opted into unattended routine gate closure, so bounded ghost retry is consistent there. Keeping counters out of governed state avoids widening BUG-62's future operator-commit reconcile surface with ephemeral retry metadata while still preserving operator visibility after exhaustion.

## DEC-BUG61-FULL-AUTO-DETECTOR-STRICT-V1-001

**Status:** Active as of 2026-04-22, added Turn 179 by Claude Opus 4.7.

**Decision:** `isFullAutoApprovalPolicy(config)` in `cli/src/lib/continuous-run.js` remains a strict predicate for v1: `approval_policy.phase_transitions.default === "auto_approve"` AND `approval_policy.run_completion.action === "auto_approve"`. Rule-based auto-approval (e.g. the BUG-59 generated enterprise-app scaffold which sets `phase_transitions.default: "require_human"` with explicit `auto_approve` rules for specific transitions) does NOT satisfy the predicate and therefore does NOT promote `auto_retry_on_ghost.enabled` to `true`.

Users running a BUG-59 generated safe-rule scaffold who want BUG-61 ghost auto-retry must opt in explicitly:
- config: set `run_loop.continuous.auto_retry_on_ghost.enabled: true`, or
- CLI flag: pass `--auto-retry-on-ghost`.

**Why:** The BUG-61 spec explicitly defines full-auto posture as `phase_transitions.default: "auto_approve"` — rule-based approval is scoped to the specific transitions the author explicitly named, and broadening the detector to treat rule-match as full-auto would silently enable auto-retry for projects whose authors never considered ghost recovery. Strict equality preserves the principle of least astonishment and matches the roadmap text verbatim. The ergonomic gap (BUG-59 generated scaffold users must opt-in explicitly) is a documentation problem, not a detector-design problem. Slice 2b documentation (`website-v2/docs/lights-out-operation.mdx`) MUST explicitly name this opt-in path so scaffold users are not surprised.

A future DEC may broaden the predicate if evidence emerges that most full-auto users hit the rule-based path and the explicit opt-in is a persistent friction point — at that point, the predicate becomes a question of "what is the rule-based posture that proves full-auto intent?" which needs its own research turn and acceptance matrix. Until then, strict is the safe default.

## DEC-BUG61-SIGNATURE-REPEAT-EARLY-STOP-001

**Status:** Active as of 2026-04-21, added Turn 181 by Claude Opus 4.7.

**Decision:** BUG-61 ghost auto-retry stops early with `decision: "exhausted"` and `reason: "same_signature_repeat"` as soon as the tail of the per-attempt `attempts_log` shows `SIGNATURE_REPEAT_THRESHOLD` (=2) consecutive identical fingerprints, where a fingerprint is `${runtime_id}|${role_id}|${failure_type}`. This early-stop lane fires AFTER the raw `max_retries_per_run` budget check in `classifyGhostRetryDecision` — budget-exhaustion remains the primary cap. The threshold is a framework constant, not a config knob; widening it requires a new DEC.

**State shape additions:**
- `session.ghost_retry.attempts_log: Array<{attempt, old_turn_id, new_turn_id, runtime_id, role_id, failure_type, running_ms, threshold_ms, retried_at}>`, capped at 10 tail entries.
- Both `applyGhostRetryAttempt()` and `applyGhostRetryExhaustion()` preserve `attempts_log` through their transitions.

**Event/surface mirroring:**
- `ghost_retry_exhausted` payload carries `exhaustion_reason: "same_signature_repeat" | "retry_budget_exhausted"`, `signature_repeat: {signature, consecutive} | null`, and `diagnostic_bundle: {attempts_log, fingerprint_summary, final_signature}`.
- Governed `blocked_reason.recovery.detail` uses a distinct phrasing: `Auto-retry stopped early after N consecutive same-signature attempts [<sig>] (<failure_type>); last attempt N/M.` so operators can distinguish pattern-based stop from raw budget exhaustion.

**Why:** BUG-61's contract is "retry transient ghosts." A second identical `(runtime, role, failure)` fingerprint is already non-transient evidence — continuing to burn the budget on a systematic failure adds noise without recovery probability. Stopping early preserves operator attention, surfaces a richer diagnostic bundle at exactly the moment the operator is paged, and resolves the BUG-61 spec's Open Question #2 ("Should fingerprint-based early stop ship in the first implementation slice?") in the affirmative. Keeping the threshold non-configurable for v1 prevents the knob from becoming a "just bump it" escape hatch that hides the underlying runtime/role defect the pattern is pointing at.

## DEC-BUG61-MECHANISM-VERIFIED-CLOSURE-001

**Status:** Active as of 2026-04-24, added Turn 10 by GPT 5.5.

**Decision:** BUG-61 is closed as mechanism-verified on `agentxchain@2.154.11` using the tusq.dev tester quote-back at `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/agentxchain-quotebacks/BUG-61-ghost-retry-v2.154.11.md`.

The closure bar is satisfied by shipped-package evidence that:
- typed `stdout_attach_failed` ghosts triggered automatic retries;
- retry dispatch emitted distinct `old_turn_id` to `new_turn_id` transitions through `auto_retried_ghost`;
- deterministic repeat failures stopped through `ghost_retry_exhausted` with `exhaustion_reason: "same_signature_repeat"`;
- continuous-session state mirrored the retry attempts and exhaustion;
- governed state preserved the manual `reissue-turn --reason ghost` recovery guidance after exhaustion.

The original positive-path ask (`auto_retried_ghost` then retried turn succeeds and session continues) is no longer required for BUG-61 closure because the tester's setup forced deterministic ghosts with `startup_watchdog_ms: 100`, making a successful retry environmentally impossible. BUG-61 owns detection, bounded retry dispatch, retry-state accounting, exhaustion, and diagnostics. Once a retried turn is accepted, continuation is the standard governed-flow path already covered by the BUG-52/53/54/55 evidence lanes.

If future production evidence shows that a retried turn is successfully accepted but the continuous session fails to proceed afterward, file a narrow BUG-61b against retry-continuation integration. Do not reopen BUG-61 wholesale unless the typed ghost detection, retry dispatch, retry budget, same-signature exhaustion, or diagnostic preservation contracts regress.

**Why:** Keeping BUG-61 open until a naturally transient ghost appears creates an indefinite external dependency, especially after BUG-54 raised the startup watchdog to reduce false ghosts. The tester has already proven the mechanism under real adapter-path failure. Requiring a successful transient recovery on the same deterministic failure fixture would conflate environmental reproducibility with product behavior and would not identify any additional agent-side work.

## DEC-BUG62-MANUAL-OPERATOR-HEAD-RECONCILE-001

**Status:** Active as of 2026-04-22, added Turn 184 by GPT 5.4.

**Decision:** BUG-62 starts with an explicit manual primitive: `agentxchain reconcile-state --accept-operator-head`. The command accepts only fast-forward operator commits where the prior governed baseline is an ancestor of current `HEAD`, and it rejects commits that touch `.agentxchain/` or delete critical governed evidence. On success it updates `state.accepted_integration_ref`, refreshes `session.json.baseline_ref`, records `state.operator_commit_reconciliation`, and emits `state_reconciled_operator_commits`.

`last_completed_turn.checkpoint_sha` remains the SHA of the original turn checkpoint. Operator commits become the accepted integration baseline, not retroactive checkpoint authorship for the last agent turn.

Automatic continuous-mode reconciliation is intentionally deferred to the next BUG-62 slice. It must call the same safety primitive instead of duplicating commit-range checks inside the continuous loop.

**Why:** The tester's failure was not that drift was invisible; it was that the only recovery was manual state surgery. A manual command gives operators an auditable recovery path immediately while preserving fail-closed behavior for history rewrites and governed-state edits. Keeping checkpoint authorship separate from integration baseline avoids making an operator commit look like an agent checkpoint.

## DEC-BUG62-AUTO-SAFE-ONLY-RECONCILE-001

**Status:** Active as of 2026-04-22, added Turn 185 by Claude Opus 4.7.

**Decision:** BUG-62 slice 2 introduces a `run_loop.continuous.reconcile_operator_commits` tri-state config (`manual` | `auto_safe_only` | `disabled`) with a matching `--reconcile-operator-commits <mode>` CLI override on `agentxchain run`. Default is `manual`; under full-auto approval policy (`isFullAutoApprovalPolicy()` true), the effective default is promoted to `auto_safe_only`. Only the `auto_safe_only` mode calls the existing `reconcileOperatorHead(root, { safetyMode: 'auto_safe_only' })` primitive from `maybeAutoReconcileOperatorCommits()` before every continuous dispatch tick. The manual primitive remains the single audited safety function — the auto path does not reimplement range checks.

When the primitive refuses, the continuous loop writes `.agentxchain/state.json` to `status: 'blocked'` with `blocked_on: 'operator_commit_reconcile_refused'`, records `blocked_reason.error_class` (`governance_state_modified`, `critical_artifact_deleted`, `history_rewrite`, `missing_baseline`, `git_unavailable`, `not_git_repo`, or `commit_walk_failed`) and `blocked_reason.recovery.detail`, pauses the session, and emits the new `operator_commit_reconcile_refused` run event. Safe fast-forwards emit `state_reconciled_operator_commits` (reuse of the manual-path success event) so successful audit trails are uniform across manual and automatic recovery; refusal audit differs intentionally because the auto path also preserves the continuous-session pause reason.

`manual` mode preserves drift for operator-driven recovery. `disabled` mode is a no-op (reserved for environments where operators want zero automatic state writes even at the cost of continuous stalls).

**Why:** The tester's BUG-62 failure was "operator commits make the loop stall until surgery." Slice 1 gave operators the manual recovery knob; slice 2 closes the gap where a full-auto run should self-heal safe fast-forwards without human intervention, while history rewrites and governed-state edits *still* pause with an actionable blocked reason. Gating auto-recovery to the full-auto approval policy keeps the default conservative (manual) and mirrors BUG-61's approach of promoting auto-behaviors only where the operator has already accepted unattended execution. Routing through the manual primitive — rather than reimplementing safety classification inside the continuous loop — prevents drift between the two paths and keeps the refusal diagnostics identical regardless of who triggered reconcile.

## DEC-BUG54-REALISTIC-BUNDLE-REGRESSION-FLOOR-001

**Status:** Active as of 2026-04-22, added Turn 188 by GPT 5.4.

**Decision:** BUG-54 realistic-bundle watchdog regression tests must use the tester-observed `tusq.dev` bundle size (`17,737` bytes) as the minimum floor, not a rounded-down 15KB proxy. The beta-tester regression must cover:

- Claude-style `dispatch_bundle_only` startup proof,
- Codex-style `dispatch_bundle_only` startup proof,
- Codex-style `stdin` prompt transport that reads the full realistic prompt before emitting startup proof.

A third named runtime shape is not required until evidence shows another `local_cli` prompt-transport path with distinct adapter behavior; today the product risk is covered by runtime output style plus transport semantics, not by vendor labels.

**Why:** The v2.150.0 tester evidence measured a 17,737-byte realistic bundle and reproduced the watchdog failure on both Claude and Codex `local_cli` runtimes. A 15KB floor underfits the observed case. Covering only `dispatch_bundle_only` also leaves the live `stdin` path untested, despite BUG-54's original hypothesis set explicitly calling out stdin/EPIPE behavior. The regression should lock the real observed size and the adapter delivery modes that can affect first-output timing.

## DEC-BUG54-STARTUP-WATCHDOG-SIGKILL-GRACE-001

**Status:** Active as of 2026-04-23, added Turn 278 by GPT 5.4.

**Decision:** The `local_cli` startup watchdog is a bounded two-step kill path: when the startup watchdog fires, the adapter sends `SIGTERM`; if the child process ignores that signal, the adapter sends `SIGKILL` after a 10-second startup-watchdog grace window. Tests may override the grace duration through the internal `dispatchLocalCli(..., { startupWatchdogKillGraceMs })` option to keep ignored-SIGTERM regressions fast.

The failure remains classified as `startupFailureType: "no_subprocess_output"` because the root failure is still "spawned but produced no startup proof." The adapter also emits a distinct `startup_watchdog_sigkill` diagnostic so operators can distinguish graceful SIGTERM exits from children that had to be force-killed.

**Why:** A startup watchdog that only sends `SIGTERM` can still wedge continuous operation when a local runtime traps or ignores `SIGTERM`; the dispatch promise then waits for the much longer turn deadline even though startup has already failed. BUG-54 is a reliability bug, not just a classification problem, so the adapter must bound the startup-failure path itself. Keeping the existing failure class avoids churning downstream recovery logic while the new diagnostic preserves the operational distinction.

## DEC-BUG54-ABORT-SIGKILL-TIMER-CLEANUP-001

**Status:** Active as of 2026-04-23, added Turn 280 by GPT 5.4.

**Decision:** The `local_cli` abort path must track its fallback `SIGKILL` timer and clear it when the child exits or errors. An externally aborted runtime that honors `SIGTERM` should resolve as `aborted: true` and release the parent process immediately; the five-second fallback exists only for children that ignore `SIGTERM`.

**Why:** The old abort path armed an anonymous `setTimeout()` for the fallback `SIGKILL`. If the child exited promptly, the dispatch promise resolved, but the live timer still held the Node event loop open until the fallback deadline. In continuous operation that is a real adapter-side stall class, not a diagnostic naming issue. Tracking and clearing the timer preserves the existing abort semantics while removing the unnecessary delay.

## DEC-BUG60-IDLE-POLICY-ARCHITECTURE-001

**Status:** Active as of 2026-04-24.

**Decision:** BUG-60 perpetual continuous mode uses the governed intake pipeline (Option A), not direct special-case PM dispatch. Default `continuous.on_idle` remains `exit`; `perpetual` is opt-in. `human_review` is also a supported idle policy: after the idle threshold it pauses the continuous session and emits `idle_human_review_required` instead of claiming vision exhaustion or dispatching PM expansion. Idle expansion uses the normal `pm` role with an idle-expansion charter carried by the synthesized intake intent. Every `new_intake_intent` result must cite at least one matching VISION.md heading or goal; every `vision_exhausted` result must classify every top-level VISION.md heading.

**Why:** Intake gives auditability, lifecycle reuse, approval policy inheritance, and operator inspection. Direct dispatch creates a second autonomy path outside governance. A dedicated `pm_idle_expansion` role is deferred until there is a concrete runtime/tool/budget need that the normal PM role cannot satisfy.

**Turn 26 amendment:** The earlier deferred-scope note for `continuous.on_idle: "human_review"` is superseded. The roadmap's BUG-60 fix requirements explicitly require `exit | perpetual | human_review`, so `human_review` now has minimal real semantics: pause for operator review, preserve the session, and surface an auditable idle-review event.

## DEC-BUG60-BUDGET-BEFORE-IDLE-EXPANSION-001

**Status:** Active as of 2026-04-24.

**Decision:** `per_session_max_usd` is evaluated before any PM idle-expansion can dispatch or spend. Budget exhaustion dominates idle exhaustion when both are true. This invariant applies under bounded, perpetual, scheduled, and future idle policies. The ordering in `advanceContinuousRunOnce()` is: (1) `runs_completed >= maxRuns`, (2) `per_session_max_usd`, (3) idle-exit/perpetual-expansion. A dual-cap session reports `session_budget`, not `idle_exit`.

**Why:** Perpetual mode must not spend past an operator's categorical budget cap. Moving budget above idle also corrects the existing dual-cap reporting ambiguity where a session that exhausted both budget and idle cycles reported `idle_exit` instead of `session_budget`.

## DEC-BUG60-IDLE-EXPANSION-OBSERVABILITY-001

**Status:** Active as of 2026-04-24.

**Decision:** BUG-60 owns separate terminal state and event trail contracts.

Terminal states: `completed` (bounded), `idle_exit` (bounded queue empty), `vision_exhausted` (PM declared vision done), `vision_expansion_exhausted` (expansion cap reached without productive run), `session_budget` (budget exhausted). These are distinct session statuses that the scheduler maps to schedule-specific values.

Event trail: `idle_expansion_dispatched`, `idle_expansion_ingested`, `idle_expansion_malformed`, `idle_expansion_ingestion_failed`, `vision_snapshot_stale`, `vision_exhausted`, `vision_expansion_exhausted`. `vision_snapshot_stale` is an informational event emitted at most once per `session_id + current_vision_sha` at `advanceContinuousRunOnce()` entry; it has no scheduler mapping (it is not terminal).

Scheduler mappings: `vision_exhausted → continuous_vision_exhausted`, `vision_expansion_exhausted → continuous_vision_expansion_exhausted`, `idle_expansion_dispatched → continuous_running`.

**Why:** Operators need to know whether the loop stopped because bounded work ended, PM declared the vision done, the expansion mechanism failed, budget blocked further work, or the human-owned VISION.md moved during an active session.

## DEC-BUG60-RESULT-SCHEMA-EXTENSION-001

**Status:** Active as of 2026-04-24.

**Decision:** BUG-60 extends the turn-result schema with optional `idle_expansion_result`. The field is required only for accepted turns whose intake event source is `vision_idle_expansion`. It supports exactly two kinds in the first slice: `new_intake_intent` (with charter, acceptance_contract, priority, template, vision_traceability) and `vision_exhausted` (with heading-level classification). Validation lives in `idle-expansion-result-validator.js`; ingestion lives in `continuous-run.js:ingestAcceptedIdleExpansion()`.

**Why:** Idle expansion is PM-authored product work, not a hidden runner heuristic. Keeping the PM decision in turn-result makes it reviewable, testable, and governed by the same accept/reject path as other turns.

## DEC-BUG60-VALIDATOR-INGESTION-OWNERSHIP-001

**Status:** Active as of 2026-04-24.

**Decision:** Validation and ingestion remain separate. `idle-expansion-result-validator.js` validates shape, iteration, and VISION snapshot traceability during turn acceptance. `continuous-run.js:ingestAcceptedIdleExpansion()` ingests only after `acceptTurn()` succeeds, using `acceptResult.validation.turnResult` plus the accepted history entry. Ingestion never mutates state after a failed accept. The canonical ingestion call shape is `ingestAcceptedIdleExpansion(context, session, { turnResult, historyEntry, state })`.

**Why:** Turn acceptance owns whether an agent output is valid. Continuous mode owns what to do with a valid idle-expansion result. Mixing those responsibilities would create a second state-mutation path for rejected work.

## DEC-BUG60-SIGNAL-EXPANSION-KEY-DEDUP-001

**Status:** Active as of 2026-04-24.

**Decision:** `vision_idle_expansion` intake events use a deterministic three-key signal: `expansion_key`, `expansion_iteration`, and `accepted_turn_id`. The expansion key is `sha256(session_id + "::" + expansion_iteration + "::" + accepted_turn_id)`. No timestamps, PM prose, or runtime IDs belong in the signal. Pre-dispatch events use a placeholder `accepted_turn_id` of `pre_dispatch_{session_id}_{iteration}` because the real turn ID does not exist until after intake assigns it; post-acceptance PM-derived intents use the real accepted turn ID when available.

**Why:** Existing intake dedup hashes `signal`. A fixed signal shape gives idempotency without adding generic event metadata or source-specific dedup branches. The pre-dispatch/post-acceptance split is a pragmatic concession to the intake lifecycle ordering.
