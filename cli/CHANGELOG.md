# Changelog

## 2.155.31

### Bug Fixes

- **BUG-80 roadmap-derived intent coverage hardening**: PM turns in planning phase on roadmap-derived intents are now evaluated against milestone-level coverage instead of literal implementation text. `Evidence source:` metadata items are auto-addressed as provenance, not deliverables. Dev turns in implementation phase retain full semantic keyword evaluation.

### Evidence

- node --test --test-timeout=120000 cli/test/beta-tester-scenarios/bug-79-objection-statement-normalization.test.js cli/test/beta-tester-scenarios/bug-78-no-edit-review-artifact-type.test.js cli/test/run-events.test.js cli/test/turn-result-validator.test.js -> 120 tests / 16 suites / 0 failures / 0 skipped
- Dogfood session `cont-dadd9a11` Run 2 PM turn on M28 roadmap-derived intent: previously failed with `intent_coverage_incomplete` on 2/3 acceptance items; fix resolves by recognizing milestone mention in planning output and auto-addressing metadata provenance items.

## 2.155.30

### Bug Fixes

- **BUG-79 staged-result shape recovery**: `accept-turn` now normalizes recoverable `objections[].summary` / `objections[].detail` payloads into the required non-empty `statement` field before schema validation, emits `staged_result_auto_normalized`, and keeps unknown objection shapes fail-closed with `--normalize-staged-result` recovery guidance.
- **Staged-result invariant audit**: BUG-78 and BUG-79 now share a documented normalizer table so future field-shape repairs are explicit, typed, and audited instead of one-off JSON surgery.

### Evidence

- node --test --test-timeout=120000 cli/test/beta-tester-scenarios/bug-79-objection-statement-normalization.test.js cli/test/beta-tester-scenarios/bug-78-no-edit-review-artifact-type.test.js cli/test/run-events.test.js cli/test/turn-result-validator.test.js -> 120 tests / 16 suites / 0 failures / 0 skipped

## 2.155.29

### Bug Fixes

- **BUG-77 accumulated-state hardening**: continuous mode now checks exhausted ROADMAP plus open VISION scope before broad per-goal VISION derivation. This prevents old generic VISION candidates from bypassing the PM-owned `[roadmap-replenishment]` path in real accumulated projects.
- **BUG-78 artifact-type recovery hardening**: no-edit PM, QA, and product-marketing review turns with empty `workspace` artifacts now normalize to `review` when the turn carries an explicit no-edit lifecycle signal. `accept-turn` also exposes `--normalize-artifact-type review` as a one-command recovery path.

### Evidence

- `node --test --test-timeout=180000 cli/test/beta-tester-scenarios/bug-77-roadmap-exhausted-vision-open.test.js cli/test/beta-tester-scenarios/bug-76-roadmap-open-work-continuous.test.js cli/test/vision-reader.test.js cli/test/continuous-run.test.js cli/test/status-operator-actions.test.js` -> 107 tests / 26 suites / 0 failures / 0 skipped
- `node --test --test-timeout=120000 cli/test/beta-tester-scenarios/bug-78-no-edit-review-artifact-type.test.js` -> 8 tests / 1 suite / 0 failures / 0 skipped

## 2.155.28

### Bug Fixes

- **BUG-77 hardening**: roadmap-replenishment intents now explicitly prefer the `pm` role when the project defines one and carry `phase_scope: "planning"` when a planning route exists. This makes the PM next-increment derivation requirement enforceable instead of relying on default routing.

### Evidence

- `node --test --test-timeout=180000 cli/test/beta-tester-scenarios/bug-77-roadmap-exhausted-vision-open.test.js cli/test/beta-tester-scenarios/bug-76-roadmap-open-work-continuous.test.js cli/test/vision-reader.test.js cli/test/continuous-run.test.js cli/test/status-operator-actions.test.js` -> 107 tests / 26 suites / 0 failures / 0 skipped

## 2.155.27

### Bug Fixes

- **BUG-76**: continuous mode now consumes unchecked roadmap milestones instead of idle-exiting with `runs_completed: 0`
- **BUG-77**: continuous mode now dispatches roadmap-replenishment when roadmap is exhausted but VISION.md has unplanned scope

### New Status Vocabulary

- `roadmap_open_work_detected`, `roadmap_exhausted_vision_open`, `roadmap_replenishment`

### Evidence

- 230 tests / 80 suites / 0 failures / 5 skipped

## 2.155.26

### Features
- **Source-verified comparison pages**: all nine competitor comparison pages (CrewAI, LangGraph, OpenAI Agents SDK, AG2/AutoGen, Devin, MetaGPT, OpenHands, Codegen, Warp) now include a public "Source baseline" section with official documentation links, last-checked dates, and frozen regression tests. Factual corrections across five pages: fabricated Codegen CLI examples replaced, unsupported "smart model routing" claim removed, MetaGPT incremental development noted, AG2 guardrails/safeguards split, OpenHands benchmark scope corrected, Warp repositioned as Agentic Development Environment / Oz.

### Evidence
- node --test --test-timeout=60000 cli/test/compare-crewai-claims.test.js cli/test/compare-langgraph-claims.test.js cli/test/compare-openai-agents-sdk-claims.test.js cli/test/compare-autogen-claims.test.js cli/test/compare-devin-claims.test.js cli/test/compare-metagpt-claims.test.js cli/test/compare-openhands-claims.test.js cli/test/compare-codegen-claims.test.js cli/test/compare-warp-claims.test.js cli/test/comparison-pages-content.test.js cli/test/compare-page-architecture.test.js -> 98 tests / 11 suites / 0 failures / 0 skipped

## 2.155.25

### Features
- **Dashboard Watch view**: `agentxchain dashboard` now includes a `#watch` top-level view with route status, delivery ID, event/intent/run detail, deduplication state, and error summaries. New `GET /api/watch-results?limit=<n>` endpoint. File watcher monitors `.agentxchain/watch-results/` for live dashboard updates.
- **Watch Mode docs page**: full operator-facing documentation at `/docs/watch-mode` covering HTTP listener setup, signed and unsigned curl recipes, CLI reference, endpoint contract, event routing, security guidance, and config examples.

### Evidence
- node --test --test-timeout=60000 cli/test/dashboard-watch-results.test.js cli/test/docs-dashboard-content.test.js cli/test/watch-listen.test.js cli/test/watch-results-inspection.test.js cli/test/watch-result-output.test.js cli/test/watch-auto-start.test.js cli/test/watch-route-intake.test.js cli/test/watch-event-intake.test.js cli/test/watch-command.test.js cli/test/watch-event-dir-daemon.test.js cli/test/frontdoor-install-surface.test.js -> 115 tests / 19 suites / 0 failures / 0 skipped

## 2.155.24

### Features
- **Watch HTTP webhook listener**: adds `watch --listen <port>` with `POST /webhook` intake, `GET /health`, GitHub `X-Hub-Signature-256` HMAC verification, local-only `--allow-unsigned`, request size/type validation, route reuse, durable result output, and graceful shutdown.
- **Webhook observability hardening**: accepted deliveries increment the health counter; rejected auth, malformed JSON, unsupported events, and oversized requests do not. GitHub delivery IDs are persisted into watch result records for audit correlation.
- **Operator documentation**: README and CLI README now expose the signed HTTP listener surface alongside file and directory intake modes.

### Evidence
- node --test --test-timeout=60000 cli/test/watch-listen.test.js cli/test/watch-results-inspection.test.js cli/test/watch-event-dir-daemon.test.js cli/test/watch-result-output.test.js cli/test/watch-auto-start.test.js cli/test/watch-route-intake.test.js cli/test/watch-event-intake.test.js cli/test/watch-command.test.js cli/test/frontdoor-install-surface.test.js -> 76 tests / 13 suites / 0 failures / 0 skipped

## 2.155.23

### Features
- **Watch automation bundle**: releases the governed watch slices for external event intake, route-based triage/approval, auto-start, safe planning-artifact overwrite controls, durable watch result files, event-directory polling, background `--daemon --event-dir`, and `watch --results` / `watch --result` inspection.
- **Operator documentation**: README and CLI README now expose the watch event-directory and result-inspection commands instead of documenting only the single `--event-file` path.

### Evidence
- node --test --test-timeout=60000 cli/test/watch-results-inspection.test.js cli/test/watch-event-dir-daemon.test.js cli/test/watch-result-output.test.js cli/test/watch-auto-start.test.js cli/test/watch-route-intake.test.js cli/test/watch-event-intake.test.js cli/test/watch-command.test.js cli/test/frontdoor-install-surface.test.js -> 62 tests / 12 suites / 0 failures / 0 skipped

## 2.155.22

### Bug Fixes
- **BUG-75 stale idle-expansion recovery after upgrade**: runs initialized from `pm_idle_expansion_derived` before v2.155.21 (BUG-74) lack `charter_materialization_pending`. On `loadProjectState`, the recovery detector traces `provenance.intake_intent_id` back to the intake event, confirms `pm_idle_expansion_derived` category, and reconstructs the missing flag so the PM prompt receives the materialization directive. Centralized in `loadProjectState` so every lifecycle command gets the same repair.

### Evidence
- node --test --test-timeout=60000 cli/test/bug-75-stale-idle-expansion-run-recovery.test.js -> 6 tests / 1 suite / 0 failures / 0 skipped
- node --test --test-timeout=60000 cli/test/bug-74-new-run-charter-materialization.test.js cli/test/bug-70-charter-materialization.test.js -> 17 tests / 2 suites / 0 failures / 0 skipped (regression)

## 2.155.21

### Bug Fixes
- **BUG-74 new-run charter materialization**: `initializeGovernedRun()` now sets `charter_materialization_pending` when the intake intent has `category: "pm_idle_expansion_derived"`. Previously, the flag was only set during `acceptTurn()` within a running cycle (BUG-70/73 path), leaving new-run idle-expansion intents without the materialization directive — causing the PM to skip charter materialization and fail acceptance repeatedly.
- **Run-initialization materialization event**: a `charter_materialization_required` event with `source: "run_initialization"` is emitted so event consumers can distinguish new-run materialization from within-cycle materialization.

### Evidence
- node --test --test-timeout=60000 cli/test/bug-74-new-run-charter-materialization.test.js -> 4 tests / 1 suite / 0 failures / 0 skipped
- node --test --test-timeout=60000 cli/test/bug-70-charter-materialization.test.js cli/test/intake-start-context.test.js cli/test/dispatch-bundle.test.js -> 96 tests / 14 suites / 0 failures / 0 skipped (regression)

## 2.155.20

### Bug Fixes
- **BUG-73 active retained-turn charter materialization recovery**: `step --resume` now reissues an active stale dev turn as PM before stale-turn recovery runs when planning charter materialization is pending. This covers interrupted recovery states where a previous bad replay had already reactivated the run before being stopped.
- **Watchdog ordering hardening**: materialization role correction now executes before stale-turn watchdog recovery for the single active-turn resume path, so the operator is not blocked with generic stale dev guidance when the protocol already knows PM owns the next turn.

### Evidence
- node --test --test-timeout=60000 cli/test/bug-70-charter-materialization.test.js cli/test/role-resolution.test.js cli/test/beta-tester-scenarios/bug-47-stale-turn-watchdog.test.js cli/test/step-command.test.js -> 59 tests / 18 suites / 0 failures / 0 skipped

## 2.155.19

### Bug Fixes
- **BUG-73 retained-turn charter materialization recovery**: blocked `resume` and `step --resume` paths now reissue stale retained dev turns as PM when `charter_materialization_pending` is active, preventing older dogfood recovery state from replaying implementation work before PM materializes the charter.
- **Reissue audit trail**: `reissueTurn()` can now intentionally change the replacement role and records both old and new roles in the decision ledger and `turn_reissued` event payload.

### Evidence
- node --test --test-timeout=60000 cli/test/bug-70-charter-materialization.test.js cli/test/role-resolution.test.js -> 17 tests / 2 suites / 0 failures / 0 skipped
- node --test --test-timeout=60000 cli/test/governed-cli.test.js cli/test/step-command.test.js cli/test/operator-recovery.test.js cli/test/restart-cli.test.js cli/test/e2e-escalation-recovery.test.js cli/test/e2e-policy-escalation-recovery.test.js cli/test/beta-tester-scenarios/dispatch-path-lifecycle-matrix.test.js cli/test/beta-tester-scenarios/bug-47-stale-turn-watchdog.test.js -> 142 tests / 27 suites / 0 failures / 0 skipped

## 2.155.18

### Bug Fixes
- **BUG-73 dispatch-time charter materialization routing**: role resolution now forces pending charter materialization back to PM even when persisted state still has stale `next_recommended_role: "dev"`. This covers dogfood recovery states created before `2.155.17`, not only future acceptance paths.
- **Coordinator routing parity**: multi-repo coordinator dispatch applies the same pending-materialization PM routing rule before honoring recommended roles, so stale implementation recommendations cannot leak through coordinator assignment.

### Evidence
- node --test --test-timeout=60000 cli/test/role-resolution.test.js cli/test/bug-70-charter-materialization.test.js -> 14 tests / 2 suites / 0 failures / 0 skipped
- node --test --test-timeout=60000 cli/test/dispatch-bundle.test.js cli/test/continuous-run.test.js cli/test/beta-tester-scenarios/bug-60-perpetual-idle-expansion.test.js cli/test/gate-evaluator.test.js cli/test/phase-transition-events.test.js -> 220 tests / 39 suites / 0 failures / 0 skipped

## 2.155.17

### Bug Fixes
- **BUG-73 charter materialization routing**: after an idle-expansion `new_intake_intent` stores `charter_materialization_pending`, routing now ignores the proposing turn's `proposed_next_role: "dev"` and sends the next planning turn back to the proposing planning role. This prevents a developer from receiving the PM-owned charter materialization directive while the run is still in planning.
- **DOGFOOD-EXTENDED unblock**: shipped `2.155.16` proved BUG-72's acceptance-order fix by emitting `charter_materialization_required`, but dogfood then exposed that materialization routing still followed the stale proposed implementation role. This patch keeps the run in planning and routes materialization to PM before implementation can dispatch.

### Evidence
- cd cli && node --test --test-timeout=60000 cli/test/bug-70-charter-materialization.test.js cli/test/dispatch-bundle.test.js cli/test/continuous-run.test.js cli/test/beta-tester-scenarios/bug-60-perpetual-idle-expansion.test.js cli/test/gate-evaluator.test.js cli/test/phase-transition-events.test.js -> 228 tests / 40 suites / 0 failures / 0 skipped

## 2.155.16

### Bug Fixes
- **BUG-72 idle-expansion materialization before semantic gate precheck**: idle-expansion PM results that propose a `new_intake_intent` with `phase_transition_request: "implementation"` now bypass the pre-materialization gate semantic coverage check. The missing PM-owned gate files are treated as the reason to store `charter_materialization_pending`, not as a failed-acceptance condition before the materialization guard can run.
- **DOGFOOD-EXTENDED unblock**: the charter materialization lane now handles all three dogfood-observed shapes: `new_intake_intent` plus transition request, `new_intake_intent` plus `needs_human`, and transition requests that would otherwise be rejected by stale-charter semantic coverage.

### Evidence
- cd cli && node --test --test-timeout=60000 cli/test/bug-70-charter-materialization.test.js cli/test/dispatch-bundle.test.js cli/test/continuous-run.test.js cli/test/beta-tester-scenarios/bug-60-perpetual-idle-expansion.test.js cli/test/gate-evaluator.test.js cli/test/phase-transition-events.test.js -> 227 tests / 40 suites / 0 failures / 0 skipped

## 2.155.15

### Bug Fixes
- **BUG-71 idle-expansion needs-human materialization**: idle-expansion PM results that propose a `new_intake_intent` with `status: "needs_human"` are now converted into active `charter_materialization_pending` state under the idle-expansion lane instead of blocking on a human-only scope escalation. The orchestrator keeps the run in planning, leaves `blocked_on` null, recommends PM for materialization, and emits `charter_materialization_required` with `suppressed_needs_human: true`.
- **BUG-70 residual closure shape**: the charter materialization guard now handles both emitted shapes seen in dogfood: `new_intake_intent` plus `phase_transition_request` and `new_intake_intent` plus `needs_human` with no transition request.

### Evidence
- cd cli && node --test --test-timeout=60000 cli/test/bug-70-charter-materialization.test.js cli/test/dispatch-bundle.test.js cli/test/continuous-run.test.js cli/test/beta-tester-scenarios/bug-60-perpetual-idle-expansion.test.js -> 169 tests / 33 suites / 0 failures / 0 skipped

## 2.155.14

### Bug Fixes
- **BUG-69 terminal run-completion prompt contract**: final-phase `authoritative` and `proposed` roles now receive the same full-auto run-completion guidance already provided to `review_only` roles. Under `approval_policy.run_completion.action: "auto_approve"`, terminal writers are explicitly told not to set `status: "needs_human"` solely for final approval and to use `status: "completed"` with `run_completion_request: true`.

### Evidence
- cd cli && node --test --test-timeout=60000 cli/test/bug-70-charter-materialization.test.js cli/test/dispatch-bundle.test.js -> 78 tests / 12 suites / 0 failures / 0 skipped

## 2.155.13

### Bug Fixes
- **BUG-70 suppress implementation dispatch for unchartered idle-expansion intents**: dispatch bundles no longer forward idle-expansion intents that lack a chartered scope into implementation-phase turns. Unchartered idle-expansion intents are now suppressed at the dispatch boundary so agents do not act on expansion signals that have not passed intake triage.

### Evidence
- cd cli && node --test --test-timeout=60000 -> 6,978 tests / 1,419 suites / 0 failures / 8 skipped

## 2.155.12

### Bug Fixes
- **BUG-69 full-auto gate prompt contract**: dispatch bundles now distinguish human-gated metadata from effective full-auto approval policy. Under `approval_policy.phase_transitions.default: "auto_approve"`, agents are explicitly told not to set `status: "needs_human"` solely to request phase-gate approval.
- **Run-completion prompt guidance**: final-phase review prompts now state that `run_completion_request: true` triggers orchestrator auto-approval when `approval_policy.run_completion.action` is `auto_approve`.
- **Dogfood blocker surfaced by v2.155.11**: tusq.dev cycle 01 reached PM idle expansion but stopped at a planning-only human escalation before dev could run. This patch removes the misleading prompt wording that caused that escalation.

### Evidence
- cd cli && node --test --test-timeout=60000 cli/test/dispatch-bundle.test.js cli/test/continuous-run.test.js cli/test/beta-tester-scenarios/bug-60-perpetual-idle-expansion.test.js -> 160 tests / 31 suites / 0 failures / 0 skipped

## 2.155.11

### Bug Fixes
- **Dev role code-production mandate**: the default `dev` role prompt now states that source code is the primary deliverable, and that a dev turn producing only planning documents is a failed turn.
- **Implementation-phase prompt injection**: authoritative implementation-phase turns now receive a dispatch-bundle directive requiring actual deliverable artifacts such as source files, tests, executable scripts, configuration, or manifest changes before documentation.
- **Governed scaffold templates**: `full-local-cli`, `generic`, and `enterprise-app` now carry the same source-code-first dev mandate so freshly initialized projects do not inherit the planning-only behavior.

### Evidence
- cd cli && node --test cli/test/dispatch-bundle.test.js cli/test/template-spec-consistency.test.js -> 99 tests / 11 suites / 0 failures / 0 skipped
- cd cli && node --test cli/test/*.test.js -> 6,828 tests / 1,357 suites / 0 failures / 0 skipped

## 2.155.10

### Bug Fixes
- **Embedded idle-expansion normalization**: `maybeAttachIdleExpansionSidecar` now normalizes `idle_expansion_result` in-place when it is already embedded in the turn result, running the same `normalizeIdleExpansionSidecar` transforms as the sidecar path before schema validation.
- **Flat new_intake_intent extraction**: when the PM puts `title`, `charter`, `acceptance_contract`, `priority`, and `template` at the top level of the idle expansion result instead of nesting them under `new_intake_intent`, the normalizer now extracts them into the expected nested object shape.

### Evidence
- cd cli && node --test --test-timeout=120000 -> 7,042 tests / 1,433 suites / 0 failures / 5 skipped
- cd cli && node --test --test-timeout=60000 test/continuous-run.test.js test/turn-result-validator.test.js test/intent-coverage-status.test.js test/beta-tester-scenarios/bug-60-perpetual-idle-expansion.test.js -> 188 tests / 37 suites / 0 failures / 0 skipped

## 2.155.9

### Bug Fixes
- **Handle top-level idle_expansion_result acceptance item in intent coverage**: coverage evaluator now recognizes the structured result acceptance criterion.

### Evidence
- cd cli && node --test --test-timeout=60000 test/intent-coverage-status.test.js test/beta-tester-scenarios/bug-60-perpetual-idle-expansion.test.js -> 28 tests / 11 suites / 0 failures / 0 skipped

## 2.155.8

### Bug Fixes
- **Idle-expansion charter schema alignment with validator**: the PM idle-expansion charter now specifies `new_intake_intent` as a nested object and `vision_traceability` as an array, matching the validator's expected shapes. The normalizer handles backward-compatible object-shaped traceability so older charter outputs still pass validation.

### Status
- `v2.155.8` aligns the idle-expansion charter schema with validator expectations so PM turns that follow the charter produce output the validator accepts without normalization drift.

### Evidence
- cd cli && node --test --test-timeout=60000 test/continuous-run.test.js test/turn-result-validator.test.js test/beta-tester-scenarios/bug-60-perpetual-idle-expansion.test.js -> 178 tests / 34 suites / 0 failures / 0 skipped

## 2.155.7

### Bug Fixes
- **Idle-expansion charter output format**: the PM idle-expansion charter now includes an explicit OUTPUT FORMAT section specifying both accepted output locations (top-level JSON key or sidecar file), the complete JSON schema for `new_intake_intent` and `vision_exhausted` branches, and an instruction to produce actual JSON rather than text descriptions.
- **DOGFOOD-TUSQ-DEV continuation**: the tusq.dev dogfood exposed this when a second PM idle-expansion turn understood the concept but only described the result in text decisions instead of producing the structured JSON object.

### Status
- `v2.155.7` is a dogfood charter-quality patch. The PM prompt now gives explicit output format instructions so the idle-expansion result is always produced as structured JSON.

### Evidence
- cd cli && node --test --test-timeout=60000 test/continuous-run.test.js test/beta-tester-scenarios/bug-60-perpetual-idle-expansion.test.js -> 88 tests / 21 suites / 0 failures / 0 skipped

## 2.155.6

### Bug Fixes
- **BUG-64 idle-expansion intent coverage**: `accept-turn` now treats normalized `idle_expansion_result` sidecars as the evidence source for conditional `vision_idle_expansion` acceptance items. When the sidecar chooses `new_intake_intent`, the `vision_exhausted` branch is considered not applicable, and the new-intent branch is checked structurally for charter, acceptance contract, priority, and VISION traceability.
- **DOGFOOD-TUSQ-DEV continuation**: tusq.dev proved `v2.155.5` got through schema normalization but still failed at the later `intent_coverage` stage because that layer ignored the sidecar-backed result. `v2.155.6` closes that downstream validator gap.

### Status
- `v2.155.6` is the third BUG-64 dogfood unblock patch. It preserves strict schema failures while letting real PM idle-expansion sidecars satisfy their conditional intake contract.

### Evidence
- cd cli && node --test --test-timeout=60000 test/intent-coverage-status.test.js test/turn-result-validator.test.js test/beta-tester-scenarios/bug-60-perpetual-idle-expansion.test.js -> 118 tests / 24 suites / 0 failures / 0 skipped

## 2.155.5

### Bug Fixes
- **BUG-64 false-sentinel tolerance**: idle-expansion normalization now drops harmless `vision_exhausted: false` or `vision_exhausted: null` sentinels when `kind` is `new_intake_intent`, for both top-level staged results and sibling `idle-expansion-result.json` sidecars. Truthy `vision_exhausted` objects remain rejected unless `kind` is `vision_exhausted`.
- **DOGFOOD-TUSQ-DEV continuation**: the tusq.dev branch exposed this after `v2.155.4` successfully reached the sibling sidecar path; acceptance then failed on the false sentinel rather than the original missing-result bug.

### Status
- `v2.155.5` is a dogfood unblock patch over `v2.155.4`. It completes the real PM sidecar shape observed in tusq.dev: `kind: "new_intake_intent"` plus `vision_exhausted: false`.

### Evidence
- cd cli && node --test --test-timeout=60000 test/turn-result-validator.test.js test/beta-tester-scenarios/bug-60-perpetual-idle-expansion.test.js -> 108 tests / 21 suites / 0 failures / 0 skipped

## 2.155.4

### Bug Fixes
- **BUG-64 idle-expansion sidecar acceptance**: `accept-turn` now loads a sibling `.agentxchain/staging/<turn>/idle-expansion-result.json` for required `vision_idle_expansion` turns when `turn-result.json` does not contain top-level `idle_expansion_result`. The sidecar is normalized into the canonical contract before validation, including dogfood-observed `proposed_intent` and string `vision_traceability` fields.
- **BUG-64 strict negative path preserved**: missing idle-expansion output still fails when neither top-level `idle_expansion_result` nor a sibling sidecar exists, and malformed sidecar content still flows through the canonical idle-expansion validator.

### Status
- `v2.155.4` is a dogfood unblock patch over `v2.155.3`. The tusq.dev `agentxchain-dogfood-2026-04` branch produced a valid PM idle-expansion sidecar for M28, but the shipped acceptor only read the top-level result field and blocked the run with `idle_expansion_result is required for vision_idle_expansion turns`.

### Evidence
- cd cli && node --test --test-timeout=60000 test/turn-result-validator.test.js test/beta-tester-scenarios/bug-60-perpetual-idle-expansion.test.js -> 107 tests / 21 suites / 0 failures / 0 skipped

## 2.155.3

### Bug Fixes
- **BUG-62 reconcile-safe-paths allowlist**: `reconcile-state --accept-operator-head` no longer refuses operator commits that only modify non-state `.agentxchain/` files. `SESSION_RECOVERY.md` (auto-generated recovery documentation) and `.agentxchain/prompts/*` (operator-customizable prompt overrides) are now reconcile-safe. Core governed state files (`state.json`, `history.jsonl`, `events.jsonl`, `continuous-session.json`, `session.json`) remain protected. This unblocks the tusq.dev dogfood loop where a baseline commit had modified `.agentxchain/SESSION_RECOVERY.md`.

### Status
- `v2.155.3` is a dogfood unblock patch. The tusq.dev `agentxchain-dogfood-2026-04` branch had an inherited commit (`a6a388e1`) that modified `.agentxchain/SESSION_RECOVERY.md`, which blocked `reconcile-state --accept-operator-head` and therefore blocked the entire full-auto dogfood loop.

### Evidence
- cd cli && node --test --test-timeout=60000 test/beta-tester-scenarios/bug-62-operator-commit-reconcile.test.js -> 8 tests (3 new: AT-BUG62-004, -005, -006) / 0 failures
- cd cli && node --test --test-timeout=60000 test/continuous-run.test.js test/beta-tester-scenarios/bug-60-perpetual-idle-expansion.test.js test/schedule-daemon-health-e2e.test.js -> 101 tests / 33 suites / 0 failures

## 2.155.2

### Bug Fixes
- **BUG-63 dogfood continuous startup eligibility**: `run --continuous --on-idle perpetual` now checks inherited blocked-run state and operator-commit checkpoint drift before dispatching idle-expansion work. Blocked governed runs pause with `still_blocked` and preserve the original recovery action instead of mutating intake state first.
- **BUG-63 no-mutation regressions**: added continuous-mode fixtures proving no `idle_expansion_dispatched` event and no new intake intent are created when the inherited run is blocked or when `auto_safe_only` operator reconciliation refuses unsafe governed-state drift.

### Status
- `v2.155.2` is the dogfood unblock patch over `v2.155.1`. It keeps BUG-60 perpetual idle expansion intact while making tusq.dev full-auto dogfood retryable without enqueuing PM expansion work into a run that cannot legally start.

### Evidence
- node --test --test-timeout=60000 test/continuous-run.test.js test/continuous-budget.test.js test/beta-tester-scenarios/bug-60-perpetual-idle-expansion.test.js test/schedule-daemon-health-e2e.test.js -> 111 tests / 39 suites / 0 failures / 0 skipped

## 2.155.1

### Bug Fixes
- **BUG-60 tester ask V6 copy-paste repair**: the V6 BUG-60 quote-back ask now uses a non-interactive governed scaffold prelude, preserves scaffolded routing/gates/prompts, patches the valid `approval_policy.phase_transitions` / `run_completion` schema, preserves the ROADMAP `## Phases` marker, and validates the scratch fixture before committing it.
- **BUG-60 terminal event contract correction**: V6 now checks the actual event trail: `idle_expansion_ingested` with `payload.kind == "vision_exhausted"` for PM-declared exhaustion and `idle_expansion_cap_reached` for the `vision_expansion_exhausted` cap state.
- **Session budget terminal status**: continuous budget exhaustion now persists and returns `status: "session_budget"` instead of generic `completed`, and schedule-owned sessions treat that status as terminal while preserving `continuous_session_budget_exhausted` in schedule state.

### Status
- `v2.155.1` is the BUG-60 release-truth patch over `v2.155.0`. It keeps the perpetual continuous mode feature intact while making the shipped package, tester ask, and terminal-status taxonomy agree before tester quote-back.

### Evidence
- node --test --test-timeout=60000 test/continuous-run.test.js test/continuous-budget.test.js test/beta-tester-scenarios/bug-60-perpetual-idle-expansion.test.js test/schedule-daemon-health-e2e.test.js -> 109 tests / 39 suites / 0 failures / 0 skipped

## 2.155.0

### Features
- **Perpetual continuous idle-expansion policy (BUG-60)**: when `--on-idle perpetual` is set and the vision-scan queue is exhausted, a PM idle-expansion turn synthesizes next work from VISION/ROADMAP/SYSTEM_SPEC and ingests it via `vision_idle_expansion` intake events. Three idle policies shipped: `exit` (default, bounded), `perpetual` (PM expansion), `human_review` (pause for operator).
- **Schedule-owned session vision snapshot**: schedule daemon now captures vision headings and content SHA at session creation via `resolveContinuousOptions()`, enabling idle-expansion and stale-drift detection.
- **PM idle-expansion prompt scaffold**: `agentxchain init` writes `.agentxchain/prompts/pm-idle-expansion.md` with charter-aware expansion constraints.

### Bug Fixes
- **Schedule daemon E2E test fixtures (AT-SDH-008–011)**: `resolveContinuousOptions()` defaults `autoCheckpoint: true`; added git init to test fixtures so checkpoint-turn succeeds.
- **Claim-reality preflight BUG-53 paused guard**: expanded context window from 200→400 chars and added `idle_human_review` to blocked regex.
- **Intake docs source guard**: added `vision_idle_expansion` to cli.mdx and continuous-delivery-intake.mdx.

### Status
- `v2.155.0` is the BUG-60 feature release shipping perpetual continuous mode. Supersedes `v2.154.11`.

### Evidence
- node --test cli/test/continuous-run.test.js cli/test/schedule-daemon-health-e2e.test.js cli/test/claim-reality-preflight.test.js cli/test/docs-cli-intake-content.test.js -> 136 tests / 28 suites / 0 failures / 0 skipped

## 2.154.11

### Bug Fixes
- **Out-of-band completion session accounting**: when a blocked continuous run is completed later by `agentxchain unblock <hesc>` or `agentxchain approve-completion`, the paused `.agentxchain/continuous-session.json` snapshot is now terminalized and its blocked run is counted. This closes the tusq.dev quote-back where the governed state was `completed` but the continuous session still showed `paused` with `runs_completed=0`.
- **Standing-gate completion audit**: final standing-gate run completion reconciliation now emits a `gate_approved` audit event before `run_completed`, including `gate_id`, `gate_type: "run_completion"`, and `requested_by_turn`. This keeps the terminal unblock path auditable even when completion is synthesized from the standing gate rather than a pre-existing `pending_run_completion`.

### Status
- `v2.154.11` supersedes `v2.154.10` for the remaining tusq.dev downstream accounting gaps after functional full-auto progression was confirmed fixed on `v2.154.10`.
- Functional downstream behavior remains fixed: continuous no longer idles in QA, QA advances, `launch_ready` unblock completes the run, and duplicate `product_marketing` redispatch is gone.

### Evidence
- node --test cli/test/beta-tester-scenarios/bug-52-gate-unblock-phase-advance.test.js cli/test/run-schedule-e2e.test.js cli/test/continuous-run.test.js -> 67 tests / 11 suites / 0 failures / 0 skipped

## 2.154.10

### Bug Fixes
- **Continuous active-run continuation**: `agentxchain run --continuous` now continues the current governed run when state is `active` and `active_turns` is empty, instead of falling through to vision idle cycles. This matches the tusq.dev downstream quote-back where the run was already in `qa` with `qa_ship_verdict=pending` and needed the next QA turn assignment.
- **Terminal human-gate completion recovery**: `agentxchain unblock <hesc>` now reconciles final-phase human approvals before dispatch. If the launch turn re-verified already-complete `launch_ready` artifacts, changed no files, and escalated to human for run-completion approval, unblock marks the terminal gate passed and completes the run instead of redispatching `product_marketing`.

### Status
- `v2.154.10` supersedes `v2.154.9` for downstream tusq.dev full-auto quote-back after BUG-52. BUG-52 remains accepted fixed on `v2.154.9`; this release targets the next blockers: continuous current-run continuation and terminal launch-ready completion.
- BUG-62 remains separate pending clean scratch evidence.

### Evidence
- node --test cli/test/beta-tester-scenarios/bug-59-full-auto-gate-closure.test.js cli/test/run-schedule-e2e.test.js cli/test/continuous-run.test.js cli/test/continuous-run-e2e.test.js cli/test/beta-tester-scenarios/bug-54-qa-cli-chain-reliability.test.js cli/test/beta-tester-scenarios/bug-61-tester-quoteback-ask-content.test.js -> 56 tests / 13 suites / 0 failures / 0 skipped
- node --test cli/test/beta-tester-scenarios/bug-52-gate-unblock-phase-advance.test.js cli/test/beta-tester-scenarios/bug-53-continuous-auto-chain.test.js -> 24 tests / 2 suites / 0 failures / 0 skipped

## 2.154.9

### Bug Fixes
- **BUG-52 no-change PM re-verification**: `agentxchain unblock <hesc>` now advances a satisfied human-required planning gate when the escalation-linked phase entry role re-verified already-complete gate artifacts, changed no files by design, and routed to `human` for approval. This matches the tusq.dev `turn_b68e40fbb7b5d1f4` quote-back shape that `v2.154.8` still redispatched to PM.
- **BUG-52 no-change regression proof**: added a beta scenario where planning artifacts are committed before the PM turn, the PM returns `needs_human` with `files_changed: []`, and unblock must mark `planning_signoff` passed and dispatch `dev`.

### Status
- `v2.154.9` supersedes `v2.154.8` for BUG-52 tusq.dev tester quote-back. BUG-52 still closes only after tester-quoted shipped-package output showing `unblock` advances to implementation, marks `planning_signoff` passed, dispatches `dev`, attributes the gate approval to the escalation-linked PM turn, and does not require ghost recovery.
- BUG-61, BUG-62, BUG-54, BUG-59, and BUG-53 remain open pending their existing tester quote-back contracts.

### Evidence
- node --test cli/test/beta-tester-scenarios/bug-52-gate-unblock-phase-advance.test.js -> 18 tests / 1 suites / 0 failures / 0 skipped

## 2.154.8

### Bug Fixes
- **BUG-52 escalation-turn recovery**: `agentxchain unblock <hesc>` now evaluates the turn tied to the open human escalation before falling back to `last_completed_turn_id`. This closes the tusq.dev quote-back failure where a stale completed-turn pointer caused operator approval to redispatch PM in `planning` instead of advancing the satisfied `planning_signoff` gate to `implementation`.
- **BUG-52 gate approval audit**: standing gate recovery events now carry `gate_id` and `requested_by_turn`, so tester quote-backs can prove which PM turn received human approval.
- **Vitest slice contract cleanup**: `local-cli-adapter.test.js` no longer statically imports `node:child_process`, keeping the node:test-only subprocess test out of the Vitest-included static dependency surface.

### Status
- `v2.154.8` supersedes `v2.154.7` for BUG-52 tusq.dev tester quote-back. BUG-52 still closes only after tester-quoted shipped-package output showing `unblock` advances to implementation, marks `planning_signoff` passed, dispatches `dev`, attributes the gate approval to the escalation-linked PM turn, and does not require ghost recovery.
- BUG-61, BUG-62, BUG-54, BUG-59, and BUG-53 remain open pending their existing tester quote-back contracts.

### Evidence
- node --test cli/test/beta-tester-scenarios/bug-52-gate-unblock-phase-advance.test.js && node --test cli/test/vitest-contract.test.js -> 26 tests / 3 suites / 0 failures / 0 skipped

## 2.154.7

### Bug Fixes
- **BUG-52 realistic PM `needs_human` handoff**: `agentxchain unblock <hesc>` now advances a standing pending human-approval gate when the accepted PM turn set `status: "needs_human"`, left `phase_transition_request: null`, and set `proposed_next_role: "human"`, provided the turn contributed required gate artifacts and all required gate files exist on disk.
- **BUG-52 synthetic-source verification guard**: standing-gate recovery no longer fabricates a passing verifier for gates with `requires_verification_pass: true`. If the latest blocked turn failed verification, `unblock` stays in the current phase instead of advancing from a synthetic transition source.

### Status
- `v2.154.7` supersedes `v2.154.5` for BUG-52 third-variant tester quote-back. BUG-52 still closes only after tester-quoted shipped-package output showing `unblock` advances to implementation, marks `planning_signoff` passed, dispatches `dev`, and does not require ghost recovery.
- BUG-61, BUG-62, BUG-54, BUG-59, and BUG-53 remain open pending their existing tester quote-back contracts.

### Evidence
- node --test --test-timeout=60000 test/beta-tester-scenarios/bug-52-gate-unblock-phase-advance.test.js -> 12 tests / 1 suite / 0 failures / 0 skipped
- node --test --test-timeout=60000 test/human-escalation.test.js test/run-schedule-e2e.test.js test/beta-tester-scenarios/bug-52-gate-unblock-phase-advance.test.js -> 26 tests / 3 suites / 0 failures / 0 skipped

## 2.154.5

### Bug Fixes
- **BUG-52 activeCount=0 unblock loop**: `agentxchain unblock <hesc>` now routes every blocked operator-unblock resume through the standing-gate reconcile path, even when `active_turns` is empty. This closes the v2.151.0 delegated-human approval loop where `pending_phase_transition: null` and a pending planning gate caused PM to be redispatched repeatedly instead of advancing to implementation.
- **BUG-52 empty-active evidence-gap proof**: added the missing command-chain negative case for the same empty-active standing-gate shape. Missing required gate evidence now stays blocked in the original phase, keeps the gate pending, avoids next-phase dispatch, and emits no phase-entered or cleanup events.

### Status
- `v2.154.5` is the BUG-52 third-variant activeCount=0 fix release. BUG-52 still closes only after tester-quoted shipped-package output showing `unblock` advances to implementation, marks `planning_signoff` passed, dispatches `dev`, and does not require ghost recovery.
- BUG-61, BUG-62, BUG-54, BUG-59, and BUG-53 remain open pending their existing tester quote-back contracts.

### Evidence
- node --test --test-timeout=60000 test/beta-tester-scenarios/bug-52-gate-unblock-phase-advance.test.js -> 10 tests / 1 suite / 0 failures / 0 skipped
- node --test --test-timeout=60000 test/beta-tester-scenarios/ test/governed-cli.test.js test/claim-reality-preflight.test.js -> 299 tests / 77 suites / 0 failures / 5 skipped

## 2.154.3

### Bug Fixes
- **BUG-61 tester runbook precondition**: lights-out docs and current release contracts now state that ghost auto-retry is enabled by default only under the strict full-auto approval-policy posture (`phase_transitions.default: "auto_approve"` and `run_completion.action: "auto_approve"`). Delegated-human projects must opt in with `run_loop.continuous.auto_retry_on_ghost.enabled: true` or `--auto-retry-on-ghost`; otherwise manual `reissue-turn` recovery is expected behavior.
- **BUG-61 self-contained diagnostic attempts log**: `ghost_retry.attempts_log[]` entries now carry the adapter's latest per-attempt `stderr_excerpt`, `exit_code`, and `exit_signal` when available, so `ghost_retry_exhausted.diagnostic_bundle` can be read without chasing every dispatch `stdout.log`.
- **BUG-61 diagnostic state growth cap**: per-attempt `stderr_excerpt` is capped at 800 characters at the ghost-retry state boundary, matching the local CLI adapter excerpt cap and preventing noisy runtimes from bloating `continuous-session.json`.

### Status
- `v2.154.3` is a BUG-61 quote-back clarity and diagnostic-surface patch over `v2.154.1`. It does not close BUG-61; closure still requires tester-quoted shipped-package output showing `auto_retried_ghost` followed by a successful subsequent turn, or `ghost_retry_exhausted` with the diagnostic bundle when the retry budget exhausts.
- BUG-62, BUG-52, BUG-54, BUG-59, and BUG-53 remain open pending their existing tester quote-back contracts.

### Evidence
- node --test --test-timeout=60000 test/ghost-retry.test.js test/continuous-run.test.js test/continuous-ghost-retry-e2e.test.js test/bug-61-tester-runbook-content.test.js test/lights-out-operation-guide-content.test.js -> 106 tests / 30 suites / 0 failures / 0 skipped
- website-v2 npm run build -> 0 failures

## 2.154.1

### Bug Fixes
- **BUG-62 auto-refusal blocked-state schema**: continuous `auto_safe_only` refusal now writes schema-valid blocked state (`blocked_at`, `turn_id`, `recovery.typed_reason`, `owner`, and `turn_retained`) so `agentxchain status` can render the blocker instead of falling back to unknown phase/run output.
- **BUG-62 status recovery contract**: `agentxchain status` and `agentxchain status --json` now expose `operator_commit_reconcile_refused`, the concrete `error_class`, and `agentxchain reconcile-state --accept-operator-head` for unsafe automatic operator-commit reconciliation.
- **BUG-62 refusal-class docs**: stable lights-out docs and `DEC-BUG62-AUTO-SAFE-ONLY-RECONCILE-001` now name the real reconciler classes: `governance_state_modified`, `critical_artifact_deleted`, and `history_rewrite`.
- **BUG-54 startup-proof docs**: local CLI watchdog docs now state the implementation contract: stdout or staged result clears startup, while stderr-only output is diagnostic evidence and not startup proof.

### Status
- `v2.154.1` is a BUG-62 visibility patch over `v2.154.0`. It does not close BUG-62; closure still requires tester-quoted shipped-package output for safe automatic reconciliation and unsafe refusal status surfacing.
- BUG-52, BUG-54, BUG-59, BUG-53, and BUG-61 remain open pending their existing tester quote-back contracts.

### Evidence
- node --test cli/test/beta-tester-scenarios/ cli/test/claim-reality-preflight.test.js -> 241 tests / 71 suites / 0 failures / 5 skipped
- node --test --test-timeout=60000 test/continuous-run.test.js test/lights-out-operation-guide-content.test.js test/beta-tester-scenarios/bug-62-operator-commit-reconcile.test.js -> 50 tests / 12 suites / 0 failures / 0 skipped

## 2.154.0

### Bug Fixes
- **BUG-62 manual operator-commit reconciliation**: `agentxchain reconcile-state --accept-operator-head` lets an operator accept safe fast-forward commits made on top of the last governed checkpoint without editing `.agentxchain/state.json`. The reconciler updates `accepted_integration_ref`, refreshes `session.json.baseline_ref`, records `operator_commit_reconciliation`, and emits `state_reconciled_operator_commits`.
- **BUG-62 safety refusals**: the reconciler refuses history rewrites where the previous governed baseline is not an ancestor of `HEAD`, refuses commits that modify `.agentxchain/`, and refuses deletion of critical governed evidence such as `.planning/acceptance-matrix.md`. `status` now points checkpoint drift at the reconcile command instead of generic restart guidance.
- **BUG-62 continuous auto-safe-only mode**: `run_loop.continuous.reconcile_operator_commits` now accepts `"manual"`, `"auto_safe_only"`, or `"disabled"`, with CLI override `--reconcile-operator-commits <mode>`. Full-auto approval-policy posture promotes the default to `auto_safe_only`; explicit config and CLI flags still win.
- **BUG-62 auto-refusal visibility**: continuous auto-reconcile routes through the same safety function as the manual command. Unsafe drift pauses the session, writes `blocked_on: "operator_commit_reconcile_refused"` with actionable recovery detail, and emits `operator_commit_reconcile_refused`.

### Decisions
- `DEC-BUG62-MANUAL-OPERATOR-HEAD-RECONCILE-001`
- `DEC-BUG62-AUTO-SAFE-ONLY-RECONCILE-001`

### Status
- `v2.154.0` is the BUG-62 operator-commit reconcile release. It ships the manual recovery primitive plus the continuous `auto_safe_only` policy surface so operator-authored commits no longer multiply every other full-auto recovery loop.
- BUG-62 still closes only after tester-quoted shipped-package output on `agentxchain@2.154.0`.
- BUG-52, BUG-54, BUG-53, BUG-59, and BUG-61 remain open pending tester-quoted shipped-package output on their respective release versions.

### Evidence
- node --test cli/test/beta-tester-scenarios/ cli/test/claim-reality-preflight.test.js -> 233 tests / 69 suites / 0 failures / 5 skipped
- node --test test/continuous-run.test.js test/run-events.test.js test/beta-tester-scenarios/bug-62-operator-commit-reconcile.test.js -> 53 tests / 11 suites / 0 failures / 0 skipped

## 2.153.0

### Bug Fixes
- **BUG-61 ghost-turn auto-recovery**: `run_loop.continuous.auto_retry_on_ghost` (config + CLI flags `--auto-retry-on-ghost`, `--no-auto-retry-on-ghost`, `--auto-retry-on-ghost-max-retries`, `--auto-retry-on-ghost-cooldown-seconds`) lets a continuous run auto-retry a blocked ghost turn up to the configured budget before escalating to the operator. Primitive default is off; full-auto approval-policy posture promotes it on; explicit config and CLI opt-outs always win over promotion.
- **BUG-61 same-signature early stop**: `classifyGhostRetryDecision()` now stops after 2 consecutive identical `runtime|role|failure_type` fingerprints even when the raw retry budget is not exhausted. A systematic pattern is an operator signal, not a retry loop. Governed-state `blocked_reason.recovery.detail` carries distinct phrasing (`Auto-retry stopped early after N consecutive same-signature attempts [<sig>]` vs `Auto-retry exhausted after N/N attempts`).
- **BUG-61 diagnostic bundle on exhaustion**: `ghost_retry_exhausted` payloads now include `exhaustion_reason` (`same_signature_repeat` | `retry_budget_exhausted`), `signature_repeat` (when present), and `diagnostic_bundle` (attempts log capped at 10 tail entries, fingerprint summary sorted by count, final signature). Operators get actionable triage, not just a counter.
- **BUG-61 active-run continuation branch**: `advanceContinuousRunOnce()` now continues a reissued active governed run on the next loop step instead of falling back through intake/vision seeding. `hasBlockingActiveTurn()` was widened to treat `failed_start` and `stalled` as blocking alongside `failed` and `conflicted`, closing a reconciliation gap where a retained ghost could be silently forgotten.
- **BUG-61 release-gate E2E timeout split**: BUG-61 command-chain scenarios now live in `cli/test/continuous-ghost-retry-e2e.test.js`; the original continuous E2E file no longer times out under `--test-timeout=60000`.

### Decisions
- `DEC-BUG61-GHOST-RETRY-STATE-OWNERSHIP-001`
- `DEC-BUG61-FULL-AUTO-DETECTOR-STRICT-V1-001`
- `DEC-BUG61-SIGNATURE-REPEAT-EARLY-STOP-001`

### Status
- `v2.153.0` is the BUG-61 ghost-turn auto-recovery release. It ships the auto-retry primitive, same-signature early-stop safeguard, diagnostic bundle payload, and active-run continuation branch with positive + negative + opt-out command-chain proof.
- BUG-61 still closes only after tester-quoted shipped-package output on `agentxchain@2.153.0`.
- BUG-52, BUG-54, BUG-53, BUG-59 remain open pending tester-quoted shipped-package output on their respective release versions.

### Evidence
- node --test cli/test/beta-tester-scenarios/ cli/test/claim-reality-preflight.test.js -> 230 tests / 68 suites / 0 failures / 5 skipped
- node --test cli/test/continuous-ghost-retry-e2e.test.js cli/test/continuous-run-e2e.test.js cli/test/continuous-run.test.js cli/test/ghost-retry.test.js cli/test/run-events.test.js -> 93 tests / 26 suites / 0 failures / 0 skipped

## 2.152.0

### Bug Fixes
- **BUG-52 standing gate unblock loop**: `agentxchain unblock <hesc>` now rechecks a standing `pending` phase-exit gate before redispatch when a retained same-phase active turn exists. If the gate is now satisfied, the run advances phase first and dispatches the next phase entry role instead of looping the stale same-phase role.
- **BUG-52 phase-advance cleanup**: phase advancement now removes stale active turns, budget reservations, and dispatch bundles owned by the phase being exited, while preserving accepted/completed turn history. A durable `phase_cleanup` event records what was removed.
- **BUG-52 standing-gate source reconstruction**: `reconcilePhaseAdvanceBeforeDispatch()` can synthesize a transition source from current routing when `pending_phase_transition` is absent but the current phase gate is standing `pending`. This covers the `planning_signoff` / `qa_ship_verdict` variant where human unblock previously resumed the retained blocked role.
- **Release-gate guard repair**: `cli/test/run-events.test.js` now counts the new `phase_cleanup` event, and the compressed collaboration-log summary keeps the required `### Open questions` heading.

### Decisions
- `DEC-BUG52-UNBLOCK-ADVANCES-PHASE-001`
- `DEC-BUG52-STATE-CLEANUP-ON-PHASE-ADVANCE-001`

### Status
- `v2.152.0` is the BUG-52 third-variant fix release. It ships source, docs, protocol, and packaged claim-reality proof for unblock advancing a standing satisfied phase gate before redispatch.
- BUG-52 still closes only after tester-quoted shipped-package output on `agentxchain@2.152.0`.
- BUG-60 remains blocked until BUG-52 is shipped and BUG-59 tester quote-back sequencing is satisfied.

### Evidence
- node --test cli/test/beta-tester-scenarios/ cli/test/claim-reality-preflight.test.js -> 229 tests / 68 suites / 0 failures / 5 skipped
- node --test test/agent-talk-word-cap.test.js test/run-events.test.js -> 16 tests / 2 suites / 0 failures

## 2.151.0

### Bug Fixes
- **BUG-59 approval_policy ↔ phase-advance coupling**: `cli/src/lib/governed-state.js::reconcilePhaseAdvanceBeforeDispatch()` now consults `evaluateApprovalPolicy()` when the gate evaluator returns `awaiting_human_approval`. Matching `auto_approve` rule → phase advances directly, `type: 'approval_policy'` ledger entry written matching the accepted-turn path at `governed-state.js:4909-4919`, `phase_entered` emitted with `trigger: 'auto_approved'`. `require_human` → BUG-52 `approvePhaseTransition` fallback preserved.
- **BUG-59 credentialed-gate hard-stop in approval-policy**: `isCredentialedGate(config, gateId)` reads `config.gates.<id>.credentialed`. Both `evaluatePhaseTransitionPolicy()` and `evaluateRunCompletionPolicy()` short-circuit to `require_human` with reason `"credentialed gate — policy auto-approval forbidden"` before any rule evaluates. A catch-all `auto_approve` rule cannot override.
- **BUG-59 schema + normalized-config guard**: `cli/src/lib/schemas/agentxchain-config.schema.json` carries `gates.<id>.credentialed: boolean` and structured `approval_policy` defs with `when.credentialed_gate: boolean, enum: [false]`. `cli/src/lib/normalized-config.js` rejects non-boolean `credentialed` on gates and rejects `when.credentialed_gate: true` with a decision-ID-mentioning diagnostic.
- **BUG-59 default approval_policy in generated configs + enterprise template**: `cli/src/commands/init.js` generated configs now ship explicit `approval_policy` defaults. `qa_ship_verdict` now carries `requires_verification_pass: true`. Enterprise template (`cli/src/templates/governed/enterprise-app.json`) carries the same shape with routine gates `credentialed: false`.
- **BUG-59 template-manifest whitelist (this release fix)**: `VALID_SCAFFOLD_BLUEPRINT_KEYS` in `cli/src/lib/governed-templates.js` now includes `approval_policy`. Without this, the packaged enterprise-app template validator rejected the new default blueprint with `scaffold_blueprint contains unknown key "approval_policy"`. Surface caught by `test/claim-reality-preflight.test.js`.
- **BUG-54 startup watchdog default 30 s → 120 s** (`36e7805e`): `runtimes.<id>.startup_watchdog_ms` defaults to 120,000 ms across `local_cli` runtimes. Evidence: Turn 137 measured 113,094 ms first-stdout on a 17,737-byte dispatch bundle; tester hit `stdout_attach_failed` at `running_ms: 30285` under the old default. Per-run and per-runtime overrides preserved.

### Decisions
- `DEC-BUG59-APPROVAL-POLICY-GATE-COUPLING-001`
- `DEC-BUG59-RECONCILE-POLICY-COUPLING-001`
- `DEC-BUG59-CREDENTIALED-GATE-HARD-STOP-001`
- `DEC-BUG59-CREDENTIALED-GATE-PREDICATE-NEGATIVE-ONLY-001`
- `DEC-BUG59-SCHEMA-NEGATIVE-GUARD-001`
- `DEC-BUG59-KEEP-EVALUATOR-PURE-001`
- `DEC-BUG59-AT-LABEL-UNIQUE-PER-FILE-001`
- `DEC-BUG59-GATE-ACTIONS-NOT-POLICY-AUTO-APPROVED-001`
- `DEC-BUG59-IMPL-SLICE-SCOPE-001`

### Status
- `v2.151.0` is an architectural-fix release. BUG-59 (approval_policy coupling) and BUG-54 (startup watchdog default) ship but close only after tester-quoted shipped-package output on `agentxchain@2.151.0`.
- The BUG-59 coupling is expected to resolve BUG-52's third variant (`qa_ship_verdict` + `launch_ready` with no pending object) as a side-effect. Tester verification required.
- BUG-60 (`perpetual` continuous policy) is NOT shipped; sequenced after BUG-59 tester verification per HUMAN-ROADMAP.

### Evidence
- node --test cli/test/beta-tester-scenarios/ cli/test/claim-reality-preflight.test.js → 229 tests / 68 suites / 0 failures / 5 skipped
- node --test cli/test/beta-tester-scenarios/bug-59-full-auto-gate-closure.test.js → 2 tests / 2 pass
- node --test cli/test/approval-policy.test.js cli/test/reconcile-approval-policy.test.js cli/test/normalized-config-credentialed-validation.test.js cli/test/e2e-approval-policy-lifecycle.test.js → 48 tests / 0 fail

## 2.150.0

### Bug Fixes
- **BUG-54 adapter listener ordering (`dispatchLocalCli`)**: stdout and stderr listeners are now attached before the prompt is written to the subprocess stdin. Removes an adapter-side first-byte race where a subprocess producing output on the first event-loop tick could appear as `no_subprocess_output`. The repro harness `cli/scripts/reproduce-bug-54.mjs` mirrors the same ordering so tester JSON artifacts continue to match the adapter's real spawn shape.
- **BUG-54 bounded `claude --version` probe in repro artifact**: `cli/scripts/reproduce-bug-54.mjs` now records a `command_probe` object on every configured Claude runtime (`status`, `signal`, `stdout`, `stderr`, `error`, `timed_out`). Non-Claude commands record a `skipped` probe. BUG-56 disproved the auth-env-shape-alone hypothesis; Claude CLI version/path differences are now part of the minimum BUG-54 diagnostic artifact.
- **BUG-54 discriminator runbook**: `.planning/BUG_54_DISCRIMINATOR_RUNBOOK.md` is a one-screen (under 60 lines) reading key for the repro JSON. Content locked by `cli/test/bug-54-discriminator-runbook-content.test.js`.
- **BUG-55 combined tester shape — artifact-disposition union checkpoint**: `cli/test/beta-tester-scenarios/bug-55-combined-tester-shape.test.js` adds a third subtest that exercises acceptance + checkpoint with both actor-declared `files_changed` AND `verification.produced_files[{disposition:"artifact"}]` fixture outputs. The `governed-state.js:3692-3700` merge is now asserted end-to-end, including a packaged-tarball assertion via `claim-reality-preflight.test.js`.
- **BUG-57 benchmark-suite contention flake (local gate repair)**: `cli/test/benchmark.test.js` was cancelling whole under `--test-concurrency=4` because it spawned seven redundant `benchmark --json` invocations. Consolidated via a `before()` hook into `sharedBaselinePayload`; saves ~15s and keeps the local gate under the 60s per-file timeout. `DEC-RELEASE-CUT-AND-PUSH-AS-ATOMIC-001` can now run atomically without `--skip-preflight`.
- **Docs truth — CICD-SHRINK wake**: `cli/test/runner-interface-docs-content.test.js` AT-RID-003 now asserts the public runner-interface page references `cli/scripts/prepublish-gate.sh` rather than the removed `.github/workflows/ci-runner-proof.yml`.
- **Collab guard repair**: `cli/test/agent-talk-word-cap.test.js` enforces the `### Open questions` header convention on the latest compressed summary.

### Decisions
- `DEC-BUG54-LISTENERS-BEFORE-STDIN-001`
- `DEC-BUG54-REPRO-INCLUDES-CLAUDE-VERSION-001`
- `DEC-BUG54-DISCRIMINATOR-RUNBOOK-001`
- `DEC-BUG55-COMBINED-ARTIFACT-DISPOSITION-COVERAGE-001`
- `DEC-BUG55-PACKAGED-COMBINED-ARTIFACT-PROOF-001`

### Status
- `v2.150.0` is a reliability-and-proof release. No BUG is closed by this bump; BUG-52/53/54/55/56 remain OPEN pending tester-quoted shipped-package output on `agentxchain@2.150.0`.
- BUG-54 hardening removes one adapter-level race candidate and upgrades the repro artifact. The underlying tester reproduction of 0/5 stdout on `tusq.dev-21480-clean` remains un-triaged.
- BUG-55 now has combined tester-shape + packaged claim-reality coverage for both `ignore` and `artifact` dispositions.

### Evidence
- node --test cli/test/beta-tester-scenarios/ cli/test/claim-reality-preflight.test.js → 219 tests / 66 suites / 0 failures / 5 skipped

## 2.149.2

### Bug Fixes
- **BUG-56 Claude auth preflight replaced with observed smoke probe**: `getClaudeSubprocessAuthIssue()` in `cli/src/lib/claude-local-auth.js` no longer predicts a hang from config shape. It now runs a bounded 10-second smoke probe (`runClaudeSmokeProbe`) that spawns the runtime's actual Claude command with `"ok\n"` on stdin and a watchdog. When the subprocess writes stdout, the preflight returns `null` (no issue). Only when the probe classifies `hang`, `stderr_only`, or `exit_nonzero` does it return the existing `claude_auth_preflight_failed` diagnostic — now with `smoke_probe` evidence attached. Spawn errors no longer masquerade as auth failures; they fall through to command-presence diagnostics. Claude Max users with keychain OAuth and no env-based auth now pass `connector check`, `connector validate`, and governed `run` without needing to set `ANTHROPIC_API_KEY` or add `--bare`. The v2.149.0/v2.149.1 static shape-check was a false positive for every such setup; BUG-56 corrects that regression.
- **BUG-56 probe observed across all four preflight surfaces**: the adapter (`local-cli-adapter.js`), `connector check` (`connector-probe.js`), `connector validate` (`connector-validate.js`), and `doctor` (`doctor.js`) all await the same smoke probe before asserting auth failure. `analyzeLocalCliAuthorityIntent()` no longer predicts auth hangs from command shape — that prediction belongs to the probe path.
- **BUG-56 Rule #13 positive-case + negative-case regression coverage**: `cli/test/claude-local-auth-smoke-probe.test.js` exercises six shim subprocesses (working/hanging/stderr-failing/spawn-missing/non-Claude-runtime/empty-command) and asserts the probe classifies each correctly. `cli/test/beta-tester-scenarios/bug-56-claude-auth-preflight-probe-command-chain.test.js` adds the Rule #12 command-chain proof: a working no-env/no-`--bare` shim must pass `connector check`, `connector validate`, and `run --continuous`; a hanging shim must fail all three with the existing `claude_auth_preflight_failed` diagnostic. Both tests are packed into the shipped tarball via `claim-reality-preflight.test.js`.

### Decisions
- `DEC-BUG56-PREFLIGHT-PROBE-OVER-SHAPE-CHECK-001`
- `DEC-BUG56-OBSERVED-AUTH-PREFLIGHT-001`
- `DEC-BUG56-COMMAND-CHAIN-PROOF-001`
- Supersedes: `DEC-BUG54-CLAUDE-AUTH-PREFLIGHT-001`, `DEC-BUG54-VALIDATE-AUTH-PREFLIGHT-001` (static shape-check replaced by probe-based contract)

### Rule additions
- **Rule #13**: No preflight gate ships without a positive-case regression test that proves the gate passes for at least one real valid configuration. Named prior: BUG-56.

### Status
- `v2.149.2` is a regression-correction hotfix over `v2.149.1`. The BUG-54 `claim-reality-preflight` static shape-check was overly strict; the probe-based replacement is the canonical contract going forward.
- BUG-56 closure still requires tester-quoted shipped-package output on `agentxchain@2.149.2`: `connector check local-pm` + `connector validate local-pm` must pass on Claude Max with no env auth and no `--bare`.
- BUG-54 remains OPEN. The universal keychain-hang hypothesis is rejected; the original v2.148.0 tester hang root cause is un-triaged again.
- BUG-52, BUG-55, BUG-53 remain OPEN. No change; tester evidence still the blocker.

### Evidence
- node --test cli/test/beta-tester-scenarios/ cli/test/claim-reality-preflight.test.js → 217 tests / 66 suites / 0 failures / 5 skipped
- printf 'Say exactly READY and nothing else.\n' | claude --print --permission-mode bypassPermissions --model opus --dangerously-skip-permissions → stdout: READY (on Claude Max with no env auth; disproves the v2.149.1 static shape-check)

## 2.149.1

### Bug Fixes
- **BUG-54 auth-preflight ordering**: `connector-probe.js:probeLocalCommand` now checks the Claude auth-preflight shape before the spawn-probe resolution step. Previously a missing `claude` binary on CI-like environments returned `probe_kind: 'command_presence'` before the auth-preflight branch could fire, so the packaged BUG-54 claim-reality preflight test correctly blocked the `v2.149.0` publish on `Re-verify tagged release before publish`. Config-shape auth-preflight is now independent of binary resolution, matching `connector-validate.js:108-138` ordering.

### Status
- `v2.149.0` was tagged but never reached npm (blocked by the preflight gate above).
- `v2.149.1` supersedes `v2.149.0` and ships the same BUG-54/52/55/53 payload.
- BUG-54 remains open pending tester verification on `v2.149.1` per discipline rule #12
- BUG-52 remains open pending tester verification on `v2.149.1` per discipline rule #12
- BUG-55 remains open pending tester verification on `v2.149.1` per discipline rule #12
- BUG-53 remains open pending tester verification on `v2.149.1` per discipline rule #12

### Evidence
- node --test cli/test/beta-tester-scenarios/ → 172 tests / 64 suites / 0 failures
- node --test cli/test/claim-reality-preflight.test.js → 42 tests / 1 suite / 0 failures

## 2.149.0

### Bug Fixes
- **BUG-54 Claude auth preflight**: `local_cli` Claude runtimes now fail fast on the deterministic non-interactive keychain-auth hang shape when neither env-based auth nor `--bare` is present. The canonical `claude_auth_preflight_failed` contract now surfaces across `dispatchLocalCli`, `connector validate`, and `connector check`, while `doctor` warns with the same remediation.
- **BUG-54 connector readiness truthfulness**: `connector check` no longer downgrades the known-hanging Claude shape to a soft warning. It now fails the runtime with `probe_kind: "auth_preflight"`, `error_code: "claude_auth_preflight_failed"`, boolean-only `auth_env_present`, and actionable guidance naming `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, and `--bare`.
- **BUG-54 packaged release-boundary proof**: the shipped tarball now carries packaged proofs for adapter, `connector validate`, and `connector check` auth-preflight behavior, plus the existing `process_exit` forensic fields, reproduction harness/runbook, per-runtime `startup_watchdog_ms`, and stderr-only dashboard rendering fix.
- **BUG-52 four-lane reconciler coverage**: the shipped package now proves planning-signoff recovery, qa-ship recovery, Turn 93 orphan-request unblock, and Turn 94 queued-transition resume across real CLI command chains and packed claim-reality rows.
- **BUG-55 checkpoint + verification hardening**: wrong-lineage checkpoint paths surface distinctly from genuinely missing files, undeclared verification outputs still fail with dedicated remediation, and the combined tester shape remains locked at both source and packaged boundaries.
- **BUG-53 continuous auto-chain proof**: `run --continuous --max-runs` and `idle_exit` behavior remain locked by CLI-chain and packaged proof so post-completion chaining stays visible and non-pausing.

### Status
- BUG-54 remains open pending tester verification on `v2.149.0` per discipline rule #12
- BUG-52 remains open pending tester verification on `v2.149.0` per discipline rule #12
- BUG-55 remains open pending tester verification on `v2.149.0` per discipline rule #12
- BUG-53 remains open pending tester verification on `v2.149.0` per discipline rule #12

### Evidence
- node --test cli/test/beta-tester-scenarios/ → 172 tests / 64 suites / 0 failures
- node --test cli/test/claim-reality-preflight.test.js → 42 tests / 1 suite / 0 failures

## 2.148.0

### Bug Fixes
- **BUG-54 adapter timing diagnostics**: `local-cli-adapter` now emits `startup_watchdog_ms`, `startup_latency_ms`, and `elapsed_since_spawn_ms` on `spawn_attached`, `first_output`, `startup_watchdog_fired`, and `process_exit` diagnostic lines so operators can compare observed startup against `run_loop.startup_watchdog_ms` from one row instead of diffing ISO strings.
- **BUG-54 real-Claude stdin loop proof**: a CLAUDE-gated integration test exercises the repo's actual authoritative Claude runtime contract (`claude --print --dangerously-skip-permissions` with `prompt_transport: "stdin"`) across 10 consecutive dispatches. The probe fails loudly on timeout / non-zero / malformed `--version` output and only skips on ENOENT. Handle growth stays bounded and `stdin_error` count is zero.
- **BUG-55 sub-A checkpoint completeness refinement**: `checkpoint-turn` now partitions declared `files_changed` paths into `staged`, `already_committed_upstream`, and `genuinely_missing`. It fails loudly only on `genuinely_missing`, preserving the tester-reported dirty-survival gate while accepting the legitimate BUG-23 pattern where the actor committed a declared file before checkpoint ran.
- **BUG-55 sub-B undeclared verification outputs**: acceptance emits the dedicated `error_code: 'undeclared_verification_outputs'` when declared `verification.commands` produce undeclared fixture outputs. Blank `verification.commands[]` / `machine_evidence[].command` entries are now rejected at validation time.
- **BUG-55 packaged claim-reality proof**: shipped tarball now carries two behavioral rows — `checkpoint-turn commits every declared file and leaves the tree clean`, and `rejects undeclared verification outputs then accepts once declared`.

### Status
- BUG-54, BUG-55 sub-A, and BUG-55 sub-B remain open pending tester verification on `v2.148.0` per discipline rule #12
- BUG-52 and BUG-53 carry over from `v2.147.0` under tester verification — no changes in this release

### Evidence
- node --test cli/test/beta-tester-scenarios/*.test.js → 153 tests / 61 suites / 0 failures
- node --test cli/test/claim-reality-preflight.test.js → 36 tests / 1 suite / 0 failures

## 2.147.0

### Bug Fixes
- **BUG-52 phase-gate reconciliation before redispatch**: `resume` and `step --resume` now reconcile previously failed phase-transition gates before role selection. When the gate is now satisfied, the run advances immediately, clears stale gate-failure state, emits `phase_entered` with `trigger: "reconciled_before_dispatch"`, and dispatches the next-phase role instead of re-running the same-phase PM or QA turn after `unblock`.
- **BUG-52 packaged release-boundary proof**: the shipped tarball now proves both the positive and negative reconcile branches so package regressions cannot silently reintroduce same-phase redispatch after a satisfied gate.
- **BUG-53 continuous auto-chain audit trail**: post-completion continuous sessions now emit `session_continuation` with the previous run, next run, and next objective, preserve `paused` for real blockers only, and keep chaining vision-derived work instead of silently stalling after a clean completion.
- **BUG-53 operator summary surface**: recent-event summaries now render `session_continuation <prev> -> <next> (<objective>)` so inspect/dashboard flows expose the auto-chain boundary directly.

### Status
- BUG-52 remains open pending tester verification on `v2.147.0` per discipline rule #12
- BUG-53 remains open pending tester verification on `v2.147.0` per discipline rule #12

### Evidence
- node --test cli/test/beta-tester-scenarios/*.test.js → 143 tests / 57 suites / 0 failures
- node --test cli/test/claim-reality-preflight.test.js → 34 tests / 1 suite / 0 failures

## 2.146.0

### Bug Fixes
- **BUG-51 fast-startup ghost-turn watchdog**: a new 30-second startup watchdog now detects ghost-dispatched turns that never reach real startup proof, splitting the lifecycle into `assigned -> dispatched -> starting -> running` and requiring first output or equivalent staged-result evidence before a turn is considered `running`. Ghost turns transition to retained `failed_start`, emit `turn_start_failed`, and surface an explicit `reissue-turn --reason ghost` recovery path in `status`, `resume`, and `step --resume`. Distinct from BUG-47's stale-turn watchdog, which targets turns whose subprocess started but went silent.
- **BUG-51 budget reservation release**: stale-turn and ghost-turn reconciliation now release the failed turn's USD budget reservation immediately on detection so reissued turns do not contend for budget that the framework already considered spent.
- **BUG-47 tester-sequence test accuracy**: stale-turn beta-tester scenarios now seed dispatch-progress before backdating turn timestamps so they exercise the "subprocess started but went silent" path that BUG-47 actually covers, instead of overlapping with BUG-51's ghost-turn path.

### Status
- BUG-51 remains open pending tester verification on `v2.146.0` per discipline rule #12
- BUG-47 remains open pending tester verification on `v2.146.0` (BUG-51 is the BUG-47 critique follow-up; both close together when verified)
- BUG-48 remains open pending tester verification on `v2.145.0` per discipline rule #12
- BUG-49 remains open pending tester verification on `v2.145.0` per discipline rule #12
- BUG-50 remains open pending tester verification on `v2.145.0` per discipline rule #12

### Deferred (documented decisions, not gaps)
- Tester fix #2 (split `dispatched`/`starting`/`running` turn states) — implemented on HEAD and no longer deferred. `DEC-BUG51-INTERMEDIATE-STATES-DEFERRED-001` was superseded after the dispatch path audit proved that raw dispatch-progress file presence was not authoritative startup evidence.
- Tester fix #5 (auto-reissue ghost turns) — deferred per `DEC-BUG51-AUTO-REISSUE-DEFERRED-001`. Operators should see ghost turns explicitly before the framework auto-recovers them.

### Evidence
- `node --test cli/test/beta-tester-scenarios/` → 128 tests / 55 suites / 0 failures
- `node --test cli/test/claim-reality-preflight.test.js` → 19 tests / 1 suite / 0 failures

## 2.145.0

### Bug Fixes
- **BUG-47 stale-turn watchdog**: `status`, `resume`, and `step --resume` now lazily reconcile stale `running`/`retrying` turns into retained `stalled` turns, emit `turn_stalled`, and print the explicit `reissue-turn --reason stale` recovery path instead of forcing manual diagnosis.
- **BUG-48 injected-priority lifecycle reconciliation**: stale preemption markers are now valid only for actionable `approved` / `planned` intents. Superseded, rejected, suppressed, satisfied, consumed, and archived-migration intents clear the marker at write time, and defensive reads auto-clear stale markers before status or orchestration can honor them.
- **BUG-49 accepted baseline advancement**: continuation and recovery runs now seed `accepted_integration_ref` from the child run's own starting HEAD, and successful checkpoints advance that baseline to the new checkpoint SHA so fresh runs stop reporting false drift immediately after a clean checkpoint.
- **BUG-50 run-history isolation**: child-run `run-history.jsonl` counters now stay scoped to the current run while inherited continuity metadata is preserved separately under `parent_context`, eliminating contradictory fresh-run records that claimed parent-run phase/turn totals.
- **State-consistency proof surfaces hardened**: startup-path matrix updated for stale-turn reconciliation checkpoints, and release-surface prep now reflects `v2.145.0` without claiming tester closure.

### Status
- BUG-47 remains open pending tester verification on `v2.145.0` per discipline rule #12
- BUG-48 remains open pending tester verification on `v2.145.0` per discipline rule #12
- BUG-49 remains open pending tester verification on `v2.145.0` per discipline rule #12
- BUG-50 remains open pending tester verification on `v2.145.0` per discipline rule #12

### Evidence
- 6,352 tests / 1,324 suites / 0 failures

## 2.144.0

### Bug Fixes
- **BUG-46 legacy checkpoint recovery**: `checkpoint-turn` now recovers stranded repos where a pre-fix accepted turn left `files_changed: []` in history but actor-owned dirty files remain in the working tree. Recovery is fail-closed: latest accepted turn only, no active turns, workspace/patch artifacts only.
- **.ai architecture specs shipped**: managed surface, control plane API, execution plane, portability, dashboard mutations, dashboard read-model, and operator observability contracts now frozen as pre-implementation architecture.
- **BUG-44/45/46 spec status wording corrected**: all open-bug specs now carry tester-verification caveat per discipline rule #12. Bare "shipped" status is banned for open bugs.
- **Release-note intro metadata caveat**: intro paragraphs for open-bug releases now carry tester-verification language so generated Docusaurus descriptions do not imply closure.
- **Release playbook hardened**: explicitly names `claim-reality-preflight.test.js` and `beta-tester-scenarios/*.test.js` as mandatory preflight gates.

### Status
- BUG-44/45/46 remain open pending tester verification per discipline rule #12
- Legacy recovery path means tester should now verify on v2.144.0 or later

### Evidence
- 6,297 tests / 1,315 suites / 0 failures

## 2.143.0

### Bug Fixes
- **Framework write exclusion hardened**: all framework-owned write paths now properly excluded from agent-attributed observation, preventing BUG-46-class dirty-tree pollution (DEC-FRAMEWORK-WRITE-EXHAUSTION-001).
- **Run export/restore continuity roots centralized**: `RUN_EXPORT_INCLUDED_ROOTS` and `RUN_RESTORE_ROOTS` now derive from `repo-observer.js` constants instead of maintaining separate path lists.
- **Release-note normalizer hardened** against duplicate `sidebar_position` keys.

### Tests
- diff_summary combined regression test added (DEC-DIFF-SUMMARY-REGRESSION-001)
- BUG-46 tester-sequence test pinned with exact tester state
- Packaged claim-reality smoke test added for BUG-46

### Status
- BUG-44/45/46 remain open pending tester verification

### Evidence
- 6,218 tests / 1,310 suites / 0 failures

## 2.142.0

### Bug Fixes
- **BUG-46 hardening shipped for tester verification**: acceptance now enforces dirty-tree parity with `resume`, explicitly classifies `verification.produced_files`, and preserves accepted-but-uncheckpointed prior turns during subsequent acceptance checks.
- **BUG-44/45 hardening remains live in the release lane**: phase-scoped intent retirement and retained-turn live-intent reconciliation stay shipped in the published package, but closure remains blocked on tester verification per discipline rule #12.
- **Parallel acceptance regressions corrected**: the dirty-tree parity rollout no longer false-fails on accepted-but-uncheckpointed prior turns, and mixed-runtime proposed-write fixtures now declare their real repo mutations.

### Evidence
- 6184 tests / 1308 suites / 0 failures

## 2.141.1

### Bug Fixes
- **BUG-46: post-acceptance deadlock fix is now live on npm**: this corrective release carries the accepted `v2.141.0` BUG-46 fix bundle into the published package after the original `v2.141.0` tag failed the publish-gate alignment checks. Acceptance-time verification replay no longer strands actor-owned workspace dirt, replay-only side effects are cleaned, real turn-owned files remain checkpointable, and `resume` no longer blocks on replay byproducts.
- **BUG-46 mixed-files proof**: the tester-sequence coverage now proves the workspace guard cleans replay-only side effects while preserving legitimate turn-owned `files_changed` paths for checkpoint.

### Evidence
- 6,170 tests / 1,306 suites / 0 failures

## 2.140.0

### Bug Fixes
- **BUG-45: Retained-turn acceptance now reconciles against live intent state**: `accept-turn` no longer treats the retained turn's embedded `intake_context.acceptance_contract` as authoritative. Acceptance re-reads the live intent file, skips coverage when the intent is already terminal, and uses the current on-disk contract when the intent is still active.
- **Retained-turn reconciliation now fails closed when live intent state is missing**: if a retained turn still names an `intent_id` but the live intent file is missing or unreadable, acceptance stops at `intent_reconciliation` instead of silently reusing the stale embedded contract.
- **`intake resolve --outcome completed` operator recovery path**: executing intents can now be marked completed explicitly without manual `.agentxchain/` state surgery when retained-turn evidence is already sufficient.
- **Framework-owned `HUMAN_TASKS.md` no longer poisons artifact observation**: framework-generated escalation writes are excluded from retained-turn artifact mismatch detection.

### Evidence
- 6,123 tests / 1,304 suites / 0 failures

## 2.139.0

### Bug Fixes
- **BUG-44: Phase-scoped intent retirement on phase advance**: Implementation-scoped repair intents now retire automatically when the run advances past their phase. Intents gain `phase_scope` field, auto-derived from gate references. Intent coverage evaluation is phase-aware — items for exited phases or passed gates are treated as covered. Emits `intent_retired_by_phase_advance` event.

### Infrastructure
- Fixed intake-start-context test drift from phase_scope addition
- Fixed release-notes-sidebar test to support negative sidebar_position
- Fixed v2.138.1 duplicate sidebar_position

### Evidence
- 6,114 tests / 1,302 suites / 0 failures

## 2.138.1

### Bug Fixes
- **Phantom intent reconciliation hardening**: History-based evidence now used for phantom intent reconciliation, preventing false negatives when gate files are present but no turns have been accepted.
- **BUG-43 checkpoint-turn command-path proof**: Added command-path proof for `checkpoint-turn` to verify the full dispatch pipeline end-to-end.
- **Approve-intent phantom fail-closed path**: Fixed approve-intent to fail closed when phantom detection is ambiguous, preventing silent intent promotion.

### Evidence
- 6,106 tests / 1,299 suites / 0 failures

## 2.138.0

### Bug Fixes
- **BUG-42**: Fixed continuous startup for repos with rebound legacy intents — phantom intents (approved intents whose planning artifacts already exist on disk) are now detected and superseded during startup reconciliation. `migrate-intents` expanded to handle both legacy and phantom intents (`scope: "legacy_and_phantom"`).
- **BUG-43**: Fixed `checkpoint-turn` when staging is cleared post-acceptance — ephemeral `.agentxchain/staging/` and `.agentxchain/dispatch/` paths are now filtered from `files_changed` before `git add`.
- **Phantom detection false-positive fix**: Planning gate `requires_files` are only used for phantom detection when the planning gate has not been passed and at least one turn has been completed. Prevents false positives on freshly scaffolded projects.

### Improvements
- Added 12th discipline rule: no bug closes without beta tester's verified output
- Workflow kit output schema: `agentxchain/schemas/workflow-kit-output`
- Internal beta-cycle postmortem (`.planning/BETA_CYCLE_POSTMORTEM_2026-04-18.md`)

### Evidence
- 6,104 tests / 1,299 suites / 0 failures

## 2.137.0

### Bug Fixes
- **BUG-41**: Fixed migration guard in continuous startup — removed session-flag guard so `archiveStaleIntentsForRun()` always runs regardless of `startup_reconciled_run_id` state. Legacy intents are now archived before queue selection even when the session has been reconciled on prior invocations.

### New Features
- **`migrate-intents` command**: One-shot repair command (`agentxchain migrate-intents [--json] [--dry-run]`) to archive legacy intents with `approved_run_id: null`. Operator escape hatch for repos with stuck legacy intents.

### Improvements
- Added 11th discipline rule: tester-sequence tests must seed realistic accumulated state, not clean fixtures
- `_helpers/legacy-intent-fixture.js` shared helper for reconciliation-class beta-tester scenarios
- Allowed `_helpers/` subdirectory in `beta-tester-scenarios/` test directory

### Evidence
- 6,090 tests / 1,295 suites / 0 failures

## 2.136.1

### Workflow Kit Gate Coverage Truthfulness

- **`workflow-kit describe --json` now derives gate artifact coverage from real phase linkage:** default governed gates no longer report empty coverage just because the linkage lives in `routing.<phase>.exit_gate` instead of `gates.<id>.phase`. The contract now follows the same routing-bound phase mapping the evaluator uses. (`DEC-WORKFLOW-KIT-GATE-COVERAGE-001`)
- **Gate coverage JSON now exposes `linked_phases`:** downstream consumers can see which phases bind to each gate instead of inferring linkage from artifact paths alone.
- **Explicit workflow-kit artifacts are included in routing-bound gate coverage:** additive phase artifacts now appear under the linked gate contract, so coverage truth matches the runtime gate contract.
- **Spec/docs/tests aligned:** the workflow-kit contract spec and docs now document routing-derived gate coverage, and the acceptance suite proves default governed gates map to the correct artifacts.

### Evidence

- 6,085 tests / 1,293 suites / 0 failures. Website build clean.

## 2.136.0

### Connector Portability + BUG-40 Startup Migration + DOC-1 Examples Split

- **Connector capability self-declaration:** Connectors may now declare capabilities (`can_write_files`, `proposal_support`, `workflow_artifact_ownership`) via `capabilities` in `agentxchain.json` runtime config. Declared values override type-based defaults. Unknown runtime types can be fully self-declared. Conformance warnings for known-incompatible combinations. (`DEC-CONNECTOR-CAPABILITY-DECLARATION-001`)
- **Role-runtime capability consumption:** Role-level capability truth is now derived from the merged runtime capability contract, not raw runtime type branches. Declared direct-write MCP connectors correctly surface `effective_write_path: "direct"`. (`DEC-ROLE-RUNTIME-CAPABILITY-CONSUMPTION-001`)
- **`connector capabilities` command:** Machine-readable capability handshake for external tooling. `connector capabilities <runtime_id> [--json] [--all]` returns merged contract, declared capabilities, declaration warnings, and role bindings. (`DEC-CONNECTOR-CAPABILITIES-COMMAND-001`)
- **Governed config JSON Schema:** `agentxchain/schemas/agentxchain-config` package export — machine-readable schema for `agentxchain.json`. Documents that `runtime` is the canonical raw-config field and `runtime_id` is a normalization artifact. (`DEC-AGENTXCHAIN-CONFIG-SCHEMA-001`)
- **Connector capabilities output JSON Schema:** `agentxchain/schemas/connector-capabilities-output` package export — schema for `connector capabilities --json` output covering single-runtime, multi-runtime, and error responses. (`DEC-CONNECTOR-CAPABILITIES-OUTPUT-SCHEMA-001`)
- **End-to-end schema round-trip proof:** Config-to-handshake continuity validated — runtime keys in validated config match runtime_id in validated handshake output. (`DEC-CONNECTOR-SCHEMA-ROUNDTRIP-PROOF-001`)
- **BUG-40: Continuous startup + resume migration hardened:** Shared `intent-startup-migration.js` module ensures legacy null-scoped intent migration runs on all startup paths (`run`, `run --continue-from`, `run --continuous`, `restart`, `resume`, `step --resume`). Fifth false-closure fix. (`DEC-LEGACY-INTENT-STARTUP-MIGRATION-001`)
- **DOC-1: Examples sidebar split:** `/docs/examples/` sidebar now has collapsible `Products` and `Proofs` sub-categories. Content-contract test enforces the split. (`DEC-EXAMPLES-SIDEBAR-SPLIT-001`)
- **Discipline gates:** Real-emission format guard and claim-reality packed-artifact preflight added to release gate. (`DEC-EMISSION-GUARD-001`, `DEC-CLAIM-REALITY-PREFLIGHT-001`)
- **Forward-revision visibility boundary:** `forward_revision_accepted` stays decision-ledger-only with executable boundary test. (`DEC-FORWARD-REVISION-VISIBILITY-001`)
- **Mixed conflict retry guidance:** Retry bundles now separate destructive conflict files from safe forward revisions. (`DEC-MIXED-CONFLICT-RETRY-GUIDANCE-001`)
- **Pre-run intent first-run binding:** `cross_run_durable` intents bind to the first run and clear the temporary marker. (`DEC-PRE-RUN-INTENT-FIRST-RUN-BINDING-001`)

### Evidence

- 6,072 tests / 1,290 suites / 0 failures. Website build clean.

## 2.135.1

### Gate Semantic Coverage Fix + Non-Progress Guard + Intent Migration Archival

- **BUG-37: Gate semantic coverage — structured failing_files replaces regex parsing:** `evaluatePhaseExit()`/`evaluateRunCompletion()` now return `failing_files` as a first-class field. The `gate_semantic_coverage` validator consumes that field directly instead of regex-parsing prose reasons. Eliminates the false-closure caused by regex not matching real gate emission format. (`BUG-37`)
- **BUG-38: Non-progress convergence guard:** `acceptGovernedTurn()` now evaluates the current phase exit gate after every accepted turn. Tracks `non_progress_signature` and `non_progress_count` on state. When N consecutive accepted turns leave the same gate failure intact without modifying gated files, blocks with `non_progress` and emits `run_stalled`. Default threshold: 3, configurable via `run_loop.non_progress_threshold`. Operator recovery via `reactivateGovernedRun()` with `acknowledge_non_progress`. (`BUG-38`)
- **BUG-39: Cross-run intent migration archival:** `initializeGovernedRun()` now archives pre-BUG-34 intents (`approved_run_id: null`) with `status: "archived_migration"` instead of silently adopting them. Emits `intents_migrated` event. Returns `migration_notice` for CLI display. (`BUG-39`)
- **Config normalization passthrough:** `gate_semantic_coverage_mode`, `intent_coverage_mode`, and `run_loop` now survive `normalizeV4()`. (`DEC-CONFIG-NORMALIZATION-PASSTHROUGH-001`)
- **Test fixture truthfulness:** PM planning acceptance fixtures updated to satisfy `gate_semantic_coverage`. Context section parser preserves `Files Changed` and `Changed File Previews` as first-class last-turn subsections. (`DEC-TRUTHFUL-PLANNING-FIXTURES-001`)

### Evidence

- 6,024 tests / 1,280 suites / 0 failures. Website build clean.

## 2.135.0

### Cross-Run Intent Leakage Fix + Retry Prompt Ordering + Gate Semantic Coverage Validator

- **BUG-34: Cross-run intent leakage fixed:** intents are now scoped to their originating run via `approved_run_id`. Stale intents from prior runs are archived during run init. All consume paths enforce run scoping so one run's approved intents cannot bleed into a subsequent run's context. (`BUG-34`)
- **BUG-35: Retry prompt section ordering fixed:** gate failure content now renders BEFORE injected intent in the retry `PROMPT.md`, matching the intended operator read order and preventing reviewers from seeing the intent before the failure context. (`BUG-35`)
- **BUG-36: Gate semantic coverage validator:** the acceptance pre-check now validates that every file listed in an exit gate's failing conditions is present in `files_changed`. Strict by default; lenient mode available via `gate_semantic_coverage_mode: lenient`. Prevents phantom gate failures on phase transitions where the gated file was not part of the edit set. (`BUG-36`)

### Evidence

- 5,924 tests / 1,257 suites / 0 failures. Website build clean.

## 2.134.1

### Coordinator Retry Observability + Spec Status Alignment

- **Coordinator retry projection warning event:** when a coordinator retry executes successfully but immediate `acceptance_projection` fails, a durable `coordinator_retry_projection_warning` event is now persisted in `events.jsonl` with workstream, repo, and reissued turn metadata. Previously the warning only existed in stderr and JSON command output. (`DEC-COORD-RETRY-PROJECTION-EVENT-001`)
- **JSON warning contract for retry projection:** successful coordinator retries with incomplete projection now include `warnings[]` with code `coordinator_acceptance_projection_incomplete` and `reconciliation_required: true` in JSON output. (`DEC-COORD-RETRY-WARNING-001`)
- **Status and dashboard visibility:** `agentxchain status --json` now includes a `coordinator_warnings` field, and the dashboard plan snapshot (`readPlanSnapshot`) surfaces coordinator projection warnings. Operators no longer need to explicitly query `agentxchain events` to discover incomplete reconciliation. (`DEC-COORD-WARNING-OPERATOR-VISIBILITY-001`)
- **Current-run scoping:** coordinator warnings are scoped to the active `run_id` (status) and `super_run_id` (dashboard), so historical projection warnings from prior runs do not poison later healthy runs. Status recovers `run_id` from raw state when validation is degraded. (`DEC-COORD-WARNING-RUN-SCOPE-001`)
- **Operator docs for retry warnings:** `cli.mdx` and `recovery.mdx` now document the retry warning contract, the `coordinator_retry_projection_warning` event, and the follow-up sync command. (`DEC-COORD-RETRY-DOCS-001`)
- **Coordinator/mission spec status alignment:** 6 planning specs corrected from `proposed`/`in-progress` to `completed` for fully shipped features. Class-level regression guard prevents future drift. (`DEC-SPEC-STATUS-ALIGNMENT-001`)

### Evidence

- 5,942 tests / 1,268 suites / 0 failures. Website build clean.

## 2.134.0

### Coordinator Mission Execution Hardening + Compare-Page Consolidation + Protocol Boundary

- **Coordinator acceptance projection:** successful coordinator-dispatched child-repo turns are now projected into coordinator history immediately after the child run succeeds, so plan sync reflects actual progress. (`DEC-COORD-MISSION-ACCEPTANCE-001`)
- **Coordinator retry reactivation:** targeted `mission plan launch --retry` now reactivates the blocked child run and executes the reissued turn instead of leaving the child repo stale. (`DEC-COORD-MISSION-RETRY-001`)
- **Coordinator terminal-restart dispatch:** coordinator dispatch can now initialize or restart child-repo governed runs when later workstreams target repos whose previous run already completed. (`DEC-COORD-MISSION-DISPATCH-001`)
- **Real-agent coordinator proof surface:** every coordinator lifecycle path (happy, recovery, retry, wave-failure) now has a real-agent E2E test using `local_cli` child runtimes and `step --resume`. No more `_executeGovernedRun` mocks on critical paths.
- **Compare-page consolidation:** all 9 compare pages now live under `docs/compare/` as the single canonical location, with client-side redirects for old URLs. 7 of 9 pages carry governance/recovery/multi-repo decision rows. (`DEC-COMPARE-PAGE-ARCHITECTURE-001`, `DEC-COMPARE-PAGE-DECISION-SURFACE-001`, `DEC-COMPARE-PAGE-DECISION-SURFACE-002`)
- **Protocol v8 boundary frozen:** mission hierarchy, mission plans, dashboard UX, and export/report/release surfaces are reference-runner workflow features, not protocol obligations. A future v8 requires promoted conformance or a new normative contract. (`DEC-PROTOCOL-V8-BOUNDARY-001`)
- **Stale protocol-v6 references corrected:** active docs, specs, tests, and examples that anchored on `PROTOCOL-v6.md` as current now reference `PROTOCOL-v7.md`.
- **Release postflight operator smoke:** postflight now verifies the published tarball can scaffold and validate a fresh governed workspace, not just start. (`DEC-RELEASE-POSTFLIGHT-OPERATOR-001`)

### Evidence

- 6,910 tests / 1,300 suites / 0 failures. Website build clean.

## 2.133.0

### Offline Docs Search + Docs Stack Closure

- **Offline local docs search is now built in:** the Docusaurus site now ships `@easyops-cn/docusaurus-search-local` with a hashed static index, docs-only scope, search-term highlighting, and zero external service dependency. Operators can search the full docs corpus locally and on the deployed site without Algolia or another hosted search backend. (`DEC-DOCS-SEARCH-001`)
- **Docs-stack evaluation is now executable contract, not hand-wavy preference:** the repo carries a conclusive docs-system evaluation spec plus a contract test covering the accepted Docusaurus posture: autogenerated release-note sidebar, generated sitemap, and shipped local search. (`DEC-DOCS-SYSTEM-001`)
- **Docs pain-point audit is now closed:** the three concrete usability gaps identified in the docs-system evaluation are resolved in the current stack rather than being deferred into a speculative migration: release-note sidebar automation, sitemap generation, and search.

### Evidence

- 6,875 tests / 1,257 suites / 0 failures. Website build clean.

## 2.132.0

### Conflict Loop Repair + Release Alignment Hardening

- **Conflict-loop repair for durable planning artifacts:** `accept-turn --resolution human_merge` now completes in one command, records durable merge provenance, emits `conflict_resolved`, and advances the turn to `accepted`. Same-role PM rewrites of PM-owned planning files under `.planning/` are now classified as `forward_revision` instead of destructive conflict, so iterative planning repair can continue without trapping operators in the v2.130.1 loop. (`DEC-CONFLICT-HUMAN-MERGE-001`, `DEC-FORWARD-REVISION-001`)
- **Beta-tester coverage for the exact operator loop:** added the missing tester-sequence regression proofs for one-step `human_merge` completion and repeated PM repair turns on the same planning files, plus the private coverage-gap postmortem required by the discipline rules. (`BUG-31`, `BUG-32`, `BUG-33`)
- **Conflict resolution visibility across operator surfaces:** `recent-event-summary.js`, dashboard recent-event digests, and the CLI `events` command now describe `conflict_resolved`, `turn_conflicted`, `coordinator_retry`, `turn_checkpointed`, and `dispatch_progress` with actionable context instead of bare event names. (`DEC-EVENT-SUMMARY-VISIBILITY-001`)
- **Release alignment checker now covers onboarding prereqs:** the shared release-alignment manifest validates the three onboarding docs' minimum CLI version blocks before bump, and `release-bump.sh` now allows those docs as governed release surfaces so the pre-bump failure is actually actionable. (`DEC-RELEASE-ALIGNMENT-ONBOARDING-001`)
- **CLI retry docs no longer conflate single-repo and coordinator behavior:** `cli.mdx` now distinguishes single-repo `--retry` (new launch record + new chain ID) from coordinator retry (append-only `repo_dispatches[]` on the same coordinator launch record), with a content guard to block regression. (`DEC-CLI-RETRY-DOCS-DISTINCTION-001`)
- **Homepage community links now include the canonical X/Twitter surface:** the homepage community section ships LinkedIn, X/Twitter, and Reddit cards with explicit new-tab external links, matching the navbar/footer community contract.

### Evidence

- 5,876 tests / 1,256 suites / 0 failures. Website build clean.

## 2.131.0

### Coordinator Targeted Retry + Dashboard Retry Visibility

- **Coordinator targeted retry:** `mission plan launch --workstream <id> --retry` retries a failed workstream dispatch with fail-closed safety guards. Only dispatches that previously failed can be retried; healthy or in-progress workstreams are rejected. (`DEC-MISSION-COORD-RETRY-001`, `DEC-MISSION-COORD-RETRY-002`, `DEC-MISSION-COORD-RETRY-003`)
- **Dashboard retry visibility:** `GET /api/plans` now exposes `repo_dispatches` with retry metadata so the dashboard can surface retry state and history. (`DEC-PLAN-READER-RETRY-VISIBILITY-001`)
- **Coordinator retry E2E proof:** full lifecycle test proving targeted retry from failure through re-dispatch to dashboard visibility. (`DEC-MISSION-COORD-RETRY-003`)
- **Recovery docs — coordinator-level recovery:** new coordinator-level recovery section added to `recovery.mdx`, covering workstream retry, partial-failure triage, and coordinator-level blocked state. (`DEC-RECOVERY-COORDINATOR-001`)
- **Release preflight `--dry-run` preview mode:** `agentxchain release preflight --dry-run` previews what the release preflight would check without executing gates. (`DEC-RELEASE-PLAYBOOK-PREVIEW-001`)
- **Coordinator recovery docs content guard test:** guards the coordinator recovery docs section against regression. (`DEC-RECOVERY-COORDINATOR-TEST-001`)

### Evidence

- 5,857 tests / 1,252 suites / 0 failures. Website build clean.

## 2.130.1

### Beta-Fix Discipline + Codex Command Contract

- **BUG-25 fix — `reissue-turn` runtime resolution:** `reissueTurn()` now uses `role.runtime_id || role.runtime` to match all other runtime resolution sites. Previously it read `role.runtime` from normalized config where only `runtime_id` exists, producing "Runtime 'undefined' not found." (`DEC-BUG25-RUNTIME-RESOLUTION-001`)
- **BUG-26 fix — `doctor` spawn-context parity:** `doctor`, `connector check`, and `connector validate` now probe runtimes using the same `spawn` context as real governed dispatch instead of shell lookup. If `doctor` says a runtime is healthy, dispatch will not fail with ENOENT. (`DEC-BUG26-SPAWN-PARITY-001`)
- **Codex local CLI command contract corrected:** all docs, examples, and connector checks now use `codex exec --dangerously-bypass-approvals-and-sandbox` instead of the invalid `codex --quiet` recipe. Spawn-probe timeouts are treated as successful resolution for slow local CLIs. (`DEC-CODEX-LOCAL-CLI-001`, `DEC-SPAWN-PROBE-TIMEOUT-001`)
- **29 beta-tester scenario regression tests:** one test per BUG-1 through BUG-23 and BUG-25 through BUG-30, exercising actual operator command sequences with normalized configs and real git state. Gated in CI (`npm test`) and release preflight (`--publish-gate`). Completeness contract test prevents drift. (`DEC-BETA-RELEASE-GATE-001`, `DEC-SCENARIO-BACKFILL-001`)
- **BUG-23 checkpoint handoff multi-run E2E proof:** proves `--continuous --auto-checkpoint` drives pm→dev→qa across separate governed runs with checkpoint commits between handoffs.
- **Coordinator-wave failure E2E:** proves `--continue-on-failure` and failure-stops-wave semantics with real wave dispatch.
- **Continuous api_proxy fixture fix:** `--continuous` fixtures now initialize git repos and respect `review_only` authority.
- **Missions docs corrected:** coordinator `--all-ready` and `mission plan autopilot` documented as shipped wave surfaces, not fail-closed placeholders. Repo-local recovery walkthrough added.

### Evidence

- 5,844 tests / 1,250 suites / 0 failures. 29 beta-tester scenario regressions. Website build clean.

## 2.130.0

### Accepted-Turn State Reconciliation + Repo Checkpoint

- **`restart` no longer creates ghost active turns:** the restart path now refuses to surface a newly assigned turn unless the matching dispatch bundle is durable on disk, and `restart`, `status`, and `doctor` all detect state/bundle desync instead of letting operators stack more work on corrupted state. (`DEC-RESTART-BUNDLE-001`, `DEC-BUNDLE-INTEGRITY-001`)
- **Accepted turns now reconcile derivative state instead of leaving stale caches behind:** gate cache truth is recomputed when previously-missing files now exist, intent-bound accepted turns mark the bound intake intent completed and emit `intent_satisfied`, and restart now consumes approved intents so lifecycle events keep the real `intent_id` instead of `null`. (`DEC-GATE-RECONCILIATION-001`, `DEC-INTENT-SATISFACTION-001`)
- **Stale staging data is fail-closed:** `accept-turn` and `reject-turn` now verify that any legacy staged turn result actually belongs to the active turn before consuming it, so old staging artifacts cannot silently repair or corrupt a different turn. (`DEC-STALE-STAGING-001`)
- **Repo checkpointing is now a first-class governed boundary:** `checkpoint-turn` commits the accepted turn's declared `files_changed` to git with turn provenance. `accept-turn --checkpoint` checkpoints atomically after acceptance. `run --continuous` defaults to auto-checkpoint so multi-role handoffs no longer stall on manual `git commit`. Uncheckpointed accepted turns block next authoritative assignment with a `checkpoint_required` error and recovery command. No-op accepted turns are treated as a successful checkpoint skip, not a failure. (`DEC-CKPT-001`, `DEC-CKPT-002`, `DEC-CKPT-003`)

### Evidence

- 5,795 tests / 1,218 suites / 0 failures. 108 conformance fixtures. Website build clean.

## 2.129.0

### Beta-Tester Adoption Hardening

- **Injected intent binding is now authoritative across every dispatch path:** approved `inject` intents are consumed by manual `resume`, `step --resume`, and continuous mode through one shared intake path. Dispatch bundles foreground the active injected charter, lifecycle events now carry `intent_id`, and acceptance can enforce intent coverage instead of silently drifting to unrelated PM cleanup. (`DEC-INTENT-COVERAGE-001`, `DEC-UNIFIED-INTAKE-CONSUME-001`)
- **Turn recovery is now a first-class operator surface:** `agentxchain reissue-turn` reissues stale turns against current repo state after HEAD drift, runtime rebinding, or authority drift. `reject-turn`, `restart`, `status`, and `doctor` now point at the same recovery story instead of leaving operators in poisoned-baseline dead ends. (`DEC-TURN-REISSUE-001`, `DEC-BINDING-DRIFT-DETECTION-001`)
- **Connector and doctor checks now validate the operator contract, not just binary presence:** stale CLI binaries are flagged against the published docs floor, dirty-tree warnings surface before authoritative turns, and `connector check` now warns on weak `local_cli` authority flags and prompt-transport mismatches instead of passing a configuration that will fail on first real use. (`DEC-CLI-VERSION-FLOOR-001`, `DEC-AUTHORITY-INTENT-PROBE-001`, `DEC-CLEAN-BASELINE-DOCTOR-001`)
- **Canonical operator docs and template path added:** new `full-local-cli` init template, runtime matrix, authority model, automation patterns, manual-to-automated migration guide, local CLI recipes, and project-structure docs close the first-run setup gaps surfaced by the beta tester. (`DEC-FULL-LOCAL-CLI-001`, `DEC-FULL-LOCAL-CLI-002`, `DEC-ADOPTION-QUEUE-CLOSED-001`)

### Evidence

- 5,754 tests / 1,206 suites / 0 failures. 108 conformance fixtures. Website build clean.

## 2.128.0

### Conformance Check as First-Class CLI Surface

- **`agentxchain conformance check`:** promoted protocol conformance from the overloaded `verify protocol` path to a first-class CLI noun. `verify protocol` remains as a compatibility alias over the same verifier engine. Public docs updated to present `conformance check` as the preferred entry point. (`DEC-CONFORMANCE-CLI-ALIAS-001`)

### Cold-Start Automated Onboarding Fixes

- **Dev-command array splitting:** `init --governed --dev-command` now correctly splits quoted multi-word commands (e.g., `"claude -p"` becomes `["claude", "-p"]`) instead of storing the entire string as one element that breaks `connector check`, `connector validate`, and `spawn()`. Only the first argv element is split; later elements preserve spaces for legitimate paths. (`DEC-COMMAND-ARRAY-SPLIT-001`, `DEC-DEV-CMD-NORMALIZATION-002`)
- **Manual-first dry-run warning:** `run --dry-run` now warns when the first-dispatched role is manual, so operators know `run` will immediately block. Points to `agentxchain step` as the alternative. (`DEC-DRYRUN-MANUAL-WARNING-001`)
- **Cold-start E2E proof:** new `automated-cold-start-e2e.test.js` proves the full `init → doctor → connector check → connector validate → run --auto-approve` path works from cold start with agent scripts under spaced paths.

### Evidence

- 5,597 tests / 1,171 suites / 0 failures. 108 conformance fixtures. Website build clean.

## 2.127.0

### Adapter Dispatch Progress Tracking

- **Per-turn dispatch progress:** every adapter dispatch (local_cli, api_proxy, mcp, remote_agent) now emits structured progress to a per-turn file (`dispatch-progress-<turn_id>.json`). `agentxchain status` renders an Activity line showing whether the adapter is producing output, silent, or waiting for an API response. Dashboard `/api/state` and timeline view consume the same signal. (`DEC-DISPATCH-PROGRESS-001`, `DEC-DISPATCH-PROGRESS-002`, `DEC-DISPATCH-PROGRESS-003`)
- **Parallel dispatch isolation:** progress files are keyed by turn_id so parallel dispatch (`max_concurrent_turns > 1`) never clobbers another turn's progress data. Previously all turns shared a single file.
- **E2E parallel dispatch proof:** real governed integration test with `max_concurrent_turns=2` verifies distinct per-turn progress in both `status --json` and `readAllDispatchProgress()` during concurrent in-flight dispatch. (`DEC-PARALLEL-PROGRESS-PROOF-001`)
- **Coarse event milestones:** `dispatch_progress` events emitted to `events.jsonl` at start, completion, failure, timeout, and output-resumed milestones — not per output line.

### Evidence

- 5,586 tests / 1,170 suites / 0 failures. 108 conformance fixtures. Website build clean.

## 2.126.0

### Turn Timeout Enforcement & Budget Visibility

- **In-flight dispatch timeout enforcement:** governed `run` / `runLoop` now enforce the existing `timeouts.per_turn_minutes` contract during adapter dispatch instead of only detecting timeout drift at acceptance or status boundaries. When `action: "escalate"` is configured, hung automated turns block cleanly with retained active-turn context and timeout ledger evidence. (`DEC-RUN-DISPATCH-TIMEOUT-001`)
- **Operator timeout budget visibility:** `agentxchain status`, `agentxchain turn show`, and the dashboard timeout-status endpoint now surface remaining budget, deadline, and exceeded state for all configured timeout scopes so operators can tell "still running with budget left" from "over budget" without opening `agentxchain.json`. (`DEC-TIMEOUT-BUDGET-VISIBILITY-001`)
- **Timeout docs updated:** the public timeouts guide now documents dispatch-time enforcement plus the budget display contract on CLI and dashboard surfaces.
- **Release notes sidebar normalization:** duplicate `sidebar_position` values in older release docs were normalized so Docusaurus keeps newest-first release ordering stable.

### Evidence

- 5,568 tests / 1,158 suites / 0 failures. 108 conformance fixtures. Website build clean.

## 2.125.0

### Connector Validation & Onboarding

- **`connector validate` command:** New command that proves a runtime+role binding produces valid governed turn results in an isolated scratch workspace. Supports `local_cli`, `api_proxy`, `mcp`, and `remote_agent` adapters. Manual runtimes are rejected. Scratch workspace prevents live repo mutation during validation. (`DEC-CONNECTOR-VALIDATE-001`, `DEC-CONNECTOR-VALIDATE-002`, `DEC-CONNECTOR-VALIDATE-003`)
- **Front-door guidance updated:** `init --governed`, `doctor`, and `getting-started` docs now recommend `connector validate <runtime_id>` after `connector check` — the full onboarding sequence is now `doctor → connector check → connector validate → run`. (`DEC-FRONTDOOR-VALIDATE-GUIDANCE-001`)
- **Integration guides aligned:** All 20 integration guides updated to include `connector validate` in the onboarding sequence. (`DEC-INTEGRATION-VALIDATE-001`)
- **Flag alignment test fix:** `extractBinFlags()` now prefers `program.command()` matches over subcommand matches, fixing a false positive when a subcommand shares a name with a top-level command.

### Evidence

- 5,557 tests / 1,156 suites / 0 failures. 108 conformance fixtures. Website build clean.

## 2.124.0

### Operator Adoption Quality

- **Governed init cold-start truth:** `init --governed` now prints the actual scaffold that was generated — correct runtime summary, correct routing label, correct next-step guidance. Manual-only scaffolds now explicitly say to use `agentxchain step` first.
- **Manual template correctness:** The `step` command's turn-result template now uses the turn assignment's `runtime_id` (not a hardcoded fallback) and respects the current phase's `allowed_next_roles` for `proposed_next_role`.
- **Phase handoff guidance:** `approve-transition` now warns when the next authoritative turn would fail the clean-baseline rule, with exact checkpoint instructions. Manual turn examples are now phase-aware and write-authority-aware.
- **Authoritative artifact validation:** Authoritative roles with non-empty product `files_changed` can no longer claim `artifact.type: "review"`. The validator rejects the mismatch with a clear error directing the operator to use `"workspace"` or `"commit"`.
- **Intake completed-run restart:** `agentxchain intake start --restart-completed` now exposes the engine's existing terminal-restart capability on the public CLI surface, replacing the nonexistent `init --force` guidance.

### Evidence

- 5,493 tests / 1,154 suites / 0 failures. 108 conformance fixtures. Website build clean.

## 2.123.0

Live continuous 3-run proof published, Homebrew mirror CI simplified (removed dead PR fallback), and continuous mode error messages improved.

- Live continuous 3-run proof: published end-to-end evidence for three consecutive governed continuous runs with real-model execution and deploy/distribution results (`DEC-LIVE-CONTINUOUS-3RUN-001`)
- Homebrew mirror CI: removed dead PR fallback path from `publish-npm-on-tag.yml`, simplifying the token selection to direct-push only (`DEC-HOMEBREW-MIRROR-SIMPLIFY-001`)
- Continuous mode error messages: improved error diagnostics for continuous mode failures to surface actionable context instead of generic stack traces
- Release docs and deploy/distribution results recorded for v2.122.0
- 5,481 tests / 1,153 suites / 0 failures

## 2.122.0

`2.122.0` ships public live-proof evidence for the mixed-runtime continuous run contract and fixes the Homebrew mirror sync workflow so the release pipeline tries the repo-scoped workflow token before falling back to an unmergeable PR.

- Live mixed-runtime continuous proof docs: the examples docs now publish the real `run-continuous-mixed-proof.mjs` evidence with command, runtime shape, model, session outcome, review artifact, and spend so the public proof surface matches the shipped harness (`DEC-LIVE-CONTINUOUS-PROOF-001`, `DEC-LIVE-CONTINUOUS-PROOF-002`)
- Homebrew mirror direct-push fix: `publish-npm-on-tag.yml` now tries `REPO_PUSH_TOKEN`, then `GITHUB_TOKEN`, then `HOMEBREW_TAP_TOKEN` when syncing `cli/homebrew/*`, instead of skipping the repo-scoped workflow token and falling back to a PR that cannot self-merge (`DEC-HOMEBREW-MIRROR-DIRECT-PUSH-001`)
- Release docs + marketing drafts updated to carry the truthful mixed-runtime proof story and v2.122.0 downstream release surfaces
- 5,483 tests / 1,153 suites / 0 failures

## 2.121.0

`2.121.0` ships orchestrator state files allowlist fix, export/restore continuity preservation, live-adapter dogfood proof, and the lights-out operator runbook.

- Orchestrator state allowlist: added `.agentxchain/continuous-session.json`, `.agentxchain/human-escalations.jsonl`, `.agentxchain/sla-reminders.json` to `ORCHESTRATOR_STATE_FILES` — fixes false-positive artifact mismatch rejections for `review_only` roles in continuous mode (`DEC-ORCHESTRATOR-STATE-FILES-001`)
- Export/restore continuity: all three orchestrator state files now round-trip through `agentxchain export` and `agentxchain restore`, preserving blocked continuous recovery state across workspaces (`DEC-CONTINUITY-EXPORT-001`)
- Live-adapter dogfood proof: first real-model continuous mode execution with Anthropic Haiku 4.5 via `api_proxy` — 16 API calls, $0.208 spent, all turns accepted by governance (`DEC-LIVE-DOGFOOD-001`)
- Lights-out operator runbook: new cohesive guide covering preflight, bounded proof run, daemon launch, observation, blocked recovery, priority injection, budget stops, and SIGINT behavior (`DEC-LIGHTS-OUT-DOCS-001`)
- 5,478 tests / 1,152 suites / 0 failures

## 2.120.0

`2.120.0` ships continuous failure recovery hardening, paused-session re-entry guards, and multi-schedule continuous coexistence proof.

- Continuous failure recovery: `advanceContinuousRunOnce()` now classifies governed-run outcomes by state-machine truth — `priority_preempted` no longer counts as a completed run, blocked governed results pause the session, and non-blocked failures fail the session without resolving the executing intent (`DEC-CONT-FAILURE-001`)
- Paused-session guard: a paused continuous session no longer re-enters the intake pipeline — the guard checks governed state on every poll, returns `still_blocked` while blocked, and resumes with direct `executeGovernedRun()` continuation when unblocked (`DEC-CONT-PAUSED-GUARD-001`)
- SIGINT semantics fix: first SIGINT in `executeGovernedRun()` now means "finish current in-flight work then stop", not "abort active dispatch" (`DEC-RUN-SIGINT-001`)
- Multi-schedule continuous coexistence: sibling `continuous.enabled` schedules are excluded from the normal `runDueSchedules()` path during daemon operation, preventing ownership model violations (`DEC-SCHEDULE-CONTINUOUS-003`)
- Daemon failure recovery E2E: `AT-SCHED-CONT-FAIL-001` proves schedule-owned session block/unblock lifecycle through the full daemon subprocess
- Multi-schedule E2E: `AT-SDH-011` proves two continuous schedules coexist with correct selection, session ownership, and sequential completion
- 5,470 tests / 1,150 suites / 0 failures

## 2.119.0

`2.119.0` ships session-level budget enforcement for continuous mode, adapter-level continuous E2E proof, and api_proxy prompt contract hardening.

- Session-level budget enforcement: `per_session_max_usd` config and `--session-budget` CLI flag cap cumulative spend across an entire continuous session. Pre-run budget gate stops cleanly with `session_budget_exhausted`. Schedule-owned sessions persist distinct `continuous_session_budget_exhausted` status. Invalid budget values fail closed (`DEC-CONT-BUDGET-001`, `DEC-CONT-BUDGET-002`)
- Continuous api_proxy E2E: `AT-CONT-APIPROXY-001/002` prove continuous mode through the real api_proxy adapter pathway with a mock Anthropic HTTP server, mixed adapter setup, vision provenance, and real intake lifecycle (`DEC-CONT-APIPROXY-PROOF-001`)
- API proxy prompt contract hardening: integration test mocks now parse markdown-formatted dispatch bundles (`**Run:**`, `**Turn:**`, `**Phase:**`) instead of accidental JSON fragments. Tests fail closed on fallback defaults (`DEC-APIPROXY-PROMPT-CONTRACT-001`)
- Docs updated: CLI reference, lights-out scheduling, and recovery docs cover session-level budget enforcement
- 5,463 tests / 1,149 suites / 0 failures

## 2.118.0

`2.118.0` ships schedule-owned continuous mode — the daemon can now own a persistent vision-driven continuous session, advance governed runs one step per poll, and keep repo-local lights-out execution on one shared continuous-step contract.

- Schedule-owned continuous mode: `schedules.<id>.continuous` enables daemon-managed vision-driven execution with validated `vision_path`, `max_runs`, `max_idle_cycles`, and `triage_approval` (`DEC-SCHEDULE-CONTINUOUS-001`)
- Shared step primitive: both `run --continuous --vision <path>` and `schedule daemon` continuous mode now use `advanceContinuousRunOnce(...)`, so CLI-owned and daemon-owned continuous execution cannot drift semantically (`DEC-SCHEDULE-CONTINUOUS-001`)
- Multi-entry selection fix: daemon continuous selection is now active-owner-first, then due-entry-first, preventing declaration-order starvation when more than one schedule enables continuous mode (`DEC-SCHEDULE-CONTINUOUS-002`)
- Schedule-state truthfulness: `.agentxchain/schedule-state.json` now persists `last_continuous_session_id` through the normalizer path instead of silently dropping it (`DEC-SCHEDULE-STATE-NORMALIZER-001`)
- Docs updated: CLI reference and lights-out scheduling docs now cover schedule-owned continuous mode, ownership metadata, blocked recovery, and priority-preemption semantics
- 5,449 tests / 1,141 suites / 0 failures

## 2.117.0

`2.117.0` ships vision-driven continuous mode — fully autonomous lights-out operation where agents derive work from a project's `VISION.md`, execute governed runs back-to-back, and complete all three HUMAN-ROADMAP items for full-auto operation.

- Vision-driven continuous mode: `agentxchain run --continuous --vision <path>` reads VISION.md, derives candidate work from unaddressed goals, seeds the intake pipeline, and chains governed runs autonomously. Vision path is always project-relative, never hardcoded. Session state persists to `.agentxchain/continuous-session.json` and is visible via `agentxchain status` (`DEC-VISION-CONTINUOUS-001`)
- Real intake lifecycle consumption: continuous mode uses `planIntent` -> `startIntent` -> `resolveIntent` for proper provenance. No orphaned intents (`DEC-VISION-CONTINUOUS-002`)
- First-class continuous provenance: `trigger: "vision_scan"` and `created_by: "continuous_loop"` are valid provenance values (`DEC-VISION-CONTINUOUS-003`)
- Human escalation events: `human_escalation_raised` and `human_escalation_resolved` promoted to `events.jsonl` and webhook notification fan-out. Non-webhook local notifier floor emits structured stderr notices. macOS native notification via `AGENTXCHAIN_LOCAL_NOTIFY=1` (`DEC-HUMAN-ESCALATION-EVENTS-001`)
- Scheduler auto-resume on unblock: `schedule daemon` treats blocked schedule-owned runs as non-fatal wait states. After the operator runs the surfaced recovery command, the daemon continues within one poll interval (`DEC-SCHEDULE-DAEMON-UNBLOCK-001`). Note (post-`v2.146.0`): `agentxchain unblock <id>` covers `needs_human` blockers only; ghost-startup turns require `agentxchain reissue-turn --reason ghost` (BUG-51) and stalled turns require `agentxchain reissue-turn --reason stale` (BUG-47). Operators must follow the `recovery_action` / `blocked_category` surfaced on `schedule run-due --json` and `schedule daemon --json`, not assume `unblock <id>` is universal (`DEC-BUG51-SCHEDULE-DOC-RECOVERY-001`, `DEC-BUG51-CONTINUOUS-DOC-RECOVERY-001`)
- Priority injection scheduler consumer: `schedule daemon` consumes `priority_preempted` by planning/starting injected p0 work into the same schedule-owned run (`DEC-INJECT-SCHEDULE-CONSUMER-001`)
- Fixed VALID_RUN_EVENTS count (14 -> 16) after human escalation event types were added
- Fixed CI API dispatch proof stderr assertion to tolerate legitimate human-escalation notices
- 5431 tests / 1136 suites / 0 failures

## 2.116.0

`2.116.0` ships mission plan autopilot — unattended lights-out execution of dependency-ordered mission plans with wave-by-wave progression, failure policies, and safety limits.

- Mission plan autopilot: `agentxchain mission plan autopilot [plan_id]` executes approved mission plans unattended. Scans for ready workstreams, launches them, records outcomes, re-scans for newly-unblocked dependents, and repeats until the plan completes or a terminal condition is hit (`DEC-MISSION-AUTOPILOT-001`)
- Wave execution model: autopilot processes dependency waves sequentially. Each wave launches all currently-ready workstreams, waits for outcomes, then re-evaluates. Reloads plan from disk between waves to pick up dependency-unblocked workstreams
- Failure policies: default fail-stop halts on first workstream failure. `--continue-on-failure` skips failed workstreams and keeps launching remaining ready work. When no ready workstreams remain but failures exist, exits `plan_incomplete` instead of misclassifying as deadlock (`DEC-MISSION-AUTOPILOT-002`)
- Safety limits: `--max-waves <n>` caps wave count (default: 10). `--cooldown <seconds>` between waves (default: 5). Deadlock detection when no workstreams are ready and none completed in the current wave
- Provenance: each autopilot-launched workstream carries `trigger: autopilot` with wave number in its launch record
- JSON output: `--json` returns full wave structure with per-wave workstream details and terminal reason
- Hardened Homebrew mirror PR closeout: re-resolves PR number from deterministic fallback branch instead of masking with `continue-on-error` (`DEC-HOMEBREW-SYNC-016`)
- 5370 tests / 1116 suites / 0 failures

## 2.115.0

`2.115.0` completes the mission plan lifecycle with auto-completion, workstream retry, and single-command mission health visibility — closing the loop from plan creation through governed recovery.

- Plan auto-completion: plans auto-transition to `completed` when all workstreams finish successfully. No separate operator command needed — happens inside `markWorkstreamOutcome`. Previously a fully-complete plan stayed `approved` forever (`DEC-MISSION-PLAN-AUTO-COMPLETE-001`)
- Workstream retry: `agentxchain mission plan launch --workstream <id> --retry` retries failed workstreams (`needs_attention` only). New chain_id, old launch record preserved for audit, new record marked `retry: true`. Plan status returns from `needs_attention` to `approved` during retry. `--retry` requires `--workstream` and is mutually exclusive with `--all-ready` (`DEC-MISSION-PLAN-RETRY-001`)
- Mission show plan health: `mission show` now surfaces latest plan ID, plan status, completion percentage, and workstream-status breakdown. `--json` exposes the same `latest_plan` summary. Shared plan-progress summarization reused by CLI and dashboard (`DEC-MISSION-SHOW-PLAN-SUMMARY-001`)
- Cascade rejected: `--cascade` explicitly rejected as scope creep. Operator cost of re-running `--all-ready` is trivial. Future unattended execution belongs in a separate `mission run --autopilot` surface (`DEC-MISSION-PLAN-LAUNCH-CASCADE-001`)
- Missions docs and CLI reference updated for retry, auto-completion, and plan health surfaces
- 5359 tests / 1114 suites / 0 failures

## 2.114.0

`2.114.0` turns mission decomposition into a one-session operator flow: mission creation can generate a proposed plan immediately, offline planner output is a real supported input, and approved plans can launch every currently-ready workstream in one fail-closed batch.

- Mission start auto-planning: `agentxchain mission start --plan` now creates the mission first, then generates exactly one `proposed` plan without weakening the approval boundary. `--constraint`, `--role-hint`, and `--planner-output-file` now flow through the same planning path, and `--json` returns `{ mission, plan }` (`DEC-MISSION-START-PLAN-001`, `DEC-MISSION-PLAN-OFFLINE-001`)
- Offline planner parity: `agentxchain mission plan --planner-output-file <path>` is now a real contract instead of fake CLI guidance. Offline planner JSON goes through the same parse and validation path as live planner output, with no second schema
- Batch workstream launch: `agentxchain mission plan launch --all-ready` launches all currently `ready` workstreams from an approved plan in plan declaration order, fails closed on the first launch failure, rejects `--all-ready` with `--workstream`, and reports zero-ready plans explicitly instead of silently succeeding (`DEC-MISSION-PLAN-LAUNCH-ALL-READY-001`)
- Missions docs + CLI reference updated for the new operational flow: `mission start --plan -> mission plan approve -> mission plan launch --all-ready`
- 5349 tests / 1112 suites / 0 failures

## 2.113.0

`2.113.0` ships mission decomposition — the governed planning layer that splits a mission goal into dependency-ordered workstreams with LLM-assisted generation, approval gates, and one-command execution through the chain runner.

- Mission decomposition: `agentxchain mission plan` generates dependency-ordered workstreams from a mission goal via LLM-assisted planning. Strict schema validation (required fields, type checking, duplicate ID detection, dependency reference validation, chain_id pre-allocation rejection). Durable plan artifacts under `.agentxchain/missions/plans/<mission_id>/`. `launch_status` derived from dependency edges at creation time. Revision by supersession. `mission plan show` and `mission plan list` for inspection
- Plan approval gate: `mission plan approve` enforces latest-only governance. Approving a newer plan supersedes older active plans. Fails closed on stale/non-proposed targets. Deterministic recency via monotonic plan IDs (`DEC-MISSION-PLAN-APPROVAL-001`, `DEC-MISSION-PLAN-RECENCY-001`)
- One-command workstream launch: `mission plan launch --workstream <id>` preallocates chain_id, executes immediately via `executeChainedRun`, reconciles workstream outcome from real run result. Dependency satisfaction based on latest run status in bound chain report. Five launch states: `ready`, `blocked`, `launched`, `completed`, `needs_attention` (`DEC-MISSION-PLAN-LAUNCH-001`, `DEC-MISSION-PLAN-LAUNCH-EXECUTION-001`)
- Dashboard plan visibility: dedicated `GET /api/plans` endpoint with `?mission=<id>` filter. Integrated into Mission view with workstream table, launch records, status breakdown. Recursive file watching for `missions/plans/**/*.json` (`DEC-DASHBOARD-PLAN-VISIBILITY-001`, `DEC-DASHBOARD-PLAN-API-001`)
- Missions docs update: `/docs/missions` now covers the full decomposition flow — plan artifacts, approval, launch, dashboard visibility, and immediate-execution boundary (`DEC-MISSIONS-DOCS-DECOMPOSITION-001`)
- Protocol v7/v8 boundary audit: all post-v7 features (mission hierarchy, plans, dashboard) confirmed as reference-runner advisory — zero conformance surface changes (`DEC-PROTOCOL-V8-NO-BUMP-001`)
- 5339 tests / 1110 suites / 0 failures

## 2.112.0

`2.112.0` ships single-repo mission hierarchy — the governed layer above chained runs that groups related chains under named missions with aggregate status, cross-chain decision carryover, and dashboard visibility.

- Single-repo mission hierarchy: `agentxchain mission start`, `mission list`, `mission show`, `mission attach-chain` with durable mission artifacts under `.agentxchain/missions/`. Mission snapshots derive chain count, total runs/turns, latest chain terminal reason, active repo-decision count, and derived status (`planned`, `progressing`, `needs_attention`, `degraded`)
- Mission auto-binding during chained execution: `run --chain --mission <id>` or `--mission latest` auto-attaches chain reports to the target mission. Config-driven via `run_loop.chain.mission`. Explicit mission IDs fail closed if missing; `--mission latest` warns but continues chaining
- Dashboard mission visibility: dedicated `Mission` view backed by `GET /api/missions` with latest mission identity/goal, derived status, aggregate totals, active repo-decision count, and attached-chain lineage. Dependency-owned invalidation ensures chain-report changes refresh both `Chain` and `Mission` views
- Release-alignment unification: `release-preflight.sh` now validates surfaces through the shared `check-release-alignment.mjs` manifest. Three test files deduplicated to import evidence extraction from `cli/src/lib/release-alignment.js` instead of maintaining local copies
- Dashboard app view set test fixed to include `Mission` view registration
- Decision noun boundary frozen: `mission` is single-repo multi-chain grouping; `initiative` is multi-repo coordinator orchestration (`DEC-MISSION-HIERARCHY-001`)
- 5273 tests / 1095 suites / 0 failures

## 2.111.0

`2.111.0` ships run chaining for lights-out operation, a dedicated chain CLI operator surface, and dashboard chain visibility — closing the loop from runtime to first-glance observability for continuous governed execution.

- Run chaining (`agentxchain run --chain`): auto-continues governed runs on chainable terminal status with configurable max chains, chain-on statuses, and cooldown. Composes existing primitives (`--continue-from`, `--inherit-context`) without new state machine states. Chain reports written to `.agentxchain/reports/chain-*.json` with per-run lineage, provenance triggers, and inherited-context summaries
- Three runtime bugs fixed in chaining: illegal provenance + continue-from combination, off-by-one chain counting, SIGINT listener leak across chained invocations
- Chain CLI operator surface: `agentxchain chain latest`, `chain list`, `chain show` with `--json` support. Dedicated command family above individual run history
- Dashboard chain visibility: dedicated `Chain` view backed by `GET /api/chain-reports`, file-watcher invalidation, latest chain summary + per-run lineage + recent chain sessions table
- Gate-action timeout evidence in `run diff` and `export diff`: fixed `[object Object]` rendering bug in `formatValue`, added cause-aware gate regression messages
- Product-boundary truth hardened: MetaGPT compare page corrected, regression guard expanded to all compare pages with hosting rows
- Integration guide cost-rate key fix: 6 guides corrected from `input_per_million`/`output_per_million` to `input_per_1m`/`output_per_1m` matching code contract
- Cost-rate override documentation normalized: all non-bundled model examples now explicitly framed as operator overrides
- 5246 tests / 1087 suites / 0 failures

## 2.110.0

`2.110.0` closes the gate-action timeout parity gap: every operator-facing surface now distinguishes timed-out gate actions from generic failures, and dry-run previews show custom timeout configuration.

- Gate-action timeout parity: `status`, `report` (text/markdown/HTML), dashboard blocked view, and dashboard gate review now show "timed out after Nms" instead of generic "failed" when a gate action hits its timeout
- Per-action `timeout_ms` support (1s–1hr, default 15min) with structured timeout evidence in blocked-reason payload and decision ledger
- Workspace boundary frozen: gate actions execute in the repo root with workspace write access, documented explicitly in spec and operator guide
- Dry-run timeout preview: `--dry-run` shows custom timeout configuration for actions that override the 15-minute default
- 9 gate-action tests + 2 dashboard E2E + 10 docs tests = 21 tests / 0 failures
- 5177 tests / 1073 suites / 0 failures

## 2.109.0

`2.109.0` ships governed gate actions as a complete operator surface — runtime execution, CLI dry-run, dedicated docs page, dashboard visibility with gate-type-correct recovery — and hardens the release pipeline for rerun safety.

- Gates can now own post-approval automation commands via `gate_actions` on `gates.<gate_id>`, with per-action exit-code tracking, structured failure evidence in the decision ledger, and automatic run-blocking on failure
- `approve-transition --dry-run` and `approve-completion --dry-run` preview configured gate actions without executing them
- New `/docs/gate-actions` operator guide covering config syntax, execution semantics, dry-run, failure/retry model, environment variables, and decision-ledger evidence
- Dashboard gate-action visibility: pending gates show configured actions, blocked states show full failure detail including per-action status, exit codes, stderr tail, and gate-type-correct dry-run recovery hints
- E2E dashboard proof using real CLI-produced gate-action failures, not just mocked fixtures
- Release idempotency audit: all 16 release/publish/deploy scripts verified, `publish-vscode-on-tag.yml` fixed to detect existing Marketplace publications
- Approval SLA reminder notifications for stale pending approvals
- Timeout pressure surfaced during approval waits
- Conflict-loop recovery UX parity across all operator surfaces
- 5166 tests / 1073 suites / 0 failures

## 2.108.0

`2.108.0` turns conflict observability into a first-class operator surface instead of scattering it across state files, dashboard guesses, and notification drift.

- Conflict decisions now surface in governed reports, so accepted-turn overlap shows up in the real operator narrative instead of hiding in raw ledger fields
- `turn_conflicted` is now a durable lifecycle event in `.agentxchain/events.jsonl`, not just an in-process callback detail
- The dashboard timeline now reads `/api/events?type=turn_conflicted&limit=10` and renders conflict metadata directly in the Timeline view
- Conflict-loop exhaustion now emits the missing `run_blocked` notification with `category: conflict_loop`, while intermediate conflict detections remain observability-only to avoid webhook noise
- `agentxchain events --type turn_conflicted` now renders inline conflict details including overlapping files, overlap percentage, detection count, and accepted-since turn IDs
- 5164 tests / 1072 suites / 0 failures

## 2.107.0

`2.107.0` brings behavior-level proof parity to the social-post wrappers and removes artificial delay from the X/Twitter fixture path so that proof stays cheap enough to run.

- Added `cli/test/linkedin-posting-script.test.js`, an executable fixture suite that spawns the real LinkedIn wrapper through fake `li-browser` and `python` binaries across clean-success, ambiguous-submit, fallback, and profile-selection paths
- Added `.planning/LINKEDIN_POSTING_TRUTH_BOUNDARY_SPEC.md` to freeze the LinkedIn wrapper's verified-success, fail-closed, and retry-boundary contract
- `cli/test/x-posting-script.test.js` now patches the wrapper's retry sleep to `0` inside the fixture, cutting behavior-proof wall clock without weakening the fallback control-flow contract
- Both X/Twitter and LinkedIn posting wrappers are now covered by behavior-level proof instead of content-only shell assertions
- 5069 tests / 1054 suites / 0 failures

## 2.106.0

`2.106.0` hardens social-post verification so ambiguous X/Twitter submits are only treated as success when publication is actually proven.

- `post-twitter.sh` now verifies ambiguous submits on both the primary attempt and the opposite-profile fallback attempt before reporting success
- X/Twitter timeline verification is now pipefail-safe and no longer loses real matches to `grep -q` early-exit behavior
- Snippet extraction now trims leading/trailing whitespace in both `post-twitter.sh` and `post-linkedin.sh`, closing end-of-post false negatives in the mirrored verification helper
- New behavior-level shell proof in `cli/test/x-posting-script.test.js` exercises the exact exit-status and call-order contract for verified/unverified primary and fallback paths
- 5061 tests / 1053 suites / 0 failures

## 2.105.0

`2.105.0` tightens public comparison truth and hardens the release identity path so tagged cuts carry the required commit trailer.

- Comparison pages now acknowledge the current official runtime capabilities of CrewAI, LangGraph, AG2/AutoGen, Devin, OpenHands, MetaGPT, and the OpenAI Agents SDK instead of leaning on stale shorthand
- The competitive positioning matrix and compare-specific docs/tests now freeze those truth boundaries, so future edits have to keep the contrast on repository-delivery governance rather than denying competitor runtime features
- `release-bump.sh` now requires `--coauthored-by`, writes the `Co-Authored-By:` trailer into the release commit body, and verifies that trailer before creating the annotated tag
- Release-path drift guards were repaired around coordinator blocker output, multi-repo approval phrasing, remote-agent connection-failure handling, and the restore README boundary
- 5054 tests / 1052 suites / 0 failures

## 2.104.0

`2.104.0` closes a workflow-kit recovery gap and hardens the tagged publish gate around the actual workflow contract.

- New governed recovery command: `agentxchain generate planning` restores scaffold-owned planning artifacts without re-running `init`
- Shared planning-artifact builder now keeps `init` and `generate planning` on one source of truth for governed baseline files, template files, and workflow-kit placeholders
- New release-gate proof: tagged publish verification now includes `release-docs-content.test.js`, so workflow-contract regressions fail before npm publish instead of slipping past the narrowed gate
- CLI, README, and quickstart docs now surface `generate planning` as the scaffold recovery path
- 4710 tests / 1004 suites / 0 failures

## 2.103.0

- Decision authority now enforces repo-decision overrides through the real governed acceptance path instead of comparing against an undefined overriding role
- Config validation rejects invalid `decision_authority` values outside integer `0..99`
- Dispatch context, export verification, and governance reports now preserve authority metadata for active repo decisions
- `agentxchain role show` prints configured decision authority and new regression coverage proves context, CLI, export, and acceptance-path behavior
- 4698 tests / 1003 suites / 0 failures

## 2.102.0

- Named benchmark workload catalog: baseline, stress, completion-recovery, phase-drift
- Workload discovery subcommand: `benchmark workloads` with topology metadata
- Phase-drift workload triggers real regression detection (REG-PHASE-ORDER-001)
- Completion-recovery workload proves gate-failure recovery path
- Durable benchmark artifacts via `--output <dir>`
- Topology-aware config generation from workload phase specs
- Admission control cleanup: pre-run dead-end config rejection
- 4675 tests / 1000 suites / 0 failures

## 2.101.0

- Phase-aware governance regression detection: exports embed workflow_phase_order, diff detects backward phase movement
- 4624 tests / 986 suites / 0 failures

## 2.100.0

- Governance regression detection on export diffs (status, budget, gate, decisions, coordinator repo/barrier/event regressions)
- 4603 tests / 982 suites / 0 failures

## 2.99.0

`2.99.0` closes the coordinator replay event filter proof gap and adds comparison pages for competitive positioning.

- Coordinator replay roundtrip proof now exercises type, limit, and combined filters (15 checks, up from 11)
- Fixed event_type field reference in coordinator replay filter assertions
- Added 3 comparison pages: vs CrewAI, vs AutoGen, vs LangGraph
- Updated llms.txt with comparison page links and fixed stale protocol v6 reference
- 4586 tests / 978 suites / 0 failures

## 2.98.0

`2.98.0` adds export-aware diffing so operators can compare two portable audit artifacts directly, not just repo-local run-history entries.

- New CLI mode: `agentxchain diff <left_export.json> <right_export.json> --export`
- Run-export diff surfaces run/status/phase/goal/dashboard/delegation/repo-decision drift
- Coordinator-export diff surfaces barrier, repo-status, nested-export, and aggregated-event drift
- Fail-closed behavior for malformed export artifacts and mixed export kinds
- New proof: 4 export-diff acceptance tests added alongside the existing run-history diff suite
- 4586 tests / 978 suites / 0 failures

## 2.97.0

`2.97.0` delivers full replay round-trip proof: export → replay → dashboard endpoint verification for both governed runs and coordinator workspaces. Fixes a bug where empty `content_base64` entries blocked coordinator replay.

- Bug fix: `replay export` no longer rejects empty `content_base64` strings (valid for empty JSONL files)
- New proof: governed run export → replay → dashboard round-trip (10 checks)
- New proof: coordinator export → replay → dashboard round-trip (11 checks)
- 3 new tests: AT-REPLAY-REAL-006, AT-REPLAY-ROUNDTRIP-001, AT-REPLAY-ROUNDTRIP-002
- 4582 tests / 978 suites / 0 failures

## 2.96.1

`2.96.1` hardens protocol v7 conformance with 6 new reject fixtures for `parallel_turns` and `event_lifecycle`.

- 6 new reject fixtures: PT-004/005/006 (invalid max_concurrent_turns), EL-005/006/007/008 (ordering violations, missing turn_id, backwards timestamps)
- Reference adapter: `validate_event` now enforces `turn.turn_id` for turn-scoped events; `validateFixtureConfig` checks `max_concurrent_turns` bounds
- Conformance corpus: 108 fixtures / 13 surfaces (was 102)
- 4575 tests / 978 suites / 0 failures
- Conformance: 108 / 108 fixtures passing across all tiers (Tier 1: 77, Tier 2: 23, Tier 3: 8)

## 2.96.0

`2.96.0` bumps the protocol from v6 to v7, formalizing delegation chains, cross-run decision carryover, parallel turns, and event lifecycle as constitutional conformance surfaces.

- Protocol version: v6 → v7 (non-breaking upgrade)
- 21 new conformance fixtures across 4 new Tier 1 surfaces: `delegation` (8), `decision_carryover` (5), `parallel_turns` (4), `event_lifecycle` (4)
- Total conformance corpus: 102 fixtures / 13 surfaces (was 81 / 9)
- Reference adapter: added `validate_event` and `validate_event_ordering` operations
- `PROTOCOL-v7.md` normative document created
- All docs pages updated: protocol overview, reference, implementor guide, CLI, export schema, governance report, remote verification
- 4568 tests / 978 suites / 0 failures
- Conformance: 102 / 102 fixtures passing across all tiers (Tier 1: 71, Tier 2: 23, Tier 3: 8)

## 2.95.0

`2.95.0` adds `agentxchain replay export` for offline post-mortem dashboard analysis of completed governed runs.

- New `agentxchain replay export <file>` command starts the dashboard serving a completed export snapshot
- Dashboard replay mode: read-only, no gate approval, no file watcher, session reports `replay_mode: true`
- Marketing scripts: Chrome contention preflight checks for LinkedIn and Reddit posting
- 4523 tests / 978 suites / 0 failures
- node --test cli/test/replay-export.test.js — 7 tests / 1 suite / 0 failures

## 2.94.0

`2.94.0` turns delegation acceptance contracts into a machine-checkable governance surface.

- Delegations may now declare `required_decision_ids` so a parent can require specific `DEC-NNN` outputs from child turns
- Child delegation context and parent review context now surface required, satisfied, and missing decision IDs
- Delegation review turns are blocked from phase transition or run completion while required child decisions are still missing
- Export and governance report delegation summaries now preserve required/satisfied/missing decision contract state
- 4471 tests / 963 suites / 0 failures
- Targeted delegation, export, and report test slices pass; Docusaurus build clean

## 2.93.0

`2.93.0` adds HTML governance reports for enterprise compliance and proves cross-run decision carryover.

- `agentxchain report --format html` and `agentxchain audit --format html` produce self-contained HTML governance reports with inline CSS, dark mode, print styles, and status badges
- Cross-run decision carryover proof script validates repo-durable decisions persist and override across runs
- 4465 tests / 958 suites / 0 failures

## 2.92.0

`2.92.0` composes parallel turns with delegation chains — delegation children targeting different roles now execute concurrently, with symmetric observation attribution for concurrent authoritative turns.

- Delegation children targeting different roles dispatch concurrently when `max_concurrent_turns > 1`; same-role delegations remain sequential; review turns always execute alone
- `local_cli` adapter now passes `AGENTXCHAIN_TURN_ID` env var to spawned agents so parallel agents can identify their specific turn
- Run-loop slot-filler now breaks out of filling when a delegation review turn is assigned, and blocks alternate-role fallback when delegation queue is active
- Concurrent observation attribution hardened: `attributeObservedChangesToTurn()` accepts staged sibling declarations for pre-attribution, reverse-linked concurrent siblings recognized symmetrically
- Parallel delegation CLI proof (`run-parallel-delegation-proof.mjs`) exercises concurrent dispatch, different turn IDs, and review aggregation
- 4436 tests / 951 suites / 0 failures

## 2.91.0

`2.91.0` turns the governed dashboard into a real operator service instead of a foreground-only convenience command.

- `agentxchain dashboard --daemon` now starts the local dashboard bridge in the background and prints the live PID + URL only after the bridge is actually listening
- The dashboard now persists `.agentxchain-dashboard.pid` and `.agentxchain-dashboard.json` so operators have a durable local session record
- `agentxchain stop` now tears down the dashboard daemon and cleans stale dashboard session artifacts instead of only handling the legacy watch path
- Dashboard CLI docs and subprocess tests now freeze the daemon lifecycle contract, duplicate-session rejection, and stop-path cleanup behavior
- 4417 tests / 947 suites / 0 failures

## 2.90.0

`2.90.0` adds a first-class `named_decisions` coordinator barrier for decision-gated synchronization that is broader and more honest than reusing `interface_alignment` for every checkpoint.

- New `named_decisions` completion barrier with `named_decisions.decision_ids_by_repo`
- Coordinator config validation now rejects missing, malformed, duplicate, or undeclared `DEC-NNN` decision requirements for named decision barriers
- Barrier bootstrap, acceptance projection, and recovery now preserve and recompute required decision IDs through `required_decision_ids_by_repo`
- Cross-repo context now surfaces required decision IDs and follow-ups for both `interface_alignment` and `named_decisions`
- Public multi-repo and protocol docs now describe the new barrier truthfully
- 4406 tests / 945 suites / 0 failures

## 2.89.0

`2.89.0` completes the delegation chain audit trail across all three operator surfaces: dashboard (dedicated Delegations view with durable history retention), export (`delegation_summary` in summary object), and governance report (`subject.run.delegation_summary` with text/markdown rendering). Also fixes a dispatch-contract contradiction that caused deterministic CI Runner Proof failures for proposed-authority turns.

- 4401 tests / 945 suites / 0 failures

## 2.88.0

`2.88.0` introduces delegation chains — the first hierarchical authority mechanism in the protocol. A role can decompose work, delegate sub-tasks to other roles, and review aggregated results within a single governed run. Both happy-path and failure-path proofs are included.

- 4387 tests / 940 suites / 0 failures

## 2.87.0

`2.87.0` turns the self-build case study into a real front-door adoption surface instead of a buried docs page.

- Homepage proof section now links directly to `/docs/case-study-self-build` with explicit self-build framing
- Footer `Getting Started` column now includes `Self-Build Case Study`
- Root `README.md` docs list now links to the self-build case study for GitHub-first visitors
- Added `.planning/CASE_STUDY_DISCOVERABILITY_SPEC.md` to freeze the homepage/footer/README discoverability contract
- Hardened the case-study metrics table so release and tag counts do not stale immediately after the next cut (`100+` tags, `86+` published releases)
- 4364 tests / 924 suites / 0 failures (`cd cli && npm test`)
- `cd website-v2 && npm run build` clean

## 2.86.0

`2.86.0` ships a complete onboarding overhaul: manual-first generic template, init in-place auto-detection, 5-minute tutorial, and template decision guide.

- Default `generic` governed template is now manual-first — all four roles bind to manual runtimes, no API keys or local coding CLI required
- `manual-dev` is a built-in runtime so operators can rebind `dev` without inventing a new runtime entry
- `init --governed --yes` auto-detects empty git repos and scaffolds in-place instead of creating a nested subdirectory
- New `/docs/five-minute-tutorial/` page: narrative walkthrough from install to first accepted turn
- New `/docs/choosing-a-template/` page: operational decision guide for manual-first vs project-type templates
- Tutorial front-door links added to README and homepage hero
- Marketing browser wrappers hardened: LinkedIn uses isolated profile, X surfaces Chrome lock preflight
- 7 tests fixed after manual-first template change (governed-state, connector-health, status-connector-health, run-api-proxy-integration)
- 4353 tests / 922 suites / 0 failures (`cd cli && npm test`)
- `cd website-v2 && npm run build` clean

## 2.85.0

`2.85.0` ships parallel turn dispatch, built-in plugin proof chains, and live multi-repo coordinator evidence.

- Run-loop now supports concurrent turn dispatch when `max_concurrent_turns > 1` — slots are filled from eligible roles, dispatched via `Promise.allSettled`, and acceptances are processed sequentially
- Fixed parallel slot-filling deadlock: alternate-role fallback from `routing.allowed_next_roles` when `selectRole` returns a duplicate
- Fixed parallel turnId targeting: dispatch callback now passes `turnId: turn.turn_id` to adapters, preventing both concurrent dispatches from targeting the same turn
- New `parallel_dispatch` event with `count` and `turns` fields for observability
- New `/docs/parallel-turns/` documentation page with config, behavior, and proof case study
- `json-report` built-in plugin: continuous subprocess E2E proof plus live product-example proof with real hook artifact validation
- `github-issues` built-in plugin: continuous subprocess E2E proof plus live proof at permanent issue #77 with GitHub API verification
- Multi-repo coordinator: live model-backed case study at `/docs/multi-repo/` with two-repo governance, barrier satisfaction, and downstream context propagation evidence
- 4330 tests / 917 suites / 0 failures (`cd cli && npm test`)
- `cd website-v2 && npm run build` clean

## 2.84.0

`2.84.0` turns recent remote-governance hardening into explicit product truth: dead-end remote gate configs now warn consistently, the governed-todo-app unattended proof is workflow-backed in CI, and `api_proxy` model compatibility plus extraction behavior are documented as durable contract surfaces instead of folklore.

- `agentxchain validate` now surfaces the same config-shape warnings as `doctor` and `config --set`, including dead-end `requires_files` gates where every participating remote role is `review_only`
- `governed-todo-app` now has a workflow-backed unattended proof at `.github/workflows/governed-todo-app-proof.yml`, and the example docs/README name that CI path explicitly
- Added `cli/scripts/model-compatibility-probe.mjs` plus `.planning/MODEL_COMPATIBILITY_RESULTS.json` as a durable empirical surface for `api_proxy` + `proposed` model behavior
- Anthropic Haiku 4.5 and Sonnet 4.6 are currently recorded as reliable for `api_proxy` proposed turns; Haiku relies on fence extraction while Sonnet returns direct JSON
- `.planning/ADAPTER_CONTRACT.md`, `.planning/API_PROXY_PROPOSED_AUTHORING_SPEC.md`, and the public integration guide now freeze the load-bearing three-stage extraction pipeline and correct `api_proxy` write-authority/provider truth
- 4300 tests / 911 suites / 0 failures (`cd cli && npm test`)
- `cd website-v2 && npm run build` clean

## 2.83.0

`2.83.0` makes the governed CLI front door coherent: `status` explains the active gate contract, `intake status` tells operators what to do next, and `run`, `step`, and `resume` all show run provenance plus inherited context before dispatching work.

- `agentxchain status` now expands the active pending exit gate inline with `Files:` and `Needs:` details instead of showing only opaque `pending` labels
- `agentxchain intake status` now derives and renders `next_action` guidance in both text and JSON, including blocked-state recovery commands
- `agentxchain run --continue-from/--recover-from` now prints `Origin:` in the run header, and `--inherit-context` also prints `Inherits:` with parent-run details
- `agentxchain step` now prints a run-context header before dispatch: current run, phase, provenance, inherited context, and active gate requirements
- `agentxchain resume` now prints the same run-context header before re-dispatch, closing the last governed manual-workflow parity gap
- 21 tests / 5 suites / 0 failures (focused front-door subprocess proof)
- Full CLI test suite and Docusaurus build green

## 2.82.0

`2.82.0` fixes a critical approval-gate bypass, hardens the intake pipeline, rejects scaffold placeholders in gate evaluation, sweeps all 20 integration guides for truth-boundary accuracy, and expands E2E subprocess proof.

- **Security fix**: `resume`, `step`, and `reactivate` now reject runs with pending `requires_human_approval` objects — previously these could bypass approval gates
- `intake start` unconditionally rejects paused runs, preventing state drift into the intake pipeline
- Intake context preserved across `intake start` invocations
- Gate evaluation (`section_check`, `system_spec`) rejects scaffold placeholder text; dispatch templates use schema-guided angle-bracket format
- All 20 integration guides audited: Cursor/Windsurf native connector claims removed, Jules/Bedrock factual accuracy fixed, API proxy and local_cli guides get governed bootstrap paths
- E2E release notes gate proof: `gate show --evaluate` catches placeholder release notes, lifecycle blocks on semantic failure
- E2E coordinator gate blockers proof: `multi step` surfaces `repo_active_turns`, `barrier_unsatisfied`, `repo_run_id_mismatch` with structured error output
- Coordinator recovery: `multi step` prints structured `[repo_run_id_mismatch]` with expected/actual run IDs
- Guided governed init prompts for better first-run experience
- Front-door scheduling and inspection command discoverability in README and `llms.txt`
- Fixed 33 test failures from `import.meta.url` vs `process.cwd()` repo root resolution
- 4233 tests / 897 suites / 0 failures (`cd cli && npm test`)

## 2.81.0

`2.81.0` ships historical turn replay for audit and drift detection, smarter doctor output with connector handoff hints and plugin health diagnostics.

- New `agentxchain replay turn` command: replay an accepted turn's machine-evidence commands from history for audit and drift detection
- `agentxchain doctor` now hints to run `connector check` when configured runtimes need live probing
- `agentxchain doctor` now includes plugin health diagnostics (manifest validation, hook binding checks)
- `verify turn` and `replay turn` added to both READMEs and `llms.txt` for front-door discoverability
- `PROTOCOL-v3.md` marked historical with deprecation header pointing to v6
- `post-twitter.sh` includes retry logic for intermittent X overlay failures
- 3 stale spec statuses corrected to shipped (config --get, coordinator report narrative, cross-machine restore)
- 3920 tests / 843 suites / 0 failures (`cd cli && npm test`)

## 2.80.0

`2.80.0` ships built-in plugin discovery: bundled plugins install by short name, `plugin list-available` shows what ships with the CLI, and a parity guard ensures bundled copies stay identical to source.

- New `agentxchain plugin list-available` command showing all bundled plugins with descriptions and install commands
- Short-name plugin install: `agentxchain plugin install slack-notify` resolves to the bundled copy before npm fallback
- Built-in plugins (`slack-notify`, `json-report`, `github-issues`) bundled in `cli/builtin-plugins/` and included in npm tarball
- Plugin docs updated to recommend short-name install as the primary path
- CLI docs updated with `list-available` in the plugin command table
- Bundle parity test: `AT-PLUGIN-BUILTIN-008` asserts `cli/builtin-plugins/*` stays byte-identical to `plugins/*` source trees
- Tarball proof test: `AT-PLUGIN-BUILTIN-007` validates `npm pack --json --dry-run` includes bundled plugin files
- 3902 tests / 840 suites / 0 failures (`cd cli && npm test`)
- Local release proof: builtin discovery tests, bundle parity guard, tarball inclusion proof, full test suite, clean Docusaurus build

## 2.79.0

`2.79.0` fixes built-in plugin config drift, adds dedicated plugin docs, ships a lights-out scheduling guide, and tightens docs contract boundaries.

- Fixed `plugin-slack-notify` runtime to honor `webhook_env` and `mention` config from manifest
- Fixed `plugin-json-report` runtime to honor `report_dir` config with path-escape rejection
- New dedicated docs pages for `plugin-slack-notify`, `plugin-json-report`, and `plugin-github-issues` under `/docs/plugins/`
- New lights-out scheduling guide at `/docs/lights-out-scheduling` with daemon operation, safety behavior, and operational patterns
- Fixed schedule eligibility docs to include `missing` state (fresh projects)
- Fixed lights-out docs to remove false multi-repo coordinator claim
- Fixed Reddit post formatting (`post-reddit.sh` now converts literal `\n` to real newlines)
- Fixed RVP spec drift (`--max-turns 1` → `--max-turns 5` to match shipped E2E)
- 3894 tests / 838 suites / 0 failures (`cd cli && npm test`)
- Local release proof: plugin config parity tests, schedule/lights-out regression guards, full test suite, clean Docusaurus build

## 2.78.0

`2.78.0` adds the first cross-run comparison command, ships the OpenClaw integration surface, and cleans up docs information architecture that was needlessly confusing.

- New `agentxchain diff <left_run_id> <right_run_id>` command for comparing recorded governed runs from `.agentxchain/run-history.jsonl`
- `diff` supports unique run-id prefixes, fails closed on ambiguous references, and compares scalar fields, numeric deltas, phases, roles, and gate status changes
- New OpenClaw integration guide at `/docs/integrations/openclaw` with honest `local_cli` truth and explicit `remote_agent` boundary
- New `plugins/openclaw-agentxchain/` package exposing `agentxchain_step`, `agentxchain_accept_turn`, and `agentxchain_approve_transition`
- Docs sidebar renamed `Integration` → `Connectors` and `Integrations` → `Platform Guides`
- 3878 tests / 835 suites / 0 failures (`cd cli && npm test`)
- Local release proof included the new diff command tests, OpenClaw plugin tests, full `cd cli && npm test`, and a clean `cd website-v2 && npm run build`

## 2.77.0

`2.77.0` ships three new operator-facing capabilities: live connector health probes (`agentxchain connector check`), per-run cost summary in `audit`/`report`, and multi-axis protocol version surface in `doctor`/`validate`. Also includes the `agentxchain audit` command, Homebrew sync hardening, IDE report simplification, and visual/content polish across all public surfaces.

- New `agentxchain connector check` command with live probes for all runtime types (local_cli, api_proxy, remote_agent, MCP stdio/streamable_http)
- Per-run cost summary in `agentxchain audit` and `agentxchain report`: total USD, tokens, per-role and per-phase breakdowns
- `doctor` and `validate` now expose protocol version (v6), config generation (v4), and config schema (1.0) separately
- New `agentxchain audit` command as first-class live governance audit surface
- VS Code extension `loadGovernedReport()` replaced double-hop (`export` + `report`) with single `audit --format json` call
- Homebrew mirror `--admin` merge fallback gated to self-approval deadlock only; non-matching failures fail closed
- All public install surfaces now show both npm and Homebrew install paths
- Visual design sweep: 20+ inline styles extracted to CSS classes with mobile responsiveness
- 3863 tests / 830 suites / 0 failures (`cd cli && npm test`)
- `cd website-v2 && npm run build` clean

## 2.76.0

`2.76.0` closes two quality debts: incomplete CLI command test coverage and manual Homebrew mirror PR follow-through. Every CLI command now has a dedicated subprocess test suite, and CI now owns the full Homebrew mirror PR lifecycle.

- All 40 testable CLI commands now have dedicated subprocess test suites — 10 new suites added across `stop`, `events`, `supervise`, `branch`, `rebind`, `watch`, `generate`, `start`, `update`, and `kickoff`
- The `publish-npm-on-tag.yml` workflow now records the Homebrew mirror PR number, submits an approval review, enables squash auto-merge with branch deletion, and polls for `MERGED` — failing closed if the PR never merges
- Fixed `getPreviousVersionTag()` in the GitHub Release body renderer: positional lookup replaces `.find(tag !== current)` which returned the wrong tag
- Backfilled governed release bodies for v2.30.0 through v2.75.0 with public docs URL, npm URL, summary paragraph, evidence line, and correct compare link
- 3822 tests / 819 suites / 0 failures (`cd cli && npm test`)
- `cd website-v2 && npm run build` clean

## 2.75.0

`2.75.0` closes the remaining coordinator hook-evidence lie inside the dashboard Timeline turn-detail panel. The bridge already exposed coordinator hook audit and annotation endpoints, but Timeline only fetched repo-local evidence and silently hid coordinator hook activity in coordinator workspaces. The release also aligns Timeline section titles to the existing Hooks view instead of introducing another avoidable naming fork.

- The dashboard `Timeline` view now fetches `/api/coordinator/hooks/audit` and `/api/coordinator/hooks/annotations` and renders that evidence in turn-detail panels for coordinator workspaces
- Mixed workspaces now render separate `Repo Hook Audit Log` / `Coordinator Hook Audit Log` and `Repo Hook Annotations` / `Coordinator Hook Annotations` sections, matching the established Hooks view vocabulary instead of inventing a second label set
- Repo-only workspaces remain backward compatible: Timeline still renders a single unprefixed `Hook Audit Log` / `Hook Annotations` section when no coordinator evidence exists
- Public CLI docs now state that Timeline turn detail surfaces coordinator hook audit and annotations alongside repo-local hook data
- 3754 tests / 808 suites / 0 failures (`cd cli && npm test`)
- Focused dashboard proof passed: `node --test cli/test/timeline-coordinator-hooks.test.js cli/test/dashboard-views.test.js cli/test/docs-dashboard-content.test.js`
- `cd website-v2 && npm run build` clean

## 2.74.0

`2.74.0` fixes an embarrassing dashboard truth gap: the Timeline view carried turn history and active-turn state, but dropped the timing fields that were already present in its own data sources. A view named `Timeline` showed no elapsed time, no accepted-at timestamp, and no per-turn duration.

- The dashboard `Timeline` view now renders live elapsed time for active turns from `started_at`, instead of hiding in-flight timing completely
- Completed turn cards now surface `duration_ms` and `accepted_at` inline in the turn header, so operators can inspect timing history without dropping into raw JSON
- Legacy history entries remain backward compatible: missing or invalid timing fields are omitted cleanly instead of crashing or rendering placeholders
- Public CLI docs now state that Timeline includes live elapsed time, per-turn duration, and acceptance timestamp, and regression tests freeze that contract
- 3747 tests / 807 suites / 0 failures (`cd cli && npm test`)
- 83 dashboard-focused tests / 18 suites / 0 failures (`node --test cli/test/timeline-turn-timing.test.js cli/test/dashboard-views.test.js cli/test/docs-dashboard-content.test.js`)
- `cd website-v2 && npm run build` clean

## 2.73.0

`2.73.0` closes the same coordinator dashboard lie in the shared `Hooks` view that previously existed in `Decisions`. The bridge already exposed coordinator hook audit and annotation ledgers, but the SPA only fetched repo-local hook data and falsely rendered an empty hooks surface for coordinator workspaces.

- The shared dashboard `Hooks` view now fetches both repo-local and coordinator hook sources, rendering truthful coordinator audit and annotation sections instead of collapsing to repo-local-only emptiness
- Mixed workspaces now keep one shared filter bar while rendering separate `Repo Hook Audit Log` / `Coordinator Hook Audit Log` and annotation sections, so operators can inspect both layers without navigation sprawl
- Public CLI docs now document `/api/coordinator/hooks/audit` and `/api/coordinator/hooks/annotations` and explicitly state that the shared Hooks view surfaces coordinator hook activity
- Added dashboard rendering and docs-contract regression coverage for coordinator hook visibility instead of trusting the existing bridge mapping by implication
- 3730 tests / 802 suites / 0 failures (`cd cli && npm test`)
- 66 dashboard-focused tests / 13 suites / 0 failures (`node --test cli/test/dashboard-views.test.js cli/test/docs-dashboard-content.test.js`)
- `cd website-v2 && npm run build` clean

## 2.72.0

`2.72.0` fixes a dashboard truth gap in coordinator workspaces. The bridge already exposed the coordinator decision ledger, but the shared `Decisions` view only fetched the repo-local ledger and falsely rendered an empty state for coordinator runs.

- The shared dashboard `Decisions` view now fetches both repo-local and coordinator ledgers and renders the truthful surface instead of collapsing to repo-local-only emptiness
- Coordinator workspaces now render `Coordinator Decision Ledger`, and mixed surfaces render separate repo-local and coordinator sections under one filter bar
- Public CLI docs now document `GET /api/coordinator/ledger` and explicitly state that the shared Decisions view surfaces coordinator decisions
- Added bridge, dashboard view, coordinator E2E, and docs-contract regression coverage for the coordinator ledger surface
- 3725 tests / 802 suites / 0 failures (`cd cli && npm test`)
- 120 dashboard-focused tests / 25 suites / 0 failures (`node --test cli/test/dashboard-views.test.js cli/test/dashboard-bridge.test.js cli/test/e2e-dashboard.test.js cli/test/docs-dashboard-content.test.js`)
- `cd website-v2 && npm run build` clean

## 2.71.0

`2.71.0` closes the coordinator status observability gap: `multi status` now renders blocked reason, elapsed time, phase gate pass/pending, completion state, and color-coded status instead of forcing operators into raw state files.

- `getCoordinatorStatus()` returns `blocked_reason`, `created_at`, `updated_at`, and `phase_gate_status` — fields that already existed in state but were silently omitted from the status query
- `multi status` text output is now observability-complete: color-coded status, elapsed time for active runs, blocked reason, phase gate rendering, completion marker, and pending gate `from → to` direction
- Public CLI docs and docs regression coverage updated to freeze the enriched coordinator status contract
- 3721 tests / 802 suites / 0 failures (`cd cli && npm test`)
- `cd website-v2 && npm run build` clean

## 2.70.0

`2.70.0` closes the coordinator-side hole Claude missed: governance exceptions were extracted for child repos, but coordinator reports still dropped coordinator-level escalations and conflicts even though the extractor existed.

- Coordinator reports now surface `governance_events` from `.agentxchain/multirepo/decision-ledger.jsonl` in JSON, text, and markdown instead of silently omitting those exceptions
- The report extraction path is now shared across single-repo and coordinator ledgers, so type-specific governance detail stays aligned across both surfaces
- The public CLI reference now states that coordinator reports include coordinator-level governance events, and the docs guard freezes that claim
- Added coordinator narrative proof for JSON, text, and markdown governance-event rendering instead of pretending child-repo coverage was enough
- 3714 tests / 800 suites / 0 failures (`cd cli && npm test`)
- `cd website-v2 && npm run build` clean

## 2.69.0

`2.69.0` closes a larger observability hole than the last release: governed phase transitions and gate failures are now visible in the event stream instead of disappearing into `state.json` and ledger files.

- `phase_entered` events now emit for all three transition paths: direct automatic gate passes, policy auto-approved transitions, and explicit human approvals
- New `gate_failed` lifecycle events record `gate_id`, blocked transition, and failure reasons so operators can diagnose a rejected phase change from `agentxchain events` instead of raw-file archaeology
- The `events` command now renders inline phase movement as `from → to (trigger)` and shows `gate_failed` reason detail; public CLI docs now freeze that contract instead of silently omitting the new event surface
- 3706 tests / 798 suites / 0 failures (`cd cli && npm test`)
- `cd website-v2 && npm run build` clean

## 2.68.0

`2.68.0` makes rejection events operator-usable instead of raw-file archaeology. `turn_rejected` now carries the real rejection reason and failed stage in the event stream, and the human-readable `agentxchain events` surface is finally pinned by regression proof instead of wishful reading.

- `turn_rejected` lifecycle events now carry `reason` and `failed_stage`, plus `validation_errors` when they actually exist, so `.agentxchain/events.jsonl` is a usable audit trail rather than a stub
- `agentxchain events` text output now renders rejection detail inline as `reason (failed_stage)`, and that operator-facing output is frozen by CLI regression coverage instead of being left untested
- The rejection-event spec and CLI docs now point operators at the truthful surface: scan `events` for fast triage, use `events --json` when they need the full structured payload
- 3699 tests / 796 suites / 0 failures (`cd cli && npm test`)
- `cd website-v2 && npm run build` clean

## 2.67.0

`2.67.0` completes the operator surface for per-turn timing. Active-turn inspection now shows when a governed turn started and how long it has been running, while governance reports carry accepted-turn duration instead of wasting that data in history files.

- `agentxchain turn show` now prints `Started` and `Elapsed` for active turns when timing metadata exists, and `turn show --json` exposes `started_at` plus live `elapsed_ms`
- Governance reports now carry per-turn `started_at` and `duration_ms` in JSON output, and Turn Timeline rows render `accepted_at (duration)` in text and markdown when duration exists
- The turn-timing spec and turn inspection spec are aligned to the real operator surfaces: per-turn timing is surfaced through `status`, `turn show`, `report`, and `events --json`, not the unrelated cross-run `history --json` command
- 3695 tests / 795 suites / 0 failures (`cd cli && npm test`)
- `cd website-v2 && npm run build` clean

## 2.66.1

`2.66.1` repairs the failed `v2.66.0` publish path, completes the remaining preflight compression gap, and restores the live X/Twitter website surface.

- Release social posting is now frozen to the real three-channel contract: `post-release.sh` delegates to X/Twitter, LinkedIn, and Reddit, and tests no longer block tagged publish on stale two-channel assumptions
- `last_turn_verification` is now explicitly compressible in the bounded preflight tokenization order, dropped after `workflow_artifacts` and before `gate_required_files`, closing the remaining non-sticky/untargeted context gap
- The website community surface now links the live `@agentxchaindev` account again across navbar, footer, homepage cards, and `llms.txt`
- The `v2.66.0` release page now states the truth: the tag exists, but npm/Homebrew publication did not complete from that tag
- 3691 tests / 794 suites / 0 failures (`cd cli && npm test`)

## 2.66.0

`2.66.0` closes the preflight compression model gap for `workflow_artifacts` and adds cumulative decision ledger dispatch to governed agent context.

- Cumulative agent-authored decisions from `decision-ledger.jsonl` are now dispatched in CONTEXT.md as a "Decision History" markdown table, so agents see the full governed decision trail — not just the last turn's decisions
- Decision history filters to agent-authored entries only (those with `id` field), caps at 50 most recent, and handles missing/empty/malformed ledger gracefully
- `workflow_artifacts` is now explicitly compressible in the preflight compression model — dropped after `decision_history` and before `gate_required_files` under token pressure
- Previously, `workflow_artifacts` had `required: false` but was not in COMPRESSION_STEPS, making it behave as sticky despite being marked compressible
- `project_goal` and `inherited_run_context` are preserved as sticky sections that survive full preflight compression
- Decision history is compressible context, dropped in the bounded compression order after `phase_gate_status` and before `workflow_artifacts`
- 56 tests / 14 suites / 0 failures (combined context-compressor, context-section-parser, token-budget, decision-history, and workflow-kit runtime context suite)

## 2.65.0

`2.65.0` promotes reproducible verification from a manual inspection step to a declarative acceptance policy. Machine-evidence replay is now enforceable at the governed acceptance boundary.

- New built-in policy rule `require_reproducible_verification` blocks turn acceptance when declared `verification.machine_evidence` commands fail to reproduce their declared exit codes
- Shared `verification-replay.js` helper ensures `verify turn` and acceptance-time enforcement use identical replay logic with no surface drift
- Policy actions `block`, `warn`, and `escalate` supported with standard scope filtering (phase, role)
- Accepted turns include a compact `verification_replay` summary for audit trails
- `accept-turn` and `step` CLI output displays replay status when reproducibility enforcement is active
- 115 tests / 29 suites / 0 failures (combined policy-evaluator, runtime-integration, verify-turn, and docs guard suite)
- Targeted proof covers policy evaluation (3 tests), runtime integration (3 E2E tests), verify-turn regression (8 tests), docs contract guards, and a clean Docusaurus production build

## 2.64.0

`2.64.0` completes the governed inspection surface and adds pre-acceptance evidence replay. Every governed concept now has a dedicated read-only CLI command.

- `agentxchain phase list` and `phase show [phase]` inspect governed workflow routing with phase order, entry roles, exit gates, workflow-kit artifacts, and next-role constraints
- `agentxchain gate list` and `gate show <gate_id>` inspect governed gate contracts with `--evaluate` for live readiness snapshots using runtime gate semantics (merged workflow-kit artifacts, semantic validators, explicit ownership participation)
- `agentxchain verify turn [turn_id]` replays staged turn `verification.machine_evidence` commands and compares actual exit codes to declared exit codes, reporting match/mismatch/not_reproducible without mutating state
- `phase show` now distinguishes explicit `owned_by` (enforced) from `entry_role`-inferred ownership (display hint only) with `ownership_enforced` boolean in JSON
- 59 tests / 13 suites / 0 failures (combined inspection + verify-turn suite)
- Targeted proof covers phase inspection (8 tests), gate inspection (9 tests including semantic evaluation), verify-turn (8 tests), docs contract guards, and a clean Docusaurus production build

## 2.63.0

`2.63.0` ships two new operator inspection surfaces — `agentxchain role` and `agentxchain turn` — plus Homebrew release-path hardening.

- `agentxchain role list` and `role show <role_id>` provide dedicated read-only inspection of governed role definitions with `--json` support and color-coded authority levels
- `agentxchain turn show [turn_id]` inspects active governed turn dispatch bundles with `--artifact` and `--json` support
- `release-bump.sh` carries the Homebrew SHA deterministically from `HEAD:cli/homebrew/agentxchain.rb` and warns about Phase 1 stale-SHA state
- 64 tests / 18 suites / 0 failures (combined role + turn + release-identity suite)
- Targeted proof covers role inspection (7 tests including legacy v3 rejection), turn inspection (6 E2E subprocess tests), docs coverage (10 tests), and a clean Docusaurus production build

## 2.61.0

`2.61.0` closes the remaining pricing and governed-config truth gaps that were still leaking operators into weaker paths. Budget and `cost_rates` edits now fail closed through governed config validation, public docs route scalar pricing fixes through `agentxchain config --set`, and the connector tutorial now follows the same `--goal` + `doctor` bootstrap contract as the rest of the product.

- Governed config validation now rejects malformed `budget` values and malformed `budget.cost_rates` entries instead of accepting invalid pricing metadata
- Budget recovery docs now route operators through `agentxchain config --set budget.per_run_max_usd <usd>` instead of hand-editing `agentxchain.json`
- Public pricing docs now show single-model `budget.cost_rates.<model>.<field>` overrides through `agentxchain config --set`, while leaving bulk multi-model tables in JSON where the CLI path would be materially worse
- `/docs/build-your-own-connector` now scaffolds with `agentxchain init --governed --goal ...`, runs `agentxchain doctor`, and shows `config --set` for scalar follow-up runtime edits
- Added regression guards for pricing-path docs alignment and the connector tutorial bootstrap/config path
- 3599 tests / 778 suites / 0 failures
- Targeted proof covers governed budget validation, budget-recovery E2E, pricing docs guards, connector tutorial guards, and a clean Docusaurus production build

## 2.60.0

`2.60.0` fixes a governed operator repair path that was still broken after scaffold. Governed repos can now use `agentxchain config` instead of falling back to manual JSON editing, and the natural `agentxchain config --set <key> <value...>` form finally works for v4 config. The omitted-goal recovery path now points at a real command instead of a hand-edited file.

- `agentxchain config` now supports governed repos through version-aware config loading instead of rejecting v4 projects as legacy-only
- `agentxchain config --set <key> <value...>` now accepts the natural CLI form, while the older quoted single-argument form remains backward compatible
- Invalid governed config edits now fail closed against the governed schema instead of mutating `agentxchain.json` optimistically
- `init --governed`, `README.md`, `cli/README.md`, `quickstart.mdx`, `getting-started.mdx`, and `/docs/cli` now route omitted-goal recovery through `agentxchain config --set project.goal ...`
- Added `.planning/GOVERNED_CONFIG_COMMAND_SPEC.md` and `cli/test/config-governed.test.js` to freeze the governed config-mutation contract
- 3585 tests / 777 suites / 0 failures
- Targeted proof covers governed config subprocess mutations, front-door/docs guards, governed CLI support, and a clean Docusaurus production build

## 2.59.0

`2.59.0` fixes the governed-ready front door. The demo handoff now routes operators through `init --governed --goal`, `doctor`, and `run`, and the rest of the public onboarding path stops teaching a weaker bare-init flow. README, npm README, homepage, quickstart, and getting-started now align on the same truth: set mission context at scaffold time, verify readiness before the first turn, and do not re-run `init --governed` in place just to add a goal later.

- `agentxchain demo` now ends with a governed-ready CLI handoff: scaffold with `--goal`, run `doctor`, then start the first governed turn
- `README.md`, `cli/README.md`, the homepage terminal sample, `quickstart.mdx`, and `getting-started.mdx` now route real-repo onboarding through `agentxchain init --governed --goal ...` plus `agentxchain doctor`
- `getting-started.mdx` no longer teaches a misleading second `init --governed --goal --dir . -y` rerun after scaffold; operators are told to edit `project.goal` directly if they skipped it
- Added `.planning/FRONTDOOR_GOVERNED_READY_PATH_SPEC.md` and `cli/test/frontdoor-governed-ready-path.test.js` to freeze the public onboarding contract
- 3578 tests / 775 suites / 0 failures
- Targeted proof covers demo/front-door discoverability, governed-ready path docs guards, and a clean Docusaurus production build

## 2.58.0

`2.58.0` finishes the run-retrospective visibility slice. Operators can now see retrospective headlines across every human-readable history surface instead of needing `--json` or inherited context to discover that a terminal handoff exists. This release also hardens the current-release guard so release evidence compares the real aggregate test-count line semantically, not by brittle bullet position.

- `agentxchain history` now shows a `Headline` column with the terminal retrospective headline
- Dashboard run history now surfaces the same `Headline` value so continuity is visible in both CLI and browser views
- `history --lineage` now appends the truncated headline for each ancestor entry, closing the last human-readable continuity gap
- Public CLI docs and `RUN_HISTORY_SPEC.md` now freeze headline visibility across table, lineage, and dashboard surfaces
- `current-release-surface.test.js` now compares aggregate evidence lines semantically by highest concrete `N tests ... 0 failures` count
- 3572 tests / 773 suites / 0 failures
- Targeted proof covers CLI history table/lineage rendering, dashboard headline visibility, release-surface evidence matching, and Docusaurus production build

## 2.57.0

`2.57.0` makes run-to-run continuity concrete. Terminal governed runs now record a deterministic `retrospective` in `run-history.jsonl` (headline, terminal reason, next operator action, follow-on hint), and child runs created with `--inherit-context` receive the parent's retrospective directly in `CONTEXT.md`. Also surfaces `project.goal` across all front-door onboarding paths and fixes accepted-turn inheritance to match real governed history entries.

- Terminal governed runs now record an additive `retrospective` object in `run-history.jsonl`
- `--inherit-context` carries `parent_retrospective` into child run's `inherited_context` and renders it in `CONTEXT.md`
- Fixed accepted-turn inheritance bug: `buildRecentAcceptedTurnSnapshot()` now correctly matches `status: "completed"` entries
- `init --governed` now prints a conditional `--goal` tip when no project goal is set
- `README.md`, `quickstart.mdx`, and `getting-started.mdx` now mention `--goal` and `project.goal`
- 3570 tests / 773 suites / 0 failures
- Targeted proof covers run-history retrospectives, inherited-context rendering, project-goal discoverability guards, and Docusaurus production build

## 2.56.0

`2.56.0` gives governed runs an explicit project-level mission. `project.goal` can now be set at scaffold time, preserved in config normalization, rendered into every dispatched turn's `CONTEXT.md`, and surfaced across `status`, `report`, `export`, and the demo config so agents know what the repo is trying to accomplish before they start arguing about implementation details.

- Added `agentxchain init --governed --goal "<text>"` to persist an optional `project.goal` string
- Dispatch bundles now render `## Project Goal` after current state so every governed turn sees the project mission
- `status --json` exposes additive `project_goal`, while governance reports preserve the same value at `subject.project.goal`
- Public CLI and governance-report docs now describe the shipped goal surface truthfully instead of fabricating a `project_goal` report field
- 13 tests / 6 suites / 0 failures
- Targeted proof now covers status text, report JSON/text, docs contract alignment, and Docusaurus production build

## 2.55.0

`2.55.0` makes run-context inheritance visible before operators construct a child run. `agentxchain history` now shows a `Ctx` signal in the default table, `history --json` exposes a computed `inheritable` boolean, lineage output marks inheritable ancestors with `[ctx]`, and the dashboard run-history view surfaces the same inheritance-snapshot availability.

- Operators can see at a glance which historical runs have usable inheritance snapshots versus metadata-only lineage
- Public CLI docs now explain the `Ctx` column, `inheritable` JSON field, and lineage `[ctx]` marker
- Proof coverage now includes dashboard rendering and lineage output instead of pretending the JSON/table tests were enough
- 70 tests / 16 suites / 0 failures
- Docusaurus production build passed

## 2.54.0

`2.54.0` fixes a real long-horizon continuity bug in governed run inheritance. `--inherit-context` now reads a bounded snapshot recorded on the selected parent run's `run-history.jsonl` entry instead of whatever happens to be in the repo's current `history.jsonl` and `decision-ledger.jsonl`. That means inheriting from an older parent run no longer leaks later repo activity into the child run's first-turn context.

- Added bounded `inheritance_snapshot` recording to `run-history.jsonl`
- Child runs degrade to metadata-only inheritance when targeting older parent entries without snapshots
- Added subprocess proof that newer repo history does not contaminate inheritance from the selected parent
- 50 tests / 11 suites / 0 failures
- Full CLI test suite and Docusaurus production build passed

## 2.53.0

`2.53.0` fixes governed-readiness discoverability so the first-run operator journey is finally honest. `agentxchain doctor` now appears in the scaffold handoff, quickstart, and getting-started flow between scaffold validation and the first governed turn, which means runtime/env failures are surfaced before operators hit them mid-run.

- 3527 tests / 758 suites / 0 failures

## 2.52.0

`2.52.0` adds a governed readiness doctor for v4 projects and removes a real legacy usability trap. `agentxchain doctor` now answers governed run readiness with config, runtime, state, schedule, and workflow-kit checks on governed repos, while the legacy v3 macOS Accessibility probe is timeout-bounded instead of hanging indefinitely behind `osascript`.

- 3525 tests / 758 suites / 0 failures

## 2.51.0

`2.51.0` hardens release identity creation so AgentXchain no longer mints a release tag before the local release state is actually proven. `release-bump.sh` now runs inline preflight between the release commit and tag creation, using the real release target for `npm test`, `npm pack --dry-run`, and the Docusaurus production build. If any of those fail, the commit may exist, but the tag does not.

- 3517 tests / 756 suites / 0 failures

## 2.50.0

`2.50.0` hardens the operator handoff around lights-out scheduling and release infrastructure. Repo-local schedule daemons now expose a truthful health surface, Homebrew sync now survives harmless push races by verifying the canonical tap after rejection, and `init --governed` prints the real bootstrap sequence (`template validate`, git checkpoint, first turn) instead of under-guiding cold-start operators.

- 3509 tests / 755 suites / 0 failures

## 2.49.0

`2.49.0` ships repo-local governed run scheduling with interval-based triggers, safe skip semantics (active/blocked runs are never overwritten), schedule provenance (`trigger: schedule`), local daemon loop, and a refactored shared `executeGovernedRun()` surface. Schedule state is orchestrator-owned and export/restore-aware.

- 3497 tests / 747 suites / 0 failures

## 2.48.0

`2.48.0` ships repo-local run event streaming with 11 lifecycle event types, a `agentxchain events` CLI command with `--follow` real-time streaming, docs truth corrections (`history --status` filter), and E2E proof hardening for event lifecycle and provenance terminal-bootstrap.

- 3478 tests / 743 suites / 0 failures

## 2.47.0

`2.47.0` ships run provenance observability, terminal-state bootstrap fixes for continuation and recovery runs, and CLI help text corrections. Provenance metadata (`trigger`, `parent_run_id`, `trigger_reason`) is now rendered in `status`, `report`, `export`, and `history`.

- 3462 tests / 741 suites / 0 failures

## 2.46.2

`2.46.2` combines the timeout dashboard truth patch with a release-truth repair. Repo-local and coordinator timeout views now surface per-turn live pressure with turn identity, the repo-local timeout endpoint has direct server-module proof instead of render-only coverage, the publish workflow separates tagged-state verification from npm publication, and the CI-only git-identity test defect that broke `v2.46.1` is fixed.

### Timeout dashboard truth fix

- Repo-local `Timeouts` and coordinator `Coordinator Timeouts` views now evaluate active turns individually instead of silently dropping turn-scope timeout pressure.
- Turn-scope live rows now carry `turn_id` and `role_id`, so operators can identify the actual over-budget turn instead of seeing anonymous pressure.
- Phase/run timeout evaluation remains unchanged and is still evaluated once per request.

### Proof hardening

- Added direct `readTimeoutStatus()` contract tests for configured/unconfigured state, active-turn pressure, blocked-state behavior, and missing state handling.
- Extended coordinator timeout tests to prove turn-scope live pressure propagates into repo snapshots and rendered cards.
- Fixed `parallel-attribution-observability.test.js` to configure local git identity inside temp repos instead of depending on a developer's global git config.
- `publish-from-tag.sh` now supports explicit `--skip-preflight` for CI callers that already re-verified the tagged state, while direct/operator usage remains fail-closed by default.
- The publish workflow now exposes a dedicated `Re-verify tagged release before publish` step so operators can distinguish tag verification from actual npm publication.

### Evidence

- 3432 tests / 735 suites / 0 failures
- `node --test cli/test/dashboard-timeout-status.test.js` → 18 tests / 3 suites / 0 failures
- `node --test cli/test/dashboard-coordinator-timeout-status.test.js` → 8 tests / 3 suites / 0 failures
- `node --test cli/test/dashboard-bridge.test.js` → 46 tests / 11 suites / 0 failures
- `node --test cli/test/parallel-attribution-observability.test.js cli/test/publish-from-tag.test.js cli/test/release-docs-content.test.js` → 31 tests / 4 suites / 0 failures
- `cd cli && npm test` → 3432 tests / 735 suites / 0 failures
- `cd website-v2 && npm run build` → clean

## 2.46.0

`2.46.0` ships the declarative policy engine for governed turn acceptance with five built-in rules, three actions (warn/block/escalate), phase/role scoping, runtime-aware escalation recovery, cost enforcement fix (`cost.usd` primary), and policy-specific CLI operator guidance.

### Declarative policy engine

- Five built-in rules: `require_status`, `max_consecutive_same_role`, `require_challenge`, `max_cost_per_turn`, `min_artifacts`.
- Three actions: `warn` (log and accept), `block` (reject turn), `escalate` (persist blocked state with structured recovery).
- Optional `phases` and `roles` scoping per rule.
- Template integration: `enterprise-app` template includes a default policy configuration.

### Policy escalation recovery hardening

- Policy escalation now writes structured `blocked_reason` via `buildBlockedReason()` with `category: 'policy_escalation'` — consistent with all other blocked-state writers.
- Recovery is runtime-aware: retained `manual` turns → `agentxchain resume`; retained non-manual turns → `agentxchain step --resume`.
- `accept-turn` renders policy-specific operator guidance with violating policy IDs, rule names, and recovery commands.
- Run history records policy-blocked transitions. Blocked notifications fire on policy escalation.

### Cost enforcement fix

- `max_cost_per_turn` reads `turnResult.cost.usd` first, falls back to legacy `turnResult.cost.total_usd`.

### Policy docs surface

- Dedicated `/docs/policies` page with sidebar, llms.txt, and sitemap coverage.

### VS Code Marketplace readiness

- Dedicated marketplace readiness test guard (publisher, package.json, .vscodeignore, README).

### Evidence

- 3308 tests / 698 suites / 0 failures

## 2.45.0

`2.45.0` adds Ollama as a first-class `api_proxy` provider for local models, ships the build-your-own-connector tutorial, audits the runner tutorial against the real runtime, and hardens docs-contract tests with live-import verification.

### Ollama as first-class api_proxy provider

- Ollama is the fourth `api_proxy` provider alongside Anthropic, OpenAI, and Google.
- Auth-optional: `auth_env` is not required. `AUTH_OPTIONAL_PROVIDERS` mechanism supports future auth-optional providers.
- Provider-specific request builder (`buildOllamaRequest`) uses `max_tokens` (not OpenAI's `max_completion_tokens`).
- Default endpoint: `http://localhost:11434/v1/chat/completions` — works out of the box with `ollama serve`.
- No bundled cost rates for local models. Operators supply rates via `budget.cost_rates`.
- Error classification mirrors OpenAI provider error map.

### Build-your-own-connector tutorial

- New step-by-step tutorial at `/docs/build-your-own-connector` covering request envelope, response contract, validation traps, and auth configuration.
- Tutorial config validated against real `loadNormalizedConfig()`, not string-presence checks (`DEC-BYOC-004`).

### Build-your-own-runner docs audit

- Unguarded `null` returns in `loadContext()`/`loadState()` fixed with explicit error messages.
- `acceptTurn` failure shape corrected: added `state?` and `hookResults?` for hook-blocked paths.
- New Step 8 with inline `runLoop` usage example showing callback contract and result handling.

### Hardened docs-contract tests

- Adapter docs guards import live constants (`PROVIDER_ENDPOINTS`, `BUNDLED_COST_RATES`, `VALID_API_PROXY_PROVIDERS`) instead of regex-scraping nested source literals (`DEC-GUARD-REGEX-002`).
- Runner docs guards verify function exports against real module imports.

### Evidence

- Strict release preflight: 4098 tests / 0 failures
- Docusaurus production build clean

## 2.44.0

`2.44.0` ships cross-run history, terminal recording at all blocked paths, run-level terminal-state alignment, and multi-phase write-owning CI proof.

### Cross-run history surface

- New `agentxchain history` CLI command lists past governed runs with status, timing, and role summaries.
- New dashboard Run History panel (10th view) renders history in the browser with filtering and drill-down.
- `run-history.js` library records terminal outcomes to `.agentxchain/run-history.jsonl` and exposes `listRunHistory()` / `recordRunHistory()`.
- Library template exports `run-history.js` for programmatic consumers.

### Terminal recording at all blocked paths

- Every code path that transitions a run to `blocked` now records the outcome in `run-history.jsonl`.
- Dashboard state-reader and bridge-server expose history data to the observation layer.
- `repo-observer.js` baseline includes `run-history.jsonl`.

### Run-level terminal-state alignment

- Governed run-level `failed` is now formally reserved/unreached. Current governed writers emit only `completed` or `blocked`.
- `recordRunHistory()` rejects unsupported terminal statuses instead of silently legitimizing reserved states.
- `continuity-status.js` returns `reserved_terminal_state` for run-level `failed`.
- `restart.js` fails closed with a truthful reserved-status message.
- `intake resolve` fails closed on governed run-level `failed` with `DEC-RUN-STATUS-001` reference.
- Coordinator completing without satisfying a workstream maps to intent `blocked` (recoverable) instead of intent `failed` (terminal).
- `VALID_TRANSITIONS['executing']` narrowed to `['blocked', 'completed']`.
- Planning specs, intake docs, and state-machine specs aligned to the shipped truth.
- Regression guards added to `continuous-delivery-intake-content.test.js`.

### Multi-phase write-owning CI proof (Tier 6)

- New `examples/ci-runner-proof/run-multi-phase-write.mjs` proves a 3-phase governed run where the implementation agent writes real files.
- Contract test `ci-multi-phase-write-proof-contract.test.js` guards the proof boundary.

### Evidence

- **4029 tests / 700 suites / 0 failures** (3175 node + 854 Vitest)
- Docusaurus production build clean

## 2.43.0

`2.43.0` hardens the lights-out CI proof slice from `2.42.0`. The core validator now repairs one more truthful `review_only` lifecycle case, the CI proof fixtures state the task and phase boundaries explicitly, retries absorb transient cheap-model failures, and the proof scripts keep `--json` output parseable across retries.

### Non-terminal lifecycle normalization

- `review_only` turns with affirmative, non-blocker `needs_human` reasoning on non-terminal phases now normalize to the next phase transition.
- Blocker-style reasons still fail closed instead of being pushed forward.
- The normalization remains narrow to lifecycle mechanics; semantic objection/category coercion stays out of product code.

### CI proof reliability

- The CI proof mandates now embed the concrete hello-world server task directly.
- The planner mandate now names the actual next phase (`review`) instead of the non-existent `implementation` phase.
- Both proof scripts retry up to 3 attempts to absorb transient cheap-model hallucinations without treating a sound governed contract as flaky infrastructure.

### Stable machine-readable retry output

- `run-with-api-dispatch.mjs --json` now emits one final JSON document with `attempts_used` and `attempt_history` instead of multiple top-level blobs.
- `run-via-cli-auto-approve.mjs --json` now follows the same contract.
- Contract tests now prove the missing-auth failure path still returns parseable JSON after retries are exhausted.

### Evidence

- **3117 tests / 652 suites / 0 failures** after version-surface alignment
- Proof contract tests green including retry-path JSON parsing
- Docusaurus production build clean

## 2.42.0

`2.42.0` ships real lights-out CI proof — governed execution driven by a live model in GitHub Actions, not synthetic dispatch. Review-only lifecycle normalization promoted to the core validator, and release discovery surfaces are now governed.

### Real API-governed CI proof

- `api-dispatch-proof` job runs `runLoop` + `dispatchApiProxy` with `claude-haiku-4-5-20251001` on every push to `main`.
- Proves real model dispatch, governed lifecycle, and non-zero API cost in CI without human terminal.
- Cost-controlled: $2.00 budget cap, 6-turn max, ~$0.01-0.02 per run.
- Prior synthetic proof scripts still run — no regression.

### Review-only lifecycle normalization (core)

- Deterministic lifecycle/routing normalization for `review_only` turns promoted from proof-local to `turn-result-validator.js`.
- Phase transition inference, run completion inference, routing correction for completed review-only turns.
- Explicit `run_completion_request: false` is never overridden.

### Release discovery enforcement

- `llms.txt` and `sitemap.xml` added to `ALLOWED_RELEASE_PATHS` in `release-bump.sh`.
- Pre-bump validation fails closed unless both surfaces list the current release route.
- `current-release-surface.test.js` guards discoverability invariant.

### Evidence

- **3104 tests / 650 suites / 0 failures**
- CI Runner Proof workflow green including `api-dispatch-proof` job
- Docusaurus production build clean

## 2.41.0

`2.41.0` ships the governed IDE operator surface for VS Code. Eight governed commands — status, phase/completion approvals, step, run, report, restart, and dashboard launch — all backed by CLI subprocess calls with no direct `.agentxchain/` file writes. State-change notifications drive push alerts for pending gates, blocked states, and turn completions.

### Governed IDE commands

- `agentxchain status` renders governed run state from CLI JSON including continuity and workflow-kit artifact visibility.
- `approve-transition` and `approve-completion` use modal confirmation dialogs before invoking CLI subprocesses.
- `step` and `run` launch in integrated terminals for operator-visible adapter output.
- `report` renders the full governed report from `agentxchain export` piped through `agentxchain report --format json`.
- `restart` uses modal confirmation before invoking session recovery from checkpoint.
- `openDashboard` launches `agentxchain dashboard` in an integrated terminal.

### State-change notifications

- File-watcher driven push notifications for pending phase transitions, pending run completions, blocked states, and turn completions.
- Deduplication prevents repeated notifications for the same gate or blocked state.
- Turn-completion notifications are suppressed during IDE-launched `agentxchain run` to avoid spam.

### Architectural boundary

- All governed mutations go through `execCliCommand()` — no extension code writes to `.agentxchain/`.
- Legacy commands (`claim`, `release`, `generate`) fail closed on governed projects.
- Mutation-boundary guard tests enforce the subprocess-only contract across all eight commands.

### Evidence

- **3083 tests / 648 suites / 0 failures**
- **88 IDE-specific tests / 26 suites / 0 failures**
- Extension compiles and packages as VSIX (65.5 KB, 76 files)

## 2.40.0

`2.40.0` ships the operator-evidence slice that closes the enterprise workflow-kit observation loop: connector health is visible, current-phase artifact ownership is visible in `status` and the dashboard, enterprise-app gate evidence is proven end-to-end, and the Homebrew release path is hardened around the real three-phase lifecycle.

### Connector and artifact evidence

- `agentxchain status` now shows current-phase workflow-kit artifacts with owner role, ownership resolution, required/optional state, and exists/missing status.
- `status --json` now exposes `workflow_kit_artifacts` for automation consumers.
- Dashboard workflow-kit artifact reads now work for governed V4 configs instead of silently failing on enterprise-app projects.
- Status and dashboard artifact ownership surfaces now share one derivation helper so ownership resolution, existence checks, and sorting do not drift.
- Timeline and status surfaces now expose connector health evidence for governed runs.

### Enterprise workflow-kit proof

- Full five-phase `enterprise-app` runtime proof now covers planning, architecture, implementation, security_review, and qa with built-in phase templates plus explicit ownership overrides.
- Dashboard artifact E2E now proves all five enterprise phases render correct ownership and resolution badges.
- Dashboard gate E2E now proves the planning gate and final completion gate render truthful evidence from the real governed run path.
- Gate evidence aggregation now falls back to declared `files_changed` when observer-derived `files_changed` is empty, fixing the non-git and pre-baseline artifact case.

### Release-path hardening

- Homebrew follow-through now documents and enforces the three-phase lifecycle: pre-publish, post-publish pre-sync, and post-sync truth.
- `verify:post-publish` is the executable contract for moving the repo mirror from stale SHA state to registry-backed truth.

### Evidence

- **3836 tests / 620 suites / 0 failures**
- `cd cli && npm test`
- `cd website-v2 && npm run build`

## 2.39.0

`2.39.0` ships workflow-kit phase templates: a governed library of reusable phase definitions that expand inside `workflow_kit.phases`, CLI discovery via `template list --phase-templates`, and front-door documentation across READMEs and getting-started.

### Workflow-kit phase templates

- 5 built-in phase templates: `planning-default`, `implementation-default`, `qa-default`, `architecture-review`, `security-review`.
- Each template defines artifacts with semantic types, required/optional flags, and section requirements.
- `workflow_kit.phases.<phase>.template` references expand deterministically: template artifacts first, explicit `artifacts` appended after.
- Validation fails closed on unknown template IDs without throwing.

### CLI discovery surface

- `agentxchain template list --phase-templates` prints all built-in phase templates with artifact contracts.
- `agentxchain template list --phase-templates --json` outputs structured JSON for automation.
- Base `template list` now hints about `--phase-templates`.

### Front-door documentation

- `README.md`, `cli/README.md`, `getting-started.mdx`, `cli.mdx`, and `templates.mdx` all document phase-template discovery.

### Evidence

- 3800 tests / 647 suites / 0 failures (848 Vitest + 2952 Node)
- Docusaurus production build succeeded

## 2.38.0

`2.38.0` ships the full continuity package: richer governance checkpoints, correct restart behavior around pending gates, checkpoint-drift detection, and truthful operator-action guidance across CLI, dashboard, and API surfaces.

### Continuity checkpointing contract

- Structured governance checkpoints at 6 boundary points: turn assignment, turn acceptance, phase approval, run completion, blocked state, restart reconnect.
- Each checkpoint captures `run_id`, `phase`, `turn`, `role`, `baseline_ref`, and monotonic `checkpoint_epoch`.
- Enables cross-process session recovery with full governance-state context.

### Restart preserves pending gates

- `restart` no longer bypasses pending phase transitions or pending run completions.
- Surfaces the exact approval command instead of reactivating past an unapproved gate.

### Checkpoint-drift detection

- Continuity surfaces compare checkpoint `baseline_ref` against live workspace state.
- Drift warnings surfaced in CLI status, `--json`, `/api/continuity`, and dashboard.
- Stale checkpoints from other runs skip drift evaluation.

### Truthful continuity action guidance

- `recommended_command`, `recommended_reason`, `recommended_detail` replace boolean-only guidance.
- `restart_recommended` is now `true` only when the exact next action is `agentxchain restart`.
- Fixes misleading guidance for runs needing `approve --phase` or `approve --complete`.

### Evidence

- **2937 tests / 610 suites / 0 failures**
- `cd cli && npm test`
- `cd website-v2 && npm run build`

## 2.37.0

`2.37.0` adds Google Gemini as the third governed `api_proxy` provider, hardens Gemini-specific failure handling, fixes the Homebrew mirror PR automation path, and ships a first-class examples docs library.

### Google Gemini as governed api_proxy provider

- Google Gemini is now a supported `api_proxy` provider alongside OpenAI and Anthropic.
- Uses the Gemini `generateContent` endpoint with URL query-param API-key auth.
- Config validation accepts `provider: "google"` for `api_proxy` blocks.
- Three-provider governed proof: OpenAI PM → Google architect → Anthropic QA with real phase transitions and semantic gate evaluation.

### Gemini-specific failure handling

- `promptFeedback.blockReason` now surfaces as a provider-specific extraction-failure message.
- Non-`STOP` `finishReason` values surface when Gemini returns no parts, empty text, or `MAX_TOKENS` truncation.
- Blocked/truncated Gemini responses no longer collapse into generic parse noise.

### Homebrew mirror PR automation

- Publish workflow now creates the Homebrew mirror PR itself with `pull-requests: write`.
- PR creation fails closed — orphan branches are no longer accepted fallback patterns.

### Examples docs library

- 14 example pages under `/docs/examples/` covering all shipped examples.
- `Examples` is a first-class docs sidebar category.
- `llms.txt` and `sitemap.xml` updated for new routes.

### Evidence

- **2915 tests / 609 suites / 0 failures**
- `cd cli && npm test`
- `cd website-v2 && npm run build`

## 2.36.0

`2.36.0` ships the missing operator-visible dashboard continuity panel and closes the release-surface drift that kept the repo-mirrored Homebrew files out of release identity.

### Dashboard continuity is now operator-visible

- Timeline view now renders continuity state directly instead of leaving `/api/continuity` as hidden bridge plumbing.
- `/api/continuity` now serves the same computed continuity shape as `agentxchain status --json`, via the shared `continuity-status.js` helper.
- Dashboard invalidation now refreshes continuity when `SESSION_RECOVERY.md` changes, so restart guidance stays truthful after recovery work.

### Release identity now includes the mirrored Homebrew surfaces

- `release-bump.sh` now treats both `cli/homebrew/agentxchain.rb` and `cli/homebrew/README.md` as governed release surfaces.
- Pre-bump validation fails closed unless the Homebrew mirror formula and maintainer README already point at the target version.
- Post-release current-surface coverage now enforces that the mirrored formula and README track the current npm tarball.

### Evidence

- **2894 tests / 608 suites / 0 failures**
- `cd cli && npm test`
- `node --test test/release-identity-hardening.test.js test/current-release-surface.test.js test/homebrew-mirror-contract.test.js`
- `cd website-v2 && npm run build`

## 2.35.0

`2.35.0` makes cross-session continuity observable across every operator surface.

### Continuity observability across status, reports, and dashboard

- `agentxchain status` now shows checkpoint session id, reason, timing, last turn/role/phase, stale-checkpoint warnings, and restart guidance.
- `status --json` exposes additive `continuity` metadata for automation consumers.
- Governed reports include a `Continuity` section in text and markdown formats with checkpoint metadata and stale-checkpoint detection.
- `.agentxchain/session.json` added to `RUN_EXPORT_INCLUDED_ROOTS` so checkpoint data flows through the export pipeline.
- Coordinator reports surface per-repo continuity with child-level stale detection.
- Dashboard bridge serves `/api/continuity` from `session.json` with WebSocket invalidation.

### CI and release infrastructure modernization

- GitHub Actions standardized on `checkout@v6`, `setup-node@v6`, Google Actions `@v3`.
- Pre-bump version-surface alignment guard validates all 7 governed surfaces before creating release identity.
- Orphaned release-note pages for unpublished versions deleted.

### Evidence

- **2885 tests / 607 suites / 0 failures**
- `cd cli && npm test`
- `cd website-v2 && npm run build`

## 2.34.2

`2.34.2` is the public cross-session continuity release.

### Release surfaces now agree on the shipped package

- Corrected the remaining release-governed drift caught by strict preflight:
  - `.agentxchain-conformance/capabilities.json`
  - homepage hero badge
  - protocol implementor guide example config
  - launch evidence header
  - linked Docusaurus release notes surface
- This is the first version in the restart/extension-security slice that is actually aligned enough to publish.

### Restart and extension hardening remain the actual product delta

- `restart` checkpoint serialization now preserves real phase and turn identity.
- Dedicated subprocess proof covers abandoned active-turn reconnect and checkpoint updates through the public CLI.
- VS Code extension dependency advisories are closed via patched `undici` and `brace-expansion`.

### Evidence

- **2862 tests / 601 suites / 0 failures**
- `node --test cli/test/session-checkpoint.test.js cli/test/restart-cli.test.js`
- `cd cli && npm test`
- `cd cli/vscode-extension && npm audit --json`

## 2.34.1

`2.34.1` is the releasable cross-session continuity release.

### `restart` checkpoints now preserve the real phase and turn identity

- Fixed `cli/src/lib/session-checkpoint.js` to serialize checkpoint state from the actual governed runtime shape:
  - `last_phase` now falls back to `state.phase`
  - `last_turn_id` recognizes both `id` and `turn_id`
  - `last_role` recognizes both `role` and `assigned_role`
- This closes a real continuity bug where `approve-transition` could leave `session.json.last_phase = null`, which is unacceptable on a recovery feature.

### `restart` now has the missing subprocess proof

- Added dedicated CLI subprocess coverage for:
  - reconnecting to an abandoned active turn in a fresh process
  - proving that `accept-turn` and `approve-transition` both update `session.json`
- The new proof immediately caught the checkpoint serializer defect above, which is exactly why this coverage needed to exist.

### The restart contract is now honest about stale checkpoints

- The spec now matches the shipped behavior for `session.json` / `state.json` run-id drift:
  - `state.json` remains source of truth
  - stale checkpoint mismatch warns
  - restart proceeds instead of rejecting a recoverable run

### VS Code extension advisories are closed

- Updated the vendored extension dependency set to patched transitive versions:
  - `undici@6.24.0`
  - `brace-expansion@1.1.13`
- `cd cli/vscode-extension && npm audit --json` now reports **0 vulnerabilities**.

### Evidence

- **2862 tests / 601 suites / 0 failures**
- `node --test cli/test/session-checkpoint.test.js cli/test/restart-cli.test.js`
- `cd cli && npm test`
- `cd cli/vscode-extension && npm audit --json`

## 2.33.1

`2.33.1` is the cross-machine continuity restore release.

### Governed runs can now move across checkouts without changing `run_id`

- Added `agentxchain restore --input <path>`.
- Operators can now:
  - export governed state from machine A
  - restore it into another checkout of the same repo on machine B
  - continue the same governed run with `agentxchain resume`
- This is intentionally narrow and truthful. It is not a general sync engine and it does not claim arbitrary source migration.

### Run exports now declare whether they are safely restorable

- Run export schema advanced to `0.3`.
- Export artifacts now include `workspace.git` metadata:
  - `is_repo`
  - `head_sha`
  - `dirty_paths`
  - `restore_supported`
  - `restore_blockers`
- Restore fails closed when the source export depended on dirty files outside the governed continuity roots, when the target checkout is dirty, or when the target `HEAD` does not match the exported commit.

### Continuity exports include the governed state required for honest restore

- Run exports now include the continuity surfaces that matter for multi-machine governed work:
  - `TALK.md`
  - `.planning/`
  - `.agentxchain/reviews/`
  - `.agentxchain/proposed/`
  - `.agentxchain/reports/`
- This keeps the restore slice honest: decisions, reviews, proposals, reports, and operator planning context survive the machine hop with the run state.

### Restore now handles empty exported files correctly

- Fixed a real contract bug during the release turn:
  - export verification already allowed empty `content_base64`
  - restore incorrectly rejected it
- Added round-trip coverage proving empty governed files survive export -> restore.

### Evidence

- **2848 tests / 599 suites / 0 failures**
- `node --test cli/test/restore-cli.test.js`
- `node --test cli/test/docs-restore-content.test.js cli/test/docs-cli-command-map-content.test.js cli/test/export-cli.test.js cli/test/verify-export-cli.test.js cli/test/coordinator-export-cli.test.js cli/test/export-schema-content.test.js`
- `cd cli && npm test`
- `cd website-v2 && npm run build`

## 2.32.0

`2.32.0` is the governed product examples release.

### Public docs now expose the five end-to-end governed product examples

- Added a dedicated Docusaurus docs page at `/docs/examples` covering all five shipped products:
  - Habit Board
  - Trail Meals Mobile
  - Async Standup Bot
  - Decision Log Linter
  - Schema Guard
- Each example now has public operator-facing documentation for:
  - category
  - team shape
  - workflow phases
  - key workflow-kit artifacts
  - exact local run commands
- This closes a real discoverability defect. The examples were already in-repo, but not surfaced as a coherent public proof portfolio.

### Front-door discovery now links the examples portfolio from multiple surfaces

- Added `Examples` to the docs sidebar.
- Added `Examples` to the website footer.
- Added a homepage `Examples` section linking directly to `/docs/examples`.
- Added code-backed discoverability coverage so this surface is not unguarded docs drift.

### Governed provenance for examples is now part of the public contract

- The examples page now states the actual provenance boundary explicitly:
  - git history is the build trail
  - example-local `TALK.md` files are the governed collaboration trail
  - workflow-kit artifacts are the governed artifact trail
  - `agentxchain template validate --json` is the config/workflow proof
- This preserves the truthful boundary from `.planning/PRODUCT_EXAMPLES_GOVERNED_PROOF.md` instead of pretending copied orchestrator state proves anything.

### Evidence

- **2837 tests / 596 suites / 0 failures**
- `node --test cli/test/docs-examples-content.test.js`
- `cd cli && npm test`
- `cd website-v2 && npm run build`

## 2.31.0

`2.31.0` is the workflow-kit operator observability release.

### `agentxchain report` now exposes workflow-kit artifact status directly

- Governed run reports now include `subject.run.workflow_kit_artifacts` in JSON output.
- Each artifact row carries:
  - `path`
  - `required`
  - `semantics`
  - `owned_by`
  - `owner_resolution`
  - `exists`
- This closes the operator-observability gap left by `2.30.0`: workflow-kit truth is no longer visible only to the active agent prompt/context surfaces.

### Text and markdown reports now render a first-class Workflow Artifacts section

- `agentxchain report --format text` now prints a `Workflow Artifacts (<phase> phase)` section when the current phase declares workflow-kit artifacts.
- `agentxchain report --format markdown` now renders a `## Workflow Artifacts` section with a stable table for tickets, PRs, and audit trails.
- The section is omitted when `workflow_kit` is absent or when the current phase declares zero artifacts.

### Export scope now includes `.planning/` because governed artifacts must be observable

- Governed export artifacts now include `.planning/` in the allowed roots.
- This is not optional polish. Workflow-kit gates explicitly reference governed artifact files under `.planning/`, so report-time existence checks must be able to observe them from the export artifact itself.
- Report existence is still checked against exported file keys, not the live filesystem, preserving the verified-export contract.

### Docs now state the JSON `null` vs `[]` distinction explicitly

- `subject.run.workflow_kit_artifacts = null` means `workflow_kit` is absent from config.
- `subject.run.workflow_kit_artifacts = []` means `workflow_kit` exists but the current phase declares zero artifacts.
- Text/markdown output omits the section in both cases, but the JSON distinction remains part of the operator contract.

### Evidence

- **2789 tests / 590 suites / 0 failures**
- `node --test cli/test/workflow-kit-report.test.js`
- `node --test cli/test/governance-report-content.test.js`
- `cd cli && npm test`
- `cd website-v2 && npm run build`

## 2.30.0

`2.30.0` is the workflow-kit runtime accountability release.

### Workflow-kit is now visible at dispatch time, not only at gate failure

- `CONTEXT.md` now renders a phase-wide `Workflow Artifacts` section showing the current phase artifact contract before the agent starts work.
- The section shows artifact path, required vs optional, semantics, owner, and on-disk existence status.
- `review_only` roles also get artifact previews in `CONTEXT.md`, reusing the existing gate-file preview contract instead of inventing a second preview surface.

### `PROMPT.md` now names the current role's workflow responsibilities explicitly

- `PROMPT.md` now renders a role-scoped `Workflow-Kit Responsibilities` section instead of making the agent infer ownership from the full phase table.
- Ownership resolution is now explicit and stable:
  - `owned_by` wins when present
  - otherwise responsibility falls back to the current phase `entry_role`
- The prompt only lists the current role's accountable artifacts; it does not duplicate the full phase contract.

### Review-only ownership is attestation, not fake authorship

- `review_only` roles no longer receive misleading "produce this file" guidance for workflow-kit artifacts they cannot write.
- Prompt guidance now differentiates:
  - `authoritative` / `proposed`: produce
  - `review_only`: review and attest
- Config validation now warns when a `review_only` role owns a required artifact and no writing role exists in the phase routing.
- Public adapter docs now state this boundary explicitly so runtime behavior, docs, and gate semantics agree.

### Evidence

- **2780 tests / 588 suites / 0 failures**
- Docusaurus production build passes

## 2.29.0

`2.29.0` is the remote-agent proof and automation-correctness release.

### `remote_agent`: shipped as a real governed connector surface

- Added the `remote_agent` adapter: synchronous HTTP POST dispatch for governed turns with config validation, secret-header redaction, and runtime integration through the public CLI.
- Added runnable bridge example under `examples/remote-agent-bridge/` with:
  - `server.js` for deterministic proof
  - `run-proof.mjs` for end-to-end CLI lifecycle proof
  - `model-backed-server.js` for real Anthropic-backed proof
  - `run-repeated-proof.mjs` for repeated reliability measurement

### Real-model proof: transport concession made explicit

- Proved that Claude Haiku can satisfy the governed turn-result contract through the `remote_agent` bridge for both `proposed` and `review_only` paths.
- Proved repeatability across 5 independent governed lifecycles: **5/5 PASS (100%)**, no retries, 10/10 logged outer-fence strips, no field-level repair.
- Tightened the proof boundary wording across spec/example/docs:
  - fence-free raw JSON remains the preferred transport shape
  - the actual invariant is **no field-level repair**
  - logged removal of one outer markdown-fence pair is allowed when the enclosed JSON is otherwise valid

### Automation truth: `step` validation failures now exit non-zero

- Fixed the `step` command to return exit code `1` when a staged turn result fails validation and is retained.
- This closes a real automation defect for scripts and CI that previously could misread a retained validation failure as success.

### Evidence

- **2752 node tests / 582 suites / 0 failures**
- Docusaurus production build passes

## 2.28.0

`2.28.0` is the security and integration release.

### Security: zero npm audit vulnerabilities

- **website-v2**: Upgraded Docusaurus 3.9.2 → 3.10.0, added `@docusaurus/faster`, and applied npm `overrides` for `serialize-javascript@^7.0.5` — closing all 18 high vulnerabilities.
- **cli**: Updated `hono` and `@hono/node-server` — closing both moderate vulnerabilities.
- Both packages now report `0 vulnerabilities` from `npm audit --omit=dev`.

### Retired GitHub Pages deploy path

- Deleted `.github/workflows/deploy-pages.yml` (permanently broken; GCS is canonical).
- Updated deployment docs, specs, and regression guards to enforce the single GCS deploy contract.

### Built-in GitHub Issues reference plugin

- New `@agentxchain/plugin-github-issues` — mirrors governed run status into a configured GitHub issue.
- Fires on `after_acceptance` (turn summaries) and `on_escalation` (blocked/needs-human).
- One comment per run, updated in place. Manages `agentxchain:phase/*` and `agentxchain:blocked` labels while preserving non-AgentXchain labels.
- Advisory-only: no issue closure/reopen, no fabricated state (per `DEC-GITHUB-ISSUES-002`).
- Structured `warn` on token/API failure — never blocks the governed run.

### Evidence

- 2680 node tests / 570 suites / 0 failures.
- 0 vulnerabilities across both packages.
- Docusaurus production build passes.

## 2.27.0

`2.27.0` is the operator onboarding and multi-session continuity release.

This release ships the complete tutorial walkthrough (zero-API-key, copy-pasteable, E2E-proven), the multi-session continuity operator guide with cross-session phase approval proof, and tutorial contract repairs ensuring all front-door docs use truthful operator commands.

### Tutorial walkthrough: install-to-completion narrative

- New `docs/tutorial` page: 10-step walkthrough from `npm install` through `approve-completion` and `report`.
- Uses `manual-dev` and `manual-qa` adapters for zero-API-key reproducibility.
- Exact gate file content for a concrete URL shortener project — operators can copy-paste through the entire lifecycle.
- 11 docs guard assertions covering lifecycle commands, gate content, turn-result examples, and discovery surface inclusion.

### Tutorial contract repair

- Tutorial, getting-started, and first-turn pages now use `init --dir .` (not bare `init`).
- Tutorial explicitly rebinds `dev` to `manual-dev` and `qa` to `manual-qa` before claiming a fully manual path.
- Removed fake implementation→QA approval step that didn't match real governance flow.
- New subprocess E2E (`e2e-tutorial-walkthrough.test.js`) proves the exact operator loop described in the tutorial.

### Multi-session continuity

- New `docs/multi-session` operator guide: how governed runs survive across terminal sessions, machine reboots, and agent handoffs.
- Cross-session phase approval E2E: proves `approve-transition` works in a fresh session against state persisted by a prior session.
- Multi-session completion E2E: proves `approve-completion` across session boundaries.

### Evidence

- 2676 node tests / 570 suites / 0 failures.
- Docusaurus production build passes.

## 2.26.0

`2.26.0` is the charter enforcement and enterprise template release.

This release ships artifact ownership enforcement (`owned_by`), the complete enterprise-app blueprint template with scaffold-to-runtime proof, dynamic ROADMAP generation from routing, open-ended role support, SEO discoverability, community links, mobile navigation fix, and the vs-Warp comparison page.

### Charter enforcement: artifact ownership binding at gate time

- New optional `owned_by: "<role_id>"` field on workflow-kit artifact entries binds artifact ownership to a specific role.
- Gate evaluator checks that at least one accepted turn from the owning role exists in the current phase before the gate passes.
- Phase-scoped participation proof — not file-level attribution.
- Works for both phase-exit gates and run-completion gates.
- Optional artifacts with `owned_by` are only checked when the file exists.

### Enterprise-app template: scaffold-to-runtime proof

- Blueprint-backed `enterprise-app` template ships with 6 roles (pm, architect, dev, security_reviewer, qa, tech_writer), 5 phases (planning → architecture → implementation → security_review → qa), and ownership-enforced artifacts.
- `ARCHITECTURE.md` owned by `architect`, `SECURITY_REVIEW.md` owned by `security_reviewer`.
- Scaffold-to-runtime E2E proves the real operator path: scaffolded files survive into runtime without manual repair.

### Dynamic ROADMAP generation from routing

- Scaffolded `.planning/ROADMAP.md` phase table is now derived from `routing` keys and role mandates instead of a hardcoded 3-row table.
- Blueprint-backed templates with custom routing get a truthful phase table at scaffold time.

### Open-ended roles

- Removed hardcoded `VALID_PROMPT_OVERRIDE_ROLES` — any valid role ID is now accepted in template prompt overrides.

### SEO discoverability

- Added `robots.txt`, `llms.txt`, and `sitemap.xml` for both agentxchain.dev and agentxchain.ai.

### Community links

- Added X/Twitter and Reddit links to navbar, footer, and homepage.

### Mobile navigation fix

- Fixed `.navbar-sidebar__items` collapsing to zero height on narrow desktop viewports due to `backdrop-filter: blur(20px)` creating a CSS containing block.

### vs-Warp comparison page

- New comparison page: AgentXchain vs Warp.dev — honest, research-backed comparison.

### Evidence

- 2649 node tests / 566 suites / 0 failures.
- Docusaurus production build passes.

## 2.25.2

`2.25.2` is the workflow-kit release.

This release ships the complete workflow-kit subsystem: per-phase artifact contracts with semantic validators, runtime gate integration, template validate and scaffold integration, and operator-facing docs. It also fixes a real `template validate` defect where explicit empty `workflow_kit: {}` was not treated as an opt-out.

### Workflow-kit config: per-phase artifacts with semantic validators (Slice 1)

- New optional `workflow_kit` section in `agentxchain.json` lets operators declare per-phase artifacts with semantic validators (`section_check`, `pm_signoff`, `acceptance_matrix`, `release_notes`).
- Parser and validator support with `_explicit` flag to distinguish operator-declared configs from normalization defaults.
- Default behavior unchanged when `workflow_kit` is absent.

### Workflow-kit gate integration (Slice 2)

- Phase-exit and run-completion gates now build an effective artifact set from both `requires_files` and `workflow_kit.phases[phase].artifacts`.
- Duplicate paths are merged by path — not evaluated twice.
- Workflow-kit semantics augment legacy gate semantics; they do not replace them.
- Missing optional workflow-kit artifacts do not block.

### Workflow-kit template validate and scaffold integration (Slice 3)

- `template validate` now reflects declared workflow-kit artifacts in `required_files` and generates `structural_checks` from `semantics` declarations when workflow_kit is explicit.
- `init --governed` scaffolds custom artifact files when an explicit `workflow_kit` config is present, with `section_check` artifacts getting required sections pre-filled as markdown headings.
- Reinit reads existing config for `workflow_kit` before overwriting.

### Fixed: explicit empty `workflow_kit: {}` template validation opt-out

- `workflow_kit: {}` now correctly behaves as an opt-out during `template validate`.
- Previously, explicit empty `workflow_kit` still produced default required files and structural checks.

### Operator docs for workflow-kit

- `getting-started.mdx`, `templates.mdx`, and `adapters.mdx` now explain the `workflow_kit` config section, how custom artifacts are scaffolded/validated, and the boundary between `routing`, `gates.requires_files`, and explicit `workflow_kit`.

### Evidence

- 2606 node tests / 558 suites / 0 failures.
- Docusaurus production build passes.

## 2.25.1

`2.25.1` is the coordinator custom-phase proof patch.

`2.25.0` shipped operator-defined phases and ordered single-repo enforcement, but the coordinator custom-phase surface was still under-documented. This patch closes that gap: multi-repo docs now show the coordinator contract explicitly, and the shipped evidence surface now includes a dedicated subprocess proof for ordered coordinator custom phases.

### Multi-repo docs now explain coordinator custom phases directly

- `/docs/multi-repo` now shows a concrete `planning -> design -> implementation -> qa` coordinator example.
- The docs show the required matching child-repo `routing` shape.
- The docs state the coordinator rule plainly: `phase_transition_request` may only target the immediate next declared phase.
- The docs show the failure case too: `planning -> implementation` is rejected as `phase_skip_forbidden` when `design` exists between them.

This matters because coordinator workflow-shape drift is exactly where vague docs become operational errors.

### Coordinator custom-phase proof is now first-class evidence

- Added `cli/test/e2e-coordinator-custom-phases.test.js`.
- Happy path proves ordered transitions across two child repos and four phases.
- Negative path proves coordinator skip rejection without mutating coordinator state.
- `cli/test/multi-repo-docs-content.test.js` now guards the public docs against drifting away from that proof.

No coordinator runtime defect was found here. The implementation was already correct. What was missing was proof plus operator-facing contract language.

### Release surfaces remain synchronized

- Added the `v2.25.1` release-notes page and sidebar entry.
- Updated the homepage badge, conformance capabilities version, protocol implementor guide example, and launch evidence title.

### Evidence

- 86 node tests / 21 suites / 0 failures in focused coordinator proof and release/docs guards.
- Docusaurus production build passes.

## 2.25.0

`2.25.0` is the custom-phases release.

Previous releases assumed the governed lifecycle was permanently `planning -> implementation -> qa`. That contradicted the product vision. AgentXchain now supports operator-defined phase names in config, enforces declared phase order at runtime, and tells operators exactly where the default scaffold ends and custom-phase extension begins.

### Routing config can now declare custom phases

- Single-repo governed configs no longer hardcode `planning`, `implementation`, and `qa` as the only valid phases.
- Coordinator configs now derive valid phases from declared routing keys instead of rejecting any non-default name.
- Phase names must match `^[a-z][a-z0-9_-]*$` so they stay machine-safe and unambiguous.

This makes phases an operator-defined protocol surface instead of a hardcoded product assumption.

### Runtime phase transitions are now sequential and fail closed

- Single-repo runtime now enforces the same ordered phase contract as coordinator runtime.
- If routing declares `planning -> design -> implementation -> qa`, a turn may request only the immediate next phase.
- Final-phase turns may not request another phase transition and must use `run_completion_request`.
- Defense in depth exists in both turn-result validation and gate evaluation, so out-of-order transitions fail closed even if one layer is bypassed.

This closes a real protocol defect: single-repo runs previously accepted phase skips that coordinator runs already rejected.

### Scaffold and docs now explain the product boundary honestly

- `agentxchain init --governed` now prints `Phases: planning -> implementation -> qa (default; extend via routing in agentxchain.json)`.
- `getting-started.mdx` now has a dedicated custom-phases section with a concrete `design`-phase example.
- `adapters.mdx` documents the runtime contract: phase order comes from declaration order, custom phases require operator-supplied gate files, and only the immediate next phase is valid.

This matters because the default scaffold is still intentionally three-phase. Operators need to know that is a starting point, not the full product boundary.

### Evidence

- 3357 node tests / 0 failures.
- Docusaurus production build passes.

## 2.24.3

`2.24.3` is a coordinator-operator visibility release.

Previous releases built the coordinator execution surface (multi-repo orchestration, phase gates, blocked-state recovery, run-identity guards). But the dashboard and report surfaces were still presenting coordinator state as flat metadata strings. `2.24.3` closes that gap: coordinator blockers are now a structured, inspectable operator surface from CLI reports through the dashboard.

### Coordinator child run identity guard

Coordinator gates now verify that each child repo's `run_id` matches the expected value from the coordinator's `super_run_id` binding. When a child repo has been reset or restarted outside the coordinator's control, the gate rejects with `repo_run_id_mismatch` instead of silently proceeding against stale state. Recovery uses `agentxchain multi resume`.

### `repo_run_id_mismatch` in coordinator reports and CLI

`agentxchain multi step` and governed-run reports now surface `repo_run_id_mismatch` as a structured diagnostic with repo_id, expected run_id, and actual run_id — not a flat prose blocker string. The multi-repo docs include the new blocker code and recovery path.

### Dashboard coordinator blocker API and panel

New `/api/coordinator/blockers` endpoint computes a normalized blocker snapshot server-side using the existing gate evaluation library. Returns mode (`pending_gate`, `phase_transition`, `run_completion`), gate context, blocker codes, and structured detail for each blocker.

New **Blockers** dashboard view renders this snapshot as a pure display panel — no client-side gate logic. Renders mode badge, gate context, blocker codes with color coding, `repo_run_id_mismatch` expected/actual run_id diagnostic, and mode-aware recovery commands.

### Initiative view structured blocker integration

The initiative dashboard view now consumes the computed blocker snapshot instead of flattening coordinator state into a `blocked_reason` string. Coordinator attention state shows mode, gate context, and structured blocker details with a link to the full Blockers panel.

### Evidence

- 2537 node tests / 546 suites / 0 failures.
- Docusaurus production build passes.

## 2.24.2

`2.24.2` is an onboarding-truth patch release.

`2.24.1` closed the launch evidence gaps, but the shipped operator experience still had one inconsistency: `step` told no-key evaluators exactly how to recover a QA credential failure, while `run` only failed with the provider error. `2.24.2` closes that CLI drift and rolls the already-shipped mobile-nav fix into the next published package boundary.

### `run` now tells the truth on missing QA credentials

- `agentxchain run` now emits the same first-party no-key QA fallback as `agentxchain step` when a QA `api_proxy` dispatch fails with `missing_credentials`.
- The guidance is narrow and explicit:
  - edit `roles.qa.runtime` from `api-qa` to `manual-qa`
  - recover the retained QA turn with `agentxchain step --resume`
  - follow the getting-started guide for the mixed-mode scaffold
- This only appears when the failing role is `qa`, the runtime is the default `api-qa`, and the raw config actually defines the built-in `manual-qa` runtime. No generic "just rebind something" hand-waving.

### Automated onboarding proof now covers the real `run` path

- `run-api-proxy` integration coverage now proves the no-key QA path through the real `agentxchain run` surface.
- The test asserts the operator-facing contract, not just process failure:
  - non-zero exit
  - no outbound API request
  - missing env-var naming
  - explicit `manual-qa` fallback
  - exact `roles.qa.runtime` edit
  - truthful recovery command `agentxchain step --resume`
  - getting-started docs link

### The mobile-nav fix is now part of the released version boundary

- The narrow-width website nav collapse fix from `main` is included in the published version line after living on the website ahead of npm.
- The root cause remains the same: `backdrop-filter` on `.navbar` created a containing block for the fixed sidebar. The shipped fix disables that blur when the sidebar is shown, which is visually inert because the overlay covers the navbar anyway.

### Evidence

- 2503 node tests / 540 suites / 0 failures.
- 774 Vitest tests / 36 files / 0 failures.
- Docusaurus production build passes.

## 2.24.1

`2.24.1` is the corrected evidence-closure release.

`2.23.0` made proposal authority honest. `2.24.0` was an unpublished release-candidate tag that failed strict preflight because the public evidence sections lost their concrete node-test counts. `2.24.1` is the corrected public cut. It closes the remaining launch-critical proof gaps: MCP is now proven live against a real Anthropic model, Scenario D escalation and operator recovery are dogfooded end to end, and release postflight now verifies the public package through an isolated `npx -p` execution path instead of assuming npm visibility equals executable truth.

### MCP is now proven through a real model behind a real MCP server

- Added `examples/mcp-anthropic-agent/`, a thin stdio MCP server that exposes `agentxchain_turn` and forwards it to the Anthropic Messages API.
- Added `examples/live-governed-proof/run-mcp-real-model-proof.mjs`, which drives the governed CLI through the MCP adapter and proves the real provider path.
- The governed acceptance boundary now has concrete live evidence for: CLI -> MCP adapter -> MCP stdio transport -> MCP server -> Anthropic API -> JSON extraction -> validation -> acceptance.

### Scenario D escalation and recovery are now proven end to end

- Added `examples/live-governed-proof/run-escalation-recovery-proof.mjs`.
- The proof exercises retry exhaustion, run blocking, retained failed turn state, operator recovery, corrected dev acceptance, and `eng_director` intervention in one continuous governed path.
- This closes the gap between escalation logic existing in tests and escalation behavior being exercised through the real CLI workflow.

### Release postflight now proves the public `npx` path

- `cli/scripts/release-postflight.sh` now runs an isolated `npx --yes -p agentxchain@<version> -c "agentxchain --version"` smoke check with temp HOME/cache/npmrc state.
- This form matters. `npx agentxchain@<version> --version` is ambiguous under modern npm because `--version` can be consumed by `npm exec` instead of the package binary.
- Release postflight no longer stops at registry metadata and install smoke. It now verifies that the public package actually resolves and executes the way first-run users will invoke it.
- `RELEASE_POSTFLIGHT_SPEC.md` and `release-postflight.test.js` were updated to make that contract fail closed.

### Evidence

- 2486 node tests / 534 suites / 0 failures.
- 774 Vitest tests / 36 files / 0 failures.
- Docusaurus production build passes.

## 2.23.0

`2.23.0` is a proposal-authority release.

`2.22.0` closed budget and escalation recovery truth. `2.23.0` closes the cloud-agent authorship gap: API-backed agents can now propose governed file changes, operators can apply or reject them explicitly, gates fail closed until proposals are materialized, and the full completion path is proven live against a real provider.

### `api_proxy` proposal authoring is now shipped

- `write_authority: "proposed"` is now a first-class runtime contract for `api_proxy` roles.
- Proposed file changes are materialized under `.agentxchain/proposed/<turn_id>/` instead of being silently treated as workspace writes.
- Operators now have explicit proposal workflows: inspect, apply, or reject proposed files before continuing the governed run.
- Reserved internal orchestrator paths are rejected at the proposal boundary instead of being allowed to masquerade as product work.

### Proposal-aware gates and completion now fail closed

- Implementation-exit and run-completion gates now reject proposal-only state until the operator has applied the proposed files into the workspace.
- Completion-only proposed turns can now truthfully request `run_completion_request: true` with a no-op payload (`proposed_changes: []`, `files_changed: []`) instead of being forced into fake work delivery.
- Final-phase dispatch guidance now tells proposed roles exactly how to emit a completion turn instead of leaving the model to guess.

### Live proposed-authority proof is now real

- Full hardened live proof now passes against Anthropic Claude Sonnet 4.6: `run_7b067f892916b799`.
- Proposal turn `turn_78181787ad6ab3a7` emitted gate-valid `## Changes` and `## Verification` content from the real provider.
- Completion turn `turn_0ebc2190d01230ea` requested `run_completion_request: true`, paused on `pending_run_completion`, and completed only after human approval.
- The live proof harness now persists rejected provider payloads under `.planning/LIVE_PROOF_DIAGNOSTICS/` on failure so future reruns produce inspectable evidence instead of cleanup-amnesia.

### Cost truth is now operator-owned

- `config.budget.cost_rates` now overrides bundled defaults, so AgentXchain does not pretend to maintain a complete provider/model pricing catalog.
- Anthropic bundled defaults were corrected to the real published rates used in-product (`claude-opus-4-1-20250805`: `$15/$75` -> `$5/$25`; `claude-haiku-4-5-20251001`: `$0.80/$4.00` -> `$1.00/$5.00`).
- Bundled rates were renamed to `BUNDLED_COST_RATES` to make the boundary explicit: they are defaults, not the source of truth.

### Evidence

- 2476 node tests / 532 suites / 0 failures.
- 761 Vitest tests / 36 files / 0 failures.
- Docusaurus production build passes.

## 2.22.0

`2.22.0` is a governance depth release.

`2.21.0` closed front-door truth gaps. `2.22.0` closes the governance runtime gaps: cost control, escalation recovery, and operator guidance truthfulness.

### Budget enforcement

- `per_run_max_usd` and `on_exceed: 'pause_and_escalate'` are now enforced at runtime. Previously scaffolded as dead config.
- Post-acceptance exhaustion transitions the run to `blocked` with `budget_exhausted` category.
- Pre-assignment guard rejects new turns when the budget is already exhausted.
- Per-turn overrun warning emitted when actual cost exceeds reservation (advisory only).

### Budget recovery

- Operator raises `per_run_max_usd` in `agentxchain.json`, then `agentxchain resume` assigns the next turn.
- Budget is reconciled from config at load time, so `agentxchain status` shows current headroom.
- Proven through real CLI subprocess execution.

### Escalation recovery E2E proof

- Both escalation paths (retained-turn and run-level) are now proven through real CLI subprocess execution.
- Decision ledger contains `operator_escalated` and `escalation_resolved` entries after the full cycle.

### Runtime-aware escalation guidance

- Recovery action strings now vary by runtime type: `agentxchain resume` for manual runtimes, `agentxchain step --resume` for non-manual.
- Targeted multi-turn escalation appends `--turn <id>`.
- Stale pre-2.22.0 recovery actions are reconciled at load time.

### OpenAI cost rates

- Added built-in cost rates for 8 OpenAI models: `gpt-4o`, `gpt-4o-mini`, `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `o3`, `o3-mini`, `o4-mini`.
- Unlisted models still work but report `$0` cost — adapter docs state this explicitly.

### Multi-provider governed proof harness

- Added `examples/live-governed-proof/run-multi-provider-proof.mjs` with mock-backed contract test.
- Proves multi-provider governed orchestration under deterministic mocks. Live execution blocked only by `OPENAI_API_KEY`.

### Evidence

- 2394 node tests / 514 suites / 0 failures.
- Docusaurus production build passes.

## 2.21.0

`2.21.0` is a truth-surface release.

`2.20.0` hardened release identity, but the product still had an honesty gap in the front door: onboarding docs had drifted from the real scaffold, several operator docs overstated or omitted shipped behavior, and comparison pages were unguarded marketing copy against moving competitors.

### Release completeness now fails closed in CI

- The publish workflow now treats downstream truth as a completion gate instead of advisory follow-through.
- Canonical Homebrew tap state must be provably current before the release workflow can finish green.
- The release playbook and release-doc guards were updated to match the shipped CI contract instead of a softer operator story.

### The onboarding path is now audited against the real scaffold

- Added `/docs/first-turn` as the bridge from `agentxchain demo` to a real governed repo.
- Audited `quickstart`, `templates`, `adapters`, `cli`, and `protocol` docs against actual CLI behavior and scaffold output.
- Added code-backed guards so these pages fail when examples drift from the shipped product surface.

### Comparison pages are now guarded public truth surfaces

- Refreshed all four shipped comparison pages against current official sources:
  - OpenAI Agents SDK: sessions, tracing, provider-agnostic model support, resumable HITL interrupts
  - CrewAI: task guardrails, checkpoint/resume, `@human_feedback`
  - LangGraph: `Command`, parallel supersteps, subgraphs, checkpoint-backed interrupts
  - AG2 / AutoGen: guardrails, Swarm-style handoffs, A2A / AG-UI support
- Added `comparison-pages-content.test.js` so homepage/nav routes, required page sections, and competitor-strength claims stay anchored to the positioning matrix.

### Evidence

- 2372 node tests / 511 suites, 0 failures.
- 761 Vitest tests / 36 files, 0 failures.
- Docusaurus production build passes.

## 2.20.0

The release path is now harder to lie about. This release replaces raw `npm version` with a fail-closed release-identity command, marks downstream Homebrew truth as required for release completion, and proves the new contract with execution-level tests instead of string-matching shell scripts.

### Release Identity Hardening

- Added `npm run bump:release -- --target-version <semver>` as the supported release-identity path.
- `release-bump.sh` now:
  - runs `npm version --no-git-tag-version`
  - creates commit `<semver>`
  - creates annotated tag `v<semver>`
  - verifies the tag is an annotated tag object
  - verifies the tag dereferences to the release commit before exiting 0
- Raw `npm version <semver>` is no longer the documented release-identity mechanism.

### Downstream Truth Is Required

- `.planning/RELEASE_PLAYBOOK.md` now marks both downstream update and downstream truth verification as required steps.
- The playbook now states explicitly that a stale canonical Homebrew tap means the release is incomplete.
- When CI cannot push the canonical tap because `HOMEBREW_TAP_TOKEN` is absent, the operator contract now requires local `sync:homebrew --push-tap` follow-through instead of treating the warning as sufficient.

### Execution-Level Proof

- Added subprocess release-identity tests that create a temp git repo rooted above `cli/`, run `release-bump.sh`, and assert:
  - `package.json` and `package-lock.json` are updated
  - the release commit message is `<semver>`
  - the tag object is annotated
  - the tag dereferences to `HEAD`
- Added fail-closed tests for dirty-tree rejection and pre-existing target tags.

### Evidence

- 2338 node tests / 508 suites, 0 failures.
- 758 Vitest tests / 36 files, 0 failures.
- `release-bump.sh` temp-repo proof passes, including dirty-tree and pre-existing-tag failure cases.

## 2.19.0

AgentXchain now has an honest one-command first-run path. This release ships the `demo` command, moves the adoption funnel to demo-first across the front door, upgrades the demo narrative to a security-sensitive scenario that actually demonstrates governance value, and prevents baseline evidence paths from poisoning later governed turns.

### Demo-First Adoption

- Added `agentxchain demo`, a one-command governed lifecycle walkthrough that runs in a temp git workspace, stages real turn results through the runner interface, and cleans up automatically.
- Front-door adoption surfaces now lead with `npx agentxchain demo`:
  - root `README.md`
  - `cli/README.md`
  - homepage hero CTAs
  - quickstart Path 0
- Discoverability guards now fail if the demo falls out of the README, package README, quickstart, or homepage.

### Higher-Signal Demo Narrative

- The demo story now centers on auth token rotation instead of a toy counter app.
- PM, Dev, and QA objections now surface consequence-bearing failures:
  - missing rollback path could invalidate live API keys
  - clock skew could skip or double-rotate keys
  - missing failure-audit entries create a compliance gap
- Demo lessons now explain the cost of ungoverned delivery instead of restating abstract governance rules.

### Baseline Evidence Hardening

- `.planning/AGENT-TALK.md`, `.agentxchain/reviews/`, and `.agentxchain/reports/` no longer poison the next governed actor's baseline-dirty check.
- Evidence paths remain observable for the turn that creates them, but unchanged pre-existing evidence dirt is filtered out of later same-HEAD and head-changed observation.
- Authoritative follow-up turns can now succeed without committing derived review/report artifacts first.

### Evidence

- 2315 node tests / 499 suites, 0 failures.
- 758 Vitest tests / 36 files, 0 failures.
- Docusaurus production build passes.
- Demo proof: `agentxchain demo` completes in ~1.1s with 5 decisions and 3 objections.

## 2.18.0

The governed lifecycle now works correctly in git-backed workspaces with proper artifact observation, all four adapter types have live execution evidence (MCP at transport level), and the full governed completion path is proven end to end.

### Live Connector & Completion Proof

- All four adapter types (`manual`, `local_cli`, `api_proxy`, `mcp`) now have live CLI execution evidence through real `agentxchain step` dispatch.
- MCP proof covers both `stdio` and `streamable_http` transports (transport-level with echo agents, not model-level).
- Terminal governed completion is proven live: `pending_run_completion` → `approve-completion` on a retained workspace.
- Governed PM signoff DX hardened: scaffolds ship with `Approved: NO` by default, with explicit guidance on the human-approval flip.

### Artifact Observation Fixes

- `compareDeclaredVsObserved` now degrades gracefully when git observation is unavailable instead of manufacturing phantom-artifact failures from an empty diff.
- Context-section parser now correctly handles `### Verification` subsections and code blocks containing markdown headers within `Gate Required Files`.
- CI proof scripts and test fixtures now initialize proper git repos so the repo-observer can detect file changes across turns.

### QA & Evidence Depth

- QA evidence visibility: verification details, changed-file previews, dispatch-log excerpts, and gate-file content previews now surface in review context.
- Turn-result normalization handles `artifacts_created` object coercion, exit-gate-to-phase correction, missing-status recovery, and terminal completion signaling.
- Phase-aware prompt guidance ensures authoritative roles request explicit phase transitions.
- Review-turn context now includes bounded changed-file previews and semantic gate-file annotations.

### Evidence

- 2290 node tests / 495 suites, 0 failures.
- Conformance: 81 / 81 fixtures passing across all tiers.
- Live completion: `run_91f4ba5d54707a7e` completed at `2026-04-07T11:14:16.734Z`.
- Live MCP dogfood: `turn_e41e35ba8eea9768` (stdio), `turn_5292f4de9e01ea71` (streamable_http).

## 2.17.0

Protocol conformance now proves the workflow-kit semantics it previously left implicit, and the public implementor guide now states the exact fixture-backed contract for every shipped surface instead of collapsing proof into slogans.

### Workflow Gate Conformance Expansion

- Tier 1 `gate_semantics` now proves semantic failures for:
  - `.planning/SYSTEM_SPEC.md` missing required sections
  - `.planning/IMPLEMENTATION_NOTES.md` scaffold-placeholder content
  - `.planning/acceptance-matrix.md` placeholder requirement tables
  - `.planning/RELEASE_NOTES.md` placeholder ship-surface content
- The Tier 1 corpus increased from `46` to `50` fixtures.
- The total conformance corpus increased from `74` to `81` fixtures across all three tiers.

### Implementor Guide Truth Contracts

- `/docs/protocol-implementor-guide` now enumerates the concrete fixture-backed invariants for all shipped surfaces:
  - Tier 1: `state_machine`, `turn_result_validation`, `gate_semantics`, `decision_ledger`, `history`, `config_schema`
  - Tier 2: `dispatch_manifest`, `hook_audit`
  - Tier 3: `coordinator`
- Section-aware docs guards now fail if any surface regresses back to vague summary text while the fixture corpus still proves specific invariants.
- Release-surface version truth stays aligned across the homepage badge, `capabilities.json`, release notes, and the implementor-guide example.

### Evidence

- 2224 node tests / 489 suites, 0 failures.
- 705 Vitest tests / 36 files, 0 failures.
- Conformance: 81 / 81 fixtures passing across all tiers (Tier 1: 50, Tier 2: 23, Tier 3: 8).
- Docusaurus production build passes.
- npm publish verified: `agentxchain@2.17.0` live on registry.

## 2.16.0

Coordinator governance reporting is now operational instead of partial, workflow-kit gates now enforce the repo-native planning contract they already claimed to depend on, and external consumers can dispatch a real adapter-backed turn from the published package boundary.

### Coordinator Governance Report Completion

- Coordinator exports now write real decision-ledger entries during init, dispatch, gate, and recovery flows instead of exposing an empty report surface.
- `agentxchain report` for coordinator workspaces now includes:
  - coordinator timeline
  - coordinator timing
  - barrier summary
  - barrier transition history from `barrier-ledger.jsonl`
  - deterministic next actions from verified coordinator state
  - coordinator decision digest from `decision-ledger.jsonl`
- Coordinator report docs were updated in the same slice so the operator contract matches the shipped JSON, text, and markdown surfaces.

### Workflow-Kit Gate Truth

- Governed planning now fails closed when the scaffolded workflow-kit contract drifts:
  - baseline planning system spec enforcement
  - template-specific `SYSTEM_SPEC.md` overlays
  - implementation-exit gate requires `IMPLEMENTATION_NOTES.md`
  - QA gate enforces acceptance-matrix semantics
  - ship gate enforces release-notes presence
- These checks turn repo-native planning/docs artifacts into real gate inputs instead of dead files that the product claimed to care about but did not enforce.

### Adapter-Backed External Consumer Starter

- `examples/external-runner-starter/run-adapter-turn.mjs` now proves the published `agentxchain/adapter-interface` boundary from a clean consumer install.
- The starter uses `dispatchLocalCli`, generates its own deterministic mock agent at runtime, and drives a real dispatch → stage → accept flow.
- Pack-and-install proof now guards both external adoption paths:
  - manual runner-interface starter
  - adapter-backed starter

### Evidence

- 2186 node tests / 483 suites, 0 failures.
- Tier 1: 46 / 46 conformance fixtures passing.
- Docusaurus production build passes.
- npm publish verified: `agentxchain@2.16.0` live on registry.

## 2.15.0

The intake-to-coordinator workflow is now proven end to end: handoff, blocked-state recovery, hook-stop asymmetry, and repo-local intake-to-run automation continuity all ship with real subprocess E2E proofs.

### Intake-to-Coordinator Handoff

- `intake handoff` bridges source-repo intent to a coordinator workstream, bound by `super_run_id`.
- Coordinator context (`COORDINATOR_CONTEXT.json` and `.md`) is rendered into coordinator artifacts as informational references.
- Coordinator-root intake errors now enumerate child repos instead of returning opaque failures.
- Handoff is front-door discoverable in README, cli README, quickstart, and multi-repo docs.
- E2E proof: `e2e-intake-coordinator-handoff.test.js` drives real CLI dispatch through `multi step`, `accept-turn`, and `multi approve-gate`.

### Blocked-State Recovery

- New `multi resume` command recovers coordinators from `blocked` state.
- `multi resume` resyncs child repos first, fails closed on blocked children, restores `active` or `paused`, and records `blocked_resolved` history entries.
- `intake resolve` now accepts `blocked` as a valid source state, enabling the same run/workstream to recover to `completed`.
- E2E proof: `e2e-intake-coordinator-blocked.test.js` uses a real `after_acceptance` tamper-detection hook violation to drive `blockCoordinator()`.

### Coordinator Hook-Stop Asymmetry

- Pre-action hooks are idempotent barriers that reject operations without persisting `blocked` state.
- Post-action hooks can persist `blocked` and fire `on_escalation`.
- The distinction is now documented, spec'd (`COORDINATOR_HOOK_ASYMMETRY_SPEC.md`), and guarded by `coordinator-hook-asymmetry.test.js`.

### Intake-to-Run Integration

- `intake start` hands off to `agentxchain run` through the same `run_id` — the runner adopts the intake-started run rather than silently creating a new one.
- E2E proof: `e2e-intake-run-integration.test.js` drives the full `record → triage → approve → plan → start → run → resolve` sequence through CLI subprocesses.

### Interface Alignment Barriers

- Real `interface_alignment` barriers shipped with end-to-end multi-repo docs example.
- Runner adoption docs tightened with Tier 3 conformance requirements.

### Evidence

- 2048 node tests / 457 suites, 0 failures.
- 694 Vitest tests / 36 files, 0 failures.
- Tier 1: 46 fixtures. Total conformance corpus: 74 fixtures.
- Docusaurus production build passes.

## 2.14.0

External runner adoption is now a real package contract instead of a docs promise. This release adds a canonical installed-package starter, proves the packed tarball works in a clean consumer project, and extends release postflight so a publish is not complete unless the public runner exports import successfully.

### External Runner Package Contract

- New `examples/external-runner-starter/run-one-turn.mjs` provides the canonical installed-package one-turn starter for external runner authors.
- New `examples/external-runner-starter/README.md` distinguishes repo-native CI proof scripts from the installed-package starter instead of pretending they are the same surface.
- New `external-runner-package-contract.test.js` packs the real tarball, installs it into a temp project, and runs the starter through `agentxchain/runner-interface`.

### Runner Docs And Example Accuracy

- `/docs/build-your-own-runner` and `/docs/runner-interface` now name `agentxchain/runner-interface` and `agentxchain/run-loop` as the external contract, not repo source paths.
- Runner docs now explicitly separate repo-native proofs (`examples/ci-runner-proof/`) from external-consumer starter code.
- The repo-native proof README now states its real purpose instead of implying that external consumers should copy repo-relative imports.

### Release Truth Hardening

- `release-postflight.sh` now fails closed unless the published package passes both smoke surfaces:
  - CLI binary execution
  - runner package export import (`agentxchain/runner-interface` and `agentxchain/run-loop`)
- `release-postflight.test.js` now guards runner-export smoke, including the failure path where the published interface version drifts.

### Evidence

- 1970 node --test tests / 441 suites, 0 failures.
- 684 Vitest tests / 36 files, 0 failures.
- Tier 1: 46 fixtures. Total conformance corpus: 74 fixtures.
- Website production build passes.

## 2.13.0

Multi-repo onboarding is now front-door discoverable, and the protocol conformance kit proves the semantic workflow gates it already claimed to enforce.

### Multi-Repo Onboarding

- The multi-repo cold-start path is now linked from all front-door surfaces: root `README.md`, `cli/README.md`, and the landing page.
- New guard coverage prevents multi-repo mentions from regressing back into feature-name-only dead ends with no onboarding pointer.
- The shipped `/docs/quickstart#multi-repo-cold-start` walkthrough is now the explicit operator path for coordinator setup.

### Protocol Conformance Expansion

- Tier 1 `gate_semantics` now proves `evaluateRunCompletion()` directly instead of stopping at phase-exit behavior.
- New fixtures prove negative semantic truth for `.planning/PM_SIGNOFF.md` and `.planning/ship-verdict.md`, including rejected signoff, missing approval marker, non-affirmative ship verdict, human-approval pause, immediate completion, and non-final-phase rejection.
- The reference conformance adapter now supports `evaluate_run_completion`, so third-party implementations can prove the same ship-verdict contract the reference CLI enforces.

### Release Surface Hardening

- `capabilities.json` and the protocol implementor guide example are now version-synced and guarded.
- New `current-release-surface.test.js` enforces that package version, changelog, release-notes route, sidebar, homepage badge, capabilities example, and implementor guide example stay aligned.

### Evidence

- 1949 node --test tests / 437 suites, 0 failures.
- 684 Vitest tests / 36 files, 0 failures.
- Tier 1: 46 fixtures. Total conformance corpus: 74 fixtures.
- Website production build passes.

## 2.12.0

Governed gates now enforce semantic truth, not just file presence. Scaffold ergonomics and docs accuracy improved across the board.

### Semantic Workflow Gate Enforcement

- Phase-transition gates now require `.planning/PM_SIGNOFF.md` to contain `Approved: YES`. File existence alone no longer satisfies the planning gate.
- Run-completion gates now require `.planning/ship-verdict.md` to carry an affirmative `## Verdict:` value (`YES`, `SHIP`, or `SHIP IT`). Placeholder verdicts fail the gate.
- `template validate` remains scaffold-integrity proof only — it does not pretend to certify gate readiness. Docs and CLI output now explicitly distinguish the two.
- New `cli/src/lib/workflow-gate-semantics.js` module: pure-function semantic evaluators consumed by the gate evaluator.

### Scaffold Ergonomics

- `agentxchain init --governed` now accepts `--dir <path>` for explicit scaffold target directory. Project name is inferred from directory basename. `--dir .` bootstraps in-place inside an existing repo.
- `--dev-command <parts...>` and `--dev-prompt-transport <mode>` allow non-default agent configuration at scaffold time.
- All documentation examples updated to use explicit `--dir` — implicit default-directory patterns removed from docs.

### Docs Accuracy

- Adapter docs narrowed to verified-default `claude --print` contract; overclaiming of equal Codex/Aider support removed.
- Quickstart cold-start E2E proof added: the documented flow is now tested end-to-end.
- Homebrew tap rename audit completed: all stale `homebrew-agentxchain` references fixed across planning docs, scripts, and tests.

### Evidence

- 1921 node --test tests / 432 suites, 0 failures.
- 681 Vitest tests / 36 files, 0 failures.
- Website production build passes.

## 2.11.0

Protocol conformance closure and workflow-kit proof surfaced honestly. This release closes the remaining shipped verifier gaps around `hook_audit` and `dispatch_manifest`, promotes remote verification into a first-class public docs contract, and turns `template validate` into an explicit operator proof for the governed scaffold.

### Conformance Closure

- `hook_audit` verifier coverage now spans the full shipped branch set, including invalid-output handling, multi-hook execution, blocked-failure paths, and tamper detection.
- `dispatch_manifest` now covers the full shipped error taxonomy instead of a partial subset.
- `hook_ok` response semantics are documented and held by code-backed docs guards, so hook success is not left as an implied convention.

### Remote Verification Surface

- New public docs page: `/docs/remote-verification`.
- The HTTP conformance path is now documented from protocol contract through runnable example server and docs/content guard coverage.
- Remote verification is treated as the same fixture-driven verifier model as local stdio, not as a second conformance system.

### Workflow-Kit Proof

- `agentxchain template validate` now proves the governed workflow kit, not just the template registry.
- `--json` exposes a `workflow_kit` block so automation can distinguish scaffold failures from template-surface failures.
- The four required workflow markers are now part of the explicit operator-facing contract: `Approved:`, `## Phases`, `| Req # |`, and `## Verdict:`.
- `README.md`, `cli/README.md`, and `/docs/quickstart` now document `template validate` as a front-door proof step.

### Evidence

- 1884 node --test tests / 423 suites, 0 failures.
- 679 Vitest tests / 36 files, 0 failures.
- Website production build passes.

## 2.10.0

First real-model evidence: AgentXchain now has a live governed proof that dispatches to a real LLM via the api_proxy adapter, validates all protocol artifacts, and demonstrates governed retry on schema non-conformance.

### Live Governed Proof

- New `examples/live-governed-proof/run-live-turn.mjs` — standalone script that scaffolds a governed project, dispatches a review-only turn to a real Anthropic API endpoint, and validates the full artifact trail.
- Gated behind `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` env vars — exits 0 (skip) with no credentials, so CI stays deterministic.
- Uses governed retry (`rejectTurn` → re-dispatch) to handle real model schema violations, demonstrating protocol rejection/retry machinery on live model output.
- Two-phase artifact validation: dispatch/staging validated before acceptance (since `acceptTurn` cleans up those directories), state/history/ledger validated after.
- Contract test enforces boundary rules: imports only from `runner-interface.js` and `api-proxy-adapter.js`, no internal modules, no CLI shell-out.

### Homebrew Mirror Drift Guard

- `cli/homebrew/agentxchain.rb` and `cli/homebrew/README.md` now track the current release version, enforced by `homebrew-mirror-contract.test.js`.
- Fixed stale mirror that claimed v2.1.1 while the canonical tap served v2.9.0.

### Runner/Live-Proof Contract Corrections

- Fixed `writeDispatchBundle` signature drift in public runner docs and planning specs.
- Documented `acceptTurn()` cleanup behavior: dispatch and staging directories are removed after commit.
- Live-proof spec corrected to reflect two-phase validation (pre-accept dispatch/staging, post-accept state/history/ledger).

### Model Tier Retry Budget Warning

- New `adapters.mdx` section documenting that cheaper models may require governed retries for schema-conformant output, with concrete cost implications per model tier.
- Code-backed guard reads `COST_RATES` from `api-proxy-adapter.js` and enforces that all documented models exist in the pricing table.

### Evidence

- 659 Vitest tests (36 files) + 1640 node --test (372 suites), 0 failures.
- Live governed proof verified against real Anthropic API.
- Website production build passes.

## 2.9.0

Runner layer: declared interface, ergonomic improvements, second-runner proof, public docs, and authenticated dashboard gate approvals. The protocol's runner-independence claim is now backed by a real second runner that imports the library boundary with zero CLI shell-out.

### Runner Interface (v0.2)

- New declared runner contract module (`runner-interface.js`) re-exports protocol-normative operations for any governed execution consumer: CLI, CI, hosted, or programmatic.
- Interface includes lifecycle operations (init, assign, accept, reject, approve gates, escalate, reactivate), dispatch/staging support, hooks, notifications, concurrency locks, and config utilities.
- `getTurnStagingResultPath` exported so runners can stage turn results without importing internal modules directly. Added in v0.2 after boundary leak was identified.
- Interface version `0.2` — incremented per the versioning rule when surface-expanding operations are added.
- New docs page: `/docs/runner-interface` with code-backed guard, cross-linked from CLI, quickstart, and protocol docs.

### Assign Turn Ergonomics

- `assignGovernedTurn()` success now returns the assigned `turn` at top level (`{ ok, state, turn }`), eliminating the need for consumers to recover the turn from `state.active_turns`.
- Failed assignments do not fabricate a `turn: null` — absence means failure.
- Real consumer updated: `coordinator-dispatch.js` uses `assignResult.turn` directly.

### CI Runner Proof

- New `examples/ci-runner-proof/run-one-turn.mjs` — standalone second runner that imports only `runner-interface.js` and executes one governed turn (init → assign → stage → accept) with artifact validation.
- Proof validates post-acceptance artifacts: `state.json` (SHA256 + structure), `history.jsonl` (entry count + fields), `decision-ledger.jsonl` (entry count).
- Dedicated GitHub Actions workflow (`ci-runner-proof.yml`) runs the proof on every push to main and on PRs.
- 13-test contract guard enforces: no `child_process` import, no CLI binary references, no `turn-paths.js` direct import, runner-interface.js import present, script exit 0 with valid JSON.

### Dashboard Gate Approvals

- Dashboard is no longer read-only. Operators can now approve pending phase transitions and run completions directly from the dashboard UI.
- `POST /api/actions/approve-gate` with per-process token auth via `X-AgentXchain-Token` (timing-safe comparison).
- `GET /api/session` delivers the local auth token.
- WebSocket remains strictly read-only — mutations are HTTP-only.
- Blocked-state recovery stays CLI-only. Gate approval and recovery are categorically different authority models.

### Evidence

- 659 Vitest tests (36 files) + 1621 node --test (366 suites), 0 failures.
- CI runner proof passes with runner interface v0.2.
- Website production build passes.

## 2.8.0

Governance reporting and protocol surface hardening. Operators can now generate human-readable governance reports from export artifacts, and the protocol reference boundary is formally documented with normative/non-normative separation.

### Governance Report Command

- New `agentxchain report` command produces governance summaries from verified export artifacts.
- Three output formats: `text` (terminal), `json` (automation), `markdown` (PRs, releases, audit records).
- Reports verify the export artifact first and fail closed — invalid artifacts never produce success summaries.
- Governed run reports summarize project identity, run status/phase, blocked state, turn counts, budget utilization, and evidence counts.
- Coordinator workspace reports summarize workspace identity, repo/workstream/barrier counts, repo status histogram, and per-repo export health.
- Report contract version `0.1` with stable `subject.kind` discrimination (`governed_run` / `coordinator_workspace`).
- New docs page: `/docs/governance-report`.

### Protocol Reference Boundary

- Formalized the normative/non-normative boundary for protocol v6.
- `PROTOCOL-v6.md` is the canonical normative reference. CLI command names, dashboard UX, provider adapters, and notifications are explicitly non-normative.
- New docs page: `/docs/protocol-reference` with code-backed guard tests reading source constants.

### Conformance Naming Canonicalization

- Fixed the sole naming mismatch in conformance fixtures: `turn_result` renamed to `turn_result_validation` across all 53 fixtures, 9 surfaces, 3 tiers.
- 71-test guard enforces fixture-to-source naming alignment.

### Export Schema Reference

- New docs page: `/docs/export-schema` documenting the export artifact schema (v0.2), both export kinds, file-entry integrity fields, and nested coordinator contract.
- `verify export --format json` report shape now documented: success/failure fields and command-error shape.
- Code-backed guard builds real exports and verifies docs mention actual output keys.

### Evidence

- 654 Vitest tests (36 files) + 1586 node --test (354 suites), 0 failures.
- Website production build passes.

## 2.7.0

Governed lifecycle integrations. Operators can now receive real-time notifications on governed lifecycle events, raise first-class escalations, and reference a complete operator recovery map — closing the workflow-kit and beginning the integration layer.

### Governed Notification Contract

- New top-level governed config surface: `notifications.webhooks`. Notifications are orchestrator-emitted lifecycle events, not hook side effects.
- Webhook transport delivers JSON payloads on governed transitions: `run_blocked`, `operator_escalation_raised`, `escalation_resolved`, `phase_transition_pending`, `run_completion_pending`, `run_completed`.
- Delivery is best-effort and never blocks governed execution.
- All delivery attempts are recorded in `.agentxchain/notification-audit.jsonl` — included in `agentxchain export` and verified by `agentxchain verify export`.
- New docs page: `/docs/notifications`.

### Operator Escalation Surface

- New `agentxchain escalate` command for operator-raised escalations with structured metadata.
- Escalation persists `blocked_on = escalation:operator:*` with `typed_reason = operator_escalation`, distinct from retry-exhaustion blocks.
- `resume` now truthfully recovers blocked governed runs: retained blocked turns are re-dispatched, run-level blocks are reactivated.
- Escalation raise and resolution are recorded in `.agentxchain/decision-ledger.jsonl` as `operator_escalated` and `escalation_resolved` decisions.

### Recovery Surface Closure

- Formal recovery analysis confirmed all 9 `typed_reason` values have explicit recovery paths through existing commands (`step`, `resume`, `approve-transition`, `approve-completion`, `escalate`).
- A dedicated `agentxchain recover` command was explicitly rejected: no unrecoverable states exist, and a catch-all command would duplicate logic that drifts.
- New docs page: `/docs/recovery` with the complete operator recovery map, backed by code-guard tests reading `blocked-state.js` and `governed-state.js`.

### Evidence

- 654 Vitest tests (36 files) + 1480 node --test (340 suites), 0 failures.
- Website production build passes.

## 2.6.0

Auditable export artifacts. Governed runs and coordinator workspaces can now be exported as self-verifiable JSON artifacts with embedded content, integrity hashes, and an independent verification command.

### Governed Run Export

- New `agentxchain export` command produces a deterministic JSON snapshot of all governed audit artifacts: config, state, history, decision ledger, hook audit/annotations, dispatch artifacts, staging artifacts, acceptance transaction journals, and intake artifacts.
- Each file entry includes `content_base64`, `bytes`, and `sha256` so the artifact is independently re-derivable without access to the original repo.
- Export schema version `0.2`. Output to stdout by default or to a file via `--output <path>`.
- Legacy (non-governed) projects and unsupported formats fail closed.

### Coordinator Workspace Export

- `agentxchain export` from an `agentxchain-multi.json` root produces `export_kind: "agentxchain_coordinator_export"` with recursively embedded child repo governed exports.
- Detection order: governed project first, coordinator workspace second.
- Child repo export failures do not fail the coordinator export — each child entry has `ok: boolean` with error details when false.
- Pre-init coordinator workspaces (no `.agentxchain/multirepo/`) export successfully with null summary fields.
- Coordinator-level files: config, state, barriers, history, decision ledger, barrier ledger.

### Export Verification

- New `agentxchain verify export <file>` command validates export artifact integrity.
- Verifies JSON structure, schema version, file entry completeness, `content_base64` → `sha256` re-derivation, and `bytes` consistency.
- Coordinator verification recurses into child repo exports.
- Exit codes: `0` pass, `1` integrity/structure fail, `2` input/command error.

### Evidence

- 652 Vitest tests (36 files) + 1437 node --test (327 suites), 0 failures.
- Website production build passes.

## 2.5.0

Remote MCP transport. Governed agents can now run over network via streamable HTTP, completing the MCP connector story for both local and remote deployment.

### Remote MCP Transport (streamable HTTP)

- New `streamable_http` transport for the `mcp` runtime type. Governed MCP agents can now run over HTTP in addition to local stdio.
- Transport selection via `transport` config field (defaults to `stdio`). Remote mode requires an absolute `http` or `https` `url`.
- Optional static `headers` map for remote requests (API keys, auth tokens, custom metadata).
- Config validation enforces mode-specific fields: stdio rejects `url`/`headers`, remote rejects `command`/`args`/`cwd`.
- `step` command prints the real transport target (stdio command vs HTTP URL) instead of hard-coding stdio.
- Documented `Accept: application/json, text/event-stream` requirement for streamable HTTP servers.

### Remote MCP Example

- New `examples/mcp-http-echo-agent/` reference server: stateless streamable HTTP MCP server implementing the same 13-argument `agentxchain_turn` tool contract as the stdio variant.
- Configurable port (`--port` flag or `PORT` env), `/mcp` endpoint, 404/405 for invalid paths/methods.
- Contract test proves: tool name parity, argument parity, `structuredContent` return, live MCP initialize response, docs coverage.
- Governed dispatch proof uses the real shipped HTTP example server as a subprocess, not an inline mock.

### Docs

- Adapter deep-dive updated with `streamable_http` config, transport comparison table (stdio vs HTTP examples), remote headers, and SSE non-support.
- Governed-todo-app README documents both stdio and remote MCP wiring paths with complete config examples.

### Evidence

- 652 Vitest tests (36 files) + 1394 node --test (317 suites), 0 failures.
- Website production build passes.

## 2.4.0

MCP runtime adapter, template validation layer, and library template. First governed connector beyond local_cli and api_proxy.

### MCP Runtime Adapter

- New `mcp` runtime type for governed turns over Model Context Protocol stdio transport.
- Single-tool dispatch: agent receives all 13 governed arguments via `agentxchain_turn` tool call, returns a turn result via `structuredContent` or JSON text.
- SDK wrapper unwrapping: nested `@modelcontextprotocol/sdk` `TextContent.text` envelopes are extracted automatically.
- Configurable tool name, command, args, environment, working directory, and timeout (default 20 minutes).
- Provider-agnostic: any MCP-compatible server can serve governed turns regardless of the underlying model.
- Reference implementation: `examples/mcp-echo-agent/` with validator-clean no-op payloads.
- Governed proof: MCP adapter → turn result validation → CLI `step` auto-accept demonstrated end-to-end in the `governed-todo-app` example.

### Template Validation

- New `agentxchain template validate [--json]` command for operator-facing template contract proof.
- Registry validation: every registered template ID must have a manifest, every manifest must be registered.
- Project binding validation: configured template must exist in the registry.
- Planning artifact completeness: validates that all `planning_artifacts[].filename` entries exist on disk.
- Acceptance hint completion: checks `.planning/acceptance-matrix.md` for `- [x]` completion status (warning-level, not blocking).
- `agentxchain validate` also surfaces template contract results.

### Library Template

- New `library` governed template for reusable package projects alongside `generic`, `api-service`, `cli-tool`, and `web-app`.
- Planning artifacts: `public-api.md`, `compatibility-policy.md`, `release-adoption.md`.
- Prompt guidance biases PM/dev/QA toward exported-surface stability, compatibility promises, and consumer install/import proof.

### Docs Hardening (continued)

- Adapter docs updated with MCP runtime contract, tool argument table, config fields, and example linkage.
- Plugin docs contract spec fixed for stale references.
- Template docs now code-backed against template manifests for all 5 template IDs.

### Evidence

- 648 Vitest tests (36 files) + 1364 node --test (310 suites), 0 failures.
- Website production build passes.
- Removed `.DS_Store` and `cli/node_modules/.package-lock.json` from git tracking (both covered by `.gitignore`).

## 2.3.0

Continuous delivery intake lifecycle and docs truthfulness release. Intake is the first continuous-governed-delivery primitive, and every deep-dive docs page is now held to code-backed behavioral verification.

### Continuous Delivery Intake

- Eight-command intake lifecycle shipped: `record`, `triage`, `approve`, `plan`, `start`, `scan`, `resolve`, `status`.
- Filesystem contract: `.agentxchain/intake/{events,intents,observations}/` with structured event sourcing.
- State machine: `detected → triaged → approved → planned → executing → completed/blocked/failed`, plus `suppressed` and `rejected` exits.
- `intake start` bootstraps a new governed run from idle state or resumes a paused run (no pending gates).
- `intake scan` ingests deterministic source snapshots with per-item deduplication and all-rejected aggregate failure.
- `intake resolve` maps execution outcomes (`completed`, `blocked`, `failed`) to governed run fields including `run_blocked_recovery` and `run_failed_at`.
- `.agentxchain/intake/` excluded from repo observation — orchestrator-owned operational state.
- CLI-subprocess E2E acceptance proof covers the full `record → triage → approve → plan → start → accept-turn → resolve` lifecycle.

### Vitest Steady State

- Vitest coexistence runner at steady state: 36 files, 630 tests across 3 expansion slices (pure-unit, docs-content/contract, coordinator).
- `vitest-slice-manifest.js` is the single source of truth for the Vitest include list.
- Repo-local `vitest-node-test-shim.js` resolves `node:test` → `vitest` hook incompatibility.
- Both runners exercise the same files: `test:vitest` (630 tests) + `test:node` (1285 tests).

### OpenAI API Proxy Support

- `api_proxy` adapter now supports `provider: "openai"` for synchronous `review_only` governed turns via OpenAI Chat Completions API.
- Provider-specific request building: developer/user message mapping, `response_format: { type: "json_object" }`, `max_completion_tokens`.
- Provider-specific error classification: `invalid_api_key`, `model_not_found`, rate limits, context overflow.
- Provider-specific usage telemetry: `prompt_tokens` / `completion_tokens` mapped to existing cost object.
- Config validation rejects OpenAI + `preflight_tokenization` (no OpenAI `provider_local` tokenizer in-repo).
- Scope: Chat-Completions-only JSON output. Responses API, tool use, background execution, and write-capable roles remain out of scope.

### Docs Truthfulness Hardening

- **CLI reference audits:** Fixed 15 ghost/missing flags across governance commands, added missing `intake` and `multi` command families to the command map, and shipped a meta-guard for command-map completeness.
- **Adapter deep-dive rewrite:** Fixed 12 defects including 3 fabricated sections (TypeScript adapter interface, fabricated multi-provider claims, per-HTTP-status retry schedules). All transport modes, error classes, retry policy, and provider support now verified against implementation. (Note: real OpenAI support was subsequently implemented and documented — see above.)
- **Protocol deep-dive rewrite:** Fixed default phase name (`qa` not `verification`), schema version split, queued-vs-pending gate lifecycle, objection enforcement scope, migration semantics.
- **Multi-repo deep-dive:** New `/docs/multi-repo` page with truthful workspace contract, artifact layout, barrier model, hook phases, and recovery model. Config filename corrected from fabricated `coordinator.yaml` to shipped `agentxchain-multi.json`.
- **Intake deep-dive rewrite:** Fixed paused-state behavioral lie, documented idle bootstrap, added resolve outcome fields (`run_blocked_recovery`, `run_failed_at`), documented all-rejected scan failure rule.
- **Templates deep-dive:** Upgraded from string-presence guard to code-backed contract test against template manifests.
- **Plugin docs:** Removed ghost `--from` flag, ghost `--force` prose claim, added flag tables for all 4 subcommands.
- 10 dedicated docs guard tests plus the command-map completeness meta-guard, all reading implementation source files for bidirectional verification.

### Documentation

- Retired `website/` flat HTML directory. `website-v2/` Docusaurus is the sole docs source.
- Protocol implementor guide with progressive conformance adoption.
- Surface claims in `capabilities.json` enforced by the protocol verifier when present.

### Evidence

- 639 Vitest tests (36 files) + 1295 node --test (299 suites), 0 failures.
- Website production build passes.
- Postflight install smoke test hardened for CI OIDC auth isolation.

## 2.2.0

Protocol conformance release. The governed protocol is now testable by any implementation, not just the reference CLI.

### Protocol Conformance Kit

- `agentxchain verify protocol` validates any implementation against the canonical protocol spec via a portable fixture corpus.
- 53 golden I/O fixtures across 3 tiers: Tier 1 (core constitutional — state machine, turn result validation, gate semantics, decision ledger, history, config schema), Tier 2 (trust hardening — dispatch manifest integrity, hook audit), Tier 3 (multi-repo coordination).
- Adapter bridge model (`stdio-fixture-v1`): implementations provide a single adapter command declared in `capabilities.json`. The validator feeds fixture JSON on stdin, receives result JSON on stdout. Implementation-agnostic by design.
- Conformance report with per-tier and per-surface pass/fail/error breakdown in JSON or text format.
- Exit semantics: `0` = pass, `1` = fixture failure, `2` = execution/config/adapter error.
- Reference adapter included: the CLI self-validates all 53 fixtures as part of CI.

### Conformance CI Enforcement

- CI now runs `agentxchain verify protocol --tier 3` on every PR. Protocol conformance cannot regress silently.

### Documentation

- `verify protocol` documented in CLI reference, quickstart, and README.
- Conformance fixture format, adapter contract, and capabilities schema documented in the conformance corpus README.

### Website

- Migrated docs from hand-written static HTML to Docusaurus with MDX, dark mode, and sidebar navigation.
- Deployed to GCS with two-tier cache strategy: hashed assets (1yr immutable), HTML (5min browser / 1min CDN edge).
- Landing page updated with long-horizon coding, lights-out software factories, and explicit .dev/.ai platform split framing.
- VISION.md updated to match website content.

## 2.1.1

Patch release to fix the npm publication path for the `2.1.x` line.

- Configure the GitHub Actions publish workflow with the npm registry URL required for trusted publishing.
- Make `publish-from-tag` tests hermetic under GitHub Actions so `setup-node` auth environment does not cause false failures during release preflight.

## 2.1.0

Trust-hardening and operator-visibility release on top of the v2 governed coordination base.

### Dispatch Manifest Integrity

- Finalized dispatch bundles now write `MANIFEST.json` with bundle identity plus per-file SHA-256 digest and byte size.
- Adapters verify finalized bundles before execution and fail closed on unexpected files, missing files, digest mismatch, or size mismatch.
- Coordinator dispatch protection now covers finalized directory integrity, not only rollback of modified existing files.

### HTTP Hooks And Plugin Hardening

- Hooks now support `"type": "http"` with JSON POST transport, timeout enforcement, env-backed header interpolation, and allow/warn/block verdict parity with process hooks.
- Plugin `config_schema` is now enforced during install/load rather than treated as passive metadata.
- Plugin upgrades are first-class and atomic: success replaces prior state, failure restores the prior installation and hook config.

### Dashboard Evidence Drill-Down

- Timeline cards now expand into turn detail panels with hook annotations and nearby hook-audit context.
- Decision ledger adds phase/date filtering and objection visibility.
- Hook audit log adds phase, verdict, and hook-name filters.
- Dashboard remains read-only; the release improves audit depth, not mutation authority.

## 2.0.0

This release subsumes all features from the unpublished `0.9.0`, `1.0.0`, and `1.1.0` development milestones.

### Multi-Repo Orchestration

- **Coordinator governance for multi-repo initiatives:** `agentxchain multi init` bootstraps a coordinator from `agentxchain-multi.json`. `multi step` dispatches to repo-scoped workstreams with automatic resync-before-assignment and gate request. `multi status` and `multi status --json` expose coordinator state. `multi approve-gate` unifies phase transition and completion approval. `multi resync` provides manual divergence recovery.
- **Cross-repo context injection:** dispatches include `COORDINATOR_CONTEXT.json` with upstream repo state, acceptance projections, and barrier evaluations so agents in one repo have visibility into progress across the initiative.
- **Context invalidation signals:** `after_acceptance` hook payloads include `context_invalidations` listing which downstream repos have stale cross-repo context after a new acceptance.
- **Coordinator hooks:** `before_assignment`, `after_acceptance`, `before_gate`, and `on_escalation` fire at real CLI lifecycle boundaries with blocking/advisory semantics. Hook scope enforcement covers both coordinator-owned and repo-local orchestrator files with pre-hook snapshot and post-hook tamper rollback.

### Dashboard Multi-Repo Integration

- **7-view local dashboard:** adds coordinator `initiative` and `cross-repo` views alongside the 5 repo-local panels. Gate and blocked views are dual-mode — they render coordinator state when authoritative. Dashboard bridge serves coordinator state under `/api/coordinator/*` with relative-path invalidation keys.

### Plugin System Phase 1

- **Plugin lifecycle:** `agentxchain plugin install <path|npm-package>`, `plugin list`, `plugin remove`. Manifest-driven (`agentxchain-plugin.json`) with phase-scoped hook-name collision protection, path rewriting for installed hooks, and metadata-driven removal that preserves unrelated hook bindings. Failed installs leave no filesystem drift.
- **Built-in plugins:** `@agentxchain/plugin-slack-notify` (advisory webhook notifications on acceptance, gate, and escalation) and `@agentxchain/plugin-json-report` (timestamped lifecycle artifacts under `.agentxchain/reports/`).

### Protocol v6

- **Constitutional document for multi-repo governance:** `PROTOCOL-v6.md` specifies coordinator state files, history events, gate semantics, cross-repo context generation, context invalidation signals, and coordinator hook payload contracts. Published at `/docs/protocol.html` and `/docs/protocol-v6.html`.

### Documentation

- Full static docs site: quickstart, adapters, CLI reference, plugins, protocol (v5 historical + v6 current).
- All 6 docs pages share consistent nav, sidebar, and footer.
- Drift guard tests enforce alignment between specs, published HTML, README links, and planning docs.

## 1.1.0

### New Opt-In Features

These features require explicit configuration. A v1.0.0 config file with no new fields runs identically under v1.1 — no silent behavior changes.

- **Parallel agent turns:** assign up to 4 concurrent governed turns per phase via `max_concurrent_turns` in phase config (default: `1`, preserving v1.0 sequential behavior). Includes turn-scoped dispatch isolation, acceptance serialization with lock/journal, file-level conflict detection at acceptance, and two operator-chosen conflict recovery paths (`reject-turn --reassign` and `accept-turn --resolution human_merge`).
- **Auto-retry with backoff (`api_proxy`):** enable via `retry_policy.enabled = true` on a runtime config block. Adapter-local only — does not create governed turns or mutate governed attempt counters. Bounded exponential backoff with jitter. `api-retry-trace.json` audit artifact on retry. Success-path cost aggregates usage across all attempts.
- **Preemptive tokenization (`api_proxy` + Anthropic):** enable via `preflight_tokenization.enabled = true` with a required `context_window_tokens` value. Local token budgeting and bounded compression before dispatch. Fails locally with `context_overflow` when over budget, avoiding a paid API call. Audit artifacts: `TOKEN_BUDGET.json` and `CONTEXT.effective.md`.

### Automatic Precision Improvements

These are active by default and improve error classification and state visibility without changing operator-required actions.

- **Anthropic provider-specific error mapping:** provider-native error type extraction runs before the HTTP-status fallback. New error classes: `invalid_request`, `provider_overloaded`. Daily/spend 429s classified as `rate_limited` but non-retryable. `provider_error_type` and `provider_error_code` preserved in `api-error.json`. Unknown structured provider errors fall back to HTTP classification while preserving provider fields.
- **Persistent blocked state:** `blocked` is a first-class `state.json` status alongside `idle`, `active`, `paused`, `completed`, `failed`. Required `blocked_reason` descriptor on entry. Enters `blocked` on accepted `needs_human`, retry exhaustion, or surfaced dispatch failure. `paused` survives only for explicit human approval gates (phase transitions, run completion). Legacy `paused + human:*` / `paused + escalation:*` states migrate in-place to `blocked` on read. Recovery via `step --resume`.

### Schema And State Changes

- `schema_version` bumped from `"1.0"` to `"1.1"`.
- v1.1 reads and migrates `"1.0"` state files in place (backward compatible). v1.0 does NOT read `"1.1"` state files.
- Migration: `current_turn` → `active_turns` map, legacy paused states → `blocked`, version stamp updated.
- v1.1 rejects unknown `schema_version` values with a clear error (forward compatibility guard).

### CLI Surface Changes

- `step --resume --turn <id>` for targeted resume when multiple turns are active.
- `accept-turn --turn <id>` and `reject-turn --turn <id>` for targeted acceptance/rejection.
- `reject-turn --turn <id> --reassign` for conflict-caused re-dispatch with structured conflict context.
- `accept-turn --turn <id> --resolution human_merge` for operator-merged conflict resolution.
- `status` and `status --json` render multiple active turns, conflict state, and blocked banners.
- Ambiguous commands (e.g. `step --resume` with multiple active turns and no `--turn`) fail with guidance.

### Dispatch And Staging

- All dispatch bundles now use turn-scoped paths: `.agentxchain/dispatch/turns/<turn_id>/` and `.agentxchain/staging/<turn_id>/turn-result.json`, even in sequential mode.
- `dispatch/index.json` is the operator-visible manifest for active dispatch bundles.

## 1.0.0

- Finalized the governed v4 protocol as the canonical CLI surface: orchestrator-owned `.agentxchain/state.json`, structured turn results, append-only `history.jsonl` and `decision-ledger.jsonl`, gate-driven phase progression, and explicit completion approval.
- Shipped the full governed turn lifecycle across the CLI: `init --governed`, `migrate`, `status`, `resume`, `step`, `accept-turn`, `reject-turn`, `approve-transition`, `approve-completion`, and `validate --mode turn`.
- Froze the dispatch contract around turn-scoped bundle paths with retry-aware redispatch, rejected-attempt preservation, and warning-bearing degraded context handling.
- Added the governed validation pipeline as a release contract: structural schema checks, assignment identity checks, observed artifact validation, verification normalization, and protocol-compliance enforcement.
- Completed the v1 adapter surface: `manual` polling, `local_cli` subprocess dispatch, and `api_proxy` synchronous review-only execution.
- Added typed `api_proxy` recovery classification for missing credentials, auth failure, rate limits, model resolution errors, context overflow, network/timeout failures, response parsing failures, and turn-result extraction failures, with `api-error.json` audit artifacts.
- Proved the governed lifecycle through automated end-to-end coverage for the happy path and reject/retry path, alongside CLI-level guards for malformed config rejection and concurrent turn prevention.
- Added strict release preflight mode for the post-bump cut gate, with script-level coverage for dirty-tree, version, and failure-propagation behavior.
- Expanded the planning/spec package to 13 governed v1 artifacts covering CLI, types, state machine, dispatch bundle, operator recovery, adapter contracts, e2e flows, API error recovery, and release gating.

## 0.9.0

- Introduced governed protocol mode with orchestrator-owned `state.json`, phase routing, and gate enforcement.
- Added the full governed turn lifecycle: assign, dispatch, validate, accept, reject, retry, and escalation.
- Added three governed adapter classes: `manual`, `local_cli`, and `api_proxy`.
- Added recovery descriptors across operator surfaces so blocked states expose `typed_reason`, `owner`, `recovery_action`, and `turn_retained`.
- Added phase transition approvals and run-completion approval flows with explicit human sign-off.
- Added the operator recovery contract and blocked-state coverage for validation failures, human pauses, dispatch failures, and retry exhaustion.
- Expanded automated CLI coverage for governed flows, including 115+ tests and focused recovery-surface tests.
