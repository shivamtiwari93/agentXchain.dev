# BUG-78 No-Edit Review Artifact Normalization Spec

## Purpose

No-edit governance and launch-readiness reviews are valid turns. BUG-78 showed a full-auto run pausing because a no-edit `product_marketing` review declared `artifact.type: "workspace"` with `files_changed: []`; the validator was right that the declaration was inconsistent, but the recovery path forced manual staging JSON surgery.

This spec defines a safe recovery contract for unambiguous no-edit review turns while preserving strict rejection for ambiguous or dirty workspace claims.

## Interface

- `agentxchain accept-turn`
  - Auto-normalizes a staged turn result when `artifact.type === "workspace"`, `files_changed === []`, and the turn carries an explicit no-edit lifecycle signal (`run_completion_request: true`, a forward `phase_transition_request`, or a `review_only` role context).
  - Emits `artifact_type_auto_normalized` in `.agentxchain/events.jsonl`.
- `agentxchain accept-turn --normalize-artifact-type review`
  - Operator recovery flag for the same empty-workspace artifact mismatch when the operator has inspected the turn and wants the CLI to apply the review-artifact correction.
- Turn-result schema
  - `workspace`: repo files were intentionally modified; `files_changed` must be non-empty and match observed diff.
  - `review`: no repo mutations were made; `files_changed` must be `[]`.
  - `patch`: structured proposed changes.
  - `commit`: existing commit artifact.
- Role prompts and dispatch bundle field rules
  - Agents must represent zero-edit work as `artifact.type: "review"` with `files_changed: []`.
  - Agents must use `workspace` only when they actually changed repo files and listed every changed path.

## Behavior

1. Correct no-edit review results (`artifact.type: "review"`, `files_changed: []`) accept normally for `pm`, `qa`, and `product_marketing`.
2. Empty-workspace results with an explicit no-edit lifecycle signal are normalized in memory before artifact validation.
3. The accepted history entry records `artifact.type: "review"` and `files_changed: []`.
4. The event log records `artifact_type_auto_normalized` with the original and normalized artifact types.
5. Dirty worktrees are still rejected by the existing observed-diff checks after normalization; normalization is not a bypass for undeclared repo mutations.
6. Ambiguous authoritative empty-workspace completions with no lifecycle signal remain rejected, preserving the BUG-46 exact-state invariant.

## Error Cases

- `--normalize-artifact-type` with any value other than `review` fails with a protocol error.
- If normalization is forced but actor-owned files are dirty, acceptance fails with the existing artifact observation error.
- If an authoritative role changed product files but declares `artifact.type: "review"`, artifact validation still rejects it.
- If a `review_only` role declares product files, artifact validation still rejects it.

## Acceptance Tests

- `AT-BUG78-001`: Child-process `agentxchain accept-turn` accepts correct no-edit `review` artifacts for `product_marketing`, `qa`, and `pm`.
- `AT-BUG78-002`: Child-process `agentxchain accept-turn` auto-normalizes empty `workspace` artifacts for `product_marketing`, `qa`, and `pm` when the turn requests run completion.
- `AT-BUG78-003`: Accepted history records `artifact.type: "review"` and `files_changed: []` after auto-normalization.
- `AT-BUG78-004`: Event log contains `artifact_type_auto_normalized`.
- `AT-BUG78-005`: The explicit recovery flag `--normalize-artifact-type review` is exposed and wired through the CLI.
- `AT-BUG78-006`: Existing BUG-46 exact-state coverage remains a rejection for ambiguous empty-workspace authoritative completions.

## Open Questions

- None for this slice. A future retry-with-correction path can be added for cases where the worktree is dirty and auto-normalization cannot safely proceed.

## Decisions

- `DEC-BUG78-NO-EDIT-REVIEW-NORMALIZATION-001`: Auto-normalize only unambiguous no-edit review turns. Do not normalize every authoritative empty-workspace completion, because BUG-46 established that ambiguous workspace claims with no lifecycle signal must fail closed.
