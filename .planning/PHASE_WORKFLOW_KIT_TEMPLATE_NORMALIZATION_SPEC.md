# Phase Workflow-Kit Template Normalization Spec

**Status:** shipped
**Decision:** DEC-PHASE-WORKFLOW-KIT-NORMALIZATION-001

## Purpose

`agentxchain phase` should inspect governed phase workflow metadata from normalized config, not from a special raw-config side channel.

That was not true before this slice. Normalization preserved expanded artifacts and the `_explicit` marker, but it dropped the explicit per-phase `template` string. As a result, `phase show` still had to read `rawConfig.workflow_kit` just to render one field. That is a bad boundary. If the normalized config is the internal contract, phase inspection should not need to cheat around it.

## Interface

- Input: governed v4 config with optional `workflow_kit.phases.<phase>.template`
- Output: normalized `config.workflow_kit.phases.<phase>.template` when the raw phase explicitly declares one
- Consumer: `agentxchain phase list|show`

## Behavior

1. `normalizeWorkflowKit(raw.workflow_kit, routingPhases)` must preserve the explicit `template` string for each declared phase.
2. Default workflow-kit expansion must not invent `template` values for built-in phase defaults.
3. Explicit opt-out (`workflow_kit: {}`) must continue to normalize as `_explicit: true` with no phase entries.
4. `agentxchain phase` must derive workflow source from normalized config only:
   - `_explicit !== true` and normalized phase entry exists or defaults were built => `default`
   - `_explicit === true` and normalized phase entry exists => `explicit`
   - `_explicit === true` and normalized phase entry is absent => `not_declared`
5. `agentxchain phase` must read `workflow_kit.template` from normalized phase metadata, not `rawConfig`.

## Error Cases

1. Invalid template ids remain a validation failure in existing workflow-kit validation. This slice does not loosen validation.
2. Phases without an explicit template must not receive `template: null` noise in the normalized structure unless the phase command chooses to render `null` in JSON.
3. Explicit empty `workflow_kit` must not silently fall back to default artifacts.

## Acceptance Tests

- `normalizeV4()` preserves explicit `workflow_kit.phases.<phase>.template`.
- `agentxchain phase show <phase> --json` still reports `workflow_kit.source: "explicit"` and the explicit template id for template-defined phases.
- `agentxchain phase show --json` still reports `workflow_kit.source: "default"` when raw `workflow_kit` is absent.
- `agentxchain phase show <phase> --json` reports `workflow_kit.source: "not_declared"` when `workflow_kit` is an explicit empty object.

## Open Questions

None. This is a narrow contract-repair slice, not a workflow-kit redesign.
