# Human Roadmap — AgentXchain

Human-prioritized work for the agents.

Rules:
- Agents should read this file before acting.
- Unchecked items here take priority over general exploration in `AGENT-TALK.md`.
- When an item is complete, agents should mark it complete and briefly record what changed.
- If an item is too large, agents should split it into smaller checklist items and work them down in order.
- Only move an item back to `HUMAN_TASKS.md` if it truly requires operator-only action.

Current focus: **BUG-44 + BUG-45 — intent lifecycle + retained-turn acceptance must reconcile against current intent state.** BUG-42/43 fixed on v2.138.0. Tester has since moved the run forward via manual `.agentxchain/` state surgery. BUG-44 (phase-scoped retirement) and BUG-45 (retained-turn uses stale embedded contract) are related — both stem from the same root: acceptance treats the turn's embedded `intake_context.acceptance_contract` as authoritative instead of reconciling against the live intent state. Fixing both together may be the right move. Full reports in archive under "Beta-tester bug report #13 (2026-04-19)" and "Beta-tester bug report #14 (2026-04-19)".

## Priority Queue

- [ ] **BUG-44: Intent coverage must retire phase-scoped intents when that phase is exited by gate-pass + phase advance** — Verified code gap. `cli/src/lib/governed-state.js:3162` runs `evaluateIntentCoverage(turnResult, intakeCtx)` on every acceptance. No phase-scoping, no retirement-on-phase-advance logic anywhere in `intake.js`, `intent-startup-migration.js`, or `governed-state.js`. An implementation-scoped repair intent stays `approved` with its acceptance contract unaddressed even after `implementation_complete` passes and the phase advances to `qa`. Continuous mode then pauses on "Intent coverage incomplete" during QA acceptance — enforcing an intent that belongs to a phase the run has already exited.
  - **Tester's exact scenario (for tester-sequence test):**
    - Intent `intent_1776534863659_5752` was an implementation-phase repair intent: "add literal `## Changes` section to `.planning/IMPLEMENTATION_NOTES.md`, preserve implementation summary, allow implementation to advance to QA."
    - The repair was completed. `.planning/IMPLEMENTATION_NOTES.md` now contains `## Changes`. `implementation_complete` gate shows `passed`. Phase is `qa`.
    - QA turn `turn_e6b31574217ab1d2` dispatch, acceptance fails: `acceptTurn(qa): Intent coverage incomplete: 1 acceptance item(s) not addressed: implementation_complete gate can advance to qa once verification passes`.
    - The acceptance item is effectively satisfied by gate pass + phase advance, but the intent still sits in the queue demanding coverage.
  - **Fix requirements:**
    1. **Intents gain a `phase_scope` field.** When an intent is created (via `inject`, `intake record`, vision-seeding, etc.), optionally record which phase it's scoped to. If omitted, intent is phase-agnostic. If set, intent is only enforceable while the run is in that phase.
    2. **Auto-derive phase_scope when possible.** If the intent's charter or acceptance items reference a gate name (e.g., "implementation_complete"), auto-scope to that gate's phase.
    3. **Retire phase-scoped intents on phase advance.** When `acceptGovernedTurn()` processes a phase transition, scan the intake queue. For every `approved` intent where `phase_scope === <exited_phase>`, transition to `status: "satisfied"` with reason `"phase <X> exited; <phase>-scoped repair no longer required"`. Emit `intent_retired_by_phase_advance` event.
    4. **Retire intents whose acceptance items are satisfied by gate state.** Even without explicit `phase_scope`, if an acceptance item literally says "gate X can advance" or "gate X passes" AND that gate shows `passed`, treat the item as covered. This handles the implicit-phase-scoping case.
    5. **The intent coverage validator must be phase-aware.** `evaluateIntentCoverage()` must skip acceptance items that belong to an already-exited phase OR items that are satisfied by current gate state.
    6. **Tester-sequence test MUST use the tester's actual scenario:** seed an implementation-scoped repair intent, complete the repair, pass the gate, advance to QA, dispatch a QA turn. Assert acceptance succeeds without complaining about the implementation-phase intent.
    7. **Live-proof discipline:** closure must include the tester's quoted output showing `agentxchain run --continue-from run_c8a4701ce0d4952d --continuous` progressing through QA without pausing on stale implementation coverage. Per rule #12.
  - **Acceptance:** tester's run on v2.139.0 successfully completes the QA turn without the "Intent coverage incomplete" error referencing implementation-phase intents.

- [ ] **BUG-45: Retained-turn acceptance uses stale embedded `intake_context.acceptance_contract` instead of reconciling against current intent state** — Verified code gap. `cli/src/lib/governed-state.js:3228-3234` reads `currentTurn.intake_context.acceptance_contract` from the turn's embedded state, not from the live intent file on disk. When an intent is effectively satisfied by a retained turn's artifacts and verification, but the framework hasn't retired the intent yet, the retained turn stays in `failed_acceptance` forever. `intake resolve` is a no-op on `executing` intents (`cli/src/lib/intake.js:1273-1288` returns `no_change: true`). The only way out is manual `.agentxchain/` state surgery: mark intent completed, clear `injected-priority.json`, null out `intake_context` on state.json + ASSIGNMENT.json. That is not an acceptable recovery path.
  - **Tester's exact scenario:**
    - Retained turn `turn_1e8cabbfdda98f5d`, role `product_marketing`, phase `qa`, on v2.138.0
    - Intent `intent_1776535590576_a157` (live-site consolidation) is `executing`
    - Staged turn result at `.agentxchain/staging/turn_1e8cabbfdda98f5d/turn-result.json` has `files_changed` covering the contract and `verification.status: "pass"` with commands that literally verify the `## Changes` heading exists, acceptance-matrix/ship-verdict/release-notes exist, and the build+typecheck pass
    - Acceptance keeps failing: `Validation failed at stage intent_coverage. Detail: Unaddressed acceptance items: ...`
    - `intake resolve --intent intent_1776535590576_a157 --json` returns `{"previous_status": "executing", "new_status": "executing", "no_change": true}`
    - Only manual state surgery (mark intent completed → null out intake_context → rerun accept-turn) unblocks
  - **Three distinct defects in this bug (all must be fixed):**
    1. **Retained-turn acceptance must re-read the live intent state, not the embedded copy.** Change `governed-state.js:3228` to look up the current intent by `intake_context.intent_id` from `.agentxchain/intake/intents/`. If the intent is `completed`/`satisfied`/`superseded`/`suppressed`, skip coverage enforcement entirely. If `approved`/`executing`, use the CURRENT `acceptance_contract` from disk (it may have been updated), not the stale embedded one.
    2. **`intake resolve` must be able to transition `executing → completed` when the retained turn's evidence satisfies the contract.** Currently `resolveIntent` refuses. Add a new disposition: if the caller passes `--outcome satisfied` or detects that a retained turn exists with evidence covering every acceptance item, transition executing → completed atomically. Or provide a new `agentxchain intake complete --intent <id> --turn <turn_id>` command that performs the retirement explicitly.
    3. **Framework-generated `HUMAN_TASKS.md` edits must not poison retained-turn artifact observation.** When the escalation layer appends a resolved-escalation block to `HUMAN_TASKS.md`, the diff shows up as an undeclared file change in the next turn's acceptance. `cli/src/lib/repo-observer.js:50` already excludes `.agentxchain/human-escalations.jsonl` from baseline observation — add `HUMAN_TASKS.md` to the same exclusion list (it's framework-owned, not turn-owned).
  - **Fix requirements:**
    1. Write tester-sequence test that seeds the tester's exact state: retained turn with `intake_context.acceptance_contract` embedded, intent file on disk in `executing` status, staged result satisfying the contract. Run `accept-turn --turn <id>`. Assert acceptance succeeds without manual state surgery.
    2. Second tester-sequence test for the `HUMAN_TASKS.md` dirty-state: trigger framework-generated escalation resolution, then dispatch a retained-turn accept. Assert no "Undeclared file changes detected: HUMAN_TASKS.md" error.
    3. Tester must verify v2.139.0 with their exact reproduction before closure (discipline rule #12).
  - **Acceptance:** tester's exact scenario on v2.139.0 — retained turn `turn_1e8cabbfdda98f5d`-shape with embedded stale contract + satisfied-on-disk repo state — accepts cleanly via `accept-turn` without manual `.agentxchain/` edits.

### Implementation notes

- **BUG-44 and BUG-45 likely share a fix.** Both are symptoms of the same root: acceptance treats embedded/historical intent state as authoritative instead of reconciling against the live intent file. A single "intent state reconciler" function — called before `evaluateIntentCoverage()` — that looks up the live intent, applies phase-scope retirement (BUG-44) AND applies contract updates (BUG-45), would fix both. Implement them together in v2.139.0.
- **Do NOT mark either closed until tester verifies.** Rule #12 is in force.
- **Ordering:** v2.139.0 contains BUG-44 + BUG-45 fixes only. No feature work.
- **Coverage matrix update:** `BUG_31_33_COVERAGE_GAP_POSTMORTEM.md` needs a new column — "retained-turn reconciliation." Every acceptance path must be tested with intent-state-drift scenarios: intent completed between dispatch and acceptance, intent contract changed between dispatch and acceptance, intent retired by phase advance between dispatch and acceptance.
- **Framework-dirties-repo pattern:** The `HUMAN_TASKS.md` case is one instance of a broader risk — any file the framework itself writes that ISN'T in the baseline exclusion list will poison artifact observation. Audit ALL framework write paths: human-escalations, events.jsonl, session.json, state.json, history.jsonl, decision-ledger.jsonl, etc. Cross-check each against `repo-observer.js` baseline exclusions. Any framework-owned write target must be excluded.
- **Stretch goal:** `intake resolve --verify-from-turn <turn_id>` — operator-friendly command that completes an executing intent if a specific turn's evidence satisfies the contract. Removes the need for manual state surgery even when the automatic reconciler misses an edge case.

---

## Active discipline (MUST follow on every fix going forward)

Established across the 2026-04-18/19 beta cycle after 7 false closures (BUG-17/19/20/21, BUG-36, BUG-39, BUG-40, BUG-41). Apply on every BUG-N closure:

1. **No bug closes without live end-to-end repro.** The failing test must exercise the beta tester's exact command sequence in a temp governed repo with real runtimes. Unit tests + "the code path is covered" is not sufficient evidence. If the tester's sequence still reproduces the defect on the freshly-built CLI, the bug is not fixed.

2. **Every previously-closed beta bug is a permanent regression test.** Lives in `cli/test/beta-tester-scenarios/`. One file per bug (BUG-1 through BUG-44). CI runs them on every release. A single failure blocks the release.

3. **Release notes describe exactly what shipped — no more, no less.** No overclaiming coverage. No "partial fix" marketing language. Let the tests speak.

4. **Internal `false_closure` retrospectives live in `.planning/`, NOT on the website.** When a closed bug reopens, write `.planning/BUG_NN_FALSE_CLOSURE.md` privately. Never post to docs, release notes, or marketing.

5. **Do NOT broadcast limitations publicly.** No "known limitations" callouts. No blog posts about what doesn't work. No scoping-down of case study or comparison pages. The answer to "the product doesn't do what we say" is to make the product do what we say — quietly, quickly — not to tell the world we've been wrong.

6. **Every bug close must include:**
   - Tester-sequence test file (committed BEFORE the fix)
   - Test output showing PASS on a fresh install
   - CLI version and commit SHA the test was run against
   - A line in the closure note: "reproduces-on-tester-sequence: NO"

7. **Slow down.** A bug that takes 3 days to close correctly is vastly better than one that takes 1 day and reopens in 2.

8. **Use REAL emission formats in tester-sequence tests** (added during BUG-37 closure). Any test that asserts on error messages, gate reasons, or event payloads must call the real emitter, not construct synthetic strings. Hardcoded reason strings in beta-tester-scenario tests are banned.

9. **"Claim-reality" gate in release preflight** (added during BUG-37 closure). For every BUG-N marked fixed, preflight must run the tester-sequence test against the shipped CLI binary (not the source tree), to catch "works from source, broken when built" bugs.

10. **Startup-path coverage matrix** (added during BUG-40 closure). Every code path that can produce turn dispatches must be covered in the tester-sequence matrix (`run`, `run --continue-from`, `run --continuous`, `restart`, `resume`, `step --resume`, `schedule daemon`, etc.). Matrix lives in `.planning/BUG_31_33_COVERAGE_GAP_POSTMORTEM.md` and is updated whenever a new startup surface lands.

11. **Tester-sequence tests must seed realistic accumulated state, not just clean fixtures** (added during BUG-41 closure). For migration/reconciliation bugs, the test MUST simulate a repo that has already been through prior versions — pre-existing session files, state.json, intent files in various legacy formats. Use `createLegacyRepoFixture()` in `cli/test/beta-tester-scenarios/_helpers/`.

12. **No bug closes without the beta tester's verified output** (added during BUG-42/43 cycle — the rule that finally broke the false-closure streak). For tester-reported bugs, closure notes must include either (a) the tester's quoted output showing the fix works on their machine, OR (b) a live proof run on a copy of their actual `.agentxchain/` state. Synthetic tests prove the code compiles; they do NOT prove the fix works.

---

## Recent closures (see `HUMAN-ROADMAP-ARCHIVE.md` for full detail)

### Beta cycle 2026-04-19 — closed
- ✅ **BUG-42** — phantom intent detection for rebound legacy intents (first non-false closure after 7 false ones)
- ✅ **BUG-43** — checkpoint-turn filters ephemeral staging/dispatch paths from `files_changed`
- Release: v2.138.0

### Beta cycle 2026-04-18 — closed
- ✅ **BUG-41** — session-flag guard removed; `migrate-intents` repair command shipped
- ✅ **BUG-40** — continuous startup + resume migration (shared `intent-startup-migration.js` helper)
- ✅ **BUG-37/38/39** — gate_semantic_coverage real-emissions, non-progress convergence guard, pre-BUG-34 intent archival
- ✅ **BUG-34/35/36** — cross-run intent scoping, retry-prompt intent re-binding, gate_semantic_coverage validator
- ✅ **BUG-31/32/33** — `human_merge` completion, forward-revision vs destructive conflict, iterative planning coverage
- ✅ **DOC-1** — website sidebar Examples → Products/Proofs split
- Releases: v2.130.x → v2.137.0

### Earlier 2026-04-17/18 clusters (details in archive)
- ✅ **BUG-1..30** — acceptance/validation, drift recovery, intake integration, state reconciliation, checkpoint handoff, false-closure fixes
- ✅ **B-1..B-11** — CLI version safety, runtime matrix, authority model, local_cli canonical, migration path, Codex recipes, etc.
- ✅ **Framework capabilities** — full-auto vision-driven operation, human priority injection, last-resort escalation, live 3-run proof

---

## Completion Log

- **2026-04-19**: BUG-42/BUG-43 closed with tester-verified output on v2.138.0. First non-false closure of the cycle. Discipline rule #12 held. BUG-44 opened (intent lifecycle across phase boundaries).
- **2026-04-18**: 64-item beta-tester bug cluster (BUG-1..41 + B-1..B-11 + 3 framework capabilities + DOC-1) closed across Turns 1–220. Shipped through v2.126.0–v2.138.0. Internal postmortems: `BUG_31_33_COVERAGE_GAP_POSTMORTEM.md`, `BUG_36_FALSE_CLOSURE.md`, `BUG_39_FALSE_CLOSURE.md`, `BUG_40_FALSE_CLOSURE.md`. Discipline rules 1–12 now in force.
- **2026-04-17**: Framework full-auto vision-driven operation shipped with 3-run live proof (cont-0e280ba0, $0.025 spend). Human priority injection + last-resort escalation mechanisms landed.
- **2026-04-03**: All 7 original priority queue items completed across Turns 21–4. Docusaurus migration, vision alignment, asset fixes, table formatting, vanity proof replacement, platform split simplification, GCS deployment. v2.2.0 release-ready.
