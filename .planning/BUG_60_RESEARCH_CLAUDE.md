# BUG-60 Pre-work Research — Claude Opus 4.7

> **Tag:** `BUG-60-RESEARCH-CLAUDE`
> **Author:** Claude Opus 4.7, Turn 259
> **Status:** Documentation-only pre-work pass. No implementation. No source files modified.
> **HEAD at write:** `e7d2e08b docs(bug-60): review audit drift gate`
> **Cross-references:**
> - `.planning/BUG_60_AUDIT_TABLE_DRIFT_CLAUDE.md` (Turn 257) — corrected audit table
> - `.planning/BUG_60_AUDIT_TABLE_DRIFT_GPT_REVIEW.md` (Turn 258) — pre-work-gate concession + three-way prompt-routing challenge
> - `.planning/HUMAN-ROADMAP.md:260-462` — BUG-60 roadmap entry
> - `.planning/AGENT-TALK.md` Turns 255-258 — pre-work-gate disagreement + concession

This artifact answers the seven research items in HUMAN-ROADMAP `:386-398` (Pre-work turn A). It does NOT propose code changes, does NOT pick the final config schema, and does NOT modify any of the BUG-60 implementation surfaces (`continuous-run.js`, `vision-reader.js`, `intake.js`, `normalized-config.js`).

---

## §1. Audit-table verification

Already done in `.planning/BUG_60_AUDIT_TABLE_DRIFT_CLAUDE.md` Turns 257 (Claude) + 258 (GPT review). Net result: roadmap audit table line numbers drifted by ~346 lines on `continuous-run.js` (BUG-53/61/62 shipped between audit-write and now). All other surfaces (vision-reader, intake, dispatch-bundle) materially unchanged.

The two implications I'm carrying forward:

1. **Two idle-cycle increments exist** (`continuous-run.js:880-881` for `seeded.idle`; `:889` for `triage_approval === 'human'` `waited_for_human`). The perpetual branch must target the `seeded.idle` class only — `waited_for_human` is a different idle class (work derived, gated on a human) where PM-expanding more queue depth doesn't help.
2. **`prepareIntentForDispatch()` already accepts a `role` option** (`intake.js:735-741`, threaded into `startIntent({role})`). This is critical for the prompt-routing decision in §3.

---

## §2. Option A (intake pipeline) vs Option B (direct dispatch) — pick

**Pick: Option A** (recordEvent → triage → approve → plan → start). Justification:

| Criterion | Option A — intake pipeline | Option B — direct dispatch |
|---|---|---|
| Event audit trail | Native — `events.jsonl` records `vision_idle_expansion` source | Requires bespoke synthetic event |
| Re-uses existing state machine | Yes — `detected → triaged → approved → planned → executing` | No — special-case path beside `advanceContinuousRunOnce()` |
| Cost in `intake.js` | One-line addition to `VALID_SOURCES` (`:32`) | None |
| Cost in `continuous-run.js` | One new helper `maybeExpandViaPM()` mirroring `maybeAutoReconcileOperatorCommits()` / `maybeAutoRetryGhostBlocker()` | New code path that bypasses intake; risk of state divergence |
| Test surface | Extends existing intake/continuous test patterns | Brand-new harness needed |
| Governance posture | Every expansion is a first-class auditable intent operators can inspect via `agentxchain intake list` | Hidden side-effect of continuous loop |
| BUG-62 reconcile interaction | Free — already tested for intake-driven runs | Needs new wiring |
| BUG-61 ghost-retry interaction | Free — already tested for intake-driven runs | Needs new wiring |

**Option B's only advantage** (one fewer indirection layer) is dwarfed by Option A's audit/state-machine wins. Reject Option B.

---

## §3. Three-way prompt-routing challenge (GPT Turn 258)

GPT's adversarial review (Turn 258, `.planning/BUG_60_AUDIT_TABLE_DRIFT_GPT_REVIEW.md:38-44`) demanded the research turn compare three prompt-routing choices, not pre-pick the dedicated-role path. Compared with evidence:

### Choice 1 — Dedicated `pm_idle_expansion` role

- **Plumbing:** new entries in `config.roles.pm_idle_expansion`, `config.prompts.pm_idle_expansion`, `.agentxchain/prompts/pm-idle-expansion.md`, runtime mapping (likely re-use `pm`'s runtime), routing, scaffold generator update in `init.js`. `prepareIntentForDispatch({role: 'pm_idle_expansion'})` works because `resolveIntakeRole()` at `intake.js:1142-1148` already accepts validated role overrides.
- **Audit trail:** strong — turn metadata carries `role: pm_idle_expansion` distinct from normal PM turns.
- **Backwards compat risk:** projects with custom `config.roles` overrides must add the new role; absent it, idle-expansion fails with `unknown role` error from `intake.js:1144`.
- **Cost class:** medium. Touches config validator, role catalog, scaffold, and at least three test files.

### Choice 2 — Keep role `pm` + per-dispatch prompt/mandate override

- **Plumbing:** new mutation seam in `dispatch-bundle.js:184-205` (`renderPrompt()` currently reads from static `config.prompts?.[roleId]`) — must accept a per-call override parameter and thread it through `prepareDispatchBundle()` callers.
- **Audit trail:** weak — turn metadata says `role: pm`; only continuous-run logs distinguish idle-expansion turns from normal PM turns.
- **Backwards compat risk:** none for projects (no config change), but introduces a new code seam everywhere prompt rendering happens.
- **Cost class:** medium-high. Changes a stable interface used by every dispatch.

### Choice 3 — Keep role `pm` + carry idle-expansion instruction in intake charter / acceptance_contract

- **Plumbing:** synthesize the intake intent in `maybeExpandViaPM()` with a charter literal that says *"You are operating in idle-expansion mode. Read VISION+ROADMAP+SYSTEM_SPEC. Output: a structured new intake intent OR a vision_exhausted declaration. Do NOT modify VISION.md."* Existing PM prompt sees this via the standard CONTEXT.md / charter rendering path; no `dispatch-bundle.js` change needed; no role catalog change needed.
- **Audit trail:** strong via `event.source = 'vision_idle_expansion'` + `intent.metadata.expansion_iteration` + structured charter text. `agentxchain intake list` surfaces these distinctly.
- **Backwards compat risk:** none.
- **Cost class:** low. Zero changes to `dispatch-bundle.js` / role catalog / runtime registry. The only new surfaces are: one-line `VALID_SOURCES` extension + `maybeExpandViaPM()` helper + a charter template constant.

### Recommendation: Choice 3 primary, Choice 1 as documented fallback

**Choice 3 wins on cost-vs-benefit:**

1. Lowest code-surface delta (no `dispatch-bundle.js` change, no role catalog change, no runtime registry change, no scaffold-generator change).
2. Audit identity is preserved through `event.source` + `intent.metadata.expansion_iteration` rather than role name. `agentxchain intake list` and `events.jsonl` make idle-expansion intents visually distinct.
3. The "PM doesn't know it's an idle-expansion turn" risk GPT might cite is mitigated by the charter literally telling it so. The PM prompt already says "Read the previous turn (from CONTEXT.md). Understand what was done." (`.agentxchain/prompts/pm.md:7`) — charter content drives PM behavior in the existing prompt design.
4. Migration to Choice 1 stays cheap: if a future governance requirement (e.g., "all idle-expansion turns must use a budget-restricted runtime") demands a distinct role identity, add the role then. Choice 3 doesn't preclude Choice 1.

**Reject Choice 2** outright: introduces a new mutation seam in `renderPrompt()` for no audit-trail benefit Choice 3 doesn't already deliver.

**Document Choice 1 as fallback** in case the plan turn or GPT's review (Pre-work turn B) surfaces a concrete reason the charter-carried instruction is insufficient (e.g., per-runtime override, per-role budget cap, role-scoped tool restrictions).

---

## §4. Full PM idle-expansion charter draft

Charter content for the synthesized intake intent (Option A + Choice 3). Embedded as a constant in the eventual `maybeExpandViaPM()` helper. Renders into the standard CONTEXT.md path and is read by the unmodified PM prompt at `.agentxchain/prompts/pm.md`.

```text
# Idle-Expansion Charter (BUG-60 perpetual continuous mode)

You are running in IDLE-EXPANSION mode. The continuous loop has detected that
the current intake queue is empty AND vision-derived candidates are exhausted.
Your task is to synthesize the next increment from broader product sources.

## Read (in order)

1. .planning/VISION.md       (READ-ONLY — never modify; immutable per WAYS-OF-WORKING)
2. .planning/ROADMAP.md      (mutable — you may propose updates as part of your output)
3. .planning/SYSTEM_SPEC.md  (mutable — you may propose updates as part of your output)
4. .agentxchain/intake/      (review completed/active intents to avoid duplication)
5. .planning/acceptance-matrix.md (cross-check what's verified vs gaps)

## Produce EXACTLY ONE of these two outputs

### Output schema A — `new_intake_intent`

A JSON block with these required fields:

```json
{
  "type": "new_intake_intent",
  "expansion_iteration": <integer matching the iteration counter from CONTEXT.md>,
  "intent": {
    "priority": "p0|p1|p2|p3",
    "template": "<one of the registered intake templates>",
    "charter": "<one paragraph: the work to do and why>",
    "acceptance_contract": "<one paragraph of testable assertions>",
    "vision_traceability": "<which VISION.md section/goal this advances>"
  },
  "rationale": "<one paragraph explaining why this is the next increment>"
}
```

### Output schema B — `vision_exhausted`

A JSON block declaring the product vision is satisfied:

```json
{
  "type": "vision_exhausted",
  "expansion_iteration": <integer matching the iteration counter from CONTEXT.md>,
  "completed_vision_goals": ["<goal 1>", "<goal 2>", ...],
  "deferred_vision_goals": [{"goal": "<goal>", "reason": "<why deferred>"}],
  "rationale": "<one paragraph defending the exhaustion claim>"
}
```

## Constraints

- Do NOT modify .planning/VISION.md under any circumstances.
- Do NOT propose work outside the vision's scope. If you cannot find next-increment work that traces to VISION.md, output `vision_exhausted` instead of inventing scope.
- Do NOT produce free-form text outside the JSON block. Anything else fails acceptance.
- Do NOT produce an intent whose acceptance_contract is unverifiable.
```

Charter is acceptance-failure-tolerant: malformed output → re-dispatch once, then escalate per safeguard #2 in roadmap `:332-336`.

---

## §5. Perpetual-mode trace

Scenario: project has VISION.md with three goals; goals 1-2 satisfied via two prior runs; goal 3 not yet derived; `--continuous --on-idle perpetual --max-runs 10 --max-idle-cycles 3 --max-idle-expansions 5`.

```
T0  loop tick → advanceContinuousRunOnce(session)
T1  session.runs_completed = 2 < maxRuns (10): pass
T2  session.idle_cycles = 3 >= maxIdleCycles (3): branch
    -- BOUNDED MODE: would have set session.status='completed', returned 'idle_exit'
    -- PERPETUAL MODE: branch into maybeExpandViaPM()
T3  maybeExpandViaPM checks expansion_iteration (currently 0) vs max_idle_expansions (5): pass
T4  maybeExpandViaPM reads VISION/ROADMAP/SYSTEM_SPEC source content
T5  maybeExpandViaPM hashes source content (for dedup) and renders charter from §4 template
T6  recordEvent({
        source: 'vision_idle_expansion',
        signal: {
          sources_hash: '<sha256>',
          expansion_iteration: 1,
          previous_runs_completed: 2,
          captured_at: <ISO>
        }
      }) → returns evt_id
T7  triageIntent(evt_id) → priority='p1', template='idle-expansion', charter from §4
T8  approveIntent(intent_id) → cross_run_durable=true (current run completed)
T9  planIntent(intent_id) → generates standard planning artifacts (PM turn target)
T10 startIntent(intent_id) → assigns PM turn (role='pm', charter rendered into CONTEXT.md)
T11 maybeExpandViaPM emits 'pm_idle_expansion_dispatched' event; returns
    { ok:true, status:'running', action:'expanded_via_pm', intent_id, expansion_iteration:1 }
T12 session.idle_cycles reset to 0; session.expansion_iterations = 1
T13 control returns to continuous outer loop; next tick:
T14 advanceContinuousRunOnce sees active turn → dispatches PM via standard path
T15 PM processes charter → outputs JSON (schema A: new_intake_intent for goal 3)
T16 turn completes → coordinator records output → next role kicks in (per routing)
... goal 3 work proceeds through phases ...
T17 run completes; session.runs_completed = 3
T18 next tick: queue may be empty or full; loop continues until maxRuns/budget/exhausted
```

**Divergence points to validate during plan turn:**

- T6 dedup: if `sources_hash` matches a recent expansion event, do we emit anyway (re-derive) or skip? Recommend emit-anyway with a counter; vision/roadmap/spec content rarely changes between expansions, so dedup-skip would always trigger after first iteration. Better: gate via `expansion_iteration` cap.
- T8 cross_run_durable: confirm `approveIntent()` at `intake.js:817-829` correctly stamps `cross_run_durable: true` when `state.run_id` is absent (current run terminated). This branch already exists for the standard pre-run case and re-uses cleanly.
- T15 acceptance: PM output validation must catch malformed JSON (no recovery from raw text). Acceptance check should be a separate concern from the PM turn — likely a small validator in `maybeExpandViaPM()`'s post-completion hook.

---

## §6. Test-update map

Tests that must change (update or extend, not break):

| Test file | Change | Reason |
|---|---|---|
| `cli/test/beta-tester-scenarios/bug-60-perpetual-idle-expansion.test.js` | **NEW** — positive (perpetual chain succeeds) + negative (max_idle_expansions cap, malformed PM output, budget-cap-during-expansion) | Rule #13 + roadmap acceptance |
| `cli/test/continuous-run.test.js` | Extend with `on_idle` config-shape tests (default 'exit' for back-compat, 'perpetual' opt-in, 'human_review' if shipped) | Schema validation |
| `cli/test/normalized-config.test.js` (or wherever continuous config is validated) | Add `on_idle` enum + nested `on_idle_perpetual` block validation | Validator coverage |
| `cli/test/vision-reader.test.js` | NO change if Choice 3 holds (vision-reader stays VISION.md-only). Only changes if we extend `deriveVisionCandidates` to read ROADMAP/SYSTEM_SPEC — but Choice 3 puts that responsibility on the PM via charter, not on vision-reader. | Confirm scope |
| `cli/test/intake.test.js` | Extend `VALID_SOURCES` test to include `'vision_idle_expansion'` | One-line addition |
| `cli/test/continuous-3run-proof-content.test.js` | Verify regression: bounded mode (default `on_idle: 'exit'`) still idle-exits identically | Back-compat floor |
| `cli/test/beta-tester-scenarios/bug-53-continuous-auto-chain.test.js` | Verify the seven-key `session_continuation` payload contract (Turn 234 lock) is unchanged in bounded mode | BUG-53 contract preservation |
| `cli/test/dispatch-bundle.test.js` | NO change if Choice 3 holds (dispatch-bundle untouched) | Confirm scope |

Tests that must NOT change (negative scope discipline):

- Any BUG-54/61/62 test (not implicated)
- Any spec/roadmap/llms drift guard (not implicated)
- BUG-59 approval_policy gate-coupling tests (BUG-60 inherits the contract; doesn't redefine it)

---

## §7. Four specific roadmap questions (HUMAN-ROADMAP `:393-397`)

### Q (a): Can a PM turn dispatched via Option A carry a prompt override, or does it always use the static PM prompt? If not, which intake field or dispatch mechanism would need to be added?

**Yes, with two viable mechanisms.** First, `prepareIntentForDispatch()` at `intake.js:735-741` accepts a `role` option and threads it into `startIntent({role})`. `resolveIntakeRole()` at `intake.js:1142-1148` validates the role exists in `config.roles` and accepts it. So Choice 1 (dedicated `pm_idle_expansion` role) is feasible without new plumbing on the dispatch side — it requires new config + scaffold work but no new code surface in dispatch.

Second, no override is needed at all under Choice 3: the charter content carries the idle-expansion mandate, the existing PM prompt renders it via the standard CONTEXT.md path. **My recommendation (§3) is Choice 3** — answers the "no override needed" form of the question.

### Q (b): Does `per_session_max_usd` enforcement at `continuous-run.js:354-362` (now `:700-708`) fire BEFORE or AFTER a PM idle-expansion would dispatch?

**BEFORE.** Order at `:688-708` (verified in `BUG_60_AUDIT_TABLE_DRIFT_CLAUDE.md` Implication 4):

```
1. maxRuns check    (:688-692)
2. maxIdleCycles    (:694-697)  ← perpetual branch insertion point
3. sessionBudget    (:700-708)
```

If the perpetual branch is inserted at step 2 (replacing or wrapping the bounded `idle_exit`), step 3 still fires on the NEXT loop tick. Budget cap is preserved without new plumbing. Safeguard #2 from roadmap `:332-336` ("Honor existing `per_session_max_usd`") is satisfied automatically.

### Q (c): What happens today if `deriveVisionCandidates()` is called with VISION.md deleted or malformed? Is the error path resilient?

**Resilient on the read path; fails on continuous-loop entry.** `deriveVisionCandidates()` at `vision-reader.js:177-194`:

- Missing file → `{ ok: false, candidates: [], error: 'VISION.md not found at <path>...' }`
- Read error → `{ ok: false, candidates: [], error: 'Cannot read VISION.md: <msg>' }`
- Empty/no-sections file → `{ ok: false, candidates: [], error: 'VISION.md has no extractable sections.' }`

`continuous-run.js:851-855` catches missing-VISION before vision derivation runs and sets `session.status = 'failed'`. `:872-877` catches `seedFromVision` errors and also sets failed.

**For perpetual mode:** the existing fail-fast posture is the right default. Perpetual mode does not enable scope-creation outside VISION.md. If VISION.md is missing/malformed, perpetual-mode dispatch should not paper over that — it must surface the same failure. Document in the eventual implementation that perpetual mode REQUIRES a valid VISION.md exactly as bounded mode does.

### Q (d): BUG-59 overlap check: if BUG-59 ships approval_policy coupling and a PM-synthesized increment's qa_ship_verdict gate is configured to auto-approve, does the perpetual chain survive run-to-run cleanly?

**Yes, with one explicit dependency.** The perpetual chain depends on gate closure for run N to terminate cleanly so run N+1 can start. If BUG-59's approval_policy auto-approval lane is unfixed, the second PM-synthesized run will stall at qa_ship_verdict awaiting human approval that the project's auto-approval policy promised would happen automatically.

This is precisely why HUMAN-ROADMAP `:262` and `:454` gate BUG-60 implementation on BUG-59 shipped + tester-verified. The dependency is real and confirmed.

**Race check:** the gate-closure event handler in `governed-state.js` and the next-run-start in `continuous-run.js` operate in serial within `advanceContinuousRunOnce()`'s single-step model — no concurrent path between them. Run N's gate must close (via approval_policy or human action) before `runs_completed += 1` at `:1041`, which happens before the next tick's queue check. No race.

---

## §8. Summary for Pre-work turn B (GPT 5.4)

What this turn settled:

- **Picked Option A** (intake pipeline) over Option B (direct dispatch) with evidence.
- **Picked Choice 3** (charter-carries-instruction) over Choice 1 (dedicated role) and Choice 2 (per-dispatch override). Choice 1 documented as fallback.
- **Drafted the full PM idle-expansion charter** (§4).
- **Traced perpetual-mode end-to-end** with code-cited transitions (§5).
- **Mapped tests that change vs tests that must not change** (§6).
- **Answered all four roadmap questions** (§7).

What this turn did NOT settle (open for GPT's review and the eventual plan turn):

- Final config schema (`on_idle: "exit" | "perpetual" | "human_review"` is the strawman; field names, defaults, and nested `on_idle_perpetual` shape need adversarial review).
- `max_idle_expansions` default value (roadmap proposes 5; not yet justified empirically).
- Naming of the new helper (`maybeExpandViaPM` vs `maybePerpetualExpand` vs other).
- Source-hash dedup policy (§5 T6 divergence point).
- PM output JSON validator location and re-dispatch policy on malformed output.
- Whether Choice 1 should be promoted to primary based on a use case the research turn missed.

What GPT's review (Pre-work turn B) MUST do per HUMAN-ROADMAP `:400-421`:

1. Adversarial review of this research — find at least one factual error or missed path (especially in §3, §5, or §7).
2. Challenge the four guardrails in roadmap `:325-339` — specifically: what prevents a PM turn from producing an intent that describes work OUTSIDE the project's vision (scope creep via idle-expansion)? Is vision-coherence itself a required PM acceptance check? My charter (§4) includes "Do NOT propose work outside the vision's scope" but enforcement is on the PM's honor — GPT should propose a concrete enforcement mechanism if that's insufficient.
3. Independent config schema proposal — compare against the strawman.
4. Acceptance matrix for perpetual mode — fill in the nine rows from roadmap `:407-417`.
5. Verify the BUG-59 dependency is genuine — my §7(d) says yes; GPT must independently trace.
6. Reconciliation if we disagree on any material point.

What this turn explicitly did NOT do:

- Did not propose any code change.
- Did not modify `cli/src/lib/continuous-run.js` / `vision-reader.js` / `intake.js` / `normalized-config.js` (forbidden during pre-work per roadmap `:423`).
- Did not modify `.planning/VISION.md` (vision rule).
- Did not modify `.planning/PM_SIGNOFF.md` / `.planning/ROADMAP.md` / `.planning/SYSTEM_SPEC.md` (pre-existing dirty human/scaffold work).
- Did not modify `.planning/HUMAN-ROADMAP.md` (audit-table line numbers stay stale until plan turn).
- Did not flip any HUMAN-ROADMAP checkbox.
- Did not file any DEC (premature; plan turn files `DEC-BUG60-PERPETUAL-CONTINUOUS-POLICY-001` per roadmap `:437`).
- Did not edit V1/V2/V3/V4/V5 tester asks.
- Did not start BUG-60 implementation.
- Did not cut a release or post to social.
