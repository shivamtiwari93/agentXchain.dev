# BUG-60 Plan-Turn Skeleton

**Status:** Static structural skeleton. Written before BUG-59 tester quote-back under `DEC-BUG59-CLOSURE-GATE-TESTER-QUOTEBACK-001`. This file does NOT choose Option A/B, name schema fields, author DEC entries, write PM prompt text, patch the runbook, edit `cli/src/lib/`, or flip any HUMAN-ROADMAP checkbox.

**Purpose:** Give the BUG-60 plan turn a fill-in-the-blanks shape so it cannot drift into a "free-form plan doc" that forgets already-banked constraints. Every section below imports an existing audit artifact by pointer; the plan turn's job is to resolve the unresolved, not re-discover what is already banked.

**Invocation trigger:** This skeleton activates only after BUG-59 real tester quote-back lands per `DEC-BUG59-CLOSURE-GATE-TESTER-QUOTEBACK-001`. Until then, the BUG-60 plan turn is explicitly blocked.

---

## Section 0 — Gating Preamble (open the turn with this)

Open the BUG-60 plan turn by reproducing, in order, the opening block of `BUG_60_DECISION_CANDIDATE_AUDIT.md:82-107` ("BUG-60 Plan-Turn Opening Checklist"). Every `- [ ]` box must be ticked before Section 1 starts. Unticked boxes are hard blockers; the plan turn stops there, names the missing input, and hands back to the other agent to supply it.

Do NOT rewrite the checklist here. Importing it by reference is the point — a second copy would drift.

---

## Section 1 — Architecture Decision (fill in: Option A, Option B, or a fourth)

Inputs: `BUG_60_CODE_AUDIT.md` (Section 1 confirmed the roadmap's file:line table and its corrections), HUMAN-ROADMAP.md:258-459 (human-authored constraints and the four guardrails at lines 323-337), `BUG_60_DECISION_CANDIDATE_AUDIT.md` row 1 (minimum content for `DEC-BUG60-IDLE-POLICY-ARCHITECTURE-001`).

Required output of this section:

1. **Chosen option** — A, B, or a named fourth. One sentence per rejected option explaining the concrete failure mode that made it lose, not an aesthetic preference.
2. **Dispatch mechanism** — for the chosen option, trace a single perpetual-mode idle cycle end-to-end in prose: "idle threshold hit → [new-branch dispatch] → PM turn → intake effect (if Option A) or direct turn (if Option B) → run N+1 starts → run N+1 accepts → next idle cycle." Quote the continuous-run.js lines the new branch lives adjacent to (already cited at `continuous-run.js:348-351` in the audit).
3. **Backward-compat clause** — explicit statement that default `on_idle` (or whichever name is chosen) = bounded `exit` semantics. Existing BUG-53 scenario keeps passing unchanged against the packed tarball. This wording lands verbatim inside `DEC-BUG60-IDLE-POLICY-ARCHITECTURE-001`.
4. **Vision-coherence safeguard answer** — adversarial review in Turn 160/GPT flagged: what prevents PM idle-expansion from producing an intent OUTSIDE the project's vision (scope creep via idle-expansion)? Answer this in prose before architecture is committed. Section 1 only chooses the mechanism; the authoritative wording belongs in the PM idle-expansion prompt drafted in Section 3. If the answer is "the PM idle-expansion prompt has a vision-coherence clause," say that here, then draft the exact clause once in Section 3.5.
   - **Invariant vs clause-text split** (Turn 167 sharpening). Section 1.4 MUST also record a one-sentence **invariant** — what the vision-coherence mechanism must guarantee (e.g., "every synthesized intake intent must cite at least one VISION.md goal it advances") — distinct from the prompt clause's wording. The invariant is the durable contract; the prompt wording is its implementation. `DEC-BUG60-IDLE-POLICY-ARCHITECTURE-001` records the invariant + a pointer to the prompt path; Section 3.5 owns the clause text. This avoids under-specifying the DEC (it owns an enforceable assertion, not just a pointer) without reintroducing Turn-165 triple-encoding (the clause wording still lives in exactly one place).

Do NOT author `DEC-BUG60-IDLE-POLICY-ARCHITECTURE-001` yet — that happens in Section 4, after proof plan is written.

---

## Section 2 — Guardrail Specification (fill in: safeguards chosen from HUMAN-ROADMAP:323-337)

Inputs: HUMAN-ROADMAP:323-337 (four guardrails), `BUG_60_DECISION_CANDIDATE_AUDIT.md` row 2 (budget-before-idle-expansion standalone DEC), `CONTINUOUS_BUDGET_ENFORCEMENT_SPEC.md:88` (ordering sentence flagged MUST-CHANGE).

Required output:

1. **Dispatch mechanism** (guardrail 1) — resolved in Section 1; cite the chosen option here without re-arguing.
2. **Budget-ordering contract** (guardrail 2) — one-sentence invariant: `per_session_max_usd` evaluates BEFORE any PM idle-expansion dispatch can spend, AND before `max_idle_expansions` is consulted, AND remains a categorical block (not a warning). This sentence lands verbatim inside `DEC-BUG60-BUDGET-BEFORE-IDLE-EXPANSION-001`.
3. **`max_idle_expansions` cap** (guardrail 2, continued) — chosen default value + rationale. Default candidate: 5, per roadmap. Plan turn may argue for a different value with evidence; if unchanged, cite the roadmap.
4. **Canonical PM output form** (guardrail 3) — confirm or revise the proposal in HUMAN-ROADMAP:335 that the PM turn MUST produce ≥1 new intake intent (schema at `intake.js:365-382`). If revising, name the new canonical form and its schema location.
5. **VISION.md immutability clause** (guardrail 4) — confirm the PM-idle-expansion prompt must include a read-only clause for `.planning/VISION.md`. This clause's exact wording is drafted in Section 3.

Do NOT author the guardrail DECs here — they land in Section 4.

---

## Section 3 — PM Idle-Expansion Prompt Draft (fill in: full prompt text)

Inputs: existing scaffold prompts under `.agentxchain/prompts/` (read for tone + structure), HUMAN-ROADMAP:337 (VISION.md read-only clause), Section 2 canonical-output-form decision, Section 1 vision-coherence decision.

Required output:

1. **Full prompt text** for `.agentxchain/prompts/pm-idle-expansion.md` (or whichever canonical path the plan turn picks — record the path decision inline).
2. **Read-inputs list** — explicit enumeration of which files the PM reads (VISION.md, ROADMAP.md, SYSTEM_SPEC.md, state.json, etc. per chosen `on_idle_perpetual.sources[]` default).
3. **Output schema enforcement** — what structured artifact the PM must emit (intake-intent JSON, `vision_exhausted` declaration, or both-paths-allowed). Acceptance criterion: anything else = `acceptance_failure`, re-dispatch once, then abort.
4. **VISION.md read-only clause** — verbatim text of the immutability sentence inside the prompt.
5. **Vision-coherence clause** (from Section 1) — verbatim text requiring the synthesized intent to cite ≥1 vision goal it advances.

Do NOT commit the prompt file to disk in this section — Section 6 commits it alongside implementation. This section produces the authoritative draft text that later lands verbatim.

---

## Section 4 — DEC Authoring (the 4 candidates, or justified collapses)

Inputs: `BUG_60_DECISION_CANDIDATE_AUDIT.md` Sections "Minimal Future DEC Set" + "Plan-Turn Gating Checklist" + "Non-Negotiable Plan-Turn Check".

Required output — author as canonical entries in `.planning/DECISIONS.md`, in this order:

1. `DEC-BUG60-IDLE-POLICY-ARCHITECTURE-001` — includes backward-compat clause from Section 1.3.
2. `DEC-BUG60-BUDGET-BEFORE-IDLE-EXPANSION-001` — standalone, per Turn 161 rationale summary. If the plan turn wants to collapse it into DEC-1, the collapse must be justified in the DEC-1 body AND the non-negotiable-check passage in the candidate audit must be patched to show the collapse.
3. `DEC-BUG60-IDLE-EXPANSION-OBSERVABILITY-001` — with both **Terminal State Contract** and **Event Trail Contract** subsections per Turn 162 GPT review. Enumerates the 5 terminal statuses.
4. Defer `DEC-BUG60-CONTINUOUS-CLI-SCENARIO-HELPER-001` until the helper extraction commit lands (per Turn 160-161 sequencing). If the plan turn decides extraction is abandoned, say so here with reasoning.

No `cli/src/lib/` change may land before Section 4 is complete. Test-only helper extraction is governed by the deferred-DEC rule and is allowed in Section 6 per the narrowed checklist line.

---

## Section 5 — Proof Plan (fill in: per-row test surface bindings)

Inputs: `BUG_60_DOC_SURFACE_AUDIT.md` "BUG-60 Release-Note Claim-Reality Matrix" (9 rows, `BUG_60_DOC_SURFACE_AUDIT.md:103-113`), `BUG_60_TEST_SURFACE_AUDIT.md` (helper-boundary split).

Required output — for EACH of the 9 matrix rows:

1. **Concrete test file path** (existing or new).
2. **Packed-CLI assertion** (not source-only; child-process `execFileSync` per Rule #12 + Rule #9).
3. **Distinguishable observable end-state** — terminal status name + event name (no shared "success" bit per the anti-false-closure checklist).
4. **Positive AND negative case** where applicable (rows 2, 4, 5, 6 per the anti-false-closure checklist).

Row collapses (e.g., rows 4 + 5 sharing a test file) require a one-line justification matching the "no row collapses without DEC note" rule.

Do NOT write test code yet — that's Section 6.

---

## Section 6 — Implementation Sequencing (fill in: commit order)

Inputs: narrowed "First implementation-gated item" rule at `BUG_60_DECISION_CANDIDATE_AUDIT.md:106` (schema/default-parsing first; helper extraction when perpetual scenario is imminent).

Required output — ordered commit list. Canonical order:

1. **Commit 1 — Schema + default-parsing slice.** Add `on_idle` (or chosen name) to the normalized continuous config schema with default `exit`. Add parsing + validation. NO behavior change. Existing BUG-53 scenario passes unchanged. Tests assert schema surface + default preservation.
2. **Commit 2 — Helper extraction for BUG-53.** Migrate `bug-53-continuous-auto-chain.test.js` onto a shared helper per `BUG_60_TEST_SURFACE_AUDIT.md` boundary rules (helper owns temp repo envelope + CLI invocation; fake-agent behavior stays scenario-local). Author `DEC-BUG60-CONTINUOUS-CLI-SCENARIO-HELPER-001` alongside this commit.
3. **Commit 3 — Perpetual branch at `continuous-run.js:348-351`.** New `on_idle: "perpetual"` branch dispatches per Section 1 architecture. Includes budget-ordering check per Section 2. Does NOT yet expand vision sources beyond VISION.md.
4. **Commit 4 — Source expansion + PM prompt scaffold.** Extend `deriveVisionCandidates()` (or add sibling derivers) to read ROADMAP.md + SYSTEM_SPEC.md when configured. Commit `.agentxchain/prompts/pm-idle-expansion.md` with the Section 3 prompt text.
5. **Commit 5 — BUG-60 beta scenario test.** Add `cli/test/beta-tester-scenarios/bug-60-perpetual-idle-expansion.test.js` with positive + negative branches per Section 5.
6. **Commit 6 — Doc + spec updates.** Land the 5 MUST-CHANGE + 3 MUST-EXTEND surfaces from `BUG_60_DOC_SURFACE_AUDIT.md` in one commit.
7. **Commit 7 — Release bump.** Per `DEC-BUG59-RELEASE-BUMP-SEPARATION-001`, this commit contains only generated version/surface outputs. No behavior or test repairs land here.

Plan turn may reorder commits 2–4 with justification. Commit 5 is the fixed proof barrier: it must land after the behavior/prompt/source-expansion slices it proves and before doc/spec claims or release work. Commit 6 must land after Commit 5 so public docs cite the proof that actually exists. Commit 1 is fixed-first; Commit 7 is fixed-last.

---

## Section 7 — Sign-Off (fill in: proof of readiness)

Before the first implementation commit (Section 6, Commit 1) lands, confirm:

- [ ] All 7 sections above are filled in — no `TBD` or `TODO` markers.
- [ ] DECs 1–3 from Section 4 are committed to `DECISIONS.md`.
- [ ] HUMAN-ROADMAP.md BUG-60 entry reflects the planning-complete state (no checkbox flip — just a line under the entry noting plan-turn landed).
- [ ] The other agent (GPT 5.4 if Claude wrote the plan, Claude Opus 4.7 if GPT wrote it) has completed two adversarial review gates in AGENT-TALK:
  - **Plan-contract review:** Sections 1–4 reviewed together before any `cli/src/lib/` change. This catches architecture, guardrail, prompt-contract, and DEC drift while correction is still cheap.
  - **Proof-and-sequence review:** Sections 5–7 reviewed together before Commit 1 lands. This catches test-surface, commit-order, and release-gate drift without forcing seven separate handoffs.
- [ ] `wc -w .planning/AGENT-TALK.md` checked; if over 15k, compression block precedes any further turn-logging.

---

## What this skeleton does NOT do (and why)

- Does NOT choose Option A/B or a fourth. Architecture selection requires the plan turn to do trace work this skeleton cannot substitute for.
- Does NOT spell any config key. Names are plan-turn commitments per `BUG_60_DECISION_CANDIDATE_AUDIT.md:30-37`.
- Does NOT draft the PM prompt text. Prompt content is a real artifact the plan turn owns.
- Does NOT commit to 7 commits being the right count. Plan turn may collapse or split with justification; the ordering constraints (Commit 1 first, Commit 7 last) are the durable rule.
- Does NOT author or precommit any DEC entry. DEC text is authored in Section 4 when the plan turn fills in the architecture choice.

## Resume points when BUG-59 tester quote-back lands

The unlocking sequence is:

1. Tester posts quote-back satisfying `DEC-BUG59-CLOSURE-GATE-TESTER-QUOTEBACK-001`.
2. Agent verifies the quote-back in AGENT-TALK, flips BUG-59 checkbox in HUMAN-ROADMAP.
3. BUG-60 plan turn opens by running this skeleton's Section 0 checklist.
4. Plan turn fills Sections 1–7 in order. Each completed section appends to AGENT-TALK with a section-tag like `BUG-60-PLAN-SECTION-1` so the other agent can review in-place.
5. Other agent adversarial-reviews the filled plan at the two required gates: Sections 1–4 before `cli/src/lib` changes, then Sections 5–7 before Commit 1 lands.
6. When Section 7's checklist is all green, implementation begins with Commit 1.
