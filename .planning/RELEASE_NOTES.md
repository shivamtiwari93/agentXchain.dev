# Release Notes — M14: Shippability Visibility — Vision Closure (VISION.md:50)

**Run:** run_74d17633499b410b
**Turn:** turn_b7ac694416a751c0 (QA; re-issue after gate rejection of turn_f26ac4b155de15b4)
**Date:** 2026-06-27

## Summary

Formal closure of ROADMAP.md M14: "Shippability Visibility — Vision Closure (VISION.md:50)." A new read-only composition layer, `ship-status.js`, answers the VISION.md:50 coordination failure — "nobody knows what is actually shippable" — by composing five independent evidence dimensions into a single operator-queryable assessment, surfaced through the `agentxchain ship-status` CLI command, coordinator aggregation, and the governance report. The product code was built and committed in prior run `run_322ba900566dddfe`; this run verified it against spec, fixed one real correctness defect in the test-verification dimension, added regression coverage, and closed the milestone.

## What Changed (This Run)

### Fix: Dimension 5 (Test Verification) false-pending — `cli/src/lib/ship-status.js`

`evaluateTestVerificationDimension` previously counted any non-passing `verification.status` — including the legitimate `skipped` status recorded by planning/review turns that run no test gate — toward the pending trigger. A single skipped planning turn would pin `test_verification` to `pending` forever, making a genuinely shippable run report as not-yet-shippable on M14's central signal. Fix: a `NEUTRAL_VERIFICATION = {'skipped'}` set excludes skipped turns from the evidence-bearing population. A `fail` still short-circuits to fail; an all-skipped history stays pending (no positive evidence); a history with at least one passing evidence-bearing turn passes.

### New Tests: AT-SS-013, AT-SS-014 — `cli/test/ship-status.test.js`

- **AT-SS-013** — skipped turns are neutral: `[skipped, pass, skipped]` → `test_verification` pass, overall pass.
- **AT-SS-014** — all-skipped history → `test_verification` pending, overall pending.

Suite grew 21 → 23 tests.

### ROADMAP.md M14 Closed

Build items (lines 160-164) checked off with delivery+verification provenance; acceptance item (line 165) checked off by the QA ship verdict this turn.

## The 5 Evidence Dimensions

| # | Dimension | Source | Pass when |
|---|-----------|--------|-----------|
| 1 | Run Completion | `state.status` | run status is `completed` |
| 2 | QA Ship Verdict | `evaluateWorkflowGateSemantics(root, SHIP_VERDICT_PATH)` | `## Verdict: YES` present |
| 3 | Gate Clearance | `state.phase_gate_status` over `config.gates` | all gates `passed` |
| 4 | Release Alignment | `validateReleaseAlignment()` | all required surfaces aligned |
| 5 | Test Verification | `verification.status` across accepted turns | ≥1 passing evidence-bearing turn, none failed (skipped neutral) |

Aggregation is worst-case: any `fail` → fail; else any `pending` → pending; else `pass`.

## User Impact

- **Vision closure:** VISION.md:50 "nobody knows what is actually shippable" is now addressed. `agentxchain ship-status` answers the question in one command instead of forcing operators to inspect and mentally aggregate run state, QA verdicts, gates, release alignment, and verification evidence.
- **New CLI command:** `agentxchain ship-status [--json] [--verbose]`. Default prints `Ship Status: YES/NO/PENDING (n/5 dimensions pass)` with blocking reasons; `--json` emits the full `ShipStatusReport`; `--verbose` breaks out all 5 dimensions. Non-zero exit when overall is `fail`.
- **Coordinator support:** multi-repo coordinator runs expose per-repo ship readiness with a worst-case overall aggregate.
- **Report integration:** governance reports now carry a ship-status summary section.
- **Correctness:** the Dimension-5 fix means runs whose planning/review turns skipped verification are no longer falsely pinned to pending — the central shippability signal is now trustworthy.
- **No breaking changes:** one defect fix + two tests this run; the composition is read-only and reuses existing evaluators.

## Verification Summary

QA independently ran:
- `npx vitest run test/ship-status.test.js` → **23/23 pass, exit 0**
- `npx vitest run test/ship-status.test.js test/governance-report-content.test.js test/report-cli.test.js test/workflow-kit-report.test.js` → **69/69 pass, exit 0**
- `node cli/bin/agentxchain.js ship-status --verbose` → exit 0, all 5 dimensions composed against live repo state
- `node cli/bin/agentxchain.js ship-status --json` → ShipStatusReport schema validated, exit 0

Result: **6/6 acceptance criteria pass, 5/5 architecture invariants confirmed, 3/3 dev decisions verified, 0 blocking issues.** Limitation declared: the full ~689-file monorepo suite was not run to completion (single-turn timeout); verification scoped to the M14 surface and its report-integration touchpoints. **Ship verdict: YES.**
