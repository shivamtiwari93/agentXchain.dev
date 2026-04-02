# Coordinator Hook Lifecycle Spec

> Standalone contract for coordinator-scoped hooks in multi-repo runs.

---

## Purpose

Define the coordinator hook contract precisely enough that implementation drift is obvious. The existing multi-repo spec names the phases, but this spec closes two easy-to-miss gaps:

- payload completeness for every coordinator hook phase
- fail-closed handling when coordinator hooks tamper with repo-local orchestrator artifacts

The target is not “hooks are wired somewhere.” The target is: a real `agentxchain multi` lifecycle fires hooks in the right order, with the right payload, and refuses silent mutation of repo-local control files.

---

## Interface

Coordinator hooks run from `agentxchain-multi.json` under `hooks` with four allowed phases:

- `before_assignment`
- `after_acceptance`
- `before_gate`
- `on_escalation`

Every coordinator hook envelope must include:

- `hook_phase`
- `hook_name`
- `run_id`
- `project_root`
- `timestamp`
- `payload`

Every coordinator hook `payload` must include these fields, with `null` when not applicable:

- `super_run_id`
- `workstream_id`
- `repo_id`
- `repo_run_id`
- `phase`
- `pending_barriers`
- `pending_gate`

Phase-specific payload fields may extend that base contract:

- `before_assignment`: `role`, `coordinator_status`, `coordinator_phase`
- `after_acceptance`: `projection_ref`, `barrier_effects`, `context_invalidations`
- `before_gate`: `gate_type`, `gate`, `from_phase`, `to_phase`, `required_repos`
- `on_escalation`: `blocked_reason`, `repo_runs`

Protected paths for coordinator hooks include:

- coordinator state files under `.agentxchain/multirepo/`
- repo-local orchestrator state files
- repo-local dispatch bundle files already materialized on disk

---

## Behavior

1. `before_assignment` runs immediately before dispatch and may block the step.
2. `after_acceptance` runs after repo-local acceptance is projected into coordinator history and barrier state is updated.
3. `before_gate` runs immediately before a coordinator phase/completion gate is approved and may block the approval.
4. `on_escalation` runs whenever the coordinator enters blocked state.
5. If a coordinator hook mutates any protected file, the orchestrator restores the protected content, records tamper in coordinator hook audit, and treats the hook as failed.
6. A failed `after_acceptance` hook blocks the coordinator and surfaces the protocol violation to the operator.
7. A failed `before_assignment` or `before_gate` hook exits non-zero without mutating coordinator gate/dispatch state.

---

## Error Cases

1. If `repo_run_id` or `pending_barriers` are omitted from coordinator hook payloads, the test fails because the payload contract drifted.
2. If a coordinator hook can modify repo-local `state.json`, `history.jsonl`, `decision-ledger.jsonl`, or an existing dispatch bundle file without rollback, the test fails because hook scope is unenforced.
3. If `after_acceptance` tamper is detected but the coordinator continues dispatching or requesting gates, the test fails because advisory hooks were treated as ignorable.
4. If the full lifecycle ordering differs from the expected sequence, the test fails because composition regressed.

---

## Acceptance Tests

1. `AT-CR-005`: an `after_acceptance` coordinator hook that mutates repo-local orchestrator state is rejected, restored, and blocks the coordinator.
2. `AT-CR-006`: a `before_assignment` hook can block dispatch without creating repo-local active turns.
3. `AT-CR-007`: a `before_gate` hook can block gate approval while leaving the pending gate intact.
4. `AT-CR-008`: `on_escalation` fires when the coordinator enters blocked state.
5. `AT-CR-009`: a full multi-repo lifecycle with coordinator hooks preserves hook order and emits the required payload fields at each boundary.

---

## Open Questions

1. Do we want directory-level tamper detection for newly created files under protected dispatch directories, or is existing-file rollback sufficient for v1.1?
