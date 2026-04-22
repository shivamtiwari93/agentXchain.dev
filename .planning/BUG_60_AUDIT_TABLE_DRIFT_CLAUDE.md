# BUG-60 Audit Table Drift — Verified Against HEAD `d074e63f`

> **Scope.** This document verifies (and corrects) the file:line references in the BUG-60 entry of `.planning/HUMAN-ROADMAP.md` against current code. It is a *bounded preparation artifact*, not the full BUG-60-RESEARCH-CLAUDE pre-work pass. The full pre-work pass is gated separately (see `AGENT-TALK.md` Turn 257 for the live agreement question with GPT 5.4).
>
> **Why this exists.** When BUG-60 implementation eventually starts, every pre-work, plan, and implementation turn will keep grepping the same code surfaces. The roadmap audit table was correct when written, but BUG-53 (`session_continuation` emission), BUG-61 (ghost-retry block), and BUG-62 (operator-commit reconcile) shipped to `continuous-run.js` since then and shifted every line below the modified regions. Doing the line-number resync ONCE here saves every future turn from re-doing it.
>
> **Gate.** This file does NOT answer any of the seven BUG-60 pre-work research questions (Option A vs B, PM idle-expansion prompt, perpetual-mode trace, test-update map, four specific questions). Those answers wait for explicit two-agent agreement that pre-work may proceed.

---

## Corrected audit table (HEAD `d074e63f`)

| Surface | Roadmap-cited line | **Actual line on HEAD** | Drift | Notes |
|---|---|---|---|---|
| Idle cycle counter increment (`session.idle_cycles += 1; log('Idle cycle …')`) | `cli/src/lib/continuous-run.js:468-469` | **`cli/src/lib/continuous-run.js:880-881`** | **+412 lines** | Inside `seeded.idle` branch of `advanceContinuousRunOnce()`. There is also a *second* idle-cycle increment at line `889` for the `triage_approval === 'human'` `waited_for_human` branch — the audit table missed this surface entirely. **Both increments must be considered when adding a perpetual branch.** |
| Terminal idle-exit check | `cli/src/lib/continuous-run.js:348-351` | **`cli/src/lib/continuous-run.js:694-697`** | **+346 lines** | Still the canonical insertion point for the perpetual branch. Confirmed: `if (session.idle_cycles >= contOpts.maxIdleCycles) { session.status = 'completed'; … return { status: 'idle_exit' }; }`. |
| User-facing idle-exit string | `cli/src/lib/continuous-run.js:94-96` | **`cli/src/lib/continuous-run.js:106-107`** | +12 lines | String unchanged: `All vision goals appear addressed (${contOpts.maxIdleCycles} consecutive idle cycles). Stopping.` Still misleading for perpetual mode. |
| Vision derivation `deriveVisionCandidates()` | `cli/src/lib/vision-reader.js:176-217` | **`cli/src/lib/vision-reader.js:176`** (start) | **None** | Function start unchanged. Body still VISION.md-only. |
| `advanceContinuousRunOnce()` boundary | `cli/src/lib/continuous-run.js:337-486` | **`cli/src/lib/continuous-run.js:683+`** | **+346 lines** | Function is now ~380 lines (683-1066), much larger than when audit was written — BUG-53/61/62 each added branches. Main consume loop near `:1100-1130`. |
| Budget cap enforcement | `cli/src/lib/continuous-run.js:354-362` | **`cli/src/lib/continuous-run.js:700-708`** | **+346 lines** | Behavior preserved: `session.budget_exhausted = true; return { status: 'completed', stop_reason: 'session_budget' }`. **Order is now: `runs_completed >= maxRuns` → `idle_cycles >= maxIdleCycles` → `sessionBudget` check.** Perpetual branch must insert *between* the idle-cycles cap and the budget cap, OR replace the idle-cycles terminal with a perpetual dispatch path that still respects the budget cap downstream. |
| Continuous config schema (`normalizeContinuousConfig`) | `cli/src/lib/normalized-config.js:1279-1292` | **`cli/src/lib/normalized-config.js:1332`** (start) | +53 lines | Function exists; per-call shape is `{ enabled, vision_path, max_runs, max_idle_cycles, triage_approval, per_session_max_usd, ... }`. **Confirmed: no `on_idle` or `continuous_policy` field exists.** New BUG-62 fields `reconcile_operator_commits` are at `:649-668` (per Turn 237 spot-check), separate from the continuous-config validator. |
| `resolveContinuousOptions()` | `cli/src/lib/continuous-run.js:302-317` | **`cli/src/lib/continuous-run.js:634-655`** | **+332 lines** | Now also resolves `autoRetryOnGhost` (BUG-61, `:645-653`) and `reconcileOperatorCommits` (BUG-62, `:621-632, :654`). Adding `onIdle` + `onIdlePerpetual` would slot here. |
| Intake `recordEvent()` | `cli/src/lib/intake.js:328-387` | **`cli/src/lib/intake.js:328`** (start) | **None** | `VALID_SOURCES` at `:32` confirmed: `['manual', 'ci_failure', 'git_ref_change', 'schedule', 'vision_scan']`. Adding `'vision_idle_expansion'` here is a one-line additive change — Option A's natural insertion point. |
| Intake `triageIntent()` | `cli/src/lib/intake.js:393-466` | **`cli/src/lib/intake.js:393`** | **None** | |
| Intake `approveIntent()` | `cli/src/lib/intake.js:793-854` | **`cli/src/lib/intake.js:793`** | **None** | |
| Intake `planIntent()` | `cli/src/lib/intake.js:860-929` | **`cli/src/lib/intake.js:860`** | **None** | |
| Intake `startIntent()` | `cli/src/lib/intake.js:935-1136` | **`cli/src/lib/intake.js:935`** | **None** | |
| Dispatch `renderPrompt()` (custom-prompt load) | `cli/src/lib/dispatch-bundle.js:184-205` | **`cli/src/lib/dispatch-bundle.js:184-205`** | **None** | Confirmed: `config.prompts?.[roleId]` is the per-role override key. Per-dispatch override is NOT supported by this surface — `renderPrompt()` reads from static config. |
| Dispatch `customPrompt` injection | `cli/src/lib/dispatch-bundle.js:417-423` | **`cli/src/lib/dispatch-bundle.js:418-421`** | -2 lines | Behavior unchanged. |
| Role mandate rendering | `cli/src/lib/dispatch-bundle.js:221-225` | **`cli/src/lib/dispatch-bundle.js:222-225`** | -1 line | Pulls from `config.roles[roleId].mandate`. Same per-call-override constraint as customPrompt. |

---

## Drift-derived implications for BUG-60 pre-work

These observations sharpen choices the pre-work pass will have to make. They are NOT pre-work answers — they are observations that surface BECAUSE of the line-number resync.

### Implication 1 — Two idle-cycle increments, not one

The roadmap audit table mentions the `seeded.idle` increment (`continuous-run.js:880`) but misses the `triage_approval === 'human'` increment at `:889`. Any perpetual branch must decide whether `waited_for_human` (intent landed in triaged state, awaiting human approval) is a "no derivable work" situation that should trigger PM idle-expansion, or whether it is a *different* idle class that should NOT trigger expansion. **My read:** `waited_for_human` is *not* the idle class BUG-60 targets — it means work was derived but is gated on a person, so PM-expanding more work just creates more queue depth waiting on the same human. Pre-work pass should confirm this and document the distinction.

### Implication 2 — Three new branches have made `advanceContinuousRunOnce()` a long function

The function went from ~150 lines (when audit was written) to ~380 lines today. Each branch (BUG-53 session-continuation, BUG-61 ghost-retry, BUG-62 reconcile) was a clean additive change, but adding a fourth (BUG-60 perpetual) without refactoring would push the function past 400 lines. **Pre-work pass should consider whether the perpetual branch warrants extracting a small helper** (e.g., `maybeExpandViaPM(context, session, contOpts, log)` analogous to `maybeAutoReconcileOperatorCommits()` and `maybeAutoRetryGhostBlocker()`) to keep the main function shape consistent. The existing helper pattern is the precedent.

### Implication 3 — `customPrompt` is per-role, not per-dispatch

`renderPrompt()` resolves prompts via `config.prompts?.[roleId]` (static config lookup). There is no per-dispatch override hook in the current surface. The audit table noted this as "an alternative" but the actual code makes it the only option without new plumbing.

This means the cleanest BUG-60 implementation path is **NOT to swap the PM prompt mid-session.** Instead:

- **Define a NEW role `pm_idle_expansion`** (alongside `pm`) with its own mandate + prompt file.
- The continuous loop's perpetual branch dispatches with `assigned_role: 'pm_idle_expansion'`, which routes through normal `renderPrompt()` and picks up the dedicated prompt without any per-dispatch mutation of shared config.
- This also cleanly separates audit trail: `pm` turns are normal increment work; `pm_idle_expansion` turns are explicitly idle-derived.

This sharpens Option A: the new role is dispatched *via the intake pipeline* (Option A, Recommendation), but the role identity is what carries the prompt override, not the dispatch mechanism.

### Implication 4 — Budget cap ordering is fixed and must be respected

Order at `:688-708`: `maxRuns` → `maxIdleCycles` → `sessionBudget`. If the perpetual branch *replaces* the `maxIdleCycles` terminal, the budget cap still fires next-step on entry. If the perpetual branch *bypasses* the `maxIdleCycles` terminal but re-enters `advanceContinuousRunOnce()`, the budget cap will catch it. Either shape preserves the existing safeguard. **No new budget plumbing needed for safeguard #2 in the roadmap's "Four guardrails" block — the existing cap suffices.**

### Implication 5 — `recordEvent` source allowlist is one line

`VALID_SOURCES` at `intake.js:32` is a simple JS array. Adding `'vision_idle_expansion'` is a one-line additive change with zero downstream churn — every consumer of the source field treats it as opaque metadata. **Lowers the cost of Option A** (intake pipeline path) further than the audit suggested.

---

## What this artifact does NOT do

Explicit non-claims, to prevent pre-work scope creep:

1. **Does NOT pick Option A vs B.** The audit table makes Option A look slightly cheaper after this drift correction, but the official choice (with full pros/cons) belongs in `BUG_60_RESEARCH_CLAUDE.md` once pre-work is agreed.
2. **Does NOT specify the PM idle-expansion prompt.** No prompt text appears here.
3. **Does NOT trace a full perpetual-mode scenario.** Only line-references are touched.
4. **Does NOT propose any code change.** Zero code surfaces are modified by this artifact.
5. **Does NOT update `.planning/HUMAN-ROADMAP.md`.** The drifted line numbers stay in the roadmap until the plan turn explicitly refreshes them. Roadmap is the human's instruction channel; agents don't silently rewrite it.
6. **Does NOT close, advance, or otherwise touch BUG-60's checkbox state.**

---

## Provenance

- HEAD at verification: `d074e63f docs: keep bug-60 blocked after bug-52 quote-back`.
- Verification method: `Grep` for symbols + `Read` of cited regions.
- Scope: BUG-60 audit table only. No other roadmap entries audited.
- Author: Claude Opus 4.7, Turn 257.
- Reviewer (proposed): GPT 5.4, Turn 258 — adversarial check for missed surfaces or wrong line numbers.
