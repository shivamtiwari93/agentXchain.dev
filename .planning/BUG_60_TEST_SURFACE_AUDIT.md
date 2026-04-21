# BUG-60 Test Surface Audit

**Status:** Static inventory only. This is allowed pre-closure work under the narrowed `DEC-BUG59-CLOSURE-GATE-TESTER-QUOTEBACK-001`: no `cli/src/lib/` changes, no Option A/B selection, no schema decision, and no PM idle-expansion prompt text.

**Purpose:** Identify the tests that already protect bounded continuous mode and the gaps BUG-60 must close once tester quote-back unlocks implementation planning.

## Current Bounded-Mode Assertions

| Test surface | Current assertion | BUG-60 implication |
|---|---|---|
| `cli/test/vision-reader.test.js:117-155` | `deriveVisionCandidates()` derives candidates from unaddressed `VISION.md`, returns zero candidates when completed intent signals cover the goal, and fails clearly when `VISION.md` is missing or empty. | Keep default `VISION.md` behavior. Add separate tests for any ROADMAP/SYSTEM_SPEC candidate reader instead of weakening these baseline assertions. |
| `cli/test/continuous-run.test.js:95-124` | `resolveContinuousOptions()` knows `enabled`, `visionPath`, `maxRuns`, `pollSeconds`, `maxIdleCycles`, and `triageApproval`; no idle-policy fields are asserted. | Any future `on_idle` / `max_idle_expansions` fields need default and config-override assertions here. |
| `cli/test/continuous-run.test.js:161-211` | `seedFromVision()` writes a vision-provenance intent, auto-approves it by default, leaves it triaged when `triage_approval: human`, and returns idle when goals are addressed. | If perpetual mode uses the intake pipeline, add a sibling seed path or assertion for `vision_idle_expansion` provenance without changing `vision_scan` semantics. |
| `cli/test/continuous-run.test.js:214-305` | `executeContinuousRun()` chains multiple vision goals and exits after max idle cycles when all goals are addressed; the idle test expects no executor call and the "All vision goals appear addressed" log. | Default `on_idle: exit` must keep this exact behavior. Perpetual mode needs a new test path, not a rewrite that erases bounded semantics. |
| `cli/test/schedule-continuous.test.js:820-849` | `advanceContinuousRunOnce()` with `idle_cycles >= max_idle_cycles` returns `idle_exit` and sets `session.status = completed`. | This is the narrow branch where `on_idle: perpetual` will diverge. Existing assertion should remain for default/exit policy. Add a separate perpetual-policy row after schema exists. |
| `cli/test/claim-reality-preflight.test.js:4143-4185` | Release gate verifies BUG-53 scenario coverage, packed `continuous-run.js`, `session_continuation` payload fields, and that `session.status = 'paused'` only appears in blocked branches. | BUG-60 must extend the release gate to require the new beta scenario and packed perpetual-mode implementation. It should keep the paused-status guard. |
| `cli/test/claim-reality-preflight.test.js:4188-4324` | Packed in-process continuous proof auto-chains two vision-derived runs and emits one `session_continuation` event. | Reuse the pattern for a lower-level perpetual proof only if the CLI-chain test also exists; this alone is insufficient under Rule #12. |
| `cli/test/claim-reality-preflight.test.js:4326-4526` | Packed CLI proof reaches bounded `idle_exit` after one completed run, emits zero `session_continuation` events after exhaustion, and records `session.status = completed`. | This becomes the regression guard that `on_idle: exit` is backward-compatible after perpetual mode ships. Do not mutate it into a perpetual test. |
| `cli/test/beta-tester-scenarios/bug-53-continuous-auto-chain.test.js` | Source-tree CLI and in-process scenarios prove continuous mode auto-chains existing vision candidates, never pauses on clean completion, and reaches bounded idle exit. | BUG-60 should add a new `bug-60-perpetual-idle-expansion.test.js`; it should not overload BUG-53 with a different product contract. |
| `cli/test/continuous-3run-proof-content.test.js` | Checked-in live proof evidence records three vision-scan runs, session completion, sanitized paths, and docs linkage. | Future perpetual evidence should be separate or clearly labeled so "vision_scan three-run proof" is not confused with "PM idle-expansion proof." |

## Gaps To Close After Tester Quote-Back

1. No current test asserts config parsing for `on_idle`, `on_idle_perpetual`, or `max_idle_expansions`.
2. No current test accepts `vision_idle_expansion` as an intake source; `continuous-run.test.js:407-413` only guards `vision_scan`.
3. No current test covers "bounded idle queue empty, then dispatch PM idle-expansion, then create a new executable intent."
4. No current test covers malformed PM idle-expansion output or a `vision_exhausted` declaration.
5. No current test proves that the existing `per_session_max_usd` block fires before a perpetual-mode PM dispatch can spend again.
6. No current packed-release gate requires `bug-60-perpetual-idle-expansion.test.js`.

## Non-Negotiable Test Boundary

The BUG-60 positive/negative beta scenario must be a command-chain test using the packaged or source CLI entrypoint, matching the roadmap's Rule #12 requirement. Function-level seams such as `executeContinuousRun()` can support faster coverage, but they cannot be the closure proof for the tester-reported full-auto behavior.

## Static Test Harness Inventory

This inventory is mechanical only. It does not choose Option A vs. Option B, a schema, event names, or PM prompt text.

| Existing harness/helper | Location | What it gives BUG-60 | Constraint |
|---|---|---|---|
| Source-tree continuous unit scaffold | `cli/test/continuous-run.test.js:createTmpProject()` | Minimal governed config, state files, `writeVision()`, `writeIntent()`, fast `executeContinuousRun()` loops. | Helpers are file-local, not exported. Reuse the pattern, not the function. Good for default `on_idle: exit` and resolver tests, not sufficient for Rule #12 closure. |
| Source-tree schedule primitive scaffold | `cli/test/schedule-continuous.test.js:makeTmpDir()` / `writeConfig()` / `writeState()` / `writeScheduleState()` | Direct `advanceContinuousRunOnce()` coverage for the scheduler daemon path. | This is the only existing test surface that naturally exercises the scheduler single-step caller. BUG-60 must not prove only the main loop if the perpetual branch is reachable from scheduler ticks. |
| Budget enforcement scaffold | `cli/test/continuous-budget.test.js:createTmpProject()` | Existing `per_session_max_usd` assertions and a direct pre-check test around `advanceContinuousRunOnce()`. | BUG-60 should add a budget-before-PM-expansion assertion near this surface or a sibling test, because this file already owns the continuous budget contract. |
| BUG-53 source CLI scenario | `cli/test/beta-tester-scenarios/bug-53-continuous-auto-chain.test.js:createCliProject()` / `runContinuousCli()` | Best current operator-chain pattern: fake local CLI agent, real `bin/agentxchain.js run --continuous`, git-clean temp repo, event assertions, idle-exit CLI proof. | Helpers are local to the BUG-53 file. BUG-60 should create its own beta scenario rather than importing from BUG-53, but it should mirror this command-chain shape. |
| BUG-53 in-process scenario | `cli/test/beta-tester-scenarios/bug-53-continuous-auto-chain.test.js:makeSuccessExecutor()` | Fast `executeContinuousRun()` proof for multi-run state/event behavior. | Supportive only. It cannot replace the CLI-chain scenario because it bypasses command parsing and runtime dispatch wiring. |
| Claim-reality scenario file gate | `cli/test/claim-reality-preflight.test.js:4143-4185` | Existing pattern requiring a beta scenario file to exist and asserting it shells through the real CLI chain. | BUG-60 needs an analogous release-gate row that fails if `bug-60-perpetual-idle-expansion.test.js` is missing or only uses function-level seams. |
| Claim-reality packed module proof | `cli/test/claim-reality-preflight.test.js:4188-4324` | Extracts npm pack output and imports packed `continuous-run.js` to prove release tarball behavior. | Useful as a second proof surface after source tests pass. Still not enough alone because it bypasses packed `bin/agentxchain.js`. |
| Claim-reality packed CLI proof | `cli/test/claim-reality-preflight.test.js:4326-4526` | Spawns extracted tarball `bin/agentxchain.js run --continuous` and asserts bounded idle-exit operator output. | BUG-60 should add a packed CLI proof for perpetual mode, not mutate this bounded `idle_exit` row. |
| Run-event registry tests | `cli/test/run-events.test.js`, `cli/test/current-release-surface.test.js` | Guard that new event names are registered and present in release surfaces. | Only relevant after the architecture chooses event names. Static audit can note the surface, but should not pre-name events. |

## Harness Gaps

1. There is no shared `createTempRepo()` helper for continuous CLI tests. Each file rolls its own temp repo and cleanup. **Pre-commitment:** before landing `cli/test/beta-tester-scenarios/bug-60-perpetual-idle-expansion.test.js`, extract the reusable BUG-53 source CLI scaffold into a small shared helper owned by the beta-scenario test directory, then make both BUG-53 and BUG-60 consume it. Do not clone the scaffold inline a second time. The helper should stay narrow: temp repo envelope, caller-supplied fake-runtime script writing, CLI invocation, and cleanup only; assertions remain scenario-local so BUG-60 does not inherit BUG-53's product contract by accident. The helper must not own named fake-agent presets.
2. There is no reusable fake PM idle-expansion runtime. BUG-60 will need one scenario-local fake runtime that can emit both a valid new-intent artifact and a malformed-output artifact.
3. There is no existing test harness that asserts scheduler-daemon behavior for terminal idle policy through the real `schedule` CLI command. The current scheduler coverage is `advanceContinuousRunOnce()` level. The real research turn must decide whether a function-level scheduler proof is enough or whether a CLI scheduler scenario is required.
4. There is no packed release-gate row for future `on_idle` config parsing. Once schema exists, the release gate should check both source scenario presence and packed CLI behavior so the published package cannot silently drop perpetual mode.

## Adversarial Review Of Code-Audit Appendices

Claude's Appendix A product-code caller graph is materially correct under its stated scope. `grep -RIn` finds additional hits for `advanceContinuousRunOnce`, `executeContinuousRun`, `deriveVisionCandidates`, and `session_continuation` in tests and docs, but no extra product-code caller that changes BUG-60's implementation surface. The important testing implication is that `session_continuation` already has several release and docs assertions, so adding a sibling event later will require updating event-registry and release-surface tests deliberately.

## Shared-Helper Responsibility Split (BUG-53 scaffold → future helper)

Mechanical inventory of `cli/test/beta-tester-scenarios/bug-53-continuous-auto-chain.test.js` helpers, classified for the pre-commitment extraction (GPT Turn 158, confirmed by Claude Turn 159). This is a responsibility split, not an API proposal — naming and signatures are plan-turn work.

| BUG-53 helper | File:line | SHARED or SCENARIO-LOCAL | Reason |
|---|---|---|---|
| `createTmpProject()` | `:60-96` | SCENARIO-LOCAL | In-process minimal config (manual runtime, no gates, stubbed roles). Structurally different from the CLI path. Unifying with `createCliProject()` would over-abstract. BUG-60's in-process counterpart, if any, should be a separate sibling scaffold, not a shared helper. |
| `createCliProject()` envelope (temp dir + tempDirs bookkeeping, `.agentxchain/` directory tree, `state.json` seed with `status: idle` + `phase: implementation`, empty `history.jsonl`/`decision-ledger.jsonl`/`run-history.jsonl`, `.gitignore` entry, git init + initial commit) | `:98-100, 171-192, 204-208` | SHARED | Every continuous-CLI beta scenario needs exactly these lines. Zero scenario-specific content. Extraction candidate. |
| `createCliProject()` `agentxchain.json` body (schema_version, protocol_mode, template, project id, roles map, runtimes map, routing, gates, rules, intent_coverage_mode) | `:147-169, 173` | PARAMETER BOUNDARY | The envelope writes the file; the config object is passed in by the scenario. BUG-53 wants a `local_cli` dev role pointing at its fake agent; BUG-60 will want the same shape but with different role/runtime bindings (and possibly `continuous.on_idle`). Shared helper accepts a config object or a builder; does not embed BUG-53-specific defaults. |
| `createCliProject()` fake-CLI agent script (`_bug53-cli-agent.mjs` body at `:102-145`) | `:102-145` | SCENARIO-LOCAL | BUG-53 simulates a successful dev turn. BUG-60 must simulate a PM idle-expansion producing a new-intent artifact AND (negative case) a malformed-output artifact. Different content, different assertions about what the agent writes. Fake agents are scenario-specific; helper accepts a path+body and writes it. |
| `createCliProject()` VISION.md seeding | `:193-202` | SCENARIO-LOCAL | BUG-53's VISION content is tuned to produce three distinct candidates. BUG-60 needs a VISION that gets exhausted after N candidates to trigger the idle-expansion path. Content is scenario-local; `writeVision()` utility is shared. |
| `writeVision(dir, content)` | `:212-216` | SHARED | Pure utility: mkdir `.planning`, write `VISION.md`. Already reusable as-is. |
| `readRunEvents(dir)` | `:218-226` | SHARED | Reads and parses `RUN_EVENTS_PATH` JSONL. Scenario-agnostic. BUG-60 will need it for `session_continuation` or sibling-event assertions. |
| `runContinuousCli(dir, maxRuns)` | `:228-247` | SHARED with signature change | BUG-53 hardcodes `--max-idle-cycles 1 --poll-seconds 0`. BUG-60 will need different flags (e.g., `--on-idle perpetual`, `--max-idle-expansions N`). Extract with `runContinuousCli(dir, { maxRuns, maxIdleCycles, pollSeconds, extraArgs })`. Keep the 120s timeout, `NO_COLOR=1`, `NODE_NO_WARNINGS=1` env, and `CLI_BIN` resolution in the helper. |
| `makeSuccessExecutor(dir)` | `:254-272` | SCENARIO-LOCAL | In-process mock executor. Generic shape, but BUG-60's mocks will mutate state differently (e.g., emit a PM idle-expansion staging artifact). Keep each scenario's executor local; do not share. |
| Per-describe `it(...)` assertions | `:274-500` (partial read) | SCENARIO-LOCAL | Scenario-specific product contract. Never shared. |

**Extraction envelope summary (for the plan turn, not a commitment to a signature):**

- **SHARED:** tempDir creation + cleanup bookkeeping, `.agentxchain/` directory tree seed, base `state.json`, base history/ledger/run-history/`.gitignore`, git init+initial commit, `writeVision()`, `readRunEvents()`, `runContinuousCli(dir, opts)`.
- **PARAMETER BOUNDARY:** `agentxchain.json` body, fake-agent script path+body.
- **SCENARIO-LOCAL:** in-process `createTmpProject`, executor mocks, fake-agent body text, VISION.md content, all `describe`/`it` assertions.

**Process pre-commitment (refines GPT Turn 158's build-or-reuse):**

1. Extraction MUST happen in a separate commit from the BUG-60 scenario landing. Rule #13 discipline: a refactor that touches BUG-53's release-gated scenario file must not share a commit with a brand-new scenario file. Extract, migrate BUG-53 to consume the helper, run the full beta-scenario suite, commit. Then author BUG-60 scenario as second consumer.
2. The helper's first real consumer is BUG-53. It's not a speculative extraction — BUG-53 moves onto it the same turn. This avoids the "abstraction written for future use, never validated by real caller" antipattern.
3. The helper must not own any assertions. Assertions leak scenario contracts. Helper stops at "a temp continuous-CLI project exists, cleaned on afterEach, CLI invokable."
4. BUG-60's in-process-only tests (if any) reuse neither the shared CLI helper nor `createTmpProject`. Each in-process test owns its scaffold, keeping in-process and CLI paths independently verifiable.

## GPT Adversarial Review Of Helper Split (Turn 160)

This review accepts most of Claude's Turn 159 split, with one correction and two explicit non-abstractions.

| Question | Review result | Rationale |
|---|---|---|
| Should `makeSuccessExecutor(dir)` become a shared in-process helper? | No. Keep SCENARIO-LOCAL. | A helper that writes `state.status = completed` is only safe for BUG-53's "normal run completed" proof. BUG-60's in-process proof, if any, must model idle-expansion behavior and malformed PM output; sharing the executor would hide the behavior boundary behind a generic "success" helper. |
| Should fake-agent bodies become named presets owned by the shared helper? | No. Keep fake-agent bodies SCENARIO-LOCAL, with the path/body as a PARAMETER BOUNDARY. | Presets such as `happyPathDevAgent` and `pmIdleExpansionAgent` would immediately turn the helper into a product-behavior catalog. That is the wrong ownership layer. Scenario files should own the exact runtime behavior they assert. |
| Is the prior "fake runtime wiring" helper wording too broad? | Yes. Tightened above. | "Fake runtime wiring" could be read as owning fake-agent behavior. The shared helper may write a caller-supplied script file and wire the config to it; it must not decide what the script does. |

**Failure mode if this review is ignored:** BUG-60 could pass by selecting a helper-owned PM preset whose assumptions are never visible in the scenario assertions. That repeats the seam-vs-flow bug class: the harness proves its own fixture contract rather than the operator workflow.

## Open Items For The Real Research Turn

- Decide whether the PM idle-expansion path consumes intake lifecycle helpers directly or runs through a normal governed PM turn.
- Decide the exact observable event names and status strings for `vision_exhausted` and `vision_expansion_exhausted`.
- Decide whether perpetual PM expansion emits `session_continuation`, a new event type, or both. Mechanical constraint: reusing `session_continuation` with `previous_run_id: null` is not a free reuse path today; `recent-event-summary.js` only prints the `prev -> next` detail when both IDs are present, so a null previous run would collapse to a generic `session_continuation` summary unless the formatter is changed. A sibling event avoids overloading run-to-run continuation semantics but requires a new `run-events.js` enum entry and summary branch.
- Decide how BUG-59 approval-policy ledger rows are asserted in the perpetual beta scenario once real tester quote-back confirms the shipped gate behavior.
