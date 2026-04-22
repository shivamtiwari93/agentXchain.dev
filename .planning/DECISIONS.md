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

## DEC-BUG59-CLOSURE-GATE-TESTER-QUOTEBACK-001

**Status:** Active as of 2026-04-21.

**Decision:** BUG-59 is shipped and agent-verified in `agentxchain@2.151.0`, but it is not closed for BUG-60 implementation sequencing until the real tester quotes evidence from their own `tusq.dev` dogfood run.

Required quote-back fields:

- `.agentxchain/state.json` summary with `status`, `phase`, `pending_run_completion`, `blocked_on`, and `last_gate_failure`.
- One `decision-ledger.jsonl` row with `type: "approval_policy"`, `gate_type: "phase_transition"`, `action: "auto_approve"`, and a non-credentialed matched rule.
- One `decision-ledger.jsonl` row with `type: "approval_policy"`, `gate_type: "run_completion"`, `gate_id: "qa_ship_verdict"`, `action: "auto_approve"`, and a non-credentialed matched rule.
- A credentialed-gate counter-case where `qa_ship_verdict` or the project-equivalent external/irreversible gate remains blocked under `credentialed: true`.

Agent-side clean-install proof against the published package is necessary pre-proof, not sufficient closure. BUG-60 implementation, schema decisions, Option A/B selection, PM idle-expansion prompt text, and architectural plan commits remain blocked until this quote-back lands.

Static documentation-only audits that do not depend on the tester's BUG-59 quote-back are allowed before closure. Allowed pre-closure work includes verifying current file:line references, inventorying affected tests, and recording factual code-surface findings. These audits must not alter `cli/src/lib/`, must not choose the BUG-60 dispatch architecture, and must label any open design point as unresolved.

**Why:** The product claim is "full-auto works on the tester's real project," not merely "the packaged regression test passes." Prior beta false closures came from proving synthetic paths while the dogfood path still failed. This decision freezes the closure bar so agents stop toggling between release-complete and tester-complete language.

## DEC-BUG59-TESTER-QUOTEBACK-RUNBOOK-001

**Status:** Active as of 2026-04-21.

**Decision:** `.planning/BUG_59_54_2151_TESTER_QUOTEBACK_RUNBOOK.md` is the canonical tester checklist for the `agentxchain@2.151.0` BUG-59 and BUG-54 quote-back.

The runbook must include pinned `npx --yes -p agentxchain@2.151.0` commands, the exact `jq` filters for state and `approval_policy` ledger rows, the credentialed negative recipe, and the BUG-54 ten-dispatch watchdog evidence shape.

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

## DEC-BUG52-STATE-CLEANUP-ON-PHASE-ADVANCE-001

**Status:** Active as of 2026-04-22.

**Decision:** Every phase advance path must clear stale prior-phase active turns before dispatching the next phase. Cleanup includes active turn entries, matching budget reservations, and best-effort dispatch bundle directories. The cleanup emits a `phase_cleanup` run event with the removed turn ids and budget/dispatch cleanup details.

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
