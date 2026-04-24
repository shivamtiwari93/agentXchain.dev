# BUG-60 Pre-work Review — GPT 5.4

> **Tag:** `BUG-60-REVIEW-GPT`
> **Author:** GPT 5.4 (Codex), Turn 260
> **Status:** Documentation-only adversarial review. No implementation. No source files modified.
> **Reviewed against HEAD:** `e7d2e08b docs(bug-60): review audit drift gate`
> **Source artifact:** `.planning/BUG_60_RESEARCH_CLAUDE.md`

This is Pre-work turn B for HUMAN-ROADMAP BUG-60. It reviews Claude's research, challenges the guardrails, proposes a config schema, fills the acceptance matrix, and verifies the BUG-59 dependency plus the then-open BUG-52 dependency. It does not modify `cli/src/lib/continuous-run.js`, `vision-reader.js`, `intake.js`, `normalized-config.js`, or `dispatch-bundle.js`.

## 1. Adversarial Review Of Claude Research

Claude is right on the largest architectural choice: **Option A, the intake pipeline, should beat direct special-case dispatch.** Bypassing intake would create another hidden autonomy path beside the governed lifecycle. The existing continuous loop already knows how to `recordEvent -> triageIntent -> approveIntent -> prepareIntentForDispatch`, so BUG-60 should extend that shape rather than invent a second runner.

But the research has two material errors.

**Error 1: the PM output is not machine-consumed today.** Claude's trace says T15 "PM processes charter -> outputs JSON (schema A: new_intake_intent)" and then goal work proceeds. That is not a current interface. The turn-result schema has `additionalProperties: false` and knows standard fields only; it has no `new_intake_intent`, `vision_exhausted`, or `idle_expansion_result` field. Acceptance writes history, ledger entries, state, and events from standard turn-result fields. It does not parse arbitrary PM JSON and create a new intake event. So Choice 3 is not complete unless the plan adds an explicit machine-consumed result contract and post-acceptance ingestion path.

The clean shape is still probably "PM role + charter-carried instruction," but the contract cannot be "the PM writes JSON somewhere in its prose." It must be one of:

- extend turn-result schema with a bounded `idle_expansion_result` object valid only for idle-expansion turns;
- require a produced artifact at a known path, then have the orchestrator validate and ingest that artifact after acceptance;
- use an existing structured mechanism such as delegations only if the plan proves it maps cleanly to new intake intents, which I doubt.

**Error 2: budget ordering is not automatically preserved.** Claude says `per_session_max_usd` fires before PM idle-expansion. In HEAD, the order is max-runs, idle-cycles, then session-budget. If BUG-60 inserts the perpetual branch at the current idle-exit check, an over-budget session that also hit idle threshold would dispatch expansion before the budget check. That violates the roadmap's budget guardrail. The plan must either move the budget check before idle expansion or put an explicit budget guard inside the perpetual branch before any PM dispatch.

Missed path: **schedule-owned continuous sessions.** The research mentions tests but does not carry scheduler semantics into the architecture. `schedule.js` calls `advanceContinuousRunOnce()` as a single-step daemon path and maps `step.status` into schedule `last_status`. Any new `vision_exhausted` or `vision_expansion_exhausted` status must be mapped there, or scheduled perpetual sessions will report misleading status even if CLI-owned sessions work.

I agree with Claude's rejection of per-dispatch prompt override as primary. It touches stable prompt rendering for every dispatch to solve one mode's instruction problem. I also agree the dedicated `pm_idle_expansion` role should stay a fallback, not the first move, unless the plan needs role-scoped runtime/tool/budget policy.

## 2. Guardrail Review

The four roadmap guardrails are necessary but not sufficient.

Add a fifth guardrail: **machine-validated vision traceability.** Prompt honor is not enough. For `new_intake_intent`, the accepted expansion result must cite at least one VISION.md heading or goal, and the validator must reject empty or non-matching `vision_traceability`. For `vision_exhausted`, the result must classify each top-level VISION goal as complete, deferred, or out-of-scope, with a brief reason. This is not semantic perfection, but it blocks generic "looks aligned" claims and gives the next run auditable scope.

Add a sixth guardrail: **bounded ingestion idempotency.** The same accepted PM expansion result must not create duplicate intents if acceptance is retried, a daemon tick races with CLI polling, or a post-acceptance hook is rerun. Use a deterministic expansion id/dedup key derived from session id + expansion iteration + accepted turn id, not only source file hashes. Claude's "emit anyway" answer for source-hash dedup is right, but it does not solve acceptance retry idempotency.

Keep VISION.md immutable as an executable assertion, not only prompt text. Positive BUG-60 tests should snapshot the VISION.md hash before perpetual mode and assert it is unchanged after PM expansion.

## 3. Config Schema I Would Ship

Use a small opt-in schema:

```json
{
  "run_loop": {
    "continuous": {
      "enabled": true,
      "vision_path": ".planning/VISION.md",
      "max_runs": 50,
      "max_idle_cycles": 3,
      "triage_approval": "auto",
      "per_session_max_usd": 25,
      "on_idle": "exit",
      "idle_expansion": {
        "sources": [".planning/VISION.md", ".planning/ROADMAP.md", ".planning/SYSTEM_SPEC.md"],
        "max_expansions": 5,
        "role": "pm",
        "output": "intake_intent_or_vision_exhausted",
        "malformed_retry_limit": 1
      }
    }
  }
}
```

`on_idle` values: `exit`, `perpetual`, `human_review`.

Why these names:

- `on_idle` is direct and matches tester language.
- `idle_expansion` is better than `on_idle_perpetual` because it names the sub-feature, not the enum value. If future modes share source lists or caps, the config does not become value-specific.
- `max_expansions` is scoped by its parent, so it does not need the longer `max_idle_expansions`.
- `role` defaults to `pm`; this keeps Choice 3 primary while leaving a clean path to a dedicated role without changing schema.

Backward compatibility: default `on_idle: "exit"` preserves current bounded behavior. Existing `max_idle_cycles` keeps its current meaning under `exit`; under `perpetual`, it means "idle polls before one expansion attempt." No existing field should change default semantics.

I would not ship `stop_only_when: "vision_explicitly_satisfied_or_human_stops"` as a string policy. It reads like product prose, not an enforceable state machine. The enforceable fields are `on_idle`, `max_expansions`, `malformed_retry_limit`, PM `vision_exhausted`, and budget cap.

## 4. Acceptance Matrix

| Condition | Perpetual-mode action | Rationale |
|---|---|---|
| Queue empty, vision has candidates | Seed normal `vision_scan` intent and start/approve per current flow. | Perpetual mode should not bypass the existing cheaper derivation path. |
| Queue empty, vision has no candidates, ROADMAP has items | After `max_idle_cycles`, dispatch PM idle-expansion with ROADMAP in sources. | "No derivable VISION candidate" is not "no product work." |
| Queue empty, no vision/roadmap/spec candidates | Dispatch PM idle-expansion; PM may return `vision_exhausted`, else malformed/no-op counts against expansion cap. | Exhaustion is a governed claim, not a silent scanner conclusion. |
| PM idle-expansion produces `vision_exhausted` | Stop with distinct `vision_exhausted` step/session reason and event trail. | Operators need to distinguish PM-declared exhaustion from bounded idle exit. |
| PM idle-expansion fails acceptance (malformed output) | Retry once, then increment failed expansion count; stop with `vision_expansion_exhausted` when cap is hit. | Prevents infinite spend while allowing one formatting recovery. |
| Budget cap hit mid-PM-turn | Accept/account for the turn if it produced valid output, then stop before any further dispatch with `session_budget`. If cap is already hit before dispatch, do not dispatch PM. | Budget guard must be categorical but cannot erase an already completed/staged turn. |
| `max_idle_expansions` hit | Stop with `vision_expansion_exhausted`; do not mark product vision complete. | Cap exhaustion means the expansion mechanism failed, not that the mission is done. |
| Run started from PM-expansion fails at `qa_ship_verdict` | Pause/block exactly like any other run; if policy auto-approval is configured and non-credentialed, it should not block. | BUG-60 must inherit gate governance, not sidestep it. |
| User Ctrl-C during idle-expansion | Persist stopped session with current expansion/run ids and do not create partial duplicate intents on resume. | Operator stop must remain authoritative and recoverable. |

## 5. BUG-59 / BUG-52 Dependency Verification

Status update after BUG-52 closure: the BUG-52 dependency described below was real when this review was written, but is now satisfied by tester quote-back on `agentxchain@2.154.11`. BUG-60 remains blocked only on BUG-59 tester quote-back plus the already-completed BUG-60 pre-work/plan gates.

The dependency is genuine but should be stated precisely.

Under current HEAD, `evaluatePhaseExit()` still returns `awaiting_human_approval` for `requires_human_approval` gates. The BUG-59 fix is in governed-state acceptance/reconcile paths: when that action appears, `evaluateApprovalPolicy()` can auto-approve non-credentialed phase transitions and run completions, writing `approval_policy` ledger rows. A perpetual run that reaches `qa_ship_verdict` with a matching `approval_policy.run_completion.action: "auto_approve"` can complete in code.

Without that policy, the same run pauses at the human approval gate. With a credentialed gate, it must also pause. Therefore BUG-60 cannot honestly claim lights-out full-auto unless the approval-policy path is tester-verified on the published package.

BUG-52 was a separate critical dependency for projects using delegated human unblock instead of approval_policy. If a PM-expanded run gets manually unblocked at a human gate and the phase state does not mutate, perpetual mode will loop on the same gate. That is why BUG-60 implementation had to remain blocked behind both BUG-59 tester quote-back and the BUG-52 third-variant fix/quote-back, not just the internal presence of approval-policy code. BUG-52's shipped-package quote-back is now complete on `agentxchain@2.154.11`; BUG-59 quote-back remains.

## 6. Reconciliation Required Before Plan Turn

I agree with Option A and with Choice 3 as the lowest-risk prompt-routing default, but I disagree with Claude that the plan can rely on charter text alone. The plan turn must reconcile these points before implementation:

1. Where exactly is the PM expansion result stored: turn-result schema field, known artifact path, or another structured channel?
2. What component validates and ingests that result into a new intake event/intent?
3. How is ingestion idempotent across acceptance retry and scheduler ticks?
4. How is the budget guard ordered before PM dispatch?
5. How are new terminal statuses mapped for schedule-owned sessions?

Until those are answered, BUG-60 has research coverage but not an implementation-ready plan.
