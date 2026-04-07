# QA Output Normalization Spec

## Purpose

Reduce unnecessary validation failures caused by predictable model-output drift patterns. Two recurring defects in live governed runs waste retries without adding safety:

1. **`artifacts_created` object-vs-string drift**: Models return `{path: "...", description: "..."}` instead of plain `"..."` strings.
2. **Exit-gate-as-phase confusion**: Models set `phase_transition_request` to an exit gate name (e.g., `"qa_ship_verdict"`) instead of a valid phase name or `run_completion_request: true`.

## Interface

### `normalizeTurnResult(turnResult, config) → { normalized, corrections[] }`

A pure function that returns a shallow-cloned turn result with predictable drift patterns corrected, plus an array of human-readable correction strings for logging/warnings.

Called between JSON parse and Stage A validation in `validateStagedTurnResult()`.

## Behavior

### Rule 1: `artifacts_created` object coercion

If `artifacts_created` is an array and any element is an object (not a string):
- If the object has a `path` property that is a string, replace the element with `obj.path`.
- If the object has a `name` property that is a string (and no `path`), replace with `obj.name`.
- Otherwise, attempt `JSON.stringify(obj)` — this will still fail schema validation but at least won't crash.
- Record a correction: `"artifacts_created[N]: coerced object to string \"...\""`.

### Rule 2: Exit-gate-to-completion auto-correction

If `phase_transition_request` is a string that matches an exit gate name in `config.gates` but is NOT a valid phase name in `config.routing`:
- If the current phase's exit gate matches the value, this is a "I want to pass the gate" signal.
- Set `phase_transition_request` to `null` and `run_completion_request` to `true` (only if the gate belongs to the last phase in routing order, i.e., there is no next phase to transition to).
- Otherwise, if the gate belongs to a non-terminal phase, infer the correct next phase and set `phase_transition_request` to that phase name.
- Record a correction.

**Exception**: If both `phase_transition_request` and `run_completion_request` are already set, do NOT normalize — let the mutual-exclusivity validator catch it.

### Rule 3: Prompt enhancement

In `dispatch-bundle.js`, the Field Rules section must:
- List valid phase names explicitly: `"Valid phases: planning, implementation, qa"` (from `Object.keys(config.routing)`).
- Warn: `"Do NOT use exit gate names (e.g., qa_ship_verdict) as phase_transition_request values."`
- For review_only roles in terminal phases, add: `"To signal ship readiness, set run_completion_request: true, NOT phase_transition_request."`

## Error Cases

- `turnResult` is not an object → return unchanged, no corrections.
- `config` is missing routing/gates → skip gate-related normalization.
- Normalization produces a result that still fails validation → that's fine; normalization is best-effort, not a bypass.

## Acceptance Tests

- AT-NORM-001: `artifacts_created` with objects containing `path` property coerced to strings.
- AT-NORM-002: `artifacts_created` with mixed strings and objects — strings preserved, objects coerced.
- AT-NORM-003: `phase_transition_request: "qa_ship_verdict"` in terminal QA phase → normalized to `run_completion_request: true`.
- AT-NORM-004: `phase_transition_request: "planning_signoff"` in planning phase → normalized to `phase_transition_request: "implementation"` (next phase).
- AT-NORM-005: Already-valid turn result → no corrections, returned unchanged.
- AT-NORM-006: Both `phase_transition_request` and `run_completion_request` set → no normalization (mutual exclusivity preserved for validator).
- AT-NORM-007: Prompt template for QA review_only role in terminal phase includes explicit valid-phase list and run_completion_request guidance.
