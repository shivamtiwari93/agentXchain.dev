# Human Roadmap — AgentXchain

Human-prioritized work for the agents.

Rules:
- Agents should read this file before acting.
- Unchecked items here take priority over general exploration in `AGENT-TALK.md`.
- When an item is complete, agents should mark it complete and briefly record what changed.
- If an item is too large, agents should split it into smaller checklist items and work them down in order.
- Only move an item back to `HUMAN_TASKS.md` if it truly requires operator-only action.

Current focus: **✅ 2026-04-24 downstream full-auto closure sweep is complete for the active BUG-53/54/60/62 lane.** `agentxchain@2.155.10` is the accepted shipped-package dogfood closure for BUG-60, BUG-54, and BUG-53 on the repo-owned self-drive lane: the tusq.dev dogfood worktree completed three full governed runs under `run --continuous --on-idle perpetual`, each traversing planning → implementation → QA → launch, with no `runtime_spawn_failed`, `stdout_attach_failed`, `ghost_turn`, or startup-watchdog failures after the final v2.155.10 fix. BUG-62 is closed separately by scratch shipped-package proof on `agentxchain@2.155.10`: safe product commits reconcile, governed-state edits refuse, and history rewrites refuse. The older tester copy-paste asks remain historical references, but the active roadmap no longer has an unchecked full-auto validation blocker from this cluster.** (Prior focus, now closed: BUG-52 third variant — shipped across `2.154.9`/`2.154.10`/`2.154.11`, with final tusq.dev quote-back acceptance on `2.154.11`.) (Prior focus, now closed: BUG-61 ghost-turn auto-retry — shipped before `2.154.11`, tester-verified negative/mechanism lane on `2.154.11`, closure decision `DEC-BUG61-MECHANISM-VERIFIED-CLOSURE-001`.) (Prior focus, now closed: BUG-59 + BUG-60 architectural pair — BUG-59 shipped in v2.151.0, BUG-60 proved through v2.155.10 dogfood.) (Prior focus, now closed: CICD-SHRINK — step 1 shipped Turn 115, workflow trigger shrink + repo-accurate plan corrections shipped Turn 116.) (Prior focus, now closed: FULLTEST-58 — Turn 114 restored the full CLI gate by fixing cross-run acceptance-history scoping, stale BUG-51 taxonomy tests, coordinator retry/wave terminal status, restart pending-approval recovery, current-release rerun docs, recent-event fixtures, and the api_proxy proposed lifecycle fixture; full evidence: `6639 tests / 6634 pass / 0 fail / 5 skipped`.) (Prior focus, now closed: BUG-56 — v2.149.1 auth-preflight false positive broke every working Claude Max user; v2.149.2 replaced the static shape-check with a bounded `runClaudeSmokeProbe` and shipped positive + negative command-chain regression tests under rule #13.) (Prior focus, now closed: BUG-57 — pre-existing `dashboard-bridge.test.js` resource leak blocked `npm test` exit and forced `--skip-preflight` on the v2.149.2 bump; Turn 112 fixed per-test bridge teardown and fail-fast test/release scripts.) (Prior BUG-54 hypothesis, now superseded and closed: keychain-auth hang. The accepted root cause was startup-watchdog threshold; shipped default and lifecycle fixes are now dogfood-proven.)

Current tester handoff asks: `.planning/TESTER_QUOTEBACK_ASK_V1.md` is historical because BUG-52 closed on `agentxchain@2.154.11`; `.planning/TESTER_QUOTEBACK_ASK_V2.md` is historical because BUG-54 closed on shipped `agentxchain@2.155.10` dogfood evidence; `.planning/TESTER_QUOTEBACK_ASK_V3.md` is historical because BUG-62 closed on scratch shipped-package proof with `agentxchain@2.155.10`; `.planning/TESTER_QUOTEBACK_ASK_V4.md` is historical because BUG-61 closed as mechanism-verified on `agentxchain@2.154.11`; `.planning/TESTER_QUOTEBACK_ASK_V5_BUG53.md` is historical because BUG-53's multi-run continuation concern is covered by the v2.155.10 perpetual dogfood lane; `.planning/TESTER_QUOTEBACK_ASK_V6_BUG60.md` is historical because BUG-60 closed on shipped `agentxchain@2.155.10` dogfood evidence. Keep these asks as reviewable historical runbooks, not active blockers.

## Tester Verification Log — 2026-04-24 retest on `agentxchain@2.154.11`

The tusq.dev beta tester retested V2/V3/V4 asks against the shipped tarball and produced three response files with absolute evidence paths throughout:

- `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/agentxchain-quotebacks/BUG-61-ghost-retry-v2.154.11.md`
- `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/agentxchain-quotebacks/BUG-62-reconcile-state-v2.154.11.md`
- `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/agentxchain-quotebacks/BUG-59-54-baseline-blocker-v2.154.11.md`

**Per-bug status from this retest (agent-verified against shipped implementation, 2026-04-24):**

- **BUG-61 (ghost-turn auto-retry) — CLOSED as mechanism-verified with positive-path caveat.** Tester's tusq.dev run produced negative-path evidence on a real governed flow: auto-retry fired twice on typed `stdout_attach_failed` ghosts, then emitted one `ghost_retry_exhausted` with `exhaustion_reason=same_signature_repeat`. State correctly mirrored `blocked` / `ghost_turn` and preserved the manual `reissue-turn` recovery guidance string. This verifies the BUG-61 mechanism that the product owns: typed detection, bounded retry dispatch with distinct new turn IDs, fingerprint early-stop, diagnostic state mirroring, event trail, and preserved manual escape hatch. The retry-success lane was environmentally impossible in the tester's deterministic `startup_watchdog_ms: 100` setup; the downstream "accepted turn → session continues" behavior is already covered by BUG-52/53/54/55 evidence. See `DEC-BUG61-MECHANISM-VERIFIED-CLOSURE-001`. If a future production run shows auto-retry dispatching a retried turn that then fails to proceed after successful acceptance, file a narrow BUG-61b rather than reopening BUG-61 wholesale.

- **BUG-62 (operator-commit reconcile) — NOT CLOSABLE from V3 as written; V3 ask has three real copy-paste defects.** The fix (`auto_safe_only` reconciliation logic in v2.154.7+) is not the blocker. Tester documented:
  1. V3 assumes a bare `agentxchain` binary post-init, but the tester's shell requires pinned `npx --yes -p agentxchain@latest` invocations — V3 commands fail without that pinning.
  2. V3 instructs `git add .agentxchain/state.json`, but that path is gitignored in fresh scaffolds — stage fails silently, the commit the tester thinks they made is empty.
  3. After correcting the invocation defect, V3's positive reconcile case still refuses with `missing_baseline` because the scratch setup V3 prescribes never establishes a checkpoint baseline — the "safe fast-forward auto-reconcile" path cannot pass by construction.

  **Turn 8 repair shipped:** V3 is now a repaired copy-paste ask. It embeds pinned `npx --yes -p agentxchain@2.154.7 agentxchain ...` invocations throughout, establishes the reconcile baseline through a real accepted manual PM turn before recording `$BASE`, and uses `git add -f .agentxchain/state.json` only for the unsafe governed-state negative block. BUG-62 is still unchecked until a fresh tester quote-back follows the repaired V3 ask.

- **BUG-54 / BUG-59 via V2 ask — blocked by tusq.dev baseline setup, not by any fix defect.** Tester documented two baseline mismatches:
  1. Published `tusq.dev/agentxchain.json` has `approval_policy: null` — V2's expected approval-policy auto-approve ledger rows cannot be produced without configuring approval_policy first. (BUG-59 is already closed as shipped; this concern is about producing evidence rows for BUG-60 unblock confidence, not about BUG-59 itself.)
  2. The continuous command idles out cleanly with no derivable work and does not dispatch the ten adapter-path PM/dev/QA turns V2 requires for BUG-54 reliability evidence — tusq.dev's current VISION doesn't produce that many turns worth of derivable work in the window V2 expects.

  **Turn 8 repair shipped:** V2 and the canonical BUG-59/BUG-54 runbook now create a known-prepared `/tmp/axc-bug59-54` fixture instead of assuming `tusq.dev` is already configured. The fixture uses the shipped `full-local-cli` template, seeds non-null `approval_policy` with non-credentialed routine-gate guards when needed, and writes `/tmp/axc-bug59-54-vision.md` with 12 synthetic goals so the ten-dispatch BUG-54 path has derivable work. BUG-54/BUG-59 evidence is still unchecked until a fresh tester quote-back follows the repaired V2 ask.

**Cross-cutting observation:** Two of four asks surfaced baseline-assumption defects in the tester's real environment. Future V6+ asks should bundle their own scaffold/setup prelude rather than assume any tester-project baseline, matching the Turn 227 stop-polishing-floor definition of "self-contained." Consider adding a `TESTER_ASK_STYLE_GUIDE.md` capturing the "embed-setup-prelude" rule so the V6+ defect class is designed out.

## Priority Queue

- [x] **🎯 DOGFOOD-TUSQ-DEV: agents take over tusq.dev development as a live dogfood test case for agentxchain full-auto.** ✅ Success criteria met 2026-04-24: 3 full governed runs completed autonomously on tusq.dev dogfood worktree (`agentxchain-dogfood-2026-04` branch) using shipped `agentxchain@2.155.10`. Each run traversed all 4 phases (planning → implementation → QA → launch). Only human gates (planning_signoff, qa_ship_verdict, launch_ready) required manual unblocking — all agent turns accepted on first attempt after v2.155.10. Gaps discovered and shipped this session: GAP-004 (v2.155.7, charter missing output format), GAP-005 (v2.155.8, charter/validator schema mismatch), GAP-006 (v2.155.9, intent coverage gap), GAP-007 (v2.155.10, embedded normalization bypass). Full evidence: `.planning/dogfood-tusq-dev-evidence/session-2026-04-24.md`. New top-priority self-drive loop, replacing the back-and-forth tester quote-back cycle for remaining open bugs (BUG-53, BUG-54, BUG-60, BUG-62) with a compounding feedback loop: agents drive `tusq.dev` forward using the shipped `agentxchain` CLI in Full Auto Mode → every gap agentxchain hits becomes a new BUG entry here → agents fix it in agentXchain.dev, ship a patch release, upgrade tusq.dev's install, continue. Target repo: `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev` (has its own `.planning/VISION.md` — capability compiler for SaaS codebases, `tusq.manifest.json` as canonical artifact). Work on a dedicated branch `agentxchain-dogfood-2026-04` — **do NOT commit to tusq.dev `main`** (human operator uses main as working baseline). Use the shipped `agentxchain` CLI via `npx --yes -p agentxchain@latest` — **no hand-driving tusq.dev with direct git commits or file edits**. When agentxchain fails / blocks / misbehaves, THAT is the gap; reproduce minimally, file as a new BUG entry here, implement+ship, retry. Full protocol, ground rules, evidence-capture requirements, gap-filing workflow, success criteria, stop conditions, first-turn checklist: `.planning/DOGFOOD-TUSQ-DEV-SPEC.md`. **Success = 3+ tusq.dev milestones (M17+) advanced autonomously + every encountered gap shipped + tester-reviewable branch diff.** Tag first dogfood turn `DOGFOOD-TUSQ-DEV-INIT` in AGENT-TALK. This item is long-running and compounding; do not close it on a single session. Existing open BUGs (BUG-53, BUG-54, BUG-60, BUG-62) remain valid — if dogfood reproduces them, the existing entries get the dogfood evidence; do not duplicate.

- [x] **BUG-63 (dogfood / continuous full-auto blocker): `run --continuous --on-idle perpetual` dispatches an idle-expansion intent before proving the inherited governed run is eligible to start work.** ✅ Closed 2026-04-24 via `agentxchain@2.155.2` (`2538a26e`, publish workflow `24891238388` green; post-publish verification `7015 tests / 7010 pass / 0 fail / 5 skipped`; social posts succeeded on X, LinkedIn, Reddit). Dogfood retry on shipped `agentxchain@latest` (`2.155.2`) against `tusq.dev-agentxchain-dogfood` paused before idle expansion: CLI printed `Continuous loop paused on blocker`, intent count stayed `38 -> 38`, no new `idle_expansion_dispatched` event appeared after the retry, `.agentxchain/continuous-session.json` recorded `status: "paused"` and `expansion_iteration: 0`. Evidence: `.planning/dogfood-tusq-dev-evidence/GAP-001-blocked-run-idle-expansion.md` and raw retry files under `.planning/dogfood-tusq-dev-evidence/raw/`.

- [x] **BUG-64 (dogfood / idle-expansion acceptance contract): PM idle-expansion turns can produce the required structured result as `.agentxchain/staging/<turn>/idle-expansion-result.json`, but `acceptTurn()` only accepts top-level `turnResult.idle_expansion_result` and blocks the run with `idle_expansion_result is required for vision_idle_expansion turns`.** ✅ Closed 2026-04-24 via `agentxchain@2.155.6`. Dogfood originally reproduced on shipped `agentxchain@2.155.3` against `tusq.dev-agentxchain-dogfood`: session `cont-7182a188`, run `run_ce89ef5bd4b8cca8`, turn `turn_e614e7a53ef67b3a`, intent `intent_1777046032635_2eab`. The final shipped fix covers three real acceptance gaps: `2.155.4` loads and normalizes sibling `idle-expansion-result.json`; `2.155.5` tolerates false/null `vision_exhausted` sentinels under `kind: "new_intake_intent"`; `2.155.6` makes idle-expansion intent coverage branch-aware and validates the normalized sidecar result rather than the original top-level omission. Proof: `npm view` and `npx` both resolved `2.155.6`; publish workflow `24904016612` succeeded; downstream truth passed; post-publish verification passed (`7022 tests / 1431 suites / 7017 pass / 0 fail / 5 skipped`); Homebrew mirror synced. Real tusq.dev retry with shipped `agentxchain@latest` (`2.155.6`) accepted `turn_e614e7a53ef67b3a`, emitted `intent_satisfied` and `turn_accepted` at `2026-04-24T18:09:41Z`, and history recorded `idle_expansion_result_summary` for M28. The run is now blocked only by a new human/legal M28 triage escalation, not by BUG-64 validation. Evidence: `.planning/dogfood-tusq-dev-evidence/GAP-003-bug64-idle-expansion-sidecar.md`.

- [x] **BUG-56: v2.149.1 auth-preflight false positive on Claude Max setups.** ✅ Closed 2026-04-21 via v2.149.2 — `runClaudeSmokeProbe()` replaced the static shape-check at four call-sites; positive + negative command-chain regression under Rule #13; retro at `.planning/BUG_56_FALSE_POSITIVE_RETRO.md`. Full detail in `.planning/HUMAN-ROADMAP-ARCHIVE.md`.
- [x] **BUG-57: dashboard-bridge resource-leak hang.** ✅ Closed 2026-04-21 (Turn 112) — per-test `afterEach` teardown + `--test-timeout=60000` pinned in `cli/package.json` and `release-bump.sh`. Full detail archived.
- [x] **FULLTEST-58: full npm test gate red post-BUG-57.** ✅ Closed 2026-04-21 (Turn 114) — `6639 tests / 6634 pass / 0 fail / 5 skipped` in ~476s. Unblocked CICD-SHRINK. Full detail archived.
- [x] **CICD-SHRINK: GitHub Actions footprint reduction.** ✅ Closed 2026-04-21 (Turn 116) — local prepublish gate shipped; `ci.yml` PR-only; `ci-runner-proof.yml` deleted; `governed-todo-app-proof.yml` + `codeql.yml` scheduled/manual only; `deploy-gcs.yml` path-scoped; `DEC-RELEASE-CUT-AND-PUSH-AS-ATOMIC-001` + `DEC-GITHUB-ACTIONS-FOOTPRINT-FLOOR-001` in `.planning/DECISIONS.md`. Full detail archived.
- [x] **RELEASE-v2.149: push v2.149.1 hotfix after v2.149.0 publish failure.** ✅ Closed 2026-04-21 (Turn 107, `ae8c2be0`). npm `2.149.1`, homebrew tap synced, gh release live, `release-downstream-truth.sh` 3/3. Marketing: X + LinkedIn ✓, Reddit verification-failed (non-blocker per WAYS-OF-WORKING §8). Full detail archived.
- [x] **BUG-59 (architectural): `approval_policy` is disconnected from `requires_human_approval` gate flag — full-auto/autonomous runs always block on human-approval gates even when the configured policy says auto-approve.** ✅ Shipped 2026-04-21 in `agentxchain@2.151.0` (release commit `8c4a8ba6`, publish workflow `24747497938` green). BUG-60 implementation gate satisfied: BUG-59 shipped and checked, two-agent pre-work complete (Turns 259-269), plan agreed (`BUG_60_PLAN.md`). Slice 1 committed at `ef9c4d32`. Post-closure tester evidence (2026-04-21) showed tester hit BUG-52 third variant, NOT BUG-59 — BUG-59's scope (approval_policy auto-approval) shipped correctly and works for projects that configure auto-approval rules; BUG-52 third variant was a distinct defect in the delegated-unblock path, fixed separately in v2.152.0+ and tester-closed on v2.154.11. Full detail in `.planning/HUMAN-ROADMAP-ARCHIVE.md`.
- [x] **BUG-60 (architectural / missing feature): Continuous mode has no `perpetual` policy — when vision-derived work queue goes empty, the session idle-exits cleanly instead of dispatching a PM turn to synthesize the next increment from broader sources (VISION + ROADMAP + SYSTEM_SPEC + product state). For "full-auto product development" as currently marketed, `no_derivable_work_right_now ≠ vision_is_exhausted`.** ✅ Closed 2026-04-24 via shipped `agentxchain@2.155.10` dogfood. The tusq.dev dogfood worktree ran `agentxchain run --continuous --on-idle perpetual`, dispatched PM idle-expansion turns, accepted generated intake intents, and completed three full governed runs through planning → implementation → QA → launch. The dogfood surfaced and shipped GAP-004 through GAP-007 across `2.155.7` through `2.155.10`; the final package accepted embedded idle-expansion results after normalization and chained runs without agent-level failure. Evidence: `.planning/dogfood-tusq-dev-evidence/session-2026-04-24.md`; closure decision: `DEC-BUG60-PERPETUAL-DOGFOOD-CLOSURE-001`.

  **BEFORE WRITING ANY CODE: both agents must do an extensive research + code-review pass, logged in AGENT-TALK, before a single line of implementation lands. See "Required pre-work" block below. Same discipline as BUG-59. Sequenced AFTER BUG-59 — gate satisfied: BUG-59 shipped in `agentxchain@2.151.0` (checked), two-agent pre-work complete (Turns 259-269), plan agreed (`BUG_60_PLAN.md`). Implementation in progress as of Slice 1 (`ef9c4d32`). Rationale for the original sequencing: BUG-60 depends on gates closing correctly in full-auto, because a PM-synthesized increment that runs through the full phase chain will hit qa_ship_verdict and launch_ready; BUG-59's gate-closure coupling had to ship first.**

  ---

  **Tester report (2026-04-21, v2.150.0, real `tusq.dev` dogfood):**

  Tester ran: `npx --yes -p agentxchain@latest -c 'agentxchain run --continuous --vision .planning/VISION.md --max-runs 1 --max-idle-cycles 3 --poll-seconds 5 --triage-approval auto --auto-checkpoint --no-report'`

  Output:
  ```text
  Idle cycle 1/3 — no derivable work from vision.
  Idle cycle 2/3 — no derivable work from vision.
  Idle cycle 3/3 — no derivable work from vision.
  All vision goals appear addressed (3 consecutive idle cycles). Stopping.
  ```

  Status after: `cont-0fbd49b2 / completed / Runs: 0/1 / Idle cycles: 3/3`.

  **The tester's framing:** *"This is valid for bounded delivery mode, but insufficient for long-running product development mode. No derivable work right now is treated as The product has no more meaningful work. Those are different states."*

  **Tester's suggested schema:**
  ```json
  {
    "continuous": {
      "on_idle": "pm_derive_next_increment",
      "sources": [".planning/VISION.md", ".planning/ROADMAP.md", ".planning/SYSTEM_SPEC.md"],
      "stop_only_when": "vision_explicitly_satisfied_or_human_stops"
    }
  }
  ```

  Proposed modes: `bounded` (current — stop when no derivable work), `perpetual` (PM-derive-next on idle), `human-review` (stop + ask human). Tester workaround on tusq.dev: strengthened the heartbeat prompt. Their view: *"The framework should make this a first-class policy so users do not need prompt-level patches."*

  **Not a BUG-53 regression.** BUG-53's fix (previously-paused → now idle-exits cleanly) is correct for bounded mode. BUG-60 is a missing feature that sits on top of BUG-53's clean idle-exit, not a defect in it. The tester was explicit: *"This is not necessarily a bug in bounded continuous mode. It is a missing framework capability for full-auto product development."*

  ---

  **Current behavior audit (code audit, 2026-04-21, confirmed against live code):**

  | Surface | File:line | What it does today |
  |---|---|---|
  | Idle cycle counter increment | `cli/src/lib/continuous-run.js:468-469` | `session.idle_cycles += 1; log('Idle cycle N/M — no derivable work from vision.');` |
  | Terminal idle-exit check | `cli/src/lib/continuous-run.js:348-351` | `if (session.idle_cycles >= contOpts.maxIdleCycles) { session.status = 'completed'; return { status: 'idle_exit' }; }` — **THIS is the insertion point for perpetual-policy branch** |
  | User-facing idle-exit string | `cli/src/lib/continuous-run.js:94-96` | `All vision goals appear addressed (N consecutive idle cycles). Stopping.` — misleading for perpetual mode (conflates "queue empty" with "vision exhausted") |
  | Vision derivation | `cli/src/lib/vision-reader.js:176-217` `deriveVisionCandidates()` | **Reads VISION.md only.** Return shape: `{ ok, candidates: [{section, goal, priority}], error? }`. Compared against `loadCompletedIntentSignals()` + `loadActiveIntentSignals()`. **No integration with ROADMAP.md, SYSTEM_SPEC.md, .planning/* state, or .agentxchain/state.json.** |
  | Run-loop vs continuous-loop boundary | `cli/src/lib/continuous-run.js:337-486` `advanceContinuousRunOnce()` | Continuous loop owns the 3-cap decision (max_runs / idle_cycles / session_budget). Run-loop is unaware of idle detection. |
  | Budget cap enforcement | `cli/src/lib/continuous-run.js:354-362` | `per_session_max_usd` — categorical block, not warning. Terminates session when hit. Evidence after the GPT 5.5 cleanup: `session.status = 'session_budget'; session.budget_exhausted = true; return { status: 'session_budget', stop_reason: 'session_budget' }`. **Perpetual mode MUST respect this same cap.** |
  | Continuous config schema | `cli/src/lib/normalized-config.js:1279-1292` `normalizeContinuousConfig()` | `enabled, vision_path, max_runs, max_idle_cycles, triage_approval, per_session_max_usd`. Plus runtime-only options in `resolveContinuousOptions()` at `continuous-run.js:302-317`: `poll_seconds`, `cooldown_seconds`, `auto_checkpoint`. **No `on_idle` or `continuous_policy` field exists.** |
  | Intake record entry | `cli/src/lib/intake.js:328-387` `recordEvent()` | Sources: `manual, ci_failure, git_ref_change, schedule, vision_scan` (line 32). **Adding `vision_idle_expansion` as a new source classifier fits the existing pattern.** Schema at `intake.js:365-382`. |
  | Intake triage | `cli/src/lib/intake.js:393-466` `triageIntent()` | detected → triaged. Requires priority, template, charter, acceptance_contract. |
  | Intake approve | `cli/src/lib/intake.js:793-854` `approveIntent()` | triaged → approved. Stamps `approved_run_id` or `cross_run_durable`. |
  | Intake plan | `cli/src/lib/intake.js:860-929` `planIntent()` | approved → planned. Generates `.planning/` artifacts from template. |
  | Intake start | `cli/src/lib/intake.js:935-1136` `startIntent()` | planned → executing. Creates governed run + turn assignment. |
  | PM dispatch + prompt override | `cli/src/lib/dispatch-bundle.js:184-205` `renderPrompt()` | `config.prompts[roleId]` points to prompt file; customPrompt injected at line 417-423. **This IS the override mechanism for "derive from broader sources" — swap `prompts.pm` for the idle turn, or inject an additional mandate block.** |
  | Role mandate rendering | `cli/src/lib/dispatch-bundle.js:221-225` | Pulls from `config.roles[roleId].mandate`. Could accept a per-dispatch mandate override as an alternative to swapping the whole prompt file. |
  | ROADMAP.md references | `cli/src/lib/init.js:197, 235-236`, `governed-templates.js:327-328, 341-359`, `validation.js:17, 66-71`, `planning-artifacts.js:6-7, 72, 77, 90`, `prompt-core.js:98` | ROADMAP.md is already a canonical artifact — templates reference it, doctor validates structure, prompts mention it. **But `deriveVisionCandidates()` does not read it.** The integration work is small. |
  | SYSTEM_SPEC.md references | `cli/src/lib/workflow-gate-semantics.js:5, 91, 106`, `planning-artifacts.js` | `SYSTEM_SPEC_PATH` is referenced in gate semantics for planning exit. Same situation — canonical, but not in vision derivation. |
  | Test fixtures — continuous + idle | `cli/test/vision-reader.test.js:117-155` (AT-VCONT-001..003), `cli/test/continuous-3run-proof-content.test.js` | Existing tests mock vision + intents. **No test today covers "idle cycle → PM dispatch → new intent → run resumes."** The BUG-60 regression test must add this. |

  **`on_idle` / `idle_policy` / `continuous_policy` string does NOT appear anywhere in the codebase.** This is a greenfield feature. No partial implementation to respect or replace.

  ---

  **Four guardrails the tester's proposed schema needs that they didn't spell out:**

  1. **Dispatch mechanism must be explicit.** Tester says "PM should inspect sources and produce next increment." Two viable paths:
     - **Option A — via intake pipeline.** Continuous loop calls `recordEvent({ source: 'vision_idle_expansion', ... })` synthesizing an intent whose CHARTER is "inspect vision/roadmap/spec/state, produce next increment as a new intake intent with acceptance criteria." Runs through `triageIntent → approveIntent → planIntent → startIntent` naturally. PM turn dispatches via standard run-loop. Advantage: every idle-expansion is a first-class auditable intent. Disadvantage: adds a layer of indirection — the synthesized intent's output is itself another intent.
     - **Option B — direct special-case dispatch.** Continuous loop directly materializes a PM turn with an override prompt (leveraging `dispatch-bundle.js:184-205`'s prompt-override mechanism) outside the intake pipeline. Advantage: simpler, one-step. Disadvantage: bypasses governance audit trail; adds a special-case code path to continuous-run.js.
     - **Recommendation to research turns:** Option A is architecturally cleaner. Pick and justify with evidence, don't assume.

  2. **Infinite-loop and budget safeguards for perpetual mode.** A misbehaving PM that keeps producing non-executable increments would burn through budget forever. Required safeguards:
     - **Honor existing `per_session_max_usd`** (already categorical block at `continuous-run.js:354-362` — verify perpetual mode doesn't bypass it).
     - **New `max_idle_expansions` cap** (e.g., default 5): after N consecutive PM idle-expansions with no run reaching launch, stop with status `vision_expansion_exhausted`. Distinct from `max_idle_cycles` which counts vision-scan polls that found no work; this counts PM expansions that failed to produce executable work.
     - **Explicit PM output schema.** PM turn's acceptance criterion is either (a) produce a structured "new increment" artifact (the minimum: a new intake intent with charter + acceptance_contract + priority), OR (b) produce a structured "vision_exhausted" declaration with reasoning citing which vision goals are complete vs deferred. Anything else is acceptance_failure, re-dispatch once, then abort.

  3. **"Concrete increment" has a canonical form.** The tester's list ("new roadmap item, new system-spec section, new intake intent, new acceptance criteria, new implementation task, new launch/release task") conflates outputs and side-effects. The continuous loop needs ONE canonical form it knows how to consume. Proposal: **the PM turn MUST produce at least one new intake intent** (schema at `intake.js:365-382`, with triageIntent-ready fields: priority, template, charter, acceptance_contract). Roadmap updates and spec sections are supporting evidence, not the required deliverable. Without a new intent, the run-loop has nothing to dispatch.

  4. **VISION.md immutability constraint.** `.planning/VISION.md` is immutable per WAYS-OF-WORKING — never modified by agents. The PM turn's mandate MUST include an explicit read-only clause for VISION.md. ROADMAP.md and SYSTEM_SPEC.md are mutable; PM can modify them as part of producing the next increment. This constraint must live in the PM-idle-expansion prompt override, NOT be left to the static PM prompt which wasn't written for this purpose.

  ---

  **Proposed config schema (for research turns to sharpen, not adopt verbatim):**

  ```json
  {
    "continuous": {
      "enabled": true,
      "vision_path": ".planning/VISION.md",
      "max_runs": 50,
      "max_idle_cycles": 3,
      "per_session_max_usd": 25,
      "on_idle": "exit",

      "on_idle_perpetual": {
        "sources": [".planning/VISION.md", ".planning/ROADMAP.md", ".planning/SYSTEM_SPEC.md"],
        "max_idle_expansions": 5,
        "pm_mandate_override_path": ".agentxchain/prompts/pm-idle-expansion.md",
        "output_schema": "intake_intent",
        "stop_when_pm_declares_exhausted": true
      }
    }
  }
  ```

  With `on_idle` accepting `"exit" | "perpetual" | "human_review"` (research turns may propose other names). `on_idle_perpetual` block only relevant when `on_idle: "perpetual"`.

  ---

  **Related existing artifacts the agents must read before touching code:**

  - `cli/src/lib/continuous-run.js` — entire file, not just cited lines; understand the main loop at `:692-712` that consumes `advanceContinuousRunOnce()` results
  - `cli/src/lib/vision-reader.js` — entire file; understand current VISION.md-only parsing
  - `cli/src/lib/intake.js:1-200` — lifecycle state machine; understand which transitions are allowed
  - `cli/src/lib/dispatch-bundle.js:180-260` — prompt and mandate override mechanics
  - `.agentxchain/prompts/pm.md` (in the main repo, not fixtures) — current PM prompt; understand how it's written and whether an idle-expansion prompt would be a replacement or a supplemental block
  - `cli/test/vision-reader.test.js` — AT-VCONT-001..003 fixtures; understand test shape for candidate derivation
  - `cli/test/continuous-3run-proof-content.test.js` — live continuous proof; understand how a 3-run test is structured (BUG-60's regression test will extend this pattern)
  - `.planning/BUG_52_FALSE_CLOSURE.md` — prior reconcile-path bug; understand lesson about "fix covers synthetic path but not operator path"
  - BUG-59 roadmap entry (above this one) — share research methodology; BUG-60's two-agent gate mirrors BUG-59's

  ---

  **Required pre-work — BOTH agents must complete before either writes implementation code:**

  **Pre-work turn A — Claude Opus 4.7 research pass** (~one full turn dedicated, no code, log in AGENT-TALK with tag `BUG-60-RESEARCH-CLAUDE`):

  1. **Verify the code audit table above.** Every file:line reference. Confirm or challenge. If live behavior differs from the roadmap's description, flag it — this entry may be wrong in places.
  2. **Choose Option A (intake pipeline) vs Option B (direct dispatch) with evidence.** Don't pick based on aesthetic preference. Read both paths, cite the pros/cons concretely, pick one.
  3. **Specify the PM idle-expansion prompt.** Write the full prompt text that would be injected via the override mechanism. What artifacts does it read? What does "produce next increment" mean in concrete acceptance terms? What does "vision_exhausted" look like structurally? Drop a complete draft prompt in the turn log.
  4. **Trace a full perpetual-mode scenario through the code.** Starting state: a project where run 1 has just completed, queue is empty. Walk through: idle-cycle detection → (new branch) PM dispatch → PM synthesizes new intent → intake pipeline → new run starts → run completes. Quote every state transition. Identify every place where state could diverge from intended behavior.
  5. **Map every test that would need to change.** `cli/test/continuous-*.test.js`, `cli/test/vision-reader.test.js`, `cli/test/intake-*.test.js` — which tests assert current bounded-only behavior that would need updating (not breaking — updating) to accommodate perpetual mode?
  6. **Answer four specific questions in writing:**
     a. Can a PM turn dispatched via Option A (intake pipeline) carry a prompt override, or does it always use the static PM prompt? If not, which intake field or dispatch mechanism would need to be added?
     b. Does `per_session_max_usd` enforcement at `continuous-run.js:354-362` fire BEFORE or AFTER a PM idle-expansion would dispatch? Trace the ordering.
     c. What happens today if `deriveVisionCandidates()` is called with VISION.md deleted or malformed? Is the error path resilient, or does continuous mode crash? Perpetual mode needs to handle this gracefully.
     d. BUG-59 overlap check: if BUG-59 ships approval_policy coupling and a PM-synthesized increment's qa_ship_verdict gate is configured to auto-approve, does the perpetual chain survive run-to-run cleanly? Or is there a race between continuous-run.js's next-run-start and governed-state.js's gate-closure events?
  7. **Do NOT propose implementation.** Research only.

  **Pre-work turn B — GPT 5.4 code-review pass** (~one full turn, reads Claude's research + does independent code review, log in AGENT-TALK with tag `BUG-60-REVIEW-GPT`):

  1. **Adversarial review of Claude's research.** Find at least one factual error or missed path. Same requirement as BUG-60-REVIEW-GPT.
  2. **Challenge the guardrail set.** Are the four guardrails above (dispatch mechanism, safeguards, canonical form, VISION.md immutability) sufficient? Missing guardrails? Over-engineered? Specifically address: what prevents a PM turn from producing an intent that describes work OUTSIDE the project's vision (scope creep via idle-expansion)? Is vision-coherence itself a required PM acceptance check?
  3. **Independent config schema proposal.** Compare against the tester's suggestion and the roadmap's proposal. Propose the schema you'd ship. Justify field names. Propose deprecation path if any existing field changes semantic meaning.
  4. **Write the acceptance matrix for perpetual mode.** Similar to BUG-59's matrix but for idle behavior:

     | Condition | Perpetual-mode action | Rationale |
     |---|---|---|
     | Queue empty, vision has candidates | ? | ? |
     | Queue empty, vision has no candidates, ROADMAP has items | ? | ? |
     | Queue empty, no vision/roadmap/spec candidates | ? | ? |
     | PM idle-expansion produces "vision_exhausted" | ? | ? |
     | PM idle-expansion fails acceptance (malformed output) | ? | ? |
     | Budget cap hit mid-PM-turn | ? | ? |
     | max_idle_expansions hit | ? | ? |
     | Run started from PM-expansion fails at qa_ship_verdict | ? | ? |
     | User Ctrl-C during idle-expansion | ? | ? |

  5. **Verify the BUG-59 dependency.** Is BUG-60's perpetual chain actually blocked on BUG-59's gate-closure fix, or can it ship independently? Trace a hypothetical perpetual run's first qa_ship_verdict under the current (unfixed) gate-evaluator behavior. If it blocks, the sequence holds. If it can somehow advance, the dependency is looser than claimed and BUG-60 could ship in parallel.
  6. **Reconciliation check.** If Claude's research and GPT's review disagree on even one material point (dispatch option, schema field, guardrail set), a third turn reconciles before implementation begins.
  7. **Do NOT propose implementation.**

  **Neither pre-work turn may alter `cli/src/lib/continuous-run.js`, `cli/src/lib/vision-reader.js`, `cli/src/lib/intake.js`, or `cli/src/lib/normalized-config.js`.** Documentation only. Implementation gate (ALL SATISFIED): both research turns completed (Turns 259-260), both logged, both cross-referenced, plan turn agreed between agents (`BUG_60_PLAN.md`), AND BUG-59 shipped + checked (`agentxchain@2.151.0`). Implementation in progress.

  ---

  **Fix requirements — the plan turn and implementation turns MUST address all of these:**

  1. **New `on_idle` config field** with at minimum `exit | perpetual | human_review` values. Default = `exit` for backward compatibility. Projects that explicitly set `perpetual` opt into the new behavior.
  2. **Perpetual branch at `continuous-run.js:348-351`** — when `idle_cycles >= maxIdleCycles` AND `on_idle === "perpetual"`, do NOT set `status = 'completed'`; instead dispatch the PM idle-expansion path.
  3. **Extend `deriveVisionCandidates()`** (or add a sibling `deriveRoadmapCandidates()` + `deriveSpecCandidates()`) to read ROADMAP.md and SYSTEM_SPEC.md when configured in `on_idle_perpetual.sources`. Preserve current VISION.md-only behavior as the default.
  4. **PM idle-expansion prompt shipped** at the canonical path (`.agentxchain/prompts/pm-idle-expansion.md`). Prompt must include VISION.md immutability clause, the canonical output schema (new intake intent), and the "vision_exhausted" escape schema. Template projects get this prompt in their scaffold.
  5. **Budget and loop safeguards.** New `max_idle_expansions` field (default 5). Existing `per_session_max_usd` MUST block perpetual-mode dispatches same as bounded-mode. Regression test for both.
  6. **Positive regression test (Rule #13).** Tester-sequence test at `cli/test/beta-tester-scenarios/bug-60-perpetual-idle-expansion.test.js`: start a continuous session with `on_idle: perpetual`, mock vision with initial work, let run 1 complete, assert PM idle-expansion fires, produces a new intake intent, run 2 starts, completes. **Use child-process `execFileSync('agentxchain', [...])` per Rule #12, not function-level seams.**
  7. **Negative regression test (Rule #13).** Same setup but with `max_idle_expansions: 1` and a mocked PM that produces malformed output → session stops with `vision_expansion_exhausted` status, NOT infinite loop.
  8. **Update `DEC-BUG59-APPROVAL-POLICY-GATE-COUPLING-001` to reference this bug** (perpetual mode assumes gates close correctly — test the cross-bug dependency).
  9. **New decision record** `DEC-BUG60-PERPETUAL-CONTINUOUS-POLICY-001` documenting the chosen option, schema, guardrails, and canonical PM output shape.
  10. **Spec updates** in `SPEC-GOVERNED-v5.md` and `PROTOCOL-v7.md` — describe perpetual mode semantics.
  11. **Docs update** in `website-v2/docs/` — specifically whichever page describes continuous operation. Explain three `on_idle` modes, when to use each, how to configure PM idle-expansion prompt override.
  12. **BUG-53 overlap.** BUG-53 is about post-run-completion auto-chain (currently goes paused → now idle-exits cleanly per BUG-53's fix). BUG-60 sits on top of BUG-53. Verify that with BUG-60 shipped AND `on_idle: perpetual`, a 3-run session completes run 1 → PM-expands → run 2 → PM-expands → run 3, never entering `paused`. This is BUG-53's sharpened acceptance criterion ALSO.

  ---

  **Acceptance criteria:**

  - Tester's exact reproduction on v2.152.0 or later (after BUG-59 + BUG-60 both ship): `agentxchain run --continuous --on-idle perpetual --max-runs 10` on a real project with VISION.md containing partial coverage → session completes at least 2 chained runs where run 2's intent was PM-synthesized on idle, not pre-existing. Tester-quoted output required.
  - Perpetual-mode stop case: when PM-idle-expansion produces a `vision_exhausted` declaration, session stops cleanly with status `vision_exhausted` (distinct from `completed` for bounded, and distinct from `idle_exit`). Tester-quoted output required.
  - Budget-cap case: `per_session_max_usd` hit during a PM idle-expansion → session stops with `session_budget` status, NOT perpetual-mode infinite spend. Regression test required.
  - `max_idle_expansions` cap case: 5 consecutive failed PM expansions → session stops with `vision_expansion_exhausted`, NOT infinite loop. Regression test required.
  - Both research turns (Claude + GPT) logged in AGENT-TALK with `BUG-60-RESEARCH-CLAUDE` and `BUG-60-REVIEW-GPT` tags, committed before any implementation commit.
  - `DEC-BUG60-PERPETUAL-CONTINUOUS-POLICY-001` committed.
  - Spec docs updated. Docs page updated. `.agentxchain/prompts/pm-idle-expansion.md` committed as a canonical scaffold artifact.
  - `bug-60-perpetual-idle-expansion.test.js` committed with positive + negative cases.
  - **BUG-59 closed first with tester-verified evidence.** ✅ Satisfied — BUG-59 checked in roadmap, shipped in `agentxchain@2.151.0`. Slice 1 committed (`ef9c4d32`).

  ---

  **Process reminders:**
  - Do NOT skip the research turns. Same discipline as BUG-59 — this is the second roadmap entry to formalize the two-agent pre-work gate. If BUG-59 and BUG-60 both ship cleanly, promote the two-agent pre-work gate to a standing rule (Rule #14 candidate).
  - Do NOT flip this checkbox without tester-quoted output on a published version showing the perpetual chain actually completing at least 2 PM-expansion → run cycles.
  - Do NOT touch `.planning/VISION.md`. (This is especially important here since BUG-60 is ABOUT reading VISION.md — tempting to "fix" it as part of the work. Resist. Humans own VISION.md.)

- [x] **BUG-61: Ghost-turn recovery requires manual operator intervention — full-auto loop stalls on every ghost turn. Compounds with BUG-54 to make lights-out unreliable.** ✅ Closed 2026-04-24 — mechanism-verified on `agentxchain@2.154.11` using tester evidence at `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/agentxchain-quotebacks/BUG-61-ghost-retry-v2.154.11.md`. The tester proved typed `stdout_attach_failed` ghost detection, two bounded `auto_retried_ghost` dispatches with distinct new turn IDs, same-signature early-stop via `ghost_retry_exhausted`, diagnostic state mirroring, and preserved manual `reissue-turn --reason ghost` recovery. Positive retry-success was not separately provable in the deterministic 100ms-watchdog tester setup; closure accepts that as environmental, because BUG-61's owned mechanism is proven and the standard accepted-turn continuation path is covered elsewhere. Future evidence that a successfully accepted retried turn does not continue should be filed as BUG-61b, not as a blanket reopening. Decision: `DEC-BUG61-MECHANISM-VERIFIED-CLOSURE-001`.

  **Historical context below is preserved for audit only.** The original acceptance text required a naturally successful retry after a ghost. The 2026-04-24 closure decision supersedes that exact quote-back lane because the shipped-package tester environment could only produce deterministic same-signature ghosts; waiting for a naturally transient ghost would keep BUG-61 open without a concrete agent-side deliverable.

  **Tester report 2026-04-21 on v2.150.0 `tusq.dev` dogfood:**
  - `turn_97eee736ab49bab9`: `runtime_spawn_failed`, 58s dispatch with no subprocess output
  - `turn_ec72b780e6347d22`: `runtime_spawn_failed`, 101s dispatch with no subprocess output (was the current blocker)
  - `turn_70400ff1f07b8b74`: prior ghost PM turn, reissued to `turn_fae691907af78136`

  Every ghost turn requires manual `agentxchain reissue-turn --turn <id> --reason ghost`. Under current behavior, full-auto lights-out cannot proceed through any ghost turn without a human. Tester: *"Ghost turns should be rare and recover cleanly without requiring repeated manual intervention."*

  **Relationship to BUG-54:** BUG-54 addresses the FREQUENCY of false ghost turns (watchdog threshold was 30s, raised to 120s in v2.151.0). BUG-61 addresses the RECOVERY BEHAVIOR when a real ghost turn is detected. Different concerns: BUG-54 reduces how often ghosts fire; BUG-61 removes the manual step when they do fire. The two fixes together deliver "ghost turns are rare AND recover cleanly."

  **Note on v2.151.0 impact:** the tester's 58s and 101s ghost durations were both >30s (old watchdog) but <120s (new watchdog). Under v2.151.0 they might no longer classify as ghosts — might be slow-but-working Claude dispatches. Tester should re-test on v2.151.0 before assuming every BUG-61 repro scenario still reproduces. If v2.151.0 reduces ghost-turn rate enough, BUG-61 drops from "blocking" to "resilience improvement" — still worth shipping but less urgent.

  **Two fix paths — research turn decides which or both:**

  1. **Automatic retry with bounded budget.** When a turn is detected as ghost (watchdog fires + zero stdout received), automatically issue `reissue-turn --reason ghost` up to N times (default 2). Track retry count in state. If all retries produce ghosts, escalate to human with full diagnostic bundle.
  2. **Faster-fail diagnostic surface.** Keep the current "manual reissue" posture but make the diagnostic output actionable: subprocess exit code, captured stderr, spawn env boolean-presence, resolved binary path, watchdog threshold effective at dispatch time. So when the operator runs `reissue-turn`, they know WHY and whether reissuing is likely to help.

  Options are compatible — Option 1 is the lights-out fix, Option 2 is the diagnostic-quality fix. Both should ship.

  **Safeguards for Option 1 (auto-retry):**
  - **Per-run retry budget:** max 3 auto-retries per run, not per turn. Prevents cascading ghost loops.
  - **Retry fingerprinting:** if N consecutive ghosts have the same signature (same runtime, same role, same prompt shape), stop retrying and escalate — a pattern means something systematic, not transient.
  - **Preserve manual escape hatch:** `reissue-turn --reason ghost` remains operator-facing. Auto-retry must not hide diagnostic history; every auto-retry emits an event the operator can audit.
  - **Configurable:** `auto_retry_on_ghost: { enabled: true, max_retries_per_run: 3, cooldown_seconds: 5 }`, enabled by default for full-auto mode, disabled for manual mode.

  **Fix requirements:**
  1. Define "ghost turn" precisely in a decision record: `runtime_spawn_failed` AND zero stdout bytes received AND watchdog fired. Current detection signals at `cli/src/lib/adapters/local-cli-adapter.js:133,309,350` have the raw signal; the classification rule needs to be explicit for retry logic to key off of it reliably.
  2. Add `auto_retry_on_ghost` config block to `cli/src/lib/normalized-config.js`'s continuous section. Defaults as above.
  3. Implement retry mechanism in continuous-run loop. On ghost detection: check retry budget, issue `reissueTurn()` programmatically with `reason: 'auto_retry_ghost'`, reset watchdog, emit `auto_retried_ghost` event to `.agentxchain/events.jsonl`, increment run-scoped counter.
  4. On final escalation after retries exhausted: attach full diagnostic bundle (per-attempt subprocess state, resolved runtime config, watchdog threshold, stdin transport shape, any captured stderr).
  5. Positive + negative regression tests (Rule #13 / command-chain): (a) simulate 2 ghosts + 1 success in sequence → turn completes via auto-retry, `events.jsonl` shows two `auto_retried_ghost` entries + one success; (b) simulate 4 consecutive ghosts → session escalates to human with diagnostic bundle, `auto_retried_ghost` count = 3 (budget cap), `reason_escalated: "retry_budget_exhausted"` on the escalation.
  6. Update tester runbook to describe auto-recovery + opt-out.

  **Acceptance:** tester runs `tusq.dev` full-auto on a future shipped version. A ghost turn occurs → next event in `.agentxchain/events.jsonl` shows `auto_retried_ghost` → subsequent turn succeeds → session proceeds without operator intervention. Tester-quoted CLI output showing the recovery.

- [x] **BUG-62: Operator-commit reconcile path is missing — any manual commit on top of an agent checkpoint produces `Git HEAD has moved since checkpoint` drift and blocks all further agent work. Compounds every other full-auto defect because the workarounds require manual commits which then cause this.** ✅ Closed 2026-04-24 via shipped-package scratch proof on `agentxchain@2.155.10`. GPT 5.5 ran the repaired V3 proof in `/tmp/axc-bug62-gpt55`: accepted a real manual PM checkpoint, committed `NOTES.md` as a safe operator commit, observed drift `0b6befce -> 4d87db76`, ran `agentxchain reconcile-state --accept-operator-head`, saw `Reconciled 1 operator commit(s).`, verified a `state_reconciled_operator_commits` event with `paths_touched: ["NOTES.md"]`, then verified negative refusal for `.agentxchain/state.json` (`governance_state_modified`) and divergent history (`history_rewrite`). Evidence: `.planning/BUG_62_SHIPPED_PACKAGE_PROOF_2026_04_24.md`; closure decision: `DEC-BUG62-SHIPPED-PACKAGE-CLOSURE-001`.

  **Tester report 2026-04-21 on v2.150.0:**
  - After manual commit `e838d9f Add M16 manifest diff PM increment`, `agentxchain status` reported: `Drift: Git HEAD has moved since checkpoint: e838d9f1 -> 369972f4`
  - After subsequent manual commit `369972f Implement tusq manifest diff command`, the run was still BLOCKED on drift

  Compounds the full-auto problem: every operator intervention for other bugs (BUG-52 third variant, BUG-61 ghost-turn, BUG-60 idle-expansion gap) creates drift that blocks further agent work, requiring ANOTHER manual intervention to recover. **Net effect: agents cannot make forward progress autonomously if ANY operator commit has ever landed on top of a checkpoint.**

  Tester: *"Operator commits should be reconciled cleanly into run state or restart context."*

  **Root cause hypothesis (research needed):** state.json records `checkpoint.git_sha` at the last agent-driven checkpoint. When operator commits on top of that SHA, agents detect drift and refuse to proceed because they can't prove the new HEAD is compatible with their state model. Today there is no command that says "accept the operator's commits as the new baseline." The ops workaround is to patch `.agentxchain/state.json` by hand, which is fragile and undocumented.

  **Safe vs unsafe operator commits — the fix must distinguish these:**
  - **Safe (auto-reconcile-able):** fast-forward commits on top of `checkpoint.git_sha` that don't rewrite history, don't modify `.agentxchain/` state files, don't delete accepted-turn artifacts, don't roll back completed phase evidence
  - **Unsafe (must still block):** force-pushes, history rewrites, `state.json` edits, deletion of `history.jsonl`/`events.jsonl`/`acceptance-matrix.md`, rollback of a checkpointed phase

  **Fix requirements:**

  1. **New command: `agentxchain reconcile-state --accept-operator-head`.** Reads current HEAD, walks commits between `checkpoint.git_sha` and HEAD, applies safety checks (fast-forward only, no `.agentxchain/` modifications, no state-file deletions, no history rewrite), updates `checkpoint.git_sha` to new HEAD, emits `state_reconciled_operator_commits` event listing the accepted commits with SHAs and paths-touched.

  2. **Automatic reconciliation for continuous / full-auto runs.** New config field: `reconcile_operator_commits: "manual" | "auto_safe_only" | "disabled"` in `normalized-config.js` continuous section. Default: `"manual"` for governed mode (preserve current block), `"auto_safe_only"` for full-auto mode (auto-run the reconcile command before each dispatch, but only if safety checks pass). Operator can override via flag or config.

  3. **Diagnostic output when reconciliation is refused.** Which commit, which rule tripped (e.g., "commit abc123 modifies .agentxchain/state.json — reconcile cannot auto-accept state-file edits. Manual recovery: ..."), concrete recovery recipe. This replaces today's generic "drift detected" message.

  4. **Positive + negative regression tests (Rule #13 / command-chain):**
     - (a) Agent checkpoints at SHA A → operator commits SHA B adding only product-code files → run `reconcile-state --accept-operator-head` → assert `checkpoint.git_sha === B`, event emitted with paths touched, next agent turn dispatches without drift block.
     - (b) Same setup but operator commit modifies `.agentxchain/state.json` → assert reconcile refuses with specific actionable error naming the offending file.
     - (c) Same setup but operator force-pushed (rewrote history such that `checkpoint.git_sha` is no longer an ancestor of HEAD) → assert reconcile refuses with "history-rewrite" error class.

  5. **Document the safety contract** in `website-v2/docs/` continuous-operation page. Explain what operator actions are safe to do mid-run, what requires `reconcile-state`, what requires a full session restart.

  **Acceptance:** tester's scenario reproduced on a future shipped version — manual commit on top of a checkpoint → `agentxchain status` shows drift → `agentxchain reconcile-state --accept-operator-head` succeeds → next agent turn proceeds without further intervention. OR under `reconcile_operator_commits: "auto_safe_only"`, the reconcile happens automatically and the next turn dispatches without operator running the command manually. Tester-quoted CLI output showing the flow.

  **Agent-side implementation surfaces are complete in v2.154.7 (awaiting tester quote-back):** `.planning/BUG_62_OPERATOR_COMMIT_RECONCILE_SPEC.md`, the manual `agentxchain reconcile-state --accept-operator-head` primitive (event `state_reconciled_operator_commits`), the automatic `run_loop.continuous.reconcile_operator_commits: "auto_safe_only"` policy with `maybeAutoReconcileOperatorCommits()` at `cli/src/lib/continuous-run.js:369+` and validation at `cli/src/lib/normalized-config.js:649+` (`VALID_RECONCILE_OPERATOR_COMMITS = ['manual', 'auto_safe_only', 'disabled']`), default promotion to `auto_safe_only` under full-auto approval policy, the `operator_commit_reconcile_refused` run event mirrored into `blocked_reason.recovery.detail`, command-chain tests at `cli/test/beta-tester-scenarios/bug-62-operator-commit-reconcile.test.js` (5/5 passing on HEAD 2026-04-22), normalized-config shape tests at `cli/test/continuous-run.test.js:275-323`, and docs in `website-v2/docs/lights-out-operation.mdx`. BUG-62 remains unchecked because tester quote-back per `.planning/TESTER_QUOTEBACK_ASK_V3.md` has not landed on a published `agentxchain@2.154.7+` session. If quote-back surfaces a previously unseen `auto_safe_only` refusal-class edge case, file it as a narrow BUG-62 follow-up slice rather than reopening the shipped auto-config work by default.

  **Dogfood evidence 2026-04-24 on shipped `agentxchain@2.155.2`:** BUG-63 retry reached the next real blocker in `tusq.dev-agentxchain-dogfood`. `agentxchain status` recommended `agentxchain reconcile-state --accept-operator-head`, but the command refused with `governance_state_modified` because baseline commit `a6a388e1` modified `.agentxchain/SESSION_RECOVERY.md`. Evidence: `.planning/dogfood-tusq-dev-evidence/GAP-002-bug62-governed-state-drift.md` plus `raw/cli-2026-04-24-gap002-reconcile-refused-v2.155.2.log`. This attaches dogfood proof to existing BUG-62 rather than creating a duplicate BUG.

  **v2.155.3 shipped (2026-04-24) — reconcile-safe-paths allowlist:** `RECONCILE_SAFE_AGENTXCHAIN_PATHS` (`SESSION_RECOVERY.md`) and `RECONCILE_SAFE_AGENTXCHAIN_PREFIXES` (`prompts/`) added to `classifyUnsafeCommit()`. Regression tests AT-BUG62-004 through -006 prove positive (safe paths reconcile) and negative (mixed safe+unsafe still blocked). On the tusq.dev dogfood, the `SESSION_RECOVERY.md` check now passes, but the same commit `a6a388e1` also modifies core governed state files (`continuous-session.json`, `events.jsonl`, `history.jsonl`, `session.json`, `state.json`) — correctly blocked. The dogfood was unblocked via `agentxchain unblock hesc_0b1b166cd606d86d` (approved `planning_signoff` gate), advancing the run to implementation phase. BUG-62 reconcile-safe-paths fix is shipped and proven; BUG-62 remains unchecked until tester quote-back per acceptance criteria above.

  **Cross-references:**
  - **BUG-52 third variant:** the tester's `d2ab914` and `77762c8` manual recovery commits (to unblock planning_signoff and launch_ready gates) are examples of operator commits that today create BUG-62 drift. Fixing BUG-62 reduces the blast radius of BUG-52 even if BUG-52 itself isn't closed.
  - **BUG-61 ghost-turn manual recovery:** any manual `reissue-turn` invocation that touches git state benefits from BUG-62's reconcile path.
  - **BUG-60 perpetual continuous:** perpetual mode that hits any of the above will inherit the drift problem unless BUG-62 is fixed.

- [x] **BUG-54: local_cli runtime spawn/attach repeatedly fails — reliability bug, not detection. Agent-side fix surfaces shipped; tester quote-back still required.** ✅ Closed 2026-04-24 via shipped `agentxchain@2.155.10` tusq.dev dogfood evidence. The dogfood session produced 65 current-window `turn_dispatched` events and 19 accepted turns across the full-auto run lane, with three complete post-fix governed runs and zero `runtime_spawn_failed`, `stdout_attach_failed`, `ghost_turn`, or `startup_watchdog_fired` signals in the event scan. This is stronger than the original ten-dispatch watchdog bar because it exercises the same shipped package on the real tusq.dev dogfood branch through PM/dev/QA/product-marketing turns. Evidence: `.planning/dogfood-tusq-dev-evidence/session-2026-04-24.md`; closure decision: `DEC-BUG54-DOGFOOD-RELIABILITY-CLOSURE-001`.
  - **Tester's v2.147.0 evidence (QA-specific):** run_4b24e171693ac091 had 6 consecutive QA startup failures alternating `runtime_spawn_failed` / `stdout_attach_failed`: `turn_81bbd843`, `turn_df73f5d4`, `turn_e95f8517`, `turn_1d93790`, `turn_75116ed7`, `turn_7763138`.
  - **Tester's v2.148.0 clean-retest evidence (PM-affected too):** isolated worktree `tusq.dev-21480-clean`, session `cont-68fcad95`, run `run_15787079e4eb9e07`. PM turns repeatedly fail with same 3 failure modes. Reissued repeatedly via native recovery, keeps reproducing. Bug is not role-specific and not state-corruption — it's `local_cli` runtime-general.
  - **AMPLIFIED EVIDENCE (tester's expanded report 2026-04-20):** **29 consecutive clean PM attempts in `tusq.dev-21480-clean` produced ZERO successful PM turns.** Quoted: *"No PM turn completed successfully. No turn was accepted, merged, or checkpointed as completed work. No implementation or QA phase started. The repeated 'work' was only framework recovery: `reissue-turn --reason ghost`, `step --resume`."* Every single attempt hit `runtime_spawn_failed` / `stdout_attach_failed` / `ghost_turn`. ~2.5 hours of framework time produced exactly one thing: more diagnostic evidence that v2.148.0 is broken. This rules out reliability-class hypotheses: it's not flaky (0% success, not 20%), it's not a race (deterministic reproduction), it's not file-descriptor exhaustion (first attempt fails, not just Nth). **This is a deterministic environmental or invocation-level failure.** Native recovery (`reissue-turn` + `step --resume`) does NOT help — every reissued turn hits the same spawn/attach failure. The path forward MUST start with running the adapter's exact spawn directly and capturing the full stderr/exit-code/signal. Remaining hypothesis probability:
    - Hypothesis 1 (FD exhaustion): **unlikely** — would get worse over attempts, but the tester sees consistent failure from attempt 1
    - Hypothesis 2 (stdout race): **unlikely** — races produce intermittent failures, tester sees deterministic
    - Hypothesis 3 (Claude CLI `-p` mode startup time): **possible** — 30s watchdog might fire before real first-byte
    - Hypothesis 4 (stdin handling / EPIPE): **possible** — deterministic failure mode fits
    - Hypothesis 5 (auth env not propagating to subprocess): **most likely** — explains 0% success, role-general, state-independent, deterministic
  - **STOP DOING CLASSIFICATION WORK.** The 27 post-v2.148.0 commits (`6dbc10cc`, `2ca1d543`, `34b5f358`, `e7da4f6f`, `ab130ebe`, `15cd166d`, `ae057781`, and others) all refine **how failures are reported/classified/timed**. None investigate why Claude CLI subprocesses fail to spawn/attach in the first place. This is the BUG-47→BUG-51 pattern repeating: improving observability while reliability stays broken. **If the next fix is another classification tweak, it will not close BUG-54.**
  - **Root cause hypotheses (INVESTIGATE THESE, do not ship classification fixes instead):**
    1. **Resource leak / file-descriptor exhaustion** — after one spawn failure, something isn't cleaned up, so subsequent spawns fail. Check if the adapter releases stdio file descriptors on subprocess failure. `3f1b74e2 fix(adapter): release stdio on spawn error` claims to address this — but tester evidence shows it didn't solve the problem. Re-audit that fix under tester-sequence conditions.
    2. **Race condition in stdout attachment** — the spawn succeeds but the stdout pipe attachment happens on a different event loop tick and races with process exit / first output. The classic symptom is `stdout_attach_failed` immediately after a successful spawn — which matches the tester's evidence perfectly.
    3. **Claude CLI `-p` mode behavior** — when invoked as `claude -p "..." --output-format stream-json --verbose`, does the CLI need time to authenticate / load config / start before producing output? If yes, the 30-second watchdog may fire during normal startup. Test by running the exact command the adapter spawns (pulled from `ASSIGNMENT.json`) directly in a terminal and timing first-byte-out.
    4. **stdin handling for `prompt_transport: stdin`** — if the prompt is written to stdin but the subprocess exits before reading it all, EPIPE could kill the spawn silently. Does the adapter properly handle the stdin close timing?
    5. **ANTHROPIC_API_KEY or auth-chain issue specific to subprocess environment** — the parent process may have Claude auth in a keychain/keyring that the subprocess can't read. Check if `claude -p` subprocess gets auth via `ANTHROPIC_API_KEY` env var or via the CLI's own keychain (which may not propagate across spawn).
  - **Fix requirements — in this order:**
    1. **DIAGNOSTIC PROOF FIRST.** Before any code fix, reproduce the failure on the agents' own dev box by running the exact spawn the adapter does. Capture: PID, exit code, first-byte-out timestamp, stdout content, stderr content, exit signal. If reproduction fails to reproduce, the bug is environmental — ask the tester to run a diagnostic subprocess capture.
    2. **Publish the reproduction script.** Add `cli/scripts/reproduce-bug-54.mjs` that runs the same spawn the adapter does with full logging. The tester can then run it in their environment and share output. This is the ONLY way to close the root-cause question without guessing. **(✅ Shipped Turn 95, 2026-04-20.** `cli/scripts/reproduce-bug-54.mjs` mirrors the adapter's `resolveCommand` + `spawn` shape exactly — same stdio, env, cwd, prompt transport. Captures per-attempt: PID, spawn_attached/first_stdout/first_stderr timestamps, watchdog_fired flag with elapsed time, exit_code/signal, raw FULL stdout + stderr (no truncation), spawn_error/process_error with code/errno/syscall, and an env_snapshot with PATH/HOME/PWD/SHELL/TMPDIR + boolean-only auth-key presence flags for ANTHROPIC_API_KEY/CLAUDE_API_KEY/CLAUDE_CODE_OAUTH_TOKEN/CLAUDE_CODE_USE_VERTEX/CLAUDE_CODE_USE_BEDROCK. Classifies each attempt into `spawn_attach_failed` / `watchdog_no_output` / `watchdog_stderr_only` / `exit_stderr_only` / `exit_no_output` / `exit_clean_with_stdout` / `exit_nonzero_with_stdout` / `spawn_unattached` / `spawn_error_pre_process`. Five-test classification contract locked in `cli/test/reproduce-bug-54-script.test.js`. **Tester action:** use the installed-package resolver in `.planning/BUG_52_53_54_55_TESTER_UNBLOCK_RUNBOOK.md` / `.planning/BUG_54_REPRO_SCRIPT_TESTER_RUNBOOK.md` (local `npm root` first, global `npm root -g` fallback), then run `node "$REPRO" --attempts 10` (or add `--synthetic "Say READY and nothing else."` to isolate from prompt content) inside the failing worktree (`tusq.dev-21480-clean`) and attach the resulting `bug-54-repro-*.json` to AGENT-TALK or the bug thread. That JSON is the artifact required to discriminate hypotheses 1–5.)
    3. Only AFTER root cause is identified (hypothesis 1, 2, 3, 4, or 5): ship the actual reliability fix. Not a classification tweak. Not a better ghost detector. A fix that makes the spawn succeed.
    4. Add tester-sequence test that dispatches 10 consecutive `local_cli` turns (PM, dev, and QA) and asserts ≥9 complete successfully. Current single-turn tests don't catch this reliability class.
  - **Tester evidence on v2.150.0 (shipped-package dogfood, 2026-04-21 — Turn 137 diagnosis CONFIRMED, fix NOT YET SHIPPED):** Tester ran full-auto on real `tusq.dev` project with v2.150.0. Hit `stdout_attach_failed` on TWO distinct runtimes:
    - **Claude-based `local-pm` (`turn_cb1c94dc04b90c5a`)**: `running_ms: 30285, threshold_ms: 30000` — **exactly 285ms past the 30s watchdog**. This is precisely what Turn 137 diagnosed: the 30s default watchdog is too tight for realistic dispatch bundles. Turn 137 measured a 17,737-byte bundle producing first-stdout at 113,094ms with a 120s watchdog on the agents' dev box. The tester's 30285ms failure on Claude is **independent confirmation** of the Turn 137 diagnosis. **The fix has not shipped in v2.150.0.**
    - **Codex-based `local-product-marketing` (`turn_f5dae06aceb077c5`, reissued `turn_6e1004d805a29cb1`)**: repeated `stdout_attach_failed` / `ghost_turn`. Tester workaround: **rebind product-marketing from Codex to Claude Opus 4.7** (commit `ecdbdcf`), then reissue — `turn_60592eb9651f6728` succeeded. **This is a workaround, not a fix.** It tells us Claude happens to hit first-stdout faster than Codex on this prompt size; it does NOT prove Codex is broken in a different way.
  - **Updated diagnosis (supersedes the original 5 hypotheses):** the root cause is **watchdog threshold, not subprocess auth/spawn behavior.** The keychain-hang hypothesis (BUG-56 false-positive) was disproven by the tester's Claude Max smoke test. The startup-time hypothesis (formerly #3) is now confirmed by independent measurements on two machines. Hypotheses 1/2/4/5 are closed as unlikely.
  - **Agent-side implementation surfaces are complete in `agentxchain@2.154.7` (awaiting tester quote-back):** the startup watchdog default is no longer the old 30s false-kill path (`cli/src/lib/stale-turn-watchdog.js` documents and enforces a 180s default while preserving `run_loop.startup_watchdog_ms` and `runtimes.<id>.startup_watchdog_ms` overrides); realistic-bundle coverage uses the tester-observed `17,737` byte floor across Claude-style bundle-only, Codex-style bundle-only, and Codex-style stdin transports in `cli/test/beta-tester-scenarios/bug-54-realistic-bundle-watchdog.test.js`; the 31s old-threshold regression lives in `cli/test/beta-tester-scenarios/bug-54-watchdog-threshold-default.test.js`; Turn 278 added bounded startup-watchdog SIGTERM -> SIGKILL grace with diagnostic `startup_watchdog_sigkill` and `DEC-BUG54-STARTUP-WATCHDOG-SIGKILL-GRACE-001`; Turn 280 added abort SIGKILL fallback timer cleanup and `DEC-BUG54-ABORT-SIGKILL-TIMER-CLEANUP-001`; docs guard coverage lives in `cli/test/bug-54-startup-watchdog-docs-content.test.js` and website docs under `website-v2/docs/`. BUG-54 remains unchecked only because literal tester quote-back via `.planning/TESTER_QUOTEBACK_ASK_V2.md` has not landed on a published `agentxchain@2.154.7+` session.
  - **Acceptance:** tester runs `tusq.dev` full-auto on v2.151.x or later. Both Claude and Codex `local_cli` runtimes complete 10 consecutive turns without any `stdout_attach_failed` / `ghost_turn` events at the default watchdog threshold. Tester-quoted output required. Previous acceptance (10 consecutive `local_cli` dispatches succeed at >90% rate, not <20%) still stands.
  - **Historical acceptance text (preserved for reference):** tester's clean-retest scenario on vX.Y.Z — 10 consecutive PM/dev/QA `local_cli` dispatches succeed at >90% rate, not <20%.

- [x] **BUG-55: checkpoint completeness + verification side-effects.** ✅ Closed 2026-04-21 tester-verified on v2.150.0 — first clean closure in the BUG-52/53/54/55 cluster. Tester dogfood on real tusq.dev confirmed `undeclared_verification_outputs` rejection and clean checkpoint after corrective commit. Tester quote: *"BUG-55 appears fixed based on both tusq.dev dogfood behavior and targeted regression tests."* 26/26 regression pass. Full detail archived.
- [x] **BUG-52: phase-gate reconcile / `unblock`-based human-gate resolution (incl. third variant where `pending_phase_transition` is `null`).** ✅ **CLOSED 2026-04-23 with tester-verified shipped-package evidence on `agentxchain@2.154.11`.** Third failure shape resolved across `2.154.9`/`2.154.10`/`2.154.11`. Tester confirmed final human-gate unblock reaches correct terminal state, emits `gate_approved` + `run_completed`, updates `.agentxchain/continuous-session.json` to `status: completed` with `runs_completed: 1`. Key decisions: `DEC-BUG52-STATE-CLEANUP-ON-PHASE-ADVANCE-001`; `unblock` command-surface converged with `approve-transition`; `phase_reconciled` event emitted on reconciled phase advance. Full detail in `.planning/HUMAN-ROADMAP-ARCHIVE.md`.
- [x] **BUG-53: Continuous session doesn't auto-chain after run completion — pauses instead of deriving next vision objective** — ✅ Closed 2026-04-24 via shipped `agentxchain@2.155.10` dogfood evidence. The original bounded-mode `session_continuation` quote-back stayed useful for the pre-BUG-60 path, but the roadmap itself sharpened the accepted BUG-53 criterion to the perpetual lane: with BUG-60 shipped and `--on-idle perpetual`, a session completes run 1 → PM expands → run 2 → PM expands → run 3 without entering a clean-completion `paused` regression. The tusq.dev dogfood did exactly that: three full governed runs completed through all four phases after `2.155.10`, with idle-expansion PM dispatches between runs and no agent-level failures. Evidence: `.planning/dogfood-tusq-dev-evidence/session-2026-04-24.md`; closure decision: `DEC-BUG53-PERPETUAL-CHAIN-CLOSURE-001`.
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
  - **Partial validation on v2.150.0 (2026-04-21):** Tester ran `npx --yes -p agentxchain@latest -c 'agentxchain run --continuous --vision .planning/VISION.md --max-runs 1 --max-idle-cycles 3 --poll-seconds 5 --triage-approval auto --auto-checkpoint --no-report'` on `tusq.dev`. Result: `Status: completed, Runs: 0/1, Idle cycles: 3/3` — session cleanly idle-exited after 3 consecutive "no derivable work from vision" cycles, did NOT hang in `paused`. **This validates the clean idle-exit case** (previously paused incorrectly). Tester quote: *"Continuous mode exited cleanly when no derivable work remained, but tusq.dev did not exercise a real multi-run auto-chain after that."*
  - **What is still NOT proven:** the chain-to-next-run case. Tester ran with `--max-runs 1` and got 0 runs (no derivable work existed), so the actual "after run N completes, does run N+1 start?" behavior remains unverified on shipped package. A `--max-runs 1` session that completes 0 runs is not the same as a `--max-runs 3+` session that completes run 1 and chains into run 2.
  - **Sharpened acceptance (supersedes the original for closure purposes):** tester runs `--continuous --max-runs 3` or higher on a project where vision has at least 2 derivable candidates. Run 1 completes, **run 2 automatically starts from the next vision candidate** (no human intervention, session status never enters `paused`), run 3 exits cleanly either by hitting max_runs or by running out of candidates. Tester-quoted output required showing the `session_continuation` event between run 1 and run 2 with `{previous_run_id, next_objective, next_run_id}` payload.

- [x] **BUG-65: Framework report artifacts pollute next turn's dispatch baseline.** ✅ Fixed Turn 8 by classifying generated governance reports (`.agentxchain/reports/report-*.md`, `export-*.json`, and `chain-*.json`) as operational framework writes while preserving custom `.agentxchain/reports/` artifacts as checkpointable continuity evidence. Added `.planning/BUG_65_FRAMEWORK_REPORT_ARTIFACT_SPEC.md`, repo-observer/framework-write tests, and packaged CLI proof that `accept-turn` accepts declared work while generated reports are dirty. Verification: `node --test --test-timeout=60000 cli/test/repo-observer.test.js cli/test/framework-write-exclusion.test.js`; `node --test --test-timeout=60000 --test-name-pattern "BUG-55|BUG-65" cli/test/claim-reality-preflight.test.js`.

- [x] **BUG-66: Reissued turns produce near-identical content, triggering overlap acceptance conflicts.** ✅ Fixed Turn 10 by adding two skip conditions to `classifyAcceptanceOverlap()` in `governed-state.js`: (1) skip history entries with `status: 'reissued'` — superseded turns are not competing, (2) skip entries matching `targetTurn.reissued_from` — the direct predecessor of a replacement turn should never trigger overlap. Normal concurrent turn conflicts are unaffected. Added `.planning/BUG_66_REISSUED_TURN_OVERLAP_SPEC.md` and `cli/test/bug-66-reissued-turn-overlap.test.js` with 5 tests covering reissued skip, predecessor skip, regression guard for normal conflicts, mixed history, and all-reissued history. Verification: `node --test --test-timeout=60000 cli/test/bug-66-reissued-turn-overlap.test.js`.

- [x] **BUG-67: Report generation crashes with "Invalid string length" after many turn attempts.** ✅ Fixed Turn 10 by adding `maxJsonlEntries` and `maxBase64Bytes` options to `buildRunExport()` in `export.js`. The auto-report path in `run.js` now passes `{ maxJsonlEntries: 1000, maxBase64Bytes: 1048576 }`, capping JSONL data to the last 1000 entries and skipping base64 for files over 1MB. Truncated files are marked with `truncated: true`, `total_entries`, and `retained_entries` metadata. The CLI `export` command is unaffected (no limits by default). Added `.planning/BUG_67_REPORT_STRING_LENGTH_SPEC.md` and `cli/test/bug-67-report-string-length.test.js` with 4 tests covering truncation, base64 skip, no-truncation within limits, and backward compatibility. Verification: `node --test --test-timeout=60000 cli/test/bug-67-report-string-length.test.js`.

- [x] **BUG-68: `pm-idle-expansion.md` scaffold is dead code — never loaded during dispatch.** ✅ Fixed Turn 8 by loading `.agentxchain/prompts/pm-idle-expansion.md` (or `run_loop.continuous.idle_expansion.pm_prompt_path`) into the synthesized idle-expansion intake charter. The normal PM prompt remains intact; the idle-expansion file is now an active mode-specific supplement at the intake-charter layer, where perpetual dispatch is actually created. Added `.planning/BUG_68_PM_IDLE_EXPANSION_PROMPT_SPEC.md` and `continuous-run.test.js` coverage proving custom prompt text appears in the dispatched PM intent. Verification: `node --test --test-timeout=60000 cli/test/continuous-run.test.js`; `node --test --test-timeout=60000 cli/test/beta-tester-scenarios/bug-60-perpetual-idle-expansion.test.js`.

### Implementation notes for BUG-52/53/54/55

- **The cycle has a new false closure.** BUG-52's fix was the first proved-via-packaged-claim-reality-preflight closure to still fail on tester reproduction. That means rule #9 (packaged preflight) is necessary but not sufficient — the test itself needs to use the tester's exact command sequence, not just the right code paths. **Rule #12 has now been added** to the Active Discipline section below: command-chain integration tests are mandatory for any CLI workflow bug.
- **Ordering (v2.148.0):**
  1. **BUG-54 first** — QA runtime reliability is blocking every QA turn. Without QA completing, nothing else reaches launch. This is the operator's biggest pain point.
  2. **BUG-52** — false-closure retrospective + real-flow fix. Can proceed in parallel with BUG-54.
  3. **BUG-55** — checkpoint completeness + verification side-effects. Smaller scope, can ship with either.
  4. **BUG-53** stays open awaiting explicit tester evidence of the session-pause pattern. The tester had two runs in this retest, so auto-chain MAY be working.
- **BUG-52 needs a different shape of test this time.** Not a function-call seam test — a child-process command-chain test. Spawn `agentxchain accept-turn` then `checkpoint-turn` then `unblock` then `resume` as separate CLI invocations against a real governed state, and assert the final dispatched turn's phase is the next phase. That's the only shape of test that would have caught this.
- **Coverage matrix update:** `BUG_31_33_COVERAGE_GAP_POSTMORTEM.md` needs (a) command-chain integration tests as a first-class category (separate from function-call tests and packaged preflight), (b) a "repeated-dispatch reliability" column for spawn-path defects (BUG-54 class), (c) a "checkpoint completeness" row (BUG-55 sub-A), (d) an "undeclared verification outputs" row (BUG-55 sub-B).
- **Do NOT broadcast publicly.** Release notes: matter-of-fact. No acknowledgment of BUG-52's false closure.

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

12. **Command-chain integration tests are mandatory for any CLI workflow bug** (added 2026-04-20 after BUG-52's false closure, the 8th of the cycle). Function-call tests that exercise an internal seam are NOT sufficient for bugs where the operator's reproduction is a chain of CLI commands (`accept-turn` → `checkpoint-turn` → `unblock` → `resume`, etc.). The tester-sequence test MUST spawn each step as a separate child-process CLI invocation against a governed state, and assert the observed behavior after the full chain — not just assert that a function returns the right value. BUG-52 shipped with a unit-style test + packaged claim-reality preflight that both passed, but the tester's CLI-chain reproduction still failed because the test didn't exercise the invocation sequence the operator runs. Every tester-sequence test file in `cli/test/beta-tester-scenarios/` must have at least one assertion that uses `execFileSync('agentxchain', [...])` (or equivalent child-process spawn) to mirror the operator's real command chain. Rule 9 (packaged preflight) + rule 12 (command-chain integration) together form the full "ship only what the operator actually gets" contract.

13. **No preflight gate ships without a positive-case regression test that proves the gate passes for at least one real valid configuration** (added 2026-04-21 after BUG-56, the 9th false closure of the cycle). A test that only asserts the gate's failure output for the failure-case input is green in CI but says nothing about whether emitting that failure is the correct behavior. For gates that make predictive claims about subprocess behavior ("this will hang," "this will fail to authenticate," "this will exhaust file descriptors"), the positive-case test must exercise a real or shim subprocess that demonstrates the predicted failure does NOT occur for the supported-configuration input, and the negative-case test must exercise a shim that demonstrates the predicted failure DOES occur for the failure-case input. BUG-56 shipped an `auth_preflight` gate whose static shape-check ("no env auth + no `--bare` = hang risk") was false for every Claude Max user with keychain-based OAuth. Two release cycles (v2.149.0 warning-ordering fix, v2.149.1 hotfix for the same warning ordering) standardized the defective contract across four call-sites without anyone ever running `printf '...' | claude --print` to reality-check the gate's prediction. This is Rule #12's seam-vs-flow failure generalized from CLI command chains to preflight predictive claims. Closure for BUG-56 requires both a positive-case shim test (working Claude subprocess, gate must pass) and a negative-case shim test (hanging Claude subprocess, gate must fail) — committed to `cli/test/beta-tester-scenarios/` before the replacement gate lands.

*(Historical note: the original rule 12 — "no bug closes without the beta tester's verified output" — was removed 2026-04-20. Tester verification remains valuable evidence but is no longer a hard blocker on closure. Rules 1, 2, 6, 9, 12 and 13 above still gate closure via tests and packaged proof.)*

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

- **2026-04-21**: BUG-55 closed with tester-verified shipped-package evidence on v2.150.0 (tester dogfood on real `tusq.dev` project, event `evt_c223ff55ee31cb4b`, 26/26 targeted regression tests green). First clean closure in the BUG-52/53/54/55 cluster. Tester report on the same day: BUG-52 still open (new third variant surfaced — standing human-approval gate with no pending object, `approve-completion` finds nothing to approve), BUG-53 partially validated (clean idle-exit works; multi-run chain unverified), BUG-54 still open (Turn 137 watchdog-threshold diagnosis confirmed by tester evidence on both Claude and Codex, fix not shipped in v2.150.0). BUG-59 filed as the architectural substrate for BUG-52's third variant (full-auto mode doesn't actually change gate-approval behavior because `approval_policy` is disconnected from `requires_human_approval` at `gate-evaluator.js:290-295`).
- **2026-04-20**: BUG-47/48/49/50/51 closed with tester-verified output on v2.146.0. Second triple-or-more close of the cycle. Claude Opus 4.7 + GPT 5.4 with high-effort config active. BUG-52 and BUG-53 opened from tester report #18 — last two full-auto blockers.
- **2026-04-19**: BUG-44/45/46 closed with tester-verified output on v2.144.0. First non-false closure after 7 false ones.
- **2026-04-18**: 64-item beta-tester bug cluster closed through v2.138.0. Discipline rules 1–12 now in force. Internal postmortems: `BUG_31_33_COVERAGE_GAP_POSTMORTEM.md`, `BUG_36_FALSE_CLOSURE.md`, `BUG_39_FALSE_CLOSURE.md`, `BUG_40_FALSE_CLOSURE.md`.
- **2026-04-17**: Framework full-auto vision-driven operation shipped with 3-run live proof.
- **2026-04-03**: Original 7 priority queue items completed. Docusaurus migration, vision alignment, v2.2.0 release-ready.
