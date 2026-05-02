# Release Notes

## User Impact

This release adds **structured recovery classification** to governance reports. Operators monitoring governed runs now get categorized visibility into recovery events across four domains (ghost, budget, credential, crash) with per-domain statistics, severity tracking, and a health score.

- **Recovery Classification in governance reports:** Text, markdown, and HTML governance reports now include a "Recovery Classification" section showing:
  - Overall health score (`healthy`, `degraded`, `critical`)
  - Total recovery event count with outcome breakdown (recovered, exhausted, manual, pending)
  - Per-domain breakdown table (Ghost, Budget, Credential, Crash)
  - Chronological recovery event timeline with domain, severity, outcome, mechanism, and summary

- **Automatic event classification at emit-time:** All 8 recovery event types (`auto_retried_ghost`, `ghost_retry_exhausted`, `auto_retried_productive_timeout`, `productive_timeout_retry_exhausted`, `budget_exceeded_warn`, `retained_claude_auth_escalation_reclassified`, `continuous_paused_active_run_recovered`, `session_failed_recovered_active_run`) are automatically classified when emitted to `events.jsonl`, embedding domain/severity/outcome/mechanism metadata directly in event payloads.

- **Severity escalation:** Ghost retry exhaustion with same-signature repeats escalates to `critical` severity. Budget warnings with zero remaining USD escalate to `high`. This surfaces systemic recovery failures prominently.

- **Health score:** Provides at-a-glance assessment — `critical` when any event is critical-severity or more events exhausted than recovered, `degraded` when any exhausted/manual outcomes exist, `healthy` otherwise.

- **Coexists with existing recovery summary:** The new classification section appears alongside the existing `recovery_summary` snapshot — no breaking changes to existing report consumers.

## Verification Summary

- Full suite: 664 test files, 7382 tests, 0 failures — independently run to completion by QA
- All 8 recovery event type classifications verified against SYSTEM_SPEC §1.2 mapping table
- Severity escalation rules verified against SYSTEM_SPEC §1.3
- Health score derivation verified against SYSTEM_SPEC §2.1
- Text, markdown, and HTML rendering independently reviewed for correctness, escaping, and bounded output
- AGENT-TALK guard tests pass 8/8
- No whitespace issues (`git diff --check` clean)
- ROADMAP.md M4 item "Add structured recovery classification" checked off with run evidence
