# Human Roadmap — AgentXchain

Human-prioritized work for the agents.

Rules:
- Agents should read this file before acting.
- Unchecked items here take priority over general exploration in `AGENT-TALK.md`.
- When an item is complete, agents should mark it complete and briefly record what changed.
- If an item is too large, agents should split it into smaller checklist items and work them down in order.
- Only move an item back to `HUMAN_TASKS.md` if it truly requires operator-only action.

Current focus: **🚨🚨🚨 STOP ALL FEATURE WORK. DOGFOOD-100-TURNS-CLEAN-FULL-AUTO IS THE ONLY PRIORITY. 🚨🚨🚨** Agents must use the shipped `agentxchain` CLI framework ONLY to drive `tusq.dev` development for at least **100 consecutive full-auto turns** without any human intervention OR manual staging-JSON edits OR `jq` recovery surgery OR operator-side workarounds. Every issue discovered during dogfood must be: (1) discovered through dogfood failure, (2) triaged into a BUG entry in this roadmap, (3) fixed in the substrate, (4) shipped as a patch release, (5) **re-verified by resuming the SAME dogfood session and confirming the failure no longer reproduces**, (6) closed. **Success = 100 consecutive full-auto turns on tusq.dev with zero blocked-on-human pauses, zero manual JSON edits, zero `jq` recoveries, zero operator workarounds.** Until that bar is hit, do NOT pick up watch-mode extensions (`watch --listen`), do NOT pick up the conformant-runner examples sample, do NOT pick up new comparison-page work, do NOT pick up connector adoption proofs, do NOT pick up website polish, do NOT pick up release-process improvements unrelated to dogfood-discovered bugs. The discovery output of this directive is whatever BUGs surface — currently **BUG-76, BUG-77, BUG-78, BUG-79** are open (all four are dogfood-discovery products from tusq.dev sessions on `agentxchain@2.155.25/2.155.26`). They are the head of the queue, not parallel work streams. This is the substrate-credibility gate for the whole project. If the framework cannot drive its own beta tester's product through 100 clean turns, none of the other adoption surfaces matter. The tester's framework: AgentXchain must distinguish three states — (1) current run complete + ROADMAP has unchecked work, (2) ROADMAP exhausted + VISION has unplanned scope, (3) VISION genuinely exhausted. States 1 and 2 currently collapse into `completed`/idle. Full Auto Mode looks terminal even when concrete product work remains. **All prior queue closures (twenty-eight items including BUG-69/70/71/72/73/75, DEV-ROLE-DELIVERS-PLANNING-NOT-CODE, AGENT-TEMPLATES-AUDIT, DOGFOOD-EXTENDED-10-CYCLES, DOGFOOD-TUSQ-DEV, BUG-63/64/65/66/67/68, BUG-52/53/54/55/56/57/59/60/61/62, FULLTEST-58, CICD-SHRINK, RELEASE-v2.149) have been moved to `.planning/HUMAN-ROADMAP-ARCHIVE.md` with full closure detail and decision records preserved.**

## Tester messages — 2026-04-26 verbatim

The tester's first message that triggered BUG-76 + BUG-77:

> We have two related tusq.dev dogfood issues around continuous vision-driven execution and PM roadmap replenishment.
>
> **Primary current issue:** `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/AGENTXCHAIN_ISSUE_CONTINUOUS_IDLE_WITH_OPEN_ROADMAP.md` — stronger/current failure shape on agentxchain@2.155.25. Continuous mode reports the session as completed with runs_completed=0, no current objective, no pending intents, and no next actions, even though ROADMAP.md already contains unchecked M28/M29 milestones. So this is not merely "VISION.md is broad and PM did not infer V2 work"; there is explicit unchecked roadmap work and AgentXchain still idles.
>
> **Older related issue:** `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/AGENTXCHAIN_ISSUE_PM_IDLE_EXPANSION.md` — earlier failure shape where the visible roadmap appeared exhausted, but VISION.md still had substantial V2/V3 scope. In that case, continuous mode also stopped instead of dispatching PM to derive the next bounded roadmap increment.
>
> **My assessment from tusq.dev dogfooding:** AgentXchain needs to distinguish three states: (1) Current governed run complete, but ROADMAP.md has unchecked work. (2) ROADMAP.md exhausted, but VISION.md still has unplanned scope. (3) VISION.md genuinely exhausted. Right now, case 1 and case 2 can collapse into an idle/completed state. That makes Full Auto Mode look terminal even when product work remains. The expected behavior is to dispatch or queue PM/dev with a concrete objective, or emit a clear blocker explaining why the next roadmap item cannot start.

The tester's second message (later same day) that triggered BUG-78:

> We hit another Full Auto Mode blocker on agentxchain@2.155.26 during tusq.dev dogfooding.
>
> The product_marketing role performed a valid no-edit launch readiness review, but its staged result declared artifact.type="workspace" with files_changed=[].
>
> AgentXchain correctly rejected the inconsistency, but this paused the continuous run and required manual JSON surgery. Changing artifact.type to "review" allowed the turn to accept and the run completed cleanly.
>
> Detailed issue with exact terminal output, staged JSON, no-diff proof, recovery command, and proposed fixes is here: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/AGENTXCHAIN_ISSUE_NO_EDIT_REVIEW_ARTIFACT_TYPE.md`

The tester's third message (same day, on the next dogfood run after BUG-78 manual recovery) that triggered BUG-79:

> We hit another Full Auto Mode blocker on agentxchain@2.155.26 during tusq.dev dogfooding.
>
> A PM turn completed useful planning work for the vision-derived objective "The Promise: a self-hostable runtime and MCP server," but the staged result emitted objections using `summary` and `detail` fields without the required `statement` field.
>
> AgentXchain blocked acceptance with: `Validation failed at stage schema: objections[0].statement must be a non-empty string.; objections[1].statement must be a non-empty string.`
>
> This appears to be a result-shape/prompt/schema-normalization issue, not a product-work failure. The issue file includes exact terminal output, status evidence, staged JSON, changed planning files, manual recovery command, and proposed fixes: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/AGENTXCHAIN_ISSUE_PM_OBJECTION_SCHEMA_SUMMARY_DETAIL.md`

## Priority Queue

- [ ] **🚨🚨🚨 DOGFOOD-100-TURNS-CLEAN-FULL-AUTO: agents use the shipped `agentxchain` CLI framework ONLY to drive `tusq.dev` development for at least 100 consecutive full-auto turns with zero human intervention, zero manual staging-JSON edits, zero `jq` recovery, zero operator workarounds.** This is the substrate-credibility gate. Until 100 clean turns land on a single tusq.dev dogfood session, **all other work streams are paused** — no watch-mode extensions, no conformant-runner examples, no new comparison pages, no connector adoption, no website polish, no docs work unrelated to dogfood-discovered defects. **The output of this directive is bug-discovery + substrate hardening, not feature shipping.**

  **Target repo:** `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev` (NOT `tusq.dev-agentxchain-dogfood` worktree — use the real `main` branch where the tester runs their own dogfood). Cut a fresh dogfood branch `agentxchain-dogfood-100-turn-2026-04` from `origin/main` if a fresh branch is needed; do NOT commit to tusq.dev `main` directly.

  **Mode:** shipped `agentxchain` CLI via `npx --yes -p agentxchain@latest -c 'agentxchain run --continuous --vision .planning/VISION.md ...'`. No local checkouts of the agentxchain repo. No hand-driving via direct `node cli/bin/agentxchain.js` invocations. The CLI invocation must mirror exactly what an external operator would type.

  **Definition of "turn":** one role dispatch (one `Turn assigned: ... → <role>` line in CLI output, terminating in either `Turn accepted` OR a typed acceptance failure). PM, dev, QA, product_marketing, and PM-idle-expansion turns all count. Reissued turns count as new turns. Skipped turns (e.g. role-resolution rejections without dispatch) do NOT count.

  **Definition of "clean":** all four conditions must hold for a turn to count toward the 100:
  1. **No human escalation surfaced** — `state.blocked_on` did not transition to a `needs_human` / `needs_decision` blocker requiring `agentxchain unblock` from the operator.
  2. **No manual staging JSON edit** — operator never touched `.agentxchain/staging/<turn>/turn-result.json` with `jq`, `vim`, or any editor. (BUG-78 + BUG-79 class.)
  3. **No `agentxchain accept-turn --turn ...` invocation by the operator** — every accepted turn must be accepted by the framework's own continuous loop, not by the operator running `accept-turn` to recover.
  4. **No silent restart/rerun** — if the operator hits Ctrl-C and reruns `agentxchain run --continuous` with the same session, the rerun does NOT count toward the 100; only turns that flowed without operator interruption count.

  **Definition of "full-auto":** the continuous run was invoked with `--triage-approval auto` (or equivalent full-auto config in `agentxchain.json`'s `approval_policy`) AND the session ran without the operator ever switching to manual approval mode mid-session.

  **Discovery loop (mandatory):** every BUG discovered during dogfood follows this exact six-step flow before the turn counter resumes:
  1. **Discovery** — dogfood pause/blocker captured. Operator (the human) confirms it's a real defect and not a misconfiguration.
  2. **Triage** — agent files a new BUG-NN entry in this roadmap with: tester evidence file path, reproduction state, observed acceptance error, why-this-is-a-framework-bug analysis, three-layer fix (prompt/validator/schema or equivalent), closure criteria, regression test path. Mirror the depth of BUG-76 through BUG-79 entries — do not skimp.
  3. **Fix** — substrate-side fix shipped. Spec-first if architectural (per Rule #12 + Rule #13). Layered fix per BUG-79 if it's another instance of the staged-result-shape class.
  4. **Patch release** — bumped, npm published, homebrew tap synced, downstream-truth verification green, social posts per WAYS-OF-WORKING §8 (or skip-marketing-on-substrate-only-fixes if Rule #5 applies).
  5. **Re-verify on the SAME dogfood session** — resume the paused tusq.dev session on the new shipped package, confirm the same failure no longer reproduces, capture evidence under `.planning/dogfood-100-turn-evidence/bug-NN-reverify-vX.Y.Z.md`. **The turn counter resumes from the failure-causing turn, NOT from zero — but the failure-causing turn does NOT count toward the 100 (it was a blocked turn).**
  6. **Close** — mark the BUG entry checked, append closure note with shipped version + dogfood re-verify evidence path.

  **Sequence rule:** the 100-turn counter is a CONSECUTIVE counter, not a cumulative counter across sessions. If a BUG is discovered at turn 47, the fix-and-reverify cycle resumes the SAME session and the next clean turn is turn 48 (the 47th-turn failure does NOT count, but the 46 prior clean turns are NOT lost). If the operator must restart the session for any reason — including agent-driven restart from a hung run — the counter resets to zero. **The 100 must be a single unbroken session run.**

  **Evidence capture:** under `.planning/dogfood-100-turn-evidence/`:
  - `session-summary.md` — running log: dates, session ID, turn count progress, BUGs discovered, current shipped agentxchain version, live link to the tusq.dev branch HEAD
  - `cycle-NN-summary.md` — one per dogfood-discovery cycle (turn N where a BUG surfaced → BUG-NN filed → fix shipped → reverify on resumed session → next clean turn)
  - `turn-counter.jsonl` — append-only log: one line per countable turn with `{ turn_id, role, timestamp, agentxchain_version, session_id, counter_value }`. The counter MUST advance monotonically and reset to zero on session-restart.
  - `final-100-evidence.md` — produced ONLY when the counter hits 100. Contains: session ID, agentxchain version range across the 100 turns (will likely span multiple patch versions due to mid-session BUG fixes), turn-counter.jsonl summary, all BUGs discovered/closed during the 100, and tusq.dev product progress (new milestones materialized, roadmap items implemented, gates passed).

  **Currently open BUG-76, BUG-77, BUG-78, BUG-79 are part of this directive's discovery output, not separate work streams.** They're at the head of the queue because the dogfood is currently paused on them. Closing each follows the six-step discovery loop above. The 100-turn counter cannot start until the current dogfood session can resume past these four blockers.

  **Stop conditions (declare DOGFOOD-100-TURNS-CLEAN-FULL-AUTO closed):**
  - **SUCCESS:** 100 consecutive clean full-auto turns on a single tusq.dev dogfood session. Append `final-100-evidence.md`. Close this entry. Resume normal feature work (watch-mode, conformant-runner examples, connector adoption, etc.) ONLY after this evidence file exists.
  - **PAUSE (operator-only):** operator explicitly tells agents to pause this directive. Document in this entry's completion note. Until that happens, agents do NOT pivot to other work.
  - **NEVER auto-pivot:** agents do NOT, on their own initiative, declare "we've made enough progress" and pivot. This is a 100-turn gate, not a "best effort" gate. If 100 is not yet hit, the directive is still active.

  **Anti-patterns to refuse (these are NOT allowed during this directive):**
  - "Let me ship this watch-mode improvement while waiting for the dogfood to resume." NO — wait time during BUG triage is for filling out the audit (BUG-79 Layer 1) or pre-emptive substrate hardening, not unrelated feature work.
  - "BUG-NN is small, let me ship a prompt-only fix and skip the audit." NO — the audit is part of the directive's substrate-credibility goal. Cutting corners on the audit means the next instance of the class will surface, will pause the dogfood, and the 100-turn counter will reset.
  - "Let me run multiple dogfood sessions in parallel to hit 100 faster." NO — the 100 must be a single unbroken session. Parallel sessions don't aggregate.
  - "Let me lower the bar from 100 to 50 because we're making good progress." NO — the operator set the bar at 100. Only the operator can lower it.
  - "The dogfood found a bug in tusq.dev (the product), not agentxchain (the framework). I'll fix it in the framework." NO — if the bug is in tusq.dev, the agents file it as tusq.dev product work and let the next dogfood turn pick it up via the same governed flow. Cross-repo product fixes from the agentxchain side violate the dogfood discipline.

  **Closure criteria (binary):**
  1. `.planning/dogfood-100-turn-evidence/final-100-evidence.md` exists.
  2. `turn-counter.jsonl` shows monotonic progression to ≥100 within a single session ID.
  3. All BUGs discovered during the run are closed in this roadmap with shipped-version closure notes.
  4. Tusq.dev branch shows real product progress (new completed milestones, real `src/`/`tests/` diffs from agent-driven turns) attributable to the 100-turn run, not just framework-state churn.
  5. No operator-side recovery commands (`accept-turn`, `unblock`, `reissue-turn`, `reconcile-state`, `step --resume`) were invoked during the 100. (Those commands existing in the CLI is fine; they just shouldn't be needed by an operator during a clean run.)

  **Why this directive matters (do NOT skim this):** the framework's whole product thesis is "governed multi-agent software delivery for long-horizon AI-driven product work." If the framework cannot run its own beta tester's product through 100 clean turns, no marketing surface (comparison pages, HN launch, conformant-runner docs) compensates for that. This is the substrate-credibility gate. The watch-mode extensions, the connector adoption proofs, the conformant-runner sample, the website polish — none of them are wrong work, but ALL of them are second-priority until this gate clears. The four open BUGs (76/77/78/79) are the current head of the dogfood-discovery queue. When they close, the dogfood resumes. When the dogfood discovers more BUGs, they go to the head of this queue. **There is no other priority. There is only the dogfood and the BUGs the dogfood reveals.**

- [x] **🚨 BUG-76: continuous vision mode exits idle/completed even when `.planning/ROADMAP.md` contains unchecked milestones (M28/M29) and `agentxchain status --json` shows no objective, no pending intents, no next actions.** Reproduced by tusq.dev beta tester on shipped `agentxchain@2.155.25` at 2026-04-26T00:51:50Z. **This is the strongest/current failure shape — supersedes the older "VISION too broad" framing.** Closed 2026-04-26 in `agentxchain@2.155.30`: continuous mode now scans ROADMAP.md for unchecked milestones before declaring idle completion; dispatched M28 work correctly on same-session tusq.dev reverify. Evidence: `.planning/dogfood-100-turn-evidence/bug-76-reverify-v2.155.30.md`. Closure line: reproduces-on-tester-sequence: NO.

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

- [ ] **🚨 BUG-78: valid no-edit review turn (e.g. `product_marketing` launch readiness) emits `artifact.type: "workspace"` with `files_changed: []`, AgentXchain correctly rejects the internal inconsistency, but the continuous loop pauses and requires manual JSON surgery on `.agentxchain/staging/<turn>/turn-result.json` to recover.** Reproduced by tusq.dev beta tester on shipped `agentxchain@2.155.26` at 2026-04-26T03:03:06Z. **The validation works; the recovery path is the defect.** A no-edit review is legitimate work and should not require operator-edited staging JSON to advance.

  **Tester's full evidence file (read this first):** `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/AGENTXCHAIN_ISSUE_NO_EDIT_REVIEW_ARTIFACT_TYPE.md`

  **Reproduction environment:**
  - Project: `tusq.dev`
  - Workspace: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev`
  - Branch: `main`
  - Shipped package: `agentxchain@2.155.26`
  - Runtime: `local_cli`
  - Role: `product_marketing`, model: `claude-opus-4-7`
  - Vision-derived objective: *"The Promise: embeddable chat, widget, command-palette, and voice surfaces"*
  - Run progressed cleanly through `pm → dev → qa → product_marketing`; PM/dev/QA all accepted; only product_marketing acceptance failed.

  **Observed staged result (from `.agentxchain/staging/turn_c2915fef93e3ab0b/turn-result.json`):**
  ```json
  {
    "artifact": {"type": "workspace", "ref": "git:dirty"},
    "files_changed": []
  }
  ```

  **Observed acceptance error:**
  ```text
  acceptTurn(product_marketing): Turn declared artifact.type: "workspace" but files_changed is empty.
  Either declare the files modified, or set artifact.type: "review" if no repo mutations were intended.
  ```

  **Workspace evidence — no product marketing files actually changed:** `git diff -- .planning/MESSAGING.md .planning/LAUNCH_PLAN.md .planning/CONTENT_CALENDAR.md .planning/ANNOUNCEMENT.md` returned empty. The role's own turn summary stated *"made zero edits, requested run completion under auto_approve."* The validation rejection is correct — the role lied about its artifact type.

  **Manual recovery the operator was forced to perform:**
  ```sh
  jq '.artifact.type = "review" | .artifact.ref = "turn:turn_c2915fef93e3ab0b"' \
    .agentxchain/staging/turn_c2915fef93e3ab0b/turn-result.json > /tmp/turn-result.json \
    && mv /tmp/turn-result.json .agentxchain/staging/turn_c2915fef93e3ab0b/turn-result.json
  npx --yes -p agentxchain@2.155.26 -c 'agentxchain accept-turn --turn turn_c2915fef93e3ab0b --checkpoint'
  ```
  After this manual edit + accept-turn, the run completed cleanly, all 4 gates passed, `run_completed` event emitted at `2026-04-26T03:19:05Z`. The fix is correct; the path to applying it should not be `jq` surgery on runtime staging JSON.

  **Why this is a Full Auto Mode bug (medium-high severity):**
  1. The framework correctly protects artifact consistency — that part works.
  2. But the recovery path requires manual mutation of runtime staging JSON, which a) defeats Full Auto Mode, b) requires the operator to know the staging path layout, c) requires `jq` familiarity, d) is undocumented in the error message.
  3. The error message names the right correction (`set artifact.type: "review"`) but does not surface a CLI command that applies it.
  4. This same defect class likely affects every role that can legitimately do no-edit reviews — `product_marketing` (launch readiness), `qa` (re-verification), `pm` (chartering review when planning artifacts are already current). Tester explicitly calls this out.

  **Required fix — three-layer hardening (pick the right combination, do not ship just one):**

  **Layer 1 — Prompt-level (cheapest, highest leverage):** Add an explicit instruction to every role prompt that can perform no-edit work (start with `product_marketing`, `qa`, `pm`):
  ```text
  If you make zero file edits, you MUST set artifact.type to "review" and files_changed to [].
  Only set artifact.type to "workspace" when you actually modified repo files and list every changed file in files_changed.
  A no-edit launch readiness review is valid; represent it as a review artifact, not a workspace artifact.
  ```
  Surfaces: `.agentxchain/prompts/product_marketing.md`, `qa.md`, `pm.md`, plus `cli/src/templates/governed/*.json` role mandate text, plus `cli/src/lib/dispatch-bundle.js` if the artifact-type contract is injected at dispatch time. **Do this even if Layer 2 ships** — defense in depth.

  **Layer 2 — Validator/retry (substrate-side recovery):** When a staged result has `artifact.type === "workspace"` and `files_changed.length === 0`, AgentXchain should NOT immediately block the continuous run. Instead, in priority order:
  1. **Auto-normalize**: if `git diff` against the accepted-integration ref confirms no non-runtime product files changed, normalize the staged result to `artifact.type: "review"` and emit `artifact_type_auto_normalized` event with the original declaration preserved for audit. This is the cheapest recovery and matches what the operator manually did.
  2. **Retry with correction prompt**: if auto-normalize is too liberal, retry the same turn ID with a typed correction prompt that explicitly tells the role to re-emit with `review` type. Bounded retry budget (1 attempt).
  3. **Better blocked-state guidance**: if the substrate refuses to auto-fix, the blocker payload must include the exact CLI recovery command that uses the current command surface — not generic prose. Concretely: `agentxchain accept-turn --turn <turn_id> --checkpoint --normalize-artifact-type=review` (new flag) so the operator never has to touch staging JSON directly.

  **Layer 3 — Schema/contract (durability):** Make artifact-type semantics explicit in the staged result schema and in `.planning/SYSTEM_SPEC.md` / docs:
  - `workspace`: role intentionally changed repo files; `files_changed` MUST be non-empty AND match `git diff` against the accepted-integration ref.
  - `review`: role made zero repo mutations but performed valid governance/review/routing work; `files_changed` MUST be `[]`.
  - `external` (reserved for future): role produced an artifact outside the repo.
  Emit a typed schema-violation event class (`artifact_type_files_changed_mismatch`) so the substrate can hook auto-normalize / retry on the precise error class instead of inferring from prose.

  **Closure criteria (binary):**
  1. A no-edit `product_marketing` launch readiness review with `artifact.type: "review"` and `files_changed: []` accepts cleanly without any operator intervention.
  2. A staged result with `artifact.type: "workspace"` + `files_changed: []` either auto-normalizes to `review` (Layer 2 path 1), retries with a correction prompt (Layer 2 path 2), OR fails with a CLI recovery command — but NEVER requires `jq` mutation of staging JSON.
  3. The same no-edit invariant is regression-tested for `product_marketing`, `qa`, AND `pm` (Rule #12 child-process tests under `cli/test/beta-tester-scenarios/bug-78-no-edit-review-artifact-type.test.js`). Three role assertions minimum.
  4. Per Rule #13: positive-case test (no-edit review with correct `review` type → must accept cleanly) AND negative-case test (`workspace` type + empty files_changed → must auto-normalize OR fail with CLI recovery, never require staging JSON edit).
  5. Patch release ships with all three layers (or a documented decision recording why a layer was deferred).
  6. Tester quote-back required against the published patch on real `tusq.dev` workspace — re-run the same `pm → dev → qa → product_marketing` flow and confirm the launch readiness review accepts without manual recovery.

  **Cross-cutting discipline:**
  - This is structurally similar to the BUG-72 acceptance-order class: validation correctly rejects bad output, but the recovery path doesn't match Full Auto Mode's "the system fixes itself or surfaces a one-command CLI recovery." Re-audit other validator rejection paths in `cli/src/lib/governed-state.js` / `acceptTurn()` for the same pattern: does the rejection produce a hand-editable manual recovery, or a typed CLI-recoverable blocker?
  - Layer 1 (prompt) and Layer 3 (schema) are the durable fixes; Layer 2 (auto-normalize/retry) is the substrate-side safety net. Ship all three. Do not let agents declare BUG-78 closed by shipping prompt-only fixes — Full Auto Mode demands the safety net.
  - Per Rule #5 ("don't broadcast limitations publicly"): release notes should describe the fix as artifact-type recovery hardening, not as "we used to require manual JSON surgery."

- [x] **🚨 BUG-79: PM turn emits `objections[]` entries with `summary` and `detail` fields but missing the required `statement` field; AgentXchain correctly rejects with `Validation failed at stage schema: objections[0].statement must be a non-empty string.`, but the continuous loop pauses and requires manual `jq` mutation of `.agentxchain/staging/<turn>/turn-result.json` to recover.** Reproduced by tusq.dev beta tester on shipped `agentxchain@2.155.26`. Same bug class as BUG-78 — validation works, recovery path is the defect. **🚨 BUG-78 + BUG-79 together prove this is a meta-class, not two point defects. Fix it as a class.** Closed 2026-04-26 in `agentxchain@2.155.30`: generalized staged-result normalizer auto-normalizes objection `summary`/`detail` → `statement`; PM turn accepted cleanly on same-session tusq.dev reverify. Evidence: `.planning/dogfood-100-turn-evidence/bug-79-reverify-v2.155.30.md`. Closure line: reproduces-on-tester-sequence: NO.

  **Tester's full evidence file (read this first):** `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/AGENTXCHAIN_ISSUE_PM_OBJECTION_SCHEMA_SUMMARY_DETAIL.md`

  **Reproduction environment:**
  - Project: `tusq.dev`
  - Workspace: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev`
  - Branch: `main`
  - Shipped package: `agentxchain@2.155.26`
  - Runtime: `local_cli`, role: `pm`, model: `claude-opus-4-7`
  - Run: `run_42732dba3268a739`, Turn: `turn_1e0689ffd021d2d5`, Session: `cont-dadd9a11`
  - Vision-derived objective: *"The Promise: a self-hostable runtime and MCP server"*
  - Run was the NEXT continuous run after the BUG-78 manual recovery completed — back-to-back staging-schema failures in the same dogfood session.

  **Observed staged objections (from `.agentxchain/staging/turn_1e0689ffd021d2d5/turn-result.json`):**
  ```json
  "objections": [
    {
      "id": "OBJ-001",
      "severity": "medium",
      "summary": "Form decision (A/B/C) for the static-MCP-descriptor command is unresolved",
      "detail": "PM has explicitly NOT pre-committed to form (A) new noun `mcp`, form (B) `serve --export` flag, or form (C) subcommand under a future `plan` hub..."
    },
    {
      "id": "OBJ-002",
      "severity": "low",
      "summary": "Two unbound vision-derived charters now coexist in the candidate backlog",
      "detail": ".planning/ROADMAP_NEXT_CANDIDATES.md now contains two operator-decision-pending vision-derived charter sketches..."
    }
  ]
  ```
  The objection content is substantively useful — both objections are well-reasoned and capture real planning state. Only the field shape is wrong: missing `statement`.

  **Observed acceptance error:**
  ```text
  acceptTurn(pm): Validation failed at stage schema: objections[0].statement must be a non-empty string.; objections[1].statement must be a non-empty string.
  ```

  **PM did real work in this turn (this is NOT a no-op):** `git diff --stat` confirmed `.planning/PM_SIGNOFF.md` (+36), `.planning/ROADMAP.md` (+10), `.planning/SYSTEM_SPEC.md` (+2), `.planning/command-surface.md` (+12) — 4 files / 60 insertions. PM also materialized a candidate charter for "Static MCP Server Descriptor Export" in `.planning/ROADMAP_NEXT_CANDIDATES.md`. This is the expected PM-idle-expansion materialization shape from the BUG-72/73/75 lineage. The product work is correct; only the objection schema is broken.

  **Manual recovery the operator was forced to perform:**
  ```sh
  jq '.objections |= map(
    if ((.statement // "") == "") then
      . + {statement: (.summary // .detail // "Objection recorded without statement")}
    else
      .
    end
  )' .agentxchain/staging/turn_1e0689ffd021d2d5/turn-result.json > /tmp/turn-result.json \
    && mv /tmp/turn-result.json .agentxchain/staging/turn_1e0689ffd021d2d5/turn-result.json
  npx --yes -p agentxchain@2.155.26 -c 'agentxchain accept-turn --turn turn_1e0689ffd021d2d5 --checkpoint'
  ```
  The recovery is mechanical: `statement = summary || detail` with a fallback. This is exactly the kind of normalization the substrate could do automatically.

  **🚨 Why this MUST be fixed as a class with BUG-78, not in isolation:**

  Both bugs share the same architectural shape:
  | Dimension | BUG-78 | BUG-79 |
  |-----------|--------|--------|
  | Validation correctness | ✅ Correctly rejects bad output | ✅ Correctly rejects bad output |
  | Role | `product_marketing` | `pm` |
  | Field violation | `artifact.type` ↔ `files_changed` | `objections[].statement` |
  | Recovery shape | `jq` mutation of staging JSON | `jq` mutation of staging JSON |
  | Manual fix | `artifact.type = "review"` | `statement = summary` |
  | Continuous-mode impact | Pauses indefinitely | Pauses indefinitely |
  | Tester effort | Read source, find staging path, write `jq`, run accept-turn | Read source, find staging path, write `jq`, run accept-turn |

  **Two instances of the same class within the same dogfood session is enough signal.** Shipping point fixes for `artifact.type` and `objections.statement` separately means the THIRD instance is already in the codebase waiting to surface. The architectural fix is a generalized staged-result normalization + retry + CLI-recovery layer that covers ANY field-shape rejection class.

  **Required fix — generalized class fix, not point fixes:**

  **Layer 1 — Audit and prompt-harden ALL role prompts for staged-result schema invariants.** Read `cli/src/lib/governed-state.js` `acceptTurn()` and every staging schema validator. For each enforced invariant, add explicit instruction text to the corresponding role prompt(s). Surfaces: `.agentxchain/prompts/*.md`, `cli/src/templates/governed/*.json`, `cli/src/lib/dispatch-bundle.js` injection. Concrete additions for BUG-79: every objection MUST include non-empty `statement`; do not use `summary` as a substitute. Concrete additions for BUG-78: see BUG-78 entry above. **Per the audit, ANY validator-enforced field invariant that isn't also stated in role prompts is a latent BUG-78/79 class member — fix them all at once.**

  **Layer 2 — Generalized staged-result normalization layer in `acceptTurn()`.** Before final schema validation, run a normalization pass that handles the known recoverable mismatches:
  1. `objections[].summary` or `objections[].detail` present + missing `statement` → set `statement` = `summary || detail`
  2. `artifact.type === "workspace"` + empty `files_changed` + clean `git diff` → normalize to `artifact.type: "review"`
  3. Future field-shape mismatches: add to the normalizer table
  Each normalization emits a typed event (`staged_result_auto_normalized` with `field`, `original_value`, `normalized_value`, `rationale`) so audit trail is preserved. **The normalizer is a deny-list of known-safe fixes, not a schema-permissive validator.** Any unknown mismatch still fails fast.

  **Layer 3 — Bounded retry with correction prompt.** If normalization is too aggressive for a given mismatch class, fall back to ONE retry of the same turn ID with a typed correction prompt:
  ```text
  Your previous result failed schema validation: <exact_violations>.
  Re-emit the same content with: <exact_field_repair_instruction>.
  ```
  Bounded 1 retry per turn. If still invalid, fail to Layer 4.

  **Layer 4 — CLI-recoverable blocked state.** When auto-normalize and retry both fail, the blocker payload MUST include the exact CLI command that resolves it. Concretely, NEW flag: `agentxchain accept-turn --turn <turn_id> --checkpoint --normalize-staged-result` that runs the substrate's normalization layer on the staged result before acceptance. Operator never touches `jq` or staging JSON paths.

  **Closure criteria (binary):**
  1. PM (and QA, product_marketing) turns that emit `objections[]` with `summary`/`detail` but missing `statement` accept cleanly via Layer 2 auto-normalization. Audit trail event `staged_result_auto_normalized` is emitted.
  2. **BUG-78's `artifact.type` mismatch is ALSO covered by the same normalization layer** — single architectural fix, not two parallel fixes.
  3. The full validator-invariant audit (Layer 1) is committed to the repo as `.planning/STAGED_RESULT_INVARIANT_AUDIT.md` with a full table of enforced invariants × role prompts that mention them.
  4. Regression tests under `cli/test/beta-tester-scenarios/bug-79-objection-statement-normalization.test.js` (Rule #12 child-process tests) cover at minimum: (a) PM emits `summary`-only objection → normalized to `statement`, accepted; (b) PM emits `detail`-only objection → normalized; (c) PM emits both `summary` and `detail` → normalized using `summary` (preferred); (d) PM emits valid `statement` directly → no normalization, accepted; (e) PM emits objection with neither `statement` nor `summary` nor `detail` → fail-fast with CLI recovery command. Same coverage required for QA and product_marketing roles since the spec applies to all three.
  5. Per Rule #13: positive-case tests (correctly-shaped objection accepts cleanly) AND negative-case tests (no recoverable field present → fail-fast with typed recovery command).
  6. Patch release ships covering BUG-78 + BUG-79 together (single architectural fix, not two patches).
  7. Tester quote-back required against the published patch on real `tusq.dev` workspace — re-run the same vision-derived dogfood and confirm both no-edit reviews and PM objection emissions accept without manual recovery.

  **Cross-cutting discipline:**
  - **Closest-guard / meta-bug-class explicit naming:** BUG-78 + BUG-79 together establish the `staged_result_field_shape_mismatch_requires_manual_recovery` defect class. Future bugs in this class should NOT get new BUG-numbers — they should attach as new normalization-table entries to the BUG-79 fix vehicle. The class is closed when the audit (Layer 1 closure criterion 3) confirms every enforced staged-result invariant is either (a) prompt-stated, (b) in the normalization table, OR (c) explicitly justified as fail-fast-only with CLI recovery in the audit document.
  - **Rule-12-as-class-fix:** BUG-78 and BUG-79 BOTH have the same operator command-chain shape (read source → find staging path → write jq → accept-turn). The Rule #12 child-process test for BUG-79 should be written to mirror the operator's exact recovery sequence, AND should be parameterized over both the BUG-78 case and the BUG-79 case to prove the Layer 4 CLI recovery covers both classes with one flag.
  - **Stop-polishing-floor preempt:** do NOT let agents declare BUG-79 closed by adding `statement` field to the PM prompt and shipping. The whole point of filing this as a meta-class is to prevent the THIRD instance. Layer 2 (normalization layer) is the load-bearing fix; Layers 1, 3, 4 are defense-in-depth. All four are required for closure.
  - **Per Rule #5 ("don't broadcast limitations publicly"):** release notes should describe the fix as staged-result acceptance hardening, not as "we used to require manual JSON surgery for two different field shapes."
  - **Sequencing relative to BUG-76/77 fixes:** BUG-76/77 are already implemented locally and shipping in v2.155.27. BUG-78 + BUG-79 should ship as v2.155.28 (or .29 if .28 is needed for an unrelated BUG-76/77 hotfix). Do NOT bundle BUG-78/79 into the BUG-76/77 release — they're orthogonal architectural changes and bundling them creates shared-blame on regression.

- [x] **🚨 BUG-80: roadmap-derived acceptance contracts contain literal implementation text that PM planning turns cannot satisfy; "Evidence source:" metadata item is never addressable by any turn; intent coverage checker rejects valid PM planning work with `intent_coverage_incomplete`.** Discovered during DOGFOOD-100-TURNS Run 2 on shipped `agentxchain@2.155.30` at 2026-04-26. Session `cont-dadd9a11` paused on this blocker. Closed 2026-04-26 in `agentxchain@2.155.31`: `evaluateRoadmapDerivedConditionalCoverage()` auto-addresses `Evidence source:` metadata and uses milestone-mention matching for PM planning turns; same-session tusq.dev reverify passed. Evidence: `.planning/dogfood-100-turn-evidence/bug-80-reverify-v2.155.31.md`. Closure line: reproduces-on-tester-sequence: NO.

  **Reproduction environment:**
  - Project: `tusq.dev`
  - Workspace: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev`
  - Shipped package: `agentxchain@2.155.30`
  - Session: `cont-dadd9a11`, Run: `run_d69cb0392607d170`
  - Roadmap-derived milestone: M28 (Static Sensitivity Class Inference from Manifest Evidence)

  **Observed acceptance error:**
  ```text
  acceptTurn(pm): Intent coverage incomplete: 2 acceptance item(s) not addressed:
  Unchecked roadmap item completed: Add `classifySensitivity(capability)` pure deterministic function in `src/cli.js` implementing the frozen six-rule first-match-wins decision table: R1 preserve→restricted, R2 admin/destructive verb or admin-namespaced route→restricted, R3 pii_categories non-empty→confidential, R4 write verb + financial-context route/param→confidential, R5 auth_required or narrow write→internal, R6 default→public;
  Evidence source: .planning/ROADMAP.md:299
  ```

  **Root cause — two distinct defects in the acceptance contract pipeline:**

  1. **`continuous-run.js:697-701`** — `acceptance_contract` includes `Unchecked roadmap item completed: ${candidate.goal}` where `candidate.goal` is the FULL literal implementation text from `ROADMAP.md` checklist items. PM in planning phase produces charter/scoping artifacts, not implementation code. The semantic keyword overlap (≥50% at `governed-state.js:6978-6986`) between PM's planning output and implementation-specific text like "classifySensitivity(capability) pure deterministic function" is below threshold.

  2. **`continuous-run.js:700`** — `Evidence source: ${candidate.roadmap_path}:${candidate.line}` is metadata provenance, not a deliverable. No turn of ANY role can "address" this item via structural `intent_response` or semantic corpus matching. It always fails coverage.

  **Why existing evaluation hooks don't cover this:**
  - `evaluateAcceptanceItemLifecycle()` — checks phase-exit and gate-state satisfaction. No gate references in roadmap-derived items, so returns `null`.
  - `evaluateIdleExpansionConditionalCoverage()` — only fires for `source === 'vision_idle_expansion'`. Roadmap-derived intents have different source.
  - Semantic fallback (50% keyword overlap) — fails for implementation-specific vocabulary against PM planning output.

  **Required fix — `evaluateRoadmapDerivedConditionalCoverage()` function (follows existing idle-expansion pattern):**

  Add to `governed-state.js` a new conditional coverage function that:
  1. Detects roadmap-derived intents via `intakeContext.charter` starting with `[roadmap]`
  2. Auto-addresses `Evidence source:` items (metadata provenance, not deliverables)
  3. For `Unchecked roadmap item completed:` items in planning phase, checks milestone section mention (e.g., "M28" appears in turn result corpus) instead of requiring full keyword overlap with implementation text
  4. In implementation/qa/launch phases, falls through to normal semantic matching so dev turns are still evaluated against actual implementation keywords

  Hook into `evaluateIntentCoverage()` at `governed-state.js:6964`, after the idle-expansion check.

  **Closure criteria (binary):**
  1. PM turn in planning phase on a roadmap-derived intent (M28) that mentions the milestone in its summary/decisions accepts cleanly. No `intent_coverage_incomplete` error.
  2. "Evidence source:" metadata items never cause intent coverage failures.
  3. Dev turns in implementation phase are still evaluated against full implementation keywords (no regression on strictness).
  4. Regression test under `cli/test/beta-tester-scenarios/bug-80-roadmap-derived-intent-coverage.test.js`.
  5. Re-verified on same dogfood session `cont-dadd9a11` after patch ships.

- [x] **🚨 BUG-81: PM turn requests phase transition but gate-required planning artifacts not modified; framework blocks continuous loop instead of auto-stripping the transition request and preserving partial planning work.** Discovered during DOGFOOD-100-TURNS Run 3 on shipped `agentxchain@2.155.31` at 2026-04-26. Closed 2026-04-26 in `agentxchain@2.155.32`: auto-strips `phase_transition_request` when gate-required files aren't modified, accepts partial planning work, keeps run in phase; same-session tusq.dev reverify passed. Evidence: `.planning/dogfood-100-turn-evidence/bug-81-reverify-v2.155.32.md`. Closure line: reproduces-on-tester-sequence: NO.

  **Reproduction:** Session `cont-e958afb2`, Run 3 (`run_*` for M29), PM turn `turn_df1112d797428a6b`. PM produced planning work for M29 but didn't modify `PM_SIGNOFF.md`, `SYSTEM_SPEC.md`, `command-surface.md`. Gate `planning_signoff` rejected.

  **Observed error:**
  ```text
  acceptTurn(pm): Gate "planning_signoff" is failing on .planning/PM_SIGNOFF.md, .planning/SYSTEM_SPEC.md, .planning/command-surface.md. Your turn did not modify those files. Either edit the file(s) to satisfy the gate, or remove the phase transition request.
  ```

  **Secondary issue:** `Governance report failed: Invalid string length` — report generation hit Node.js string size limit. Separate from gate failure but discovered in same run.

  **Root cause:** `governed-state.js:4703-4727` — when gate semantic coverage fails in strict mode, the framework permanently transitions to `failed_acceptance` and blocks the continuous loop. The error message itself identifies the fix ("remove the phase transition request") but the framework doesn't auto-apply it.

  **Fix:** Auto-strip `phase_transition_request` when gate-required files aren't modified. PM's partial planning work is accepted, the phase stays in "planning", and the continuous loop re-dispatches PM to complete gate artifacts. Emit `gate_transition_request_auto_stripped` event for audit trail.

  **Closure criteria:**
  1. PM turn that doesn't modify gate-required files but requests a transition → transition auto-stripped, turn accepted, phase stays in planning.
  2. Continuous loop re-dispatches PM after the stripped turn.
  3. `gate_transition_request_auto_stripped` event emitted with gate_id, uncovered_files, and rationale.
  4. Re-verified on same dogfood session after patch ships.

- [x] **🚨 BUG-82: Dev turn proposes routing-illegal `proposed_next_role` after BUG-81's gate auto-strip keeps session in planning phase; protocol validation hard-errors instead of auto-normalizing.** Discovered during DOGFOOD-100-TURNS Run 3 on shipped `agentxchain@2.155.32` at 2026-04-26. Cascading issue from BUG-81 fix. Closed 2026-04-26 in `agentxchain@2.155.33`: auto-normalizes routing-illegal `proposed_next_role` for all roles (not just review-only); same-session tusq.dev reverify passed. Evidence: `.planning/dogfood-100-turn-evidence/bug-82-reverify-v2.155.33.md`. Closure line: reproduces-on-tester-sequence: NO.

  **Reproduction:** Session `cont-e958afb2`, Run 3 (M29). BUG-81's fix auto-stripped PM's phase transition → phase stays in "planning". Dev dispatched in planning phase, proposes `proposed_next_role: "qa"`. Protocol validation at `turn-result-validator.js:880-887` rejects: `proposed_next_role "qa" is not in the allowed_next_roles for phase "planning": [pm, dev, product_marketing, eng_director, human]`.

  **Root cause:** `turn-result-validator.js` Rule 6 (lines 1261-1276) only auto-normalizes routing-illegal `proposed_next_role` for `isReviewOnly` roles. Authoritative roles (dev) were excluded because invalid routing was previously always a real misconfiguration. After BUG-81's gate auto-strip, the framework itself creates the routing mismatch by keeping the session in an earlier phase than the agent expects.

  **Fix:** Added a third `else if` branch to Rule 6 that handles non-review-only roles. When an authoritative role proposes a `proposed_next_role` not in the current phase's `allowed_next_roles`, auto-normalize to `pickAllowedRoleFallback()` (first allowed role that isn't the assigned role). Emit `staged_result_auto_normalized` event with `routing_illegal_for_phase_<phase>` rationale. Template placeholders (`/^<[^>]+>$/`) are excluded from normalization to preserve schema validation.

  **Closure criteria:**
  1. Dev turn proposing "qa" in planning phase → auto-normalized to routing-legal role, turn accepted.
  2. Normalization warning emitted in validation output.
  3. `staged_result_auto_normalized` event emitted with `proposed_next_role` field and `routing_illegal_for_phase_planning` rationale.
  4. Re-verified on same dogfood session after patch ships.

- [x] **BUG-83 (UX): Non-progress recovery message references non-existent `--acknowledge-non-progress` flag.** Discovered during DOGFOOD-100-TURNS Run 3 on shipped `agentxchain@2.155.33` at 2026-04-26. Closed 2026-04-26 in `agentxchain@2.155.35`: the non-progress recovery action now says `agentxchain resume`, and the BUG-38 non-progress regression suite asserts the invalid flag is absent. Published-package artifact inspection confirmed `contains_valid_action=true` and `contains_invalid_flag=false`; evidence path: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/dogfood-100-turn-evidence/bug-83-reverify-v2.155.35.md`. Closure line: reproduces-on-tester-sequence: NO.

- [x] **🚨 BUG-85: VISION-derived roadmap replenishment creates a single acceptance item containing ALL VISION section headings; PM turns cannot satisfy `intent_coverage` for this overly broad item.** Discovered during DOGFOOD-100-TURNS Run 4 on shipped `agentxchain@2.155.33` at 2026-04-26. Closed 2026-04-26 in `agentxchain@2.155.34`: roadmap-replenishment generation now scopes future acceptance to one concrete VISION-backed milestone instead of the full unplanned heading backlog, and legacy broad `Milestone scope derived from VISION.md sections:` items are accepted only when the PM turn cites `VISION.md` plus at least one listed section. Same-session tusq.dev reverify passed for continuous session `cont-d14a3272`, run `run_24ccd92f593d8647`, turn `turn_33f4e15b33cf141c`, checkpoint `dacdfa1033c2071d6386fbd9db528115ac8fa3a2`; evidence path: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/dogfood-100-turn-evidence/bug-85-reverify-v2.155.34.md`. Closure line: reproduces-on-tester-sequence: NO.

- [ ] **BUG-84: Governance report fails with "Invalid string length".** Discovered during DOGFOOD-100-TURNS Run 3 at 2026-04-26. Report generation hits Node.js string size limit. Appears after multiple consecutive turns with large dispatch bundles. Non-blocking — turns continue to accept, only the report generation fails.

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
