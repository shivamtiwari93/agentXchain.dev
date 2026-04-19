# Human Roadmap — AgentXchain

Human-prioritized work for the agents.

Rules:
- Agents should read this file before acting.
- Unchecked items here take priority over general exploration in `AGENT-TALK.md`.
- When an item is complete, agents should mark it complete and briefly record what changed.
- If an item is too large, agents should split it into smaller checklist items and work them down in order.
- Only move an item back to `HUMAN_TASKS.md` if it truly requires operator-only action.

Current focus: **4 state-consistency bugs on v2.144.0 (BUG-47..50).** BUG-44/45/46 **tester-verified closed** on 2026-04-19 — first triple-close with quoted tester output in the cycle. Rule #12 held. Now 4 narrower state-model bugs (dead-turn watchdog, intent lifecycle contradiction, accepted_integration_ref staleness, run-history contamination) + a noted "QA human-gate loop" adjacent to BUG-48 to investigate. Full tester report in archive under "Beta-tester bug report #16" and closure evidence under "BUG-44/45/46 closures — tester-verified on v2.144.0".

## Priority Queue

- [ ] **BUG-47: Dead-turn watchdog missing — stale "running" turns require manual `reissue-turn`** — Verified: zero matches in `cli/src/lib/` for `stale.running`, `dead.turn`, `turn.watchdog`, or `idle_threshold`. No self-recovery logic exists. Tester's launch `product_marketing` turn `turn_88e2912c9b724d66` stayed `running` for **15+ minutes** with no staged result and no events. Had to manually run `restart` → `reissue-turn` → `step --resume`.
  - [x] 2026-04-19 implementation shipped: added lazy stale-turn reconciliation in `status`, `resume`, and `step --resume`; stale turns now transition to retained `stalled`, emit `turn_stalled`, block the run, and surface explicit `reissue-turn --reason stale` recovery.
  - [x] 2026-04-19 regression proof shipped: `cli/test/beta-tester-scenarios/bug-47-stale-turn-watchdog.test.js` now covers status JSON reconciliation, unrelated-event isolation, and the operator-facing `resume` / `step --resume` stale recovery path.
  - [ ] Tester verification on `v2.145.0` still required before closure per rule #12.
  - **Fix requirements:**
    - Add idle-threshold detection: if an active turn has `status: "running"` for >N seconds with no event log activity AND no staged result file, emit `turn_stalled` event and transition to `needs_attention` or similar recoverable state.
    - Default threshold: 10 minutes for `local_cli` turns, 5 minutes for `api_proxy` turns. Configurable via `run_loop.stale_turn_threshold_ms`.
    - The watchdog check fires lazily on the next CLI invocation (`status`, `resume`, `step --resume`) rather than requiring a daemon — operators hitting the stale state should see actionable output: "Turn X has been running for 18m with no output. Run `agentxchain reissue-turn --turn X --reason stale` to recover."
    - Tester-sequence test: seed a turn with `status: "running"` and a dispatch timestamp >threshold ago. Run `status`. Assert the output surfaces the stale turn and recommends `reissue-turn`.
  - **Acceptance:** a turn running >threshold with no output gets surfaced automatically; operator never has to manually diagnose the stuck state.

- [ ] **BUG-48: Injected intent lifecycle contradiction — intent marked `superseded` in JSON but still shown as `Priority injection pending` in status AND still drives orchestration** — Three surfaces disagree. Verified at `cli/src/lib/intake.js:1741` — `PREEMPTION_MARKER_PATH = '.agentxchain/intake/injected-priority.json'` has only one declaration site and no code path clears or invalidates it when the referenced intent is superseded. Result: intent JSON says `superseded` with reason "planning artifacts for this intent already exist on disk", but `injected-priority.json` still points at that intent_id, so `status` shows it as pending preemption.
  - [x] 2026-04-19 implementation shipped: preemption markers are now valid only for actionable `approved` / `planned` intents; reject/suppress/archived-migration writers clear stale markers immediately, and defensive reads auto-clear stale markers before status or orchestration can honor them.
  - [x] 2026-04-19 regression proof shipped: `cli/test/beta-tester-scenarios/bug-48-intent-lifecycle-contradiction.test.js` now covers stale superseded markers, reject-path cleanup, and archived-migration cleanup.
  - [ ] Tester verification on `v2.145.0` still required before closure per rule #12.
  - **Tester's evidence:**
    - Intent `intent_1776631311439_ca68` JSON: `"status": "superseded"`, `"archived_reason": "planning artifacts for this intent already exist on disk; intent superseded during approval"`
    - `agentxchain status` output: `⚡ Priority injection pending. Intent: intent_1776631311439_ca68. Priority: p0...`
    - Continuous run behavior: next run started with `trigger: "vision_scan"` — orchestration treated the superseded intent as live
  - **Fix requirements:**
    - When an intent transitions to `superseded`/`satisfied`/`consumed`/`rejected`/`archived_migration`, the writer must also check `injected-priority.json` and clear it if it references the transitioning intent. Add to `transitionIntentStatus()` or wherever intent state writes happen.
    - `status` must source priority-injection display from the intent JSON authoritatively. If `injected-priority.json` points at an intent whose current on-disk status is non-pending, either (a) auto-clear the marker or (b) display nothing and emit a stale-marker warning.
    - Continuous run's preemption check must also verify the marker's target intent is still actionable. Don't honor a marker pointing at a superseded intent.
    - Tester-sequence test: inject intent that would be auto-superseded (phantom detection path). Assert (a) intent JSON is `superseded`, (b) `injected-priority.json` is cleared, (c) `status` does not show "Priority injection pending", (d) continuous run does not react to the stale intent.
  - **Acceptance:** intent JSON status, `injected-priority.json` marker, `status` output, and orchestration behavior all agree on whether an intent is pending.

- [ ] **BUG-49: `accepted_integration_ref` not updated on checkpoint in fresh runs — drift falsely reported immediately after a clean checkpoint** — Verified gap. Zero matches for `accepted_integration_ref.*checkpoint`, `updateAcceptedRef`, or `setAcceptedIntegrationRef` in `cli/src/lib/`. The checkpoint flow doesn't advance the run's baseline integration ref. Tester's fresh run `run_7c529def79b94f51` accepted and checkpointed first PM turn at SHA `c927214e...`, but `status` still reported `Accepted: git:f77731523f...` (previous run's checkpoint) and `Drift: f7773152 -> c927214e` — immediately after a clean checkpoint.
  - [x] 2026-04-19 implementation shipped: continuation/recovery runs now seed `accepted_integration_ref` from current HEAD at run init, and checkpoint success advances the run baseline to the new checkpoint SHA.
  - [x] 2026-04-19 regression proof shipped: `cli/test/beta-tester-scenarios/bug-49-checkpoint-ref-update.test.js` now covers continuation baseline seeding plus post-checkpoint ref advancement.
  - [ ] Tester verification on `v2.145.0` still required before closure per rule #12.
  - **Fix requirements:**
    - `checkpoint-turn` / `accept-turn --checkpoint` must set `state.accepted_integration_ref` to the new checkpoint SHA on success.
    - If the run is `run-chained` (continued from a parent run), the fresh run's initial `accepted_integration_ref` should be set to the parent run's final checkpoint at run-init, not left pointing into the parent's state as an authoritative baseline. Then checkpoint updates from that inherited starting point.
    - Drift detection must compare HEAD against the CURRENT run's `accepted_integration_ref`, not a lingering reference from the parent.
    - Tester-sequence test: chain fresh run from parent run → PM turn → accept → checkpoint → assert `state.accepted_integration_ref` matches the new checkpoint SHA, not the parent's final SHA. Assert `status` does not report drift.
  - **Acceptance:** fresh run's accepted integration ref updates on checkpoint; no false drift immediately after.

- [ ] **BUG-50: `run-history.jsonl` contamination — fresh run's record inherits `phases_completed` and `total_turns` from parent run** — Verified via inspection of `run-history.js` + `run-context-inheritance.js:21`. Run chaining inheritance logic may be copying aggregates inappropriately. Tester's fresh run `run_7c529def79b94f51` (one PM turn, blocked in planning) has internally contradictory history record:
  - [x] 2026-04-19 implementation shipped: run-history counters remain current-run-only, while inherited continuity metadata is preserved separately under `parent_context`.
  - [x] 2026-04-19 regression proof shipped: `cli/test/beta-tester-scenarios/bug-50-run-history-contamination.test.js` now asserts isolated counters plus separate parent metadata.
  - [ ] Tester verification on `v2.145.0` still required before closure per rule #12.
  - `"phases_completed": ["planning","implementation","qa","launch"]` — claims all 4 phases done
  - `"total_turns": 70` — not plausible for a fresh run with one turn
  - `"gate_results": {"planning_signoff": "pending", "implementation_complete": "pending", ...}` — all gates still pending
  - **The contradiction is self-evident in the same JSON record.**
  - **Fix requirements:**
    - Fresh run records in `run-history.jsonl` must track ONLY that run's own phase/turn progression. Inherited context from parent run (for continuity) should be a separate nested field (`parent_context` or similar), not mixed into the live run's own counters.
    - Grep `run-history.js` for where `phases_completed` and `total_turns` are computed. If they read from parent state, fix to compute from the current run's own turns and gates only.
    - Tester-sequence test: chain fresh run from parent → dispatch one PM turn → assert fresh run's `run-history.jsonl` entry has `phases_completed: []` (or `["planning"]` if that phase is partially done), `total_turns: 1`, and gate_results reflecting actual current state.
  - **Acceptance:** fresh run's history record is internally consistent; no inherited contradictions.

### Implementation notes for BUG-47..50

- **All four ship as v2.145.0.** They're related (all state-consistency fixes on continuation runs) but code paths are distinct. Work them in parallel, release as one bundle. BUG-47 is the operator-visible safety net; BUG-48/49/50 are correctness.
- **Secondary UX issue tester mentioned (NOT a separate item):** `SESSION_RECOVERY.md`, `TALK.md`, `HUMAN_TASKS.md`, `state.json` still appearing dirty in `git status`. These ARE in `ORCHESTRATOR_STATE_FILES` exclusion list (`repo-observer.js:40-62`), so they don't poison the framework's baseline observation — but they do show up in raw `git status`, creating visual noise. Acceptable for now; agents should consider whether the framework should `.gitignore` these paths by default so they never appear in git status.
- **Do NOT mark closed until tester verifies v2.145.0.** Rule #12 is in force.
- **BUG-44/45/46 closed on 2026-04-19** with tester-verified output on v2.144.0 (see "Recent closures" below). When the tester retests v2.145.0, they're retesting ONLY the BUG-47..50 fixes.

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
- ✅ **BUG-44** — phase-scoped intent retirement on phase advance (tester-verified on v2.144.0: "no stale implementation intent blocking QA acceptance")
- ✅ **BUG-45** — retained-turn acceptance reconciles against live intent state (tester-verified on v2.144.0: "normal commands work; no manual `.agentxchain/` state surgery required")
- ✅ **BUG-46** — post-acceptance deadlock resolved; framework-owned file exclusions, working-tree observation, verification-produced file classification (tester-verified on v2.144.0 with 4 successful checkpoint SHAs quoted)
- ✅ **BUG-42** — phantom intent detection for rebound legacy intents (first non-false closure after 7 false ones)
- ✅ **BUG-43** — checkpoint-turn filters ephemeral staging/dispatch paths from `files_changed`
- Releases: v2.138.0 (BUG-42/43), v2.139.0 (BUG-44), v2.140.0 (BUG-45), v2.141.1–v2.143.0 (BUG-46 hardening), v2.144.0 (tester-verification bundle)

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
