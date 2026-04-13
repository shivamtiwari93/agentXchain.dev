# Intake Start Context Bridge Specification

> Narrow additive spec that amends `V3_S3_START_SPEC.md` with payload-continuity requirements for repo-local intake starts.

---

## Purpose

`agentxchain intake start` currently proves run/turn linkage, but that is not enough. When an intake intent enters governed execution, the assigned role must receive the intake intent's charter and acceptance contract in the dispatch bundle, and fresh runs created by this bridge must record truthful intake provenance.

Without that, the S3 bridge is structurally linked but semantically weak: the run starts, but the operator-facing turn lacks the reason it was started.

---

## Interface

### Start-Time Run Provenance

When `agentxchain intake start` initializes a new governed run from idle state, it must call the existing run initializer with provenance:

```json
{
  "trigger": "intake",
  "intake_intent_id": "intent_...",
  "trigger_reason": "<intent.charter>",
  "created_by": "operator"
}
```

This applies only when `intake start` creates a fresh run. If it reuses an already-active run, it must not overwrite the existing run provenance.

### Assigned Turn Intake Context

The first assigned governed turn created by `intake start` must persist an additive `intake_context` object on the active turn state and surface it in the dispatch bundle.

Minimum shape:

```json
{
  "intent_id": "intent_...",
  "event_id": "evt_...",
  "source": "manual",
  "category": "manual_signal",
  "charter": "Fix the release pipeline",
  "acceptance_contract": [
    "tarball installs cleanly",
    "postflight passes"
  ]
}
```

### Dispatch Bundle Surfaces

When the active turn has `intake_context`:

- `ASSIGNMENT.json` must include `intake_context`
- `CONTEXT.md` must include an `## Intake Intent` section showing:
  - intent id
  - source and category
  - charter
  - acceptance contract bullets when present

No intake section should render for turns without intake context.

---

## Behavior

1. `intake start` reads the linked intake event before dispatch creation.
2. If starting a fresh run, it passes intake provenance to `initializeGovernedRun()`.
3. After `assignGovernedTurn()`, it attaches `intake_context` to the assigned active turn in governed state and persists state before dispatch materialization.
4. `writeDispatchBundle()` treats `turn.intake_context` as first-class turn metadata:
   - copies it into `ASSIGNMENT.json`
   - renders `## Intake Intent` into `CONTEXT.md`
5. The intake section is informational and does not change gate semantics, turn validation, or routing.
6. Existing non-intake dispatch flows remain unchanged.

---

## Error Cases

1. If the linked intake event is missing at start time, `intake start` must fail with exit 2 rather than creating a dispatch bundle with partial intake context.
2. If the run is reused from a non-intake origin, the existing run provenance must remain unchanged. Turn-level intake context still applies.
3. If `acceptance_contract` is missing or empty unexpectedly, the context section still renders the charter and omits the acceptance bullet list instead of fabricating content.

---

## Acceptance Tests

- `AT-ISC-001`: starting a planned intent from idle state records `state.provenance.trigger = "intake"`, the linked `intake_intent_id`, and the charter as `trigger_reason`
- `AT-ISC-002`: the first dispatch `ASSIGNMENT.json` for an intake-started turn includes `intake_context` with intent id, event id, source/category, charter, and acceptance contract
- `AT-ISC-003`: the first dispatch `CONTEXT.md` for an intake-started turn includes an `## Intake Intent` section with charter and acceptance bullets
- `AT-ISC-004`: non-intake dispatch bundles do not render the intake section
- `AT-ISC-005`: reusing an already-active run via `intake start` preserves existing run provenance while still attaching turn-level intake context

---

## Open Questions

None. This is a narrow continuity fix, not a redesign of intake scheduling.
