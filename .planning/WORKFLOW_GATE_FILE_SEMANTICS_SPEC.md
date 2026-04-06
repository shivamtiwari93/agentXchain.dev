# Workflow Gate File Semantics Spec

> Make governed phase/completion gates read the actual signoff/verdict state they already claim to depend on.

Depends on: [CLI_SPEC.md](./CLI_SPEC.md), [WORKFLOW_KIT_VALIDATE_SPEC.md](./WORKFLOW_KIT_VALIDATE_SPEC.md)

---

## Purpose

Close the gap between workflow-kit proof and gate truth.

Today governed gates already enforce:

- required file existence via `requires_files`
- verification pass via `requires_verification_pass`
- human approval pauses via `requires_human_approval`

But two shipped workflow-kit files still behave too loosely at runtime:

- `.planning/PM_SIGNOFF.md`
- `.planning/ship-verdict.md`

The planning gate can currently pass when `PM_SIGNOFF.md` still says `Approved: NO`, and the QA completion gate can currently pass when `ship-verdict.md` still says `## Verdict: PENDING`. That is not a docs gap. That is false gate truth.

## Interface

No new command.

The affected public behavior is the existing governed lifecycle:

```bash
agentxchain accept-turn
agentxchain step
agentxchain run
agentxchain approve-transition
agentxchain approve-completion
```

The pure-library gate evaluators remain the enforcement boundary:

- `evaluatePhaseExit()`
- `evaluateRunCompletion()`

## Behavior

### 1. Keep `template validate` narrow

`template validate` continues to prove scaffold integrity only:

- files exist
- structural markers exist
- template planning artifacts exist
- acceptance hints are tracked

It does **not** become a gate-readiness command. A fresh governed scaffold with `Approved: NO` and `## Verdict: PENDING` must still pass workflow-kit validation.

### 2. Planning gate requires explicit PM approval

When a gate evaluates `.planning/PM_SIGNOFF.md`, file existence alone is insufficient.

The gate must require a line matching:

```md
Approved: YES
```

Case-insensitive matching is acceptable, but values other than `YES` fail the gate.

Examples that must fail:

- `Approved: NO`
- `Approved: PENDING`
- file exists but has no `Approved:` line

### 3. Completion gate requires an affirmative ship verdict

When a gate evaluates `.planning/ship-verdict.md`, file existence alone is insufficient.

The gate must require a verdict line under the existing scaffold heading:

```md
## Verdict: YES
```

Compatibility aliases `SHIP` and `SHIP IT` are accepted as affirmative verdicts. Non-affirmative values fail the gate, including:

- `PENDING`
- `NO`
- `YES WITH CONDITIONS`
- missing `## Verdict:` line

This keeps the completion gate aligned with the shipped QA prompt: the run is only ready for completion when QA has produced an affirmative ship verdict.

### 4. Failure mode

When these semantic checks fail:

- the turn is still accepted into history
- the gate result is `gate_failed`
- the run stays in the current phase
- the failure reason explicitly names the semantic defect

This matches existing gate semantics: accepted turn, no phase advancement until the gate is truthfully satisfied.

### 5. Scope boundary

This slice does **not** parse broader planning semantics:

- it does not validate roadmap completeness
- it does not prove the acceptance matrix is fully checked
- it does not parse blocker tables or condition lists

Only the two already-scaffolded truth markers become machine-enforced gate semantics in this slice.

## Error Cases

| Condition | Required behavior |
|---|---|
| `PM_SIGNOFF.md` exists but says `Approved: NO` | Planning gate fails with a semantic reason naming PM signoff approval |
| `PM_SIGNOFF.md` exists but has no `Approved:` line | Planning gate fails; structural proof and gate proof both reject it for their own reasons |
| `ship-verdict.md` exists but says `## Verdict: PENDING` | Completion gate fails with a semantic reason naming the non-affirmative verdict |
| `ship-verdict.md` exists but omits `## Verdict:` | Completion gate fails; structural proof and gate proof both reject it for their own reasons |
| Fresh governed scaffold after `init --governed` | `template validate` still passes even though gate semantics are not yet satisfied |

## Acceptance Tests

- **AT-WFG-001**: `evaluatePhaseExit()` returns `gate_failed` when `PM_SIGNOFF.md` exists but does not say `Approved: YES`.
- **AT-WFG-002**: `evaluatePhaseExit()` passes the planning gate when `PM_SIGNOFF.md` says `Approved: YES` and other required files exist.
- **AT-WFG-003**: `evaluateRunCompletion()` returns `gate_failed` when `ship-verdict.md` exists but still says `## Verdict: PENDING`.
- **AT-WFG-004**: `evaluateRunCompletion()` passes when `ship-verdict.md` says `## Verdict: YES`.
- **AT-WFG-005**: `template validate --json` on a fresh governed scaffold still reports `workflow_kit.ok = true`.

## Open Questions

1. Should a later slice mechanize `acceptance-matrix.md` completion semantics, or is that a separate QA-proof surface rather than a gate-file concern?
