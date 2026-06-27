# Implementation Notes — M14: Shippability Visibility — Vision Closure (VISION.md:50)

**Run:** `run_322ba900566dddfe`
**Turn:** `turn_9ce54587bc5981c1`
**Role:** dev
**Runtime:** `local-opus-4.8-ultra`
**Date:** 2026-06-27

## What Was Built

`cli/src/lib/ship-status.js` — a read-only **composition** layer that answers "is this ready to ship?" by composing five independent evidence dimensions into a single `ShipStatusReport`, surfaced through the `agentxchain ship-status` CLI command, coordinator aggregation, and the governance report.

This implementation **corrects a prior in-progress attempt** that was on disk at the start of this turn (see "Challenge to Previous Work"). The prior version was miswired against the real governed data shapes and would have failed the SYSTEM_SPEC's own acceptance tests.

## Challenge to Previous Work

The prior on-disk `ship-status.js` had four defects, each verified against live data before replacement:

1. **`phase_gate_status` read as objects.** Real values are strings (`"passed"`/`"pending"`/`"failed"`), but the prior code did `val?.outcome || val?.status` on a string → always empty → gate-clearance and qa-verdict dimensions could never detect pass/fail. (Verified: `.agentxchain/state.json` `phase_gate_status` is `{ "planning_signoff": "passed", ... }`.)
2. **Run completion keyed on `state.phase`.** It matched `phase` against a terminal-phase set (`completed`/`done`/`shipped`/…) that does not exist in this protocol (phases are `planning`/`implementation`/`qa`). Completion is `state.status === 'completed'`. The prior dimension also had **no `fail` branch**, making AT-SS-003 (run failed → fail) impossible.
3. **Ship verdict reimplemented with the wrong format.** It matched `verdict: ship` / `# ship`, but the real affirmative format is `## Verdict: YES` (set `{YES, SHIP, SHIP IT}`). The PM turn explicitly corrected the pointer to the exported `evaluateWorkflowGateSemantics(root, SHIP_VERDICT_PATH)`; the prior code ignored it (violating Architecture Invariant #1).
4. **Coordinator repo discovery iterated `config.repos` as an array.** The normalized shape is an object keyed by id with a `repo_order` array; `for…of` over it throws → caught → empty → coordinator always returned empty/pending. AT-SS-009/010 were impossible.

The good idea from the prior attempt — deriving the report's `ship_status` from the **export artifact** rather than the live repo — was kept and made correct (the prior version mis-read `artifact.files[path]` as a string when it is `{ data | content_base64 }`).

## Evidence Dimensions (verified compose-target APIs)

1. **Run completion** — `state.status`: `completed` → pass; `failed`/`blocked`/`idle` → fail; `active`/`running`/`needs_human`/unknown → pending.
2. **QA ship verdict** — live: `evaluateWorkflowGateSemantics(root, SHIP_VERDICT_PATH)` from `workflow-gate-semantics.js` (`{ok, reason?}` or `null`). Missing before the final phase → pending; missing at/after the final phase → fail; `## Verdict: YES` → pass; non-affirmative → fail.
3. **Gate clearance** — `state.phase_gate_status` (strings) keyed over `config.gates`. Any `failed` → fail; any not-`passed` → pending; all `passed` → pass.
4. **Release alignment** — `validateReleaseAlignment(root, {})` from `release-alignment.js`. `ok` → pass; `errors` → fail; throws / no release context (pre-release) → pending. The evaluator is **injectable** so the composition is tested without rebuilding release-alignment's ~18 release surfaces (already covered by `release-alignment.test.js`).
5. **Test verification** — `verification.status` across accepted turns from `queryAcceptedTurnHistory(root)`. Any `fail` → fail; any non-`pass`/`attested_pass` → pending; all pass → pass.

**Aggregation (worst-case, Invariant #4):** any `fail` → `fail`; else any `pending` → `pending`; else `pass`.

## Read-only (Invariant #2)

State is read with a direct JSON parse, **not** `loadProjectState`, because the latter can normalize and `safeWriteJson` the state back. A regression test asserts the state file is byte-identical before/after evaluation.

## Files

### New
- **`cli/src/lib/ship-status.js`** — `evaluateShipStatus(repoDir, options)`, `evaluateCoordinatorShipStatus(coordinatorDir, options)`, `buildShipStatusSummary(artifact)`, the five exported dimension evaluators, `aggregateShipStatus`, and `SHIP_STATUS_DIMENSIONS`. `options` allows injecting `context`/`state`/`history`/`releaseAlignmentEvaluator`/`semanticsEvaluator` for testing.
- **`cli/src/commands/ship-status.js`** — `agentxchain ship-status` with `--json`, `--verbose`, `--dir`; coordinator auto-detected via `agentxchain-multi.json`; non-zero exit when overall is `fail`. Presentation only (Invariant #5).
- **`cli/test/ship-status.test.js`** — 21 tests: AT-SS-001…012 plus read-only, pre-release-pending, non-governed, base64/verdict-file artifact paths, and aggregation units.

### Modified
- **`cli/bin/agentxchain.js`** — import + `ship-status` command registration.
- **`cli/src/lib/report.js`** — import `buildShipStatusSummary`; `buildRunSubject()` adds `run.ship_status`; text formatter renders a `Ship Status: YES/NO/PENDING (n/5 dimensions pass)` block with blocking reasons.

## Output Shapes

- `ShipStatusReport`: `{ overall, dimensions: [{ name, status, detail, blocking_reason }], blocking_reasons[], evidence_summary }`
- `CoordinatorShipStatusReport`: `{ overall, repos: [{ repo_id, ship_status }], blocking_repos[], evidence_summary }`
- Report summary (`run.ship_status`): `{ overall, dimensions_passed, dimensions_total, blocking_reasons }`

## Design Decisions

- **DEC-001**: Replace the prior module rather than patch it — four defects touched every dimension's core logic and the public output shapes.
- **DEC-002**: Read state with a direct read-only parse to honor the read-only invariant (avoid `loadProjectState` writeback).
- **DEC-003**: Inject the release-alignment evaluator for tests; the live default calls `validateReleaseAlignment` and degrades to `pending` pre-release.
- **DEC-004**: Keep the artifact-based report integration (`buildShipStatusSummary(artifact)`); release alignment is `pending` from an artifact since the filesystem is not live — the live CLI surfaces it.

## Verification

`npx vitest run test/ship-status.test.js` → 21/21 pass. Report integration suites (`report-cli`, `governance-report-content`, `report-gate-failure`, `report-html`, `workflow-kit-report`, `e2e-builtin-json-report`) → 60/60 pass. Full suite result recorded in the turn result.
