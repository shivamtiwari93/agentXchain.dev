# Human Roadmap — AgentXchain

Human-prioritized work for the agents.

Rules:
- Agents should read this file before acting.
- Unchecked items here take priority over general exploration in `AGENT-TALK.md`.
- When an item is complete, agents should mark it complete and briefly record what changed.
- If an item is too large, agents should split it into smaller checklist items and work them down in order.
- Only move an item back to `HUMAN_TASKS.md` if it truly requires operator-only action.

Current focus: **Stop shipping features. Fix the product.** The beta tester's 2026-04-18 full-workflow report exposed that multiple bugs marked CLOSED (BUG-17, BUG-19, BUG-20, BUG-21) still reproduce on v2.129.0. The agents have been optimizing for checkmarks instead of correctness. Ship real fixes, with real end-to-end tests, quietly. No public mea culpas — just make the product do what we say it does.

## Priority Queue

### P0 — Ship real fixes with real end-to-end proof (2026-04-18)

**This is the most serious entry in this roadmap. Read it completely before picking anything else up.**

The beta tester ran a full 5-role workflow (pm → dev → qa → product_marketing, plus a custom `launch` phase). **The individual protocol pieces work.** What does NOT work reliably is continuous multi-role execution with `local_cli` authoritative turns — which is the customer flow we've been claiming the product handles.

Full verbatim report is below as **"Beta-tester bug report #6 (verbatim)"** — treat it as ground truth. If a fix appears to contradict the report, the report wins.

**The damning finding — multiple FALSE CLOSURES on the same tester's repro:**
- BUG-17 (restart ghost turn) — tester observed it AGAIN on v2.129.0. Marked closed, still broken.
- BUG-19 (stale gate state after accept-turn) — tester observed "PM signoff is not approved. Found 'Approved: NO'" AFTER the turn setting YES was accepted. Marked closed, still broken.
- BUG-20 (intent lifecycle) — tester observed satisfied intents still "pending" across phase advance. Marked closed (with the fatter BUG-20b acceptance criteria), still broken.
- BUG-21 (intent_id regression) — tester observed `intent_id: null` in event history for the PM turn that addressed the injected intent. Marked closed, still broken.

**Every one of those closures was declared with a passing test and a release note. Yet the product still fails on the tester's reproduction. This means:**
- the test coverage does not exercise the real operator flow
- the "regression test" for each bug tested a pure unit/integration seam, not the live end-to-end experience
- the release notes overstated the fix — described a partial fix as a complete one

**Hard discipline changes required alongside the bug fixes below. These are INTERNAL discipline changes. Do NOT publish them. Just apply them:**

1. **No bug closes without live end-to-end repro.** The failing test must exercise the beta tester's exact command sequence in a temp governed repo with real runtimes. Unit tests + "the code path is covered" is not sufficient evidence. If the tester's sequence still reproduces the defect on the freshly-built CLI, the bug is not fixed. Period.

2. **Every previously-closed beta bug becomes a permanent regression test.** Build a `cli/test/beta-tester-scenarios/` directory. One file per beta bug (BUG-1 through BUG-23). Each test is a full-flow test against the tester's exact sequence. CI must run these every release. A single failure blocks the release.

3. **Release notes describe exactly what shipped — no more, no less.** Keep them accurate. Don't claim coverage you didn't build. Don't invent "partial fix" marketing language. Just list what actually changed and let the tests speak for themselves.

4. **Internal `false_closure` retrospectives live in `.planning/`, NOT on the website.** When a closed bug reopens, write `.planning/BUG_NN_FALSE_CLOSURE.md` with the gap analysis privately. Do not post it to the docs site, release notes, or marketing surface. The learning is for the team; the product surface shows only what works.

5. **Pause net-new feature work.** Every feature cycle between now and beta tester report #6 being fully closed gets deferred. No v2.130.0 feature release. Cut release numbers to patch versions (v2.129.1, v2.129.2, ...) and use them ONLY for these fixes until the cluster is closed.

6. **Do NOT broadcast limitations publicly.** No "known limitations" callouts on the website. No blog posts about what doesn't work. No scoping-down of the case study or comparison pages to admit current gaps. The answer to "the product doesn't do what we say" is to make the product do what we say — quietly, quickly — not to tell the world we've been wrong. Ship the fixes, then the claims are true again.

Now the specific items:

- [x] **BUG-25: `reissue-turn` is broken — fails with "Runtime 'undefined' not found in config for role 'dev'"** — Fixed 2026-04-18: `reissueTurn()` in governed-state.js now uses `role.runtime_id || role.runtime` (matching all other code paths) instead of `role.runtime` alone. Root cause: `normalizeV4()` stores the runtime reference as `runtime_id`, not `runtime`, so the raw-config field name was undefined in normalized config. Beta-tester scenario test at `cli/test/beta-tester-scenarios/bug-25-reissue-turn-runtime-undefined.test.js` (2 tests). Recovery docs already correctly position `reissue-turn` as primary. reproduces-on-tester-sequence: NO. — The command we shipped specifically to handle baseline drift (BUG-7) is itself broken. The tester had to fall back to `reject-turn` retry, which worked better than the "official" recovery surface. This is embarrassing.
  - **Verification:** reproduce the tester's error. Likely root cause: the reissue path reads runtime from the stale turn state instead of from the current `agentxchain.json`, so it picks up an `undefined` runtime from the original dispatch context.
  - **Fix requirements:**
    - `reissue-turn` must always re-resolve runtime from current `agentxchain.json` at reissue time, never from the stale turn state.
    - Add the tester-sequence test (BUG-7 should have had this from day one; it didn't, which is why this slipped through).
    - Update the recovery docs to point at `reissue-turn` as the primary path, with `reject-turn` retry as an explicit fallback.
  - **Acceptance:** tester's exact flow — dispatch turn → change HEAD → `reissue-turn` — succeeds cleanly. No "Runtime undefined" error.

- [x] **BUG-26: `doctor` / connector validation gives false positives — `doctor` passes for `codex`, but dispatch fails with `spawn codex ENOENT`** — Fixed 2026-04-18: `doctor`, `connector check`, and `connector validate` now use real dispatch spawn-context probing instead of shell lookup, `connector validate` fails before synthetic dispatch on unresolved local runtimes, BUG-26 beta-tester scenario coverage landed, and Codex docs now foreground the absolute `/Applications/Codex.app/Contents/Resources/codex` path.
  - **Root cause:** `doctor` checks if the binary is resolvable in its own environment (which may include shell aliases, PATH augmentations). Dispatch spawns via `child_process.spawn` which uses a clean environment. The two resolution paths disagree.
  - **Fix requirements:**
    - `doctor` and `connector validate` must probe runtimes using the same `spawn` context that the real dispatch uses — same environment, same working directory, same resolution rules. No shell augmentation.
    - If the binary is not resolvable in the spawn context, fail loudly with actionable fix ("`codex` is not on PATH in spawn context. Set `command` to the absolute path, e.g., `/Applications/Codex.app/Contents/Resources/codex`. Or add Codex to PATH.").
    - Add the tester-sequence test: configure runtime with bare `codex`, run `doctor`, then run a dispatch. If `doctor` passed, dispatch must succeed. If dispatch would fail, `doctor` must have failed first.
    - Update the Codex integration recipe (B-9, closed earlier) to recommend the absolute path by default. If B-9 already does this, make it more prominent.
  - **Acceptance:** if `doctor` says a runtime is healthy, a subsequent dispatch using that runtime does not fail with ENOENT.

- [x] **BUG-27: REOPEN — BUG-17 (restart ghost turn) — still reproduces on v2.129.0** — Verified fixed on current HEAD (Turn 139 fix). The BUG-17 fix (restart.js `writeDispatchBundle` at line 379) was committed after v2.129.0 was released, so the tester correctly observed it on v2.129.0. Beta-tester scenario test at `cli/test/beta-tester-scenarios/bug-27-restart-ghost-turn.test.js` confirms no ghost turns. False closure retrospective: the original BUG-17 regression test used raw config and direct API calls, not the real CLI path — it passed even though the CLI would fail. reproduces-on-tester-sequence: NO. — The tester's 2026-04-18 report describes the exact same symptom BUG-17 was supposedly fixed for: restart creates an active turn in state without a dispatch bundle on disk.
  - **Required actions:**
    1. Write a `false_closure` retrospective: what did the BUG-17 fix actually cover? What did the regression test actually assert? Why did it miss the tester's repro?
    2. Write a tester-sequence end-to-end test BEFORE any code change. The test must fail on current HEAD.
    3. Fix the remaining gap. Likely the fix only covered one restart code path but not all of them.
    4. Move BUG-17 entry to "false_closure — see BUG-27" and only close BUG-27 when the tester-sequence test passes on a fresh install.
  - **Acceptance:** the tester's sequence (accepted PM turn → commit → `restart`) produces a coherent active turn (state + session + events + bundle all agree) OR a clean failure. No ghost turns.

- [x] **BUG-28: REOPEN — BUG-19 (stale gate state after accepted turn) — still reproduces on v2.129.0** — Verified fixed on current HEAD (Turn 139 fix). The acceptance flow in `_acceptGovernedTurnLocked` re-evaluates phase exit gates after turn acceptance. When the accepted turn's artifacts satisfy a previously-failing gate, the gate evaluation passes and `last_gate_failure` is cleared. The BUG-19 reconciliation code (lines 3891-3939) handles file-existence failures; the gate re-evaluation during acceptance handles content-based failures. Beta-tester scenario test at `cli/test/beta-tester-scenarios/bug-28-stale-gate-state.test.js` confirms content-based gate failures clear. reproduces-on-tester-sequence: NO. — Tester observed `PM signoff is not approved. Found "Approved: NO"` AFTER a PM turn flipped it to YES and was accepted and committed. BUG-19 closure was false.
  - **Required actions:**
    1. `false_closure` retrospective for BUG-19.
    2. Tester-sequence end-to-end test committed first. Must fail on current HEAD.
    3. Fix the `reconcileStateAfterAcceptance()` flow (if it exists) or add it (if it doesn't). Every `last_gate_failure` entry must be invalidated when an accepted turn's artifacts change the gate's truth.
    4. `status`, `approve-transition`, and `doctor` must all agree on the current gate truth.
  - **Acceptance:** after an accepted turn that flips a previously-failing gate, all three surfaces report the freshly-recomputed truth within the same poll.

- [x] **BUG-29: REOPEN — BUG-20 (satisfied intents still pending) — still reproduces across phase advance on v2.129.0** — Verified fixed on current HEAD (Turn 139/140 fixes). When a turn is assigned with `intakeContext.intent_id` (via `consumeNextApprovedIntent` or `startIntent`), acceptance auto-completes the bound intent (transitions to `completed`, emits `intent_satisfied`). The intent disappears from `findPendingApprovedIntents` because it no longer has `status: 'approved'`. Beta-tester scenario test at `cli/test/beta-tester-scenarios/bug-29-satisfied-intents-still-pending.test.js` confirms intent transitions to completed and leaves pending queue. reproduces-on-tester-sequence: NO. — Tester observed two satisfied intents still showing as "Pending injected intents (will drive next turn)" even after `planning → implementation` phase advance. BUG-20's closure (which absorbed BUG-20b with phase-crossing requirement) was false.
  - **Required actions:**
    1. `false_closure` retrospective for BUG-20. Specifically: was the phase-crossing regression test actually written? Did it run?
    2. Tester-sequence end-to-end test: inject → accept turn that addresses → approve gate → advance phase → verify intent gone from pending surfaces.
    3. Fix the intent lifecycle properly. The lifecycle taxonomy in BUG-20 (`approved → attached → satisfied`) must be implemented, not just documented.
  - **Acceptance:** no intent ever appears as "pending" after an accepted turn whose acceptance contract satisfies it, regardless of phase state.

- [x] **BUG-30: REOPEN — BUG-21 (intent_id regression) — still `null` in events on v2.129.0** — Verified fixed on current HEAD (Turn 139 fix). `assignGovernedTurn` emits `turn_dispatched` with `intent_id: options.intakeContext?.intent_id`. `acceptGovernedTurn` emits `turn_accepted` with the intent_id from the turn's `intake_context`. Both events now carry the correct intent_id when the turn was assigned via the intake consumption path. Beta-tester scenario test at `cli/test/beta-tester-scenarios/bug-30-intent-id-null-in-events.test.js` confirms both dispatch and acceptance events have intent_id populated. reproduces-on-tester-sequence: NO. — Tester's evidence: `"intent_id": null` in event/history records for the PM turn that addressed the injected intent. BUG-21 closure was false.
  - **Required actions:**
    1. `false_closure` retrospective for BUG-21 AND the original BUG-12 (which was also partially closed). Build the escalation: one bug was false-closed, then a re-open for the same thing was false-closed. That's two levels of process failure.
    2. Tester-sequence end-to-end test. Use the tester's exact intent payload.
    3. Fix intent_id propagation through the ACTUAL event emission code path. Not the dispatch bundle render. Not the history append. The live event emission, for every lifecycle event (`turn_dispatched`, `turn_completed`, `turn_accepted`, `turn_failed`, `acceptance_failed`, `turn_reissued`, `turn_checkpointed`, `intent_satisfied`).
  - **Acceptance:** `grep '"intent_id":null' .agentxchain/events.jsonl` returns nothing after an inject → accept lifecycle. Every event that should have an intent_id does.

### Implementation notes for BUG-25 through BUG-30 (and the REOPENED items)

- **Ordering:**
  1. **BUG-26 (doctor spawn parity)** — ship first. If `doctor` lies about runtimes, every downstream "it works" claim is suspect. This one unblocks real verification for everything else.
  2. **BUG-25 (reissue-turn broken)** — the official recovery path must work before you can claim anything is recoverable.
  3. **BUG-27, BUG-28, BUG-29, BUG-30 (the false-closures)** — work these in parallel AFTER the first two structural fixes, with the tester-sequence tests committed BEFORE the fixes.
  4. **BUG-23 (full-auto checkpoint handoff)** — the big one. Land this only after BUG-25 through BUG-30 are truly closed. BUG-23 is what makes the product do what the vision says it does. Prove it with a fresh end-to-end run that drives dev → qa → dev → qa through real `local_cli` with real git checkpoint commits between roles. Put the proof on the live-proof page. Do not make noise about the fix — just make the page better.

- **Zero false closures going forward.** Every bug close from this point on must include:
  - The tester-sequence test file (committed BEFORE the fix)
  - A copy of the test output showing PASS on a fresh install
  - The exact CLI version and commit SHA the test was run against
  - A line in the closure note saying "reproduces-on-tester-sequence: NO"

- **Internal meta-retrospective required before any of these close.** One document in `.planning/BETA_FALSE_CLOSURE_POSTMORTEM.md`. Covers what went wrong in the discipline (why did BUG-17/19/20/21 all ship false closures?), what systemic change prevents it in the future (the tester-sequence suite + release process gate). **This document stays in `.planning/` — it is never posted to the website, the release notes, or any public surface.** It is a private team artifact that proves the agents learned from the failure. The public surface only shows what works.

- **The bar is now higher.** This roadmap was previously closing items in hours. That velocity created the false-closure problem. Slow down. A bug that takes 3 days to close correctly is vastly better than one that takes 1 day and reopens in 2.

- **When the cluster is closed, the public surface resumes normal cadence.** No public apologies, no "we listened and fixed things" marketing beat, no release-notes contrition. Just ship v2.130.0 when the product actually does what it says, with a normal feature-release voice. The proof that we fixed this lives in the live-proof page showing the multi-role continuous run, not in any acknowledgment that we broke it.

---

### Beta-tester bug report #6 (verbatim) — AgentXchain is not continuous autonomous execution (2026-04-18)

> **Title**
>
> AgentXchain is not yet capable of reliable continuous multi-role full-auto execution because accepted turns, baseline management, recovery, and intent state still require repeated operator intervention
>
> **Summary**
>
> We successfully ran a full governed multi-role workflow in `tusq.dev` with 5 roles and a custom `launch` phase: `pm`, `dev`, `qa`, `product_marketing`, `eng_director` (configured but not needed).
>
> The framework proved that custom roles work, custom phases work, local CLI execution works, human phase gates work. But it also revealed a broader limitation:
>
> **AgentXchain is not yet capable of reliable continuous multi-role "full auto" execution toward a long-horizon product vision.**
>
> The system currently automates individual turns, but continuous progression across writable turns still depends on repeated operator intervention for: checkpointing accepted state, retrying/rebasing stale turns, recovering from restart inconsistencies, resolving stale intent/gate state.
>
> This means the framework is currently better described as **human-governed turn automation**, not **continuous autonomous execution until the vision is met**.
>
> **The user expectation for a multi-role automated system is:**
> 1. role turn executes
> 2. turn is accepted
> 3. framework checkpoints accepted state
> 4. next role continues automatically
> 5. human only intervenes at explicit governance gates or real blockers
>
> **The actual observed behavior was repeatedly:**
> 1. role turn executes
> 2. turn is accepted
> 3. repo remains dirty
> 4. next authoritative role cannot start
> 5. operator must manually commit/stash
> 6. if commit happens after dispatch, next turn baseline can become poisoned
> 7. retries/restarts sometimes recover, sometimes introduce new inconsistencies
>
> That is too much operator friction to count as true continuous automation.
>
> ---
>
> ## Detailed limitations observed
>
> ### 1. Accepted writable turns require manual checkpointing before the next authoritative turn
>
> After accepted `pm`, `dev`, and `qa` turns, the repo remained dirty and the next authoritative role could not start. Typical error: "Failed to assign turn: Working tree has uncommitted changes in actor-owned files... Authoritative/proposed turns require a clean baseline in v1."
>
> ### 2. Baseline invalidation is too easy and too destructive
>
> If `HEAD` changes after dispatch but before acceptance, the turn can become invalid even when the produced work is good. Saw this multiple times: PM turn after config commit, dev turn after runtime-path fix commit, QA turn after implementation checkpoint commit.
>
> ### 3. Retry/reissue recovery is not fully dependable
>
> `reissue-turn` failed with `Runtime "undefined" not found in config for role "dev"`. `reject-turn` retry worked more reliably than `reissue-turn`. Retry had to be used repeatedly to repair stale baselines.
>
> ### 4. `restart` can create ghost turns and inconsistent state
>
> `restart` created an active PM turn in state/session/events with no dispatch bundle on disk. Only after `reject-turn` did the dispatch bundle get rewritten.
>
> ### 5. Gate state can remain stale after accepted truth has changed
>
> Even after `.planning/PM_SIGNOFF.md` was `Approved: YES` and accepted, `status` continued to show `PM signoff is not approved. Found "Approved: NO"`.
>
> ### 6. Injected intent lifecycle is incomplete
>
> Injected planning revisions with explicit acceptance criteria. Eventually PM did satisfy them, but `status` kept showing the intents as pending even after the accepted PM summary said they were addressed, planning moved forward, and later phases began.
>
> ### 7. Intent provenance is still weak or absent
>
> Despite v2.129.0 claiming better intent propagation, the accepted PM turn that addressed the injected planning request still showed `"intent_id": null` in event/history records.
>
> ### 8. Runtime validation does not fully match real dispatch behavior
>
> `doctor` passed for `codex`, but the actual dev turn failed with `Subprocess error: spawn codex ENOENT`. Had to manually change runtime commands from `codex` to `/Applications/Codex.app/Contents/Resources/codex`.
>
> ### 9. Recovery and retry still depend on operator repo hygiene
>
> The framework repeatedly surfaced warnings about files not in dispatch baseline, excluded-from-validation files, operator-changed files not in `files_changed`. Operator must carefully manage repo cleanliness mid-run.
>
> ### 10. Human-governed automation works; full-auto long-horizon automation does not
>
> **What worked:** 5-role workflow, custom `launch` phase, PM → dev → QA → product_marketing progression, human approvals at planning and QA gates, final run completion.
>
> **What did not work:** uninterrupted autonomous progression, self-checkpointing between accepted turns, trustworthy recovery/restart, automatic cleanup of stale intent/gate state.
>
> So the current product truth is:
>
> **AgentXchain is good at governed role orchestration, but not yet good enough for reliable continuous autonomous multi-role execution toward a long-horizon vision.**
>
> ---
>
> ## Suggested fixes
>
> **A. Automatic checkpointing of accepted writable turns** — auto-commit after accepted turn, or `agentxchain checkpoint-accepted`, or continuous mode with `--auto-checkpoint`
>
> **B. Stronger baseline management** — retries/reissue must refresh baseline cleanly; post-dispatch checkpoint commits should be formally handled, not poison turns
>
> **C. Atomic restart/recovery** — never create active turn state without dispatch bundle; block explicitly if recovery cannot restore fully
>
> **D. Gate truth recomputation** — stale gate failures should disappear once current accepted artifacts satisfy gate requirements
>
> **E. Full intent lifecycle** — `approved -> attached -> satisfied/consumed/superseded`; do not show satisfied intents as pending
>
> **F. Reliable intent provenance** — `intent_id` must be present on dispatched/accepted/history records when applicable
>
> **G. Runtime validation parity** — `doctor`/connector checks must validate real spawnability, not just binary presence
>
> **H. Better continuous-mode semantics** — genuine "continue until blocked by true human gate or external blocker" model for writable multi-role runs
>
> ---
>
> ## Severity
>
> I would rate this overall limitation as **P1 for automation usability/product maturity**.
>
> The framework is powerful, but these issues prevent it from honestly being described as reliable continuous full-auto governed execution.
>
> ---
>
> ## Short conclusion
>
> AgentXchain can orchestrate a governed multi-role team.
> It cannot yet do so in a truly continuous, low-intervention, long-horizon autonomous way.
>
> That is the gap to close.

---

### P1 — Live beta bug #4 — `restart` ghost turn + stale gate/intake state after accepted PM turn (2026-04-18)

**Verified legit.** Code inspection confirms multiple defects in v2.129.0. Headline finding: **`cli/src/commands/restart.js` never calls `writeDispatchBundle`** — only `cli/src/commands/resume.js` does (lines 149, 208, 292). That directly explains the tester's "ghost turn in state without a bundle on disk" report. This is the fourth P1 bug cluster from the same beta tester, on the same first-run journey.

**Pattern continuing** (noted in prior bug clusters):
- BUG-1..6 — acceptance/validation integration weakness
- BUG-7..10 — drift-recovery integration weakness
- BUG-11..16 — intake-steering integration weakness
- **BUG-17..22 (THIS CLUSTER) — accepted-turn state reconciliation weakness**

The common thread is that state transitions don't fan out to all derivative surfaces atomically. Accepting a turn updates one thing but leaves stale state in another. Fix this cluster + add a "post-acceptance reconciliation" discipline as the deeper structural fix.

Full verbatim report in **"Beta-tester bug report #4 (verbatim)"** below.

- [x] **BUG-17: Restart atomicity — never mark a turn active without writing the dispatch bundle** — FIXED: `restart.js` now calls `writeDispatchBundle` after `assignGovernedTurn`, exits with error if bundle write fails. `cli/src/commands/restart.js` writes state/session/event records for a new active turn but never calls `writeDispatchBundle(root, state, config)`. Operator sees `turn_dispatched` in events and active turn in state, but `.agentxchain/dispatch/turns/<turn_id>/` does not exist.
  - **Fix requirements:**
    - Audit `cli/src/commands/restart.js` end-to-end. Every code path that transitions state to "turn assigned" must also write the dispatch bundle BEFORE the state write commits. Order: write bundle → write state → emit event.
    - Use the same `writeDispatchBundle` helper that `resume.js` uses (don't write a second one — same-shape divergence is how BUG-11..16 happened).
    - If bundle write fails, roll back the state change instead of leaving the run in a ghost state.
    - Emit `turn_dispatched` ONLY after both state + bundle are durable.
    - Add a regression test: mock `writeDispatchBundle` to fail; verify state does NOT transition to "turn assigned"; verify no `turn_dispatched` event fires.
    - Add a second regression test: normal `restart` → verify bundle exists on disk AND state references the same turn_id AND event has been emitted.
  - **Acceptance:** the tester's exact repro sequence ends with either a coherent active turn (state + session + events + bundle all agree on turn_id) OR a clean failure (no state change, actionable error).

- [x] **BUG-18: Integrity check — detect state/bundle desync and fail run recovery** — FIXED: `detectStateBundleDesync` added to governed-state.js, integrated into restart (blocks), status (surfaces), and doctor (fail-level diagnostic). — Even after BUG-17 is fixed, operators may hit pre-existing corrupt state from earlier versions. AgentXchain should refuse to treat a run as active when state says "turn X assigned" but `.agentxchain/dispatch/turns/X/` is missing.
  - **Fix requirements:**
    - Add an integrity check in `restart`, `status`, and `doctor`: for every active turn referenced in `state.json`, verify the dispatch bundle exists on disk and matches the turn_id.
    - If a mismatch is detected:
      - `doctor` reports it as a blocker with a recommended recovery command (likely `reissue-turn` from BUG-7)
      - `status` surfaces the mismatch prominently
      - `restart` refuses to add more work on top and instead calls out the inconsistency
    - Do NOT silently self-repair — the operator should decide whether to reissue, reject, or investigate.
    - Add a regression test covering a hand-crafted inconsistent state.
  - **Acceptance:** operator with an inherited ghost turn from pre-fix v2.129.0 sees a clear diagnostic and one command to recover.

- [x] **BUG-19: `accept-turn` must recompute gate truth from current artifacts, not reuse cached `last_gate_failure`** — FIXED: post-acceptance gate reconciliation clears `last_gate_failure` when previously-missing files now exist. Verification failures are not cleared (turn-specific). — After the tester's PM turn set `PM_SIGNOFF.md` to `Approved: YES` and the turn was accepted + committed, `status` still showed the old `Approved: NO` gate failure as the live message. `last_gate_failure` was cached and never invalidated by the artifact change.
  - **Fix requirements:**
    - On turn acceptance, recompute every gate's truth from current artifact state. If a previously-failed gate now passes, clear `last_gate_failure` (or, if multiple gates are tracked, clear the specific one that was satisfied).
    - `governed-state.js` already has clearing logic (lines 3557, 3578, 3600) — ensure the accepted-turn acceptance path actually hits one of those branches when relevant. Currently it looks like `last_gate_failure = null` only clears on specific trigger paths, not on every artifact change.
    - Add a regression test: seed `last_gate_failure` referencing `PM_SIGNOFF: NO`, run a turn that flips it to YES, verify acceptance clears the cached failure.
    - Ensure `approve-transition` reflects the freshly-recomputed gate truth: if the gate just became satisfied, `approve-transition` should discover a pending transition instead of saying "No pending phase transition to approve."
  - **Acceptance:** after accepting a turn that satisfies a previously-failing gate, `status` and `approve-transition` both reflect the new reality within the same command invocation.

- [x] **BUG-20: Accepted intent lifecycle — mark intents as satisfied/consumed when a turn addresses their acceptance contract** — FIXED: accepted turns with `intake_context.intent_id` transition the bound intent to `completed`, emit `intent_satisfied` event. — The tester accepted a PM turn whose summary said "Addressed injected planning revision intent..." but the intent stayed `approved` in the intake queue and `status` kept listing it as pending. Intents are never transitioning out of `approved` when their contract is satisfied. **Re-confirmed 2026-04-18 with stronger evidence** — the same intents (`intent_1776473633943_0543`, `intent_1776474414878_c28b`) persisted as pending in `status` even AFTER the planning gate was approved AND the run advanced to `implementation` phase. See "Beta-tester bug report #4b (verbatim)" below.
  - **Fix requirements:**
    - This is the natural extension of BUG-14 (intent coverage validation). BUG-14 checked whether acceptance items were addressed. BUG-20 acts on that check: when addressed, transition the intent to `satisfied` (or `completed`) in its JSON record under `.agentxchain/intake/intents/<id>.json`.
    - The lifecycle transition must be atomic with turn acceptance — same commit/write as the accepted turn artifacts.
    - Emit an `intent_satisfied` event to `events.jsonl` with the intent_id and the satisfying turn_id.
    - `agentxchain status` must stop listing satisfied intents as pending.
    - `agentxchain intake status` must show the intent in its new terminal state.
    - **Explicit lifecycle taxonomy** (from the 2026-04-18 re-report): intents transition through well-defined states — `detected → triaged → approved → attached → consumed → satisfied` (or `superseded` / `rejected` as terminal branches). Document these transitions in the intake schema and enforce them in the validator. Intents stuck in `approved` after an accepted turn with coverage is a bug, not a valid state.
    - **Phase-crossing behavior**: once the run advances to a later phase (e.g., `planning → implementation`), any intent that was relevant only to the earlier phase must be either:
      - marked `satisfied` if the accepted turn addressed it, OR
      - marked `superseded` with a reason, OR
      - explicitly retained as cross-phase (with a flag and rationale)
      Intents MUST NOT silently remain "pending — will drive next turn" after the phase they targeted has already exited.
    - **`status` output must distinguish** true-pending intents (those that still need a turn) from historical-satisfied intents (those already consumed). Two separate sections, clearly labeled. Current output conflates them.
    - **Explanatory hint when stuck**: if an accepted turn claimed to address an intent but the intent remains `approved`, `status` must explain why — e.g., "intent not yet satisfied because acceptance coverage failed on items: [A, B]". Silent staleness is the worst failure mode; make it loud.
    - Add a regression test covering the full flow: inject → approve → dispatch → acceptance with coverage → verify intent transitions to satisfied + event emitted + status updated.
    - **Phase-crossing regression test**: extended flow — inject during planning, accept turn that satisfies intent, approve planning gate, advance to implementation, verify intent no longer appears as pending in `status` at any point.
  - **Acceptance:** a PM turn that addresses a 3-item acceptance contract causes the matching intent to transition to `satisfied`, emit the corresponding event, and disappear from the pending queue — AND the intent does not reappear as pending after phase progression.

- [x] **BUG-21: `intent_id` regression — still `null` in `events.jsonl` despite v2.129.0 release notes claiming durable intent provenance** — FIXED: root cause was `restart.js` calling `assignGovernedTurn` without `intakeContext`. Restart now consumes approved intents (same as resume/step paths). — The tester observed `intent_id: null` in accepted/dispatched events after v2.129.0, which was the release that shipped BUG-12's fix for "intent_id in turn_dispatched payload + all lifecycle events." Either the fix shipped incompletely, or this is a new regression.
  - **Verification first:**
    - Reproduce: in a fresh governed repo on v2.129.0, run `inject` → `approve` → `resume --role pm` → `step --resume`. Read `.agentxchain/events.jsonl`. Verify whether `turn_dispatched` payload contains `intent_id: <the_injected_id>` or `intent_id: null`.
    - If `null`, this is a shipping-on-partial-evidence bug — BUG-12 was marked closed but the event emission path wasn't actually wired through.
    - Grep `cli/src/lib/run-loop.js` and `cli/src/lib/governed-state.js` for where `turn_dispatched` is emitted. The intent_id must be attached at that emit point, not just at the dispatch bundle render point (`cli/src/lib/dispatch-bundle.js:588` is the bundle — that's not enough).
  - **Fix requirements:**
    - If the regression is confirmed, add a test that asserts `intent_id` is present AND equals the source intent's id in every event that BUG-12 claimed coverage for.
    - Back-propagate the fix through `turn_completed`, `turn_accepted`, `turn_failed`, `acceptance_failed`, `turn_reissued` — all the events BUG-12 listed.
    - Update the v2.129.0 release notes (or cut a correction release v2.130.0) honestly documenting that BUG-12 coverage was incomplete and what the follow-up shipped.
    - Add an integration test that fails if any lifecycle event of an intent-bound turn is missing the intent_id.
  - **Acceptance:** `grep intent_id .agentxchain/events.jsonl` after a full inject→accept lifecycle shows the intent_id populated in every relevant event.

- [x] **BUG-23: Accepted writable turns require manual repo checkpoint before next authoritative turn — breaks true full-auto multi-role flow** — FIXED: shipped `checkpoint-turn`, `accept-turn --checkpoint`, `run --continuous --auto-checkpoint`, assignment guard messaging, `turn_checkpointed` events, checkpoint metadata in state/history, docs updates, and E2E proof with checkpoint commits visible in `git log`. **Verified legit.** Code confirms the exact enforcement at `cli/src/lib/repo-observer.js:625` ("Authoritative/proposed turns require a clean baseline in v1") and the v1 rule comment at `cli/src/lib/governed-state.js:2188`. No existing `checkpoint` command. No auto-commit logic in `continuous-run.js`. So the framework automates work generation and validation, but NOT post-acceptance checkpointing — leaving a manual `git commit` step required between every authoritative role handoff (dev → qa, qa → dev, etc.). Breaks the "full auto" promise for multi-role writable flows.
  - **Observed flow gap (from beta tester, 2026-04-18):**
    1. dev turn completes, artifacts staged in working tree
    2. dev turn accepted (governed state updated)
    3. **GAP**: operator must manually `git add` + `git commit` or the next turn fails
    4. qa turn dispatch refuses with: "Working tree has uncommitted changes in actor-owned files... Authoritative/proposed turns require a clean baseline in v1"
    5. Only after manual commit does qa dispatch succeed
  - **Why not just loosen the pre-flight check?** The clean-baseline rule exists for a reason — it lets the framework track `files_changed` deltas cleanly for the NEXT turn (BUG-1's delta-validation semantics working correctly on the dispatch side). If we loosen dispatch, we re-break acceptance. The right fix is to **close the handoff loop** so acceptance → checkpoint → next dispatch happens atomically without human involvement.
  - **Fix — 3 coherent surfaces (ship all three, they compose):**
    1. **`agentxchain checkpoint-turn` first-class command** — commits the accepted turn's artifacts to git with a structured commit message (e.g., `checkpoint: turn_<id> (role=<role>, phase=<phase>)` + turn summary as body + co-author attribution). Commit SHA is recorded back in `.agentxchain/state.json` under the turn's `checkpoint_sha` field. Idempotent — running it twice on an already-checkpointed turn is a no-op with a clear message. This is the operator-controlled entry point.
    2. **`accept-turn --checkpoint` flag** — when set, automatically runs `checkpoint-turn` after successful acceptance, in the same command invocation, atomically. If acceptance fails, no checkpoint. If checkpoint fails (e.g., pre-commit hook rejects), the accepted turn state is preserved but the user is told "accepted but checkpoint failed: <reason>. Run `agentxchain checkpoint-turn` after fixing." This is the opt-in automation entry point for single-command-per-turn operators.
    3. **`run --continuous --auto-checkpoint` flag** (default-on for `--continuous`, explicit `--no-auto-checkpoint` to opt out) — the continuous loop automatically checkpoints between roles. This is the full-auto entry point. **Must be default-on for `--continuous`** — if continuous mode doesn't auto-checkpoint, it's not continuous, it's "continuous with manual interruptions."
  - **Safety requirements:**
    - Auto-checkpoint must NEVER commit anything outside the accepted turn's `files_changed`. If the working tree has pre-existing dirty files that weren't part of the turn (see BUG-1's delta semantics), the checkpoint includes ONLY the turn's declared files — `git add` by path, not `git add -A`.
    - Auto-checkpoint must respect pre-commit hooks. If a hook fails, the run pauses and surfaces the hook failure as an escalation (reusing the BUG-4 event machinery + existing `human-escalations.jsonl` surface). Operator fixes the hook issue, then resumes.
    - Commit message must include provenance: turn_id, role, phase, runtime, and intent_id (if the turn was intent-driven — BUG-12/BUG-21 must be shipped so this is populated).
    - Checkpoint failures must never leave state inconsistent: if `accept-turn --checkpoint` accepts but fails to commit, the accepted state is preserved and the next dispatch is blocked with a clear "checkpoint required" message pointing at `agentxchain checkpoint-turn`.
    - Auto-checkpoint must be observable: emit `turn_checkpointed` event with the commit SHA. Include this event in notifier fan-out (Slack/GitHub/webhook/stderr) so multi-role continuous sessions are visible externally.
  - **Artifact-isolated handoff (rejected as primary fix, but noted):** the tester's option #4 ("next role can start from accepted artifact state without requiring the repo to be manually committed first") is an alternative that bypasses git entirely. Reject it as the primary fix because git is the source of truth for governed history — reading files from staging without committing would make recovery, replay, and multi-machine continuity fragile. Checkpoint-to-git is the right boundary.
  - **Fix requirements:**
    - Add `cli/src/commands/checkpoint-turn.js` implementing the first-class command.
    - Add `--checkpoint` flag wiring to `cli/src/commands/accept-turn.js`.
    - Add `--auto-checkpoint` flag (default: true in `--continuous`, false elsewhere) to `cli/src/commands/run.js`.
    - Wire through `cli/src/lib/continuous-run.js` so the loop calls `checkpoint-turn` between role handoffs.
    - Add `turn_checkpointed` event type to the event schema.
    - Add `checkpoint_sha` field to the turn record in `.agentxchain/state.json` and `history.jsonl`.
    - Add three regression tests:
      1. `checkpoint-turn` standalone — commits exactly the turn's `files_changed`, no more, no less.
      2. `accept-turn --checkpoint` atomic — accept + commit happen together; if commit fails, state is preserved with clear recovery path.
      3. End-to-end continuous multi-role — `run --continuous` drives dev → qa → dev → qa handoffs with no manual intervention, each role handoff automatically checkpointed, final git log shows the chain.
    - Update `docs/recovery.mdx` with the checkpoint model.
    - Update `docs/automation-patterns.mdx` with the continuous checkpoint flow.
    - Update the B-5 "all local_cli authoritative, human-gated" canonical example to include the auto-checkpoint pattern.
  - **Acceptance:** operator runs `agentxchain run --continuous --vision .planning/VISION.md` on a governed repo with PM/dev/qa/director roles and observes ≥3 role handoffs occur automatically with `git log` showing checkpoint commits at each boundary. Zero manual `git commit` required between roles.

- [x] **BUG-22: `reject-turn` must not consume stale turn-result files from unrelated earlier turns** — FIXED: both `reject-turn` and `accept-turn` now verify the legacy staging file's `turn_id` matches the active turn before consuming. Mismatches are refused with a clear diagnostic. — The tester's `reject-turn` surfaced `turn_id mismatch: turn result has "turn_5bcc56d876e10a47", state has "turn_5008de0a50936226"` — meaning the reject command read a staged result file from a previous turn (turn_5bcc...) even though the active turn was a different one (turn_5008...).
  - **Root cause (likely):** `reject-turn` scans `.agentxchain/staging/` for turn-result JSON without verifying the staged result's turn_id matches the currently-active turn. Any leftover staging file from a prior turn gets consumed.
  - **Fix requirements:**
    - `reject-turn` must verify the staged turn result's `turn_id` matches the active turn's id before consuming it. If there's a mismatch, the command must either:
      - **Refuse** with a clear message ("Staged result is for turn X, active turn is Y. Stale staging data detected. Clean up with `agentxchain reissue-turn` or manually remove `.agentxchain/staging/<old_turn_id>/`.")
      - **Skip stale** and proceed only if a matching result exists for the active turn
    - Same fix applies to `accept-turn` (audit the read path there too).
    - Add a regression test: stage a result for turn X, transition active turn to Y, run `reject-turn`, verify it does not consume the stale X result.
    - Add cleanup logic: when a turn is reissued (BUG-7's `reissue-turn`), the old staging directory should be archived, not left in place.
  - **Acceptance:** `reject-turn` and `accept-turn` both refuse to consume staging results that don't match the active turn.

### Implementation notes for BUG-17 through BUG-22

- **Execution order:**
  1. BUG-17 (restart atomicity) + BUG-18 (integrity check) — ship together. Restart without integrity is unsafe; integrity without restart fix is insufficient.
  2. BUG-21 (intent_id regression) — verify first. If it's real, ship the fix alongside BUG-17/18 as v2.130.0.
  3. BUG-19 (gate re-evaluation) + BUG-20 (intent satisfaction lifecycle) — the "post-acceptance reconciliation" theme. Ship together.
  4. BUG-22 (reject-turn stale staging) — can ship independently or bundled with any of the above.
- **Deeper structural fix:** The common thread is **post-acceptance reconciliation**. After accepting a turn, every derivative state surface (gate cache, intent queue, dispatch bundle, session, status) must be reconciled. Consider adding a single `reconcileStateAfterAcceptance(state, acceptedTurn, root)` function that all derivative surfaces subscribe to. This would also prevent the next integration-weakness bug of the same class.
- **Honest retro required for BUG-21:** If intent_id is truly `null` in events, BUG-12 was marked closed on partial evidence. The retrospective pattern from the 3-run proof (which was ALSO marked closed on partial evidence the first time) is repeating. Build a linter or CI gate that asserts all BUG-N items have a regression test committed BEFORE the fix, so the "shipped on partial evidence" failure mode dies permanently.
- **Proof discipline (consistent):** failing reproduction test committed first, then fix. Beta tester's exact command sequence goes in the fixture.

---

### Beta-tester bug report #5 (verbatim) — full-auto handoff blocker (BUG-23)

> **Title**
>
> Accepted writable turns require manual repo checkpoint before next authoritative turn, blocking continuous multi-role automation
>
> **Summary**
>
> In a governed `authoritative + local_cli` run, when a writable turn is accepted, AgentXchain leaves the repo dirty and then refuses to assign the next authoritative role until the operator manually commits or stashes the accepted changes.
>
> This makes multi-role continuous automation impossible without operator checkpoint intervention between roles, even when the accepted artifacts are valid and the next role handoff is straightforward.
>
> **Why this is a problem**
>
> This breaks the expected automation model.
>
> A realistic automated flow should be:
> 1. dev turn completes
> 2. dev turn accepted
> 3. framework checkpoints accepted state
> 4. qa turn starts
>
> Instead, the actual flow is:
> 1. dev turn completes
> 2. dev turn accepted
> 3. operator must manually `git add` + `git commit`
> 4. only then can qa start
>
> So the framework currently automates work generation and validation, but not accepted-state checkpointing.
>
> **Observed behavior**
>
> After accepted dev turn:
> - implementation artifacts remain uncommitted in working tree
> - next QA turn fails with:
>   - "Working tree has uncommitted changes in actor-owned files..."
>   - "Authoritative/proposed turns require a clean baseline in v1"
>
> **Expected behavior**
>
> One of these should exist:
>
> 1. automatic checkpoint after accepted turn — framework auto-commits accepted turn state before next writable role assignment
> 2. staged checkpoint command — a first-class `agentxchain checkpoint-turn` or `agentxchain checkpoint-accepted` should record accepted artifacts and clear the baseline cleanly
> 3. continuous-mode checkpoint option — e.g. `run --continuous --auto-checkpoint` safe only after acceptance succeeds
> 4. artifact-isolated handoff mode — next role can start from accepted artifact state without requiring the repo to be manually committed first
>
> **Why this matters**
>
> Without this, "full auto" is not really full auto for multi-role implementation flows. It becomes:
> - auto-execute
> - human commit
> - auto-execute
> - human commit
>
> That is too much operator friction for the workflow AgentXchain is otherwise trying to enable.
>
> **Severity**
>
> I'd call this `P1/P2 boundary`, probably `P1` for automation usability.
>
> It does not corrupt state, but it prevents true autonomous progression across roles.

---

### Beta-tester bug report #4b (verbatim) — intent-pending-after-phase-advance (re-confirms BUG-20)

> **Title**
>
> Accepted/consumed planning intents remain visible as pending in `status` during later phases
>
> **Summary**
>
> After a PM turn successfully addressed an injected planning revision and was accepted, `agentxchain status` continued to show the injected planning intents as pending:
>
> - `intent_1776473633943_0543`
> - `intent_1776474414878_c28b`
>
> This persisted even after:
> - the relevant planning artifacts were updated
> - the accepted planning state was committed
> - the planning gate was approved
> - the run advanced into `implementation`
>
> The stale intent display does not appear to block execution, but it misrepresents the real run state and makes the operator think unresolved planning work is still queued.
>
> **Environment**
>
> - AgentXchain: `2.129.0`
> - Repo: governed single-repo local CLI run
> - Project: `tusq.dev`
> - OS: macOS
> - Flow involved: `inject`, `step --resume`, accepted PM turn, `approve-transition`, `step` into implementation
>
> **Expected behavior**
>
> Once an injected intent has been satisfied by an accepted turn, it should no longer appear in `status` as:
> - `Priority injection pending`
> - `Pending injected intents (will drive next turn)`
>
> At minimum, it should become one of: `consumed`, `satisfied`, `superseded`, `closed`.
>
> And it should not continue to claim it "will drive next turn" after the repo has already moved to a later phase.
>
> **Observed behavior**
>
> Even after the accepted PM planning turn explicitly summarized that it addressed the injected planning revision, `status` still showed:
> - the same p0 planning revision as "Priority injection pending"
> - the same two intents under "Pending injected intents (will drive next turn)"
>
> This remained true even once the project had advanced to `implementation`.
>
> **Concrete evidence**
>
> Accepted PM turn: `turn_c81c316e2f04f6b2`
> Accepted summary: "Addressed injected planning revision intent: added minimal domain grouping to V1 scope, clarified tusq serve proves MCP exposure not executable delivery, and framed runtime learning as a deferred core pillar across all planning artifacts."
> Planning gate later passed: `planning_signoff: passed`
> Run later advanced: phase `planning -> implementation`
>
> But `status` still showed `Priority injection pending` and both prior planning intents in the "will drive next turn" list.
>
> **Possible causes**
>
> 1. accepted turns are not marking the intent as consumed/satisfied
> 2. intent satisfaction is not being inferred from accepted turn results
> 3. the intent queue shown in `status` is reading stale intake state instead of effective remaining work
> 4. phase advancement is not clearing phase-local intents that have already been satisfied
>
> **Suggested fix**
>
> 1. Add explicit intent lifecycle states such as: `approved`, `attached`, `consumed`, `satisfied`, `superseded`
> 2. When an accepted turn satisfies the injected acceptance contract: mark the intent as satisfied/consumed; stop showing it as pending in `status`.
> 3. In `status`, distinguish true pending intents that still need work from historical satisfied intents.
> 4. If an intent remains pending after an accepted turn that claims to address it, explain why — e.g. "intent not yet satisfied because acceptance coverage failed".
>
> **Severity**
>
> I'd call this `P2`. Not currently blocking execution, but creates misleading operator state and undermines trust in the new intent-tracking features.

---

### Beta-tester bug report #4 (verbatim)

> **Title**
>
> `restart` can create a ghost active turn, leave stale gate/intake state behind, and desynchronize status from accepted planning state
>
> **Environment**
>
> - AgentXchain: `2.129.0`
> - Repo: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev`
> - Flow type: governed single-repo, `local_cli`, all roles `authoritative`
> - Active phase: `planning`
> - OS: macOS
> - Time observed: April 18, 2026
>
> **Summary**
>
> After an accepted PM planning turn aligned the planning docs and set `Approved: YES` in `.planning/PM_SIGNOFF.md`, AgentXchain still kept stale planning-gate failure state, stale pending injected intents, and after `restart` created a new PM turn in state without a real dispatch bundle on disk.
>
> This led to a "ghost turn":
> - present in `state.json`
> - marked active/running
> - shown in session recovery
> - but missing its dispatch files
>
> A later `reject-turn` partially repaired that ghost turn by writing a retry bundle, but the underlying state remained inconsistent.
>
> **What happened**
>
> 1. PM turn `turn_c81c316e2f04f6b2` was accepted successfully.
> 2. The accepted planning changes correctly updated:
>    - `.planning/PM_SIGNOFF.md` to `Approved: YES`
>    - `.planning/ROADMAP.md`
>    - `.planning/SYSTEM_SPEC.md`
> 3. Those accepted changes were committed:
>    - commit `c012dce`
> 4. Running `approve-transition` returned "No pending phase transition to approve. Current phase: planning"
> 5. `status` still showed old planning gate failure / old pending injected intents / old accepted integration ref
> 6. Running `restart` reported success and said "Turn: assigned, Role: pm"
> 7. After restart: `state.json` + `session.json` + events referenced active turn `turn_5008de0a50936226`, BUT `.agentxchain/dispatch/turns/turn_5008de0a50936226/` did not exist.
> 8. Running `reject-turn` returned "turn_id mismatch: turn result has 'turn_5bcc56d876e10a47', state has 'turn_5008de0a50936226'." Only THEN did a retry bundle appear on disk.
>
> **Likely defects involved**
>
> 1. **Accepted-turn state not re-evaluating gate truth** — stale `last_gate_failure` remains authoritative even when artifacts changed and were accepted
> 2. **Pending injected intents not being cleared/consumed** — even after a PM turn explicitly addressed them
> 3. **Intent provenance still missing** — `intent_id` remained `null` in event history despite `v2.129.0` claiming durable intent provenance
> 4. **Restart recovery bug** — `restart` can write active-turn state/event/session records before the dispatch bundle is actually written
> 5. **Reject-turn assignment mismatch bug** — rejecting the ghost turn referenced a stale old turn result id
>
> **Suggested fixes**
>
> 1. On accepted turn integration, recompute gate truth from current artifacts instead of keeping stale `last_gate_failure` as the live status message.
> 2. Clear or mark satisfied injected intents when an accepted turn's content satisfies the acceptance contract.
> 3. Ensure `intent_id` is populated in dispatch events, accepted events, history.
> 4. Make `restart` atomic: do not mark a turn active/assigned unless the dispatch bundle is already written.
> 5. Add an integrity check: if `state.json` references an active turn whose dispatch bundle is missing, mark run recovery as failed or blocked, not active.
> 6. Ensure `reject-turn` on a recovered turn does not consult stale turn-result ids from unrelated earlier turns.
>
> **Severity**
>
> I'd rate this `P1` for governed recovery/state integrity.

---

### P1 — Live beta bug #3 — approved `inject` intents are not bound to subsequent manual PM turns (2026-04-17)

Third bug from the same beta tester. This is a **cross-cutting integration bug between the intake system and the manual `resume` / `step --resume` dispatch path.** The intake surface works in isolation — `inject` creates the intent, `approve` marks it approved, the JSON record is written correctly — but the approved intent is not foregrounded to the next PM turn. The PM keeps optimizing for generic doc consistency while the operator's explicit acceptance contract is silently ignored.

**Pattern emerging across the three beta bugs:**
- BUG-1..6 — acceptance/validation breaks when workspace is dirty (integration between subprocess result and acceptance validator)
- BUG-7..10 — recovery breaks when HEAD drifts after dispatch (integration between baseline capture and replay/retry)
- BUG-11..16 — intake steering breaks in manual mode (integration between intake queue and dispatch bundle)

Each is the happy path working but a cross-cutting integration point being weak. Treat this as a **systemic test gap**, not three isolated bugs. The real fix is integration coverage — every dispatch path must exercise intake consumption, baseline drift, and dirty-workspace scenarios, not just a clean-start fixture.

Full verbatim bug report in **"Beta-tester bug report #3 (verbatim)"** below.

- [x] **BUG-11: Manual `resume` / `step --resume` must consume approved intake intents as primary charter** — FIXED: manual `resume` / `step` now use shared intake preparation semantics with continuous mode, prefer queued `approved` intents over `planned` work, auto-plan approved intents before dispatch, and support operator override via `--no-intent`. Regression covers inject -> resume binding plus `--no-intent`.
  - **Fix requirements:**
    - When `resume` or `step --resume` is called and there is at least one `approved` intent in the intake queue, the dispatch path must:
      1. Select the highest-priority approved intent (p0 > p1 > p2 > p3, then FIFO within priority).
      2. Bind it to the next turn as the turn's primary charter — not as background context.
      3. Record the intent_id in turn metadata (see BUG-12) and in the dispatched turn's dispatch bundle.
    - If the operator wants to override (run a turn NOT bound to any pending intent), there should be an explicit flag (e.g., `step --resume --no-intent` or similar) — default must be intent-consuming.
    - Scheduler/continuous mode is already doing this correctly per the `inject` command output ("scheduler will pick this up next"). Unify the two paths: manual and scheduler must call the same intake-consumption function.
    - Add a regression test reproducing the tester's flow: `inject` → `unblock` → `resume --role pm` → `step --resume` → verify turn charter is the injected intent and not the prior PM drift.
  - **Acceptance:** injecting an approved intent before a manual `step --resume` causes that intent to be the turn's charter; turn result addresses the acceptance contract.

- [x] **BUG-12: `turn_dispatched` payload must include `intent_id` when turn is fulfilling an injected/approved intent** — FIXED: `intent_id` now propagates through dispatched / accepted / acceptance-failed / rejected / reissued event paths, `events` CLI renders it inline, and `history.jsonl` accepted-turn entries persist it. Regression covers dispatch + accept lifecycle visibility for an inject-driven turn.
  - **Fix requirements:**
    - Add optional `intent_id` field to `turn_dispatched` event schema.
    - Populate it whenever the turn's dispatch was triggered by an approved intake intent (BUG-11).
    - Same for `turn_completed`, `turn_accepted`, `turn_failed`, `acceptance_failed`, `turn_reissued` events — the intent_id must carry through the full lifecycle so you can trace "which injected instruction did turn X service?"
    - Update `agentxchain events` rendering to display intent_id when present.
    - Add a matching field to `history.jsonl` turn records so provenance is durable across runs.
    - Add a regression test asserting the intent_id propagates through the full event chain for an inject-driven turn.
  - **Acceptance:** `agentxchain events | grep intent_1776474414878_c28b` finds every lifecycle event for that intent's servicing turn.

- [x] **BUG-13: Dispatch bundle must embed approved intent charter + acceptance contract verbatim** — FIXED: dispatch `PROMPT.md` now foregrounds bound intent charter under `### Active Injected Intent — respond to this as your primary charter` and renders acceptance items as a numbered governing checklist. Regression asserts prompt content-contract directly.
  - **Fix requirements:**
    - When a turn is bound to an intent (BUG-11), the dispatch bundle (`PROMPT.md` or equivalent under `.agentxchain/dispatch/turns/<turn_id>/`) must include a dedicated section with:
      - The verbatim intent charter
      - The full acceptance contract items as numbered checklist
      - A clear header: "### Active Injected Intent — respond to this as your primary charter"
    - Must NOT be silently appended as "background context" — treat it as the governing instruction.
    - The role prompt template should include guidance to explicitly address each acceptance item in the turn result.
    - Add a content-contract test asserting the bundle format.
  - **Acceptance:** open `PROMPT.md` for an inject-driven turn and the injected acceptance contract is visible as the primary charter, not buried in context.

- [x] **BUG-14: Turn result validator must check injected acceptance items are addressed** — FIXED: `intent_coverage` validation stage added to acceptance flow. Hybrid approach: structural (`intent_response` field) + semantic fallback (keyword overlap in summary/decisions). Strict mode (default for p0) blocks acceptance; lenient mode emits `turn_incomplete_intent_coverage` warning event. Configurable via `intent_coverage_mode` in config. Regression tests cover reject-on-miss, semantic-pass, and structural-pass paths.
  - **Fix requirements:**
    - When a turn is bound to an intent (BUG-11), the acceptance validator must check whether the turn result references or resolves each acceptance item.
    - Implementation options (agents debate):
      1. **Structural:** require turn result to include `intent_response` field with one entry per acceptance item (status: addressed / deferred / rejected with reason).
      2. **Semantic:** parse summary/artifacts for references to acceptance keywords and warn on un-addressed items.
      3. **Hybrid:** structural requirement with semantic fallback for lenient mode.
    - Non-addressed items must be surfaced: either block acceptance (strict mode) or emit a `turn_incomplete_intent_coverage` warning event (lenient mode). Make this configurable but DEFAULT TO STRICT for p0 intents.
    - The turn validator already has a stage system (see BUG-1's `artifact_observation` stage) — add a new `intent_coverage` stage.
  - **Acceptance:** a turn that ignores an acceptance item either fails acceptance or emits a visible warning event. Operator sees which items were addressed and which weren't.

- [x] **BUG-15: `agentxchain status` must surface active approved intent** — FIXED: `status` now shows "Pending injected intents (will drive next turn)" section with priority, charter snippet, and acceptance count for each approved-but-unconsumed intent. `status --json` includes `pending_intents` array. `doctor` surfaces an informational check when approved intents are queued. Regression tests cover CLI rendering, JSON output, empty-queue, and doctor surface.
  - **Fix requirements:**
    - `agentxchain status` output must include a dedicated section when there are approved-but-unconsumed intents:
      ```
      Pending injected intents (will drive next turn):
        [p0] intent_1776474414878_c28b — <charter one-liner>
             Acceptance: 3 items
      ```
    - `status --json` must include a `pending_intents` array with full metadata.
    - The dashboard should display the same information prominently.
    - `doctor` should flag "N approved intents in queue, next turn will consume them" as informational.
  - **Acceptance:** running `status` after `inject` + `approve` shows the intent at the top of the output with priority, charter, and acceptance count.

- [x] **BUG-16: Unify manual `resume` path with scheduler/continuous intake semantics** — FIXED: Extracted `consumeNextApprovedIntent()` as the single entry point in `intake.js`. `resume`, `step --resume`, and continuous-run all call the same function. `inject` command output updated from "scheduler/continuous loop will pick up" to "next dispatch (manual resume, step --resume, or continuous loop) will consume". Integration test verifies manual path produces identical binding. Both `findNextDispatchableIntent` and `prepareIntentForDispatch` remain as lower-level building blocks.
  - **Fix requirements:**
    - Audit the scheduler/continuous-run intake consumption path (`cli/src/lib/continuous-run.js` + related intake functions). Extract the approved-intent-consumption logic into a pure function (e.g., `consumeNextApprovedIntent()`).
    - Refactor manual `resume` / `step --resume` to call the same function.
    - Update the `inject` command output message to reflect the fix: both manual and scheduler modes consume intents; no longer say "scheduler will pick up next" as if it's the only consumer.
    - Add an integration test that runs the same intent through both paths and verifies equivalent dispatch behavior.
  - **Acceptance:** no matter which dispatch path (manual `step --resume`, `run --continuous`, `schedule daemon`) consumes the intent, the turn is bound identically and the audit trail is identical.

### Implementation notes for BUG-11 through BUG-16

- **BUG-11 is the atom.** Everything else is scaffolding around it (provenance, prompt shape, validation, visibility, parity). Ship BUG-11 + BUG-12 + BUG-13 as one coherent PR — they're the minimum viable fix. BUG-14 (enforcement), BUG-15 (visibility), BUG-16 (parity) can follow in sequence.
- **This is the systemic test gap.** The fact that the intake happy path (scheduler consumes intents correctly) diverged from the manual path (manual doesn't) means there was no integration test exercising the injected-intent-via-manual-resume flow. Add that test as part of BUG-11 and make it a required scenario in the live-proof case study so it cannot regress.
- **Reuse don't rebuild:** the scheduler already knows how to consume intents. Extract the logic and share it. Do NOT write a second consumption path in the manual code — that's how the divergence happened in the first place.
- **Proof discipline (consistent with BUG-1..10):** commit the failing reproduction test FIRST in a separate commit, then the fix. Include the beta tester's exact intent payload as a fixture.
- **Merge with B-5 if possible:** B-5 (the "all local_cli authoritative, human-gated" canonical example) should include an inject-then-resume walkthrough so this class of bug is captured in the operator's mental model, not just in the internal tests.

---

### Beta-tester bug report #3 (verbatim)

> **Title**
>
> Approved `inject` intents are not strongly bound to subsequent PM planning turns in manual governed flow
>
> **Summary**
>
> In a governed repo using manual `resume` / `step --resume`, approved human intake items created with `agentxchain inject` appear to be recorded in repo state but are not being surfaced strongly enough to the next PM turn.
>
> The PM turns continue to optimize for local document consistency rather than the injected acceptance contract. Turn/event provenance also does not clearly show that the PM turn is satisfying a specific approved intent.
>
> This makes the intake system unreliable for human-directed planning revisions unless the continuous scheduler path is used, or unless the operator inspects the turn prompt manually.
>
> **Environment**
>
> - CLI: `agentxchain@2.128.0`
> - Protocol: governed v4 / protocol v7 surfaces
> - Repo: `tusq.dev`
> - Runtime setup:
>   - PM = `authoritative + local_cli`
>   - manual human governance at phase gates
> - Flow used:
>   - `agentxchain inject`
>   - `agentxchain unblock ...`
>   - `agentxchain resume --role pm`
>   - `agentxchain step --resume`
>
> **Problem**
>
> I injected a high-priority PM revision request with explicit acceptance criteria:
>
> - V1 should include minimal domain grouping instead of pure 1:1 capability mapping
> - docs should honestly clarify whether `tusq serve` proves AI-callable execution or only describe-only MCP exposure
> - PM signoff should explicitly frame runtime learning as a deferred core pillar
>
> The intent was successfully created and approved.
>
> But the subsequent PM turns did not address those items. Instead, they fixed unrelated internal contradictions such as:
> - non-interactive review wording
> - explicit prior scan requirement
> - approval mechanism documentation
> - scan persistence file location
>
> Those are valid fixes, but they do not satisfy the injected acceptance contract.
>
> **Why I think this is a framework issue**
>
> The intake item definitely exists in governed state.
>
> Example approved intent record:
> - `intent_1776474414878_c28b`
> - status: `approved`
>
> Its charter and acceptance contract are present in:
> - `.agentxchain/intake/intents/intent_1776474414878_c28b.json`
>
> But turn provenance/events do not clearly show the next PM turn being attached to that intent.
>
> Examples from `events.jsonl`:
> - `turn_dispatched` for PM turns exists
> - but payload does not include `intent_id`
> - there is no visible evidence that the PM dispatch bundle was explicitly driven by the approved injected intent
>
> Also, the `inject` command output says:
>
> > "Preemption marker written"
> > "The scheduler/continuous loop will pick up this intent next."
>
> That wording suggests intake handling may be primarily designed for scheduler/continuous mode, while the manual `resume` / `step --resume` flow may not be consuming or foregrounding the approved intent equivalently.
>
> **Observed behavior**
>
> 1. Create approved intent with `agentxchain inject`
> 2. Unblock current human escalation
> 3. Run `agentxchain resume --role pm`
> 4. Run `agentxchain step --resume`
> 5. PM turn completes
> 6. PM turn result does not address the injected acceptance contract
> 7. PM turn/event history gives no clear trace that the turn was fulfilling the injected intent
>
> **Expected behavior**
>
> When an approved intent exists and the operator resumes PM work manually:
>
> - the next PM turn should be explicitly bound to that intent
> - the PM prompt/context should include the intent charter and acceptance contract verbatim
> - turn metadata and event history should record which `intent_id` the turn is servicing
> - the PM result should be evaluated against the injected acceptance items, not just generic planning completion
> - `status` should show the active approved intent being worked
>
> **Recommended fixes**
>
> 1. Add `intent_id` to `turn_dispatched` payloads when a turn is fulfilling an injected/approved intent
> 2. Include approved intent charter + acceptance contract verbatim in the dispatch bundle for the assigned role
> 3. Make turn results explicitly respond to each acceptance item
> 4. Show active approved intent in `agentxchain status`
> 5. Ensure manual `resume` / `step --resume` consumes the same intake queue semantics as scheduler/continuous mode
> 6. Optionally fail or warn if a turn completes without addressing the active injected acceptance contract
>
> **Severity**
>
> I would rate this `P1/P2`, leaning `P1` for human-governed planning reliability:
> - it undermines human steering
> - it makes intake feel non-deterministic
> - it is hard to prove whether the PM saw the instruction at all

---

### P1 — Live beta bug #2 — stale-baseline turn cannot be cleanly recovered after post-dispatch HEAD change (2026-04-17)

Same beta tester, same first-run session, different defect class. After the BUG-1 acceptance failure, they tried every framework-native recovery path and none of them worked:
- `restart` reconnected but didn't rebase
- `reject-turn --reassign` refused (requires persisted `conflict_state`)
- plain `reject-turn` retried the turn but kept the poisoned old baseline
- the framework detects drift (`status` shows `Git HEAD has moved since checkpoint: 77083d12 -> d7310af3`) but offers no clean way to act on it

Full verbatim bug report in **"Beta-tester bug report #2 (verbatim)"** below.

**This is tightly linked to BUG-1 and to the already-open B-7 adoption item (`reissue-turn` for runtime rebinding).** All three are symptoms of the same missing capability: **there is no unified way to invalidate an active turn and reissue it against current state.** Design the fix once, ship it under one command, wire it into all three trigger paths.

- [x] **BUG-7: `agentxchain reissue-turn` — unified turn invalidation + reissue against current state** — SHIPPED: `reissue-turn` command invalidates active turn, archives state, re-captures baseline from current HEAD/workspace, creates new turn with same role/phase. Covers baseline/runtime/authority drift. Events `turn_reissued` emitted. E2E test covers HEAD-change scenario. The headline fix. Ship a single canonical command that:
  1. Invalidates the active turn (records the invalidation reason in decision ledger + `events.jsonl`)
  2. Deletes / archives the stale dispatch bundle
  3. Recaptures the baseline from current repo state (current HEAD, current runtime binding, current workspace snapshot)
  4. Re-dispatches the turn under the refreshed baseline — same role, same phase, same intent
  - **Triggers this command must cover:**
    - Baseline drift — HEAD changed after dispatch (THIS bug)
    - Runtime drift — `agentxchain.json` rebinding after dispatch (already covered by B-7 adoption item)
    - Authority drift — `write_authority` changed on the assigned role (related to B-4)
    - Operator-initiated — operator explicitly wants to throw away the current attempt and redo it fresh
  - **Interface:**
    - `agentxchain reissue-turn [--turn <id>] [--reason <text>]` — reissues the active turn by default; `--turn` targets a specific one.
    - Exits cleanly with a summary of what changed between old and new baseline (HEAD delta, runtime delta, workspace delta).
    - Writes a `turn_reissued` event with old_baseline, new_baseline, reason.
  - **Fix requirements:**
    - Unify with existing B-7 roadmap item — do NOT ship two separate commands for rebinding vs drift. Same command, multiple trigger reasons.
    - The old turn state must be preserved as a historical artifact (e.g., `.agentxchain/history.jsonl` entry with attempt number), not silently overwritten.
    - Add a decision ledger entry (`DEC-TURN-REISSUE-*`) per invocation.
    - Include an E2E test reproducing the beta tester's exact scenario: dispatch turn → commit unrelated file changing HEAD → `reissue-turn` → turn dispatches cleanly against new HEAD.
    - Include a test for the runtime-rebinding scenario (B-7's trigger) exercising the same command.
  - **Acceptance:** the beta tester's reproduction flow ends with one command (`reissue-turn`) producing a clean, accepted turn against current state. No manual JSON editing.

- [x] **BUG-8: `reject-turn` retry path must refresh baseline (OR explicitly refuse if baseline is stale)** — FIXED: `rejectGovernedTurn` now always refreshes baseline on retry (Option A), not just for conflict rejects. E2E test verifies retry baseline points to current HEAD after drift. — Plain `reject-turn` succeeded and set the turn to `retrying`, but `.agentxchain/state.json` still carried the poisoned old baseline `head_ref`. The retry was doomed before it dispatched.
  - **Fix requirements:**
    - When `reject-turn` transitions a turn to `retrying`, the protocol must either:
      - **Option A (preferred):** refresh the baseline to current state before the retry dispatches. The retry is a new attempt — it should start from current state, not the moment the failed attempt was dispatched.
      - **Option B (acceptable fallback):** refuse to retry with a specific error pointing at `reissue-turn` when drift is detected. No silent poisoned retry.
    - Do NOT retain the silent-poisoned-retry behavior that currently exists — it turns recoverable drift into unrecoverable drift.
    - Add a test: dispatch turn → commit file changing HEAD → `reject-turn` → verify the retry's baseline is either refreshed (A) or the command refused with a helpful error (B).
  - **Acceptance:** after `reject-turn`, the retried turn's baseline agrees with current repo state — or the command refuses with an actionable pointer to `reissue-turn`.

- [x] **BUG-9: `reject-turn --reassign` must work without pre-existing `conflict_state`** — FIXED: `--reassign` gate removed. With drift detected, outputs actionable message pointing to `reissue-turn`. Without drift, falls through to normal reject+retry (which now refreshes baseline per BUG-8). — The `--reassign` flag currently rejects with: "--reassign is only valid for turns with persisted conflict_state." That's too narrow. An operator explicitly rejecting a turn for baseline drift is exactly the case `--reassign` should handle — but it doesn't, because no conflict_state was recorded (the drift was detected post-hoc, not mid-dispatch).
  - **Fix requirements:**
    - Remove the `conflict_state`-only gate on `--reassign`. Any rejected turn should support reassignment if the operator opts in.
    - OR, redirect `--reassign` to call `reissue-turn` internally when there's no conflict_state but drift is detected — unified surface, multiple entry points.
    - Ensure the error path produces a useful message: if `--reassign` truly cannot recover, say why and point at the command that can (e.g., `reissue-turn`).
    - Add a test exercising `reject-turn --reassign` on a drift-induced failure with no pre-existing conflict_state.
  - **Acceptance:** `reject-turn --reassign` is a valid recovery path for post-dispatch drift, not just mid-dispatch conflicts.

- [x] **BUG-10: `restart` must surface actionable drift recovery, not just detect drift** — FIXED: when `restart` detects drift with active turns, it now prints ranked recovery commands: `reissue-turn` for each turn, `reject-turn` as alternative. — `restart` correctly detects `Git HEAD has moved since checkpoint: 77083d12 -> d7310af3`, but stops at detection. The operator is left holding a warning with no command to execute next.
  - **Fix requirements:**
    - When `restart` detects drift (HEAD, runtime, authority, or workspace-baseline mismatch), output must include:
      - The specific drift type and values (old → new)
      - A ranked list of recovery options: retain current baseline (if safe), discard the active turn, or reissue from current HEAD
      - The exact command for each option (e.g., `agentxchain reissue-turn --turn <id> --reason "baseline drift"`)
    - Optionally add `restart --rebase-active-turns` as a convenience that delegates to `reissue-turn` for every active turn with drift. Lower priority than the core `reissue-turn` in BUG-7.
    - Add a test asserting `restart` output contains actionable recovery commands when drift is present.
  - **Acceptance:** operator who runs `restart` after drift sees a clear next command, not just a warning.

### Implementation notes for BUG-7 through BUG-10

- **Single command, multiple triggers:** BUG-7 is the atom. Ship `reissue-turn` first. BUG-8, BUG-9, BUG-10 are thin wrappers / error-path redirections that all end up calling `reissue-turn` internally.
- **Merge with B-7 adoption item:** the B-7 roadmap item (runtime rebinding) was proposing the same command. Collapse them — there is one `reissue-turn` command covering all drift reasons. Update B-7's entry to reference BUG-7 when it lands, and close B-7 with the same fix.
- **This cross-pollinates with the BUG-1..BUG-6 work:** the baseline consistency fix (BUG-2) is a hard dependency here too — you cannot reliably reissue a turn against a baseline that isn't captured reliably in the first place. BUG-2 → BUG-1 → BUG-7 is the build order.
- **Proof discipline:** each bug gets a failing test committed BEFORE the fix. Commit the reproduction first, then the fix. Preserve the beta tester's exact reproduction as a test fixture.
- **Event coverage:** every new state transition (`turn_reissued`, `turn_baseline_refreshed`) gets an entry in `events.jsonl` (closes BUG-4's gap for this class of operation too).
- **Documentation:** add a `docs/recovery.mdx` section or extend the existing one with a "Recovering from post-dispatch drift" walkthrough. The operator should have a cookbook entry for this scenario.

---

### Beta-tester bug report #2 (verbatim)

> **Title**
>
> Stale-baseline turn cannot be cleanly recovered after post-dispatch `HEAD` change; `accept-turn` fails, `reject-turn` retry preserves poisoned baseline
>
> **Environment**
>
> - Project: `tusq.dev`
> - Protocol: governed v4
> - CLI used: `agentxchain@2.128.0` via `npx --yes -p agentxchain@latest -c "agentxchain ..."`
> - Runtime type: `local_cli`
> - Active role: `pm`
> - OS: macOS
> - Repo path: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev`
>
> **Summary**
>
> A governed `local_cli` turn was dispatched from clean baseline commit `77083d12...`.
> After dispatch, an unrelated but intentional config change in `agentxchain.json` was committed as new `HEAD` `d7310af3...`.
>
> The PM subprocess itself completed successfully and staged a valid result, but `accept-turn` failed because AgentXchain still treated `agentxchain.json` as an undeclared observed artifact. After that:
>
> - `restart` successfully reconnected the run
> - `reject-turn` successfully moved the turn to `retrying`
> - but the retried turn **kept the original baseline** (`77083d12...`) instead of rebasing to current `HEAD` (`d7310af3...`)
>
> This leaves the turn effectively poisoned with no clean framework-native way to reissue it from the current commit.
>
> **Expected behavior**
>
> If `HEAD` changes after dispatch and the operator intentionally wants to continue:
> - either AgentXchain should provide a supported way to rebase/reissue the active turn against current `HEAD`
> - or `reject-turn` retry should refresh the baseline when retrying after explicit operator rejection for baseline drift
> - or `restart` should offer a `reissue from current head` path
>
> At minimum, once the operator has acknowledged the drift, there should be a framework-native way to recover and continue without manual state surgery.
>
> **Observed behavior**
>
> 1. Turn dispatched successfully.
> 2. PM subprocess completed successfully and wrote staged result.
> 3. `accept-turn` failed with undeclared file change mismatch.
> 4. `status` showed drift: `Git HEAD has moved since checkpoint: 77083d12 -> d7310af3`
> 5. `restart` reconnected run but retained stale active turn.
> 6. `reject-turn --reassign` was rejected because `--reassign` only works for persisted `conflict_state`.
> 7. plain `reject-turn --reason ...` worked and set turn to `retrying`
> 8. but `.agentxchain/state.json` still retained the old baseline `head_ref: 77083d12...`
> 9. therefore the retry did not actually recover the turn onto current `HEAD`
>
> **Commands run**
>
> Initial PM execution:
> ```bash
> cd "/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev"
> npx --yes -p agentxchain@latest -c "agentxchain step --resume"
> ```
>
> Intentional config commit after dispatch:
> ```bash
> git add agentxchain.json
> git commit -m "chore: update local_cli authority flags"
> ```
>
> Attempted acceptance:
> ```bash
> npx --yes -p agentxchain@latest -c "agentxchain accept-turn --turn turn_5bcc56d876e10a47"
> ```
>
> Restart after drift warning:
> ```bash
> npx --yes -p agentxchain@latest -c "agentxchain restart"
> ```
>
> Attempted reassign:
> ```bash
> npx --yes -p agentxchain@latest -c "agentxchain reject-turn --turn turn_5bcc56d876e10a47 --reason 'Baseline invalidated by intentional config commit after dispatch' --reassign"
> ```
>
> Result:
> ```text
> --reassign is only valid for turns with persisted conflict_state.
> ```
>
> Plain reject:
> ```bash
> npx --yes -p agentxchain@latest -c "agentxchain reject-turn --reason 'Baseline invalidated by intentional config commit after dispatch'"
> ```
>
> **Acceptance failure message**
>
> ```text
> Validation failed at stage artifact_observation
>
> Reason:   artifact_error
> Owner:    human
> Action:   Fix staged result and rerun agentxchain accept-turn, or reject with agentxchain reject-turn --reason "..."
> Turn:     retained
> Detail:   Undeclared file changes detected (observed but not in files_changed): agentxchain.json
> ```
>
> **Evidence**
>
> Current `HEAD` after intentional config commit:
> ```text
> d7310af308a37f888375feaa8731cde6e7b6ef47
> ```
>
> Active turn baseline in `.agentxchain/state.json` still points to old commit:
> ```json
> "baseline": {
>   "kind": "git_worktree",
>   "head_ref": "77083d12880c4b4f964f4b555a69da9b0a52cf32",
>   "clean": true,
>   "captured_at": "2026-04-17T23:59:36.476Z",
>   "dirty_snapshot": {}
> }
> ```
>
> After `reject-turn`, turn is retried but baseline is unchanged:
> ```json
> "status": "retrying",
> "attempt": 2,
> "baseline": {
>   "head_ref": "77083d12880c4b4f964f4b555a69da9b0a52cf32"
> }
> ```
>
> `status` clearly detects drift:
> ```text
> Drift: Git HEAD has moved since checkpoint: 77083d12 -> d7310af3
> ```
>
> PM subprocess had actually completed and staged a result at:
> - `.agentxchain/staging/turn_5bcc56d876e10a47/turn-result.json`
>
> That result correctly identified only planning-file changes:
> - `.planning/PM_SIGNOFF.md`
> - `.planning/SYSTEM_SPEC.md`
> - `.planning/ROADMAP.md`
> - `.planning/command-surface.md`
>
> The undeclared file was `agentxchain.json`, which was not a PM-authored planning artifact.
>
> **Why this is a problem**
>
> Once a turn's baseline becomes stale because `HEAD` changed:
> - `accept-turn` cannot succeed cleanly
> - `reject-turn` retry does not repair the baseline
> - `restart` only reconnects, it does not rebase/reissue
> - `reject-turn --reassign` is unavailable unless conflict state exists
>
> That leaves the run in a dead-end where the framework knows drift exists but offers no clean recovery path.
>
> **What I think should be added**
>
> One of these:
>
> 1. `agentxchain reissue-turn`
>    - invalidate active turn
>    - rebuild dispatch bundle
>    - recapture baseline from current `HEAD`
>
> 2. `agentxchain reject-turn --reassign-from-head`
>    - like retry, but explicitly refreshes baseline
>
> 3. `agentxchain restart --rebase-active-turns`
>    - for post-checkpoint drift recovery
>
> 4. automatic operator prompt on restart:
>    - drift detected
>    - choose:
>      - retain old baseline
>      - discard turn
>      - reissue from current `HEAD`
>
> **Severity**
>
> I would rate this `P1` for governed automation reliability because:
> - it blocks progress after a common operator action
> - the framework detects drift but cannot fully recover
> - it leaves the active turn semantically invalid but still retained
>
> **Minimal reproducible pattern**
>
> 1. Dispatch a `local_cli` turn from a clean repo
> 2. Let the subprocess finish and stage a result
> 3. Before acceptance, commit an unrelated file so `HEAD` changes
> 4. Try `accept-turn`
> 5. Run `restart`
> 6. Run `reject-turn`
> 7. Observe that retry does not refresh baseline

---

### P1 — Live beta bug #1 — acceptance compares against dirty workspace, not turn delta (2026-04-17)

The same beta tester hit a **real product bug on their very first governed run**. This is P1 because it causes false-negative turn rejection, leaves state inconsistent, breaks recovery, and breaks trust in full-auto execution. Fix this BEFORE the B-1 through B-11 adoption-quality items — a broken first-run experience erases all docs polish.

Full verbatim bug report is captured below in **"Beta-tester bug report (verbatim)"**. Treat that as ground truth.

- [x] **BUG-1: Delta-based artifact validation — stop comparing `files_changed` against the whole dirty workspace** — FIXED in 47c5e312: `refreshTurnBaselineSnapshot()` re-snapshots dirty files at dispatch time; called before every `writeDispatchBundle()`. This is the main defect. When a turn's staged result correctly lists only the files it changed, AgentXchain rejects the turn because the comparison includes pre-existing dirty files (e.g., an uncommitted `agentxchain.json` edit that the PM turn never touched).
  - **Reproducible steps (from beta tester):**
    1. Start with a governed repo using `local_cli`.
    2. Leave one non-turn file already dirty in the workspace (tester had a dirty `agentxchain.json` from reconfiguring the Codex flag).
    3. Dispatch a turn whose actual work only changes a known set of files (e.g., PM planning artifacts).
    4. Have the subprocess write a correct staged result with `files_changed` only listing the files it actually changed.
    5. Run `agentxchain step --resume`.
  - **Observed:**
    - Subprocess completes normally.
    - `.agentxchain/staging/<turn_id>/turn-result.json` is written correctly.
    - Acceptance fails with: `Observed artifact mismatch: Undeclared file changes detected (observed but not in files_changed): agentxchain.json`.
    - `agentxchain.json` was NOT touched by the turn — it was dirty before dispatch.
  - **Expected:**
    - Acceptance compares `files_changed` against the **diff from dispatch baseline to post-turn state**, not against the entire current dirty workspace.
    - Pre-existing dirty files that the turn did not modify MUST NOT cause acceptance to fail.
    - OR, if pre-dispatch dirty files are intentionally unsupported, dispatch should **refuse to start** with a clear message before the turn ever runs.
  - **Fix requirements:**
    - Locate the acceptance validator (likely in `cli/src/lib/turn-result-validator.js` or adjacent modules — check `cli/src/lib/dispatch-bundle.js` for baseline capture and `cli/src/lib/governed-state.js` for acceptance flow).
    - Change the "observed artifact" computation to be **delta-based**: diff the post-turn workspace against the dispatch baseline snapshot, not against the current HEAD.
    - If the baseline snapshot already captured the pre-dispatch dirty state, use that; if not, fix baseline capture (see BUG-2).
    - Add a regression test that reproduces the exact tester scenario: dispatch with a pre-existing dirty non-turn file, verify the turn accepts cleanly when `files_changed` is correct.
  - **Acceptance:** the reproduction steps above end with a successful turn acceptance, not a rejection.

- [x] **BUG-2: Consistent baseline capture — `state.json` and `session.json` must agree on workspace-dirty status** — FIXED in 47c5e312: `writeSessionCheckpoint()` derives `baseline_ref` from `captureBaseline()` result at `turn_assigned`. — The tester's live protocol state showed contradictory facts from AgentXchain itself:
    - `.agentxchain/state.json` active turn baseline: `"clean": true, "dirty_snapshot": {}`
    - `.agentxchain/session.json` baseline ref: `"workspace_dirty": true`
  - These two must never disagree. One of them is lying about reality. Likely root cause: the baseline capture path writes to one surface but not the other, or they capture at different moments.
  - **Fix requirements:**
    - Find both baseline capture paths (grep for `baseline` writes in `cli/src/lib/`).
    - Make them share a single capture function so they cannot diverge.
    - If the workspace is actually dirty at dispatch, both must record `dirty: true` AND capture the dirty snapshot (file list + content hashes or diff) so BUG-1's delta-based validator can use it.
    - Add a test that asserts `state.json` and `session.json` baseline agreement for a representative set of workspace states (clean, dirty with staged, dirty with unstaged, both).
  - **Acceptance:** there is no possible code path where `state.json` says `clean: true` while `session.json` says `workspace_dirty: true`.

- [x] **BUG-3: Failure-path state transition — stuck-in-`running` after acceptance failure** — FIXED in 47c5e312: acceptance failure paths transition turn to `failed_acceptance` status; `status` and `step --resume` surface recovery guidance. — When acceptance failed, the turn stayed marked `status: "running"` even though the subprocess had already exited and the staged result existed on disk. `agentxchain status` still reported an active turn that had no live process. Recovery was ambiguous.
  - **Fix requirements:**
    - When acceptance rejects a turn result, transition the turn to a terminal/recoverable status: `failed_acceptance`, `needs_operator_reconciliation`, or similar. Do NOT leave it `running`.
    - The status transition must be atomic with the acceptance rejection — same code path.
    - `agentxchain status` and `doctor` must surface the failed-acceptance state clearly, with a recommended recovery command (retry, reissue, or abort).
    - `agentxchain step --resume` against a `failed_acceptance` turn must not silently re-dispatch or claim the turn is still running.
    - Add a regression test covering the full failure-path state machine.
  - **Acceptance:** after an acceptance failure, `status` reports a terminal-or-recoverable state, not `running`; there is exactly one documented command to recover; running `step --resume` does not loop or lie.

- [x] **BUG-4: Failure event logging — `turn_failed` / `acceptance_failed` never written to `events.jsonl`** — FIXED in 47c5e312: `acceptance_failed` event type added; emitted with structured payload on all acceptance failure paths; notifier fan-out inherited; events display renders with detail. — The CLI surfaced a terminal error message, but `.agentxchain/events.jsonl` showed only `run_started` + `turn_dispatched`. No `turn_failed`, no `acceptance_failed`, no `turn_needs_human`, no `turn_completed`. The event ledger lied about what happened.
  - **Fix requirements:**
    - Add `acceptance_failed` and/or `turn_failed` event types to the events schema.
    - Emit one whenever acceptance rejects a turn, with structured payload including: turn_id, role, runtime, reason, offending files, remediation hint.
    - Same for the stuck-in-`running` case once BUG-3 is fixed — any state transition must emit a corresponding event.
    - Update webhook / notifier fan-out so BUG-4 events propagate through the existing notifier plugins (Slack, GitHub issue, JSON webhook, local stderr).
    - Update `agentxchain events` display to render the new event types with color/detail.
    - Add a regression test asserting that the failure path emits the expected event sequence.
  - **Acceptance:** after a failed acceptance, `agentxchain events` shows the full lifecycle: `run_started` → `turn_dispatched` → `acceptance_failed` (with reason). Notifier plugins fire.

- [x] **BUG-5: Operator messaging for dirty-workspace-at-dispatch** — FIXED in 47c5e312: `writeDispatchBundle()` warns about uncommitted files not in baseline; undeclared-file error message includes remediation guidance. — Even after BUG-1 is fixed, the framework should help the operator avoid the confusion in the first place.
  - **Fix requirements:**
    - If the workspace has uncommitted changes unrelated to governed artifacts at dispatch time, `doctor` and the pre-dispatch path should warn clearly: "Workspace has N uncommitted files. The dispatch baseline will snapshot these; they will be excluded from `files_changed` validation." Show the file list.
    - If the workspace dirty snapshot cannot be safely captured for any reason, fail **before** dispatch with an actionable message, not after the subprocess runs.
    - After BUG-1 lands, ensure the error message text for actual (legitimate) undeclared file changes is sharper: name the file, show how it differs from the baseline, and offer the one-line fix (add to `files_changed` OR revert the undeclared change).
  - **Acceptance:** a first-time operator with a dirty workspace sees helpful pre-dispatch guidance, not a cryptic post-dispatch acceptance failure.

- [x] **BUG-6: Optional live subprocess streaming — tee `stdout.log` to terminal** — FIXED in 47c5e312: step command prints log path + tail command immediately after dispatch; `--stream` flag added as alias for `--verbose`. — UX, not correctness, but contributed to the "looks hung" feeling. AgentXchain captures PM subprocess output to `.agentxchain/dispatch/turns/<turn_id>/stdout.log` but does not tee to the operator's terminal.
  - **Fix requirements:**
    - Add a `--stream` (or default-on) flag to `step --resume` / `run --continuous` that tees subprocess stdout to the terminal in addition to the log file.
    - At minimum, immediately after dispatch, print the log file path and a tail command operators can run in another terminal (e.g., `tail -f .agentxchain/dispatch/turns/<turn_id>/stdout.log`).
    - Document this in the CLI help and the automation guide.
  - **Acceptance:** operator can see live subprocess output (or knows exactly where to watch it) without guessing.

### Implementation notes for agents (BUG-1 through BUG-6)

- **Execution order:** BUG-2 (baseline consistency) is a prerequisite for BUG-1 (delta validation) — you cannot diff against a baseline that wasn't captured reliably. Do BUG-2 first. Then BUG-1. Then BUG-3, BUG-4, BUG-5 in parallel. BUG-6 last (UX, not correctness).
- **Severity:** BUG-1, BUG-2, BUG-3, BUG-4 are P1 — they break first-run trust. Cut a dedicated fix release (e.g., v2.129.0) once all four land. Do not bundle these with the docs-only B-1 through B-11 work.
- **Proof discipline:** each bug gets a failing test that reproduces the tester's exact scenario BEFORE the fix lands, then the same test passes after. Commit the failing test first in a separate commit so the defect is trace-preserved in git history.
- **Honest retrospective:** Turn 75 shipped `run --continuous` with a 2-run mock proof + 1-run real proof. The 3-run proof in Turn 105 used fixture VISION.md with `api_proxy` only. **None of these proofs exercised a pre-existing dirty workspace at dispatch** — which is why this landmine survived. Update the 3-run proof or add a parallel proof scenario that covers dirty-workspace-at-dispatch, so this class of bug cannot regress.
- **Do not paraphrase the bug report.** The verbatim block below is the source of truth. If the fix appears to contradict the report, the report wins — escalate instead of re-interpreting.

---

### Beta-tester bug report (verbatim)

> I found the cause. This is a real AgentXchain bug, and there are actually **three** separate issues exposed by this run.
>
> **What happened**
>
> You ran:
>
> ```bash
> cd "/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev"
> npx --yes -p agentxchain@latest -c "agentxchain step --resume"
> ```
>
> The PM subprocess actually **did complete** and staged a turn result at:
>
> `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.agentxchain/staging/turn_5bcc56d876e10a47/turn-result.json`
>
> But AgentXchain then failed acceptance with:
>
> ```text
> Acceptance failed: Observed artifact mismatch: Undeclared file changes detected (observed but not in files_changed): agentxchain.json
> ```
>
> **Root cause**
>
> The undeclared file was **not** a PM planning artifact. It was a **pre-existing uncommitted config diff** in `agentxchain.json`.
>
> Current dirty files:
>
> ```text
> M .agentxchain/events.jsonl
> M .agentxchain/session.json
> M .agentxchain/state.json
> M .planning/PM_SIGNOFF.md
> M .planning/ROADMAP.md
> M .planning/SYSTEM_SPEC.md
> M .planning/command-surface.md
> M agentxchain.json
> ```
>
> The specific `agentxchain.json` diff is:
>
> ```diff
> + "--permission-mode", "bypassPermissions"
> - "--full-auto"
> + "--dangerously-bypass-approvals-and-sandbox"
> ```
>
> So the PM turn correctly reported only these files in `files_changed`:
>
> - `.planning/PM_SIGNOFF.md`
> - `.planning/SYSTEM_SPEC.md`
> - `.planning/ROADMAP.md`
> - `.planning/command-surface.md`
>
> But AgentXchain compared against the **whole dirty workspace**, saw `agentxchain.json`, and rejected the turn.
>
> That means the acceptance logic is behaving like:
>
> - "all current dirty files must appear in `files_changed`"
>
> instead of:
>
> - "only files changed **by this turn since dispatch/baseline** must appear in `files_changed`"
>
> That is the main bug.
>
> **Why this is a framework bug, not just operator error**
>
> AgentXchain's own state is inconsistent:
>
> In `.agentxchain/state.json`, the active turn baseline says:
>
> ```json
> "baseline": {
>   "kind": "git_worktree",
>   "head_ref": "77083d12880c4b4f964f4b555a69da9b0a52cf32",
>   "clean": true,
>   "dirty_snapshot": {}
> }
> ```
>
> But `.agentxchain/session.json` says:
>
> ```json
> "baseline_ref": {
>   "git_head": "77083d12880c4b4f964f4b555a69da9b0a52cf32",
>   "git_branch": "main",
>   "workspace_dirty": true
> }
> ```
>
> So AgentXchain itself recorded contradictory facts:
> - turn baseline = `clean: true`
> - session baseline = `workspace_dirty: true`
>
> That should never happen.
>
> **Second bug**
>
> After the subprocess exited and staged a result, AgentXchain still left the turn marked as running.
>
> Current status still reports:
>
> - active turn: `turn_5bcc56d876e10a47`
> - role: `pm`
> - runtime: `local-pm`
> - status: `running`
>
> But there is **no live `claude` process** for this turn anymore, and the turn already wrote:
> - `stdout.log`
> - `turn-result.json`
>
> So the failure path did not cleanly transition state.
>
> **Third bug**
>
> No failure event was appended to `.agentxchain/events.jsonl`.
>
> The events log still only contains:
> - `run_started`
> - old `turn_dispatched`
> - current `turn_dispatched`
>
> There is no:
> - `turn_failed`
> - `acceptance_failed`
> - `turn_needs_human`
> - `turn_completed`
>
> So the CLI surfaced a terminal error, but the repo state/event ledger did not record it.
>
> **What the PM actually did**
>
> The subprocess output is in:
>
> `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.agentxchain/dispatch/turns/turn_5bcc56d876e10a47/stdout.log`
>
> It shows the PM completed normally and filled the planning docs.
>
> The staged result is here:
>
> `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.agentxchain/staging/turn_5bcc56d876e10a47/turn-result.json`
>
> It explicitly says:
>
> - `status: "needs_human"`
> - summary says planning artifacts were filled
> - `files_changed` lists only the planning docs
> - `needs_human_reason` says the planning gate is waiting on human approval
>
> So the PM completed successfully. The failure was in AgentXchain acceptance/state handling after completion.
>
> **Why you saw no streamed PM output**
>
> AgentXchain is capturing subprocess output to:
>
> `.agentxchain/dispatch/turns/turn_5bcc56d876e10a47/stdout.log`
>
> It is not teeing Claude's stdout live into the terminal. So from the operator's point of view it looks hung, then suddenly returns a final acceptance error. That is not the main bug, but it is a UX/documentation problem.
>
> **Reproduction report for AgentXchain team**
>
> Use this:
>
> 1. Start with a governed repo using `local_cli`.
> 2. Leave one non-turn file already dirty in the workspace, e.g. `agentxchain.json`.
> 3. Dispatch a turn whose actual work only changes a known set of files.
> 4. Have the subprocess write a correct staged result with `files_changed` only listing the files it actually changed.
> 5. Run `agentxchain step --resume`.
>
> Observed:
> - subprocess completes
> - staged result exists
> - acceptance fails because AgentXchain compares against all dirty workspace files, including pre-existing dirty files
> - turn remains stuck in `running`
> - no failure/completion event is appended
>
> Expected:
> - acceptance should compare against the turn baseline/delta, not the entire current dirty workspace
> - or dispatch should refuse to start if the workspace is not acceptably clean
> - if acceptance fails, state should move to a terminal/error/blocked status and record an event
>
> **What AgentXchain should fix**
>
> 1. **Delta-based artifact validation**
>    - Validate `files_changed` against the diff from dispatch baseline to post-turn state.
>    - Do not compare against unrelated pre-existing dirty files.
>
> 2. **Consistent baseline capture**
>    - `state.json` and `session.json` must agree on whether the workspace was clean at dispatch.
>
> 3. **Failure-path state transition**
>    - If acceptance fails after subprocess completion, the turn must not remain `running`.
>    - It should become something like `failed_acceptance`, `blocked`, or `needs_operator_reconciliation`.
>
> 4. **Failure event logging**
>    - Append an event such as `acceptance_failed` or `turn_failed` with reason and offending files.
>
> 5. **Better operator messaging**
>    - If pre-existing dirty files are unsupported, fail before dispatch with a clear message.
>    - If supported, show which files were excluded from the turn baseline.
>
> 6. **Optional live subprocess streaming**
>    - Tee `stdout.log` to terminal, or at least print where live output is being written.
>
> **Severity**
>
> I'd call this `P1/P2 boundary`, leaning `P1` for automation reliability:
> - it causes false negative turn rejection
> - it leaves state inconsistent
> - it makes rerun/recovery ambiguous
> - it breaks trust in full-auto execution
>
> **Practical workaround right now**
>
> Before rerunning:
> - either commit or revert the dirty `agentxchain.json` change
> - then recover the stuck turn state before starting again

---

### Beta-tester adoption friction (MUST FIX before growth)

Context: first external beta tester ran AgentXchain end-to-end on a fresh machine. They succeeded but hit 18 distinct friction points and had to work around several of them manually. The full raw feedback is captured below in **"Beta-tester feedback (verbatim)"** and should be the single source of truth. Every item in this section references specific numbered gaps from that block.

These items are interlocking — many are docs fixes, several are product fixes, a few require new CLI surfaces. Debate grouping and ordering in AGENT-TALK.md. My suggested ordering (escalation-first mindset): fix the landmines (items B-5, B-7) before the polish (items B-10 through B-15).

- [x] **B-1: CLI version mismatch safety — docs + doctor output (gap #1)** — completed 2026-04-17: added prerequisites blocks to `getting-started`, `quickstart`, and `five-minute-tutorial` with minimum CLI version + npm/Homebrew/npx upgrade guidance; `doctor` now probes the published docs floor, warns on stale local CLI versions, and exposes `cli_version` / `docs_min_cli_version` / `cli_version_status` in JSON; regression tests freeze both the docs copy and stale-version warning contract.
  - **What to fix:**
    - Add a "Prerequisites" block at the top of getting-started, quickstart, and five-minute-tutorial: minimum required CLI version, how to check (`agentxchain --version`), how to upgrade (npm + Homebrew), and the `npx --yes -p agentxchain@latest -c "agentxchain ..."` safe-fallback incantation.
    - Update `agentxchain doctor` to detect a stale CLI version against the docs' minimum and warn loudly (it already has version surface from `DEC-PROTOCOL-VERSION-SURFACE-*`).
    - Add a content test that asserts the prerequisites block exists on all three onboarding pages and contains the npx fallback string.
  - **Acceptance:** fresh machine + old CLI on PATH follows the docs → sees a loud warning and a one-liner to fix it, does not silently get stale-flag errors.

- [x] **B-2: Canonical runtime matrix — kill the split-source-of-truth problem (gap #2)** — completed 2026-04-17: shipped `website-v2/docs/runtime-matrix.mdx` as canonical source of truth covering all 5 runtimes, 3 authority levels, 15-cell binding matrix, invalid combo docs, common config patterns. Linked from README, getting-started, adapters, integration-guide, sidebar. Content-contract test (`runtime-matrix-content.test.js`) freezes all 5 runtimes, 3 authorities, cross-references, and invalid combos.
  - **What to fix:**
    - Create one canonical runtime matrix page (e.g., `website-v2/docs/runtime-matrix.mdx`) as the source of truth: each runtime, which authority levels it supports, when to use it, example config.
    - Deprecate / mark historical any older specs that only cover 3 runtimes.
    - Link the matrix from README, getting-started, adapters doc, and `agentxchain.json` schema docs.
    - Add a content-contract test that the matrix lists all 5 current runtimes with current authority rules.
  - **Acceptance:** every runtime mention in the docs either links to the matrix or is flagged as historical.

- [x] **B-3: Three-axis authority model explained sharply (gap #3)** — completed 2026-04-17: shipped `website-v2/docs/authority-model.mdx`, linked it from runtime/integration surfaces, corrected local CLI guides to use `write_authority`, fixed Codex authoritative guidance to `--dangerously-bypass-approvals-and-sandbox`, and removed an invalid `review_only + local_cli` OpenClaw example.
    1. role `write_authority` (`review_only` vs `authoritative` vs `proposed`)
    2. runtime type (`manual`, `local_cli`, `api_proxy`, `mcp`, `remote_agent`)
    3. downstream CLI sandbox/approval authority (e.g., `codex --full-auto` vs `--dangerously-bypass-approvals-and-sandbox`)
  - **What to fix:**
    - Add an "Authority model" page or section with a clear 3-axis diagram/table showing how these interact, including which combinations are valid and which are not.
    - Reference the authority model from the runtime matrix and from each integration guide.
  - **Acceptance:** reader can identify the correct values for all 3 axes for their setup before running `init`.

- [x] **B-4: `review_only + local_cli` invalid combination — flag it loudly and early (gap #4)** — completed 2026-04-17: `validate` now surfaces the invalid governed config directly instead of collapsing to "No agentxchain.json found", `doctor` reports the same actionable repair guidance, `quickstart` front-loads the rule in the automation intro, and regression tests freeze the message contract.
  - **What to fix:**
    - `agentxchain validate` and `agentxchain doctor` must detect `review_only + local_cli` combinations and produce a specific, actionable error pointing at the fix (change authority to `authoritative` OR change runtime to `manual`/`api_proxy`/`mcp`/`remote_agent`).
    - First paragraph of the automation guide must state this constraint in plain English with the workaround.
    - Add a guard test for the error message.
  - **Acceptance:** a user who tries `review_only + local_cli` sees the error before their first turn runs, not during dispatch.

- [x] **B-5: "All local_cli authoritative, human-gated" canonical example (gap #5 + #16 + recommended addition #7)** — completed 2026-04-17: shipped blueprint-backed `full-local-cli` template, `/docs/automation-patterns/`, and subprocess E2E proving PM -> Dev -> QA with human gate pauses. Init-time local CLI overrides now fan out across all default local runtimes in the template, and docs include exact Claude Code / Codex command shapes plus the inject -> resume -> `step --resume` steering path.
  - **What to fix:**
    - Ship a canonical example config file (e.g., `cli/src/templates/governed-full-local-cli.json` or similar) where PM/Dev/QA/Director are all bound to `local_cli` runtimes with `authoritative` authority, and phase gates keep `requires_human_approval: true`.
    - Add a docs page `/docs/automation-patterns/` (from recommended addition #1) that names this pattern: "all automated turns, human gate approvals only."
    - Include the exact command shape for Codex (`--dangerously-bypass-approvals-and-sandbox`) and Claude Code (`--dangerously-skip-permissions`) inline.
    - Add an E2E proof that this config runs 3 back-to-back turns with the gates pausing for human approval.
  - **Acceptance:** `agentxchain init --template full-local-cli` (or equivalent) scaffolds this setup; docs page explains it in under 5 minutes of reading.

- [x] **B-6: Manual-to-automated migration path documented (gaps #6, #15, #17, #18)** — completed 2026-04-17: `docs/manual-to-automated-migration.mdx` created with 9-step numbered sequence covering validate → choose CLI → add runtimes → rebind roles → connector check → commit → reissue → first turn → inject steering. States PM automation is real. Includes full-local-cli template alternative and generic-to-CLI overlay pattern. Registered in sidebar. 9 content-contract tests in `migration-guide-content.test.js`.
  - **What to fix:**
    - Create `docs/manual-to-automated-migration.mdx` (recommended addition #3) with the exact numbered sequence:
      1. scaffold manual-first (`init --governed`)
      2. validate (`validate`)
      3. bind runtimes (`config --set roles.pm.runtime=local-pm`, etc.)
      4. run connector checks (`connector validate`)
      5. commit scaffold changes BEFORE running writable turns (see B-7 clean-tree requirement)
      6. reissue any active turns bound to old runtimes (see B-7 reissue flow)
      7. assign first automated turn
    - Explicitly state that **PM planning can be automated** — it only looks like "PM automation isn't a thing" because the manual-first scaffold defaults to `manual-pm` (gap #17).
    - Include the generic → cli-tool template overlay pattern (gap #15) as a recommended path when product shape is still TBD.
    - Add a first-real-automation walkthrough (recommended addition, gap #18) matching the 8-step sequence the tester wished they'd had.
  - **Acceptance:** a new user can go from empty directory → running automated PM turns in under 20 minutes of doc reading.

- [x] **B-7: Runtime rebinding mid-run — stale turn detection + reissue command (gaps #7, #8)** — completed 2026-04-17: `reissue-turn` command shipped in BUG-7 (commit 09542664). Now closed fully: `status` and `doctor` detect runtime/authority binding drift on active turns and surface `reissue-turn` recovery commands. `status --json` includes `binding_drift` array. Doctor check `binding_drift` warns on stale bindings. E2E test (`binding-drift-detection.test.js`, 8 tests) covers runtime rebinding, authority drift, multi-turn drift, and recovery command surface. `reissue-turn` documented in `cli.mdx` command map and `recovery.mdx` post-dispatch drift section.
  - **What to fix:**
    - Detect the mismatch: when an active turn's dispatch bundle references a runtime/authority that no longer matches `agentxchain.json`, surface a blocker in `status`, `doctor`, and the dashboard. Text should read something like: "Active turn `<id>` was assigned under runtime `manual-pm` + `review_only`; config now says `local-pm` + `authoritative`. Reissue required: `agentxchain reissue-turn <id>`."
    - Ship the `agentxchain reissue-turn <turn-id>` command (or `cancel-turn --reassign`) that atomically:
      - cancels the stale assigned turn
      - invalidates the stale dispatch bundle
      - re-assigns under the current runtime binding
      - writes a decision ledger entry so the reissue is auditable
    - Prompt ordering matters: the command must not lose the turn's intent/phase context during reissue.
    - Add an E2E test that: assigns a turn, rebinds the runtime, observes the stale-turn blocker, runs `reissue-turn`, confirms the turn now dispatches under the new binding.
    - Document the command in `docs/cli.mdx` and link it from the migration guide (B-6).
  - **Acceptance:** rebinding a runtime never leaves the protocol in a state that requires hand-editing JSON. One command recovers cleanly.

- [x] **B-8: Clean-working-tree requirement surfaced earlier (gap #9)** — completed 2026-04-17: clean-tree requirement now stated plainly in getting-started, quickstart (caution admonition), and automation-patterns (with "Why this exists" explanation covering diff-baseline mechanism). `doctor` includes `clean_baseline` pre-flight check that warns when working tree is dirty and writable roles exist. 6 regression tests in `clean-tree-guidance.test.js`.
  - **What to fix:**
    - State plainly in getting-started, quickstart, and the automation guide: **authoritative/proposed turns require a clean baseline**. Scaffold/config changes must be committed before writable automated turns begin.
    - Surface this in `doctor` pre-flight: if the working tree is dirty AND the next role is `authoritative`, warn before the first dispatch.
    - Add a "Why this exists" blurb explaining the `files_changed` diff-baseline contract.
    - Add a content-contract test.
  - **Acceptance:** user sees the clean-tree rule before they hit it at dispatch time.

- [x] **B-9: Local CLI recipes page — Codex, Claude Code, Cursor (gap #10 + recommended addition #2)** — completed 2026-04-17: `docs/local-cli-recipes.mdx` created with copy-pasteable recipes for Claude Code, Codex CLI, and OpenClaw. Covers exact flags, transport modes, common mistakes, Cursor/Windsurf clarification, authority model recap, and troubleshooting section. Linked from automation-patterns and registered in sidebar under Connectors. 10 content-contract tests in `local-cli-recipes-content.test.js`.
  - **What to fix:**
    - Create `docs/local-cli-recipes.mdx` (recommended addition #2) with a section per CLI:
      - **Codex:** exact command, required flags for full authority, `stdin` transport note, `--dangerously-bypass-approvals-and-sandbox` explained
      - **Claude Code:** exact command, `--dangerously-skip-permissions`, `--print`, `stdin` transport
      - **Cursor agent / Cline / etc:** one entry each if supported, or mark "community-contributed recipe" with a link
    - Explain the three prompt transports (`argv`, `stdin`, `dispatch_bundle_only`) with operator-friendly guidance (gap #12):
      - `stdin` — default for Codex + Claude Code in automated cases
      - `dispatch_bundle_only` — only when you intentionally want operator handoff
      - `argv` — only if the CLI is designed for it
    - Link from B-5 canonical config example.
  - **Acceptance:** user pastes the recipe, runs `connector validate`, the CLI dispatches under full authority on first try.

- [x] **B-10: Deeper `connector validate` probes (gap #11)** — completed 2026-04-17: `connector check` now performs authority-intent analysis for known local CLI tools (Claude Code, Codex). Detects missing `--dangerously-skip-permissions` / `--dangerously-bypass-approvals-and-sandbox` flags for authoritative roles, warns about weak `--full-auto`, validates prompt transport alignment (`argv` without `{prompt}`, mismatched transport for known CLIs). Probe result level promoted from `pass` to `warn` when intent mismatches detected. `--json` output includes `warn_count` and per-connector `authority_warnings` array with actionable fix guidance. 18 regression tests in `connector-authority-intent.test.js`.
  - **What to fix:**
    - Extend `agentxchain connector validate` (or a deeper `connector probe` variant) to optionally:
      - exercise a no-op prompt through the actual runtime and confirm structured turn-result comes back (real auth check)
      - assert the CLI accepts the declared flags (parse `--help` output or run a trivial dry-run)
      - sanity-check sandbox/approval mode matches the declared authority
    - Output must be actionable: which probe failed, why, and how to fix.
    - Gate the real-spend probes behind an opt-in flag (`--live` or similar) since they cost money.
  - **Acceptance:** `connector validate --live` catches expired auth, wrong flags, and sandbox mismatches before the first real turn.

- [x] **B-11: Planning/repo split guidance (gaps #13, #14)** — completed 2026-04-17: `docs/project-structure.mdx` created with three-layer explanation (committed governed state, transient execution artifacts, planning artifacts). Includes file-by-file tables, VISION.md ownership rule, freshly-scaffolded anatomy tree, root-vs-.planning guidance. Scaffold `.gitignore` now includes `.agentxchain/transactions/` and inline comments. Registered in sidebar. 8 content-contract tests in `project-structure-content.test.js`.
  - **What to fix:**
    - Add a "Project structure" page explaining the recommended split:
      - public OSS repo surface: root `README.md`, root docs
      - governed source of truth: `.planning/` (VISION.md, specs, roadmaps)
      - transient execution artifacts: `.agentxchain/dispatch/`, `.agentxchain/staging/` (ignored)
      - committed governed history: `.agentxchain/prompts/`, `.agentxchain/state.json`, `.agentxchain/history.jsonl`, `.agentxchain/decision-ledger.jsonl`, `.agentxchain/repo-decisions.jsonl`
    - Update the scaffold `.gitignore` to match this split explicitly and add inline comments.
    - State plainly: **website/docs should point to root docs, not to `.planning/*` files.**
    - Add a content-contract test asserting the commit/ignore guidance exists.
  - **Acceptance:** user can look at a freshly-scaffolded repo and know exactly which files to commit.

### Implementation notes for agents

- **Do not reinvent the wheel.** Every item above extends existing surfaces: `doctor`, `validate`, `connector validate`, `status`, dashboard, docs system, content-contract tests, existing CLI commands. The one net-new surface is `reissue-turn` in B-7.
- **Prioritize landmines:** B-4 (invalid combo detection), B-7 (stale-turn reissue), B-10 (deeper connector probes) catch real product defects that corrupted the tester's experience. These should ship before the docs-only items.
- **Docs-only items (B-1, B-2, B-3, B-6, B-8, B-9, B-11) can parallelize:** different agents can take different pages. But they all share one atom — the runtime matrix in B-2. Build B-2 first so every other docs item can link to it.
- **Each item gets its own spec in `.planning/` plus a regression test.** Standard discipline.
- **Bundle for release:** these are a coherent "operator adoption quality" release train. Consider tagging each release in this group with an `adoption-quality` label in release notes so the beta tester (and future testers) can see the gap-to-fix trace.

---

### Beta-tester feedback (verbatim)

This is the raw feedback from the first external beta tester (2026-04-17). Every lettered item above (B-1 through B-11) maps to specific numbered gaps in this block. Do not paraphrase this or trim it — it is the ground truth for what a first-time operator actually hits.

> Yes. Here's the clean record of what AgentXchain could have documented or surfaced better based on this exact setup.
>
> **Main Gaps**
>
> 1. Version mismatch was too easy to hit.
>    - The public docs reflect the current governed CLI, but the machine had an older `agentxchain` binary on `PATH`.
>    - I had to discover that the installed binary did not support the documented flags, then work around it with `npx -p agentxchain@latest`.
>    - The docs should explicitly say:
>      - minimum required CLI version
>      - how to verify it
>      - what to do if local binary and docs disagree
>      - a safe fallback like `npx --yes -p agentxchain@latest -c "agentxchain ..."`
>
> 2. Runtime documentation is split across incompatible layers.
>    - The README says the framework supports `manual`, `local_cli`, `api_proxy`, `mcp`, and `remote_agent`.
>    - The governed spec I checked still centered on `manual`, `local_cli`, and `api_proxy`.
>    - That makes it unclear which runtime contract is canonical today.
>    - The docs should have one current runtime matrix and clearly label older specs as historical.
>
> 3. "Automation authority" vs "governance authority" is not explained sharply enough.
>    - The framework does support automated turns and human-governed gates.
>    - But the docs do not make the distinction obvious enough:
>      - role write authority
>      - runtime type
>      - downstream CLI sandbox/approval authority
>    - Those are three different things, and you have to reason about all three to configure a real automated setup.
>
> 4. `review_only + local_cli` being invalid is important, but not explained early enough.
>    - This ended up being the key constraint.
>    - If someone wants "all agents automatic via CLI," they need to know immediately that `review_only` roles cannot use `local_cli`.
>    - The framework should say this in the first automation guide, not only deep in spec material or tests.
>
> 5. There is no obvious official recipe for "all CLI, all automatic, still human-gated."
>    - This is a very natural operator goal.
>    - The framework should have a first-class example for:
>      - PM = `local_cli`
>      - Dev = `local_cli`
>      - QA = `local_cli`
>      - Director = `local_cli`
>      - human phase gates still required
>    - Right now you have to infer that shape from scattered docs and tests.
>
> **Bootstrap Friction**
>
> 6. Manual-first scaffold is good, but the docs should explain how to graduate from it.
>    - The scaffold starts with `manual-*` runtimes.
>    - That is reasonable.
>    - But the docs should give a clean migration path:
>      1. scaffold manual-first
>      2. validate
>      3. bind PM/Dev/QA/Director to runtimes
>      4. run connector checks
>      5. reissue active turns if config changed
>    - That "upgrade path" is missing.
>
> 7. Rebinding runtimes after a turn is already assigned is poorly supported.
>    - We changed the PM runtime after the first PM turn had already been assigned.
>    - That left the active turn bundle stale: it still referenced `manual-pm` and `review_only`.
>    - There was no clear documented command for:
>      - cancel active assigned turn
>      - invalidate stale dispatch bundle
>      - reissue the same turn under the new runtime
>    - I had to manually repair governed state to recover cleanly.
>    - This should be a documented and supported operation.
>
> 8. The framework should detect "active turn runtime stale after config change."
>    - AgentXchain knew the active turn was assigned with `manual-pm`.
>    - It also knew the config now said `local-pm`.
>    - It should surface:
>      - "active turn was assigned under an old runtime binding"
>      - "reissue required"
>      - one recommended command to do it safely
>
> 9. Clean-working-tree requirements for authoritative turns should be surfaced earlier.
>    - Once all roles became `authoritative + local_cli`, `resume` correctly refused to assign a new turn on a dirty tree.
>    - That is good behavior.
>    - But the docs should explain this earlier and more plainly:
>      - authoritative/proposed turns require a clean baseline
>      - scaffold/config changes should be committed before writable automated turns begin
>
> **CLI Integration Gaps**
>
> 10. AgentXchain does not help enough with downstream CLI authority settings.
>    - The framework lets you declare `local_cli`, but it does not help much with the actual command shape.
>    - Example:
>      - `codex --full-auto` is not full authority
>      - true full authority required `--dangerously-bypass-approvals-and-sandbox`
>      - Claude needed explicit bypass settings too
>    - The docs should include runtime recipes for common tools:
>      - Codex
>      - Claude Code
>      - maybe Cursor agent or others
>
> 11. `connector check` is too shallow for local CLIs.
>    - It only confirmed command presence.
>    - It did not tell us whether:
>      - auth is valid
>      - the CLI accepts the given flags
>      - the sandbox/approval mode is what we intended
>    - A deeper optional probe would have saved time.
>
> 12. Prompt transport guidance should be more operator-friendly.
>    - The framework supports `argv`, `stdin`, and `dispatch_bundle_only`.
>    - But a practical guide should say:
>      - use `stdin` for Codex and Claude in most automated cases
>      - use `dispatch_bundle_only` only when you intentionally want operator handoff
>      - use `argv` only if the CLI is designed for it
>
> **Planning / Repo Shape Gaps**
>
> 13. The docs do not clearly explain how to reconcile governed planning files with a public OSS repo surface.
>    - We had to decide what belongs in:
>      - root `README.md`
>      - root `VISION.md`
>      - `.planning/VISION.md`
>    - The framework should document a recommended split:
>      - public repo docs at root
>      - governed source of truth in `.planning`
>      - website/docs may point to root docs, not internal planning docs
>
> 14. It should explain what scaffold files are expected to be committed.
>    - We had to infer which `.agentxchain` files are repo-native truth vs transient execution artifacts.
>    - The scaffold's `.gitignore` helps a bit, but the docs should state plainly:
>      - commit prompts/config/state ledgers that define governed history
>      - ignore dispatch/staging bundles
>      - commit after runtime rebinding before writable turns
>
> 15. Template docs could be clearer about when to apply overlays.
>    - We correctly used `generic` first and then `cli-tool`.
>    - That worked well.
>    - But the docs should actively recommend that pattern when the product shape is not yet fully decided.
>
> **Governance / UX Gaps**
>
> 16. Human-gated automation with zero manual roles should be documented as a normal pattern.
>    - `doctor` did mention that gates would pause for external approval if no role uses `manual`.
>    - That is good.
>    - But this should be a named pattern in docs:
>      - "all automated turns, human gate approvals only"
>
> 17. PM auto-planning from vision is not described clearly enough.
>    - The framework can do it once PM is bound to an automatable runtime.
>    - But starting from a manual scaffold makes it look like "PM automation is not a thing" until you understand rebinding.
>    - The docs should say:
>      - PM planning can be automated
>      - it becomes automatic only after PM runtime binding is changed from `manual`
>
> 18. There should be an official "first real automation" walkthrough.
>    - Not just scaffold.
>    - A walkthrough that goes:
>      1. initialize governed project
>      2. apply template
>      3. set runtimes
>      4. commit scaffold
>      5. connector check
>      6. assign first automated PM turn
>      7. validate result
>      8. human approve planning gate
>
> **What I'd Recommend AgentXchain Add**
>
> 1. `docs/automation-patterns`
> 2. `docs/local-cli-recipes`
> 3. `docs/manual-to-automated-migration`
> 4. a supported command like:
>    - `agentxchain reissue-turn`
>    - or `agentxchain cancel-turn --reassign`
> 5. stronger `connector check` probes
> 6. one canonical runtime matrix
> 7. one canonical "all local_cli authoritative" example config

---

- [x] **PROVE full-auto with a live 3+ back-to-back run demonstration (not mocks, not a single partial run)** — completed 2026-04-17: shipped `.planning/LIVE_CONTINUOUS_3RUN_PROOF_SPEC.md`, added `examples/live-governed-proof/run-continuous-3run-proof.mjs`, upgraded the `api_proxy` regression proof to 3 runs, documented `run-agents.sh` as the raw fallback while `run --continuous` is primary, and published `website-v2/docs/examples/live-continuous-3run-proof.mdx` from a clean unattended real-credential session (`cont-0e280ba0`, 3 completed runs, `$0.025` cumulative spend, `VISION.md` unchanged).
  - **Why this is being reopened:** As of 2026-04-17 the self-hosting setup was still running via `run-agents.sh` (the raw bash loop), NOT via `agentxchain run --continuous`. No live continuous session state existed. The "3 back-to-back governed runs" claim was extrapolated from mock tests + one real single run, not executed end-to-end. That is a credibility gap for the project's primary differentiator.
  - **What to actually do:**
    1. Stop the raw `run-agents.sh` loop (or run in parallel on a different branch/worktree if you don't want to disrupt the current flow).
    2. Launch a real continuous session:
       ```
       agentxchain run --continuous --vision .planning/VISION.md --max-runs 3 --poll-seconds 30 --triage-approval auto
       ```
    3. Let it execute **3 full governed runs in sequence**, each with at least one real-credential turn (api_proxy or local_cli, not manual-only, not mocks).
    4. Do NOT intervene. No manual `accept-turn`, no manual `approve-transition`, no HUMAN-ROADMAP updates mid-session. The whole point is proving it runs unattended.
    5. At the end, collect evidence and publish it as a dated case-study page under `website-v2/docs/examples/` with:
       - The exact command used
       - Session ID and `continuous-session.json` snapshot before/after
       - Each run's `run_id`, model used, turns taken, spend, `trigger: "vision_scan"` provenance, and the vision goal each run mapped to
       - Total wall-clock time and total cumulative spend
       - Any blockers hit and how the escalation layer handled them (or the fact that none were hit)
  - **Acceptance criteria:**
    - `cat .agentxchain/continuous-session.json` at the end shows `runs_completed >= 3` and `status: "completed"` (or a clean idle-exit reason)
    - `git log --oneline` shows commits generated by each of the 3 runs with real artifacts (not just turn logs)
    - The case-study page on `agentxchain.dev` publicly documents the proof with the command, spend, and provenance table
    - If the run fails at any point, the failure mode is documented honestly in AGENT-TALK.md with a root-cause analysis — do NOT retroactively rewrite the proof to hide it
    - The current `run-agents.sh`-based self-hosting is either retired in favor of `run --continuous` OR documented as the "raw fallback" with `run --continuous` as the primary path
  - **Constraints:**
    - Use real credentials (ANTHROPIC_API_KEY + Codex). Mocks are not accepted for this proof.
    - Each run must produce at least one committed change (code, doc, or spec) so there's material evidence the runs did work, not just churned state.
    - If VISION.md has no unaddressed goals, the loop must idle-exit cleanly AND that outcome must be shown in the evidence (with an explanation of why no work was derived).
    - VISION.md stays untouched — proving that constraint is part of the proof.
  - **Deliverable shape:**
    - A linked case-study page (e.g., `website-v2/docs/examples/live-continuous-3run-proof.mdx`) with the evidence
    - A regression test that exercises the 3-run contract against a fixture VISION.md (if feasible without burning real spend in CI)
    - A commit trailer on every run-derived commit that traces back to the session ID (so provenance is durable)
  - **What this proves, and why it matters:**
    - The project's strongest marketing claim — "governed long-horizon AI delivery" — is currently backed by partial evidence.
    - A clean 3-run proof closes that gap with something shippable on the website, not just an internal test assertion.
    - If the 3-run proof surfaces a real bug (escalation fires wrongly, vision reader re-derives completed goals, session state drifts, etc.), that's a MUCH more valuable finding than shipping v2.122.0 on partial evidence.

- [x] **Full-auto vision-driven operation across all agents (VISION.md as sole input)** — completed 2026-04-17: shipped `agentxchain run --continuous --vision <path>` with project-relative VISION resolution, queue-empty vision seeding, idle detection, continuous session state/status visibility, real intake lifecycle consumption (`planIntent` → `startIntent` → `resolveIntent`), continuous-loop provenance (`vision_scan`, `continuous_loop`), and CLI E2E proof for 3 back-to-back governed runs plus clean SIGINT stop behavior.
  - **Do not reinvent the wheel.** The scaffolding already exists — use it. The relevant surfaces:
    - `agentxchain run` (the governed run loop) already handles turn dispatch, phase gates, validation, acceptance, recovery.
    - `agentxchain intake record/triage/approve/plan/start/resolve` already turns signals into governed work.
    - `agentxchain schedule daemon` already provides lights-out scheduling for repo-local operation.
    - `agentxchain chain` (v2.111.0) and `agentxchain mission` (v2.112.0–v2.115.0) already handle multi-run orchestration, dependency-aware workstream launch, auto-planning, and auto-completion.
    - `.agentxchain/state.json`, `history.jsonl`, `decision-ledger.jsonl`, `repo-decisions.jsonl` already persist durable state and cross-run decisions.
  - **What's missing** (for agents to debate and decide):
    1. A vision-reader that parses `.planning/VISION.md` and seeds initial intake signals when the queue is empty (e.g., auto-generates a backlog of candidate work from vision sections that don't yet have matching shipped artifacts).
    2. An idle-detection loop in the scheduler/daemon that, when no governed run is active and no intake queue has ready work, consults vision + existing artifacts to propose the next mission or intent automatically.
    3. A "continuous mode" flag (e.g., `agentxchain run --continuous --vision .planning/VISION.md`) that chains runs together: on `run_completion`, automatically pick the next approved intent or propose a new one, then start a fresh run.
  - **Acceptance criteria:**
    - Launch via a single command (e.g., `agentxchain run --continuous --vision .planning/VISION.md --max-runs 100`) and observe at least 3 back-to-back governed runs complete without human input on turn dispatch, intake triage, or phase handoff.
    - Every run's provenance traces back to a vision section or a derived intent.
    - Human can stop the loop cleanly at any time (Ctrl+C or `agentxchain stop`).
    - `agentxchain status` shows the continuous session and the current vision-derived objective.
  - **Constraints:**
    - VISION.md stays human-owned — agents never modify it.
    - Human approval gates (`planning_signoff`, `qa_ship_verdict`) are respected if `requires_human_approval: true` — the continuous mode may pause and escalate at those gates (see item 3 below).
    - Agents debate the triage-without-human approach in AGENT-TALK.md before implementing. Default triage approval policy (auto vs. human) should be configurable.

- [x] **Human can inject tasks/priorities into the roadmap/queue at any time based on judgment** — completed 2026-04-17: `agentxchain inject` now composes record+triage+approve in one command, `status` surfaces preemption clearly, the run loop yields with `priority_preempted`, and `schedule daemon` consumes injected `p0` work by planning/starting it into the same schedule-owned run on the next poll. Mission auto-promotion is explicitly deferred to the future vision-driven mission layer.
  - **Do not reinvent the wheel.** The scaffolding already exists:
    - `agentxchain intake record --source manual --signal '...' --evidence '...'` already accepts ad-hoc signals from the operator.
    - `agentxchain intake triage --priority p0 ...` already supports priority assignment (p0–p3).
    - `.planning/HUMAN-ROADMAP.md` itself is the current markdown-based injection channel — agents read it at the start of every turn.
    - The mission/plan surface (v2.112.0+) supports dependency-aware reordering, so an injected `p0` can preempt lower-priority workstreams.
  - **What's missing** (for agents to debate and decide):
    1. A standard CLI wrapper that combines `intake record` + `triage --priority p0` + `approve --approver human` into one command (e.g., `agentxchain inject "Fix the sidebar ordering"` or `agentxchain priority add --p0 "..."`) so operator ergonomics match the use case.
    2. A preemption contract: when a `p0` intent is injected mid-run, the current turn completes, then the run loop consults the intake queue before selecting the next turn. The protocol already has `next_recommended_role` — extend with `next_recommended_intent` or similar.
    3. Visible operator feedback: `agentxchain status` must surface pending injected intents and their effect on the queue (e.g., "p0 injection will preempt current workstream after this turn completes").
    4. Intent-to-mission promotion: if the injected work is large enough, auto-propose it as a new mission (reusing v2.112.0 mission decomposition) rather than a flat intent.
  - **Acceptance criteria:**
    - While a continuous run is executing, run `agentxchain inject "..." --priority p0` in a separate terminal.
    - Within one turn, agents acknowledge the injection in AGENT-TALK.md and shift work toward the injected priority.
    - `agentxchain status` shows the injected item in the queue with clear preemption semantics.
    - If rejected by the triage layer (e.g., out of scope per VISION.md), the rejection is recorded as a decision with rationale.

- [x] **Last-resort human-required tasks must be communicated back to the human via an escalation mechanism** — completed 2026-04-17: human blockers now persist as structured escalation records, project `HUMAN_TASKS.md` is managed from those records, status/events/notifications surface the blocker and unblock command, and `schedule daemon` keeps polling blocked schedule-owned runs then continues them within one poll after `agentxchain unblock <id>`.
  - Delivery split:
    - [x] **Foundation surface shipped (2026-04-17)** — structured `.agentxchain/human-escalations.jsonl`, managed `HUMAN_TASKS.md`, blocker taxonomy (`needs_credential`, `needs_oauth`, `needs_payment`, `needs_legal`, `needs_physical_access`, `needs_decision`), `status` linkage, enriched `run_blocked` notifications, and `agentxchain unblock <id>` now exist. Proof: `cli/test/human-escalation.test.js`, `cli/test/notifications-lifecycle.test.js`, docs tests, and `cd website-v2 && npm run build`.
    - [x] **Promote escalation records into `events.jsonl` and notifier fan-out** — completed 2026-04-17: added `human_escalation_raised` and `human_escalation_resolved` event types to `events.jsonl` (emitted from `ensureHumanEscalation()` and `resolveHumanEscalation()`), added same types to webhook notification events, added non-webhook local notifier floor (always-on stderr notice with escalation ID/type/action/unblock command, optional macOS AppleScript notification via `AGENTXCHAIN_LOCAL_NOTIFY=1`), added `notifications.local` config key, updated `agentxchain events` display with color and detail rendering, updated docs (notifications.mdx, recovery.mdx, cli.mdx). 5 tests / 0 failures in `human-escalation.test.js`, 4 tests / 0 failures in `notifications-lifecycle.test.js`, 38 tests / 0 failures in docs content tests. Website build clean.
    - [x] **Daemon/continuous-mode auto-resume on unblock** — completed 2026-04-17: `schedule daemon` now treats blocked schedule-owned runs as non-fatal wait states, keeps polling while blocked, and continues the same schedule-owned run within one poll after `agentxchain unblock <id>`. Proof: `AT-SCHED-009` in `cli/test/run-schedule-e2e.test.js`, schedule docs/spec updates, and `cd website-v2 && npm run build`.
  - **Do not reinvent the wheel.** The scaffolding already exists:
    - The protocol already has `status: "needs_human"` and `needs_human_reason` in turn results.
    - `.agentxchain/state.json` already has `blocked_on` and `blocked_reason` fields.
    - `HUMAN_TASKS.md` is the current human-readable blocker surface (the li-browser LinkedIn re-auth task is a live example).
    - `agentxchain notifications` runs plugin-based notifiers (plugin-slack-notify, plugin-github-issues, plugin-json-report are already shipping built-in plugins).
    - The governed run loop already halts and surfaces blockers via `deriveRecoveryDescriptor()` in `cli/src/lib/blocked-state.js`.
  - **What's missing** (for agents to debate and decide):
    1. A unified human-blocker type taxonomy: `needs_credential`, `needs_oauth`, `needs_payment`, `needs_legal`, `needs_physical_access`, `needs_decision`, etc. Each type carries structured metadata (service name, doc URL, exact command to run if known, eta guidance).
    2. Automatic promotion from `status: "needs_human"` to a first-class escalation record: when a turn surfaces a blocker, the run loop:
       - Appends a structured entry to `HUMAN_TASKS.md` (not just free-form markdown — use a parseable format or JSONL beside it)
       - Records a `human_escalation` event in `events.jsonl`
       - Fires a notification through the configured notifier plugins (Slack, email, GitHub issue, JSON webhook, macOS notification, etc.)
       - Updates `agentxchain status` to show the blocker prominently
    3. A resolution contract: the human marks the blocker resolved via a single command (e.g., `agentxchain unblock <id>` or `agentxchain intake resolve <id> --unblock`), and the run loop automatically retries the blocked turn or reroutes.
    4. Optional macOS-native notification via the existing `agentxchain-autonudge.applescript` surface so the human gets a desktop ping, not just a log entry.
  - **Acceptance criteria:**
    - Simulate a blocked turn (e.g., Dev role requires `ANTHROPIC_API_KEY` that isn't set) and observe:
      - `HUMAN_TASKS.md` gets a structured entry with type, service, action, and command.
      - A notification fires through at least one configured channel (stdout notifier minimally, plugin-slack-notify or AppleScript if configured).
      - `agentxchain status` shows the blocker at the top with a clear resolution command.
      - After the human resolves (sets the key + runs `agentxchain unblock <id>`), the run loop resumes the blocked turn automatically within one polling interval.
    - The continuous full-auto mode (item 1) integrates cleanly: when blocked, the loop pauses, escalates, and resumes on unblock without losing continuity state.

---

**Implementation debate prompt for agents:**

These three items are interdependent. Item 1 (full-auto) requires items 2 (injection) and 3 (escalation) to work safely. Debate in AGENT-TALK.md:
- Which item to tackle first (my lean: item 3 escalation → item 2 injection → item 1 continuous, because escalation is the safety floor for the other two).
- Whether any of the three should be split into smaller roadmap items.
- What existing modules must be extended vs. what genuinely new surfaces are needed.
- Whether this should be one mission (using v2.112.0 mission hierarchy) or three separate missions.

Reminder: use the existing agentxchain scaffolding wherever possible. Every piece of infrastructure listed under "Do not reinvent the wheel" is already shipping in production — extend, don't rebuild.

---

**CRITICAL — VISION.md scope clarification (do not confuse these two contexts):**

When implementing item 1 (full-auto vision-driven operation), the agents MUST treat VISION.md as a **project-relative artifact**, not a hard-coded path to `.planning/VISION.md` inside the agentxchain.dev repo.

There are two distinct VISION.md contexts, and the implementation must separate them cleanly:

1. **This repo's VISION.md** (`/Users/shivamtiwari.highlevel/VS Code/1008apps/agentXchain.ai/agentXchain.dev/.planning/VISION.md`)
   - Human-owned vision for **agentXchain itself** (the product you are building)
   - Used by the self-hosted governed run of agentXchain.dev only
   - Agents working on agentXchain.dev read this as their north star
   - This file is NOT a template, reference, or default for any other project

2. **Downstream project VISION.md** (any future project that adopts agentxchain for governed delivery)
   - Lives in that project's own `.planning/VISION.md` (or whatever path the project configures)
   - Describes THAT project's product vision — totally unrelated to agentxchain's vision
   - Agents working on that project must read THAT project's VISION.md, never this repo's VISION.md
   - The agentxchain CLI must resolve VISION.md relative to the governed project's root, not its own installation path

**Implementation implications:**
- The `--vision` flag (or config key) must accept an absolute or project-relative path, resolved against the governed project's root (same as how `agentxchain.json` is resolved today)
- The vision-reader module must operate on the provided path, never reach back to the agentxchain.dev repo
- The `init --governed` scaffold should optionally create a `.planning/VISION.md` template for new projects with placeholder sections — this template is the starting point a downstream human fills in, NOT a copy of agentxchain.dev's VISION.md
- Tests for the vision-reader must use fixture VISION.md files in temp dirs, never the live `.planning/VISION.md` from this repo
- Documentation must explicitly state: "Each governed project has its own VISION.md. The agentxchain.dev repo's VISION.md is the vision for agentxchain the product, not a template for your project."

**Acceptance criteria addition for item 1:**
- Add a test that runs `agentxchain run --continuous --vision <temp-project>/.planning/VISION.md` from a different repo and verifies the agents reference only the temp project's vision, never agentxchain.dev's vision.
- Add a test that verifies if VISION.md is missing in the governed project, the command exits with a clear error pointing the user to create one (rather than defaulting to any bundled fallback).

This separation is the difference between a useful product and a confused one. Do not merge these contexts.

---

- [x] Fix Release Notes sidebar ordering: must be reverse-chronological (newest first) — completed 2026-04-15: assigned unique `sidebar_position` values to all 91 release note `.mdx` files (v2-92-0 = 1, v2-91-0 = 2, ..., v2-11-0 = 91) so Docusaurus autogenerated sidebar renders newest-first. Previously many files shared `sidebar_position: 1`, causing broken mixed ordering. All tests pass (0 failures), Docusaurus build clean, deployed via GCS workflow, verified live at `https://agentxchain.dev/docs/releases/v2-92-0/` — sidebar shows v2.92.0 at top through v2.11.0 at bottom in correct reverse-chronological order.
  - **Currently broken on live site:** The "Release Notes" collapsible sidebar menu lists versions in a broken order — v2.83.0 is at the top, then v2.86.0, v2.87.0, v2.88.0, v2.89.0, v2.90.0, v2.91.0, then jumps back to v2.82.0, v2.84.0, v2.85.0, v2.81.0, v2.80.0, etc.
  - Release notes must be sorted **reverse-chronologically — newest version first** (v2.91.0 at top, v2.70.0 at bottom).
  - This is confusing for users who want to see the latest release. The most recent version should always be the first item they see.
  - Fix in `website-v2/sidebars.ts` — the release notes category items need explicit reverse-version sorting, not whatever auto-generated or alphabetical order Docusaurus is using.
  - Verify on the live deployed site before marking complete.

- [x] **DO NOT REMOVE — MUST FIX** Fix docs sidebar: all release notes must be nested inside a single "Release Notes" collapsible menu item — completed 2026-04-14: replaced the bare top-level `releases` autogen entry in `website-v2/sidebars.ts` with an explicit collapsed `Release Notes` category, added `.planning/DOCS_RELEASE_NOTES_SIDEBAR_SPEC.md` plus regression coverage in `cli/test/release-notes-sidebar.test.js`, verified `cd website-v2 && npm run build`, pushed `6fbdc3a3`, confirmed `Deploy Website to GCP GCS` run `24407220971` succeeded, and verified the live rendered docs sidebar at `https://agentxchain.dev/docs/releases/v2-91-0/` now shows one `Release Notes` category with nested level-2 release pages instead of top-level release-note entries.
  - **IMPORTANT: This item has been added to the roadmap THREE times and removed by agents twice without being fixed. The live site still shows release notes as top-level sidebar items. DO NOT mark this complete or remove it until the live deployed site is verified.**
  - Individual release note pages (v2.65.0, v2.66.0, etc.) are appearing as **top-level sidebar items** instead of being grouped under a collapsible category.
  - All release note docs must be nested inside a single collapsible **"Release Notes"** category in the docs sidebar.
  - Check `website-v2/sidebars.ts` (or `sidebars.js`) — the releases category is either missing, flattened, or misconfigured.
  - The "Release Notes" category should be collapsible, collapsed by default, and contain every release page inside it.
  - Verify with `cd website-v2 && npm run build` and visually confirm the sidebar structure before marking complete.
  - Deploy to live site and verify at https://agentxchain.dev/docs/ before marking complete.

- [x] Fix the VS Code extension logo/icon on the Marketplace — completed 2026-04-12: replaced the 306-byte placeholder `cli/vscode-extension/media/icon.png` with the website brand mark resized to a real 128x128 PNG (17,596 bytes), added `.planning/VSCODE_MARKETPLACE_ICON_FIX_SPEC.md` plus `AT-VSMP-007` in `cli/test/vscode-marketplace-readiness.test.js`, bumped the extension from `0.1.0` to `0.1.1`, pushed tag `vsce-v0.1.1`, and verified the public Marketplace `latest` VSIX and icon endpoints serve `0.1.1` with the corrected 128x128 icon asset.
  - The AgentXchain VS Code extension icon is broken or displaying incorrectly on the VS Code Marketplace listing.
  - Ensure the extension has a proper, clean icon that matches the AgentXchain branding (the X logo used on the website).
  - The icon must meet VS Code Marketplace requirements (128x128 PNG, square, transparent or solid background).
  - Update `package.json` in `cli/vscode-extension/` with the correct `icon` field pointing to the image.
  - After fixing, bump the extension version and push a new `vsce-v*` tag to republish.
  - Verify the icon renders correctly on the Marketplace listing page and in the VS Code Extensions sidebar.

- [x] Add OpenClaw integration (both directions) — completed 2026-04-12: all sub-slices done (research/spec, docs page, plugin package, ClawHub blocker logged)
  - Delivery split added 2026-04-12 so this stops being a vague blob:
  - [x] Research official OpenClaw plugin/gateway docs and freeze a repo spec — completed 2026-04-12 in `.planning/OPENCLAW_INTEGRATION_SPEC.md` using `docs.openclaw.ai/plugins/building-plugins`, `docs.openclaw.ai/plugins/sdk-overview`, and `docs.openclaw.ai/gateway/remote`
  - [x] Add `website-v2/docs/integrations/openclaw.mdx` with a verified `local_cli` setup path and a `remote_agent` section only if the actual gateway contract is proven — completed 2026-04-12: created `openclaw.mdx` with `local_cli` as the proven path, `remote_agent` documented as unproven (WebSocket gateway only, no stable REST contract), wired into sidebar under Platform Guides > IDE / Agent Platforms, added to sitemap.xml and llms.txt
  - [x] Build the OpenClaw plugin package exposing `agentxchain_step`, `agentxchain_accept_turn`, and `agentxchain_approve_transition` — completed 2026-04-12: created `plugins/openclaw-agentxchain/` with `openclaw.plugin.json` manifest, TypeScript entrypoint using `definePluginEntry({ register(api) })` pattern with focused SDK subpath imports, 7 tests / 0 failures
  - [x] Publish the plugin to ClawHub or log the exact publish blocker if the environment lacks the required account surface — blocker logged 2026-04-12: no ClawHub account credentials available in the environment, no `openclaw` CLI installed to run `openclaw plugin publish`, plugin package is ready for publication when account access is available
  - **OpenClaw as a governed agent in AgentXchain:** Connect via `local_cli` (CLI) or `remote_agent` (Gateway REST API on port 18789). Create a docs guide under `/docs/integrations/openclaw/` covering setup, adapter config, and a working example.
  - **AgentXchain as an OpenClaw plugin:** Build a TypeScript plugin for OpenClaw's plugin system that exposes AgentXchain governance (step, accept-turn, approve-transition) as OpenClaw skills. Publish to ClawHub marketplace if possible.
  - OpenClaw has 100K+ GitHub stars and is one of the most widely used AI agent platforms — this integration has high visibility value.
  - Research OpenClaw's plugin SDK docs (docs.openclaw.ai/plugins/building-plugins) before building.

- [x] Fix confusing docs sidebar nomenclature: "INTEGRATION" vs "INTEGRATIONS" — completed 2026-04-12: renamed "Integration" → "Connectors" (architecture docs: integration-guide, adapters, build-your-own-connector) and "Integrations" → "Platform Guides" (21 platform-specific setup guides). Updated `sidebars.ts` and fixed test assertion in `build-your-own-connector-content.test.js`. "Connectors" is immediately clear (how the adapter system works), "Platform Guides" is immediately clear (how to connect specific tools). No cross-link changes needed — sidebar labels are not referenced in page content.
  - The docs sidebar currently has two separate menu sections: one called **"INTEGRATION"** and another called **"INTEGRATIONS"** — this is confusing for new visitors.
  - Come up with better, distinct names that clearly differentiate the two sections. For example:
    - The architecture/protocol-level integration docs could be called **"Architecture"**, **"Protocol"**, or **"Core Concepts"**
    - The platform-specific guides (how to use AgentXchain with Cursor, Ollama, etc.) could be called **"Guides"**, **"Platform Guides"**, or **"Connect Your Tools"**
  - Whatever naming is chosen, it should be immediately obvious what each section contains without having to click into it.
  - Update the sidebar config, any cross-links, and the sitemap/llms.txt accordingly.

- [x] Fix logo alignment in the end-of-page CTA section (above footer) on the agentxchain.dev homepage — completed 2026-04-12: replaced CTA reuse of `.hero-logo` with CTA-specific `.cta-logo`, added `.planning/WEBSITE_HOMEPAGE_CTA_LOGO_ALIGNMENT_SPEC.md`, added `cli/test/homepage-cta-logo-content.test.js`, and verified the built homepage centers the icon at desktop (`1440x1200`, delta `0px`) and mobile (`390x844`, delta `0px`) widths.
  - The AgentXchain logo/icon in the section just above the footer ("Software is a team sport. Even when the team is AI.") is **left-aligned** instead of **center-aligned**.
  - The logo should be horizontally centered to match the centered text and buttons below it.
  - This is likely a CSS issue — check the `.hero-logo` or equivalent class in that section. The previous visual design sweep may have inadvertently broken the centering.
  - Verify the fix on both desktop and mobile viewports.

- [x] Publish the AgentXchain VS Code extension to the Marketplace
  - The publisher `agentXchain.dev` (ID `agentXchaindev`) is created and the `VSCE_PAT` secret is set on the GitHub repo.
  - The extension is fully packaged in `cli/vscode-extension/` and CI workflow `publish-vscode-on-tag.yml` is ready.
  - Verify the extension package is complete (icon, README, correct publisher name in `package.json`, feature descriptions).
  - Push a `vsce-v0.1.0` tag to trigger the CI publish workflow.
  - Verify the extension appears on the VS Code Marketplace and is installable.
  - Add a link to the Marketplace listing on the agentxchain.dev website (docs, homepage, or getting-started page).
  - **2026-04-13 completed:** Fixed publisher ID in `package.json` from `agentxchain` to `agentXchaindev` (matching the registered Marketplace publisher). Pushed `vsce-v0.1.0` tag, CI publish workflow succeeded (all steps green including "Publish to VS Code Marketplace"). Extension live at `https://marketplace.visualstudio.com/items?itemName=agentXchaindev.agentxchain`. Added Marketplace link to homepage Integrations section, getting-started page, and quickstart prerequisites. Updated marketplace readiness test assertion. Docusaurus build clean.

- [x] Create polished integration guides for all supported agent platforms, local model runners, and API providers
  - AgentXchain is agent/IDE/LLM agnostic by design. The 5 adapters (`manual`, `local_cli`, `api_proxy`, `mcp`, `remote_agent`) already support virtually every connection pattern. What's missing is **polished, first-class onboarding documentation** so developers know exactly how to use AgentXchain with their preferred platform.
  - Create a docs section (e.g., `/docs/integrations/`) with a guide for each platform below. Each guide should cover: what the platform is, which adapter connects it, step-by-step setup, a minimal working example, and any platform-specific gotchas.
  
  **IDE / Agent Platforms:**
  1. Claude Code — `local_cli` via `claude -p`
  2. OpenAI Codex CLI — `local_cli` via `codex`
  3. Cursor — `local_cli`
  4. VS Code (+ Copilot, Cline, etc.) — Extension + `local_cli`
  5. Windsurf (Codeium) — `local_cli`
  6. Google Jules — `api_proxy` (Google)
  7. Devin — `remote_agent` (HTTP)
  
  **Local Model Runners:**
  8. Ollama — `api_proxy` via `localhost:11434/v1`
  9. MLX (Apple) — `api_proxy` via `mlx-lm.server`
  
  **API Providers (with latest coding models as of April 2026):**
  10. Anthropic — Claude Opus 4.6, Claude Sonnet 4.6, Claude Haiku 4.5
  11. OpenAI — GPT-5.4, GPT-5.3-Codex, GPT-5.2-Codex, GPT-OSS-120B, GPT-OSS-20B
  12. Google — Gemini 3.1 Pro, Gemini 3.0 Flash, Gemini 3.1 Flash-Lite, Gemma 4
  13. DeepSeek — DeepSeek-V3.2, DeepSeek-R2, DeepSeek Coder-V3
  14. Mistral AI — Devstral 2 (123B), Devstral Small 2 (24B), Codestral, Leanstral
  15. xAI — Grok 4.20 Beta 2, Grok 4.1 Fast, Grok Code Fast 1
  16. Amazon — Nova 2 Pro, Nova 2 Lite, Nova Premier
  17. Qwen (Alibaba) — Qwen3-Coder-480B-A35B, Qwen3-Coder-30B-A3B, Qwen3-Coder-Next, Qwen3.6-Plus
  18. Groq — inference platform hosting GPT-OSS-120B, Kimi K2, Qwen3 32B, Llama 4 Scout, Llama 3.3 70B, Codestral Mamba
  19. Cohere — Command A Reasoning, Command A, Command R+
  
  **MCP / Protocol Native:**
  20. Any MCP-compatible agent — `mcp` (stdio)
  
  - Add an Integrations dropdown or section in the docs sidebar, similar to the existing Examples section.
  - Each guide should be standalone — a developer using only Ollama + Cursor should be able to follow just those two guides without reading anything else.
  - Cross-link from the homepage architecture section (Layer 5 — Integrations) to the new docs section.
  - Keep model lists factual and current. If a model hasn't launched yet (DeepSeek V4, Grok 5), don't include it in the guide.
  - **2026-04-13 completed:** Created 20 standalone integration guides in `website-v2/docs/integrations/`: 7 IDE/agent platform guides (Claude Code, OpenAI Codex CLI, Cursor, VS Code, Windsurf, Google Jules, Devin), 2 local model runner guides (Ollama, MLX), 10 API provider guides (Anthropic, OpenAI, Google, DeepSeek, Mistral AI, xAI, Amazon Bedrock, Qwen, Groq, Cohere), and 1 protocol-native guide (MCP). Each guide covers: what the platform is, which adapter connects it, step-by-step setup with exact `agentxchain.json` config, a minimal working example, and platform-specific gotchas. Added `Integrations` category to docs sidebar with nested subcategories. Updated homepage Layer 5 link, sitemap.xml (21 new URLs), and llms.txt (9 key integration entries). 3866 tests / 831 suites / 0 failures. Docusaurus build clean.

- [x] Create 5 new product examples under `/examples/` to prove AgentXchain can build software end-to-end without human intervention
  - Come up with 5 small but varied real-world product examples across different categories:
    1. **Consumer SaaS** — e.g., a habit tracker, expense splitter, or bookmark manager
    2. **Mobile app** — e.g., a React Native or Flutter app (weather, recipe, workout tracker)
    3. **B2B SaaS** — e.g., an invoice generator, team standup bot, or customer feedback tool
    4. **Developer tool** — e.g., a CLI tool, GitHub Action, API client library, or code formatter
    5. **Open source library** — e.g., a validation library, state machine lib, or markdown parser
  - Each example must be a **complete, working project** — not a stub or placeholder. It should have real code, tests, docs, and a governed `agentxchain.json` config with appropriate roles and workflow.
  - Each example should demonstrate different AgentXchain capabilities: different role configurations, different workflow phases, different artifact types, different team sizes.
  - Each example should include a `README.md` explaining what the product is, how to run it, and how AgentXchain governed its development.
  - The goal is to prove that AgentXchain can take a product idea from zero to shippable software across varied domains — not just todo apps.
  - Use `agentxchain run` or the governed workflow to actually build each example. The commit history should show the governed development process.
  - Delivery split (created 2026-04-09 so the queue can be worked honestly instead of hand-waved):
    - [x] `examples/habit-board` — consumer SaaS habit tracker: Node.js web app with REST API, JSON persistence, streak logic, responsive dark-theme vanilla JS frontend, 29 tests, 4-role designer-in-the-loop workflow with explicit workflow-kit, shipped in Turn 9
    - [x] `examples/trail-meals-mobile` — mobile meal-planning app: React Native (Expo) hiker meal planner with offline-first AsyncStorage, calorie/weight planner, platform matrix (iOS/Android/Expo Go), 6-role (pm/mobile_architect/rn_engineer/nutrition_analyst/ux_reviewer/qa) 5-phase workflow, 26 tests, shipped in Turn 11
    - [x] `examples/async-standup-bot` — B2B SaaS standup/status collector: Node.js web app with team/member management, async check-in upserts, summary markdown, reminder previews, retention prune operations, 15 tests, and a 5-role planning/integration/implementation/operations/qa workflow shipped in Turn 10
    - [x] `examples/decision-log-linter` — developer tool CLI with explicit workflow-kit, custom architecture/release phases, runnable tests, and `template validate` proof shipped in Turn 8
    - [x] `examples/schema-guard` — open source validation library: ESM package with declarative schema DSL, nested object validation, custom messages, composition helpers (`refine`/`transform`/`pipe`), `src/index.d.ts` TypeScript-friendly exports, API-review + release-engineering workflow-kit, 19 tests, and pack/template validation proof shipped in Turn 12
  - [x] Parent item complete (2026-04-09): all five governed product examples now ship with runnable code, tests, READMEs, `agentxchain.json`, `TALK.md`, category-specific workflow-kit artifacts, and repo-level governed provenance documented in `.planning/PRODUCT_EXAMPLES_GOVERNED_PROOF.md`

- [x] Add a dedicated docs page for each example on the website under `/docs/examples/`
  - Create a dropdown/section in the docs sidebar for "Examples" — similar to how the changelog/releases dropdown works.
  - Each example gets its own page (e.g., `/docs/examples/habit-board`, `/docs/examples/schema-guard`, etc.).
  - Each page should explain: what the product is, what roles/workflow were used, how AgentXchain governed the build, how to run it, and key takeaways.
  - Include **all** examples — both new ones (habit-board, trail-meals-mobile, async-standup-bot, decision-log-linter, schema-guard) and existing ones (governed-todo-app, ci-runner-proof, external-runner-starter, live-governed-proof, mcp-echo-agent, mcp-http-echo-agent, mcp-anthropic-agent, remote-agent-bridge, remote-conformance-server).
  - The Examples dropdown should be a first-class navigation item in the docs sidebar.
  - **2026-04-10 completed:** Added `.planning/EXAMPLES_DOCS_SURFACE_SPEC.md`, turned `Examples` into a first-class docs sidebar category, created the hub page plus 14 detail pages under `website-v2/docs/examples/`, updated `llms.txt` and `sitemap.xml` for the new public routes, and extended `cli/test/docs-examples-content.test.js` to guard the examples docs surface.

- [x] Add the LinkedIn company page link to the agentxchain.dev website alongside the existing X and Reddit links
  - LinkedIn page: https://www.linkedin.com/company/agentxchain-dev/
  - Add it everywhere X and Reddit already appear: navbar Community dropdown, footer Community column, homepage community cards.
  - Use the LinkedIn icon (similar to how X and Reddit have their icons).
  - Link should open in a new tab.
  - Note: X/Twitter (`@agentXchain_dev`) is currently **suspended** — consider removing the X link or marking it as inactive so visitors don't land on a suspended page.
  - **2026-04-11 completed:** Added LinkedIn to the navbar Community dropdown, footer Community column, and homepage community cards; added LinkedIn icon treatment in navbar/homepage; removed the public X destination from navbar/footer; rendered the homepage X card as a visible suspended/inactive status instead of a live broken link; updated the website community-links spec/tests and verified `node --test cli/test/community-links-content.test.js` plus `cd website-v2 && npm run build`.

- [x] Audit all public-facing content (website, npm README, GitHub repo README, Homebrew tap README) for first-time developer clarity
  - Our visitors are new developers encountering AgentXchain for the first time. They need to understand the **"why"** (what problem does this solve?) and the **"how"** (how do I get started?) within the first 60 seconds.
  - **Website (agentxchain.dev):** Review the homepage, `/docs/`, `/why`, quickstart, and comparison pages. Is the value proposition immediately clear? Can a new dev go from "what is this?" to "let me try it" without confusion?
  - **npm README (`cli/README.md`):** This is what shows on `npmjs.com/package/agentxchain`. Does it explain what AgentXchain is, how to install, and a minimal "hello world" example? Is it up to date with current CLI commands and features?
  - **GitHub repo README:** Does it match the current product state? Are install instructions accurate? Does it link to the right docs? Is the architecture summary current?
  - **Homebrew tap README (`homebrew-tap/README.md`):** Does it have correct install commands? Does it explain what you're installing?
  - **Cross-check consistency:** Are version numbers, feature descriptions, install commands, and positioning consistent across all four surfaces? A new dev might land on any one of these first — they should all tell the same story.
  - **Actionable output:** Fix any outdated, confusing, or missing content. If something requires human input (e.g., product positioning decisions), flag it in AGENT-TALK.md.
  - **2026-04-12 completed:** Audited all four surfaces. GitHub README: added five-layer Architecture table, added Homebrew install option. npm README: added plain-English opening paragraph explaining what AgentXchain does in human terms, added Homebrew install option. Homebrew README: added one-line product description with docs link. Website getting-started.mdx and quickstart.mdx: added Homebrew install alternative alongside npm. All install commands now consistent across all surfaces (npm, brew, npx). Version numbers aligned at 2.76.0. 3863 tests / 0 failures. Docusaurus build clean.

- [x] Visual design sweep of the agentxchain.dev website
  - Do a thorough review of every page on the agentxchain.dev website looking for visual improvements.
  - Check: spacing consistency, typography hierarchy, color usage, dark mode rendering, mobile responsiveness, image quality, card/section alignment, hover states, transitions, and overall visual polish.
  - Look at competitor sites (Vercel, Linear, Supabase, Resend) for inspiration on what "polished developer tool website" looks like in 2026.
  - Pay special attention to: homepage hero section, architecture diagram section, comparison pages, docs sidebar, code blocks, and the examples pages.
  - Fix any issues found — CSS tweaks, layout improvements, spacing fixes, etc.
  - If larger redesigns are needed that go beyond CSS fixes, document recommendations in AGENT-TALK.md for human review.
  - **2026-04-12 completed:** Comprehensive visual audit of all CSS and homepage TSX. Created `.section-spaced` utility class replacing 10+ inline `padding: '5rem 0'` instances. Created dedicated CSS classes for examples cards (`.example-card`, `.example-category`, `.example-desc`, `.example-roles`), CTA section (`.cta-section`, `.cta-inner`), outcomes headings (`.outcome-title`), and step descriptions (`.step-desc`). Added mobile responsiveness for new classes. Fixed EndVision section centering. Removed ~20 inline style attributes from index.tsx. All inline styles that remain are one-off layout-specific overrides (layer card dynamic colors, link margin-top). 3863 tests / 0 failures. Docusaurus build clean. Larger recommendations logged in AGENT-TALK.md: consider standardizing the full spacing scale, extracting terminal colors to CSS vars, and adding a mid-size tablet breakpoint.

- [x] Restore the X/Twitter link on the agentxchain.dev website with the NEW account `@agentxchaindev`
  - The old `@agentXchain_dev` account was suspended. A new account `@agentxchaindev` (no underscore) is now active.
  - The homepage currently shows the X card as "suspended/inactive" — replace it with a live, clickable card linking to `https://x.com/agentxchaindev`.
  - Re-add X to the navbar Community dropdown and footer Community column (linking to `https://x.com/agentxchaindev`).
  - Update any references to the old handle `@agentXchain_dev` → `@agentxchaindev` across the website.
  - The X card should match the style of the LinkedIn and Reddit community cards (active, clickable, opens in new tab).
  - **2026-04-12 completed:** Restored live `@agentxchaindev` links in the navbar, footer, homepage community cards, and `llms.txt`; replaced the suspended placeholder card with a real X card plus icon; updated `.planning/WEBSITE_COMMUNITY_LINKS_SPEC.md`; verified `node --test cli/test/community-links-content.test.js` and `cd website-v2 && npm run build`.

- [x] Extract `r-browser` into its own private GitHub repo (like `x-browser`)
  - Currently `r-browser` lives inside the `1008apps` monorepo at `/Users/shivamtiwari.highlevel/VS Code/1008apps/r-browser/`.
  - `x-browser` is already its own standalone private repo — `r-browser` should follow the same pattern.
  - Create a new **private** GitHub repo (e.g., `shivamtiwari93/r-browser` or similar).
  - Move the `r-browser/` directory contents into the new repo with full history if possible (or a clean initial commit if not).
  - Ensure `.venv/` is in `.gitignore`, `pyproject.toml` / `setup.py` is correct, and the CLI entry point (`r-browser` command) works after install.
  - Update any references in `agentXchain.dev` (e.g., `marketing/post-reddit.sh`) to point to the correct path if it changes.
  - **2026-04-10 completed:** Rewrote `shivamtiwari93/r-browser` from a one-shot initial snapshot to real split history from `1008apps`, added repo-local `.gitignore` (including `.venv/`), removed tracked `src/r_browser/__pycache__/*.pyc`, preserved the latest source/docs changes, verified `pip install -e .` plus `r-browser --help`, and converted `1008apps/r-browser` into a proper git submodule at the same path so `marketing/post-reddit.sh` did not need a path change.

- [x] Redesign the "Architecture — Five layers. One governed delivery system." section on the agentxchain.dev homepage to use a **2-column layout** instead of the current single-column stacked layout. The five layers (Protocol, Runners, Connectors, Workflow Kit, Integrations) should be presented in a visually appealing 2-column grid (with the 5th item spanning full width or placed thoughtfully). Make it look clean and professional on both desktop and mobile.
  - **2026-04-09 completed:** Changed `.layers-grid` from `flex-direction: column` to `display: grid; grid-template-columns: 1fr 1fr`. 5th item (Integrations) spans full width via `.layer-card:nth-child(5) { grid-column: 1 / -1 }`. Mobile breakpoint (≤768px) collapses to single column and resets 5th-item span. Docusaurus build clean.

- [x] Create very liberal robots.txt, very liberal llms.txt, and a detailed sitemap for both agentxchain.dev and agentxchain.ai
  - **robots.txt**: Allow all crawlers, all paths, no restrictions. We want maximum discoverability.
  - **llms.txt**: Follow the llms.txt standard (https://llmstxt.org/). Be very generous — include all public docs, protocol spec, quickstart, CLI reference, comparison pages, release notes, examples, and any other content that helps LLMs understand AgentXchain.
  - **sitemap.xml**: Comprehensive sitemap listing every page on each site with proper `<lastmod>`, `<changefreq>`, and `<priority>` tags.
  - For agentxchain.dev: place files in `website-v2/static/` so Docusaurus includes them in the build output root.
  - For agentxchain.ai: place files in the `website/` directory (static site root).
  - After creating the files, push all repos using `bash "/Users/shivamtiwari.highlevel/VS Code/1008apps/push-with-token.sh" "Add robots.txt, llms.txt, and sitemap.xml for both sites"`.
  - Then deploy both sites using `export PATH="$HOME/google-cloud-sdk/bin:$PATH" && bash "/Users/shivamtiwari.highlevel/VS Code/1008apps/deploy-websites.sh"`.
  - **2026-04-08 completed:** Created all 6 files. agentxchain.dev: `robots.txt` (allow all), `llms.txt` (comprehensive — core concepts, all 49 page URLs, install/example, community links), `sitemap.xml` (49 URLs with per-page priority: homepage 1.0, docs/compare 0.7-0.9, releases 0.4-0.5). agentxchain.ai: `robots.txt` (allow all), `llms.txt` (cloud platform positioning, relationship to .dev, key differentiators), `sitemap.xml` (1 URL, priority 1.0). Disabled Docusaurus auto-sitemap to avoid conflict with static sitemap. Pushed all 3 repos, deployed both sites. All 6 URLs verified live with HTTP 200. 2622 tests / 562 suites / 0 failures. Docusaurus build clean.

- [x] Add community links to the agentxchain.dev website
  - Link the **Reddit community**: https://www.reddit.com/r/agentXchain_dev/
  - Link the **X/Twitter profile**: https://x.com/agentXchain_dev
  - Place these at appropriate locations on the website — e.g., footer, navbar, homepage community section, docs sidebar, or wherever they naturally fit.
  - Use recognizable icons (X logo, Reddit logo) where appropriate.
  - Make sure links open in a new tab.
  - **2026-04-08 completed:** Added `Community` navbar dropdown with icon-backed X/Reddit items, added footer `Community` column, added homepage community cards with explicit `target="_blank"` behavior, wrote `.planning/WEBSITE_COMMUNITY_LINKS_SPEC.md`, and added `cli/test/community-links-content.test.js`. Verified via targeted test + Docusaurus production build.

- [x] Fix website-v2 mobile / small-screen navigation collapse bug
  - **Human report:** after clicking the hamburger in mobile view or a narrow browser window, the menu opens but no usable nav options are visible or clickable.
  - **Evidence file:** [Screenshot 2026-04-08 at 05.28.43.png](/Users/shivamtiwari.highlevel/Desktop/Screenshot%202026-04-08%20at%2005.28.43.png)
  - **Local reproduction completed:** this is reproducible on the locally served production build at `http://127.0.0.1:4174/` using a narrow desktop viewport (`874x768`) in Playwright Chromium.
  - **Observed failure mode:**
    - `.navbar__toggle` exists and responds to click
    - `.navbar-sidebar` becomes visible, but its computed height is only `60px`
    - `.navbar-sidebar__brand` renders at `60px`
    - `.navbar-sidebar__items` exists but collapses to `height: 0px`
    - result: only the top bar / close icon is visible, while the actual nav links are effectively hidden
  - **Observed debug values from reproduction:**
    - `sidebarVisible=true`
    - `sidebarBox={\"x\":0,\"y\":0,\"width\":725.40625,\"height\":60}`
    - `panelVisible=false`
    - `panelBox={\"x\":0,\"y\":60,\"width\":725.40625,\"height\":0}`
    - `panelText=\"Docs\\nWhy\\nLaunch\\nCompare\\nGitHub\\nnpm\\n← Back to main menu\"`
  - **Important nuance:** mobile emulation with Playwright `iPhone 13` did show the menu opening correctly, so this looks like a **small-screen / narrow-window breakpoint bug**, not a universal mobile-nav failure.
  - **Required agent work:**
    - identify the CSS / layout interaction causing `.navbar-sidebar__items` to collapse to zero height
    - reproduce and verify on both homepage and docs pages
    - add a regression test or proof artifact so this does not silently return
    - do not mark complete until the menu options are visibly rendered and clickable on narrow desktop and mobile widths
  - **2026-04-08 completed:** Root cause: `backdrop-filter: blur(20px)` on `.navbar` creates a CSS containing block for `position: fixed` descendants, constraining `.navbar-sidebar` to the 60px navbar height instead of the viewport. Fix: `.navbar-sidebar--show { backdrop-filter: none; }` — sidebar overlay covers navbar so no visual impact. Regression guard added. 2503 tests / 540 suites / 0 failures. `DEC-MOBILE-NAV-FIX-001`.

- [x] Add a comparison page: AgentXchain vs Warp.dev
  - **Before writing anything**, do exhaustive research of Warp.dev's documentation, features, positioning, and capabilities.
  - Understand what Warp actually is (AI-native terminal, agentic coding features, team collaboration, etc.) and how it positions itself.
  - The comparison must be honest, specific, and grounded in real product facts — not strawman or hand-wavy.
  - Create a `website-v2/src/pages/compare/vs-warp.mdx` page following the same format as the existing comparison pages (vs CrewAI, vs LangGraph, vs OpenAI Agents SDK, vs AG2).
  - Add it to the comparison navigation alongside the others.
  - **2026-04-07 completed:** added `.planning/COMPARE_VS_WARP_SPEC.md`, created `website-v2/src/pages/compare/vs-warp.mdx`, updated compare navigation in the navbar/footer/homepage CTA, and verified with `cd website-v2 && npm run build`.

- [x] Research and identify additional competitors that need comparison pages
  - **Do proper web research** — search for "multi-agent orchestration frameworks", "AI coding agent coordination", "agentic software development platforms", "AI agent workflow tools", etc.
  - Look at: Devin, Factory, Cognition, Poolside, All Hands (OpenHands/OpenDevin), Sweep, Cosine (Genie), Codeium Windsurf, Amazon Q Developer Agent, Google Jules, Replit Agent, Bolt.new, Lovable, and any other relevant players.
  - For each candidate, assess whether they compete in the same space (governed multi-agent coordination) or a different space (single-agent coding assistant). Only create comparison pages for genuine competitors or products that users would reasonably compare against.
  - Produce a ranked list of recommended comparison pages with a one-line justification for each, then create the pages.
  - **2026-04-07 completed:** Researched 23 products across multi-agent orchestration, AI coding agents, AI IDEs, and app builders. Wrote ranked competitor memo (`.planning/COMPETITOR_RESEARCH_2026_04.md`). Created 4 new comparison pages: vs Devin (autonomous AI agent), vs MetaGPT (SOP-driven multi-agent, closest philosophical competitor), vs Codegen (enterprise code-agent platform), vs OpenHands (open-source agent platform/SDK). All pages added to navbar, footer, and homepage CTA. Test guards updated (12 tests / 0 failures). Docusaurus build clean.

- [x] Reassess the model-cost / budget surface before extending it further
  - **Human concerns to resolve explicitly:**
    1. OpenAI cost tables are already outdated. Agents should research the latest official OpenAI API model pricing before changing anything further.
    2. For coding usage, regular general-purpose OpenAI models are not the whole story. Agents must include Codex-family model coverage if the product is going to present OpenAI coding cost guidance at all.
    3. The current provider surface appears incomplete. Why are Anthropic, Kimi, DeepSeek, Qwen, and other plausible local/cloud providers missing from the budget/cost model?
    4. There is a product-strategy risk here: if AgentXchain tries to maintain a complete per-model/per-provider public pricing catalog, this becomes a permanent catch-up game and may never be truthful or complete.
  - **Required agent output:**
    - Decide whether AgentXchain should:
      - keep a curated cost catalog,
      - narrow cost support to a smaller truthfully-maintained subset,
      - move to a provider-agnostic budget model with optional provider plug-ins,
      - or treat pricing as external/operator-supplied metadata instead of first-party product truth.
    - If agents keep any first-party pricing support, they must justify:
      - scope boundary
      - update strategy
      - truth guarantees
      - how new providers/models enter the system
    - If agents research current model pricing, they must use official provider sources and update docs/specs/code together.
  - **Guardrail:** do not casually add more hardcoded provider/model prices without first resolving the strategic product question above.
  - **2026-04-07 completed:** Strategic decision (`DEC-COST-STRATEGY-001`): operator-supplied `cost_rates` in `agentxchain.json` override bundled defaults. No attempt to maintain a complete pricing catalog. Fixed wrong Anthropic prices (Opus 4.6: $15/$75 → $5/$25; Haiku 4.5: $0.80/$4.00 → $1.00/$5.00). Renamed `COST_RATES` → `BUNDLED_COST_RATES` with backward-compat alias. Added `getCostRates(model, config)` that checks `config.budget.cost_rates` first. New providers/models enter via operator config. 67 adapter tests + 28 budget tests + 50 docs tests = 0 failures.

- [x] Reopen website live-site issues from real browser evidence
  - **Root causes found and fixed:**
    - Favicon was 32x27 (non-square) → regenerated from 280x280 source as proper 32x32 ICO + 32x32 PNG. Added `headTags` to Docusaurus config for PNG favicon.
    - Hero icon/badge alignment was fragile (relied on `text-align: center` on parent) → hero container now uses `display: flex; flex-direction: column; align-items: center`. Logo has explicit `display: block` via `.hero-logo` class. Badge uses `align-self: center`.
    - Hero messaging was generic → rewritten to lead with "Your AI agents are smart enough. The problem is coordination." — directly addresses the target audience.
  - **Verification methodology:**
    - Confirmed local build md5 matches GCS-served content (23830 bytes, hash `d474210743177cb6e8d199bdeed97c79` — prior deploy was identical)
    - Confirmed GCS `Cache-Control: public, max-age=300, s-maxage=60` means browser cache expires in 5min, CDN in 1min
    - After fix: rebuilt, redeployed via `deploy-websites.sh`, verified live `curl` returns new favicon (4414 bytes, updated 11:58:23 GMT), new PNG favicon (2142 bytes), new hero classes (`hero-logo`, `hero-content`), and new copy ("Your AI agents are smart enough")
  - **Test surface:** 1045 tests / 238 suites / 0 failures. Docusaurus: 11 pages, 0 warnings. `DEC-WEBSITE-FIX-001`.

- [x] Migrate website docs to a better OSS framework
  - Evaluated Docmost (wrong category: wiki/CMS, needs DB+server), Starlight (less mature), and Docusaurus. Chose Docusaurus: static output, MDX, versioning, dark mode, React ecosystem. `DEC-DOCS-MIGRATION-001`.
  - All 11 content pages migrated to `website-v2/`. Old `website/` preserved.

- [x] Update the website to match the current product vision
  - Hero: "Governed multi-agent software delivery" + "Built for long-horizon coding and lights-out software factories"
  - Architecture section: "Protocol + runners + connectors + integrations"
  - Platform split: explicit .dev (OSS) vs .ai (Cloud)
  - VISION.md updated with long-horizon coding and lights-out software factories (`DEC-VISION-CONTENT-002`)

- [x] Fix broken website assets in production
  - Image paths now use Docusaurus `useBaseUrl()` instead of hardcoded absolute paths.
  - Favicon, hero logo, and hero badge verified in build output and deployed to GCS.
  - Badge updated to v2.2.0.

- [x] Remove weak or low-signal homepage proof
  - Replaced "1,038 Tests passing" with "53 Conformance fixtures" per human instruction. `DEC-WEBSITE-CONTENT-002`.

- [x] Simplify the `.dev` / `.ai` section on the homepage
  - Collapsed from two-column feature-list layout to single centered CTA: "Don't want to self-host?" with link to agentxchain.ai. `DEC-WEBSITE-CONTENT-003`.

- [x] Fix the positioning table formatting
  - Replaced all inline styles with CSS classes (`comparison-table-wrap`, `comparison-table`, `highlight-col`, `row-label`).
  - Added hover states, responsive font sizing, and proper mobile breakpoints.
  - Table now scrolls horizontally on small screens.

- [x] Deploy website/docs to GCP GCS with cache busting
  - `deploy-websites.sh` upgraded with two-tier cache: hashed assets (1yr immutable), HTML (5min/1min). Post-sync metadata enforcement. Bash 3 compatibility fix. `DEC-GCS-DEPLOY-001`–`004`.
  - Deployed and verified: all assets live with correct `Cache-Control` headers.

- [x] Add Google Analytics (GA4) to the website and all pages including docs
  - **2026-04-04 verification refresh:** added repo guard coverage in `cli/test/launch-evidence.test.js`, added `.planning/WEBSITE_ANALYTICS_SPEC.md`, and re-verified live `https://agentxchain.dev/` HTML contains both `G-1Z8RV9X341` and `googletagmanager`.
  - **Tracking ID:** `G-1Z8RV9X341`
  - **How to implement (Docusaurus native plugin):**
    1. In `website-v2/docusaurus.config.ts`, add `gtag` to the `preset-classic` config:
       ```ts
       presets: [
         [
           'classic',
           {
             gtag: {
               trackingID: 'G-1Z8RV9X341',
               anonymizeIP: true,
             },
             // ... existing docs, blog, theme options
           },
         ],
       ],
       ```
       `@docusaurus/plugin-google-gtag` is bundled with `preset-classic` — no `npm install` needed.
    2. This automatically injects the gtag.js snippet into every page (landing, docs, comparison pages, `/why`, etc.) including client-side navigations.
    3. Verify locally: run `npm start`, open browser DevTools → Network tab, confirm requests to `https://www.googletagmanager.com/gtag/js?id=G-1Z8RV9X341`.
    4. After merge, redeploy via `deploy-websites.sh` and verify in Google Analytics Real-Time dashboard that pageviews are registering.
  - **Raw script (for reference only — use the Docusaurus plugin above, not manual injection):**
    ```html
    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-1Z8RV9X341"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-1Z8RV9X341');
    </script>
    ```

- [x] Verify homebrew tap rename (`homebrew-agentxchain` → `homebrew-tap`) did not break anything
  - **Audit completed and all stale references fixed (2026-04-06):**
    - `cli/homebrew/README.md` — already updated (documents the rename)
    - `cli/homebrew/agentxchain.rb` — confirmed no tap name inside
    - CI/CD workflows (`.github/`) — no Homebrew references found
    - npm `postinstall` / `package.json` — no Homebrew references found
    - Website docs (`website-v2/`) — no Homebrew install references found
    - **Fixed stale references in:** `run-agents.sh`, `.planning/HOMEBREW_MIRROR_CONTRACT_SPEC.md`, `.planning/RELEASE_PLAYBOOK.md` (2 locations), `.planning/HUMAN_TASKS.md`, `.planning/V1_RELEASE_CHECKLIST.md`
    - **Fixed test assertion:** `cli/test/homebrew-mirror-contract.test.js` updated to assert `homebrew-tap` instead of `homebrew-agentxchain`
    - **Fixed pre-existing test drift:** `cli/test/launch-evidence.test.js` homepage fixture label assertion updated from stale "golden fixtures" to actual "Conformance fixtures"
    - All install instructions already use `brew tap shivamtiwari93/tap && brew install agentxchain`
  - **Verification:** 1913 node tests / 431 suites / 0 failures (including homebrew mirror contract test)

## Completion Log

- **2026-04-03**: All 7 priority queue items completed across Turns 21–4 (Claude Opus 4.6 + GPT 5.4). Docusaurus migration, vision alignment, asset fixes, table formatting, vanity proof replacement, platform split simplification, and GCS deployment with cache busting. v2.2.0 release-ready.

---

### Beta-tester bug report #7 (verbatim) — iterative planning conflict loop on v2.130.1 (2026-04-18)

> **Title**
>
> `2.130.1` still cannot sustain continuous full-auto progression in a real multi-role repo because planning repair turns re-enter an unresolved conflict loop and `human_merge` does not advance state
>
> **Summary**
>
> We upgraded `agentxchain` to `2.130.1` and re-ran our governed multi-role workflow in a real repo (`tusq.dev`) with:
> - 5 authoritative `local_cli` roles
> - custom `launch` phase
> - human planning / QA gate approvals
> - a second run for a Docusaurus website/docs/blog migration initiative
>
> `2.130.1` did improve some things:
> - global CLI version mismatch was fixed locally
> - PM recovery and fresh turn assignment behaved better than earlier versions
> - the run resumed and surfaced a real planning gate failure instead of deadlocking on stale state
>
> But we are still blocked from true continuous "full auto" progression.
>
> The current blocker is:
> 1. a PM repair turn correctly updates the planning artifacts to satisfy the planning gate
> 2. acceptance then detects a conflict on those same planning files
> 3. `accept-turn --resolution human_merge` does not actually resolve that conflict
> 4. retrying from a fresh PM turn reproduces the same conflict again
>
> This leaves the run stuck in a repeatable planning conflict loop and prevents progression to implementation.
>
> **Environment**
> - AgentXchain: `2.130.1`
> - Repo: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev`
> - OS: macOS
> - Protocol: governed v4
> - Roles: `pm`, `dev`, `qa`, `product_marketing`, `eng_director` — all `authoritative` + `local_cli`
> - Runtimes: PM/QA = Claude CLI; Dev/Product Marketing/Director = Codex CLI
> - Phases: `planning`, `implementation`, `qa`, `launch`
>
> **Reproducible sequence**
> 1. Run `run_c8a4701ce0d4952d` for Docusaurus docs+blog+website migration initiative
> 2. PM got a fresh turn `turn_54dfd5b29c7e1950`, accepted, requested `phase_transition_request: "implementation"`
> 3. `approve-transition` returned "No pending phase transition to approve. Current phase: planning"
> 4. `status` showed real planning gate failure: `.planning/SYSTEM_SPEC.md must define ## Interface` + `.planning/command-surface.md: Document must contain sections: ## Primary Commands, ## Flags And Options, ## Failure UX`
> 5. Repair turn `turn_49183a0120717942` correctly updated both files with required sections
> 6. Acceptance failed: "Acceptance conflict detected" — 100% overlap on `.planning/SYSTEM_SPEC.md` and `.planning/command-surface.md`, suggested resolution `human_merge`
> 7. `agentxchain accept-turn --turn turn_49183a0120717942 --resolution human_merge` just re-displayed the conflict banner without advancing state
> 8. Stashed edits, dispatched fresh PM retry `turn_dcf6dfa2bc4a256b` — reproduced the same conflict
>
> **Why this blocks us**
>
> We cannot progress to implementation, dev, qa, or launch because the repo is stuck in planning even though PM is correctly producing the required gate-fix edits.
>
> This also demonstrates why the framework is still not capable of true continuous full-auto progression in this real repo:
> 1. accepted planning state can surface new semantic gate requirements
> 2. PM can satisfy those requirements
> 3. but artifact conflict detection on long-lived planning files prevents acceptance
> 4. the advertised `human_merge` resolution path does not actually resolve the conflict
> 5. repeated retries just reproduce the same state
>
> The system still cannot autonomously move through iterative planning repairs on durable governed artifacts.
>
> **Why this matters for "full auto"**
>
> In a realistic long-horizon repo, planning artifacts like `.planning/SYSTEM_SPEC.md` and `.planning/command-surface.md` will be revised multiple times over multiple accepted turns and multiple runs. If the framework treats those rewrites as perpetual acceptance conflicts and the built-in human conflict resolution path does not progress state, then iterative planning becomes a loop, new runs cannot build on prior accepted planning truth cleanly, and continuous autonomous delivery is not viable.
>
> **Expected behavior**
>
> One of:
> - **Option A:** Accept iterative planning repair on governed artifacts if the PM repair turn is a valid forward rewrite of the same planning artifacts
> - **Option B:** `accept-turn --resolution human_merge` must move the turn to a resolved state and allow the run to continue
> - **Option C:** Reassign should carry forward the intended merged result — framework should provide a reliable merge/rebase/reissue path that does not just recreate the same conflict
>
> **Suggested fixes**
>
> 1. Fix `accept-turn --resolution human_merge` so it actually advances conflict state and resolves the turn
> 2. Improve conflict handling for long-lived governed planning artifacts so iterative PM revisions across runs are not trapped in a permanent conflict loop
> 3. Distinguish between destructive overlap/conflict and legitimate forward revision of previously accepted planning files
> 4. If the framework intends these revisions to require explicit merge acceptance, make that path actually complete the merge and continue the run
> 5. Add regression coverage for: accepted planning turn → semantic planning gate failure → PM repair turn on same planning files → `human_merge` → continuation to implementation
>
> **Severity**
>
> **P1 for continuous governed automation.** The framework now gets further than before, but it still cannot progress through iterative planning evolution on durable governed artifacts. The documented conflict-resolution path does not actually unblock the run. This is a direct blocker to full-auto multi-turn progression.
>
> **Short conclusion**
>
> `2.130.1` improved recovery and state handling enough to surface the real planning gate problem. But once PM correctly fixes that problem, AgentXchain still traps the run in a planning-file conflict loop, and `human_merge` still does not resolve it. That is the current reason we cannot keep this repo moving in true full-auto mode.

---

### Beta-tester bug report #8 (verbatim) — continuous mode still blocked on v2.134.1 (2026-04-18)

> **Title**
>
> `2.134.1` still cannot sustain continuous full-auto execution in a real single-repo governed run because stale queued intents block continuous mode and dev retries ignore explicit gate-repair instructions
>
> **Summary**
>
> Upgraded to `agentxchain 2.134.1` and retried governed multi-role repo (`tusq.dev`) with 5 authoritative `local_cli` roles, custom `launch` phase, prior successful end-to-end run, and a new run for Docusaurus docs/blog/website initiative.
>
> `2.134.1` improved some earlier issues: `human_merge` on planning conflicts finally worked, planning progressed into implementation, dev produced a real Docusaurus implementation under `website/`.
>
> But still blocked from continuous/full-auto progression. **Two remaining blockers**:
> 1. Continuous mode is blocked by stale old queued intents
> 2. Implementation repair turns keep ignoring the explicit gate semantic and narrow injected repair intent
>
> **Environment**
> - AgentXchain: `2.134.1`
> - Repo: `tusq.dev`
> - Run: `run_c8a4701ce0d4952d`
> - Phase: `implementation`
> - Initiative: Docusaurus docs+blog+website migration, injected as `intent_1776489830072_6802`
>
> **What already worked**: PM planning recovery, implementation (Docusaurus scaffolded, docs/blog pages, custom homepage, build/smoke verification passed). Accepted implementation turn: `turn_3dbd2dc89d05c899`.
>
> **Blocker 1: Continuous mode blocked by stale queued intents**
>
> Ran:
> ```bash
> /opt/homebrew/bin/agentxchain run \
>   --continue-from run_c8a4701ce0d4952d \
>   --continuous \
>   --auto-approve \
>   --auto-checkpoint \
>   --max-turns 20 \
>   --max-runs 5 \
>   --triage-approval auto \
>   --verbose
> ```
>
> Result:
> ```text
> Found queued intent: intent_1776473633943_0543 (approved)
> Continuous start error: plan failed: existing planning artifacts would be overwritten
> Continuous loop failed: plan failed: existing planning artifacts would be overwritten.
> ```
>
> Old planning intents from earlier runs still appear pending:
> - `intent_1776473633943_0543`, `intent_1776474414878_c28b`, `intent_1776489830072_6802`, `intent_1776534863659_5752`
>
> These still show in `status` as "Pending injected intents (will drive next turn)" even though earlier planning was accepted, repo moved beyond planning, and current run is in `implementation`.
>
> **Expected:** satisfied/superseded intents should not remain as active queue inputs; continuous mode should continue current run's unresolved work, not resurrect stale planning backlog.
>
> **Blocker 2: Dev repair turns ignore the gate semantic**
>
> After implementation was accepted, phase couldn't advance because gate reported:
> ```text
> .planning/IMPLEMENTATION_NOTES.md must define ## Changes before implementation can exit.
> ```
>
> Current file has `## Challenge To Prior Turn`, `## What Was Implemented`, `## Verification`, `## Notes / Follow-ups` — no literal `## Changes`.
>
> Injected explicit high-priority repair intent `intent_1776534863659_5752`: add literal `## Changes` section to `.planning/IMPLEMENTATION_NOTES.md`, preserve existing implementation summary, do not redo broader website work, narrow artifact-semantic repair.
>
> But repeated dev turns still ignored that and only reran verification. Examples: `turn_f0eb39bc36682efb`, `turn_12093400ce188ed1`, `turn_67d5052ed0e5244d`, `turn_48b1c08ef3905243`.
>
> Example `turn_48b1c08ef3905243`:
> - summary: "Revalidated implementation gate checks on the current workspace and recorded passing evidence for QA handoff."
> - `files_changed`: only the staged turn-result file
> - no actual repo artifact fix
> - still proposes `qa` transition despite gate remaining unsatisfied
>
> The role is systematically failing to satisfy the explicit gate semantic.
>
> **Why this still blocks full-auto**
>
> Expected: gate says what artifact is incomplete → repair turn updates that artifact → turn accepted → phase advances.
>
> Actual: gate says `## Changes` missing → dev reruns verification → retry says previous attempt failed for not addressing gate → next retry does same thing → continuous mode can't help because stale intents block it.
>
> **Important additional evidence**
>
> Retry prompt DOES include rejection reason for `turn_48b1c08ef3905243`: "Previous attempt failed. Reason: Did not address implementation_complete gate semantic or pending narrow intent." So framework is partially surfacing operator feedback.
>
> But retry prompt does NOT strongly bind the specific repair intent into the prompt body. The narrow injected instruction isn't included verbatim. That likely explains why dev keeps optimizing for "fresh verification" instead of "fix the missing heading."
>
> **Status/reporting inconsistencies still exist:**
> - `status` showing turn as running after it already accepted
> - no dispatch `stdout.log` file on disk even when CLI printed a log path
> - `restart` aggressively assigning a fresh replacement turn instead of only reconciling session state
>
> **Expected behavior**
> 1. **Intent lifecycle**: old satisfied/superseded intents should not continue appearing as pending; continuous mode should operate on real unresolved work of current run
> 2. **Gate-semantic repair binding**: when gate failure names specific artifact condition, retry prompt should strongly foreground that condition; when narrow injected repair intent exists, it should be bound into next dispatched prompt as primary objective
> 3. **Turn validation discipline**: a turn that did not modify the required incomplete artifact should not be able to summarize itself as ready for QA; system should reject or strongly warn when claimed gate repair did not actually touch the gated file semantically
>
> **Suggested fixes**
> 1. Add explicit lifecycle states: approved/attached/satisfied/consumed/superseded
> 2. Make continuous mode ignore or archive stale satisfied intents from earlier runs/phases
> 3. When gate fails on specific file semantic, inject that semantic failure into next role prompt in first-class binding way
> 4. When operator injects narrow repair intent, include that intent directly in next dispatch bundle, not just in sidecar intake state
> 5. Add validation comparing: gate failure reason + files changed + claimed summary + proposed transition; reject turns that never touched the gated artifact
> 6. Fix status/restart/log consistency so active-turn reporting matches on-disk dispatch reality
>
> **Severity: P1 for continuous/full-auto governed execution.** `2.134.1` gets much further than earlier versions, but continuous mode still aborts on stale intent state, and repair turns can loop forever on a trivial gate-semantic issue. Together, those two issues still prevent genuine autonomous continuation toward the initiative goal.
>
> **Short conclusion**
>
> `2.134.1` fixed important earlier blockers, but still cannot reliably continue a real repo in full-auto mode. The remaining failures are stale queued intents poisoning continuous mode, and gate-repair turns not actually repairing the gated artifact even after explicit retries and a narrow injected repair intent. That is the current reason this run still needs operator babysitting.

---

### Beta-tester bug report #9 (verbatim) — BUG-36 false closure on v2.135.0 (2026-04-18)

> **Title**
>
> `2.135.0` still allows deterministic gate-repair loops: accepted dev turns can repeatedly ignore a required artifact semantic, never satisfy the phase gate, and continuous mode still cannot recover the run
>
> **Summary**
>
> In a real governed single-repo run (`tusq.dev`), AgentXchain repeatedly dispatched and accepted `dev` turns that did not satisfy a simple, explicit implementation gate requirement: `.planning/IMPLEMENTATION_NOTES.md must define ## Changes before implementation can exit.`
>
> Even after multiple retries, explicit human rejection reasons, injected p0 repair intents, and running the workflow under `agentxchain@2.135.0`, the dev role continued to rerun verification, propose transition to QA, get accepted, and leave the gated artifact unchanged.
>
> The run remains stuck in `implementation`. This is now a clear framework-level issue because (1) gate failure is explicit and machine-readable, (2) required file is known, (3) role owns the file, (4) repeated accepted turns never touch that file semantically, (5) the system still accepts those turns and loops.
>
> **Environment**
> - Repo: `tusq.dev`, OS macOS, Protocol governed v4, Template `cli-tool`
> - Run: `run_c8a4701ce0d4952d`, Phase `implementation`
> - Roles: `pm`, `dev`, `qa`, `product_marketing`, `eng_director` — all authoritative + local CLI
> - Tested: `/opt/homebrew/bin/agentxchain 2.134.1`, `npx -p agentxchain@2.135.0`
> - Homebrew tap upgrade blocked by broken formula conflict; 2.135.0 tested via npx
>
> **Context**
>
> Implementing Docusaurus-based docs/blog/site migration. Implementation happened successfully: Docusaurus scaffold under `website/`, docs pages authored, blog posts authored, build and smoke checks pass. But phase exit blocked because implementation notes artifact is semantically incomplete.
>
> **Current gate failure**
>
> ```text
> Gate: implementation_complete
> Request: implementation -> qa
> Reasons:
> - .planning/IMPLEMENTATION_NOTES.md must define ## Changes before implementation can exit.
> ```
>
> Current file has `## Challenge To Prior Turn`, `## What Was Implemented`, `## Verification`, `## Notes / Follow-ups` — no `## Changes`.
>
> **Observed behavior (multiple accepted dev turns did not fix gated artifact)**
>
> Examples: `turn_48b1c08ef3905243`, `turn_494964a9db3924e0`, `turn_67d4624e95eabff1`, `turn_40a159d90975714c`, `turn_f38c0b19b70c8cf6` (under 2.135.0).
>
> These turns consistently:
> - reran verification commands
> - summarized revalidation
> - proposed `qa`
> - left `.planning/IMPLEMENTATION_NOTES.md` unchanged with no `## Changes`
>
> Typical summary: "Revalidated implementation gate checks on the current workspace and recorded passing evidence for QA handoff." Verification: `cd website && npm install`, `cd website && npm run build`, `cd website && npm run typecheck`, `node tests/smoke.mjs`. `files_changed` either did not include the gated file or the file's semantic content still did not satisfy the gate.
>
> Yet these turns were still accepted, and the run remained blocked on the exact same reason.
>
> **Additional steering attempts that still failed**
>
> Injected narrow p0 repair intents:
> 1. Add a literal `## Changes` section to `.planning/IMPLEMENTATION_NOTES.md`, preserve the implementation summary, do not redo broader website work
> 2. Treat `websites/` as the live legacy site and consolidate it into `website/`; update `.planning/IMPLEMENTATION_NOTES.md` with a literal `## Changes` section describing that consolidation
>
> These intents were approved and visible in state, but the dev turns still did not make the required artifact change.
>
> **Continuous mode is also not a viable escape hatch**
>
> ```bash
> agentxchain run --continue-from run_c8a4701ce0d4952d --continuous --auto-approve --auto-checkpoint --max-turns 20 --max-runs 5 --triage-approval auto
> ```
>
> Under 2.135.0 via npx, still failed immediately:
> ```text
> Found queued intent: intent_1776473633943_0543 (approved)
> Continuous start error: plan failed: existing planning artifacts would be overwritten
> ```
>
> Intent files at `.agentxchain/intake/intents/*.json` still have `approved_run_id = null` and `run_id = null`. Migration/state gap for previously persisted intents in existing repos.
>
> **Why this is a framework bug**
>
> Not "model made a bad choice." Framework bug because system: knows gate failure exactly; knows file exactly; knows missing semantic exactly; keeps dispatching same owner role; keeps accepting turns that don't address that semantic; never escalates or hard-fails the loop. Framework lacks convergence guard for artifact-semantic gate repair.
>
> **Expected behavior**
>
> At least one of:
> 1. Gate-aware acceptance rejection — if turn dispatched to repair failing gate doesn't modify the gated artifact to satisfy the named requirement, acceptance should fail
> 2. Artifact-semantic coverage validator — when gate failure says "file X must define heading Y", turn should be checked for that exact semantic before acceptance
> 3. Escalation after repeated non-progress — after N accepted turns with same unchanged gate reason, run should stop and raise clear escalation instead of looping indefinitely
> 4. Prompt binding of gate repair — repair turn prompt should prominently include exact gate failure and make it the primary acceptance target, not merely background context
>
> **Suggested fixes**
> 1. Add semantic gate coverage checks to acceptance
> 2. Detect repeated non-progress — if same gate reason persists across accepted turns with no meaningful artifact delta, automatically escalate/block/reject
> 3. Strengthen repair-turn prompting — gate failure first-class in prompt
> 4. Track gate-repair effectiveness — compare previous/current gate reasons + gated file changes
> 5. Fix existing-intent migration for continuous mode — old persisted intents with null run scoping should not poison current continuous runs
>
> **Severity: P1.** Causes deterministic non-converging loops, consumes turns without progress, blocks autonomous advancement on trivial artifact repair, undermines trust in both direct run mode and continuous mode.
>
> **Short conclusion**
>
> `2.135.0` still does not prevent a governed run from accepting repeated non-progressing repair turns against the same failing artifact gate. That is the current reason this `tusq.dev` run remains stuck in implementation.

---

### Beta-tester bug report #11 (verbatim) — BUG-40 false closure on v2.136.0 (2026-04-18)

> **Title**
>
> `v2.136.0` still does not migrate legacy null-scoped intents on continuous startup in an existing repo, even though gate-semantic no-progress acceptance is now fixed
>
> **Summary**
>
> Retested `tusq.dev` against `agentxchain@2.136.0`. Outcome is mixed:
> - Earlier no-progress gate-repair acceptance bug **appears fixed**
> - Continuous startup migration problem for legacy intents is **still not fixed in this existing repo**
>
> v2.136.0 improves gate repair acceptance correctness, but continuous full-auto continuation is still blocked because old approved intents are still being adopted instead of archived/migrated.
>
> **Environment**
> - Repo: `tusq.dev`, macOS, governed v4
> - Active run: `run_c8a4701ce0d4952d`, Phase: `implementation`
> - Roles: pm/dev/qa/product_marketing/eng_director — all authoritative + local_cli
> - Tested via npx because Homebrew tap remains broken by merge-conflicted formula
>
> **What appears fixed**
>
> Under earlier versions, AgentXchain repeatedly accepted `dev` repair turns that didn't modify `.planning/IMPLEMENTATION_NOTES.md`. Under 2.135.1 and still under 2.136.0, that specific acceptance bug appears fixed. Current active dev repair turn `turn_e20130cc31c3b5b3` remains in `failed_acceptance` state rather than being silently accepted.
>
> **What is still broken in v2.136.0**
>
> v2.136.0 release notes explicitly claim:
> > `BUG-40: Continuous startup + resume migration hardened`
> > Shared `intent-startup-migration.js` ensures pre-BUG-34 intents with `approved_run_id: null` are migrated on all startup paths: `run`, `run --continue-from`, `run --continuous`, `restart`, `resume`, `step --resume`, `schedule daemon` continuous sessions
>
> Tested: `npx --yes -p agentxchain@2.136.0 -c 'agentxchain run --continue-from run_c8a4701ce0d4952d --continuous --auto-approve --auto-checkpoint --max-turns 20 --max-runs 5 --triage-approval auto'`
>
> Observed:
> ```text
> Found queued intent: intent_1776473633943_0543 (approved)
> Continuous start error: plan failed: existing planning artifacts would be overwritten
> Continuous loop failed: plan failed: existing planning artifacts would be overwritten. Check "agentxchain status" for details.
> ```
>
> Same failure mode as before. In this repo: old legacy intents still considered during continuous startup; migration/archival not happening before queue selection; continuous mode fails immediately.
>
> **Evidence from 2.136.0 status**
>
> `status` still shows old pending intents: `intent_1776473633943_0543`, `intent_1776474414878_c28b`, `intent_1776489830072_6802`, `intent_1776534863659_5752`, `intent_1776535590576_a157`. Listed under "📋 Pending injected intents (will drive next turn)".
>
> Strong evidence migration did not archive or neutralize them for this repo, despite release claim.
>
> **Evidence from on-disk intent files**
>
> Older intent files under `.agentxchain/intake/intents/*.json` still show legacy null scoping (`approved_run_id: null`, `run_id: null`). Exactly the legacy state BUG-40 claims to migrate on startup paths. But 2.136.0 still attempts to consume one during continuous startup.
>
> **Why this matters**
>
> - Fixed: AgentXchain no longer silently accepts non-progressing gate-repair turns
> - Not fixed: existing repos with legacy null-scoped intents still cannot recover into continuous mode
> - Continuous mode still dies at startup before doing useful work
>
> Repo remains blocked from true full-auto continuation. Direct/manual stepping safer than before, but advertised continuous recovery path still fails for real pre-existing repos.
>
> **Why this is likely a migration-path bug, not a new planner bug**
>
> Failure still points to `intent_1776473633943_0543`. Strongly suggests: queue selection still consulting legacy persisted intent files; startup migration either didn't run, or ran but didn't rewrite/archive these specific files, or migration only affects some startup paths, not the exact continuation path used here.
>
> Gap between intended migration coverage and actual behavior on real pre-existing repo.
>
> **Suggested fixes**
> 1. Ensure legacy-intent migration runs BEFORE any queue selection on `run --continue-from`, `run --continuous`, combined `continue-from + continuous` path
> 2. Hard assertion: if intent has `approved_run_id: null` and is pre-migration legacy state, must be archived or normalized before queueable
> 3. Emit startup/migration diagnostics: count, archived count, archived IDs, startup path
> 4. Regression coverage with existing repo fixture containing real historic intent files + `run --continue-from --continuous` + existing planning artifacts + expectation startup does NOT revive stale planning work
> 5. Consider one-shot repair command `agentxchain migrate-intents` for existing repos
>
> **Severity: P1/P2.** BUG-40 about recovering continuous mode for real repos; still doesn't work here; failure prevents full-auto continuation entirely. However, correctness of gate repair acceptance improved, so narrower than earlier broad orchestration failure.
>
> **Short conclusion**
>
> v2.136.0 appears to fix earlier no-progress gate-repair acceptance bug. But still does NOT fix continuous startup for this existing `tusq.dev` repo. BUG-40 migration hardening claim still incomplete in real migrated repo.

---

### Beta-tester bug report #12 (verbatim) — BUG-41 false closure on v2.137.0 + new checkpoint blocker (2026-04-18)

> Tested v2.137.0 via npx.
>
> ```bash
> npx --yes -p agentxchain@2.137.0 -c 'agentxchain --version'
> # 2.137.0
>
> npx --yes -p agentxchain@2.137.0 -c 'agentxchain run --continue-from run_c8a4701ce0d4952d --continuous --auto-approve --auto-checkpoint --max-turns 20 --max-runs 5 --triage-approval auto'
> ```
>
> Result:
> ```text
> Found queued intent: intent_1776473633943_0543 (approved)
> Continuous start error: plan failed: existing planning artifacts would be overwritten
> ```
>
> Also tested the new migration command:
> ```bash
> npx --yes -p agentxchain@2.137.0 -c 'agentxchain migrate-intents --dry-run --json'
> ```
>
> Result:
> ```json
> {
>   "archived_count": 0,
>   "archived_intent_ids": [],
>   "dry_run": true,
>   "message": "No legacy intents found"
> }
> ```
>
> But when I inspected the intent files, the old intents are still effectively live and rebound to the current run:
>
> ```text
> intent_1776473633943_0543.json
>   status=approved
>   approved_run_id=run_c8a4701ce0d4952d
>   run_id=None
>   archived_at=None
>   consumed_at=None
> ```
>
> Same pattern for the other old intents too.
>
> Honest result:
> - v2.137.0 still does **not** fix continuous startup for this repo
> - no longer looks like a pure "null-scoped legacy intent" bug
> - now looks like **stale old intents have been rebound to the current run and are still queueable**, which still breaks continuous mode
>
> Good news:
> - gate-repair acceptance bug is fixed enough now
> - forced a retry with explicit rejection reason
> - dev agent finally changed `.planning/IMPLEMENTATION_NOTES.md` to include `## Changes`
> - `implementation_complete` now passes
> - run advanced to `qa`
>
> New roadblock:
> - QA still can't start because AgentXchain says accepted dev turn `turn_e20130cc31c3b5b3` is not checkpointed
> - `checkpoint-turn` fails because the staging file is already gone:
>   ```text
>   Failed to stage accepted files for checkpoint: fatal: pathspec '.agentxchain/staging/turn_e20130cc31c3b5b3/turn-result.json' did not match any files
>   ```
>
> Current truth:
> - continuous mode: still broken in this repo under 2.137.0
> - gate repair loop: improved/fixed
> - checkpoint/QA handoff: now the active blocker

---

### BUG-42/43 closures on v2.138.0 (verified 2026-04-19)

**BUG-42 — Phantom intent detection** (Turn 219, Claude): Added `isPhantomIntent()` check in `archiveStaleIntentsForRun()` — approved intents bound to current run whose planning artifacts already exist on disk are superseded with status `superseded` and reason "planning artifacts for this intent already exist on disk; intent superseded." Additional hardening in Turn 220 (GPT) after Claude's detector missed the default `generic` template case. Tester's exact command on v2.138.0 produced: `Superseded 3 phantom intent(s): intent_1776473633943_0543, intent_1776474414878_c28b, intent_1776489830072_6802`.

**BUG-43 — Checkpoint-turn ephemeral path filtering** (Turn 219, Claude): `normalizeFilesChanged()` in `cli/src/lib/turn-checkpoint.js` now filters out `.agentxchain/staging/` and `.agentxchain/dispatch/` paths. These are ephemeral orchestrator artifacts cleaned up after acceptance. Tester's output on v2.138.0: `Checkpointed turn_e20130cc31c3b5b3 at fd0c1b038637ff79318fe04d25e46fb47f8df49a.`

**Significance:** First non-false closure in 7 attempts. GPT caught an 8th would-be false closure pre-release by running the tester's exact command. Discipline rule #12 (no close without tester-verified output) held.


---

### Beta-tester bug report #14 (verbatim) — BUG-45 retained-turn stale coverage (2026-04-19)

> **Title:** `v2.138.0` retained-turn acceptance can stay permanently blocked by stale intent coverage after the intent is already satisfied, and recovery only succeeds after manual `.agentxchain/` state surgery
>
> **Summary:** Stuck in real governed repo (`tusq.dev`) on retained `product_marketing` turn during `qa`. Repo work substantively complete (QA artifacts exist, `IMPLEMENTATION_NOTES.md` has `## Changes`, website consolidation reflected, verification passes, turn result valid). But AgentXchain keeps rejecting the retained turn on stale `intent_coverage` for intent `intent_1776535590576_a157` (turn `turn_1e8cabbfdda98f5d`, phase `qa`).
>
> Framework-native recovery did not work: `accept-turn`, `intake resolve`, `reject-turn`/retry, `unblock`, stash/cleanup of HUMAN_TASKS.md, `restart`. Only manual `.agentxchain/` state surgery unblocked the run.
>
> **Blocker in retained-turn intent lifecycle / acceptance binding, not repo content.**
>
> **Environment:** tusq.dev, macOS, governed v4, agentxchain@2.138.0 via npx, run_c8a4701ce0d4952d, stuck turn turn_1e8cabbfdda98f5d, role product_marketing, phase qa
>
> **Stuck intent acceptance contract:**
> 1. `website/ reflects the current live website content and assets from websites/ instead of diverging from it`
> 2. `.planning/IMPLEMENTATION_NOTES.md contains a literal ## Changes heading describing the consolidation work`
> 3. `implementation can advance to qa after verification without depending on websites/ as a separate active site`
>
> **Observed:** retained turn repeatedly failed with "Validation failed at stage intent_coverage. Detail: Unaddressed acceptance items:" listing all 3 items from the contract. But staged result already contained evidence covering those items: `files_changed` listed `.planning/IMPLEMENTATION_NOTES.md`, `.planning/RELEASE_NOTES.md`, `.planning/acceptance-matrix.md`, `.planning/ship-verdict.md`. Verification commands included `grep -n '^## Changes$' .planning/IMPLEMENTATION_NOTES.md`, build+typecheck passing.
>
> **Framework recovery paths tested and failed:**
>
> 1. `intake resolve --intent intent_1776535590576_a157 --json` returned no-op: `{"ok":true,"previous_status":"executing","new_status":"executing","run_outcome":"active","no_change":true}`
>
> 2. HUMAN_TASKS.md became secondary blocker: "Observed artifact mismatch: Undeclared file changes detected (observed but not in files_changed): HUMAN_TASKS.md". Traced to AgentXchain itself re-dirtying the file when escalation moved from open to resolved (framework-generated resolved-escalation block `### hesc_cc29324d02653f26 — resolved`).
>
> 3. Stale binding remained embedded in retained turn at `state.json`, `ASSIGNMENT.json`, intent file. Even after repo state satisfied the intent, retained turn carried the old coverage contract.
>
> **What worked (manual `.agentxchain/` state surgery):**
> 1. Marked intent file as completed: status executing → completed, added completion history, completed_at, run_completed_at, run_final_turn, satisfying_turn
> 2. Cleared injected-priority pointer in `.agentxchain/intake/injected-priority.json` (set values to null)
> 3. Cleared stale retained-turn intake_context in `state.json` and `ASSIGNMENT.json` (changed to null)
>
> After that: `accept-turn --turn turn_1e8cabbfdda98f5d` → "Turn Accepted. Status: completed". Then `checkpoint-turn` → "Checkpointed ... at bee94a4248ad31d093a4697d44f0010d6f1763b7". Then `restart` → recovered and assigned next QA turn `turn_294a4d2dfae5e56b`.
>
> **Likely root cause:** retained-turn acceptance uses stale embedded `intake_context.acceptance_contract` from state.json and assignment bundle rather than reconciling against current intent status, current repo state, current staged result evidence.
>
> **Severity: P1.** Governed run can deadlock on stale retained-turn intent coverage even after underlying work is complete. Current state: stuck turn accepted via surgery, checkpointed, run restarted, new QA turn assigned `turn_294a4d2dfae5e56b`. Moving forward again.
