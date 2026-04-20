# Human Roadmap — AgentXchain

Human-prioritized work for the agents.

Rules:
- Agents should read this file before acting.
- Unchecked items here take priority over general exploration in `AGENT-TALK.md`.
- When an item is complete, agents should mark it complete and briefly record what changed.
- If an item is too large, agents should split it into smaller checklist items and work them down in order.
- Only move an item back to `HUMAN_TASKS.md` if it truly requires operator-only action.

Current focus: **BUG-52 + BUG-53 — the last two blockers to true full-auto.** BUG-47/48/49/50/51 **tester-verified closed** on v2.146.0 (ghost-turn detection down from 11 min to 5 min, all 4 gates passed, checkpoints clean). Remaining: (1) gate-resolution doesn't advance phase after `unblock` — same-phase turn redispatched, requires manual `.agentxchain/state.json` surgery; (2) continuous session pauses after run completion instead of auto-chaining to next vision-derived objective. These are the operator-babysitting patterns — once closed, the product is truly unattended-continuous. Full report in archive under "Beta-tester bug report #18".

## Priority Queue

- [ ] **BUG-52: Phase-gate resolution doesn't advance phase — `unblock` redispatches same-phase role instead of transitioning** — Verified code gap. Zero matches in `cli/src/lib/` or `cli/src/commands/unblock*.js` for logic that consults gate status after escalation resolution to trigger phase advancement. `unblock` only clears the escalation; it does not cross-check whether the underlying gate is now satisfied and the run should advance. Result: after `accept-turn` + `checkpoint-turn` + `unblock`, the dispatcher re-runs its normal role-selection logic, sees the current phase is still marked as current, and dispatches the same-phase role again.
  - **Tester's evidence:**
    - PM turn `turn_360905c7f7c8ac1a` checkpointed at `ffb26736...`, `hesc_29db2799c2f4bca6` planning_signoff escalation resolved via `unblock` → system dispatched new PM turn `turn_ecb26fc55ead053d` in planning instead of moving to implementation.
    - Same pattern QA → launch: `turn_1e99db5881d4cad6` checkpointed at `3ba58238...`, `hesc_62f7df0b8b93d623` qa_ship_verdict resolved via `unblock` → system dispatched new QA turn `turn_c3b56a26e34c5e40` instead of launch role.
    - Manual recovery: patch `.agentxchain/state.json` to set next phase + mark gate as `passed` + clear redundant turn → restart → phase finally advances.
  - **Fix requirements:**
    1. After `unblock` resolves a human escalation, if the gate the escalation was tied to is now satisfied by current artifacts AND there's an approved `phase_transition_request` on the most-recent accepted turn, advance the phase atomically. Emit `phase_transitioned` event.
    2. Or: after `checkpoint-turn` completes AND the run is unblocked AND the phase exit gate passes, auto-advance phase even without a new dispatch. This is cleaner because the trigger is the gate pass, not the `unblock` command specifically.
    3. Prevent redundant same-phase redispatch: before `resume` / `step --resume` dispatches a role, check if the current phase's exit gate is now satisfied. If yes, do not dispatch — instead, advance phase and dispatch the next phase's entry role.
    4. Tester-sequence test: accept PM turn with `phase_transition_request: "implementation"` → checkpoint → unblock planning_signoff escalation → assert phase advances to implementation automatically AND next dispatched role is `dev`, not another PM.
    5. Per rule #12: closure requires tester-quoted output showing planning → implementation and qa → launch transitions happen natively without state.json patching.
  - **Acceptance:** tester's exact scenario on v2.147.0 — complete PM planning turn, checkpoint, unblock signoff escalation, next dispatch is `dev` in `implementation`, not another PM in `planning`. Same for qa → launch.

- [ ] **BUG-53: Continuous session doesn't auto-chain after run completion — pauses instead of deriving next vision objective** — Verified code gap. `cli/src/lib/continuous-run.js:600` increments `session.runs_completed` and logs "Run X/Y completed" but does NOT unconditionally loop back to vision scan. The session transitions to `paused` or exits instead of re-entering the vision-candidate-derivation path. Tester's evidence: session `cont-5d436a8f` ended up paused after `run_78133e963b912f46` completed cleanly (all 4 gates passed, final checkpoint `32a38b0a3bbd5e1e6ce82d7271ee45e4b6e5a44b`), no new `vision_scan` run created, no next objective derived.
  - **Fix requirements:**
    1. After `session.runs_completed += 1`, the continuous loop must:
       - Check against `contOpts.maxRuns` — if reached, exit cleanly with status `completed`
       - If not reached, call `deriveVisionCandidates()` again to find the next unaddressed vision goal
       - If a candidate exists, seed a new intent via the standard `intake record → triage → approve` pipeline and start the next run
       - If no candidate exists (all vision goals addressed), exit with status `idle_exit` (clean termination, NOT paused)
    2. `paused` status should only be used for real blockers (`needs_human`, `blocked`), never for "I finished a run and didn't know what to do next."
    3. Cold-start vs warm-completion parity: the same vision-scan code path that runs at session startup must run at post-completion. Extract into a shared helper to prevent divergence.
    4. Emit `session_continuation` event with payload `{previous_run_id, next_objective, next_run_id}` so the operator has a clear audit trail of the auto-chain.
    5. Tester-sequence test: start continuous session with `--max-runs 3`, complete first run (mock or real), assert session immediately seeds next intent from vision candidates, starts run 2, does NOT pause. Repeat through 3 runs, then assert clean exit at max_runs.
  - **Acceptance:** tester's exact scenario on v2.147.0 — `run --continuous --max-runs 5` where first run completes, second run is automatically created from the next vision candidate without any operator intervention. Session status stays `running`, never `paused`, until either max_runs is hit or no vision candidates remain.

### Implementation notes for BUG-52/53

- **These are the final full-auto blockers.** Once both close, the product delivers what the VISION.md says: unattended continuous governed execution. Release cadence should prioritize this — everything else is secondary until these land.
- **Related but distinct:** BUG-52 is intra-run (phase advancement), BUG-53 is inter-run (session continuation). Different code paths, different fixes, can ship independently — but bundle into v2.147.0 if both land in the same cycle.
- **Tester-sequence tests MUST use the tester's exact reproduction.** The claim-reality preflight gate (rule #9) means the packaged CLI gets tested end-to-end before release. That's the discipline that caught the BUG-47 detection-only regression.
- **No feature work in v2.147.0.** BUG-52 and BUG-53 only. Don't mix in adjacent cleanup unless it's a dependency. The pattern of "wait for tester verification" is now well-established — use it.
- **Do NOT mark closed until tester verifies.** Rule #12 is in force. 9 false closures turned into 0 over the past week because of this rule. Don't regress.
- **Coverage matrix update:** `BUG_31_33_COVERAGE_GAP_POSTMORTEM.md` needs two new dimensions — (a) gate-resolution → phase-advance paths (BUG-52), (b) session continuation after run completion (BUG-53). Every gate × every exit path × every continuation mode must have tester-sequence coverage.

---

## Active discipline (MUST follow on every fix going forward)

Established across the 2026-04-18/19 beta cycle after 7 false closures (BUG-17/19/20/21, BUG-36, BUG-39, BUG-40, BUG-41). All 12 rules remain in force:

1. **No bug closes without live end-to-end repro.** Unit tests + "code path covered" is not sufficient.
2. **Every previously-closed beta bug is a permanent regression test** in `cli/test/beta-tester-scenarios/`. CI runs on every release; single failure blocks release.
3. **Release notes describe exactly what shipped** — no overclaiming, no "partial fix" marketing.
4. **Internal `false_closure` retrospectives live in `.planning/`**, never on website.
5. **Do NOT broadcast limitations publicly.** Make the product do what we say, quietly.
6. **Every bug close must include:** tester-sequence test file (committed before fix), test output showing PASS on fresh install, CLI version + commit SHA, closure line "reproduces-on-tester-sequence: NO".
7. **Slow down.** 3 days to close correctly beats 1 day that reopens.
8. **Use REAL emission formats** in tester-sequence tests — no synthetic strings.
9. **"Claim-reality" gate in release preflight** — tester-sequence tests run against shipped CLI binary, not source tree. Now mechanically enforced via `test(claim-reality): packaged behavioral proof` commits.
10. **Startup-path coverage matrix** in `BUG_31_33_COVERAGE_GAP_POSTMORTEM.md` — every dispatch code path × every lifecycle stage has tester-sequence test.
11. **Tester-sequence tests must seed realistic accumulated state**, not just clean fixtures. `createLegacyRepoFixture()` helper.
12. **No bug closes without the beta tester's verified output** — the rule that finally broke the 7-false-closure streak. Tester's quoted output OR live proof on copy of actual `.agentxchain/` state. Synthetic tests prove code compiles, not that the fix works.

---

## Recent closures (see `HUMAN-ROADMAP-ARCHIVE.md` for full detail)

### Beta cycle 2026-04-20 — closed
- ✅ **BUG-47, BUG-48, BUG-49, BUG-50, BUG-51** — stale-turn watchdog + intent lifecycle + checkpoint ref update + run-history contamination + fast-startup watchdog. All 5 tester-verified on v2.146.0. Second triple-or-more close of the cycle.
- Release: v2.145.0 (BUG-47..50), v2.146.0 (BUG-51 + hardening)

### Earlier 2026-04-18/19 clusters (details in archive)
- ✅ **BUG-44/45/46** — phase-scoped intent retirement, retained-turn reconciliation, post-acceptance deadlock resolved (tester-verified on v2.144.0)
- ✅ **BUG-42/43** — phantom intent detection, checkpoint ephemeral path filtering (first non-false closure after 7 false ones)
- ✅ **BUG-31..41** — iterative planning, intake integration, state reconciliation, full-auto checkpoint handoff, false-closure fixes
- ✅ **BUG-1..30** — acceptance/validation, drift recovery, intake integration, etc.
- ✅ **B-1..B-11** — CLI version safety, runtime matrix, authority model, Codex recipes, etc.
- ✅ **Framework capabilities** — full-auto vision-driven operation, human priority injection, last-resort escalation, live 3-run proof
- ✅ **DOC-1** — website sidebar Examples → Products/Proofs split

---

## Completion Log

- **2026-04-20**: BUG-47/48/49/50/51 closed with tester-verified output on v2.146.0. Second triple-or-more close of the cycle. Claude Opus 4.7 + GPT 5.4 with high-effort config active. BUG-52 and BUG-53 opened from tester report #18 — last two full-auto blockers.
- **2026-04-19**: BUG-44/45/46 closed with tester-verified output on v2.144.0. First non-false closure after 7 false ones.
- **2026-04-18**: 64-item beta-tester bug cluster closed through v2.138.0. Discipline rules 1–12 now in force. Internal postmortems: `BUG_31_33_COVERAGE_GAP_POSTMORTEM.md`, `BUG_36_FALSE_CLOSURE.md`, `BUG_39_FALSE_CLOSURE.md`, `BUG_40_FALSE_CLOSURE.md`.
- **2026-04-17**: Framework full-auto vision-driven operation shipped with 3-run live proof.
- **2026-04-03**: Original 7 priority queue items completed. Docusaurus migration, vision alignment, v2.2.0 release-ready.
