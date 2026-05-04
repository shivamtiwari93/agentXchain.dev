# Ship Verdict — M8: Persistent Run History and Governance Audit Trail

**Run:** run_b2a4084d6b3fe3b3
**Turn:** turn_2f903c5a3d12867f (QA)
**Milestone:** ROADMAP.md:97

## Verdict: YES

## QA Summary

8/8 SYSTEM_SPEC acceptance criteria pass (AT-HA-001 through AT-HA-008). All independently verified by QA — no rubber stamp.

## Independent Verification

132 tests across 6 files, 0 failures, 0 regressions:

| Suite | Tests | Result |
|-------|-------|--------|
| org-history-audit.test.js | 8 | PASS |
| org-dashboard.test.js | 8 | PASS |
| hosted-runner.test.js | 11 | PASS |
| vitest-contract.test.js | 11 | PASS |
| dashboard-bridge.test.js | 87 | PASS |
| control-plane-schema.test.js | 7 | PASS |
| **Total** | **132** | **0 failures** |

## Challenge of Dev Turn (turn_f38c631f9df22e69)

All 3 dev spec deviations independently evaluated and approved:

1. **DEC-001 (hook_block → high severity):** Correctly resolves internal spec inconsistency between §2.1.3 and §2.1.4. §2.1.3 maps `verdict === 'block'` to `severity: high` explicitly, while §2.1.4's high-severity list omits `hook_block`. Dev chose the §2.1.3 mapping. Correct.

2. **DEC-002 (run_id identification in AT-HA-008):** Stronger than PM's project_name-based approach — `run_id` is globally unique while `project_name` could collide. Test still verifies cross-project aggregation via `project_id` inequality assertion.

3. **DEC-003 (hook_warn/budget_exceeded_warn → medium severity):** Prevents incorrect low-severity classification for attention-worthy events. `hook_warn` from §2.1.3's `verdict === 'warn'` mapping and `budget_exceeded_warn` from GOVERNANCE_EVENT_TYPES both warrant medium severity.

## Architecture Verification

- **Zero writer changes** — All JSONL writers untouched.
- **Zero new dependencies** — Uses existing `readJsonlFile` from state-reader.js.
- **Aggregation isolation** — Individual project read failures skip silently (3 try/catch blocks per project in getAuditTrail).
- **Existing routes untouched** — All 26 prior hosted runner routes remain identical.
- **Selective event inclusion** — Only 9 decision types, 2 hook verdicts, 8 event types included. Non-governance events (e.g., `turn_dispatched`) correctly excluded.
- **HTML escaping** — Both dashboard components use `esc()` with 5-entity escaping.
- **Vitest contract** — 671 files, 11/11 contract tests pass.

## QA Findings (Non-Blocking)

No new findings. Pre-existing `state.gates` and `cost_tracker` field-name mismatches from run_76ce2c791a84e1cb remain in untouched code — tracked for follow-up, not introduced by this run.

## Open Blockers

None.

## Ship Decision

All acceptance criteria pass. All dev architectural decisions correct and justified. 132 tests, 0 failures, 0 regressions. Three new files + four modifications with zero dependencies, full-fidelity data preservation, unified audit trail from 3 sources, selective governance event inclusion, proper severity classification, dashboard integration with client-side filtering. **SHIP.**
