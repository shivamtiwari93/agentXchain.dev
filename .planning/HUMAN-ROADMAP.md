# Human Roadmap — AgentXchain

Human-prioritized work for the agents.

Rules:
- Agents should read this file before acting.
- Unchecked items here take priority over general exploration in `AGENT-TALK.md`.
- When an item is complete, agents should mark it complete and briefly record what changed.
- If an item is too large, agents should split it into smaller checklist items and work them down in order.
- Only move an item back to `HUMAN_TASKS.md` if it truly requires operator-only action.

Current focus: **🚨 NEW DEFECT CLASS REPORTED 2026-04-26 by tusq.dev beta tester operator on shipped `agentxchain@2.155.25`: continuous vision-driven mode reports `status: completed` with `runs_completed: 0` and no next objective even when `.planning/ROADMAP.md` contains explicit unchecked milestones (M28/M29) and `.planning/VISION.md` still has open V2/V3 scope.** Two failure shapes filed: **BUG-76** (current/strongest — unchecked roadmap with idle-completion) and **BUG-77** (older related — roadmap exhausted, vision still open, no PM-derive-next-increment dispatch). The tester's framework: AgentXchain must distinguish three states — (1) current run complete + ROADMAP has unchecked work, (2) ROADMAP exhausted + VISION has unplanned scope, (3) VISION genuinely exhausted. States 1 and 2 currently collapse into `completed`/idle. Full Auto Mode looks terminal even when concrete product work remains. **All prior queue closures (twenty-eight items including BUG-69/70/71/72/73/75, DEV-ROLE-DELIVERS-PLANNING-NOT-CODE, AGENT-TEMPLATES-AUDIT, DOGFOOD-EXTENDED-10-CYCLES, DOGFOOD-TUSQ-DEV, BUG-63/64/65/66/67/68, BUG-52/53/54/55/56/57/59/60/61/62, FULLTEST-58, CICD-SHRINK, RELEASE-v2.149) have been moved to `.planning/HUMAN-ROADMAP-ARCHIVE.md` with full closure detail and decision records preserved.**

## Tester message — 2026-04-26 verbatim

The tester's message that triggered BUG-76 + BUG-77:

> We have two related tusq.dev dogfood issues around continuous vision-driven execution and PM roadmap replenishment.
>
> **Primary current issue:** `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/AGENTXCHAIN_ISSUE_CONTINUOUS_IDLE_WITH_OPEN_ROADMAP.md` — stronger/current failure shape on agentxchain@2.155.25. Continuous mode reports the session as completed with runs_completed=0, no current objective, no pending intents, and no next actions, even though ROADMAP.md already contains unchecked M28/M29 milestones. So this is not merely "VISION.md is broad and PM did not infer V2 work"; there is explicit unchecked roadmap work and AgentXchain still idles.
>
> **Older related issue:** `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/AGENTXCHAIN_ISSUE_PM_IDLE_EXPANSION.md` — earlier failure shape where the visible roadmap appeared exhausted, but VISION.md still had substantial V2/V3 scope. In that case, continuous mode also stopped instead of dispatching PM to derive the next bounded roadmap increment.
>
> **My assessment from tusq.dev dogfooding:** AgentXchain needs to distinguish three states: (1) Current governed run complete, but ROADMAP.md has unchecked work. (2) ROADMAP.md exhausted, but VISION.md still has unplanned scope. (3) VISION.md genuinely exhausted. Right now, case 1 and case 2 can collapse into an idle/completed state. That makes Full Auto Mode look terminal even when product work remains. The expected behavior is to dispatch or queue PM/dev with a concrete objective, or emit a clear blocker explaining why the next roadmap item cannot start.

## Priority Queue

- [ ] **🚨 BUG-76: continuous vision mode exits idle/completed even when `.planning/ROADMAP.md` contains unchecked milestones (M28/M29) and `agentxchain status --json` shows no objective, no pending intents, no next actions.** Reproduced by tusq.dev beta tester on shipped `agentxchain@2.155.25` at 2026-04-26T00:51:50Z. **This is the strongest/current failure shape — supersedes the older "VISION too broad" framing.**

  **Tester's full evidence file (read this first):** `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/AGENTXCHAIN_ISSUE_CONTINUOUS_IDLE_WITH_OPEN_ROADMAP.md`

  **Reproduction environment:**
  - Project: `tusq.dev`
  - Workspace: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev`
  - Branch: `main` (HEAD `100d662 Recover AgentXchain governed state after dogfood merge`)
  - Shipped package: `npx --yes -p agentxchain@latest -c 'agentxchain --version'` → `2.155.25`
  - Date observed: 2026-04-26T00:51:50Z

  **Observed AgentXchain state — looks terminal but isn't:**
  ```json
  {
    "state": {
      "run_id": "run_ce89ef5bd4b8cca8",
      "status": "completed",
      "phase": "launch",
      "active_turns": {},
      "blocked_on": null,
      "phase_gate_status": {
        "planning_signoff": "passed", "implementation_complete": "passed",
        "qa_ship_verdict": "passed", "launch_ready": "passed"
      },
      "provenance": {"trigger": "intake", "created_by": "continuous_loop"}
    },
    "continuous_session": {
      "session_id": "cont-34797773",
      "vision_path": ".planning/VISION.md",
      "runs_completed": 0,
      "max_runs": 1,
      "idle_cycles": 1,
      "max_idle_cycles": 1,
      "current_run_id": "run_ce89ef5bd4b8cca8",
      "current_vision_objective": null,
      "status": "completed",
      "expansion_iteration": 0
    },
    "pending_intents": [],
    "next_actions": []
  }
  ```

  **Product evidence — ROADMAP IS NOT EXHAUSTED:**
  - `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/ROADMAP.md:298` — `### M28: Static Sensitivity Class Inference from Manifest Evidence (~0.5 day)` with multiple `- [ ]` unchecked items
  - `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/ROADMAP.md:316` — `### M29: Static Auth Requirements Inference from Manifest Evidence (~0.5 day)` with multiple `- [ ]` unchecked items
  - `provenance.trigger_reason` confirms the framework KNEW it was an idle-expansion run: *"[idle-expansion #1] Inspect VISION.md, ROADMAP.md, SYSTEM_SPEC.md, and current project state. Derive the next concrete increment as a new intake intent..."* — but did not act on it.

  **Why this is a framework bug (not a config or VISION issue):**
  1. `runs_completed: 0` plus `status: completed` is treated as a valid terminal session even though no governed work was dispatched.
  2. Continuous idle detection appears to evaluate the current run terminal state without scanning `.planning/ROADMAP.md` for unchecked milestones.
  3. The idle-expansion objective was not persisted into `current_vision_objective`, `next_objective`, `pending_intents`, or `next_actions`.
  4. The idle-expansion code path may be relying on completed gate state (`planning_signoff`, `implementation_complete`, `qa_ship_verdict`, `launch_ready`) instead of checking whether the planning artifacts contain open work.
  5. There is no distinct state for "current governed run complete, but roadmap contains unchecked work."

  **Required fix — continuous-mode planning baseline classifier before declaring an idle session complete:**
  1. If `.planning/ROADMAP.md` contains unchecked milestone items (`- [ ]` under `### M<n>:` headings), derive the next objective from the first unchecked milestone and dispatch/queue work. Choose role based on planning artifact state: `dev` if PM-owned planning artifacts already define sufficient acceptance criteria for the milestone; `pm` if the planning artifacts need refresh.
  2. Else if `.planning/ROADMAP.md` has no unchecked milestone but `.planning/VISION.md` has unplanned strategic scope, dispatch PM in "derive next roadmap increment" mode (see BUG-77).
  3. Else declare `vision_exhausted`, but only with explicit evidence mapping VISION headings to completed milestones or accepted non-goals.
  4. Add new event/status vocabulary so the operator can disambiguate: `roadmap_open_work_detected`, `roadmap_exhausted_vision_open`, `vision_exhausted`, `idle_completion_refused_open_roadmap`.

  **Closure criteria (binary):**
  1. Given the tester's exact reproduction state — `.planning/ROADMAP.md` contains unchecked M28/M29 — `agentxchain run --continuous --vision .planning/VISION.md` MUST NOT exit with `runs_completed: 0`, `status: completed`, and no objective. The session must either dispatch/queue a turn for M28 OR produce a typed blocker explaining why M28 cannot be started (NOT a generic `completed`).
  2. `agentxchain status --json` exposes a non-empty objective or next_actions when unchecked roadmap work exists.
  3. `runs_completed: 0` is never presented as successful completion when the session performed no governed work and open roadmap items remain.
  4. Regression test under `cli/test/beta-tester-scenarios/bug-76-roadmap-open-idle-completion.test.js` reproduces the exact tester state (state.status=completed, phase=launch, all gates passed, ROADMAP.md with unchecked M28) and asserts continuous mode dispatches OR emits a typed blocker — not generic completion.
  5. Tester quote-back required against published `agentxchain@2.155.26+` package on real `tusq.dev` workspace before closure.

  **Cross-cutting discipline:**
  - This is the third "looks terminal but has open work" defect class in the BUG-72/73/75 lineage. The recovery work for those bugs handled `charter_materialization_pending` runs; BUG-76 is the COMPLETED-run analog. Re-audit all "session terminal state" detection sites for the same class of error: do they look at ROADMAP.md / VISION.md before declaring `completed`?
  - Per Rule #12: BUG-76 closure requires a command-chain integration test that spawns `agentxchain run --continuous` as a child process against a fixture mirroring tusq.dev's exact state shape, NOT a function-call test that exercises an internal seam.
  - Per Rule #13: any new gate or classifier must ship with a positive-case regression test (open-roadmap → must-not-idle) AND a negative-case regression test (genuinely-exhausted-vision → must declare vision_exhausted with evidence map).

- [ ] **🚨 BUG-77: continuous mode does not dispatch PM in "derive next roadmap increment" mode when `.planning/ROADMAP.md` is exhausted but `.planning/VISION.md` still contains unplanned V2/V3 scope.** Reported by tusq.dev beta tester originally on `agentxchain@2.154.7` (2026-04-22) and resurfaced as the related-but-distinct shape in the 2026-04-26 message. **This is the older/related failure shape — same root class as BUG-76 but distinct trigger condition.**

  **Tester's full evidence file (read this first):** `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/AGENTXCHAIN_ISSUE_PM_IDLE_EXPANSION.md`

  **Reproduction environment (original):**
  - Project: `tusq.dev`
  - Workspace: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev`
  - Date observed: 2026-04-22 (still relevant per tester's 2026-04-26 message)
  - Shipped package: `agentxchain@2.154.7` (re-verify on `2.155.25`+ during fix)

  **Observed state at original report:**
  - `agentxchain status` reported `Status: completed`, `Runs: 0/1`, `Idle cycles: 1/1`, but the active run was `BLOCKED` on a stale `planning_signoff` gate for already-completed M27 scope.
  - CLI emitted: `"Idle cycle 1/1 - no derivable work from vision. All vision goals appear addressed (1 consecutive idle cycles). Stopping."`
  - `.agentxchain/continuous-session.json`: `runs_completed: 0`, `current_vision_objective: null`, `status: "completed"`.
  - `.agentxchain/state.json` confirmed continuation from blocked parent: `provenance.trigger: "continuation"`, `inherited_context.parent_blocked_reason: "human:planning_signoff gate explicitly requires human approval before transitioning from planning to implementation..."`.

  **Product evidence — ROADMAP exhausted, VISION still open:**
  - `.planning/ROADMAP.md` was checked through M27 (latest milestone all `- [x]`), no M28+ existed at that time.
  - `.planning/VISION.md:257-290` contained explicit V2 scope (runtime instrumentation, eval/regression infrastructure, migration/rollout tooling, richer skill/workflow generation, governance) AND V3 scope (runtime learning loop, advanced usage intelligence, competitive transition intelligence, automated improvement proposals).
  - The blocked human gate (`hesc_82dd03472d55f3a5`) referred to M27 scope already covered by existing artifacts — re-approving would re-enter the stale loop, not derive M28.

  **Why this is a framework bug:**
  1. The continuous derivation heuristic uses roadmap exhaustion (or lack of unchecked items) as a proxy for full vision completion.
  2. Continuation runs inherit blocked milestone context too strongly — PM remains anchored to M27 instead of deriving the next item from remaining vision scope.
  3. There is no explicit "roadmap replenishment" state transition for "current roadmap is complete but VISION.md is not."
  4. Human-gate recovery and next-increment derivation are conflated — a stale gate dominates status even when the operator's intended action is "derive next work."
  5. Continuous mode marks the session `completed` with `runs_completed: 0`, hiding that no product/planning progress occurred.

  **Required fix — explicit roadmap-replenishment dispatch path:**
  ```text
  If no active roadmap/intake item is derivable
  AND current roadmap has no unchecked milestone
  AND VISION.md has unplanned future sections or goals
  THEN dispatch PM in "derive next roadmap increment" mode
  WITHOUT inheriting stale blocked gate context as the primary objective.
  ```
  PM objective text must be concrete: *"Derive the next bounded roadmap/spec/intake increment from remaining VISION.md scope and current product gaps. Do not re-verify or seek signoff for the previous completed milestone unless that is the explicit objective."*

  Status vocabulary: emit `roadmap_exhausted_vision_open` (NOT `All vision goals appear addressed`) when roadmap is exhausted but VISION still has unplanned scope.

  **Closure criteria (binary):**
  1. With `.planning/ROADMAP.md` checked through M<n> with no M<n+1>, and `.planning/VISION.md` containing unplanned V2/V3 scope, continuous mode does NOT claim full vision completion.
  2. Continuous mode creates or dispatches a PM turn with a clear next-increment derivation objective.
  3. The resulting PM turn produces a new bounded roadmap/spec/intake increment rather than revalidating the latest completed milestone.
  4. Stale human gates from the previous milestone do not dominate the objective of a clean next-increment derivation run.
  5. `agentxchain status` differentiates "no active turn because current roadmap is exhausted" from "vision fully complete."
  6. If the framework determines VISION.md is fully addressed, it reports the evidence: which VISION headings were mapped to which completed milestones — `vision_exhausted` is never emitted without an evidence map.
  7. Regression test under `cli/test/beta-tester-scenarios/bug-77-roadmap-exhausted-vision-open.test.js` mirrors the original tester state (ROADMAP fully checked, VISION.md with explicit V2/V3 sections, blocked parent context) and asserts a PM derive-next-increment turn is dispatched, not idle completion.
  8. Tester quote-back required against published `agentxchain@2.155.26+` package on real `tusq.dev` workspace before closure.

  **Likely shared fix vehicle:** BUG-76 and BUG-77 are the same architectural defect class with two distinct triggers. The continuous-mode planning baseline classifier (BUG-76 fix item 1) extended with the VISION-scan branch (BUG-77 fix block) likely closes both. Coordinate fixes — do not ship them in isolation.

---

## Active discipline (MUST follow on every fix going forward)

Established across the 2026-04-18/20 beta cycle after 8 false closures (BUG-17/19/20/21, BUG-36, BUG-39, BUG-40, BUG-41, BUG-52). All 12 rules remain in force:

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

12. **Command-chain integration tests are mandatory for any CLI workflow bug** (added 2026-04-20 after BUG-52's false closure). Function-call tests that exercise an internal seam are NOT sufficient for bugs where the operator's reproduction is a chain of CLI commands. Every tester-sequence test file in `cli/test/beta-tester-scenarios/` must have at least one assertion that uses `execFileSync('agentxchain', [...])` (or equivalent child-process spawn) to mirror the operator's real command chain.

13. **No preflight gate ships without a positive-case regression test that proves the gate passes for at least one real valid configuration** (added 2026-04-21 after BUG-56). A test that only asserts the gate's failure output is green in CI but says nothing about whether emitting that failure is the correct behavior.

*(Historical note: the original rule 12 — "no bug closes without the beta tester's verified output" — was removed 2026-04-20. Tester verification remains valuable evidence but is no longer a hard blocker on closure. Rules 1, 2, 6, 9, 12 and 13 above still gate closure via tests and packaged proof.)*

---

## Recent closures (see `HUMAN-ROADMAP-ARCHIVE.md` for full detail)

### 2026-04-25/26 cycle — closed
- ✅ **BUG-69 / BUG-70 / BUG-71 / BUG-72 / BUG-73 / BUG-75** — full-auto approval policy, idle-expansion charter materialization, semantic-coverage ordering, materialization recovery routing, stale idle-expansion run recovery. Shipped across `agentxchain@2.155.12` through `agentxchain@2.155.22`. Full detail archived.
- ✅ **DEV-ROLE-DELIVERS-PLANNING-NOT-CODE** — root cause was PM idle-expansion charter not promoting proposals into gate artifacts (NOT dev role). Fixed via materialization directive in `dispatch-bundle.js:305-333`. Dogfood produced 311 lines of real M28 product code on closure cycle.
- ✅ **AGENT-TEMPLATES-AUDIT** — full audit of all role prompts and scaffold templates passed. No prompt changes needed; all surfaces correctly mandate real deliverables.
- ✅ **DOGFOOD-EXTENDED-10-CYCLES** — 10 governed runs on `agentxchain-dogfood-2026-04`, **987 insertions across 4 src/tests files**, 42 checkpoint commits, all 4 phases traversed per run.

### 2026-04-24 cycle — closed
- ✅ **DOGFOOD-TUSQ-DEV** — initial 3-run closure (with caveat that runs were planning-only, leading to DEV-ROLE follow-up).
- ✅ **BUG-63 / BUG-64 / BUG-65 / BUG-66 / BUG-67 / BUG-68** — dogfood gap-discovery cluster, shipped v2.155.1–v2.155.10.

### 2026-04-23 cycle — closed
- ✅ **BUG-52** (third variant, tester-verified shipped-package evidence on `agentxchain@2.154.11`)
- ✅ **BUG-53** (perpetual chain via shipped `agentxchain@2.155.10` dogfood evidence)
- ✅ **BUG-54** (local_cli runtime spawn/attach reliability, shipped `agentxchain@2.155.10`)
- ✅ **BUG-55** (checkpoint completeness, tester-verified on v2.150.0)
- ✅ **BUG-59** (architectural approval_policy/requires_human_approval connection, shipped v2.151.0)
- ✅ **BUG-60** (perpetual continuous mode, closed via shipped v2.155.10 dogfood)
- ✅ **BUG-61** (ghost-turn auto-retry mechanism-verified on `agentxchain@2.154.11`)
- ✅ **BUG-62** (operator-commit reconcile, shipped-package proof on `agentxchain@2.155.10`)

### 2026-04-21 cycle — closed
- ✅ **BUG-56 / BUG-57 / FULLTEST-58 / CICD-SHRINK / RELEASE-v2.149**

### Earlier 2026-04-18/20 clusters
- ✅ **BUG-44/45/46** — phase-scoped intent retirement, retained-turn reconciliation, post-acceptance deadlock (tester-verified on v2.144.0)
- ✅ **BUG-47/48/49/50/51** — stale-turn watchdog + intent lifecycle + checkpoint ref update + run-history contamination + fast-startup watchdog (tester-verified on v2.146.0)
- ✅ **BUG-42/43** — phantom intent detection, checkpoint ephemeral path filtering
- ✅ **BUG-31..41** — iterative planning, intake integration, state reconciliation, full-auto checkpoint handoff, false-closure fixes
- ✅ **BUG-1..30** — acceptance/validation, drift recovery, intake integration
- ✅ **B-1..B-11** — CLI version safety, runtime matrix, authority model, Codex recipes
- ✅ **Framework capabilities** — full-auto vision-driven operation, human priority injection, last-resort escalation, live 3-run proof
- ✅ **DOC-1** — website sidebar Examples → Products/Proofs split

---

## Completion Log

- **2026-04-25**: All twenty-eight prior closures consolidated into archive. Three top-priority directives (DEV-ROLE-DELIVERS-PLANNING-NOT-CODE, AGENT-TEMPLATES-AUDIT, DOGFOOD-EXTENDED-10-CYCLES) closed; substrate produced 987 lines of real product code on tusq.dev dogfood branch. Watch feature shipped across Turns 24-31 (`agentxchain watch --event-file`/`--event-dir`/`--results`). Comparison page source-back sweep completed across 9 vendor pages (CrewAI, LangGraph, OpenAI Agents SDK, AG2/AutoGen, Devin, MetaGPT, OpenHands, Codegen, Warp), bundled in v2.155.26 release.
- **2026-04-21**: BUG-55 closed with tester-verified shipped-package evidence on v2.150.0. First clean closure in the BUG-52/53/54/55 cluster.
- **2026-04-20**: BUG-47/48/49/50/51 closed with tester-verified output on v2.146.0. BUG-52 and BUG-53 opened from tester report #18.
- **2026-04-19**: BUG-44/45/46 closed with tester-verified output on v2.144.0. First non-false closure after 7 false ones.
- **2026-04-18**: 64-item beta-tester bug cluster closed through v2.138.0. Discipline rules 1–12 now in force.
- **2026-04-17**: Framework full-auto vision-driven operation shipped with 3-run live proof.
- **2026-04-03**: Original 7 priority queue items completed. Docusaurus migration, vision alignment, v2.2.0 release-ready.
