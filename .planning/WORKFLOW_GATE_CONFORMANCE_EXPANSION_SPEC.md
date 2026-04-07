# Workflow Gate Conformance Expansion Spec

> Extend Tier 1 `gate_semantics` so protocol conformance proves the workflow gate semantics already enforced by the runtime.

Depends on: [WORKFLOW_GATE_FILE_SEMANTICS_SPEC.md](./WORKFLOW_GATE_FILE_SEMANTICS_SPEC.md), [V2_2_PROTOCOL_CONFORMANCE_SPEC.md](./V2_2_PROTOCOL_CONFORMANCE_SPEC.md)

---

## Purpose

Close the gap between shipped workflow-gate behavior and executable protocol proof.

Today Tier 1 `gate_semantics` already proves:

- phase-exit file existence checks
- verification-pass checks
- human-approval pauses
- unknown-phase rejection
- negative `.planning/PM_SIGNOFF.md` semantics
- run-completion behavior for `.planning/ship-verdict.md`

But it still misses four enforced semantic contracts:

1. `.planning/SYSTEM_SPEC.md` must contain required contract sections
2. `.planning/IMPLEMENTATION_NOTES.md` must replace scaffold placeholders with real content
3. `.planning/acceptance-matrix.md` must preserve the requirement table and mark every row passing
4. `.planning/RELEASE_NOTES.md` must replace scaffold placeholders with real QA content

That means the runtime can truthfully enforce workflow gate semantics while the conformance kit still overclaims Tier 1 proof. That is a protocol-truth bug, not a documentation nit.

## Interface

No new CLI command.

This slice extends the existing protocol conformance surface:

- fixture surface: `gate_semantics`
- fixture operation set in `.agentxchain-conformance/fixtures/README.md`
- reference adapter operation handling in `cli/src/lib/reference-conformance-adapter.js`

New fixture-layer verb:

```text
evaluate_run_completion
```

## Behavior

### 1. Keep `gate_semantics` as the surface

Do not introduce a second surface such as `completion_semantics`.

Phase exits and run completion already share the same gate predicate model:

- `requires_files`
- `requires_verification_pass`
- `requires_human_approval`
- workflow-file semantic checks

The conformance surface should reflect that shared constitutional boundary.

### 2. Preserve existing PM signoff and ship-verdict proof

Do not regress the already-shipped gate semantics proof for:

- `.planning/PM_SIGNOFF.md`
- `.planning/ship-verdict.md`
- run completion outside the final phase

Those fixtures remain part of the Tier 1 contract.

### 3. Prove workflow-file semantic failures already enforced by the runtime

Tier 1 fixtures must additionally prove that gate advancement stays blocked when:

- `.planning/SYSTEM_SPEC.md` exists but omits a required section such as `## Acceptance Tests`
- `.planning/IMPLEMENTATION_NOTES.md` still contains scaffold placeholders
- `.planning/acceptance-matrix.md` exists but does not contain a real passing requirement table
- `.planning/RELEASE_NOTES.md` still contains scaffold placeholders

Each must return `gate_failed` with state unchanged and a reason derived from the semantic evaluator, not a generic missing-file failure.

### 4. Keep `gate_semantics` as the surface
Do not create new surfaces for `system_spec_semantics`, `implementation_notes_semantics`, or other workflow-kit slices. These file semantics are already part of the same gate predicate model and are enforced by the same gate evaluator.

### 5. Keep fixture truth minimal

Fixtures should assert only the constitutional outcome:

- action/result
- pending completion state when applicable
- phase/state unchanged when rejection is expected

Do not overfit fixture expectations to incidental implementation details.

### 6. Public count surfaces must move with the corpus

Any intentional fixture-count expansion must update:

- protocol conformance tests
- remote conformance tests
- fixture README counts
- public docs/marketing surfaces that publish corpus size

## Error Cases

| Condition | Required behavior |
|---|---|
| Adapter receives `evaluate_run_completion` but does not support it | Report `error`, not fake pass/fail |
| PM signoff file exists but is semantically false | Fixture fails with `gate_failed`, not `advance` |
| Ship verdict file exists but is semantically false | Fixture fails with `gate_failed`, not `complete` or `awaiting_human_approval` |
| Run completion requested outside final phase | Fixture returns `not_final_phase`, not `gate_failed` |
| Fixture-count expansion lands without count-surface updates | Guard tests fail |

## Acceptance Tests

- **AT-WFGC-001**: Tier 1 self-validation passes after the workflow-file semantic fixtures are added.
- **AT-WFGC-002**: Existing PM signoff negative fixtures remain in the `gate_semantics` corpus.
- **AT-WFGC-003**: Existing ship-verdict and run-completion fixtures remain in the `gate_semantics` corpus.
- **AT-WFGC-004**: `gate_semantics` includes a fixture proving `.planning/SYSTEM_SPEC.md` semantic failure blocks phase exit.
- **AT-WFGC-005**: `gate_semantics` includes a fixture proving `.planning/IMPLEMENTATION_NOTES.md` placeholder content blocks phase exit.
- **AT-WFGC-006**: `gate_semantics` includes a fixture proving `.planning/acceptance-matrix.md` semantic failure blocks run completion.
- **AT-WFGC-007**: `gate_semantics` includes a fixture proving `.planning/RELEASE_NOTES.md` placeholder content blocks run completion.
- **AT-WFGC-008**: `agentxchain verify protocol --tier 1 --target . --format json` reports the expanded Tier 1 fixture count consistently across local and remote verifier tests.
- **AT-WFGC-009**: Homepage/docs/marketing count surfaces match the expanded corpus size.

## Open Questions

None for this slice. Recovery-report semantics remain outside Tier 1 because they are a coordinator/operator workflow artifact, not a current protocol-v6 conformance surface.
