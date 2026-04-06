# Workflow Gate Conformance Expansion Spec

> Extend Tier 1 `gate_semantics` so protocol conformance proves the workflow gate semantics already enforced by the runtime.

Depends on: [WORKFLOW_GATE_FILE_SEMANTICS_SPEC.md](./WORKFLOW_GATE_FILE_SEMANTICS_SPEC.md), [V2_2_PROTOCOL_CONFORMANCE_SPEC.md](./V2_2_PROTOCOL_CONFORMANCE_SPEC.md)

---

## Purpose

Close the gap between shipped gate behavior and executable protocol proof.

Today Tier 1 `gate_semantics` proves:

- phase-exit file existence checks
- verification-pass checks
- human-approval pauses
- unknown-phase rejection

But it still misses two critical truths:

1. Negative semantic failures for `.planning/PM_SIGNOFF.md`
2. Run-completion gate behavior, including `.planning/ship-verdict.md`

That means the runtime can truthfully enforce workflow gate semantics while the conformance kit only partially proves them. That is weak protocol evidence.

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

### 2. Prove negative PM signoff semantics

Tier 1 fixtures must prove that phase advancement stays blocked when:

- `.planning/PM_SIGNOFF.md` says `Approved: NO`
- `.planning/PM_SIGNOFF.md` exists but has no `Approved:` line

Both must return `gate_failed` with phase/state unchanged.

### 3. Prove run-completion semantics

Tier 1 fixtures must prove `evaluateRunCompletion()` behavior for:

- non-final-phase rejection (`not_final_phase`)
- non-affirmative ship verdict failure (`gate_failed`)
- affirmative ship verdict plus human approval (`awaiting_human_approval`)
- affirmative ship verdict without human approval (`complete`)

At least one affirmative fixture must use a compatibility alias (`SHIP` or `SHIP IT`) so the conformance corpus proves the documented compatibility contract instead of merely claiming it.

### 4. Keep fixture truth minimal

Fixtures should assert only the constitutional outcome:

- action/result
- pending completion state when applicable
- phase/state unchanged when rejection is expected

Do not overfit fixture expectations to incidental implementation details.

### 5. Public count surfaces must move with the corpus

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

- **AT-WFGC-001**: Tier 1 self-validation passes after adding `evaluate_run_completion` support.
- **AT-WFGC-002**: `gate_semantics` includes fixtures proving `Approved: NO` and missing `Approved:` both block phase exit.
- **AT-WFGC-003**: `gate_semantics` includes fixtures proving run completion fails on `## Verdict: PENDING`.
- **AT-WFGC-004**: `gate_semantics` includes a run-completion fixture that accepts `## Verdict: SHIP IT`.
- **AT-WFGC-005**: `agentxchain verify protocol --tier 1 --target . --format json` reports the new Tier 1 fixture count consistently across local and remote verifier tests.
- **AT-WFGC-006**: Homepage/docs/marketing count surfaces match the expanded corpus size.
- **AT-WFGC-007**: `gate_semantics` includes a fixture proving `run_completion_request` outside the final phase returns `not_final_phase`.

## Open Questions

1. Should a later conformance slice prove broader workflow-kit semantics such as acceptance-matrix completion, or should that remain outside Tier 1 until there is a narrower protocol contract for it?
