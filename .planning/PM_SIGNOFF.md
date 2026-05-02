# PM Signoff — M4: Structured Recovery Classification in Governance Reports

Approved: YES

**Run:** `run_5276bd12be02449a`
**Phase:** planning
**Turn:** `turn_ced5f60086d919bc`
**Date:** 2026-05-02

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators monitoring governed and continuous runs who need visibility into which recovery domains are firing, whether auto-recovery succeeds, and when manual intervention is required.

### Core Pain Point

Recovery events (ghost retries, budget exhaustion, credential failures, crash recovery) are emitted to `events.jsonl` but governance reports show only a single blocked-state snapshot via `recovery_summary`. Operators cannot see the full recovery history, cannot distinguish transient retries from systemic failures, and have no per-domain aggregation to guide M4 hardening prioritization.

### Root Cause

Recovery events were added incrementally across M1, BUG-FIX, and various improvements without a classification taxonomy. Each event type has its own payload structure with no common schema. The report layer (`report.js`) only reads `blocked_reason.recovery` from the current state — it never reads the event timeline for recovery history.

### Core Workflow

1. PM (this turn) — Designs classification taxonomy, charters dev with file-level scope
2. Dev — Implements `recovery-classification.js` module, integrates into `report.js`, enhances event payloads in `continuous-run.js`, writes tests
3. QA — Validates classification correctness, report output, and test coverage

### MVP Scope (this run)

**PM deliverables (this turn):**
1. SYSTEM_SPEC.md: Full feature spec with taxonomy, event mapping, interface contracts
2. Dev charter: implementation scope with 5 files (2 new, 3 modified)
3. Clear boundary: new classification coexists alongside existing `recovery_summary`

**Dev deliverables:**
1. `cli/src/lib/recovery-classification.js` — `classifyRecoveryEvent()` + `buildRecoveryClassificationReport()`
2. `cli/src/lib/report.js` — `extractRecoveryClassification()` + text/markdown format sections
3. `cli/src/lib/continuous-run.js` — `recovery_classification` field in 8 event payloads
4. `cli/test/recovery-classification.test.js` — unit tests for classification + aggregation
5. `cli/test/report.test.js` — test for report output section

### Out of Scope

- New event types in `run-events.js` (reuses existing 8 recovery events)
- Changing existing `recovery_summary` behavior
- Emitting events for gaps not yet covered (G-BUDGET-3 budget recovery success — separate M4 item)
- Dashboard integration (M6)
- HTML report format (optional stretch for dev)
- Cold-start resume of failed sessions
- Fixing any of the 17 audited gaps (separate M4 items)

### Success Metric

1. `classifyRecoveryEvent()` correctly classifies all 8 recovery event types
2. `buildRecoveryClassificationReport()` produces per-domain aggregation with health score
3. Governance report text output includes "Recovery Classification:" section
4. All tests pass (`npm run test`)
5. ROADMAP.md:61 checked off

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Classification mapping doesn't cover future event types | Low | Function returns `null` for unrecognized events; adding new types is additive |
| Report section adds noise when no recovery events exist | Low | Section omitted entirely when `total_recovery_events === 0` |
| Payload enhancement breaks existing event consumers | Low | `recovery_classification` is a new additive field; no existing fields changed |
| Health score thresholds are wrong for operators | Low | Score is informational only; thresholds can be tuned in follow-up |

## Challenge to Previous Work

### OBJ-PM-001: Previous 3 turns reused stale audit artifacts (severity: high)

The prior turns in this run (`non_progress_count: 3`) attempted to fast-track through planning by reusing artifacts from the completed audit run (`run_24a851cc6e95d841`). The PM_SIGNOFF.md and SYSTEM_SPEC.md described audit scope (verification-only, no code changes) while the actual intent requires implementing a new feature (classification module, report integration, event enhancement). The gate failure on `## Interface` was a symptom — the real problem was that planning was never done for this intent.

This turn rewrites all three planning artifacts from scratch for the actual charter: "Add structured recovery classification to governance reports."

### OBJ-PM-002: Recovery events lack common classification schema (severity: medium)

The 8 recovery event types use inconsistent payload structures. Ghost events include `failure_type`, `attempt`, `diagnostic_bundle`; budget events include `spent_usd`, `remaining_usd`; credential events include `previous_blocked_on`. No common field identifies the recovery domain or outcome. This feature introduces that common layer without changing existing fields.

## Notes for Dev

**Your charter is implementation:**

Create `cli/src/lib/recovery-classification.js` with two exported functions per SYSTEM_SPEC.md Section 2.1. Integrate into `report.js` per Section 2.2. Add `recovery_classification` to 8 event payloads in `continuous-run.js` per Section 2.3.

The 8 event-to-classification mappings are specified in SYSTEM_SPEC.md Section 1.2. The severity escalation rules (Section 1.3) require reading payload fields — e.g., `exhaustion_reason === 'same_signature_repeat'` escalates ghost exhaustion severity to `critical`.

**Key implementation detail:** `classifyRecoveryEvent()` must be a pure function (no I/O). Import it into `continuous-run.js` to embed classification at emit-time, and into `report.js` to re-derive classification from historical events (for reports on runs that predate the payload enhancement).

**Test expectations:**
- `recovery-classification.test.js`: test each of the 8 event types, test non-recovery event returns null, test aggregation, test all 3 health scores, test severity escalation
- `report.test.js`: test that text output includes "Recovery Classification:" header and per-domain lines

## Notes for QA

- Verify dev's classification logic matches SYSTEM_SPEC.md Section 1.2 mapping exactly
- Verify severity escalation rules from Section 1.3
- Verify health score derivation: healthy (all recovered/pending), degraded (any exhausted/manual), critical (severity critical OR exhausted > recovered)
- Verify report output omits section when no recovery events exist
- Run `npm run test` — all tests including new ones must pass
- Verify no existing tests broken by the new `recovery_classification` payload field

## Acceptance Contract

1. **Roadmap milestone addressed:** M4: Recovery & Resilience Hardening
2. **Unchecked roadmap item completed:** Add structured recovery classification to governance reports — checked `[x]` at ROADMAP.md:61
3. **Evidence source:** .planning/SYSTEM_SPEC.md (full feature spec), `cli/src/lib/recovery-classification.js` (implementation), `cli/test/recovery-classification.test.js` (test evidence)
