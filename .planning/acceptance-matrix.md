# Acceptance Matrix — agentXchain.dev

**Run:** run_5276bd12be02449a
**Turn:** turn_b50e6c4ea35c242d (QA)
**Scope:** M4 Structured Recovery Classification — new classification module, emit-time enrichment, governance report rendering (text/markdown/HTML)

## Section A: SYSTEM_SPEC Acceptance Tests

| Req # | Requirement (from SYSTEM_SPEC.md §Acceptance Tests) | Evidence | Status |
|-------|------------------------------------------------------|----------|--------|
| AC-001 | `classifyRecoveryEvent()` correctly classifies all 8 recovery event types by domain/severity/outcome/mechanism | `recovery-classification.test.js` "classifies each supported recovery event type" — exercises all 8 event types against SYSTEM_SPEC §1.2 mappings. QA verified source at `recovery-classification.js:4-61` matches spec table exactly. | PASS |
| AC-002 | `buildRecoveryClassificationReport()` produces correct per-domain aggregation and health score from a mixed event set | `recovery-classification.test.js` "aggregates mixed recovery events and derives health scores" + "returns healthy for zero or non-exhausted recovery events and critical for systemic exhaustion". QA verified `buildRecoveryClassificationReport` at lines 109-158 matches spec §2.1 health score derivation rules. | PASS |
| AC-003 | `formatGovernanceReportText()` output includes "Recovery Classification:" section with per-domain breakdown when recovery events exist | `recovery-classification.test.js` "adds recovery classification to run subject and text, markdown, and html reports". QA verified text rendering at `report.js:1558-1576` — includes Health, Events, By Domain, and Timeline sections. | PASS |
| AC-004 | Recovery event payloads include `recovery_classification` field | Dev centralized at `run-events.js:77-80` (DEC-001) instead of 8 individual call sites in `continuous-run.js`. `run-events.test.js` "adds recovery_classification to recognized recovery event payloads" confirms payloads contain the field. QA verified the code — `classifyRecoveryEvent()` is called at emit-time and result is merged into payload when not already present. Architecturally superior to spec's 8-callsite approach. | PASS |
| AC-005 | `npm run test` passes with no regressions | Full suite: 664 test files, 7382 tests, 0 failures. QA independently ran full `npm test` to completion. | PASS |

## Section B: Code Correctness Verification

| Check | Detail | Status |
|-------|--------|--------|
| 8 event-to-classification mappings match SYSTEM_SPEC §1.2 | QA compared `EVENT_CLASSIFICATIONS` object (recovery-classification.js:4-61) against SYSTEM_SPEC table line by line. All 8 rows match: domain, default severity, outcome, mechanism. | PASS |
| Severity escalation rules match SYSTEM_SPEC §1.3 | `escalateSeverity()` at lines 69-77: (1) ghost exhaustion with `same_signature_repeat` → `critical`, (2) budget with `remaining_usd <= 0` → `high`. Both match spec. | PASS |
| Health score derivation matches SYSTEM_SPEC §2.1 | Lines 146-149: `critical` when any severity is critical OR exhausted > recovered; `degraded` when any exhausted or manual; `healthy` otherwise. Matches spec exactly. | PASS |
| Report output null-guarded for no recovery events | `extractRecoveryClassification` at line 707-709 returns null when `total_recovery_events === 0`. All three renderers guard with `if (run.recovery_classification)`. | PASS |
| Emit-time enrichment is idempotent | `run-events.js:78` checks `!payload.recovery_classification` before adding — will not overwrite existing classification if somehow already present. | PASS |
| Module exports are pure functions | `recovery-classification.js` has no I/O, no side effects, no imports except built-in data structures. Confirmed pure. | PASS |
| Markdown pipe escaping | `report.js:2190` escapes `|` chars in timeline summaries for markdown table safety. | PASS |
| HTML escaping | `report.js:2940-2955` uses `esc()` for all user-derived content in HTML tables. | PASS |
| Timeline sort correctness | `recovery-classification.js:136-143`: sorts by timestamp (NaN → +Infinity for stable ordering), breaks ties by event_id. | PASS |
| Bounded output | Text, markdown, and HTML renderers use `boundedSlice()` for timeline — prevents unbounded output in large event sets. | PASS |

## Section C: Regression Suites (QA-Verified)

| Suite | Count | Result |
|-------|-------|--------|
| recovery-classification.test.js | 7 | PASS |
| run-events.test.js | 13 | PASS |
| report-cli.test.js | 15 | PASS |
| report-html.test.js | 12 | PASS |
| governance-report-content.test.js | 17 | PASS |
| continuous-run.test.js | 76 | PASS |
| budget-warn-mode.test.js | 8 | PASS |
| e2e-budget-warn-mode.test.js | 16 | PASS |
| product-examples-contract.test.js | 22 | PASS |
| vitest-contract.test.js | 11 | PASS |
| claim-reality-preflight.test.js | 38 | PASS |
| agent-talk-word-cap.test.js | 8 | PASS |
| **Full suite total** | **7382** | **0 failures** |

## Section D: Dev Challenge

**Architecture deviation (DEC-001):** Dev centralized recovery classification at `emitRunEvent()` in `run-events.js` rather than modifying 8 call sites in `continuous-run.js` as charted. **QA agrees this is a superior design:** single insertion point eliminates the risk of missing a call site, applies classification to all future recovery events automatically, and keeps `continuous-run.js` unchanged (smaller diff, lower regression risk).

**Test location deviation:** SYSTEM_SPEC §Dev Charter item 6 says add report test in `report.test.js`. Dev placed it in `recovery-classification.test.js` under "governance report recovery classification" describe block. Functionally equivalent — the test exercises the full pipeline including `report.js` rendering. QA accepts this.

**Verification blocker fixes:** Dev fixed 3 pre-existing test infrastructure issues (product-examples Node 25 discovery, Vitest file count, BUG-46 timeout). These are non-functional changes to test scaffolding, not to production code. QA independently verified these suites pass.
