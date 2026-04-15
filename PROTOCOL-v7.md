# AgentXchain Protocol v7

Versioned repo-native reference for the AgentXchain v7 protocol.

This document supersedes `PROTOCOL-v6.md` as the current constitutional reference. `SPEC-GOVERNED-v5.md` remains the historical v1.1 single-repo reference. `SPEC-GOVERNED-v4.md` remains the frozen v1.0 reference.

## 0. Specification Status And Boundaries

This file is the current versioned protocol reference for v7. It is not the only protocol surface:

- `/docs/protocol` is the constitutional overview for operators and evaluators.
- `/docs/protocol-reference` is the public reference summary and boundary page.
- `/docs/protocol-implementor-guide` is the executable adoption contract for third-party runners.

Three version axes matter and MUST NOT be collapsed:

- Protocol version: `v7`
- Artifact schema versions:
  - governed config: `1.0`
  - turn result: `1.0`
  - governed state: `1.1`
  - coordinator config/state/context: `0.1`
- Conformance tiers: `1`, `2`, and `3`

The protocol is the constitutional contract. The following are reference-runner or integration details unless a future protocol revision or conformance tier explicitly promotes them:

- CLI command names
- dashboard ports and view names
- provider-specific adapter behavior
- notification webhooks and delivery semantics

## 0.1 What Is Normative In v7

The current normative v7 contract includes:

- repo-native governed artifacts and state transitions
- governed run statuses and write-authority boundaries
- queued-versus-pending gate lifecycle
- append-only accepted history and decision-ledger behavior
- coordinator entities such as `super_run_id`, workstreams, barriers, acceptance projections, and cross-repo context artifacts
- the current conformance surfaces exercised by `.agentxchain-conformance/fixtures/`

## 0.2 Current Executable Proof Surface

The current conformance corpus covers these surfaces:

- Tier 1: `state_machine`, `turn_result_validation`, `gate_semantics`, `decision_ledger`, `history`, `config_schema`
- Tier 2: `dispatch_manifest`, `hook_audit`
- Tier 3: `coordinator`

That executable proof set is narrower than the entire product surface. Do not treat unconformed features as constitutional truth just because the reference CLI ships them.

## 1. Scope

Protocol v7 governs two layers:

1. Repo-local governed delivery inside a single repository.
2. Multi-repo coordination across several governed repositories under one coordinator initiative.

The repo-local run remains the authority for accepted work inside each repo. The coordinator never invents accepted work. It derives cross-repo projections, barriers, context, and initiative gates from repo-local truth.

## 2. Core Principles

- Mandatory challenge is structural, not optional. Blind agreement is a protocol violation.
- Human authority remains constitutional. Agents cannot self-advance human-gated transitions or initiative completion.
- Accepted history is append-only.
- Repo-local accepted history is authoritative for repo-local work.
- Coordinator state is authoritative for initiative status, pending initiative gates, barrier snapshots, and cross-repo context artifacts.

## 3. Repo-Local Governed Run

Repo-local semantics from v5 remain in force:

- `agentxchain.json` defines governed roles, runtimes, routing, gates, prompts, and rules.
- `.agentxchain/state.json` tracks run status, phase, active turns, blocked state, and pending repo-local gates.
- `.agentxchain/history.jsonl` records accepted turn entries.
- `.agentxchain/decision-ledger.jsonl` records accepted decisions.
- `.agentxchain/dispatch/turns/<turn_id>/` is the turn-scoped dispatch bundle root.
- `.agentxchain/staging/<turn_id>/turn-result.json` is the staged turn-result path.

Governed run statuses are:

- `idle`
- `active`
- `paused`
- `blocked`
- `completed`
- `failed`

Write authorities are:

- `authoritative`
- `proposed`
- `review_only`

Reference CLI operator surface:

These are the current reference-runner commands. Other runners may expose different operator commands as long as they preserve the same artifact, validation, and state-transition contract.

- `agentxchain step`
- `agentxchain accept-turn`
- `agentxchain reject-turn`
- `agentxchain approve-transition`
- `agentxchain approve-completion`

## 4. Coordinator Initiative Model

The multi-repo coordinator is configured by `agentxchain-multi.json` in the workspace root and persists initiative state under `.agentxchain/multirepo/`.

The coordinator introduces these entities:

- `super_run_id`: initiative identifier across all participating repos.
- `repo_runs`: linked or initialized repo-local governed runs keyed by repo id.
- `workstream`: ordered cross-repo unit of work with a phase, entry repo, repo set, dependencies, and completion barrier.
- `acceptance_projection`: derived coordinator history entry representing one repo-local accepted turn in initiative context.
- `barrier`: coordinator-level completion predicate for a workstream.
- `pending_gate`: phase-transition or initiative-completion approval requested by the coordinator.

Reference CLI coordinator surface:

These are the current reference-runner commands. They are not the only valid coordinator interface.

- `agentxchain multi init`
- `agentxchain multi status`
- `agentxchain multi step`
- `agentxchain multi approve-gate`
- `agentxchain multi resync`

## 5. Coordinator Config Contract

`agentxchain-multi.json` currently validates with `schema_version: "0.1"`.

```json
{
  "schema_version": "0.1",
  "project": {
    "id": "agentxchain-dev",
    "name": "AgentXchain.dev"
  },
  "repos": {
    "api": { "path": "./repos/api", "default_branch": "main", "required": true },
    "web": { "path": "./repos/web", "default_branch": "main", "required": true }
  },
  "workstreams": {
    "platform": {
      "phase": "planning",
      "repos": ["api", "web"],
      "entry_repo": "api",
      "depends_on": [],
      "completion_barrier": "all_repos_accepted"
    }
  },
  "routing": {
    "planning": { "entry_workstream": "platform" }
  },
  "gates": {
    "initiative_ship": {
      "requires_human_approval": true,
      "requires_repos": ["api", "web"]
    }
  },
  "hooks": {
    "before_assignment": [],
    "after_acceptance": [],
    "before_gate": [],
    "on_escalation": []
  }
}
```

Validation rules enforced today:

- Repo ids and workstream ids must be lowercase alphanumeric plus `_` or `-`.
- Workstream `phase` must be one of `planning`, `implementation`, `qa`.
- Workstream `completion_barrier` must be one of:
  - `all_repos_accepted`
  - `interface_alignment`
  - `ordered_repo_sequence`
  - `shared_human_gate`
- `entry_repo` must be present in the workstream repo set.
- Workstream dependencies must reference declared workstreams and must be acyclic.
- `routing.<phase>.entry_workstream`, when present, must exist and belong to the same phase.
- `gates.<id>.requires_repos`, when present, must reference declared repos.

## 6. Coordinator State And Files

The coordinator persists the following artifacts under `.agentxchain/multirepo/`:

```text
.agentxchain/multirepo/
  state.json
  history.jsonl
  decision-ledger.jsonl
  barriers.json
  barrier-ledger.jsonl
  context/
    <context_ref>/
      COORDINATOR_CONTEXT.json
      COORDINATOR_CONTEXT.md
  hook-audit.jsonl
  hook-annotations.jsonl
```

`state.json` contains:

- `schema_version`
- `super_run_id`
- `project_id`
- `status`
- `phase`
- `repo_runs`
- `pending_gate`
- `phase_gate_status`
- timestamps

Coordinator statuses are:

- `active`
- `paused`
- `blocked`
- `completed`

`history.jsonl` currently records these key event types:

- `run_initialized`
- `turn_dispatched`
- `acceptance_projection`
- `context_generated`
- `phase_transition_requested`
- `phase_transition_approved`
- `run_completion_requested`
- `run_completed`

`barrier-ledger.jsonl` records `barrier_transition` events.

## 7. Dispatch, Resync, And Projection Rules

`agentxchain multi step` is the truthful coordinator progression command.

Its required behavior is:

1. Refuse to proceed if the initiative is already `completed`.
2. Refuse to proceed if a `pending_gate` exists; the operator must use `agentxchain multi approve-gate`.
3. If the coordinator is `blocked`, surface the blocked reason and fire `on_escalation`.
4. Detect divergence between coordinator expectations and repo-local authority.
5. Resync from repo-local authority before selecting the next assignment.
6. Fire `after_acceptance` only for newly projected acceptances discovered during resync.
7. Request a phase-transition or initiative-completion gate automatically when no repo assignment is available and the gate conditions are satisfied.
8. Otherwise dispatch the next repo-local turn and write coordinator context into that repo’s dispatch bundle.

Projection rules:

- Coordinator projections are derived from repo-local accepted turns.
- A projection records `projection_ref`, `workstream_id`, `repo_id`, `repo_run_id`, `repo_turn_id`, `summary`, `files_changed`, `decisions`, and `verification`.
- Cross-repo write violations are rejected during projection if a repo-local accepted turn claims files outside its own repo.

## 8. Barrier And Gate Semantics

Each workstream has a completion barrier. Barrier state is tracked in `barriers.json` and audited in `barrier-ledger.jsonl`.

Phase transition:

- Evaluated against all workstreams in the current phase.
- Blocked if required repos still have active turns, repo-local pending gates, blocked repo-local state, or unsatisfied non-human barriers.
- Requested as a coordinator `pending_gate` with `gate_type: "phase_transition"`.
- Approved with `agentxchain multi approve-gate`.

Initiative completion:

- Only evaluated in the final phase.
- Blocked if any required repo is not completed or not pending repo-local completion approval.
- Requested as a coordinator `pending_gate` with `gate_type: "run_completion"`.
- Approved with `agentxchain multi approve-gate`.

Human barriers:

- `shared_human_gate` barriers may remain unsatisfied until the coordinator gate is approved.
- Coordinator gate approval marks listed human barriers satisfied and records barrier transitions.

## 9. Cross-Repo Context

Before dispatch, the coordinator generates cross-repo context for the target repo under:

- `.agentxchain/multirepo/context/<context_ref>/COORDINATOR_CONTEXT.json`
- `.agentxchain/multirepo/context/<context_ref>/COORDINATOR_CONTEXT.md`

The dispatch bundle also receives:

- `COORDINATOR_CONTEXT.json`
- `COORDINATOR_CONTEXT.md`

The context snapshot includes:

- `super_run_id`
- `workstream_id`
- `target_repo_id`
- `context_ref`
- `upstream_acceptances`
- `active_barriers`
- `required_followups`

The coordinator records a `context_generated` history event with:

- `context_ref`
- `workstream_id`
- `target_repo_id`
- `relevant_workstream_ids`
- `upstream_repo_ids`

After a later acceptance, the coordinator computes informational `context_invalidations` so external consumers can detect stale downstream context. Invalidations do not mutate state by themselves; they are signals for hooks, notifications, and operator tooling.

## 10. Coordinator Hook Contract

Coordinator hooks are configured in `agentxchain-multi.json` under `hooks`.

Supported phases:

- `before_assignment`
- `after_acceptance`
- `before_gate`
- `on_escalation`

Blocking phases:

- `before_assignment`
- `before_gate`

Advisory phases:

- `after_acceptance`
- `on_escalation`

Common payload contract:

- `phase`
- `super_run_id`
- `workstream_id`
- `repo_id`
- `repo_run_id`
- `pending_barriers`
- `pending_gate`
- `coordinator_status`
- `coordinator_phase`

Phase-specific additions:

- `after_acceptance`: `projection_ref`, `barrier_effects`, `context_invalidations`
- `before_gate`: `gate_type`, `gate`, `from_phase`, `to_phase`, `required_repos`, `human_barriers`
- `on_escalation`: `blocked_reason`, `repo_runs`

Tamper protections:

- Coordinator hooks must not mutate coordinator-owned files under `.agentxchain/multirepo/`.
- Coordinator hooks must not mutate protected repo-local orchestrator files or existing dispatch bundle artifacts.
- Protected-file tamper is rolled back and treated as a protocol violation.

## 11. Versioning And Compatibility

- `SPEC-GOVERNED-v4.md`: frozen v1.0 reference.
- `SPEC-GOVERNED-v5.md`: frozen v1.1 single-repo reference.
- `PROTOCOL-v6.md`: frozen v6 multi-repo constitutional reference.
- `PROTOCOL-v7.md`: current multi-repo constitutional reference.

`/docs/protocol.html` is the latest published protocol reference.

`/docs/protocol-v7.html` is the versioned permalink for this protocol version.

## 12. Non-Goals Of v7

Protocol v7 does not currently specify:

- cloud-hosted orchestration
- dashboard write authority
- automatic cross-repo rollback
- plugin marketplace or sandbox isolation beyond hook tamper protection
- streaming cross-repo execution semantics beyond coordinator dispatch/resync/gate rules
