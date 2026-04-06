# Governance Report Operator Context Spec

**Status:** shipped
**Author:** GPT 5.4 (Turn 36)
**Decision:** `DEC-REPORT-CTX-001`

## Problem

The governance report now shows turn timeline, decisions, hook activity, and timing, but it still leaves operators blind on three practical questions:

1. **What request did this run come from?** If the run started through intake, the report should expose the linked intent instead of forcing operators to open `.agentxchain/intake/intents/*.json`.
2. **Which gates actually passed?** The report should show gate outcomes from `state.phase_gate_status`, not just final phase and raw turn history.
3. **How do I recover if the run is blocked?** Showing only `Blocked on: operator_escalation` is not actionable when the recovery contract already exists in `state.blocked_reason.recovery`.

Without those surfaces, the report remains partially operational but still requires raw-artifact spelunking for intake provenance, gate proof, and blocked-state recovery.

## Data Available

The export artifact already carries the needed data:

- `.agentxchain/intake/intents/*.json` for intake provenance
- `state.phase_gate_status` for gate outcomes
- `state.blocked_reason.recovery` for recovery owner, action, and detail

## Interface

### `buildRunSubject(artifact)` additions

Add to `subject.run`:

```js
{
  gate_summary: [
    {
      gate_id: string,
      status: string,
    }
  ],

  intake_links: [
    {
      intent_id: string,
      event_id: string | null,
      status: string | null,
      priority: string | null,
      template: string | null,
      target_turn: string | null,
      started_at: string | null,
      updated_at: string | null,
    }
  ],

  recovery_summary: {
    category: string | null,
    typed_reason: string | null,
    owner: string | null,
    recovery_action: string | null,
    detail: string | null,
    turn_retained: boolean | null,
    blocked_at: string | null,
    turn_id: string | null,
  } | null,
}
```

### Markdown additions

For governed runs:

- Add `## Intake Linkage` when `intake_links.length > 0`
- Add `## Gate Outcomes` when `gate_summary.length > 0`
- Add `## Recovery` when `recovery_summary` exists

### Text additions

Equivalent flat-text sections:

- `Intake Linkage:`
- `Gate Outcomes:`
- `Recovery:`

## Behavior

1. Intake linkage is derived only from intent files whose `target_run` matches the exported `run_id`.
2. Intake linkage is omitted entirely when no matching intents exist.
3. Gate outcomes are derived directly from `state.phase_gate_status`, sorted by gate id.
4. Recovery is shown only when `blocked_reason.recovery` exists.
5. The report must not invent intake or recovery state from heuristics outside the export artifact.

## Error Cases

- Malformed intake intent files are skipped without failing report generation.
- Non-object `phase_gate_status` yields an empty gate summary.
- Missing `blocked_reason.recovery` yields `recovery_summary = null`.

## Acceptance Tests

- `AT-RC-001`: Markdown report for a blocked run with linked intake and gate status includes `## Intake Linkage`, `## Gate Outcomes`, and `## Recovery`.
- `AT-RC-002`: JSON report exposes `subject.run.intake_links`, `subject.run.gate_summary`, and `subject.run.recovery_summary`.
- `AT-RC-003`: Real intake-started `agentxchain run` auto-report includes intake linkage and gate outcomes in markdown output.
- `AT-RC-004`: Reports with no linked intake or recovery omit those sections instead of rendering empty headings.

## Open Questions

None. This is direct export-artifact surfacing, not a new data model.
