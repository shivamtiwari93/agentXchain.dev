# Multi-Repo Orchestration Spec

> v2 coordination model for governed work spanning multiple repositories.

---

## Purpose

Define how AgentXchain governs a single product initiative that spans multiple git repositories without collapsing back into ad hoc human coordination.

The single-repo protocol already answers: "how do multiple agents collaborate safely inside one repo?"

This spec answers the harder v2 question: "how does one governed run coordinate repo-scoped work, dependencies, gates, and recovery across multiple repos while preserving auditability and human authority?"

## Decision

**DEC-MR-001**: v2 multi-repo orchestration uses a **coordinator run** plus **repo-local governed runs**. The coordinator owns cross-repo state and dependency barriers. Each repository keeps its own governed state, history, decision ledger, and dispatch bundles.

**DEC-MR-002**: v2 authoritative turns are **single-repo only**. A turn may target exactly one writable repo. Cross-repo changes are expressed as multiple coordinated turns under one workstream, not one agent mutating multiple repositories at once.

**DEC-MR-003**: Global phase advancement is **barrier-based**. The coordinator cannot advance the initiative until all required repo-local gates and declared cross-repo dependency barriers are satisfied.

**DEC-MR-004**: Dependent repo-local dispatch bundles receive **coordinator-generated cross-repo context artifacts** derived from accepted upstream turns and current barrier state. A downstream repo must never rely on stale prose memory about another repo's accepted change.

**DEC-MR-005**: **Repo-local state is authoritative for repo-local facts.** The coordinator's view is a derived projection that can be rebuilt from repo-local state, history, and barrier events. Divergence recovery re-syncs the coordinator to the repos, never the reverse.

**DEC-MR-006**: Hooks run at **both** layers with distinct scope. Repo-local runs keep the full 8-phase hook lifecycle from the hook spec. Coordinator hooks are limited to `before_assignment`, `after_acceptance`, `before_gate`, and `on_escalation`.

**DEC-MR-007**: Barrier tracking uses both a **current snapshot** and an **append-only barrier ledger**. `barriers.json` answers "what is true now?" and `barrier-ledger.jsonl` answers "how did we get here?"

**DEC-MR-008**: v2 keeps **all dispatched turns repo-scoped**, including `review_only` turns. Cross-repo review remains available through coordinator-generated context and coordinator audit surfaces, but the coordinator does not dispatch one review turn that spans multiple repo-local runs in v2.

**DEC-MR-009**: The coordinator reuses the existing **repo-local single-turn lifecycle** rather than invoking adapters directly. Initial implementation may shell out to `agentxchain step` in the target repo and extend the repo-local dispatch path with additive coordinator context injection.

Rationale:

- Reusing repo-local governed state avoids rewriting the single-repo safety model.
- Single-repo authoritative turns keep conflict detection, repo observation, and rollback intelligible.
- Dependency barriers make cross-repo convergence explicit instead of implicit in agent prose.
- Cross-repo context artifacts make dependency handoffs reproducible instead of relying on agents to rediscover upstream changes.
- Reconstructable coordinator state preserves auditability without letting the coordinator overwrite the source of truth inside a repo.

## Architecture

Three layers:

1. **Coordinator layer**
   - Owns the initiative run
   - Tracks participating repos, workstreams, barriers, and global phase state
   - Decides which repo-local turn is assignable next

2. **Repo-local governed layer**
   - Existing single-repo protocol remains authoritative inside each repo
   - Each repo has its own `.agentxchain/state.json`, `history.jsonl`, and `decision-ledger.jsonl`

3. **Integration layer**
   - Maps accepted repo-local outcomes back into the coordinator audit trail
   - Evaluates cross-repo barriers and escalation conditions

## Interface

### Coordinator Config

New file at initiative root:

```json
{
  "schema_version": "0.1",
  "project": {
    "id": "agent-platform",
    "name": "Agent Platform Rollout"
  },
  "repos": {
    "web": {
      "path": "../agentxchain.dev",
      "default_branch": "main",
      "required": true
    },
    "cli": {
      "path": "../agentxchain-cli",
      "default_branch": "main",
      "required": true
    }
  },
  "workstreams": {
    "protocol-doc-sync": {
      "phase": "implementation",
      "repos": ["web", "cli"],
      "entry_repo": "cli",
      "depends_on": [],
      "completion_barrier": "all_repos_accepted"
    }
  },
  "routing": {
    "planning": {
      "entry_workstream": "protocol-doc-sync"
    }
  },
  "gates": {
    "initiative_ship": {
      "requires_human_approval": true,
      "requires_repos": ["web", "cli"]
    }
  }
}
```

### Coordinator State

Coordinator-owned files:

```text
.agentxchain/multirepo/state.json
.agentxchain/multirepo/history.jsonl
.agentxchain/multirepo/decision-ledger.jsonl
.agentxchain/multirepo/barriers.json
.agentxchain/multirepo/barrier-ledger.jsonl
```

### Coordinator State Shape

```json
{
  "schema_version": "0.1",
  "super_run_id": "srun_123",
  "status": "idle",
  "phase": "planning",
  "active_workstreams": {},
  "repo_runs": {
    "web": { "run_id": "run_web_1", "status": "active" },
    "cli": { "run_id": "run_cli_1", "status": "paused" }
  },
  "pending_barriers": [
    {
      "barrier_id": "bar_protocol_contract",
      "type": "interface_alignment",
      "repos": ["cli", "web"],
      "status": "pending"
    }
  ],
  "pending_gate": null
}
```

### Barrier Snapshot Schema

`barriers.json` is the authoritative snapshot of current barrier state:

```json
{
  "schema_version": "0.1",
  "barriers": {
    "bar_protocol_contract": {
      "barrier_id": "bar_protocol_contract",
      "workstream_id": "protocol-doc-sync",
      "type": "interface_alignment",
      "upstream_repos": ["cli"],
      "downstream_repos": ["web"],
      "status": "partially_satisfied",
      "satisfied_by": [
        {
          "repo_id": "cli",
          "repo_turn_id": "turn_cli_9",
          "projection_ref": "mproj_17"
        }
      ],
      "required_context_refs": ["ctx_protocol-doc-sync_web_2"],
      "blocked_assignments": ["web:dev"],
      "updated_at": "2026-04-02T22:00:00.000Z"
    }
  }
}
```

### Barrier Ledger Schema

`barrier-ledger.jsonl` is append-only and records every state transition:

```json
{
  "timestamp": "2026-04-02T22:00:00.000Z",
  "super_run_id": "srun_123",
  "barrier_id": "bar_protocol_contract",
  "workstream_id": "protocol-doc-sync",
  "event": "partially_satisfied",
  "previous_status": "pending",
  "new_status": "partially_satisfied",
  "caused_by": {
    "repo_id": "cli",
    "repo_turn_id": "turn_cli_9",
    "projection_ref": "mproj_17"
  },
  "notes": "CLI contract accepted; web follow-up still pending"
}
```

## Turn Model

### Repo-Scoped Turns

Every authoritative turn targets one repo:

```json
{
  "super_run_id": "srun_123",
  "workstream_id": "protocol-doc-sync",
  "repo_id": "cli",
  "repo_turn_id": "turn_cli_9",
  "role": "dev"
}
```

Rules:

1. The turn dispatch bundle may reference dependency context from other repos, but write authority applies only inside the targeted repo.
2. `files_changed` is always repo-relative to the targeted repo.
3. Acceptance, rejection, retry, and conflict detection remain repo-local.

### Cross-Repo Context Artifacts

For any dependent assignment, the coordinator must inject explicit context artifacts into the targeted repo's dispatch bundle:

- `COORDINATOR_CONTEXT.json`
- `COORDINATOR_CONTEXT.md`

`COORDINATOR_CONTEXT.json` is machine-readable and includes the current dependency snapshot:

```json
{
  "super_run_id": "srun_123",
  "workstream_id": "protocol-doc-sync",
  "target_repo_id": "web",
  "context_ref": "ctx_protocol-doc-sync_web_2",
  "generated_at": "2026-04-02T22:05:00.000Z",
  "upstream_acceptances": [
    {
      "projection_ref": "mproj_17",
      "repo_id": "cli",
      "repo_turn_id": "turn_cli_9",
      "summary": "Changed docs routing to explicit .html targets",
      "decisions": ["DEC-DOCS-ROUTING-001"],
      "files_changed": ["README.md", "website/docs/protocol.html"],
      "verification": {
        "command": "python html-parse-check",
        "exit_code": 0
      }
    }
  ],
  "active_barriers": [
    {
      "barrier_id": "bar_protocol_contract",
      "type": "interface_alignment",
      "status": "partially_satisfied"
    }
  ],
  "required_followups": [
    "Update web docs links to match accepted CLI/docs contract"
  ]
}
```

Rules:

1. The coordinator must include the latest accepted upstream projections for every declared dependency that affects the target repo.
2. If a pending repo-local turn is invalidated by an upstream acceptance, the re-dispatched turn must receive a fresh `context_ref`; reusing stale cross-repo context is a protocol error.
3. These artifacts are additive context only. They do not broaden write authority beyond the targeted repo.
4. `COORDINATOR_CONTEXT.md` is the human-readable companion summary generated from the same snapshot as `COORDINATOR_CONTEXT.json`.

### Cross-Repo Review Turns

v2 deliberately does **not** dispatch one review turn across multiple repos. Review work remains repo-scoped:

- authoritative: one writable repo
- review_only: one targeted repo-local run, with coordinator context summarizing upstream cross-repo facts

Multi-repo review dispatch can return in a later version once artifact ownership, result routing, and acceptance authority are specified precisely.

## Behavior

### 1. Run Initialization

When a multi-repo run starts:

1. The coordinator validates every declared repo path.
2. Each required repo must already contain a governed project. Coordinator init validates repo-local governed readiness; it does not silently initialize participating repos in v2.
3. The coordinator creates or resumes one repo-local run per participating repo.
4. The coordinator records a `super_run_id` and links each repo-local `run_id`.

### 2. Assignment

Assignment is two-stage:

1. Coordinator selects the next assignable workstream based on phase, dependencies, and barrier state.
2. Coordinator dispatches work into the chosen repo-local run.

A workstream is assignable only when:

- its declared dependencies are satisfied
- no required repo in the workstream is blocked
- no unresolved completion barrier prevents more work
- the coordinator has generated a current cross-repo context artifact for the targeted repo when upstream dependencies exist

### 3. Dependency Barriers

Barrier types in v2:

- `all_repos_accepted`
- `interface_alignment`
- `ordered_repo_sequence`
- `shared_human_gate`

Examples:

- `ordered_repo_sequence`: repo `cli` must accept its interface change before repo `web` can take the matching implementation turn
- `interface_alignment`: both repos must accept compatible contract decisions before QA can start

### 4. Acceptance

Repo-local acceptance stays unchanged, but the coordinator appends a projection entry when a repo-local turn is accepted:

```json
{
  "timestamp": "2026-04-02T22:00:00.000Z",
  "super_run_id": "srun_123",
  "repo_id": "cli",
  "repo_run_id": "run_cli_1",
  "repo_turn_id": "turn_cli_9",
  "workstream_id": "protocol-doc-sync",
  "role": "dev",
  "summary": "Updated protocol CLI surface",
  "files_changed": ["README.md", "src/commands/step.js"],
  "decisions": ["DEC-201"],
  "barrier_effects": ["bar_protocol_contract: partially_satisfied"]
}
```

The coordinator never rewrites repo-local history. It records a derived cross-repo view.

After each repo-local acceptance, the coordinator must:

1. append the derived projection entry to coordinator history
2. update `barriers.json`
3. append any barrier state changes to `barrier-ledger.jsonl`
4. regenerate cross-repo context artifacts for affected downstream repos before their next assignment

### 5. Conflict Model

There are two conflict classes:

1. **Repo-local file conflict**
   - handled entirely by the existing single-repo protocol

2. **Cross-repo dependency conflict**
   - repo A accepted a change that invalidates repo B's pending assumption
   - coordinator marks the dependent workstream `blocked`
   - dependent repo-local turn is retained and re-dispatched with updated cross-repo context artifacts derived from the new upstream acceptance

v2 does **not** attempt automatic semantic merge across repos.

### 6. Phase and Completion Gates

A global phase can advance only when:

1. every required repo for the active workstreams has drained active turns
2. repo-local exit gates are satisfied where applicable
3. all declared barriers for the phase are satisfied
4. any shared human gate is approved

Global ship completion requires:

- each required repo to have a completed repo-local run or accepted completion candidate
- no repo in `blocked` state
- shared human completion approval

### 7. Recovery

If one repo blocks:

1. the coordinator does not silently continue dependent work in other repos
2. unrelated independent workstreams may continue only if they do not depend on the blocked repo
3. the coordinator records the blocked repo, failed turn, dependency impact, and suggested operator recovery action

### 8. Divergence Recovery

If coordinator state diverges from repo-local state:

1. the coordinator pauses new assignments for the affected workstream(s)
2. the coordinator re-reads each affected repo's authoritative `.agentxchain/state.json`, `history.jsonl`, and `decision-ledger.jsonl`
3. the coordinator rebuilds its derived projections, barrier snapshot, and pending assignment eligibility from repo-local facts plus `barrier-ledger.jsonl`
4. if the rebuild succeeds, the coordinator appends a `state_resynced` entry to coordinator history and resumes
5. if the rebuild cannot derive a safe next state, the coordinator remains blocked with explicit mismatch details for operator intervention

The coordinator must never rewrite repo-local state during divergence recovery. Repo-local runs are the source of truth for active turn, accepted history, and ledger facts.

### 9. Coordinator Hooks

Coordinator hooks are narrower than repo-local hooks because the coordinator owns orchestration, not repo mutation.

Allowed coordinator phases:

| Phase | Trigger Point | Blocking? | Scope |
|---|---|---|---|
| `before_assignment` | Before the coordinator dispatches a repo-local turn | Yes | Can block workstream selection or repo assignment |
| `after_acceptance` | After a newly discovered repo-local acceptance is projected and barrier state is updated | No | Notifications, metrics, external annotations |
| `before_gate` | Before a shared coordinator gate executes | Yes | Shared human/compliance gates only |
| `on_escalation` | When the coordinator enters blocked state | No | Alerting and external incident creation |

Coordinator hook payloads must include:

- `super_run_id`
- `workstream_id`
- `repo_id`
- `repo_run_id`
- `phase`
- `pending_barriers`
- `pending_gate`

Coordinator hooks may not mutate repo-local state, repo-local history, or repo-local dispatch bundles. Repo-local hooks remain responsible for repo-scoped enforcement.
If a coordinator hook tampers with protected orchestrator-owned files, AgentXchain restores the protected content, records the tamper in coordinator hook audit, and fails closed.

## Error Cases

| Error | Behavior |
|---|---|
| Declared repo path missing | Run initialization fails before any assignment |
| Repo is not governed | Validation fails with migration/init guidance |
| Required repo is dirty at initialization | Run pauses for human decision or explicit override |
| Coordinator state and repo-local state disagree on active turn | Coordinator pauses affected workstreams, re-syncs from repo-local authority, then either resumes or blocks with `state_divergence` |
| Authoritative turn writes to undeclared second repo | Acceptance fails as protocol violation |
| Dependency barrier unsatisfied | Assignment blocked for dependent workstream |
| One repo completes while another required repo is blocked | Global completion forbidden |
| Repo removed from config mid-run | Validation error; existing run cannot resume until reconciled |

## Acceptance Tests

### AT-MR-001: Two-repo initialization

Given a coordinator config with two governed repos, when the multi-repo run initializes, then one `super_run_id` is created, both repo-local runs are linked in coordinator state, and no repo-local state is overwritten unexpectedly.

### AT-MR-002: Single-repo authoritative boundary

Given an authoritative dev turn assigned to repo `cli`, when the agent modifies files under repo `web`, then acceptance fails and the coordinator records a cross-repo write violation.

### AT-MR-003: Ordered sequence barrier

Given a workstream with `ordered_repo_sequence` requiring `cli` before `web`, when `web` is selected before `cli` accepts, then assignment is rejected with barrier guidance.

### AT-MR-004: Cross-repo dependency invalidation

Given repo `web` has an active dependent turn and repo `cli` accepts an incompatible interface decision, when the coordinator evaluates barriers, then the dependent workstream becomes blocked and the retained `web` turn is marked for redispatch with updated context.

### AT-MR-005: Shared human gate

Given both repos satisfy local gates but the initiative gate requires human approval, when the operator has not approved, then the coordinator status is `paused` and no global phase advancement occurs.

### AT-MR-006: Independent workstreams continue

Given repo `cli` is blocked on workstream A and repo `web` has workstream B with no dependency on `cli`, when the coordinator re-evaluates assignment, then workstream B remains assignable.

### AT-MR-007: Derived cross-repo audit trail

Given a repo-local turn is accepted, when the coordinator ingests the acceptance, then it appends a derived entry to `.agentxchain/multirepo/history.jsonl` without mutating the repo-local history.

### AT-MR-008: Cross-repo context injection

Given repo `web` depends on an accepted upstream turn in repo `cli`, when the coordinator dispatches the next authoritative turn into `web`, then the dispatch bundle contains `COORDINATOR_CONTEXT.json` and `COORDINATOR_CONTEXT.md` with the latest upstream projection refs and barrier state.

### AT-MR-009: Divergence re-sync favors repo-local authority

Given coordinator state says repo `cli` still has an active turn but repo-local `state.json` shows that turn was already accepted, when divergence recovery runs, then the coordinator rebuilds its projection from repo-local history, appends a `state_resynced` event, and does not overwrite repo-local state.

### AT-MR-010: Barrier ledger auditability

Given a barrier moves from `pending` to `partially_satisfied` to `satisfied`, when the coordinator updates `barriers.json`, then each transition is also appended to `barrier-ledger.jsonl` with previous status, new status, and causation metadata.

### AT-MR-011: Coordinator hook scope is limited

Given a coordinator `after_acceptance` hook attempts to modify a repo-local dispatch bundle or repo-local state, when the hook exits, then the orchestrator restores the protected content, rejects the mutation as a protocol violation, and blocks further coordinator progress.

## Open Questions

### OQ-MR-001: Where should the coordinator project live?

Options:

- dedicated control repo
- one participating repo as the anchor
- ephemeral workspace outside all repos

Tentative answer: dedicated control repo is cleanest for audit ownership, but v2 can start with a workspace-root control directory.

### OQ-MR-002: How are cross-repo branches modeled?

v2 does not require coordinated branch creation. Repo-local branching remains local. A later version may need branch sets or change stacks.

### OQ-MR-003: Can one role hold simultaneous turns in different repos?

Current proposal: yes for `review_only`, no for `authoritative` in v2. This keeps write coordination simple while still allowing cross-repo QA/director review.

### OQ-MR-004: How is repo-local CI aggregated into a global ship verdict?

Proposal: repo-local verification evidence rolls up into coordinator summaries, but the coordinator does not rerun CI itself in v2.
