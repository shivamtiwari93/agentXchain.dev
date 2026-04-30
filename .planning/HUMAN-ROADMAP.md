# Human Roadmap — AgentXchain

Human-prioritized work for the agents.

Rules:
- Agents should read this file before acting.
- Unchecked items here take priority over general exploration in `AGENT-TALK.md`.
- When an item is complete, agents should mark it complete and briefly record what changed.
- If an item is too large, agents should split it into smaller checklist items and work them down in order.
- Only move an item back to `HUMAN_TASKS.md` if it truly requires operator-only action.

Current focus: **🚨🚨🚨 STOP ALL FEATURE WORK. DOGFOOD-100-TURNS-CLEAN-FULL-AUTO IS THE ONLY PRIORITY. 🚨🚨🚨** Agents must use the shipped agentxchain CLI framework ONLY to drive tusq.dev development for at least **100 consecutive full-auto turns** without human intervention, manual staging-JSON edits, jq recovery surgery, or operator-side workarounds. Every issue discovered during dogfood must follow the six-step loop: discovered through dogfood failure, triaged into a BUG entry, fixed in the substrate, shipped as a patch release, reverified by resuming the dogfood state on the shipped package, and closed. **BUG-107 is closed on agentxchain@2.155.64 because shipped-package reverify preserved `cont-7dc5b5df` and reached natural QA dispatch; BUG-109 is closed on agentxchain@2.155.64 because shipped full-auto auto-checkpoint recovered supplemental accepted-turn dirt and reached QA; BUG-110 is closed on agentxchain@2.155.65 for fresh Claude auth dispatch blockers; BUG-111 is closed on agentxchain@2.155.66 for retained pre-fix Claude auth escalation reclassification; BUG-112 is closed on agentxchain@2.155.67 because shipped-package reverify auto-reissued the retained provider timeout without operator unblock; BUG-113 is closed on agentxchain@2.155.69 because shipped-package reverify recovered the retained Claude Node runtime ghost blocker; BUG-114 is closed on agentxchain@2.155.70 because shipped-package reverify auto-reissued retained auth blocker `turn_aa521bedd41f1655 -> turn_c79ca73263c02085` without operator `step --resume`. DOGFOOD-100 is now paused on an operator-only Anthropic credential validity blocker: the reissued Claude process reported `apiKeySource: "ANTHROPIC_API_KEY"` and failed with provider 401, and a direct Claude smoke check with the same loaded environment also failed 401. BUG-78 remains open for natural no-edit review reverification.** **BUG-95 through BUG-114 are closed with shipped-package evidence except BUG-78, which remains open only for natural no-edit review proof.** v2.155.60 created live strict session `cont-7dc5b5df`, reached counter value 89, then discovered BUG-107; v2.155.61 preserved and recovered that session but discovered BUG-108 before QA dispatch; v2.155.62 closed BUG-108 and exposed BUG-109; v2.155.64 closed BUG-109 and reached natural QA dispatch; v2.155.65 fixed fresh Claude auth classification; v2.155.66 reclassified the retained auth escalation to `dispatch:claude_auth_failed`; v2.155.66 then progressed the session to counter value 97 before BUG-112 surfaced on QA turn `turn_aa9664d36f8cac23`; v2.155.67 closed BUG-112 and exposed BUG-113 on retained QA turn `turn_07b1ca892daef9dc`; v2.155.69 closed BUG-113 and exposed BUG-114 on retained QA turn `turn_aa521bedd41f1655`; v2.155.70 closed BUG-114 and exposed a real credential-validity blocker outside framework control. Until final 100-turn evidence exists, do NOT pick up watch-mode extensions, conformant-runner examples, comparison-page work, connector adoption proofs, website polish, or release-process improvements unrelated to dogfood-discovered bugs. This is the substrate-credibility gate for the whole project. If the framework cannot drive its own beta tester product through 100 clean turns, none of the other adoption surfaces matter. **Prior queue closures remain archived in .planning/HUMAN-ROADMAP-ARCHIVE.md.**

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

  **🚨 STRICT-CRITERIA RESET 2026-04-26T22:00Z (operator override, durable — see AGENT-TALK.md operator override block):** the first DOGFOOD-100-TURNS attempt produced ~30 informal "clean" turns across multiple sessions during the BUG-80 through BUG-89 substrate-shakeout phase. **Those turns are NOT counted toward the formal 100.** They're archived as substrate-hardening evidence but do NOT contribute to the proof point. The 100-clean-turn count starts FRESH from `agentxchain@2.155.43` on the currently active session (`run_e40832d436a42d75` per the AGENT-TALK record) under STRICT criteria. Counter advancement protocol is now mandatory and load-bearing — `turn-counter.jsonl` IS the proof; aggregated AGENT-TALK summaries do NOT substitute. **A turn counts toward the 100 ONLY if ALL EIGHT strict criteria below hold. Any criterion violated resets the counter to 0.** No partial credit. No generous interpretation. The agents earned the right to attempt the strict run through the substrate hardening; now they must actually execute it under strict reading.

  **The eight strict criteria (every accepted turn must satisfy ALL):**
  1. **Single unbroken session.** Counter resets to 0 if the session ID changes for any reason — operator restart, agent-driven restart, hung-loop recovery. The session must be one continuous `agentxchain run --continuous` invocation.
  2. **No human escalation surfaced.** `state.blocked_on` must NOT transition to `needs_human` / `needs_decision` requiring `agentxchain unblock` from anyone, including the agents themselves.
  3. **No manual staging JSON edit.** Zero `jq` operations on `.agentxchain/staging/<turn>/turn-result.json`. The substrate's normalizer layer (BUG-79 architectural class fix, extended through BUG-89) is the recovery path; if it doesn't auto-normalize, file a new BUG instead of hand-editing.
  4. **No operator-side `accept-turn` recovery.** Every accepted turn flows through the continuous loop's own acceptance path. If an operator runs `agentxchain accept-turn` to recover a stuck turn, that recovery does NOT count and resets the counter.
  5. **No manual gate advancement.** No `gate.status = 'passed'` mutations from outside the governed flow. If `planning_signoff` won't pass on its own, that's a BUG, not justification for hand-passing the gate.
  6. **No cross-repo workarounds on tusq.dev.** No config tweaks, no chore commits to tusq.dev to make the dogfood pass. If tusq.dev itself has a defect blocking the dogfood, the agents file a tusq.dev product BUG and let the next governed dev turn pick it up via the framework — they do NOT reach in from the agentxchain side.
  7. **`turn-counter.jsonl` maintained rigorously.** One JSONL line per countable turn, written within 30 minutes of turn acceptance, with shape: `{"turn_id":"turn_<id>","role":"<role>","timestamp":"<ISO8601>","agentxchain_version":"<version>","session_id":"<session_id>","run_id":"<run_id>","counter_value":<integer>}`. Counter values strictly monotonic within a session. If the formal counter falls more than 5 turns behind the empirical count, agents pause to reconcile before resuming.
  8. **Full-auto only.** `--triage-approval auto` for the entire session. No mid-session switch to manual approval mode.

  **The next accepted turn is counter_value = 1.** Write the JSONL line immediately on acceptance, BEFORE logging the turn in AGENT-TALK. Counter advancement is load-bearing; AGENT-TALK summaries are secondary. The substrate-hardening loop already proved itself across BUG-80 through BUG-89; now the formal proof point requires honest counting.

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

  **Currently open BUG-78 remains part of this directive's discovery output, not a separate work stream.** BUG-78 remains open for natural reverification while DOGFOOD-100 continues. BUG-107, BUG-108, BUG-109, BUG-110, BUG-111, BUG-112, BUG-113, and BUG-114 are closed with shipped-package evidence. DOGFOOD-100 is paused after counter value 97 on operator-only Anthropic credential refresh: `agentxchain@2.155.70` auto-reissued the retained auth blocker, then the fresh Claude process and direct smoke check both failed with provider 401 using the loaded `ANTHROPIC_API_KEY`.

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

- [x] **🚨 BUG-77: continuous mode does not dispatch PM in "derive next roadmap increment" mode when `.planning/ROADMAP.md` is exhausted but `.planning/VISION.md` still contains unplanned V2/V3 scope.** Closed 2026-04-28 in `agentxchain@2.155.59`: after completing `run_6e53e7b50cd2c457`, continuous session `cont-9a2697e7` emitted `session_continuation` event `evt_dbd80f33f434ecb7`, started roadmap-replenishment run `run_c39bd102a520411b` from `vision_scan`, dispatched PM `turn_400dc74e4496c4df`, and accepted it at `2026-04-28T09:27:56.747Z` with checkpoint `b76d94452855c0316474360de1ee97dbc1f48cbe`. Evidence: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/dogfood-100-turn-evidence/bug-77-reverify-v2.155.59.md`. Counter note: this PM turn is valid BUG-77 closure evidence but is not counted toward DOGFOOD-100 because graceful SIGINT had already been sent to stop the invocation after the prior clean run completed. Reported by tusq.dev beta tester originally on `agentxchain@2.154.7` (2026-04-22) and resurfaced as the related-but-distinct shape in the 2026-04-26 message. **This is the older/related failure shape — same root class as BUG-76 but distinct trigger condition.**

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

- [x] **BUG-84: Governance report fails with "Invalid string length".** Discovered during DOGFOOD-100-TURNS Run 3 at 2026-04-26. Report generation hits Node.js string size limit. Appears after multiple consecutive turns with large dispatch bundles. Non-blocking — turns continue to accept, only the report generation fails. Closed 2026-04-26 in `agentxchain@2.155.36`: adds `boundedSlice()` with `MAX_REPORT_SECTION_ITEMS=500` cap on all section arrays across all three formatters (text, markdown, HTML), replaces `+=` string concat with `push()+join()` in HTML formatter, removes pretty-print indent from export JSON, separates try/catch for export write vs report generation. Evidence: `node --test --test-timeout=120000 cli/test/beta-tester-scenarios/bug-84-report-string-overflow.test.js` -> 9 tests / 2 suites / 0 failures; full suite: 7231 tests / 0 failures. Spec: `.planning/BUG_84_GOVERNANCE_REPORT_INVALID_STRING_LENGTH_SPEC.md`. Closure line: reproduces-on-tester-sequence: NO (report generation is non-blocking; crash only occurs with 500+ turns which exceeds regression test fixture scope).

- [x] **BUG-86: Governance report generation accepts BUG-84's bounded export but then rejects it as an invalid artifact because `content_base64` is `null` for truncated/skipped large files.** Discovered during DOGFOOD-100-TURNS resume on shipped `agentxchain@2.155.36` at 2026-04-26. Closed 2026-04-26 in `agentxchain@2.155.37`: export verification now accepts `content_base64: null` only when paired with explicit bounded-export metadata (`truncated: true` or `content_base64_skipped: true`), validates bounded metadata shape, preserves strict byte/hash verification for full entries, and the shipped package renders the same tusq.dev bounded export with `Verification: pass`. Same-session tusq.dev reverify evidence: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/dogfood-100-turn-evidence/bug-86-reverify-v2.155.37.md`. Closure line: reproduces-on-tester-sequence: NO.

  **Original failure:** This was a BUG-84 follow-on: the report no longer crashed with `Invalid string length`, but the generated report said `Cannot build governance report from invalid export artifact` with errors such as `.agentxchain/events.jsonl: content_base64 must be a string`, `.agentxchain/dispatch/turns/.../stdout.log: content_base64 must be a string`, and prior `.agentxchain/reports/export-run_*.json: content_base64 must be a string`. The exporter intentionally emits `content_base64: null` when `maxJsonlEntries` truncates JSONL or `maxBase64Bytes` skips large raw bytes, so the verifier/report path had to understand the bounded-export contract instead of invalidating its own export.

  **Dogfood evidence:**
  - Project: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev`
  - Command: `npx --yes -p agentxchain@latest -c 'agentxchain run --continuous --vision .planning/VISION.md --max-runs 100 --max-idle-cycles 3 --poll-seconds 5 --triage-approval auto --auto-checkpoint'`
  - Shipped package: `agentxchain@2.155.36`
  - Report artifact: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.agentxchain/reports/report-run_24ccd92f593d8647.md`
  - Observed report error: `Cannot build governance report from invalid export artifact` and multiple `content_base64 must be a string` verifier failures.

  **Required fix:**
  1. Update `export-verifier.js` so `content_base64: null` is valid only when paired with `truncated: true` or `content_base64_skipped: true`.
  2. Keep full byte/hash/data verification for normal entries with string `content_base64`.
  3. Validate bounded-entry metadata shape: truncated entries must be JSONL with coherent `total_entries`, `retained_entries`, and array `data`; skipped text/JSONL entries must retain format-appropriate parsed `data`.
  4. Add a command-chain regression that builds a bounded export and proves `agentxchain report --input <export> --format markdown` exits 0.
  5. Re-verify by generating a governance report on the same tusq.dev run after the patch ships.

  **Closure criteria:**
  1. `cli/test/beta-tester-scenarios/bug-86-bounded-export-report-verifier.test.js` passes.
  2. BUG-67 and BUG-84 report tests still pass.
  3. Published `agentxchain@2.155.37+` can report on a bounded export without `content_base64 must be a string`.
  4. Same-session tusq.dev evidence file is added under `.planning/dogfood-100-turn-evidence/bug-86-reverify-vX.Y.Z.md`.

- [x] **BUG-87: Authoritative dev acceptance blocks on unclassified deterministic CLI output `.tusq/plan.json` produced by verification, even though the turn declared verification commands and product files correctly otherwise.** Closed 2026-04-26 in `agentxchain@2.155.38`: framework auto-normalizes undeclared verification-produced dirty files as `disposition: "ignore"`, cleans them up via `cleanupIgnoredVerificationFiles()`, emits `verification_output_auto_normalized` audit event, and filters auto-classified files from observation before `compareDeclaredVsObserved`. BUG-55 tests updated to reflect auto-normalization superseding hard-reject. Spec: `.planning/BUG_87_UNDECLARED_VERIFICATION_OUTPUT_AUTO_NORMALIZE_SPEC.md`. Evidence: `npm test -- --test-timeout=60000` -> 7242 tests / 1466 suites / 0 failures / 5 skipped. Tusq.dev reverify: dev turn `turn_73dc44cfb9cef2c7` accepted cleanly on `agentxchain@2.155.38` with `verification_output_auto_normalized` audit event; evidence: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/dogfood-100-turn-evidence/bug-87-reverify-v2.155.38.md`. Closure line: reproduces-on-tester-sequence: NO. Discovered during DOGFOOD-100 resume on shipped `agentxchain@2.155.37` at 2026-04-26 after BUG-86 reverify. Continuous run accepted four post-restart turns, then blocked on dev turn `turn_73dc44cfb9cef2c7` in run `run_24ccd92f593d8647` with: `Verification was declared (commands or machine_evidence), but these files are dirty and not classified: .tusq/plan.json. Classify each under verification.produced_files ... OR add it to files_changed`. The staged turn result declares `files_changed` for `src/cli.js`, `tests/smoke.mjs`, `tests/evals/governed-cli-scenarios.json`, `tests/eval-regression.mjs`, and `.planning/IMPLEMENTATION_NOTES.md`; it declares `npm test`, `node bin/tusq.js help`, `node bin/tusq.js surface plan --help`, and `git diff HEAD --stat -- package.json package-lock.json` as machine evidence, but it does not declare `.tusq/plan.json` as a verification-produced ignored output.

  **Dogfood evidence:**
  - Project: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev`
  - Branch used during reverify/resume: `agentxchain-dogfood-100-turn-2026-04`
  - Command: `npx --yes -p agentxchain@latest -c 'agentxchain run --continuous --vision .planning/VISION.md --max-runs 100 --max-idle-cycles 3 --poll-seconds 5 --triage-approval auto --auto-checkpoint'`
  - Shipped package: `agentxchain@2.155.37`
  - Failed turn: `turn_73dc44cfb9cef2c7` (`dev`, phase `implementation`)
  - Dirty unclassified path: `.tusq/plan.json`
  - Staged result: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.agentxchain/staging/turn_73dc44cfb9cef2c7/turn-result.json`

  **Why this is a framework bug:** the framework requires classification of verification-produced files, but the prompt/context contract does not make that requirement salient enough for agents that run CLI commands writing deterministic tool output under hidden/tool-owned directories. This is the BUG-55 family recurring under a new generated-output path. The framework should prevent full-auto deadlock by either (a) stronger prompt guidance that names dirty unclassified outputs and shows the exact `verification.produced_files` ignore shape, (b) normalizing known ignored verification-output paths when the declared command surface makes the output deterministic and not a core deliverable, or (c) adding a retry/reissue path that gives the same role the concrete classification error without operator `accept-turn` surgery.

  **Required fix:**
  1. Add a tester-sequence regression using a governed dev turn that writes `.tusq/plan.json` during verification, omits it from `files_changed`, and initially fails with the exact unclassified-output error.
  2. Harden the framework contract so the next full-auto retry can self-correct without manual staged JSON edits or operator `accept-turn`.
  3. Keep false-positive protection: undeclared product/source outputs must still fail; only declared verification-produced ignored artifacts may be excluded.
  4. Re-verify on tusq.dev by resuming the same blocked turn sequence on the shipped patch and proving `.tusq/plan.json` no longer blocks acceptance.

  **Closure criteria:**
  1. New BUG-87 beta-tester scenario passes.
  2. BUG-55 verification-output regression still passes.
  3. Published package accepts or auto-recovers the tusq.dev turn without manual JSON edits.
  4. Same-session tusq.dev evidence exists under `.planning/dogfood-100-turn-evidence/bug-87-reverify-vX.Y.Z.md`.

- [x] **BUG-88: Auto-report export still hits `Invalid string length` on large dogfood state after BUG-84/BUG-86, leaving the report renderer to use a stale bounded export.** Closed 2026-04-26 in `agentxchain@2.155.42`: `buildRunExport()` now excludes generated governance report artifacts (`report-*`, `export-*`, `chain-*`) from run exports and caps large JSON parsed data via `maxJsonDataBytes` across `run`, `export`, `audit`, and `benchmark`; coordinator child exports inherit the same bounds. `v2.155.41` shipped the runtime fix, and `v2.155.42` republished it with corrected immutable release evidence. Spec: `.planning/BUG_88_EXPORT_WRITER_INVALID_STRING_LENGTH_SPEC.md`. Evidence: `bash cli/scripts/verify-post-publish.sh --target-version 2.155.41` -> 7249 tests / 1467 suites / 0 failures / 5 skipped; `agentxchain@2.155.42` release preflight passed full tests, npm pack dry-run, and docs build. Tusq.dev reverify: same dogfood session resumed with `agentxchain@2.155.42`, run `run_24ccd92f593d8647` completed with `Errors: none` and wrote fresh `.agentxchain/reports/export-run_24ccd92f593d8647.json` plus `.agentxchain/reports/report-run_24ccd92f593d8647.md`; next run `run_7894753f9c47c8e3` also completed and wrote fresh export/report pair. Evidence: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/dogfood-100-turn-evidence/bug-88-reverify-v2.155.42.md`. Closure line: reproduces-on-tester-sequence: NO. Discovered during the same DOGFOOD-100 resume on shipped `agentxchain@2.155.37` at 2026-04-26. The run summary printed `Governance export write failed: Invalid string length` while also writing `.agentxchain/reports/report-run_24ccd92f593d8647.md`. The report file shows `Verification: pass`, but its input export timestamp predates the latest accepted turns (`export-run_24ccd92f593d8647.json` timestamp `2026-04-26 07:54:30`, report timestamp `2026-04-26 09:06:01`). That means BUG-86 fixed verifier acceptance of bounded exports, but the exporter can still fail before producing a fresh bounded export for very large accumulated dogfood state.

  **Dogfood evidence:**
  - Project: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev`
  - Command: same `agentxchain run --continuous ... --auto-checkpoint` invocation as BUG-87
  - Shipped package: `agentxchain@2.155.37`
  - Run summary error: `Governance export write failed: Invalid string length`
  - Stale export/report pair: `.agentxchain/reports/export-run_24ccd92f593d8647.json` older than `.agentxchain/reports/report-run_24ccd92f593d8647.md`

  **Why this is a framework bug:** automatic governance reporting must either produce a fresh bounded export or fail with a clearly bounded, non-stale report status. Reusing an older export after a fresh export write failure can make the report look valid while omitting the latest turns and blocker.

  **Required fix:**
  1. Add a regression that constructs accumulated state large enough to force the export writer through the same size pressure path and proves fresh export write completion.
  2. Ensure report generation never silently reports from a stale export after a fresh export write failure; if fallback is intentional, surface `stale_export_fallback` explicitly with timestamps.
  3. Preserve BUG-84 bounded array/string safeguards and BUG-86 bounded verifier semantics.
  4. Re-verify on tusq.dev by producing a fresh report/export pair after the patch ships.

  **Closure criteria:**
  1. New BUG-88 large-auto-report regression passes.
  2. BUG-84 and BUG-86 regression suites still pass.
  3. Published package no longer prints `Governance export write failed: Invalid string length` for the tusq.dev large run, or it emits an explicit stale-fallback report status.
  4. Same-session tusq.dev evidence exists under `.planning/dogfood-100-turn-evidence/bug-88-reverify-vX.Y.Z.md`.

- [x] **🚨 BUG-89: QA turn emits an objection `id` that does not match `OBJ-NNN`; AgentXchain correctly rejects schema-invalid staged output, but the continuous dogfood session pauses and requires operator recovery instead of automatic normalization/retry.** Closed 2026-04-26 in `agentxchain@2.155.43`: extended staged-result normalizer to rewrite invalid/missing objection IDs to deterministic `OBJ-001`, `OBJ-002`, ... before schema validation; emits `staged_result_auto_normalized` with `rationale: "invalid_objection_id_rewritten"`. Same-session tusq.dev reverify passed: QA turn `turn_4125be3cf057395a` accepted with `OBJ-002-M31` → `OBJ-001` normalization. Evidence: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/dogfood-100-turn-evidence/bug-89-reverify-v2.155.43.md`. Closure line: reproduces-on-tester-sequence: NO. Discovered 2026-04-26 on the same `tusq.dev` DOGFOOD-100 session after BUG-88 was reverified on shipped `agentxchain@2.155.42`. The blocker is in run `run_e40832d436a42d75`, turn `turn_4125be3cf057395a` (`qa`), with: `acceptTurn(qa): Validation failed at stage schema: objections[0].id must match pattern OBJ-NNN.`

  **Dogfood evidence:**
  - Project: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev`
  - Branch: `agentxchain-dogfood-100-turn-2026-04`
  - Command: `npx --yes -p agentxchain@2.155.42 -c 'agentxchain run --continuous --vision .planning/VISION.md --max-runs 100 --max-idle-cycles 3 --poll-seconds 5 --triage-approval auto --auto-checkpoint'`
  - Blocked turn: `turn_4125be3cf057395a`
  - Report: `.agentxchain/reports/report-run_e40832d436a42d75.md`
  - State evidence: `.agentxchain/state.json` records `failure_reason: "Validation failed at stage schema: objections[0].id must match pattern OBJ-NNN."`

  **Why this is a framework bug:** this is the same staged-result field-shape class as BUG-79, and it proves the prior class closure was too narrow. Claude's earlier BUG-79 framing explicitly said future shape bugs should attach to the normalization-table fix vehicle instead of becoming unrelated point defects. The current failure is not product work failure; it is a valid QA review blocked by an objection metadata shape that the framework can either normalize deterministically or retry with a concrete schema repair prompt. Full-auto mode cannot require the operator to hand-edit `.agentxchain/staging/<turn>/turn-result.json` for `objections[].id` any more than it can for `objections[].statement`.

  **Required fix — extend the staged-result schema-shape safety net:**
  1. Add a BUG-89 tester-sequence regression under `cli/test/beta-tester-scenarios/` that runs the real CLI chain and reproduces a staged QA result with an invalid objection id.
  2. Extend the staged-result normalizer so objection ids that are missing or invalid but otherwise unambiguous are rewritten to deterministic `OBJ-001`, `OBJ-002`, ... values before schema validation.
  3. Preserve fail-fast behavior for ambiguous objection objects: if an objection lacks a usable `statement` after BUG-79 normalization or has non-object shape, the validator must still reject.
  4. Ensure the prompt/schema audit names the exact `OBJ-NNN` requirement for review_only QA outputs, not just the `statement` requirement.
  5. Re-verify by resuming the same `tusq.dev` dogfood session on the shipped patch and proving `turn_4125be3cf057395a` or its retry accepts without manual staging JSON edits.

  **Closure criteria:**
  1. New BUG-89 tester-sequence regression passes.
  2. Existing BUG-78/BUG-79 staged-result normalization regressions still pass.
  3. Published package accepts or auto-recovers the tusq.dev QA objection-id failure without manual JSON edits.
  4. Same-session tusq.dev evidence exists under `.planning/dogfood-100-turn-evidence/bug-89-reverify-vX.Y.Z.md`.

- [x] **🚨 BUG-90: dev turn emits staged result with MULTIPLE simultaneous schema deviations — wrong status synonym (`"complete"` instead of `"completed"`), object-shaped `files_changed`, non-`DEC-NNN` decision IDs (`D1`/`D2`), `decision` field instead of `statement`, missing `decisions[].category`, missing `verification.status`, and missing `artifact.type` — all in a single turn. The existing normalizer (BUG-79 through BUG-89) did not cover these six field classes, causing schema validation failure and dogfood session pause at turn 39 of the DOGFOOD-100-TURNS strict counter.** Closed 2026-04-27 in `agentxchain@2.155.44`: extended staged-result normalizer with 6 new auto-correction rules covering status synonyms, object files_changed, decision id/statement/category, verification.status, and artifact.type. Same-session tusq.dev reverify passed: schema validation succeeded on retry dispatch; subsequent verification-stage failure is unrelated to BUG-90. Evidence: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/dogfood-100-turn-evidence/bug-90-reverify-v2.155.44.md`. Closure line: reproduces-on-tester-sequence: NO. Discovered 2026-04-26 on the same `tusq.dev` DOGFOOD-100 session (`cont-d83c9d81`) after 38 consecutive clean turns on `agentxchain@2.155.43`. The blocker is in run `run_8580d828f0e1cc1e`, turn `turn_c3e78ecd352330aa` (`dev`), Claude Sonnet 4.6 runtime.

  **Dogfood evidence:**
  - Project: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev`
  - Branch: `agentxchain-dogfood-100-turn-2026-04`
  - Session: `cont-d83c9d81`
  - Command: `npx --yes -p agentxchain@2.155.43 -c 'agentxchain run --continuous --vision .planning/VISION.md --max-runs 100 --max-idle-cycles 3 --poll-seconds 5 --triage-approval auto --auto-checkpoint'`
  - Blocked turn: `turn_c3e78ecd352330aa` (dev role, Claude Sonnet 4.6)
  - Run: `run_8580d828f0e1cc1e`
  - Counter value at failure: 39 (38 prior clean turns preserved per operator override point 6)
  - Staged result path: `.agentxchain/staging/turn_c3e78ecd352330aa/turn-result.json`

  **Observed staged result deviations (7 simultaneous violations):**
  ```json
  {
    "status": "complete",           // ← should be "completed"
    "files_changed": [
      {"path": "src/cli.js", "change_type": "modified", "description": "..."},
      {"path": "tests/smoke.mjs", "change_type": "modified", "description": "..."}
    ],                               // ← should be ["src/cli.js", "tests/smoke.mjs"]
    "decisions": [
      {"id": "D1", "decision": "Used approach A", "rationale": "..."},
      {"id": "D2", "decision": "Used approach B", "rationale": "..."}
    ],                               // ← id should be DEC-001/DEC-002, "decision" should be "statement", missing "category"
    "verification": {"command": "npm test", "exit_code": 0},  // ← missing "status"
    "artifact": {"milestone": "M36"}  // ← missing "type"
  }
  ```

  **Why this is a framework bug:** Same staged-result field-shape class as BUG-79/BUG-82/BUG-89. The dev turn's substantive work was correct — real code changes, valid decisions, passing tests. Only the metadata field shapes deviate from the strict schema. Claude Sonnet 4.6 used reasonable-but-wrong field names/shapes across 7 dimensions simultaneously, proving the normalizer coverage from BUG-79 through BUG-89 was too narrow. The normalizer table must be extended to cover status synonyms, object-to-string files_changed coercion, decision id/statement/category normalization, verification.status inference, and artifact.type inference.

  **Root cause:** The dispatch prompt hardening (Layer 1) from BUG-78/BUG-79 did not explicitly name all 7 field constraints. Claude Sonnet 4.6 inferred reasonable shapes from the schema description but not the exact required values. This is the same "prompt ↔ schema ↔ normalizer coverage gap" pattern, now proven to require broader normalizer coverage than point-fix additions.

  **Fix implemented (three-layer):**

  **Layer 1 — Prompt hardening** (`cli/src/lib/dispatch-bundle.js`): Added explicit field-rule lines for all 7 deviation classes: `status` exact enum values with explicit "do NOT use" for synonyms; `files_changed` must be string array; `decisions[].id` must be `DEC-NNN`; `decisions[].statement` is the required field name; `verification.status` REQUIRED; `artifact.type` REQUIRED.

  **Layer 2 — Normalizer extension** (`cli/src/lib/turn-result-validator.js`): Added 6 new normalization rules to `normalizeTurnResult()` BEFORE the existing Rule 0a, each with typed `staged_result_auto_normalized` events:
  1. Status synonym map: `complete`→`completed`, `success`→`completed`, `done`→`completed`, `error`→`failed`, `failure`→`failed`
  2. `files_changed` object-to-string coercion: `{path: "foo.js", ...}` → `"foo.js"`
  3. Decision ID normalization: non-`DEC-NNN` ids → deterministic `DEC-001`, `DEC-002`, ...
  4. Decision statement copy: missing `statement` → copied from `decision` or `description` field
  5. Decision category default: missing/invalid `category` → `"implementation"`
  6. `verification.status` inference: missing → inferred from `exit_code` (0→`"pass"`, nonzero→`"fail"`, missing→`"skipped"`)
  7. `artifact.type` inference: missing → `"workspace"` if `files_changed` non-empty, else `"review"`

  **Layer 3 — Regression test** (`cli/test/beta-tester-scenarios/bug-90-broad-staged-result-normalization.test.js`): 8 command-chain integration tests covering: exact tester reproduction (all 7 deviations), individual status synonyms, object files_changed, decision normalization, verification.status inference, artifact.type inference, and valid passthrough. All 8 pass.

  **Closure criteria:**
  1. New BUG-90 tester-sequence regression passes (8/8).
  2. Existing BUG-78/BUG-79/BUG-82/BUG-89 staged-result normalization regressions still pass.
  3. Published package accepts or auto-recovers the tusq.dev dev turn with all 7 deviations without manual JSON edits.
  4. Same-session tusq.dev evidence exists under `.planning/dogfood-100-turn-evidence/bug-90-reverify-vX.Y.Z.md`.

- [x] **🚨 BUG-91: dev turn blocked because `.planning/dogfood-100-turn-evidence/turn-counter.jsonl` was dirty at dispatch baseline (captured in `baseline.dirty_snapshot` with SHA256 marker) and still dirty at acceptance time with the SAME SHA — unchanged during the turn — but `detectDirtyFilesOutsideAllowed()` flagged it as "dirty and not classified" because the acceptance allowed-set did not include baseline-dirty-unchanged files.** Closed 2026-04-27 in `agentxchain@2.155.48`: carry-forward reverify accepted 13 full-auto turns in tusq.dev continuous session `cont-76603154` without baseline-dirty unchanged evidence parity failures. Evidence: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/dogfood-100-turn-evidence/bug-91-reverify-v2.155.48.md`. Discovered 2026-04-27 on tusq.dev DOGFOOD-100 session (`cont-96045989`, run `run_8580d828f0e1cc1e`, turn `turn_c3e78ecd352330aa` dev role, attempt 2). The dogfood evidence protocol writes turn-counter.jsonl to the tusq.dev working tree between turns; the file remains dirty across turns but is never modified BY a governed turn. The continuous loop's `refreshTurnBaselineSnapshot()` correctly captures it in the baseline dirty_snapshot. But `_acceptGovernedTurnLocked()` did not exclude baseline-dirty-unchanged files from the parity check, causing false-positive acceptance failures. Same staged-result meta-class as BUG-87 (verification-produced dirty files), but distinct trigger: the file predates the turn entirely rather than being produced by verification commands.

  **Root cause:** `governed-state.js:4507` — `detectDirtyFilesOutsideAllowed()` allowed-set includes `files_changed`, `concurrentAllowedDirtyFiles`, `uncheckpointedPriorFiles`, but NOT files from `baseline.dirty_snapshot` whose SHA marker is unchanged. The `filterBaselineDirtyFiles()` function at `repo-observer.js:838` already has the exact SHA-comparison logic but was only used for observation attribution, not acceptance parity.

  **Fix:** New `getBaselineUnchangedFiles(root, baseline)` exported from `repo-observer.js` returns files whose SHA marker matches baseline. Added to allowed-set before `detectDirtyFilesOutsideAllowed()` in `governed-state.js`. Files modified during the turn (different SHA) are NOT excluded — they still need classification. Emits `baseline_dirty_unchanged_excluded` audit event for traceability.

  **Closure criteria:**
  1. Dev turn with evidence file dirty at baseline and unchanged → acceptance succeeds.
  2. Dev turn with evidence file dirty at baseline but MODIFIED → acceptance fails (no regression).
  3. BUG-55/BUG-87 verification output regressions still pass.
  4. Published package unblocks the tusq.dev dogfood session.
  5. Same-session tusq.dev evidence under `.planning/dogfood-100-turn-evidence/bug-91-reverify-vX.Y.Z.md`.

  **Session state note:** The tusq.dev dogfood session changed from `cont-d83c9d81` to `cont-96045989` (session restarted during BUG-90 reverify process). Per strict criterion #1, the DOGFOOD-100-TURNS counter resets to 0. The 38 prior clean turns in session `cont-d83c9d81` are archived as substrate-hardening evidence but do NOT count toward the formal 100.

- [x] **🚨 BUG-92: continuous resume after BUG-91 shipped creates a fresh continuous session and attempts `assignTurn(dev)` while the original `failed_acceptance` turn is still active, producing `Turn already assigned: turn_c3e78ecd352330aa to dev` instead of reattempting acceptance of the existing staged result.** Closed 2026-04-27 in `agentxchain@2.155.48`: shipped-package reverify resumed retained failed-acceptance turn `turn_60ca77d51809c98f` through the run loop, then accepted QA/dev follow-up turns and completed `run_533b2f8c47cc0bf0` without `Turn already assigned`. Evidence: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/dogfood-100-turn-evidence/bug-92-reverify-v2.155.48.md`. Discovered 2026-04-27 on tusq.dev after `agentxchain@2.155.45` shipped BUG-91. Command: `npx --yes -p agentxchain@2.155.45 -c 'agentxchain run --continuous --vision .planning/VISION.md --max-runs 100 --max-idle-cycles 3 --poll-seconds 5 --triage-approval auto --auto-checkpoint'`. The run printed `Continuing active governed run`, then immediately blocked with `assignTurn(dev): Turn already assigned: turn_c3e78ecd352330aa to dev`. Status evidence shows the run remained active with `active_turns.turn_c3e78ecd352330aa.status = "failed_acceptance"` and a valid turn-scoped staged result at `.agentxchain/staging/turn_c3e78ecd352330aa/turn-result.json`.

  **Why this is a framework bug:** after a substrate acceptance fix ships, full-auto resume must reprocess the retained staged result for the failed-acceptance turn. It must not assign over an active retained turn, and it must not require operator `accept-turn` recovery. This is the same dogfood recovery loop as BUG-78/79/89/90/91: validation/recovery improvements are useless if the continuous runner cannot naturally retry the paused acceptance path.

  **Fix required:** `runLoop()` must detect active `failed_acceptance` turns with turn-scoped staged results and call `acceptTurn(root, config, { turnId })` before selecting/assigning a new role. On success, normal `afterAccept` handling, including auto-checkpoint, must run. On failure, the run must remain paused/blocked with the new acceptance error and must not emit duplicate-assignment errors.

  **Closure criteria:**
  1. Command-chain regression seeds an active `failed_acceptance` turn with a valid staged result and proves `agentxchain run --max-turns 1 --auto-approve --auto-checkpoint` reaccepts it without `Turn already assigned`.
  2. Negative regression proves a `failed_acceptance` turn without staged result blocks with missing-staging guidance, not duplicate assignment.
  3. BUG-91 baseline-dirty unchanged tests still pass.
  4. Published package resumes the tusq.dev dogfood session without manual `accept-turn`, staging edits, or gate mutation.
  5. Same-session reverify evidence exists under `.planning/dogfood-100-turn-evidence/bug-92-reverify-vX.Y.Z.md`, followed by BUG-91 reverify evidence if the original dirty-parity failure no longer reproduces.

- [x] **🚨 BUG-93: DOGFOOD-100 proof evidence under `.planning/dogfood-100-turn-evidence/` can be created during patch-release recovery while a failed turn is retained, but the dirty-parity checker treats the evidence as undeclared turn work and blocks reacceptance.** Closed 2026-04-27 in `agentxchain@2.155.48`: carry-forward reverify accepted retained and subsequent turns with DOGFOOD proof evidence present, without dirty-parity failure on `.planning/dogfood-100-turn-evidence/`. Evidence: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/dogfood-100-turn-evidence/bug-93-reverify-v2.155.48.md`. Discovered 2026-04-27 on tusq.dev after `agentxchain@2.155.46` shipped BUG-92 and correctly reattempted `acceptTurn(dev)` for `turn_c3e78ecd352330aa`. The duplicate-assignment error no longer reproduced; the new blocker was `acceptTurn(dev): ... dirty and not classified: .planning/dogfood-100-turn-evidence/bug-90-reverify-v2.155.44.md`. This evidence file is part of the formal DOGFOOD-100 discovery/reverify protocol, not product work by the retained dev turn.

  **Why this is a framework bug:** the human roadmap requires evidence files under `.planning/dogfood-100-turn-evidence/` for every dogfood-discovered BUG. Those files may be written while the same failed turn remains active across substrate patch releases. Treating them as dev-turn mutations forces either manual cleanup or operator-side acceptance recovery, violating DOGFOOD-100 rules.

  **Fix required:** classify `.planning/dogfood-100-turn-evidence/` as a narrow baseline-exempt evidence root. It must not make actor baseline dirty or block retained-turn reacceptance, while still being snapshotted for unchanged-marker comparison. Do NOT exempt arbitrary `.planning/` files.

  **Closure criteria:**
  1. `repo-observer.test.js` proves `.planning/dogfood-100-turn-evidence/*.md` is baseline-exempt and still captured in `dirty_snapshot`.
  2. Command-chain regression proves `accept-turn` succeeds with an untracked dogfood evidence file present during retained-turn recovery.
  3. Existing BUG-91 tracked baseline-dirty unchanged positive and negative tests still pass.
  4. Published package resumes tusq.dev without `Turn already assigned` and without dirty-parity failure on dogfood evidence files.
  5. Same-session evidence exists under `.planning/dogfood-100-turn-evidence/bug-93-reverify-vX.Y.Z.md`, followed by BUG-92 and BUG-91 reverify evidence if the retained turn accepts.

- [x] **🚨 BUG-94: retained `failed_acceptance` dev turn emits an otherwise valid staged result but omits the required top-level `decisions` and `objections` arrays, causing schema validation to fail before authoritative-role protocol validation can accept empty arrays.** Closed 2026-04-27 in `agentxchain@2.155.48`: retained turn `turn_60ca77d51809c98f` accepted through the shipped continuous run loop with no manual `accept-turn`, staging JSON edit, gate mutation, or cross-repo workaround; `run_533b2f8c47cc0bf0` completed and three later runs progressed. Evidence: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/dogfood-100-turn-evidence/bug-94-reverify-v2.155.48.md`. Discovered 2026-04-27 on the real `tusq.dev` DOGFOOD-100 session (`cont-a2567aec`, run `run_533b2f8c47cc0bf0`, turn `turn_60ca77d51809c98f`, dev role) after `agentxchain@2.155.47` reverified BUG-91/92/93 and advanced the strict same-session counter to 11. Observed error: `acceptTurn(dev): Validation failed at stage schema: Missing required field: decisions; Missing required field: objections`.

  **Why this is a framework bug:** the staged result was produced by the governed runtime and contained useful work, verification, artifact metadata, lifecycle request, and changed files. Empty `decisions` is schema-valid. Empty `objections` is schema-valid for authoritative roles, and review-only challenge requirements already belong to protocol validation. Requiring manual JSON surgery to add `[]` violates the DOGFOOD-100 normalizer discipline.

  **Fix required:** default only missing top-level `decisions` and `objections` to `[]` in `normalizeTurnResult()` before schema validation. Emit `staged_result_auto_normalized` events for both defaults. Do not normalize non-array values. Do not synthesize fake objections from sidecar notes. Preserve the existing Stage E failure for `review_only` roles whose normalized objections array is empty.

  **Closure criteria:**
  1. Spec exists at `.planning/BUG_94_MISSING_DECISIONS_OBJECTIONS_NORMALIZATION_SPEC.md`.
  2. Command-chain regression proves `agentxchain run --max-turns 1 --auto-approve --auto-checkpoint` reaccepts a retained `failed_acceptance` turn whose staged result omits both arrays.
  3. Negative regression proves `review_only` roles with omitted objections still fail the challenge-required protocol rule after normalization.
  4. Existing BUG-90 and BUG-92 normalizer/resume regressions still pass.
  5. Published package resumes tusq.dev same session without manual `accept-turn`, staging edits, gate mutation, or cross-repo workaround.
  6. Same-run evidence exists under `.planning/dogfood-100-turn-evidence/bug-94-reverify-v2.155.48.md`. The retained governed run resumed and accepted, but the continuous session ID changed from `cont-a2567aec` to `cont-76603154`; per strict criterion #1, the formal counter reset and `cont-76603154` recorded counter values 1-13 before graceful operator stop.

- [x] **🚨 BUG-95: dev turn emits staged result with synonym field names and missing required top-level fields — `files_modified` instead of `files_changed`, missing `runtime_id`, missing `summary`, missing `artifact` object, and missing `proposed_next_role` — causing schema validation to fail on an otherwise valid turn.** Closed 2026-04-27 in `agentxchain@2.155.51`: retained turn `turn_48fcfc7526b370ab` accepted through shipped continuous run `cont-f57240d1` with no manual `accept-turn`, staging JSON edit, gate mutation, or cross-repo workaround. Evidence: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/dogfood-100-turn-evidence/bug-95-reverify-v2.155.51.md`. Discovered 2026-04-27 on the real `tusq.dev` DOGFOOD-100 session (`cont-1d0be522`, turn `turn_48fcfc7526b370ab`, dev role) after `agentxchain@2.155.48` closed BUG-94 and advanced the strict same-session counter to 7. Observed error: `acceptTurn(dev): Validation failed at stage schema: Missing required field: files_changed; Missing required field: runtime_id; Missing required field: summary; Missing required field: artifact; Missing required field: proposed_next_role`.

  **Why this is a framework bug:** the staged result was produced by the governed runtime and contained useful work, verification evidence, lifecycle request, and changed files. The only issues are cosmetic field-name mismatches (`files_modified` vs `files_changed`) and missing fields that are inferrable from dispatch context (`runtime_id` from `activeTurn.runtime_id`, `summary` from `milestone_title`/`milestone`, `artifact` from `files_changed` presence, `proposed_next_role` from routing config). Requiring manual JSON surgery to rename/add these fields violates the DOGFOOD-100 normalizer discipline established by BUG-79/90/94.

  **Fix required:**
  1. Rename `files_modified` → `files_changed` before variable computation in `normalizeTurnResult()`.
  2. Default missing `runtime_id` from `context.runtimeId` (passed from `activeTurn.runtime_id`).
  3. Synthesize missing `summary` from `milestone_title`, `milestone`, or fallback.
  4. Infer missing `artifact` object (`workspace` if `files_changed` non-empty, else `review`).
  5. Default missing `proposed_next_role` to first allowed role for current phase (excluding self).
  6. Harden dispatch-bundle field rules to emphasize `files_changed` (not `files_modified`), `summary` REQUIRED, `runtime_id` REQUIRED, `proposed_next_role` REQUIRED.
  7. Update conformance fixture TR-002 from missing `summary` (now normalizable) to missing `run_id` (genuinely non-normalizable).

  **Closure criteria:**
  1. Command-chain regression test at `cli/test/beta-tester-scenarios/bug-95-missing-required-fields-normalization.test.js` passes (8 tests).
  2. Conformance self-validation passes (all tiers, all fixtures including updated TR-002).
  3. AT-CCV-005 connector-validate test still passes after normalizer extension.
  4. Full test suite green (7281 tests, 0 failures).
  5. Published package resumes tusq.dev same session without manual `accept-turn`, staging edits, gate mutation, or cross-repo workaround.
  6. Same-session evidence exists under `.planning/dogfood-100-turn-evidence/bug-95-reverify-vX.Y.Z.md`.

- [x] **🚨 BUG-96: same retained dev turn from BUG-95 emits `decisions[]` entries with `description` but no required `rationale`, causing schema validation to fail after BUG-95 normalization clears the first missing-field barrier.** Closed 2026-04-27 in `agentxchain@2.155.51`: retained turn `turn_48fcfc7526b370ab` accepted through shipped continuous run `cont-f57240d1` with five `decisions[].rationale` fields copied from existing decision descriptions and no operator recovery. Evidence: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/dogfood-100-turn-evidence/bug-96-reverify-v2.155.51.md`. Discovered 2026-04-27 on the real `tusq.dev` DOGFOOD-100 session while re-verifying `agentxchain@2.155.49` against retained turn `turn_48fcfc7526b370ab` in run `run_d309bfeea0f99431`. Observed error: `acceptTurn(dev): Validation failed at stage schema: decisions[0].rationale must be a non-empty string.; decisions[1].rationale must be a non-empty string.; decisions[2].rationale must be a non-empty string.; decisions[3].rationale must be a non-empty string.; decisions[4].rationale must be a non-empty string.`

  **Why this is a framework bug:** the same governed runtime produced useful dev work, verification, file-change evidence, and decision text. The decision objects used `description` as their only explanatory field. That field is already safe source material for `statement` normalization; requiring manual staging JSON surgery to duplicate it into `rationale` violates the DOGFOOD-100 normalizer discipline and strands otherwise valid work behind schema ceremony.

  **Fix required:**
  1. Extend `normalizeTurnResult()` decision normalization so missing/blank `decisions[i].rationale` copies from existing decision text only: `reason`, `why`, `description`, `decision`, or `statement`.
  2. Do **not** invent generic rationale when no source text exists; fail schema validation in that case.
  3. Emit `staged_result_auto_normalized` with field `decisions[i].rationale` and rationale `copied_from_<source>`.
  4. Harden dispatch-bundle field rules to make `decisions[].rationale` explicitly required.
  5. Update `.planning/STAGED_RESULT_INVARIANT_AUDIT.md` with the new normalizer row and fail-fast boundary.

  **Closure criteria:**
  1. Spec exists at `.planning/BUG_96_DECISION_RATIONALE_NORMALIZATION_SPEC.md`.
  2. Command-chain regression exists at `cli/test/beta-tester-scenarios/bug-96-decision-rationale-normalization.test.js` and covers the exact retained-turn cascade.
  3. Negative regression proves decisions with no statement/rationale source material still fail.
  4. Existing BUG-95 regression still passes.
  5. Published package resumes the retained tusq.dev turn without manual `accept-turn`, staging edits, gate mutation, or cross-repo workaround.
  6. Same-run evidence exists under `.planning/dogfood-100-turn-evidence/bug-96-reverify-vX.Y.Z.md`; if the same acceptance also proves BUG-95 closure, update BUG-95 closure in the same pass.

- [x] **🚨 BUG-97: same retained dev turn from BUG-95/BUG-96 carries a stale `run_id` from an earlier governed run, causing assignment validation to fail after v2.155.50 clears the schema barriers.** Closed 2026-04-27 in `agentxchain@2.155.51`: retained turn `turn_48fcfc7526b370ab` accepted through shipped continuous run `cont-f57240d1`; stale `run_id: "run_24ccd92f593d8647"` was normalized to active `run_d309bfeea0f99431` because `turn_id` matched the active retained turn. Evidence: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/dogfood-100-turn-evidence/bug-97-reverify-v2.155.51.md`. Discovered 2026-04-27 on the real `tusq.dev` DOGFOOD-100 retry using shipped `agentxchain@2.155.50`. Active state has run `run_d309bfeea0f99431` and retained turn `turn_48fcfc7526b370ab`, but staged result `.agentxchain/staging/turn_48fcfc7526b370ab/turn-result.json` has `run_id: "run_24ccd92f593d8647"` while `turn_id` still matches the active turn. Observed error: `acceptTurn(dev): Validation failed at stage assignment: run_id mismatch: turn result has "run_24ccd92f593d8647", state has "run_d309bfeea0f99431".`

  **Why this is a framework bug:** the retained staged result is turn-scoped and its `turn_id` matches the active retained turn. In this state, `run_id` is an identity echo from a previous run context, while `.agentxchain/state.json` is the authoritative current run identity. Requiring manual JSON surgery to rewrite `run_id` violates DOGFOOD-100 recovery discipline. This is only safely recoverable when the staged `turn_id` matches the active turn and the state/current-turn run identity is internally coherent; a mismatched or missing `turn_id` must remain fail-closed because the framework cannot prove ownership.

  **Fix required:**
  1. Extend staged-result normalization context with authoritative `state.run_id`, active `turn_id`, and active-turn `run_id` when present.
  2. Before schema/assignment validation, rewrite missing or mismatched top-level `run_id` from `state.run_id` only when `turn_id` matches the active turn and active-turn `run_id` is absent or equal to `state.run_id`.
  3. Do **not** normalize `run_id` when staged `turn_id` is missing, mismatched, or active-turn state disagrees with `state.run_id`; those remain assignment/schema failures.
  4. Emit `staged_result_auto_normalized` with field `run_id` and rationale `run_id_rewritten_from_active_turn_context`.
  5. Harden dispatch-bundle prompt rules so agents do not copy `run_id` from prior reports, history, or stale staging files.
  6. Update `.planning/STAGED_RESULT_INVARIANT_AUDIT.md` with the normalizer rule and fail-fast boundary.

  **Closure criteria:**
  1. Spec exists at `.planning/BUG_97_RUN_ID_ASSIGNMENT_NORMALIZATION_SPEC.md`.
  2. Unit regression proves `run_id` drift is normalized when `turn_id` matches the active turn.
  3. Unit regression proves `run_id` drift remains rejected when `turn_id` does not match the active turn.
  4. Command-chain regression exists at `cli/test/beta-tester-scenarios/bug-97-run-id-assignment-normalization.test.js`.
  5. Existing BUG-95 and BUG-96 regressions still pass.
  6. Published package resumes the retained tusq.dev turn without manual `accept-turn`, staging edits, gate mutation, or cross-repo workaround, and acceptance proceeds past the `run_id` mismatch.
  7. Same-run evidence exists under `.planning/dogfood-100-turn-evidence/bug-97-reverify-vX.Y.Z.md`; if the same acceptance also proves BUG-95/BUG-96 closure, update those closure entries in the same pass.

- [x] **🚨 BUG-98: retained QA turn in `implementation` emits skip-forward `phase_transition_request: "launch"` instead of the immediate next phase `qa`, causing protocol validation to fail after v2.155.51 clears BUG-95/96/97.** Closed 2026-04-27 in `agentxchain@2.155.52`: retained QA turn `turn_c640f6d66166bb52` auto-normalized `phase_transition_request: "launch"` to `"qa"` and `proposed_next_role: "launch"` to `"qa"` with `staged_result_auto_normalized` events, clearing the original protocol validation failure without manual `accept-turn`, staging JSON edit, gate mutation, or cross-repo workaround. The same reverify exposed BUG-99 at the next `gate_semantic_coverage` layer. Evidence: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/dogfood-100-turn-evidence/bug-98-reverify-v2.155.52.md`. Discovered 2026-04-27 on the real `tusq.dev` DOGFOOD-100 retry using shipped `agentxchain@2.155.51`. The retained dev turn accepted and checkpointed, then QA turn `turn_c640f6d66166bb52` staged a completed result with `phase_transition_request: "launch"` and `proposed_next_role: "launch"` while active state remained in `phase: "implementation"`. Observed error: `acceptTurn(qa): Validation failed at stage protocol: phase_transition_request "launch" is invalid from phase "implementation"; next phase is "qa".`

  **Why this is a framework bug:** the dispatch prompt did name `phase_transition_request: "qa"` as the immediate next phase, but it also listed every valid phase and provided rich historical context containing prior QA decisions that used `phase_transition_request='launch'`. The staged result is otherwise useful QA output with passing verification and current QA artifacts. Requiring operator JSON surgery to replace a later valid phase with the immediate next phase violates DOGFOOD-100 recovery discipline. This is safely recoverable only for completed non-terminal turns when the requested phase is a defined phase after the immediate next phase.

  **Fix required:**
  1. Add spec `.planning/BUG_98_SKIP_FORWARD_PHASE_TRANSITION_NORMALIZATION_SPEC.md`.
  2. Extend `normalizeTurnResult()` so authoritative completed non-terminal turns with skip-forward `phase_transition_request` values normalize to the immediate next phase.
  3. If `proposed_next_role` equals the stale requested phase or is routing-illegal, align it to the corrected next phase entry role when that role is allowed from the current phase.
  4. Do **not** normalize unknown, backward, same-phase, review-only skip-forward, or final-phase transition requests; those remain protocol failures unless covered by existing gate-name correction.
  5. Emit `staged_result_auto_normalized` events for `phase_transition_request` and safe `proposed_next_role` correction.
  6. Harden dispatch-bundle prompt rules to explicitly forbid skipping ahead to later phases.
  7. Update `.planning/STAGED_RESULT_INVARIANT_AUDIT.md`.

  **Closure criteria:**
  1. Unit regression proves `implementation` + `phase_transition_request: "launch"` normalizes to `qa`.
  2. Unit regression proves backward authoritative phase requests remain rejected.
  3. Command-chain regression exists at `cli/test/beta-tester-scenarios/bug-98-skip-forward-phase-normalization.test.js`.
  4. Existing BUG-95, BUG-96, and BUG-97 regressions still pass.
  5. Published package resumes the retained tusq.dev QA turn without manual `accept-turn`, staging edits, gate mutation, or cross-repo workaround, and acceptance proceeds past the skip-forward phase request.
  6. Same-run evidence exists under `.planning/dogfood-100-turn-evidence/bug-98-reverify-vX.Y.Z.md`.

- [x] **🚨 BUG-99: pre-acceptance `gate_semantic_coverage` evaluates workflow-kit ownership without accepted history, falsely claiming an already accepted dev-owned implementation artifact has no dev participation.** Closed 2026-04-27 in `agentxchain@2.155.53`: retained QA turn `turn_c640f6d66166bb52` accepted on the shipped package with no manual `accept-turn`, staging JSON edit, gate mutation, unblock, or cross-repo workaround; events show `phase_entered implementation -> qa`, `turn_accepted`, and checkpoint `f365674dc4ca73b0e26fd8b00926fb32ce1262b8`. Same DOGFOOD resume accepted `turn_57eb341ae6421d17`, accepted `turn_c6a5bea555d5e01f`, completed run `run_d309bfeea0f99431`, started new run `run_79db9c1f34791188`, accepted PM turn `turn_99cd4b15e01e46ad`, and raised the strict counter to 5 before BUG-100. Evidence: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/dogfood-100-turn-evidence/bug-99-reverify-v2.155.53.md`. Discovered 2026-04-27 on the real `tusq.dev` DOGFOOD-100 retry using shipped `agentxchain@2.155.52`. BUG-98 normalization cleared the original protocol failure for retained QA turn `turn_c640f6d66166bb52`, but acceptance then failed with: `Gate "implementation_complete" is failing on .planning/IMPLEMENTATION_NOTES.md. Your turn did not modify that file. Either edit the file(s) to satisfy the gate, or remove the phase transition request.` The structured event reported `gate_reasons: ["\".planning/IMPLEMENTATION_NOTES.md\" requires participation from role \"dev\" in phase \"implementation\", but no accepted turn from that role was found"]` even though history contains accepted implementation-phase dev turn `turn_48fcfc7526b370ab` with `.planning/IMPLEMENTATION_NOTES.md` in `files_changed`.

  **Why this is a framework bug:** `acceptGovernedTurn()` has already loaded `.agentxchain/history.jsonl` before the pre-gate semantic coverage check, but it calls `evaluatePhaseExit()` with raw `state`. `gate-evaluator` ownership checks read `state.history`, so pre-acceptance coverage loses accepted role participation and invents a false uncovered gate file. Requiring operator JSON surgery or removing the transition would violate DOGFOOD-100 recovery discipline; the framework has the accepted history needed to evaluate the gate truthfully.

  **Fix required:**
  1. Add spec `.planning/BUG_99_GATE_SEMANTIC_HISTORY_OWNERSHIP_SPEC.md`.
  2. Pass accepted `historyEntries` into the pre-gate `evaluatePhaseExit()` call used by `gate_semantic_coverage`.
  3. Preserve fail-closed behavior when no accepted owner history exists.
  4. Add command-chain regression `cli/test/beta-tester-scenarios/bug-99-gate-semantic-history-ownership.test.js`.
  5. Existing BUG-36/37 gate semantic coverage and BUG-98 skip-forward regressions must still pass.

  **Closure criteria:**
  1. Command-chain regression proves QA can request `implementation -> qa` without modifying `.planning/IMPLEMENTATION_NOTES.md` when history contains an accepted implementation-phase dev turn that owns that artifact.
  2. Negative regression proves the same request still fails when the accepted dev history entry is absent.
  3. Published package resumes retained tusq.dev QA turn `turn_c640f6d66166bb52` without manual `accept-turn`, staging edits, gate mutation, or cross-repo workaround, and acceptance proceeds past the false ownership failure.
  4. Same-run evidence exists under `.planning/dogfood-100-turn-evidence/bug-99-reverify-vX.Y.Z.md`.

- [x] **🚨 BUG-100: productive local_cli dev turns are killed at the hard 1,200s deadline without staged results, retry the same oversized work, then escalate to a human on `retries_exhausted`, blocking DOGFOOD-100.** Closed 2026-04-28 in `agentxchain@2.155.54`: the shipped package resumed the retained tusq.dev blocker without manual `unblock`, staging edits, gate mutation, or cross-repo workaround; emitted `Productive-timeout auto-retried (1/1): turn_317ed718994e61ef -> turn_beac02a98d4b562d`; accepted the reissued dev turn; then accepted QA `turn_3fb041fa0224ce63`, launch dev `turn_6645ee16dccf4491`, PM `turn_c1bdc2ccb3a73e68`, dev `turn_c5d62ccd1c2a4bcd`, QA `turn_c650f5bf0046eb83`, launch dev `turn_ad6f2a672e3ee887`, and PM `turn_357704fa614b9c94`, raising the strict counter to 13 before BUG-101. Evidence: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/dogfood-100-turn-evidence/bug-100-reverify-v2.155.54.md`. Discovered 2026-04-27/28 on the real `tusq.dev` DOGFOOD-100 run using shipped `agentxchain@2.155.53`, after BUG-99 cleared and continuous mode started new run `run_79db9c1f34791188`. PM turn `turn_99cd4b15e01e46ad` accepted and assigned implementation dev turn `turn_317ed718994e61ef`. Attempt 1 produced output through 1,138 seconds and 12,503 lines, then failed at `elapsed_seconds: 1200` with subprocess code 143 and no staged result. Attempt 2 produced output through 882 seconds and 14,651 lines, then failed at `elapsed_seconds: 1200` with the same missing staged result. The framework raised human escalation `hesc_e174a6854c1e1eb3` and blocked with `blocked_on: escalation:retries-exhausted:dev`.

  **Why this is a framework bug:** a full-auto local_cli turn that is actively producing output should not end the substrate run in a human-only recovery path after the framework kills it on the hard deadline. The retry reused the same oversized work shape and failed the same way. DOGFOOD-100 requires the framework to recover without human `unblock`, manual staging edits, or operator reruns. The substrate needs a machine-recoverable timeout policy: either adaptive progress-aware extension, timeout retry prompts that force an early reduced-scope staged result, automatic PM scope reduction, or equivalent full-auto recovery.

  **Fix required:**
  1. Add spec `.planning/BUG_100_TIMEOUT_RETRY_FULL_AUTO_RECOVERY_SPEC.md`.
  2. Add command-chain regression reproducing a local_cli runtime that emits output until a forced deadline, exits via framework kill/code 143, produces no staged result, and exhausts retries.
  3. Change timeout/retry handling so productive deadline-killed turns do not raise a human escalation as the only recovery in full-auto continuous mode.
  4. Preserve fail-closed behavior for silent hung turns and genuinely non-productive subprocess failures.
  5. Ensure retry/recovery includes enough diagnostic context for the next automated actor to shrink scope or stage a partial-but-valid result.

  **Closure criteria:**
  1. Regression proves productive deadline-killed local_cli turn recovery stays machine-owned in full-auto mode and does not require `agentxchain unblock`.
  2. Negative regression proves silent/no-output subprocess failures still fail closed and do not loop forever.
  3. Published package resumes retained tusq.dev blocked run `run_79db9c1f34791188` without manual `unblock`, staging edits, gate mutation, or cross-repo workaround, and proceeds past `turn_317ed718994e61ef`'s timeout blocker.
  4. Same-run evidence exists under `.planning/dogfood-100-turn-evidence/bug-100-reverify-vX.Y.Z.md`.

- [x] **🚨 BUG-101: `decisions[].summary` is not normalized into required `decisions[].statement`, blocking an otherwise useful full-auto dev turn after DOGFOOD-100 counter value 13.** Closed 2026-04-28 in `agentxchain@2.155.55`: the shipped package resumed retained tusq.dev failed-acceptance turn `turn_cc1f4a9f48f528e8` without manual staging edits, `accept-turn`, `unblock`, gate mutation, or cross-repo workaround; acceptance emitted `staged_result_auto_normalized` for `decisions[].statement` with `rationale: copied_from_summary`, then accepted the turn. Evidence: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/dogfood-100-turn-evidence/bug-101-reverify-v2.155.55.md`. Strict counter note: the retained governed run continued, but `agentxchain run --continuous` created live continuous session `cont-6b2b572e`, so strict counter reset to 1 and advanced to 10 before BUG-102. Discovered 2026-04-28 on the real `tusq.dev` DOGFOOD-100 run using shipped `agentxchain@2.155.54`, after BUG-100 closed and continuous mode advanced through eight additional clean turns. Dev turn `turn_cc1f4a9f48f528e8` in run `run_240679669ee78f0b` completed after producing 19,968 output lines and wrote a staged result, but acceptance failed at schema stage: `decisions[0].statement must be a non-empty string` through `decisions[6].statement must be a non-empty string`. The staged result contains seven decision objects with `summary` plus valid `rationale`; this is the decision equivalent of BUG-79's objection `summary`/`detail` shape.

  **Why this is a framework bug:** the existing staged-result normalizer already treats `decision` and `description` as unambiguous synonyms for missing `decisions[].statement`, and BUG-79 established that model-generated `summary` can safely supply missing `statement` when it is scoped inside a structured item. Requiring manual JSON surgery from `summary` to `statement` would violate DOGFOOD-100 and repeat a known field-shape class.

  **Fix required:**
  1. Add spec `.planning/BUG_101_DECISION_SUMMARY_STATEMENT_NORMALIZATION_SPEC.md`.
  2. Extend decision normalization so missing `decisions[].statement` copies from non-empty `summary` after `decision` and `description`.
  3. Emit `staged_result_auto_normalized` with `rationale: copied_from_summary`.
  4. Harden dispatch-bundle field rules to forbid using `summary` as a decision field name.
  5. Add command-chain regression `cli/test/beta-tester-scenarios/bug-101-decision-summary-statement-normalization.test.js`.

  **Closure criteria:**
  1. Command-chain regression proves `accept-turn` accepts seven decisions using `summary` plus `rationale`.
  2. Negative regression proves a decision with no `statement`, `decision`, `description`, or `summary` still fails.
  3. Published package resumes retained tusq.dev failed-acceptance turn `turn_cc1f4a9f48f528e8` without manual staging edits, `accept-turn`, `unblock`, gate mutation, or cross-repo workaround.
  4. Same-run evidence exists under `.planning/dogfood-100-turn-evidence/bug-101-reverify-vX.Y.Z.md`.

- [x] **🚨 BUG-102: expected negative CLI checks with non-zero `verification.machine_evidence[].exit_code` block a passing full-auto QA turn.** Closed 2026-04-28 in `agentxchain@2.155.56`: retained tusq.dev QA turn `turn_cbc4204c2b1db778` accepted through shipped `agentxchain@latest` with no manual staging edits, `accept-turn`, `unblock`, gate mutation, or cross-repo workaround. The run then accepted launch dev turn `turn_8dbab64275e52617` and completed `run_9a2f6448e2199cda`. Evidence: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/dogfood-100-turn-evidence/bug-102-reverify-v2.155.56.md`. Strict counter note: the retained governed run continued, but `agentxchain run --continuous` created live continuous session `cont-e5fb63e4`, so the strict counter reset to 1 and advanced to 2 before BUG-103. Discovered 2026-04-28 on the real `tusq.dev` DOGFOOD-100 run using shipped `agentxchain@2.155.55`, after BUG-101 closed and the new strict continuous session `cont-6b2b572e` advanced to counter value 10. QA turn `turn_cbc4204c2b1db778` in run `run_9a2f6448e2199cda` completed after producing 6,830 output lines and wrote a staged result, but acceptance failed at verification stage: `verification.status is "pass" but 2 command(s) have non-zero exit codes`. The two non-zero commands were deliberate negative CLI checks: `--first-type STRING` and `--first-type boolean`, both documented in `evidence_summary` as expected exit-1 behavior.

  **Why this is a framework bug:** the framework correctly rejects accidental non-zero evidence under `verification.status: "pass"`, but full-auto QA must also be able to record expected negative-case checks without causing an operator pause. Requiring manual staging JSON surgery to remove the commands, change status, or wrap already-run checks violates DOGFOOD-100. The protocol needs an explicit expected-failure evidence contract.

  **Fix required:**
  1. Add spec `.planning/BUG_102_EXPECTED_NONZERO_VERIFICATION_SPEC.md`.
  2. Extend verification validation so non-zero machine evidence is accepted under `verification.status: "pass"` only when `expected_exit_code` matches `exit_code`, or when `evidence_summary` explicitly names the negative check and says it exits that code.
  3. Keep undeclared non-zero machine evidence fail-closed.
  4. Harden dispatch-bundle field rules to instruct agents to use `expected_exit_code` for raw negative-case commands.
  5. Add command-chain regression `cli/test/beta-tester-scenarios/bug-102-expected-nonzero-verification.test.js`.

  **Closure criteria:**
  1. Command-chain regression proves `accept-turn` accepts a QA turn with `exit_code: 1` and `expected_exit_code: 1`.
  2. Command-chain regression proves the tusq.dev summary wording (`--first-type STRING exits 1`, `--first-type boolean exits 1`) accepts without manual edits.
  3. Negative regression proves undeclared non-zero machine evidence under `verification.status: "pass"` still fails.
  4. Published package resumes retained tusq.dev failed-acceptance turn `turn_cbc4204c2b1db778` without manual staging edits, `accept-turn`, `unblock`, gate mutation, or cross-repo workaround.
  5. Same-run evidence exists under `.planning/dogfood-100-turn-evidence/bug-102-reverify-vX.Y.Z.md`.

- [x] **🚨 BUG-103: roadmap-replenishment PM turn emits `decisions[].title` plus valid `rationale` but omits required `decisions[].statement`, blocking an otherwise useful full-auto planning turn.** Closed 2026-04-28 in `agentxchain@2.155.59`: retained PM turn `turn_644dcda246f21bc1` accepted end to end at `2026-04-28T08:47:07.874Z` in continuous session `cont-9a2697e7` with no manual staging JSON edit, no operator `accept-turn`, no `unblock`, no gate mutation, and checkpoint `2d191b605e844bbcbad2a23667d6f7c6c1308ced`. Evidence: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/dogfood-100-turn-evidence/bug-103-reverify-v2.155.59.md`. Discovered 2026-04-28 on real `tusq.dev` DOGFOOD-100 using shipped `agentxchain@2.155.56`, immediately after BUG-102 closed and the new continuous session `cont-e5fb63e4` advanced to strict counter value 2. PM turn `turn_644dcda246f21bc1` in run `run_6e53e7b50cd2c457` completed after producing 13,961 output lines and wrote a staged result that derived M50 from remaining VISION scope, modified four PM-owned planning artifacts, and satisfied the roadmap-replenishment acceptance contract, but acceptance failed at schema stage: `decisions[0].statement must be a non-empty string` through `decisions[4].statement must be a non-empty string`.

  **Why this is a framework bug:** the staged result is useful governed PM output. Each decision object has a deterministic `title` containing the decision text and a non-empty `rationale`; the only defect is model-authored field-shape drift from `statement` to `title`. The existing normalizer already recovers `decision`, `description`, and `summary` into missing `decisions[].statement`; excluding `title` is an arbitrary gap that forces manual JSON surgery and violates DOGFOOD-100.

  **Fix required:**
  1. Add spec `.planning/BUG_103_DECISION_TITLE_STATEMENT_NORMALIZATION_SPEC.md`.
  2. Extend staged-result normalization so missing/blank `decisions[].statement` copies from non-empty `title` after existing `decision`/`description`/`summary` sources.
  3. Emit `staged_result_auto_normalized` with `rationale: "copied_from_title"`.
  4. Keep decisions with no source material fail-closed; do not synthesize `statement` from `rationale` alone.
  5. Harden dispatch-bundle field rules to explicitly forbid `title` as the decision statement field.
  6. Add command-chain regression `cli/test/beta-tester-scenarios/bug-103-decision-title-statement-normalization.test.js`.

  **Closure criteria:**
  1. Command-chain regression proves `accept-turn` accepts a PM turn whose decision objects have `title` and `rationale` but no `statement`.
  2. Negative regression proves decisions with no statement source material still fail schema validation.
  3. Existing BUG-101 summary-to-statement regression remains green.
  4. Published package resumes retained tusq.dev failed-acceptance turn `turn_644dcda246f21bc1` without manual staging edits, `accept-turn`, `unblock`, gate mutation, or cross-repo workaround.
  5. Same-run evidence exists under `.planning/dogfood-100-turn-evidence/bug-103-reverify-vX.Y.Z.md`.

- [x] **🚨 BUG-104: roadmap-replenishment PM turn emits typed structured observations inside `verification.machine_evidence[]` without `command`/`exit_code`, blocking the same otherwise useful full-auto planning turn after BUG-103 normalization.** Closed 2026-04-28 in `agentxchain@2.155.59`: retained PM turn `turn_644dcda246f21bc1` accepted end to end at `2026-04-28T08:47:07.874Z`; structured observations were preserved in `verification.evidence_summary`, command-shaped machine evidence stayed executable-only, and no manual recovery was used. Evidence: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/dogfood-100-turn-evidence/bug-104-reverify-v2.155.59.md`. Discovered 2026-04-28 on real `tusq.dev` DOGFOOD-100 using shipped `agentxchain@2.155.57`. The retained PM turn `turn_644dcda246f21bc1` in run `run_6e53e7b50cd2c457` advanced past the original BUG-103 `decisions[].statement` schema failure, proving the title-to-statement normalizer executed, then failed at verification stage: `verification.machine_evidence[0].command must be a non-empty string` / `exit_code must be an integer` through `verification.machine_evidence[6]`.

  **Why this is a framework bug:** the staged result's verification block contains useful typed PM evidence (`file_marker_grep`, `fixture_discrimination_check`, `vision_citation_uniqueness_check`, `acceptance_contract_check`) with concrete `path`, `marker`, `result`, bucket, and contract details. These are not executable command records, so the framework is correct to preserve the `machine_evidence` command contract, but wrong to force a manual staging edit when the information can be safely retained as `evidence_summary` before verification validation.

  **Fix required:**
  1. Add spec `.planning/BUG_104_STRUCTURED_MACHINE_EVIDENCE_NORMALIZATION_SPEC.md`.
  2. Keep `verification.machine_evidence[]` strict: executable command records only, with non-empty `command` and integer `exit_code`.
  3. Before schema/verification validation, move recoverable typed structured evidence objects from `verification.machine_evidence[]` into `verification.evidence_summary`.
  4. Preserve existing valid command evidence unchanged.
  5. Emit `staged_result_auto_normalized` events with `rationale: "structured_machine_evidence_moved_to_evidence_summary"`.
  6. Harden dispatch-bundle instructions so future agents put typed observations in `evidence_summary`, not `machine_evidence`.
  7. Add command-chain regression `cli/test/beta-tester-scenarios/bug-104-structured-machine-evidence-normalization.test.js`.

  **Closure criteria:**
  1. Command-chain regression proves `accept-turn` accepts a PM turn with typed marker objects in `verification.machine_evidence[]` by moving them into `evidence_summary`.
  2. Regression proves valid command-shaped machine evidence remains in `machine_evidence`.
  3. Negative regression proves unrecognizable malformed machine evidence still fails closed.
  4. Published package resumes retained tusq.dev failed-acceptance turn `turn_644dcda246f21bc1` without manual staging edits, `accept-turn`, `unblock`, gate mutation, or cross-repo workaround.
  5. Same-run evidence exists under `.planning/dogfood-100-turn-evidence/bug-104-reverify-vX.Y.Z.md`; if the turn accepts end to end, the same evidence may close BUG-103 as well.

- [x] **🚨 BUG-105: roadmap-replenishment PM turn explicitly records the bounded/testable/non-duplicate acceptance clause, but strict intent coverage misses it after BUG-104 structured-evidence normalization.** Closed 2026-04-28 in `agentxchain@2.155.59`: retained PM turn `turn_644dcda246f21bc1` accepted end to end at `2026-04-28T08:47:07.874Z`; strict intent coverage consumed normalized verification evidence summaries and no longer missed the bounded/testable/non-duplicate clause. Evidence: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/dogfood-100-turn-evidence/bug-105-reverify-v2.155.59.md`. Discovered 2026-04-28 on real `tusq.dev` DOGFOOD-100 using shipped `agentxchain@2.155.58`. The retained PM turn `turn_644dcda246f21bc1` in run `run_6e53e7b50cd2c457` advanced past BUG-103 schema normalization and BUG-104 verification normalization, then failed at intent coverage: `Intent coverage incomplete: 1 acceptance item(s) not addressed: Milestone is bounded, testable, and does not duplicate existing checked milestones`.

  **Why this is a framework bug:** the staged result contains an `acceptance_contract_check` structured observation whose contract array states `(3) Milestone is bounded, testable, does not duplicate existing checked milestones — ~0.5 day bound, eval scenario specified, axis distinct from M28-M49`, and the decision rationale also says the charter acceptance contract is satisfied. BUG-104 correctly moves typed observations out of `machine_evidence[]`, but strict intent coverage uses brittle whitespace/punctuation matching and does not reliably include verification summaries. The framework should not require manual staging edits when the staged result already contains explicit acceptance evidence.

  **Fix required:**
  1. Add spec `.planning/BUG_105_INTENT_COVERAGE_STRUCTURED_EVIDENCE_SPEC.md`.
  2. Include `verification.evidence_summary` and remaining command-shaped `verification.machine_evidence[]` text in the intent-coverage corpus.
  3. Tokenize acceptance items by word characters instead of raw whitespace so punctuation does not hide matches like `bounded,` and `testable,`.
  4. Add command-chain regression `cli/test/beta-tester-scenarios/bug-105-intent-coverage-structured-evidence.test.js`.

  **Closure criteria:**
  1. Command-chain regression proves `accept-turn` accepts the tusq-style retained PM shape in strict intent coverage after structured evidence is moved into `evidence_summary`.
  2. Negative regression proves strict intent coverage still fails when the bounded/testable/non-duplicate clause is absent.
  3. Published package resumes retained tusq.dev failed-acceptance turn `turn_644dcda246f21bc1` without manual staging edits, `accept-turn`, `unblock`, gate mutation, or cross-repo workaround.
  4. Same-run evidence exists under `.planning/dogfood-100-turn-evidence/bug-105-reverify-vX.Y.Z.md`; if the turn accepts end to end, the same evidence may close BUG-103 and BUG-104 as well.

- [x] **🚨 BUG-106: verification.status="pass" with undeclared non-zero exit_code in machine_evidence blocks acceptance.** Closed 2026-04-28 in `agentxchain@2.155.60`: normalizer auto-sets `expected_exit_code` to match `exit_code` when `verification.status` is `"pass"`. Discovered 2026-04-28 on real `tusq.dev` DOGFOOD-100 session `cont-f553771e` at turn 53. Dev turn `turn_243c1b5e877fb108` in run `run_3626d963236136d0` declared `verification.status: "pass"` but two `machine_evidence` commands (`node bin/tusq.js divisor index --divisor MULTIPLE_CONSTRAINED` and `--divisor multiple_constrained`) had `exit_code: 1` without `expected_exit_code` set — these were intentional negative-case tests for case-sensitive divisor name validation.

  **Why this is a framework bug:** The agent correctly reported verification as passing (the non-zero exits were expected negative-case tests proving error handling), but the Stage D validator rejected the turn because `expected_exit_code` was not explicitly set. The dispatch prompt tells agents about `expected_exit_code` but models don't always follow the instruction. When the overall status is explicitly "pass", the framework should trust the agent's declaration and auto-normalize the evidence.

  **Fix:** Added BUG-106 normalizer rule in `normalizeTurnResult()` that auto-sets `expected_exit_code = exit_code` for all `machine_evidence` entries where `exit_code !== 0` and `expected_exit_code` is not set, but ONLY when `verification.status === "pass"`. Updated BUG-102 test #3 and `turn-result-validator.test.js` to reflect the new normalization behavior.

  **Closure criteria:**
  1. Command-chain regression `cli/test/beta-tester-scenarios/bug-106-verification-pass-undeclared-nonzero-normalization.test.js` proves normalization works (4 tests: normalize undeclared, don't normalize when status!=pass, preserve already-declared, exact tester reproduction).
  2. Published package resumes retained tusq.dev turn `turn_243c1b5e877fb108` without manual staging edits.
  3. Same-run evidence under `.planning/dogfood-100-turn-evidence/bug-106-reverify-v2.155.60.md`.

- [x] **🚨 BUG-107: continuous process exits and leaves session `paused` after a clean accepted turn even though the governed run is still active, unblocked, and has a dispatchable next role.** Discovered 2026-04-29 on real `tusq.dev` DOGFOOD-100 using shipped `agentxchain@2.155.60`. Strict session `cont-7dc5b5df` reached counter **89 / 100** when dev turn `turn_fc4027d5c8789062` in run `run_083e290f5ee318f4` accepted at `2026-04-29T11:02:12.407Z`, advanced `implementation` -> `qa`, then the runner PID exited and `.agentxchain/continuous-session.json` was left at `status: "paused"`. Governed state remained `status: "active"`, `phase: "qa"`, `active_turns: {}`, `blocked_on: null`, no pending approvals, and `next_recommended_role: "qa"`. **Closed 2026-04-29 in `agentxchain@2.155.64`: shipped-package reverify preserved `cont-7dc5b5df`, recovered the active run, and reached natural QA dispatch `turn_f3e829f2485a7cee` after BUG-109 auto-checkpoint recovery. Evidence: `tusq.dev/.planning/dogfood-100-turn-evidence/bug-109-reverify-v2.155.64.md`.** Discovery evidence: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/dogfood-100-turn-evidence/bug-107-discovery-v2.155.60.md`.

  **Why this is a framework bug:** Full Auto Mode must not pause or exit when a governed run is active, unblocked, and role resolution can dispatch the next phase role. This stranded state is neither a human gate nor a product failure. It requires operator reinvocation to continue, violating DOGFOOD-100's single uninterrupted full-auto proof requirement.

  **Fix required:**
  1. Add spec `.planning/BUG_107_CONTINUOUS_PAUSED_ACTIVE_RUN_RECOVERY_SPEC.md`.
  2. Add a recovery predicate for `continuous_session.status="paused"` + governed `state.status="active"` + no blocker/escalation/pending approval + either a retained active turn or no active turns plus a valid next role.
  3. Make `advanceContinuousRunOnce()` normalize that shape back to `running`, emit `continuous_paused_active_run_recovered`, and continue the governed run.
  4. Make the CLI-owned `executeContinuousRun()` adopt an existing paused/running CLI-owned session instead of replacing the session ID on reinvocation, then apply the same recovery.
  5. Add regressions proving recoverable active-run pauses resume, legitimate pending approval pauses remain paused, retained active turns after unblock still recover, and CLI reinvocation preserves the existing session ID.

  **Closure criteria:**
  1. Regression tests pass for recoverable active-run pause and non-recoverable pending approval pause.
  2. Patch release ships to npm.
  3. Published package resumes the same tusq.dev session `cont-7dc5b5df` / run `run_083e290f5ee318f4` without manual staging JSON edits, operator `accept-turn`, `unblock`, manual gate mutation, or tusq.dev workaround.
  4. QA turn dispatches naturally from the stranded QA phase.
  5. Same-run evidence exists under `.planning/dogfood-100-turn-evidence/bug-107-reverify-vX.Y.Z.md`.

- [x] **🚨 BUG-108: terminal dirty-baseline blocker after BUG-107 recovery is re-recovered in a tight loop instead of staying paused.** Discovered 2026-04-29 on real `tusq.dev` DOGFOOD-100 using shipped `agentxchain@2.155.61` during BUG-107 reverify. The CLI correctly preserved session `cont-7dc5b5df`, emitted `Resuming existing continuous session cont-7dc5b5df`, auto-reconciled one safe operator commit, and recovered paused active run `run_083e290f5ee318f4` with `Paused continuous session has active unblocked run run_083e290f5ee318f4; resuming next role dispatch.` The next natural QA assignment then hit a terminal clean-baseline blocker: `assignTurn(qa): Working tree has uncommitted changes in actor-owned files: .planning/IMPLEMENTATION_NOTES.md, .planning/ROADMAP.md, .planning/SYSTEM_SPEC.md, .planning/command-surface.md, src/cli.js...`. Instead of returning the blocked result, `executeContinuousRun()` ran its post-step paused-active recovery hook first and repeatedly retried the same terminal blocker. **Closed 2026-04-29 in `agentxchain@2.155.62`: shipped package resumes `cont-7dc5b5df`, reaches the dirty-baseline blocker once, emits zero post-step recovery-loop messages, and leaves the session paused. Evidence: `tusq.dev/.planning/dogfood-100-turn-evidence/bug-108-reverify-v2.155.62.md`.**

  **Why this is a framework bug:** BUG-107 recovery is only valid before or between non-terminal loop steps. Once `advanceContinuousRunOnce()` returns a terminal status such as `blocked`, recovery must stop. Treating a real assignment blocker as recoverable active work hides the blocker, burns CPU in a tight loop, and forces operator process termination.

  **Fix required:**
  1. Add spec `.planning/BUG_108_CONTINUOUS_TERMINAL_BLOCK_NO_RERECOVERY_SPEC.md`.
  2. In `executeContinuousRun()`, process terminal statuses before invoking post-step `recoverPausedActiveContinuousSession()`.
  3. Preserve BUG-107 startup recovery and CLI-owned session adoption.
  4. Add a command-chain beta scenario using `agentxchain run --continuous` against a paused active session that reaches a dirty-baseline blocker, then assert the process exits without timeout and without the post-step recovery log.

  **Closure criteria:**
  1. Regression `AT-BUG108-001` proves `executeContinuousRun()` calls the governed executor once and does not post-step re-recover after `status: "blocked"`.
  2. Command-chain regression `cli/test/beta-tester-scenarios/bug-108-continuous-terminal-block-no-rerecovery.test.js` proves the external CLI path does not loop.
  3. Patch release ships to npm.
  4. Published package resumes the same tusq.dev session `cont-7dc5b5df` and reaches the dirty-baseline blocker once, without tight looping or requiring process kill.
  5. Same-run evidence exists under `.planning/dogfood-100-turn-evidence/bug-108-reverify-vX.Y.Z.md`.

- [x] **🚨 BUG-109: checkpointed accepted turn left supplemental actor-owned files dirty, blocking natural QA dispatch.** Discovered 2026-04-29 on real `tusq.dev` DOGFOOD-100 using shipped `agentxchain@2.155.62` after BUG-108 reverify. The CLI correctly stopped once at the dirty-baseline blocker, but the blocker proves a separate substrate gap: accepted dev turn `turn_fc4027d5c8789062` was checkpointed at `8da9793c31c084cc1a2d171e63cb180ccee42094` with `files_changed: ["tests/smoke.mjs"]`, while its accepted summary and observed diff summary show retained implementation ownership across `.planning/IMPLEMENTATION_NOTES.md`, `.planning/ROADMAP.md`, `.planning/SYSTEM_SPEC.md`, `.planning/command-surface.md`, `src/cli.js`, `tests/eval-regression.mjs`, `tests/evals/governed-cli-scenarios.json`, `tests/smoke.mjs`, and `website/docs/cli-reference.md`. Checkpointing committed only the declared file and left the supplemental actor-owned files dirty. **Closed 2026-04-29 in `agentxchain@2.155.64`: shipped full-auto `--auto-checkpoint` created supplemental checkpoint `ce2518e9a8cf850b60e032223014326f297f2c5f`, auto-reconciled the active run, and reached natural QA dispatch `turn_f3e829f2485a7cee`. Evidence: `tusq.dev/.planning/dogfood-100-turn-evidence/bug-109-reverify-v2.155.64.md`.**

  **Why this is a framework bug:** the framework's baseline-dirty unchanged exemption can allow retained failed-acceptance work to be accepted and checkpointed incompletely. The next code-writing assignment then hits a generic commit/stash clean-baseline blocker instead of a recoverable checkpoint-required path. DOGFOOD-100 cannot continue without either manual commits or a framework-owned supplemental checkpoint recovery.

  **Fix required:**
  1. Add spec `.planning/BUG_109_SUPPLEMENTAL_CHECKPOINT_RECOVERY_SPEC.md`.
  2. Teach `detectPendingCheckpoint()` to recognize the latest accepted checkpointed turn still owns dirty actor files named in its observed diff summary.
  3. Teach `checkpointAcceptedTurn()` to create a supplemental checkpoint for those files, merge them into history `files_changed`, and advance accepted integration ref.
  4. Preserve fail-closed behavior for dirty files not named in the observed diff summary or when active turns exist.

  **Closure criteria:**
  1. Regression proves next assignment points at `checkpoint-turn` for checkpointed-turn supplemental dirt.
  2. Regression proves `checkpoint-turn` commits supplemental files, updates history, and leaves the recovered paths clean.
  3. Patch release ships to npm.
  4. Published package resumes tusq.dev session `cont-7dc5b5df`, recovers/commits the supplemental checkpoint without manual staging edits, and reaches natural QA dispatch.
  5. Same-run evidence exists under `.planning/dogfood-100-turn-evidence/bug-109-reverify-vX.Y.Z.md`.

- [x] **🚨 BUG-110: fresh Claude local CLI 401/auth failures were treated as retryable QA turn failures instead of typed dispatch blockers.** Discovered 2026-04-29 on real `tusq.dev` DOGFOOD-100 after BUG-109 reached natural QA dispatch. QA turn `turn_f3e829f2485a7cee` emitted `apiKeySource:"none"` and `Failed to authenticate. API Error: 401 ... authentication_error ... Invalid authentication credentials`, wrote no staged result, and was rejected twice into `escalation:retries-exhausted:qa`. **Closed 2026-04-29 in `agentxchain@2.155.65`: `dispatchLocalCli()` classifies fresh Claude auth output as `dispatch:claude_auth_failed` with retained-turn recovery naming `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`, and run-loop persists adapter-declared dispatch blockers without consuming retries.**

- [x] **🚨 BUG-111: retained pre-fix Claude auth retries-exhausted escalation stayed on misleading operator-escalation recovery after BUG-110 shipped.** Discovered 2026-04-29 when `agentxchain@2.155.65` could not transform the already-poisoned Tusq state and only reported `Continuous loop paused on blocker. Recovery: Resolve the escalation, then run agentxchain step --resume`. **Closed 2026-04-29 in `agentxchain@2.155.66`: continuous startup now inspects retained retries-exhausted dispatch logs, detects Claude auth markers, rewrites the active blocker to `dispatch:claude_auth_failed`, clears the stale escalation, and emits `retained_claude_auth_escalation_reclassified`. Evidence: `tusq.dev/.planning/dogfood-100-turn-evidence/bug-111-reverify-v2.155.66.md`.**

- [x] **🚨 BUG-112: retained Claude provider `Request timed out` failures after internal API retries are treated as generic `escalation:retries-exhausted:qa` human decisions instead of full-auto recoverable provider timeouts.** Discovered 2026-04-29 on real `tusq.dev` DOGFOOD-100 using shipped `agentxchain@2.155.66`. Strict session `cont-7dc5b5df` reached counter **97 / 100** when QA turn `turn_aa9664d36f8cac23` in run `run_73ffb608f7c8a510` failed twice before staging. Dispatch stdout shows Claude Code started normally with `apiKeySource:"none"`, emitted ten `api_retry` system events with `error:"unknown"`, then produced synthetic assistant/result content `Request timed out` and exited code 1 with `staged_result_ready:false`. AgentXchain raised `hesc_0aecd7c3d5320547` and blocked on `escalation:retries-exhausted:qa`, violating full-auto by requiring a human decision for a transient provider timeout. **Closed 2026-04-30 in `agentxchain@2.155.67`: continuous startup now inspects retained dispatch logs for explicit provider timeout markers, preserves BUG-111 auth precedence, and auto-reissued `turn_aa9664d36f8cac23 -> turn_70950f4d4473cfc3` without `unblock`, staging edits, or operator `accept-turn`. Evidence: `tusq.dev/.planning/dogfood-100-turn-evidence/bug-112-reverify-v2.155.67.md`. Counter remains 97 because the reissued QA turn exposed BUG-113 before acceptance.**

  **Tester evidence path:** `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.agentxchain/dispatch/turns/turn_aa9664d36f8cac23/stdout.log`

  **Why this is a framework bug:** BUG-100 already established that productive dispatch timeouts with first output and no staged result are recoverable by runner-owned reissue with an extended deadline. The retained turn has first output, no staged result, dispatch-stage failure, and explicit provider timeout text. Surfacing it as `needs_decision` is too vague and burns full-auto even though the substrate has enough evidence to retry once.

  **Required fix:** extend the productive-timeout classifier to inspect retained dispatch logs for explicit provider timeout markers such as `Request timed out`, while keeping BUG-111 auth reclassification higher priority and keeping silent/no-output subprocess failures blocked. Do not treat generic Claude `api_retry` events alone as timeout evidence.

  **Closure criteria:** `agentxchain@2.155.67+` shipped; regression test covers retained Claude provider timeout auto-reissue and a negative `api_retry`-only case; shipped-package reverify on `cont-7dc5b5df` auto-reissues `turn_aa9664d36f8cac23` without `agentxchain unblock`, manual staging edits, or operator `accept-turn`; if the reissued QA turn accepts, append counter value 98 within 30 minutes; evidence saved under `tusq.dev/.planning/dogfood-100-turn-evidence/bug-112-reverify-vX.Y.Z.md`.

- [x] **🚨 BUG-113: Claude Code `TypeError: Object not disposable` under `Node.js v18.13.0` is treated as generic `stdout_attach_failed` ghost retry exhaustion instead of typed Claude runtime incompatibility and automatic retained-state recovery.** Discovered 2026-04-30 during BUG-112 shipped-package reverify on real `tusq.dev` DOGFOOD-100 using `agentxchain@2.155.67`. Strict session `cont-7dc5b5df` stayed at counter **97 / 100**. After BUG-112 auto-reissued QA `turn_aa9664d36f8cac23 -> turn_70950f4d4473cfc3`, the reissued Claude subprocess exited in under one second with stderr `TypeError: Object not disposable` and `Node.js v18.13.0`. AgentXchain classified the failure as `stdout_attach_failed`, auto-retried twice (`turn_70950f4d4473cfc3 -> turn_8d0985d8b75026c2 -> turn_07b1ca892daef9dc`), then paused on `ghost_retry_exhausted` same-signature repeat `[local-qa|qa|stdout_attach_failed]`. **Closed 2026-04-30 in `agentxchain@2.155.69`: published-package reverify recovered the retained ghost blocker with `auto_retry_claude_node_runtime`, emitted `auto_retried_ghost` with `recovery_class: "claude_node_runtime_recovered"`, dispatched through `spawn_wrapper: "claude_compatible_node"`, and reissued `turn_07b1ca892daef9dc -> turn_aa521bedd41f1655` without operator `reissue-turn`, state edits, or `accept-turn`. Evidence: `tusq.dev/.planning/dogfood-100-turn-evidence/bug-113-reverify-v2.155.69.md`. Counter remains 97 because the recovered QA turn exposed BUG-114 before acceptance.**

  **Tester evidence paths:** `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/dogfood-100-turn-evidence/bug-113-discovery-v2.155.67.md`; dispatch logs under `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.agentxchain/dispatch/turns/turn_70950f4d4473cfc3/stdout.log`, `turn_8d0985d8b75026c2/stdout.log`, and `turn_07b1ca892daef9dc/stdout.log`.

  **Why this is a framework bug:** this is not a no-output ghost or product QA failure. The subprocess starts, stderr contains a deterministic Claude Code runtime compatibility error, and a compatible Node 20 binary exists on the machine. The substrate should classify the signature before generic startup-failure handling, avoid burning ghost retry budget, and recover retained DOGFOOD state once the compatible runtime path is available.

  **Required fix:** local CLI adapter detects Claude Node incompatibility stderr and returns typed `dispatch:claude_node_incompatible`; when command name is `claude` and a compatible Node binary is resolvable, spawn the resolved Claude CLI entrypoint through that binary instead of stale `/usr/bin/env node`; continuous startup inspects retained `stdout_attach_failed` ghost logs for this signature and auto-reissues the retained turn if compatible Node is available, clearing stale ghost exhaustion. Preserve generic ghost behavior for non-Claude/no-marker cases.

  **Closure criteria:** `agentxchain@2.155.68+` shipped; regression tests cover fresh adapter classification and retained continuous recovery after ghost exhaustion; shipped-package reverify on `cont-7dc5b5df` auto-recovers retained `turn_07b1ca892daef9dc` without operator `reissue-turn`, manual state edits, or `accept-turn`; if the recovered QA accepts, append counter value 98 within 30 minutes; evidence saved under `tusq.dev/.planning/dogfood-100-turn-evidence/bug-113-reverify-vX.Y.Z.md`.

- [x] **🚨 BUG-114: retained Claude `dispatch:claude_auth_failed` blockers require operator `step --resume` even after credentials are available to the resumed process.** Discovered 2026-04-30 during BUG-113 shipped-package reverify on real `tusq.dev` DOGFOOD-100 using `agentxchain@2.155.69`. Strict session `cont-7dc5b5df` stayed at counter **97 / 100**. BUG-113 correctly auto-reissued retained QA `turn_07b1ca892daef9dc -> turn_aa521bedd41f1655`; the reissued Claude subprocess then failed authentication and AgentXchain correctly typed the state as `blocked_on: "dispatch:claude_auth_failed"`. After the resumed process loaded available Claude credentials, the published CLI still preserved the retained blocker and printed recovery guidance requiring `agentxchain step --resume`. **Closed 2026-04-30 in `agentxchain@2.155.70`: shipped-package reverify auto-reissued retained auth blocker `turn_aa521bedd41f1655 -> turn_c79ca73263c02085` with `auto_retry_claude_auth_refreshed`, emitted `auto_retried_ghost` with `recovery_class: "claude_auth_refreshed"`, and required no `step --resume`, `unblock`, state edit, staging JSON edit, or `accept-turn`. Evidence: `tusq.dev/.planning/dogfood-100-turn-evidence/bug-114-reverify-v2.155.70.md`. Counter remains 97 because the reissued Claude process failed provider auth with `apiKeySource: "ANTHROPIC_API_KEY"` and a direct Claude smoke check with the same loaded environment also failed 401.**

  **Tester evidence paths:** `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/dogfood-100-turn-evidence/bug-113-reverify-v2.155.69.md`; `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/dogfood-100-turn-evidence/bug-114-discovery-v2.155.69.md`; retained state under `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.agentxchain/state.json`; dispatch log under `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.agentxchain/dispatch/turns/turn_aa521bedd41f1655/stdout.log`.

  **Why this is a framework bug:** BUG-110/BUG-111 made Claude auth failures typed and non-retry-burning, which is correct when credentials are missing or invalid. But once credentials are available to the resumed continuous process, preserving the retained `dispatch:claude_auth_failed` blocker forces an operator-side `step --resume`, violating DOGFOOD-100's full-auto recovery rule. The state already retains the failed turn, runtime, and dispatch log evidence needed for a safe reissue.

  **Required fix:** continuous startup detects retained Claude `dispatch:claude_auth_failed` blockers, verifies the active turn is a Claude `local_cli` runtime and the dispatch log contains Claude auth-failure markers, then auto-reissues the turn only when the current process has non-empty Claude auth env (`ANTHROPIC_API_KEY`, `CLAUDE_API_KEY`, or `CLAUDE_CODE_OAUTH_TOKEN`). If credentials are still absent, preserve the typed blocker and existing recovery guidance. Emit `auto_retried_ghost` with `recovery_class: "claude_auth_refreshed"` for machine-readable evidence.

  **Closure criteria:** `agentxchain@2.155.70+` shipped; regression tests cover retained `dispatch:claude_auth_failed` startup recovery after credentials are available; shipped-package reverify on `cont-7dc5b5df` auto-reissues retained `turn_aa521bedd41f1655` without operator `step --resume`, `unblock`, state edits, or `accept-turn`; if the recovered QA accepts, append counter value 98 within 30 minutes; evidence saved under `tusq.dev/.planning/dogfood-100-turn-evidence/bug-114-reverify-vX.Y.Z.md`.

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
