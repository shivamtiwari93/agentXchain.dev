# BUG-60 Code Audit (Pre-work Turn A Step 1)

**Status:** Partial — static file:line verification only. No Option A/B decision, no PM prompt text, no `cli/src/lib/` modifications. Written under the narrowed interpretation of DEC-BUG59-CLOSURE-GATE-TESTER-QUOTEBACK-001 (see Turn 153 AGENT-TALK).

**Purpose:** Bank the factual audit that does not depend on BUG-59's tester-verified behavior. If BUG-59 proves fixed on `tusq.dev`, the real BUG-60-RESEARCH-CLAUDE turn extends this doc. If BUG-59 fails on `tusq.dev`, this audit still reflects current code and is reusable after the root cause is re-analyzed.

**Scope restriction (self-imposed for this turn):** no architectural recommendations, no dispatch-path selection, no schema proposals. Every claim below is a mechanical check against HEAD.

## Verified — roadmap audit entries match live code

HUMAN-ROADMAP.md BUG-60 section cites a current-behavior audit table. Each row re-checked against `main` (commit `08fc5556`):

| Surface | Roadmap cite | Live match | Notes |
|---|---|---|---|
| Idle cycle counter increment | `cli/src/lib/continuous-run.js:468-469` | ✅ exact | `session.idle_cycles += 1; log('Idle cycle N/M — no derivable work from vision.')` |
| Terminal idle-exit check | `cli/src/lib/continuous-run.js:348-351` | ✅ exact | Sets `session.status = 'completed'`, returns `{ status: 'idle_exit', action: 'max_idle_reached', stop_reason: 'idle_exit' }` |
| User-facing idle-exit string | `cli/src/lib/continuous-run.js:94-96` | ✅ exact | `All vision goals appear addressed (${maxIdleCycles} consecutive idle cycles). Stopping.` |
| `deriveVisionCandidates` | `cli/src/lib/vision-reader.js:176-217` | ✅ exact | Reads VISION.md only, compares against `loadCompletedIntentSignals()` + `loadActiveIntentSignals()`, returns `{ ok, candidates: [{section, goal, priority}], error? }` |
| Budget cap categorical block | `cli/src/lib/continuous-run.js:354-362` | ✅ exact | Terminates with `status: 'completed', stop_reason: 'session_budget'`, sets `session.budget_exhausted = true` |
| `normalizeContinuousConfig` | `cli/src/lib/normalized-config.js:1279-1292` | ✅ exact | Fields: `enabled, vision_path, max_runs, max_idle_cycles, triage_approval, per_session_max_usd` |
| `resolveContinuousOptions` runtime options | `cli/src/lib/continuous-run.js:302-317` | ✅ exact | Adds `poll_seconds, cooldown_seconds, auto_checkpoint` on top of the config-normalized set |
| `recordEvent` entry point | `cli/src/lib/intake.js:328-387` | ✅ exact | Dedup via `computeDedupKey(source, signal)`; writes both event and auto-created intent |
| `VALID_SOURCES` enum | `cli/src/lib/intake.js:32` | ✅ exact | `['manual', 'ci_failure', 'git_ref_change', 'schedule', 'vision_scan']` |
| `renderPrompt` prompt-override mechanism | `cli/src/lib/dispatch-bundle.js:184-205` | ✅ exact | `config.prompts[roleId]` resolves to a file path, load result becomes `customPrompt` |
| Role mandate rendering | `cli/src/lib/dispatch-bundle.js:221-225` | ✅ exact | Pulls `role.mandate` straight from config; no per-dispatch override point today |
| `.agentxchain/prompts/pm.md` scaffold | claimed canonical | ✅ exists | File present at repo root; peer prompts `dev.md`, `qa.md`, `eng_director.md` also present |

## Discrepancies — roadmap cites that need sharpening (non-blocking)

1. **`advanceContinuousRunOnce` line range is broader than cited.** Roadmap says `continuous-run.js:337-486`. Live: function declared at `:337`, closes at `:646`. The 337-486 range the roadmap cites covers the idle/budget/vision-scan entry section (which is where BUG-60's perpetual branch lands), but it is not the function boundary. The research turn should cite `:337-646` when the claim is "the function owns the idle→exit decision" vs the narrower `:337-486` when the claim is "the idle-exit branch lives here."
2. **"Schema at `intake.js:365-382`" is the intent schema, not the event schema.** Roadmap attaches this line range to the `recordEvent` discussion but `:365-382` is the auto-created intent shape (`intent_id`, `status: 'detected'`, `requires_human_start: true`, etc.). The event shape is at `:348-359`. If the BUG-60 dispatch path records a new-sourced event, the target schema is `:348-359`; if it needs to tune the auto-created intent, the target is `:365-382`. Research turn should split the citation.

## New findings worth capturing before the real research turn

1. **`recordEvent` always creates a `detected` intent with `requires_human_start: true`.** `intake.js:375` sets `requires_human_start: true` unconditionally on the auto-created intent. Option A (intake-pipeline dispatch) must either:
   - override `requires_human_start` on the synthesized intent before it reaches `triageIntent`/`approveIntent`, OR
   - have the continuous loop call the lifecycle methods (`triageIntent → approveIntent → planIntent → startIntent`) with the new source's implied policy baked in.
   This is a substantive design point the roadmap's Option A sketch did not call out. It does not decide Option A vs Option B — but anyone picking Option A needs to name the override path.
2. **No per-dispatch mandate override exists today.** `dispatch-bundle.js:221-225` renders `role.mandate` straight from config with no per-turn override hook. The `config.prompts[roleId]` file-swap at `:184-205` IS the only override seam. If the research turn wants per-dispatch mandate modulation (e.g., inject "you are in idle-expansion mode" without swapping the whole prompt file), a new seam is required. Leaving this open for the real research turn; not proposing a fix here.
3. **`on_idle` / `continuous_policy` string is absent from both `cli/src/lib/` and `cli/test/`.** Roadmap's greenfield claim holds. No legacy partial implementation to respect.
4. **`.agentxchain/prompts/pm.md` is 1,991 bytes.** If the BUG-60 research turn proposes a `.agentxchain/prompts/pm-idle-expansion.md` template, it can sit alongside the existing scaffold without schema changes.

## What this audit does NOT do (and why)

- Does NOT choose Option A vs Option B. That choice depends on BUG-59's real-world behavior — if full-auto gate closure works as shipped on `tusq.dev`, the perpetual-mode chain can trust it; if not, Option B's bypass-governance risk is different.
- Does NOT draft the PM idle-expansion prompt. Prompt text is an architectural commitment.
- Does NOT trace the full perpetual-mode scenario. Scenario tracing is Step 4 of Pre-work Turn A and again depends on BUG-59's tester-verified state.
- Does NOT answer the four specific research questions at HUMAN-ROADMAP.md:391-395. Each of the four has a BUG-59-dependent branch.
- Does NOT propose or ship any `cli/src/lib/` change. Explicitly disallowed by HUMAN-ROADMAP.md:421.

## Resume points

When tester evidence on v2.151.0 lands and BUG-59 is tester-verified (per DEC-BUG59-CLOSURE-GATE-TESTER-QUOTEBACK-001), the real BUG-60-RESEARCH-CLAUDE turn:

1. Extends this doc with the Option A/B decision and rationale.
2. Drafts the PM idle-expansion prompt.
3. Traces the full perpetual-mode scenario end-to-end.
4. Answers HUMAN-ROADMAP.md:391-395 questions in writing.
5. Maps every test that needs updating.

If BUG-59 fails on `tusq.dev`, the research turn re-scopes around what actually shipped vs. what the roadmap assumed.
