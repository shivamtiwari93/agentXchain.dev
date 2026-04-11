# Run Context Inheritance Spec

## Purpose

Provenance links already tell operators that a new run came from a prior terminal run, but the first turn of that child run still starts cold. The current product truth is explicit in `website-v2/docs/cli.mdx`: `--continue-from` and `--recover-from` are metadata only and do **not** copy state or context.

That is the next honest long-horizon gap.

This slice adds a narrow, read-only continuity bridge so a child run can inherit the **summary context** of its parent run without pretending to resume the same run or copy mutable state.

## Interface

### CLI

```bash
agentxchain run --continue-from <run_id> --inherit-context
agentxchain run --recover-from <run_id> --inherit-context
```

### Flag Rules

- `--inherit-context` is optional.
- It is valid only when paired with exactly one provenance flag:
  - `--continue-from`
  - `--recover-from`
- Using `--inherit-context` without a parent run is a CLI error.

## Behavior

### 1. Child run identity remains a fresh run

- `--inherit-context` does **not** resume the parent run.
- The child still gets a fresh `run_id`.
- Phase state, gate status, active turns, budgets, and blocked metadata still reset according to the fresh-run contract.

### 2. Read-only inherited summary

When `--inherit-context` is set, the child run captures a read-only inheritance payload from the parent run:

- parent `run_id`
- parent terminal `status`
- parent `completed_at`
- parent `phases_completed`
- parent `roles_used`
- parent `blocked_reason` when present
- up to the most recent 5 decision entries from the parent run's recorded `run-history.jsonl` inheritance snapshot
- up to the most recent 3 accepted turn summaries from the parent run's recorded `run-history.jsonl` inheritance snapshot
- the parent run's additive terminal retrospective when available

This is a summary surface, not a full replay of the parent run.

### 3. Dispatch-bundle visibility

The first dispatched turn of the child run must include an `Inherited Run Context` section in `CONTEXT.md` when inherited context exists.

That section must surface:

- parent run identity and terminal status
- the most relevant recent decisions
- the most relevant recent accepted-turn summaries
- the parent run's terminal retrospective headline and follow-on/recovery guidance when recorded
- explicit reminder that the child run is a fresh run, not a resumed parent

### 4. Subsequent turns

- The inherited summary persists for the child run and remains available in later dispatch bundles.
- It may be rendered more compactly after the first turn, but it must remain visible until the child run completes or blocks.

### 5. State / report observability

The inherited summary must be observable outside `CONTEXT.md`:

- stored in governed state under a dedicated read-only field
- exposed in `status --json`
- surfaced in `report`
- included in `export`

### 6. Validation boundary

If the parent run exists but its history or decision ledger is partially missing/corrupt:

- the child run still starts
- inheritance degrades to the summary data that can be recovered truthfully
- warnings are surfaced in `status --json` / `report`

If the selected parent run predates inheritance snapshots in `run-history.jsonl`:

- the child run still starts
- inheritance degrades to metadata-only
- the child run must not read today's repo-global `history.jsonl` or `decision-ledger.jsonl` and pretend that data came from the selected parent

## Error Cases

| Case | Behavior |
| --- | --- |
| `--inherit-context` without `--continue-from` or `--recover-from` | CLI error, exit 1 |
| parent run not found / invalid | existing provenance validation error |
| parent run non-terminal | existing provenance validation error |
| parent history missing | child run starts with partial inheritance + warning |
| parent decision ledger malformed | child run starts with partial inheritance + warning |

## Acceptance Tests

- `AT-RCI-001`: `run --continue-from <completed> --inherit-context` creates a fresh child run and stores inherited summary data in state.
- `AT-RCI-002`: the first child dispatch bundle `CONTEXT.md` includes an `Inherited Run Context` section with parent run id, status, and recent decisions.
- `AT-RCI-003`: `status --json` and `report` expose inherited context when present.
- `AT-RCI-004`: `export` includes inherited context in the run summary/state surface.
- `AT-RCI-005`: `--inherit-context` without a provenance flag exits 1 with actionable guidance.
- `AT-RCI-006`: parent runs without an `inheritance_snapshot` in `run-history.jsonl` degrade to metadata-only inheritance with warnings instead of blocking child-run startup.
- `AT-RCI-007`: `run --recover-from <blocked> --inherit-context` stores inherited summary data for blocked parent runs.
- `AT-RCI-008`: `run --continue-from <completed>` without `--inherit-context` does not attach inherited context.
- `AT-RCI-009`: when newer repo-global history exists, inheriting from an older parent run still uses that selected parent's recorded snapshot instead of the latest repo state.

## Non-Scope

- copying parent phase state or gate approvals
- copying active turns or retry counters
- automatic inheritance by default
- coordinator-wide inheritance across child repos
- model-generated summarization of the parent run

## Open Questions

- Should a later slice add `--inherit-context=compact|full`, or is one fixed summary shape enough for v1?
