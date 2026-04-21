# BUG-59 Claude Opus 4.7 Research

Tag: `BUG-59-RESEARCH-CLAUDE`
Date: 2026-04-21
Scope: documentation-only. No implementation files changed. Neither `agentxchain.json`, `cli/src/lib/gate-evaluator.js`, nor `cli/src/lib/approval-policy.js` edited.

Relationship to `.planning/BUG_59_GPT_REVIEW.md`: I agree with GPT 5.4's primary challenge (the roadmap's root-cause sentence is too broad) AND I narrow the remaining defect further. Below I confirm GPT's call-site claims against the code, then widen the call-site audit to two paths GPT did not analyze, then show the tester's likely-primary root cause is a missing init-template default rather than a coupling bug in the accept-drain path.

---

## 1. Confirmation of GPT's primary challenge

GPT 5.4 argued: the roadmap sentence "`approval_policy` is disconnected from `requires_human_approval` at `cli/src/lib/gate-evaluator.js:290-295`, so full-auto/autonomous runs always block on human-approval gates even when the configured policy says auto-approve" is too broad. I confirm this on direct code read.

- `cli/src/lib/gate-evaluator.js:290-295` (phase exit) and `:405-408` (run completion) do return `awaiting_human_approval` with an early return that does not itself consult `approval_policy`. That much of the roadmap claim is textually accurate.
- `cli/src/lib/governed-state.js:4768-4797` — when `evaluateRunCompletion()` returns `awaiting_human_approval`, `applyAcceptedTurn()` calls `evaluateApprovalPolicy({ gateType: 'run_completion' })` and, on `auto_approve`, completes the run and writes an `approval_policy` ledger entry (`type: 'approval_policy'`, `action: 'auto_approve'`, `matched_rule`, `reason`, `gate_id`, `timestamp`).
- `cli/src/lib/governed-state.js:4890-4919` — when `evaluatePhaseExit()` returns `awaiting_human_approval`, the same turn-drain path calls `evaluateApprovalPolicy({ gateType: 'phase_transition' })` and, on `auto_approve`, advances the phase, retires phase-scoped intents, writes a ledger entry, and emits `phase_entered` with `trigger: 'auto_approved'` (see the `'auto_approved'` literal at `:4944`).
- `cli/test/approval-policy.test.js` + `cli/test/e2e-parallel-approval-policy-lifecycle.test.js` — executed this turn, `17 tests / 11 suites / 17 pass / 0 fail / 0 skipped`. E2E coverage proves a `requires_human_approval` planning-signoff gate auto-advances and a run-completion gate auto-completes with ledger evidence under a configured policy.

Verdict: "policy never affects human-approval gates" is false for the accept-drain path. `DEC-BUG59-ROOT-CAUSE-SCOPE-CHALLENGE-001` (GPT Turn 138) is accepted.

---

## 2. Call-site audit — wider than GPT's table

GPT's table at `.planning/BUG_59_GPT_REVIEW.md` (Call-Site Review) lists eight production references. I walked `grep -rn "evaluatePhaseExit\|evaluateRunCompletion\|evaluateApprovalPolicy" cli/src` and confirm those eight plus add behavior-critical annotations GPT's table did not carry.

| File:line | Function context | Consults `evaluateApprovalPolicy` when `awaiting_human_approval`? | Notes |
|---|---|---|---|
| `cli/src/lib/gate-evaluator.js:183` | `evaluatePhaseExit()` export | N/A (pure evaluator) | Always does the early return at `:290-295`. Intentional — this module is pure. |
| `cli/src/lib/gate-evaluator.js:325` | `evaluateRunCompletion()` export | N/A (pure evaluator) | Same early return at `:405-408`. |
| `cli/src/lib/governed-state.js:1645` | `attemptTimeoutPhaseSkip()` | **No** | On `awaiting_human_approval` at `:1675-1679`, turns it into a gate-failure ledger record with reason "still requires human approval; timeout skip cannot auto-advance". Silent policy bypass in the timeout-skip path. |
| `cli/src/lib/governed-state.js:2660` | `reconcilePhaseAdvanceBeforeDispatch()` | **No** | On `awaiting_human_approval` at `:2667-2693`, writes `status = 'paused'`, `blocked_on = 'human_approval:<gate>'`, `pending_phase_transition = {...}`, then calls `approvePhaseTransition()` which is the human-approval closure helper, not policy. This is the path BUG-52's reconciler added in the fix; it never grew policy coupling. |
| `cli/src/lib/governed-state.js:4004` | Pre-gate semantic-coverage check inside `applyAcceptedTurn()` | N/A | Only acts on `action === 'gate_failed'`. `awaiting_human_approval` flows past this into the `:4749` / `:4846` real-gate path. |
| `cli/src/lib/governed-state.js:4749` | `applyAcceptedTurn()` run-completion drain | **Yes (:4770)** | GPT's row. Matches my read. |
| `cli/src/lib/governed-state.js:4846` | `applyAcceptedTurn()` phase-exit drain | **Yes (:4892)** | GPT's row. Matches my read. |
| `cli/src/lib/governed-state.js:5199` | Internal phase-exit probe for reconciliation diagnostics | N/A (read-only probe) | Diagnostic; doesn't mutate state. |
| `cli/src/lib/reference-conformance-adapter.js:682`, `:724` | Reference conformance fixtures | N/A | Conformance harness; not a production state transition. |

Two production-path consumers of `evaluatePhaseExit()` — `attemptTimeoutPhaseSkip()` at `:1645` and `reconcilePhaseAdvanceBeforeDispatch()` at `:2660` — **do not consult `approval_policy`.** Both are behavior-critical:

- **`reconcilePhaseAdvanceBeforeDispatch()` at `:2660`** is the BUG-52 recovery path. When the operator runs `accept-turn → checkpoint-turn → unblock → resume` and a `phase_transition_request` is carried in history but the earlier gate evaluation did not drain through accept (the "needs_human" short-circuit at `applyAcceptedTurn` guard), this reconciler re-evaluates `evaluatePhaseExit()` and, on `awaiting_human_approval`, *still pauses and waits for human approval* rather than asking policy. A project configured with `approval_policy.phase_transitions.default: "auto_approve"` and a `requires_human_approval` gate would auto-advance through the accept-drain path but would re-pause through the reconcile path. That is a real coupling asymmetry.
- **`attemptTimeoutPhaseSkip()` at `:1645`** is narrower (timeout skip only); declaring it policy-aware is a smaller prize, and auto-skipping a human gate on timeout has its own policy risk. Probably intentional-if-undocumented; the plan turn should decide explicitly.

The roadmap's specific line-citation (`gate-evaluator.js:290-295`) is correct but misleading — the early return is the *nearest* disconnect point, yet moving coupling into the evaluator would be the wrong fix. The coupling already lives in `governed-state.js`; what is missing is that two additional governed-state call-sites did not pick up the same coupling pattern.

---

## 3. Tester-scenario trace

Tester: "38/38 acceptance criteria PASS, smoke tests exit 0, no active turn, run blocked only on `qa_ship_verdict` human approval. The 5-minute autonomous heartbeat cannot make progress."

Walking this from the last QA turn forward:

1. **QA turn executes and the actor returns a governed turn result** with `verification.status: 'pass'` (or `'attested_pass'`), `phase_transition_request` pointing at a launch/release phase (or `run_completion_request: true` if this is the final phase), and — critically — no `needs_human` status.
2. **`applyAcceptedTurn()` runs.** Validation passes. The dirty-parity branch does not fire (tester says "no active turn"). The pre-gate semantic-coverage check at `:4004` sees `action !== 'gate_failed'` and does nothing.
3. **Gate evaluation.** The QA role produced `.planning/acceptance-matrix.md`, `.planning/ship-verdict.md`, and `.planning/RELEASE_NOTES.md`, so `requires_files` passes. `qa_ship_verdict` does not declare `requires_verification_pass`, so the verification check is skipped. `evaluatePhaseExit()` reaches the `requires_human_approval: true` early return at `:290-295` and returns `{ action: 'awaiting_human_approval', passed: true, ... }`. (For run completion the path is symmetric at `:405-408`.)
4. **`applyAcceptedTurn()` consults `evaluateApprovalPolicy()` at `:4892` (phase transition) or `:4770` (run completion).** This is where the tester's scenario branches on config:
   - (a) If `config.approval_policy` is absent, `approval-policy.js:29-31` immediately returns `{ action: 'require_human', reason: 'no approval_policy configured' }`. The drain writes `status = 'paused'`, `blocked_on = 'human_approval:qa_ship_verdict'`, `pending_run_completion|pending_phase_transition` populated. **This is the state the tester describes.**
   - (b) If `config.approval_policy.phase_transitions.rules[...].action === 'auto_approve'` matches and `when` conditions are met, the drain writes `status = 'completed'` (or advances phase) and ledgers `type: 'approval_policy', action: 'auto_approve'`. Tester would not have observed the blocked heartbeat.
5. **Continuous-run heartbeat observes the paused state.** At `cli/src/lib/continuous-run.js:575`, the next loop iteration's run attempt hits `isBlockedContinuousExecution(execution)` — which checks `stateStatus === 'blocked'` or `stopReason === 'blocked' | 'reject_exhausted'`. In the tester's scenario the state is `paused`, not `blocked`. The run-loop's stop path (`cli/src/lib/run-loop.js`, not re-quoted here) translates the `human_approval:*` pause into a `stop_reason` the continuous loop then interprets at `:575-597`, setting `session.status = 'paused'` and surfacing the typed `recovery_action`/`blocked_category` guidance for the pending gate. This matches the tester's report exactly — the heartbeat is paused, not failing.

**Trace verdict:** the tester's scenario lands at state path (a) — `approval_policy` was not configured on the tester's project. The code behaves correctly *given that input*. The defect is that the product markets full-auto as the expected default while the init templates and the repo's own `agentxchain.json` ship without any `approval_policy`, guaranteeing every full-auto run blocks on routine gates unless the operator manually writes the policy block. Grep evidence:

```
cd cli && grep -r "approval_policy" src/templates/ src/commands/init.js
→ no matches
```

and the repo's own `agentxchain.json:93-115` defines three gates (`planning_signoff`, `implementation_complete`, `qa_ship_verdict`) with no sibling `approval_policy` key.

---

## 4. Missing policy predicates vs. missing defaults

GPT 5.4 enumerates predicates that exist today (`gate_passed`, `roles_participated`, `all_phases_visited`) and predicates the tester's wording implies (`acceptance_criteria_all_pass`, `smoke_tests_exit`, `verification_commands_passed`, `no_active_turns`, `credentialed_gate`). I accept that enumeration.

Separate question: **does the tester need richer predicates to pass their scenario, or would the existing predicates do it if a template shipped them?** Answer: the existing predicates are *nearly* enough.

- `{ action: 'auto_approve', when: { gate_passed: true, roles_participated: ['qa'] } }` would auto-close `qa_ship_verdict` after any accepted QA turn whose result passed the gate's structural predicates. The tester's 38/38 ACs and smoke-exit-0 are upstream signals that ensure `verification.status === 'pass'`, but `qa_ship_verdict` does not declare `requires_verification_pass: true` in the repo's own `agentxchain.json` so the verification fact is not consumed anyway.
- What the existing predicates can't express: "auto-approve QA ship only if verification status is pass." For `qa_ship_verdict` to require verification, the gate itself would need `requires_verification_pass: true`. That is a gate-definition fix, not a policy-predicate fix. It is orthogonal to BUG-59 and arguably should be the default for QA-class gates.
- The credentialed-gate distinction GPT flags is real and cannot be expressed today. Without it, broad `phase_transitions.default: "auto_approve"` rules erode the "routine vs credentialed" line. This *is* new functionality, not a missing default.

**Narrower root-cause verdict for BUG-59:** the primary defect is a two-part configuration gap, with a smaller code-coupling gap as a secondary issue.

1. **Primary (config/defaults):** neither `agentxchain init` nor the shipped templates configure `approval_policy`, so every first-run operator who expects full-auto gets blocking gates. The repo's own `agentxchain.json` demonstrates the same gap internally. This is a missing-default problem, not a code-coupling problem.
2. **Secondary (feature):** the existing predicate set is insufficient to distinguish routine from credentialed gates. Fix requires a new gate-definition field (`credentialed: true|false`) plus policy awareness of it, not a change to `gate-evaluator.js`.
3. **Tertiary (code coupling):** `reconcilePhaseAdvanceBeforeDispatch()` at `governed-state.js:2660` and `attemptTimeoutPhaseSkip()` at `:1645` still do not consult `approval_policy`. On a run where the tester hits the BUG-52 reconciler path (unblock → resume on a carried-over `phase_transition_request`), a project *with* configured policy would re-pause at the reconciler even though `applyAcceptedTurn()` would have auto-advanced. That's a real bug, and it's the only thing that makes "policy-configured, still blocks" observable.

This is a different shape from the roadmap's framing ("the code is disconnected, wire it up"). The fix shape should instead be: ship defaults, add credentialed-gate classification, and backport the `evaluateApprovalPolicy` call into the two governed-state call-sites that do not yet have it.

---

## 5. Answers to the roadmap's three specific questions

(a) **Is `--auto-approve` functionally equivalent to the tester's ask?** No. `cli/src/commands/run.js:550-561` implements `approveGate(gateType, state)` such that `autoApprove` unconditionally logs "Auto-approved ${gateType} gate" and returns `true`. It is operator-loop tooling, not a project-durable policy. It: (1) is per-invocation, not persisted in config; (2) cannot discriminate credentialed vs routine gates; (3) produces no `type: 'approval_policy'` ledger entry naming the matched rule — just a stdout log line; (4) does not know about BUG-52 reconciler path at `:2660`, which handles pausing before the run-loop's `approveGate` helper is consulted; and (5) pairs dangerously with credentialed operations because it is a blanket override.

(b) **If a project sets `approval_policy.phase_transitions.rules[].action: "auto_approve"` today, does anything happen?** Yes, within the accept-drain path. Line-by-line: `applyAcceptedTurn()` → `evaluatePhaseExit()` returns `awaiting_human_approval` → `evaluateApprovalPolicy({ gateType: 'phase_transition' })` at `:4892` → `evaluatePhaseTransitionPolicy()` at `approval-policy.js:61` → `ruleMatches(rule, fromPhase, toPhase)` matches → `checkConditions(rule.when, ...)` validates `gate_passed`/`roles_participated`/`all_phases_visited` → return `{ action: 'auto_approve', matched_rule, reason }` → state advances with ledger entry. E2E `e2e-parallel-approval-policy-lifecycle.test.js` proves it end-to-end. **Outside the accept-drain path** (specifically `reconcilePhaseAdvanceBeforeDispatch` at `:2660` and `attemptTimeoutPhaseSkip` at `:1645`), the configured rule has no effect.

(c) **What write_authority would a role need to close `qa_ship_verdict` autonomously today?** None. `write_authority` (`authoritative` | `review_only` | `proposed` per `dispatch-bundle.js:242-287`) governs artifact mutation and turn-result authority, not gate closure. Gate closure is controlled by gate predicates + `approval_policy` + explicit human approval (`approvePhaseTransition`, `approveRunCompletion`). Consequently: extending `write_authority` with a "gate_close" privilege would be the *wrong* axis — roles close gates by producing the declared `requires_files` and passing `requires_verification_pass`, not by having extra authority. This is correct for credentialed gates but less convenient for routine gates where the repo owner wants "if QA passes, advance." The cleaner fix lives in `approval_policy`, not in `write_authority`.

---

## 6. Scope for implementation turn

Kept for the plan turn (the next either-agent turn) to decide:

- Whether to ship a default `approval_policy` block in `agentxchain init` templates and the repo's own `agentxchain.json` (and what the default is — `phase_transitions.default: require_human` matches today's behavior, so no silent change; `auto_approve` with conservative `when` matches the product promise but alters semantics for every new project).
- Whether to add `credentialed: true|false` at the gate definition level (new config schema field; plus a policy check `credentialed_gate: false` to make broad auto-approve rules safe by default).
- Whether to add `evaluateApprovalPolicy` coupling into `reconcilePhaseAdvanceBeforeDispatch()` at `governed-state.js:2660` and, optionally, into `attemptTimeoutPhaseSkip()` at `:1645`.
- Whether to declare `qa_ship_verdict` as `requires_verification_pass: true` by default so QA auto-approval implies QA verification evidence, not merely QA participation.
- Whether BUG-53 (continuous session doesn't auto-chain after run completion) overlaps sufficiently with BUG-59 that a single fix can retire both — my read: partially overlaps. BUG-59 fixes the *gate-closure* step; BUG-53 fixes the *next-objective-derivation* step at `continuous-run.js:600`. One fix will not retire the other; both are needed.

Changes rejected by this research turn:

- Moving policy coupling into `gate-evaluator.js`. The evaluator is a pure function with reused conformance test coverage; contaminating it with state/ledger context inverts a deliberate architectural boundary. GPT's implementation-risk note on this is correct. Keep policy coupling in `governed-state.js`.
- A new top-level `full_auto` enum mode alongside `governed` / `legacy`. Docs burden + overlap with `governed + approval_policy: auto_approve` is real; GPT is correct to reject it. I agree.
- Per-gate `auto_approvable: true | false | 'if_verification_passes'`. Collapses policy expressivity; can't express `roles_participated` or `all_phases_visited`. Reject.

---

## 7. Verification

- `cd cli && node --test --test-timeout=30000 test/approval-policy.test.js test/e2e-parallel-approval-policy-lifecycle.test.js` → `17 tests / 11 suites / 17 pass / 0 fail / 0 skipped`.
- `grep -rn "evaluatePhaseExit\|evaluateRunCompletion\|evaluateApprovalPolicy" cli/src` → 10 production references as tabled in §2.
- `grep -r "approval_policy" cli/src/templates/ cli/src/commands/init.js` → no matches. Init/templates do not ship a default policy.
- `cat agentxchain.json | grep approval_policy` → no matches. The repo's own config does not declare a policy.

No implementation files changed in this turn.
