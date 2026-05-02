# System Spec — M4: Structured Recovery Classification in Governance Reports

**Run:** `run_5276bd12be02449a`
**Baseline:** git:f7322ea1986c8a8262bc3abcfeade4d289cbfafd
**Package version:** `agentxchain@2.155.72`

## Purpose

Add structured recovery classification to governance reports. Currently, recovery events (ghost retries, budget exhaustion, credential failures, crash recovery) are emitted to `events.jsonl` with ad-hoc payloads and the governance report shows only a single `recovery_summary` snapshot from the current blocked state. This feature introduces a classification taxonomy so every recovery event is categorized by domain, severity, outcome, and mechanism — and governance reports include a classified recovery timeline with per-domain statistics.

**Why now:** The M4 audit (run_24a851cc6e95d841) mapped all 17 recovery gaps across 4 domains. Before hardening individual gaps, operators need visibility into which recovery domains are active, which succeed, and which escalate to manual intervention. This classification layer is the observation surface that makes subsequent M4 hardening work measurable.

---

## 1. Recovery Classification Taxonomy

### 1.1 Classification Fields

Every recovery event is classified with four dimensions:

| Field | Type | Values |
|-------|------|--------|
| `domain` | enum | `ghost`, `budget`, `credential`, `crash` |
| `severity` | enum | `low`, `medium`, `high`, `critical` |
| `outcome` | enum | `recovered`, `exhausted`, `manual`, `pending` |
| `mechanism` | enum | `auto_retry`, `env_refresh`, `config_change`, `journal_replay`, `loop_guard` |

### 1.2 Event-to-Classification Mapping

| Event Type | Domain | Default Severity | Outcome | Mechanism |
|---|---|---|---|---|
| `auto_retried_ghost` | ghost | medium | recovered | auto_retry |
| `ghost_retry_exhausted` | ghost | high | exhausted | auto_retry |
| `auto_retried_productive_timeout` | ghost | medium | recovered | auto_retry |
| `productive_timeout_retry_exhausted` | ghost | high | exhausted | auto_retry |
| `budget_exceeded_warn` | budget | medium | pending | config_change |
| `retained_claude_auth_escalation_reclassified` | credential | medium | pending | env_refresh |
| `continuous_paused_active_run_recovered` | crash | medium | recovered | loop_guard |
| `session_failed_recovered_active_run` | crash | medium | recovered | loop_guard |

### 1.3 Severity Escalation Rules

- Ghost retry with `exhaustion_reason: 'same_signature_repeat'` → severity escalates to `critical` (indicates systemic, not transient, failure)
- Budget event where `remaining_usd <= 0` → severity escalates to `high`
- Credential reclassification from `retries_exhausted` → severity stays `medium` (operator action expected)

---

## 2. Implementation Design

### 2.1 New Module: `cli/src/lib/recovery-classification.js`

**`classifyRecoveryEvent(event)`**
- Input: raw event object from `events.jsonl`
- Output: `{ domain, severity, outcome, mechanism }` or `null` if event is not recovery-related
- Pure function, no I/O

**`buildRecoveryClassificationReport(events)`**
- Input: array of raw events from `events.jsonl`
- Output: structured classification report object:
```javascript
{
  total_recovery_events: number,
  by_domain: {
    ghost:      { total, recovered, exhausted, manual, pending },
    budget:     { total, recovered, exhausted, manual, pending },
    credential: { total, recovered, exhausted, manual, pending },
    crash:      { total, recovered, exhausted, manual, pending }
  },
  by_outcome: { recovered, exhausted, manual, pending },
  timeline: [{ event_id, timestamp, event_type, domain, severity, outcome, mechanism, summary }],
  health_score: 'healthy' | 'degraded' | 'critical'
}
```

**Health score derivation:**
- `critical`: any event with severity `critical` OR exhausted count > recovered count
- `degraded`: any `exhausted` or `manual` outcome present
- `healthy`: all recovery events are `recovered` or `pending`, or no recovery events at all

### 2.2 Report Integration: `cli/src/lib/report.js`

**Data extraction:**
- New function `extractRecoveryClassification(artifact)` that calls `buildRecoveryClassificationReport()` on the run's event timeline
- Added to `buildRunSubject()` return value as `recovery_classification` field (alongside existing `recovery_summary`)

**Text format** (`formatGovernanceReportText`): New section after existing "Recovery:" block:
```
Recovery Classification:
  Health: healthy
  Events: 3 total (2 recovered, 1 exhausted)
  By Domain:
    Ghost: 2 (1 recovered, 1 exhausted)
    Budget: 1 (1 recovered)
    Credential: 0
    Crash: 0
  Timeline:
    1. 2026-05-02T09:15Z | ghost | medium | recovered | auto_retry | Ghost turn reissued
    2. 2026-05-02T09:20Z | ghost | high | exhausted | auto_retry | Retry budget depleted
    3. 2026-05-02T09:25Z | budget | medium | recovered | config_change | Budget increased
```

**Markdown format** (`formatGovernanceReportMarkdown`): Same data as table + timeline list.

**HTML format** (`formatGovernanceReportHtml`): Same data rendered in HTML tables.

### 2.3 Event Payload Enhancement: `cli/src/lib/continuous-run.js`

Each of the 8 recovery event `emitRunEvent()` calls gets a `recovery_classification` field added to its payload:

```javascript
payload: {
  ...existing_fields,
  recovery_classification: classifyRecoveryEvent(event)
}
```

This embeds classification at emit-time so downstream consumers (dashboard, export) can use it without re-deriving.

---

## 3. Files Changed

| File | Type | Change |
|------|------|--------|
| `cli/src/lib/recovery-classification.js` | NEW | Classification function + report builder + health score |
| `cli/src/lib/report.js` | MODIFY | Add `extractRecoveryClassification()`, add section to 3 format functions |
| `cli/src/lib/continuous-run.js` | MODIFY | Add `recovery_classification` to 8 recovery event payloads |
| `cli/test/recovery-classification.test.js` | NEW | Unit tests for classification + report builder |
| `cli/test/report.test.js` | MODIFY | Test recovery classification section in report output |

---

## Interface

### Exported API from `recovery-classification.js`

```javascript
/**
 * Classify a single recovery event from events.jsonl.
 * @param {object} event - Raw event object with event_type and payload fields.
 * @returns {{ domain: string, severity: string, outcome: string, mechanism: string } | null}
 *   Returns null if the event is not a recognized recovery event.
 */
export function classifyRecoveryEvent(event)

/**
 * Build an aggregated recovery classification report from an array of events.
 * @param {object[]} events - Array of raw event objects from events.jsonl.
 * @returns {{ total_recovery_events: number, by_domain: object, by_outcome: object, timeline: object[], health_score: string }}
 */
export function buildRecoveryClassificationReport(events)
```

### Governance Report Contract Change

`buildRunSubject()` return value gains a new field:

```javascript
run: {
  ...existing_fields,
  recovery_classification: {
    total_recovery_events: number,
    by_domain: { ghost: {...}, budget: {...}, credential: {...}, crash: {...} },
    by_outcome: { recovered: number, exhausted: number, manual: number, pending: number },
    timeline: [...],
    health_score: 'healthy' | 'degraded' | 'critical'
  } | null  // null when no recovery events exist
}
```

### Recovery Event Payload Contract Change

All 8 recovery event types gain an optional `recovery_classification` field in `payload`:

```javascript
{
  event_type: 'auto_retried_ghost',
  payload: {
    ...existing_payload_fields,
    recovery_classification: { domain: 'ghost', severity: 'medium', outcome: 'recovered', mechanism: 'auto_retry' }
  }
}
```

---

## Dev Charter

### Scope

1. Create `cli/src/lib/recovery-classification.js` with `classifyRecoveryEvent()` and `buildRecoveryClassificationReport()` per Section 2.1
2. Add `extractRecoveryClassification()` to `cli/src/lib/report.js` and integrate into `buildRunSubject()` per Section 2.2
3. Add "Recovery Classification" section to `formatGovernanceReportText()` and `formatGovernanceReportMarkdown()` per Section 2.2 (HTML format is optional stretch)
4. Add `recovery_classification` field to 8 recovery event `emitRunEvent()` calls in `cli/src/lib/continuous-run.js` per Section 2.3
5. Write `cli/test/recovery-classification.test.js` covering:
   - Each of the 8 event types classifies correctly
   - Non-recovery events return null
   - `buildRecoveryClassificationReport()` aggregates correctly from mixed event set
   - Health score derivation: healthy, degraded, critical
   - Severity escalation for signature-repeat ghost exhaustion
6. Add test case in `cli/test/report.test.js` verifying report text output includes "Recovery Classification:" section

### Out of Scope

- Modifying `run-events.js` VALID_RUN_EVENTS list (no new event types)
- Changing existing `recovery_summary` behavior (the new classification coexists alongside it)
- Recovery event emission for events not yet emitted (e.g., budget recovery success — that's G-BUDGET-3, a separate M4 item)
- Dashboard integration (M6)
- Cold-start resume of failed sessions

### Verification

Dev must run `npm run test` and confirm all tests pass including the new classification tests.

## Acceptance Tests

- [ ] `classifyRecoveryEvent()` correctly classifies all 8 recovery event types by domain/severity/outcome/mechanism
- [ ] `buildRecoveryClassificationReport()` produces correct per-domain aggregation and health score from a mixed event set
- [ ] `formatGovernanceReportText()` output includes "Recovery Classification:" section with per-domain breakdown when recovery events exist
- [ ] Recovery event payloads in `continuous-run.js` include `recovery_classification` field
- [ ] `npm run test` passes with no regressions
