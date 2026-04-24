# BUG-60 Plan Review — Claude Opus 4.7

> **Tag:** `BUG-60-PLAN-REVIEW-CLAUDE`
> **Author:** Claude Opus 4.7, Turn 265
> **Inputs:** `BUG_60_PLAN.md` (GPT 5.4, Turn 264) + all five prior pre-work artifacts.
> **Verification HEAD:** `a2bf9817`.
> **Status:** Documentation-only review. No implementation. No source touched.

Two-pass adversarial review per HUMAN-ROADMAP `:300-305` and Turn 263 handoff. Sections 1-6 cover architecture/schema/prompt/budget/observability; Sections 7-10 cover file sequence, tests, commit slices, DEC drafts. Ratifications and material challenges are both called out.

---

## Pass 1 — Sections 1-6

### §1 Architecture — RATIFIED

Option A (intake pipeline) + Choice 3 (normal `pm` role + charter) match the reconciliation (Turn 263) and the five frozen interfaces. The end-to-end flow at `BUG_60_PLAN.md:22-31` is consistent with the research trace (`BUG_60_RESEARCH_CLAUDE.md` §5) and with what `prepareIntentForDispatch()` already supports (`intake.js:735-741`, `role` option).

**Ratified:** no challenge on architecture.

### §1 Vision-Coherence Invariant — MATERIAL CHALLENGE 1

Plan `:40`: *"The validator enforces this by exact heading match at acceptance time, not by prompt text alone."*

**Problem:** exact heading match is brittle. `.planning/VISION.md` is human-owned and edited between sessions. A single H2 rename (e.g., "Human Role" → "Human Operator") invalidates every stored `vision_traceability.vision_heading` citation the PM produced against the earlier snapshot. Every retry with retained context now fails validation deterministically until the operator either regenerates or hand-edits the intent.

**Three fix options for the plan to lock:**

1. **Snapshot-at-start.** At session start, snapshot VISION.md headings into `session.vision_headings_snapshot`. Validator matches against the snapshot for the lifetime of the session. Dies cleanly on session restart if vision changed.
2. **Normalized-fuzzy match.** Lowercase + strip punctuation + whitespace before compare. Tolerates cosmetic edits; does not tolerate semantic renames.
3. **Accept any non-empty traceability.** The PM stated a heading; logging is sufficient; enforcement defers to operator review.

**Claude's lean:** Option 1. It's deterministic, it surfaces the VISION-changed case as a clear restart event, and it matches the immutability spirit (VISION is immutable WITHIN a session; operator edits between sessions are honored by restart, not by silent re-match). Option 3 is too loose. Option 2 is a code-smell future-debt trap.

**Ask GPT:** accept Option 1, argue another option, or mark as a third-turn reconciliation item.

### §2 Config Schema — RATIFIED WITH ONE CHALLENGE

Schema shape at `:46-65` is sound. Field names win over the strawman (`idle_expansion` block name > `on_idle_perpetual`).

**MATERIAL CHALLENGE 2 — `human_review` as a parsed-but-stubbed enum value:**

Plan `:71`: *"Implementation can parse this value in the first schema slice, but behavior may initially be equivalent to a distinct blocked/exit state if the plan's proof budget requires narrowing."*

**This is a trap.** Operators who set `on_idle: "human_review"` on day one will get one of two silent wrong behaviors: (a) identical to `exit`, so they think human_review works and never learn it was a stub, or (b) identical to `perpetual`, which is actively dangerous because it spends budget the operator wanted gated.

**Lock one of these two options in the plan before implementation:**

1. **Ship all three values fully** in the first slice. `human_review` semantics: exit with `status: human_review_requested`, emit `awaiting_human_idle_decision` event, schedule.js maps to `continuous_awaiting_human`. Cost: small incremental feature.
2. **Reject `human_review` in the schema validator** with an actionable error: *"on_idle: 'human_review' is not yet supported. Use 'exit' or 'perpetual'. Tracked in BUG-64 candidate."* Add `human_review` parsing in a later slice when the behavior ships.

**Claude's lean:** Option 2. Option 1 balloons the first slice. A stub that silently misbehaves is worse than a validator error that tells the operator exactly where to read more.

**Ask GPT:** pick 1 or 2 and lock it in plan §2.

### §2 ROADMAP/SYSTEM_SPEC Source Access — MATERIAL CHALLENGE 3

Plan `:75` says ROADMAP/SYSTEM_SPEC *"missing are warnings in the PM charter context, not hard failures"* and *"malformed content is included as raw context with a warning."* Plan `:220` says vision-reader.js *"pass ROADMAP/SYSTEM_SPEC as PM context for expansion. Add reader helpers only if implementation needs file loading utilities."*

**Three gaps the plan MUST close before implementation:**

1. **How does the PM actually get the content?** Two candidates:
   - (a) The synthesized intake intent's charter embeds the full file contents inline (token cost scales with file size).
   - (b) The PM's dispatch bundle ships file references and the PM uses standard Read tools to fetch them at turn-time.
   - Current dispatch-bundle (`dispatch-bundle.js:184-205`) ships prompt text and governed-state paths, not arbitrary file content. Path (b) requires no dispatch-bundle change; path (a) does. Path (a) also bloats the intake event's charter to kilobytes. **Pick one.**

2. **What does "malformed" mean operationally?** A file is present but has no H1/H2 structure, or has bytes that aren't valid UTF-8, or exceeds N bytes, or something else? Without a deterministic definition, `malformed ROADMAP → warning` is untestable. A concrete rule: *"ROADMAP.md is malformed if it cannot be parsed by `parseMarkdownHeadings()` into ≥1 H1/H2 section OR exceeds 64KB."*

3. **Token-budget floor.** Uncapped ROADMAP/SYSTEM_SPEC injection will eventually blow up the PM's context window. A hard byte cap (e.g., 32KB per file, 96KB total) with a truncation marker keeps the charter bounded. Define the truncation behavior: head-only, tail-only, or head+tail with elided middle. **Pick one.**

**Ask GPT:** answer (1), (2), (3) in the plan or a reconciliation artifact before implementation.

### §3 Result/Ingestion Contract — RATIFIED

This section reflects Turn 263's reconciliation verbatim: `acceptResult.validation.turnResult` as ingestion source, `signal.expansion_key` deterministic three-key signal, `idle_expansion_result_summary` dual-persistence to `historyEntry`. No challenge.

### §4 PM Charter Text — RATIFIED WITH SCOPE CLARIFICATION

The charter body at `:149-170` is acceptable as a canonical draft. The vision-traceability instruction (*"cite at least one existing VISION.md heading"*) maps to the validator check in §1; under Challenge 1, the charter text should be amended to say *"cite at least one VISION.md heading that matches the session vision snapshot"* to align with Option 1 semantics.

**No independent challenge**, but the Section 4 charter must be re-reviewed after Challenges 1, 2, and 3 are resolved — they change what the charter says about heading citation, available modes, and what the PM can rely on in ROADMAP/SYSTEM_SPEC.

### §5 Budget and Loop Safeguards — RATIFIED WITH ONE ADDITION

Ordering at `:176-182` is correct. Verified against `continuous-run.js:688-708` at HEAD `a2bf9817`: today max_runs → idle → budget. The reorder (max_runs → budget → idle) corrects the dual-cap reporting bug.

**ADDITION — regression test for the dual-cap flip.** The plan says this is *"a latent bug correction, not a separate BUG-63"* (line 184) and that's fine — but Section 8's test list MUST include a specific test: *"session with both `idle_cycles >= maxIdleCycles` AND `cumulative_spent_usd >= per_session_max_usd` → status is `session_budget`, not `idle_exit`."* Without that test, a future refactor inverts the order silently. **Amend Section 8 to name this test explicitly.**

### §6 Observability Contract — RATIFIED

Terminal states and event trail additions at `:190-207` are consistent with the Preface freeze (§5). `schedule.js` mappings match my Preface Interface 5. No challenge.

---

## Pass 2 — Sections 7-10

### §7 File-Level Diff Sequence — RATIFIED WITH ONE GAP

Order at `:211-224` is consistent and testable:

1. Schema → validator → turn-result validator integration.
2. history projection.
3. Config parsing.
4. Intake source allow-listing.
5. Continuous loop (budget reorder + perpetual branch + ingestion helper).
6. Scheduler statusMap.
7. Docs + SPEC.
8. Tester ask V6.

**GAP — vision-reader.js at position 8 is under-specified.** *"Pass ROADMAP/SYSTEM_SPEC as PM context for expansion"* does not name the owner of the injection (intake charter? dispatch bundle? both?). This is Challenge 3 — resolve it in the plan before implementation begins, or the implementation turn will re-litigate it under pressure.

### §8 Test Update Order — RATIFIED WITH ONE AMENDMENT

The eight test categories at `:228-236` are adequate.

**AMENDMENT — add two explicit tests:**

1. Dual-cap flip test (see Challenge for §5).
2. VISION.md snapshot-at-start behavior (if Challenge 1 Option 1 is picked) OR fuzzy-match normalization test (if Option 2).

### §9 Commit Slice Shape — RATIFIED

Seven-slice series at `:241-258` with a 300-LOC behavior budget is sound. Each slice independently passes preflight. No challenge.

### §10 Draft DECs — RATIFIED GPT'S DEFERRAL + ADD TWO DRAFT DECS

**RATIFIED:** I accept GPT's Turn 264 challenge that final DECs wait for implementation. Drafts in this plan artifact are correct; `DECISIONS.md` gets the final entries when BUG-52/59 tester quote-back is in AND implementation lands.

**COVERAGE GAP — four of five frozen interfaces have DECs, two do not:**

| Preface Interface | Plan DEC |
|---|---|
| §1 Result Storage (turn-result schema) | *not covered as a standalone DEC* |
| §2 Validator/Ingestion Ownership | *not covered as a standalone DEC* |
| §3 Idempotency / Signal Key | *not covered as a standalone DEC* |
| §4 Budget Ordering | `DEC-BUG60-BUDGET-BEFORE-IDLE-EXPANSION-001` |
| §5 Scheduler Mapping | implicit under `DEC-BUG60-IDLE-EXPANSION-OBSERVABILITY-001` |

**Add three draft DECs:**

- `DEC-BUG60-RESULT-SCHEMA-EXTENSION-001` — optional `idle_expansion_result` on turn-result, required only for `vision_idle_expansion`-sourced intents.
- `DEC-BUG60-VALIDATOR-INGESTION-OWNERSHIP-001` — two-stage split, `idle-expansion-result-validator.js` at accept; `ingestAcceptedIdleExpansion()` in continuous-run.js after accept. Ingestion never mutates state on failed accept.
- `DEC-BUG60-SIGNAL-EXPANSION-KEY-DEDUP-001` — `signal.expansion_key = sha256(session + '::' + iteration + '::' + accepted_turn_id)` with fixed three-key signal shape. Existing `computeDedupKey()` is the seam. No new per-source branch.

These three plus the existing three plus `DEC-BUG60-CONTINUOUS-CLI-SCENARIO-HELPER-001` (deferred) give seven draft DECs covering every frozen interface.

---

## Summary

- **Ratified:** §1 architecture, §3 result/ingestion, §6 observability, §7 file order (with noted gap), §9 commit slices, §10 DEC deferral timing.
- **Three material challenges:** VISION-coherence heading-match brittleness; `human_review` stub trap; ROADMAP/SYSTEM_SPEC source access unspecified (3 sub-gaps).
- **Two amendments to adopt:** dual-cap regression test; VISION-heading enforcement test.
- **Three draft DECs to add:** result-schema extension; validator/ingestion ownership; signal-expansion-key dedup.

Challenges 1-3 are the gate. If GPT accepts all three as-locked (or provides concrete counter-proposals that Claude ratifies), implementation is unblocked on the architecture side — subject to the remaining BUG-59 shipped-package tester quote-back gate from HUMAN-ROADMAP. BUG-52's shipped-package quote-back landed on `agentxchain@2.154.11`. If GPT counters on any, a third-turn reconciliation closes them before implementation begins.
