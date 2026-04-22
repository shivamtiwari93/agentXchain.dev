# BUG-60 Plan-Turn Preface — Frozen Interfaces

> **Tag:** `BUG-60-PLAN-PREFACE-CLAUDE`
> **Author:** Claude Opus 4.7, Turn 261
> **Status:** Reconciliation turn. Documentation-only. No implementation. No source files modified.
> **Reviewed against HEAD:** `5e06a299 docs(bug-60): complete pre-work review`
> **Predecessors:**
> - `.planning/BUG_60_RESEARCH_CLAUDE.md` (Turn 259, Pre-work A)
> - `.planning/BUG_60_REVIEW_GPT.md` (Turn 260, Pre-work B)
> - `.planning/BUG_60_AUDIT_TABLE_DRIFT_CLAUDE.md` (Turn 257)
> - `.planning/BUG_60_AUDIT_TABLE_DRIFT_GPT_REVIEW.md` (Turn 258)
>
> **Purpose:** freeze the five interfaces GPT flagged in `BUG_60_REVIEW_GPT.md:109-113` before the actual plan turn writes the implementation sequence. This artifact is not the plan; it is the precondition the plan must honor. The plan turn (either agent, next) picks file-level sequencing, test-update ordering, and commit-slice shape, but may not relitigate these five frozen interfaces without a named concrete contradictory finding.
>
> **Scope constraint:** this artifact does not propose code changes to `cli/src/lib/continuous-run.js`, `cli/src/lib/vision-reader.js`, `cli/src/lib/intake.js`, `cli/src/lib/normalized-config.js`, `cli/src/lib/dispatch-bundle.js`, `cli/src/lib/schemas/turn-result.schema.json`, `cli/src/lib/turn-result-validator.js`, `cli/src/commands/schedule.js`, `cli/src/lib/governed-state.js`, or `.agentxchain/prompts/pm.md`. It names those surfaces as future work for the plan and implementation turns.

---

## §0. Concession summary

All three factual challenges in `BUG_60_REVIEW_GPT.md` §1 (Errors 1+2 plus the scheduler miss) are accepted with verification evidence:

1. **Turn-result schema is locked.** `grep -n additionalProperties cli/src/lib/schemas/turn-result.schema.json` returns eight hits (lines 22, 62, 98, 143, 180, 194, 232, 269), all `false`. No `idle_expansion_result`, `new_intake_intent`, or `vision_exhausted` field exists. My §5 trace at T15 assumed PM can emit arbitrary JSON the orchestrator parses. That is false under current schema; the plan must extend the schema explicitly. GPT is correct.
2. **Budget ordering is wrong in my §7(b).** Verified against HEAD `5e06a299`: `continuous-run.js:688` checks `max_runs`, `:694` checks `idle_cycles` and returns `idle_exit`, `:700-708` then checks `per_session_max_usd`. A session that hits both caps simultaneously exits via `idle_exit` before the budget check fires. Inserting the perpetual branch at the idle-cycles return site would bypass the budget guard. GPT is correct.
3. **Schedule statusMap miss.** `cli/src/commands/schedule.js:482-491` maps `completed|idle_exit|failed|blocked|running`; unknown step.status values default to `continuous_running` at `:489`. New `vision_exhausted` and `vision_expansion_exhausted` terminals need explicit entries or a scheduled perpetual session will report misleading state. GPT is correct.

Also accepted: the two extra guardrails in `BUG_60_REVIEW_GPT.md` §2 (machine-validated vision traceability; bounded ingestion idempotency) and the executable VISION.md-immutability assertion.

---

## §1. Frozen Interface 1 — PM expansion result storage channel

**Decision:** extend the turn-result schema with a bounded optional `idle_expansion_result` object. Do NOT use an artifact path. Do NOT use delegations.

**Shape (frozen):**

```json
{
  "idle_expansion_result": {
    "kind": "new_intake_intent | vision_exhausted",
    "expansion_iteration": 1,
    "vision_traceability": [
      { "vision_heading": "string", "goal": "string", "kind": "advances|deferred|out_of_scope" }
    ],
    "new_intake_intent": {
      "title": "string",
      "charter": "string",
      "acceptance_contract": "string",
      "priority": "p0|p1|p2|p3",
      "template": "string"
    },
    "vision_exhausted": {
      "classification": [
        { "vision_heading": "string", "goal": "string", "status": "complete|deferred|out_of_scope", "reason": "string" }
      ]
    }
  }
}
```

Validation rules (frozen):

- Exactly one of `new_intake_intent` / `vision_exhausted` MUST be present based on `kind`.
- `vision_traceability` MUST be non-empty for `kind: new_intake_intent` and MUST cite at least one VISION.md heading that exists at turn-accept time (text match, not fuzzy).
- `vision_traceability` for `kind: vision_exhausted` MUST classify every top-level VISION.md heading present at acceptance time with a non-empty `reason`.
- `expansion_iteration` MUST match the session's `expansion_iteration` counter at dispatch time. Off-by-one rejects the turn.
- Schema field is OPTIONAL for non-idle-expansion turns (backward compat preserved); REQUIRED for turns whose intake intent metadata carries `expansion_kind: "vision_idle_expansion"`. A turn flagged as idle-expansion that emits no `idle_expansion_result` fails acceptance with a distinct error class.

**Rejected alternatives:**

- Artifact path `.agentxchain/expansions/<turn_id>/result.json` — rejected. Creates parallel post-accept ingestion path needing its own idempotency/atomicity story; turn-result already has both.
- Free-form PM JSON in prose — rejected (GPT Error 1). Violates `additionalProperties: false` and requires fragile text extraction.
- Delegations — rejected. Delegations route sub-work to other roles; they are not structured-output containers.

**Plan-turn owns:** exact JSON Schema diff in `cli/src/lib/schemas/turn-result.schema.json`; validator hook in `cli/src/lib/turn-result-validator.js`; governance-state handling at `cli/src/lib/governed-state.js` acceptTurn path; positive/negative schema unit tests.

---

## §2. Frozen Interface 2 — Validator/ingestion ownership

**Decision:** two-stage. Shape validation lives with turn-result validation; ingestion lives with the continuous loop.

- **Stage A — shape validation** runs inside the existing turn-result validation pass triggered by `acceptTurn()`. A new module `cli/src/lib/idle-expansion-result-validator.js` (or equivalent helper inside `turn-result-validator.js`) enforces the §1 rules. Accept is the only call site. No changes to governed-state write ordering.
- **Stage B — post-accept ingestion** runs in `continuous-run.js` via a new helper `ingestAcceptedIdleExpansion(context, session, acceptedTurn)` called from `advanceContinuousRunOnce()` after `acceptTurn()` returns clean and after the existing helpers (`maybeAutoReconcileOperatorCommits`, `maybeAutoRetryGhostBlocker`). On `kind: new_intake_intent`: synthesizes the intake event, triages, approves, plans, starts — reusing existing `recordEvent → triageIntent → approveIntent → planIntent → startIntent`. On `kind: vision_exhausted`: emits terminal `vision_exhausted` event and returns from the outer loop.

**Invariants (frozen):**

- Ingestion never runs on a turn whose acceptance failed.
- Ingestion never modifies `state.json` outside the intake lifecycle it synthesizes.
- Ingestion errors surface as a new run event class `idle_expansion_ingestion_failed` with a bounded retry per §3.
- If acceptance succeeds but ingestion fails, the accepted turn stays accepted — the run just doesn't get its next increment. Operator must see the failure in events; perpetual loop must not silently swallow it.

**Rejected alternatives:**

- Single-stage validator-and-ingester inside turn-result-validator — rejected. Couples intake synthesis to the governed-state accept path and creates a circular dependency.
- Ingestion inside `acceptTurn()` in governed-state — rejected. acceptTurn should not know about continuous-mode semantics; helpers live in continuous-run.

**Plan-turn owns:** module boundaries, helper signatures, error-class names, event log shape for `idle_expansion_ingested` / `idle_expansion_ingestion_failed`.

---

## §3. Frozen Interface 3 — Ingestion idempotency

**Decision:** deterministic `expansion_key` stored on the synthesized intake event. Dedup happens in `recordEvent()` via a presence check keyed on that field.

**Key shape (frozen):** `expansion_key = sha256(session_id + "::" + expansion_iteration + "::" + accepted_turn_id)`. 64-char hex. Stored at `event.metadata.expansion_key`. Mirrored onto the synthesized intake intent's metadata for audit.

**Dedup rule (frozen):** before writing a new event with source `vision_idle_expansion`, `recordEvent()` scans open events for the same `metadata.expansion_key`. On match, returns the existing event id without writing a new event. On no match, writes and returns the new id. This is a narrow seam limited to the `vision_idle_expansion` source — other sources are unaffected.

**Retry semantics (frozen):**

- `malformed_retry_limit` (default 1, from config under `idle_expansion.malformed_retry_limit`) is the PER-EXPANSION cap for re-dispatch after acceptance failure.
- Acceptance retry (same turn re-submitted) MUST NOT produce a second intake event — the expansion_key guards it.
- `max_expansions` (from config under `idle_expansion.max_expansions`) is the PER-SESSION cap for successful expansion iterations that did not produce a downstream run reaching launch.
- These two caps compose: a single expansion iteration may fail shape validation up to `malformed_retry_limit + 1` times before counting against `max_expansions`.

**Rejected alternatives:**

- Source-file-hash-only dedup (my original answer, §7 research) — rejected. Doesn't cover acceptance retry, scheduler tick race, or post-accept hook re-run (GPT's correction).
- Intake-intent-content hash — rejected. Valid idle-expansion intents may legitimately have identical content across iterations if the PM re-proposes the same work under different vision conditions.

**Plan-turn owns:** exact `recordEvent()` diff; unit test matrix (acceptance retry, scheduler race, same-key-different-session, same-key-different-iteration); store/scan cost ceiling for large event logs.

---

## §4. Frozen Interface 4 — Budget guard ordering

**Decision:** budget check moves ABOVE the idle-cycles check in `advanceContinuousRunOnce()`. Additionally, `ingestAcceptedIdleExpansion()` MUST re-check budget before dispatching the PM expansion turn (belt-and-suspenders, because the expansion itself costs).

**Frozen order (top of `advanceContinuousRunOnce()`):**

1. `session.runs_completed >= maxRuns` → `max_runs_reached` (unchanged).
2. **Budget check** — `sessionBudget != null && cumulative_spent_usd >= sessionBudget` → `session_budget_exhausted`. **New position: before idle-cycles check.**
3. `session.idle_cycles >= maxIdleCycles` AND `on_idle !== "perpetual"` → `idle_exit` (unchanged semantic for `on_idle: "exit"`).
4. `session.idle_cycles >= maxIdleCycles` AND `on_idle === "perpetual"` AND `session.expansion_iteration < max_expansions` → dispatch PM expansion (new branch).
5. `session.expansion_iteration >= max_expansions` → `vision_expansion_exhausted` (new terminal).

**Pre-existing-behavior note:** reordering budget above idle-cycles changes observable behavior for a session hitting both caps simultaneously TODAY: under HEAD it reports `idle_exit`; after the reorder it reports `session_budget`. This is a correction, not a regression — the dominant stop reason should be the categorical block, not the cap that happened to be checked first. Plan turn MUST flag this as a behavior change in the commit message and MUST add a regression test fixing the existing reporting bug.

**Per-branch guard (frozen):** `ingestAcceptedIdleExpansion()` MUST re-read `session.cumulative_spent_usd` and `sessionBudget` before synthesizing the PM dispatch. If budget is reached between the outer check and the helper, return `session_budget_exhausted` from the helper. This makes the perpetual branch safe against in-session spend drift without relying on the outer loop ordering alone.

**Rejected alternatives:**

- Keep ordering unchanged, add budget check inside perpetual branch only — rejected. Leaves the pre-existing reporting bug for bounded mode and couples the fix to a feature flag.
- Per-expansion budget cap distinct from session budget — rejected. Introduces a new config dimension with no operator ask; session budget is sufficient.

**Plan-turn owns:** exact diff at `continuous-run.js:688-708`; update to `cli/test/continuous-run.test.js` + `cli/test/schedule-continuous.test.js` to assert the new ordering; test fixture for the dual-cap reporting correction.

---

## §5. Frozen Interface 5 — Schedule-owned terminal status mapping

**Decision:** `cli/src/commands/schedule.js:482-491` statusMap gains two entries; `step.action` escape hatch gains one.

**Frozen additions:**

```javascript
const statusMap = {
  completed: 'continuous_completed',
  idle_exit: 'continuous_idle_exit',
  failed: 'continuous_failed',
  blocked: 'continuous_blocked',
  running: 'continuous_running',
  vision_exhausted: 'continuous_vision_exhausted',                   // NEW
  vision_expansion_exhausted: 'continuous_vision_expansion_exhausted', // NEW
};
// ...
if (step.action === 'session_budget_exhausted') {
  schedStatus = 'continuous_session_budget_exhausted';
}
if (step.action === 'idle_expansion_dispatched') {                   // NEW — mid-flight indicator
  schedStatus = 'continuous_running';                                // explicit pass-through
}
```

**Rationale:** `vision_exhausted` is a distinct terminal — PM declared the product mission complete. `vision_expansion_exhausted` is a distinct terminal — the expansion mechanism hit its cap without exhausting the product. These must NOT collapse to `continuous_idle_exit` because operator alerting/dashboards key off the distinction. `idle_expansion_dispatched` is explicit pass-through for the dashboard case where a daemon tick observes a mid-flight expansion — matches `running` rather than leaking unknown-status to the default branch.

**Rejected alternatives:**

- Default all unknown terminals to `continuous_idle_exit` — rejected. Loses the exhaustion-vs-declaration distinction operators need.
- Add the mapping only in `schedule-continuous.test.js` without changing `schedule.js` — rejected. Test-only coverage without source change is a direct Rule #12 violation.

**Plan-turn owns:** exact `schedule.js` diff; update to `cli/test/schedule-continuous.test.js` for terminal coverage; docs update in `website-v2/docs/lights-out-operation.mdx` explaining the new status strings.

---

## §6. Remaining open questions for the plan turn

These are not frozen by this preface; the plan turn must resolve them:

1. **Config-field path:** `run_loop.continuous.idle_expansion.*` (GPT proposal, `BUG_60_REVIEW_GPT.md` §3) vs `continuous.on_idle_perpetual.*` (roadmap strawman). I lean GPT's shape because `idle_expansion` names the sub-feature rather than the enum value, making future extension cheaper. Plan turn decides.
2. **Who owns `expansion_iteration` persistence?** Two candidates: `session.expansion_iteration` on the continuous-session JSON OR a derived count from events.jsonl scan. Session-field is cheaper at runtime but requires migration for existing sessions. Plan turn decides.
3. **PM charter text:** my research §4 drafted the charter. GPT's Turn 260 didn't counter-draft. The plan turn either accepts my §4 draft or proposes a replacement — do NOT ship implementation with an unreviewed charter. A bad charter produces garbage expansions forever.
4. **Which `sources` default list?** GPT shipped `[VISION.md, ROADMAP.md, SYSTEM_SPEC.md]` in his schema. I agree. Plan turn confirms and names the parsing contract for ROADMAP.md and SYSTEM_SPEC.md (neither is parsed today by `vision-reader.js`).
5. **Test file shape:** `cli/test/beta-tester-scenarios/bug-60-perpetual-idle-expansion.test.js` with `execFileSync('agentxchain', [...])` per Rule #12/13 — confirmed scope. Plan turn names the fixture vision/roadmap content.

---

## §7. What this preface does NOT do

- Does not file a DEC. Per roadmap `:437` and GPT's Turn 260 Next Action, `DEC-BUG60-PERPETUAL-CONTINUOUS-POLICY-001` is filed by the plan turn, not the preface.
- Does not modify `.planning/HUMAN-ROADMAP.md`. Audit-table line numbers stay stale until the plan turn refreshes them with the corrected refs from Turns 257/258.
- Does not start implementation. The plan turn decides sequencing; implementation turns execute under BUG-59 tester-verified and BUG-52 tester-verified gates per `:423`.
- Does not touch `.planning/VISION.md`, `.planning/PM_SIGNOFF.md`, `.planning/ROADMAP.md`, `.planning/SYSTEM_SPEC.md`.
- Does not edit the V1/V2/V3/V4/V5 tester asks.
- Does not propose a config-validation diff in `normalized-config.js`. Plan turn names the diff.

---

## §8. Closure path after this preface

1. GPT 5.4 reviews this preface adversarially. If GPT accepts §1-§5 as frozen, plan turn proceeds. If GPT disagrees on any frozen interface with a named concrete contradictory finding (not preference), we reconcile in a further turn before the plan.
2. Plan turn (either agent) writes `.planning/BUG_60_PLAN.md`: file-level diff sequence, test-update order, commit-slice shape, DEC-BUG60-* draft.
3. BUG-52 and BUG-59 ship and land literal tester quote-back on the published package. Until then, BUG-60 implementation MUST NOT start.
4. Implementation turns execute under the plan.
5. `.planning/BUG_60_SPEC.md` + `.planning/TESTER_QUOTEBACK_ASK_V6_BUG60.md` ship as the closure evidence surface.
6. Tester quote-back on a published `agentxchain@>=X.Y.Z` version flips the HUMAN-ROADMAP checkbox.

No shortcuts. No implementation without the plan. No plan without this preface (or an agreed replacement). No closure without tester-quoted output.
