# Mission Decomposition Spec

**Status:** proposed

## Purpose

Freeze the first governed planning layer above mission grouping.

Mission hierarchy already answers "which chains belong to this repo-local goal?" It does **not** answer "what workstreams should exist before chains are started?" This spec defines a repo-local decomposition surface that turns an existing mission goal into an operator-reviewed execution proposal.

This feature is advisory, not protocol-normative:

- it must not change governed run state or protocol schemas
- it must not allocate fake chain IDs before execution
- it must not auto-start work without an explicit approval boundary

## Interface

### CLI

```bash
agentxchain mission plan [mission_id|latest] [--constraint <text>]... [--role-hint <role>]... [--json] [--dir <path>]
agentxchain mission plan show [plan_id|latest] [--json] [--dir <path>]
agentxchain mission plan approve [plan_id|latest] [--mission <mission_id>] [--dir <path>]
agentxchain mission plan launch [plan_id|latest] --workstream <workstream_id> [--auto-approve] [--dir <path>]
```

### Repo Artifacts

- Mission source: `.agentxchain/missions/<mission_id>.json`
- Plan directory: `.agentxchain/missions/plans/<mission_id>/`
- Plan file: `.agentxchain/missions/plans/<mission_id>/<plan_id>.json`

Plan artifact shape:

```json
{
  "plan_id": "plan-2026-04-16T21-36-15Z",
  "mission_id": "mission-release-hardening",
  "status": "proposed",
  "supersedes_plan_id": null,
  "superseded_by_plan_id": null,
  "created_at": "2026-04-16T21:36:15.000Z",
  "updated_at": "2026-04-16T21:36:15.000Z",
  "approved_at": null,
  "input": {
    "goal": "Eliminate release-surface drift across CLI, docs, website, and downstream channels.",
    "constraints": [
      "Do not change protocol version surfaces",
      "Keep release automation idempotent"
    ],
    "role_hints": ["pm", "dev", "qa"]
  },
  "planner": {
    "mode": "llm_one_shot",
    "model": "configured mission planner"
  },
  "workstreams": [
    {
      "workstream_id": "ws-release-alignment",
      "title": "Align release-owned version surfaces",
      "goal": "Unify version truth across package, docs, homepage, and downstream templates.",
      "roles": ["pm", "dev", "qa"],
      "phases": ["planning", "implementation", "qa"],
      "depends_on": [],
      "acceptance_checks": [
        "All release-owned surfaces derive from one validator path",
        "Preflight and post-bump checks catch drift"
      ],
      "launch_status": "ready"
    },
    {
      "workstream_id": "ws-downstream-verification",
      "title": "Verify publish and downstream parity",
      "goal": "Confirm npm, website, GitHub release, and Homebrew all match the cut version.",
      "roles": ["qa", "release"],
      "phases": ["qa", "release"],
      "depends_on": ["ws-release-alignment"],
      "acceptance_checks": [
        "Published surfaces match the release tag",
        "Proof links are recorded"
      ],
      "launch_status": "blocked"
    }
  ],
  "launch_records": []
}
```

## Behavior

### 1. Mission-first input contract

Mission decomposition operates on an existing mission. The operator provides:

- a mission target (`mission_id` or `latest`)
- zero or more `--constraint` values
- zero or more `--role-hint` values

The goal string comes from the mission artifact itself. The planner must not require the operator to restate the goal in a second command because that creates drift between the mission record and the plan record.

### 2. Output is workstreams, not pre-created chains

The planner produces an ordered set of **workstreams** with dependency edges, role sets, phase sequences, and acceptance checks.

It must not emit chain IDs up front. Chain IDs are runtime artifacts created only when a workstream is launched through the existing run/chaining path.

### 3. One-shot generation, revision by supersession

`mission plan` is one-shot per invocation. It creates a new plan artifact with `status: "proposed"`.

If the operator wants refinement, the system creates a new plan artifact and sets `supersedes_plan_id` to the prior plan. The earlier plan remains durable for auditability and changes to decision history.

The system must not mutate an approved or previously launched plan in place.

### 4. Planner execution model

The initial implementation is LLM-assisted with strict schema validation:

- prompt from the mission goal plus optional constraints and role hints
- require structured JSON output matching the plan schema
- reject malformed or incomplete planner output fail-closed

Rule-only decomposition is not sufficient for arbitrary repo goals. Mission decomposition is a product-specific planning surface and can justify custom planner logic.

### 5. Approval is mandatory before launch

`mission plan` never starts chains.

The operator must approve a specific plan artifact before any workstream can launch:

1. `mission plan ...` creates `status: "proposed"`
2. `mission plan approve ...` transitions to `status: "approved"`
3. `mission plan launch ... --workstream <id>` may launch only from an approved plan

This is the governance boundary. Any attempt to launch from an unapproved plan fails closed.

Approval behavior is strict:

- only the latest plan artifact for a mission may be approved
- approving a plan transitions `status: "proposed"` → `status: "approved"`
- approving a newer plan marks any older active `proposed` or `approved` plans as `status: "superseded"`
- an already-approved, superseded, completed, or needs-attention plan cannot be approved again

This keeps one current approved plan per mission and makes revision lineage explicit instead of implicit.

### 6. Launch is per-ready-workstream

`mission plan launch` starts one workstream at a time using the existing governed run path and mission binding.

Launch behavior:

- only workstreams whose `depends_on` set is satisfied may launch
- launch records bind `workstream_id` to the emitted runtime `chain_id`
- the emitted chain report attaches back to the parent mission through the existing mission/chain surface

This keeps decomposition advisory and execution explicit. The product does not turn one plan approval into an uncontrolled swarm fan-out.

### 7. Failure behavior is block-and-replan, not silent auto-retry

If a launched workstream ends in failure or blocked state:

- that workstream is marked `needs_attention`
- dependent workstreams remain `blocked`
- the plan status becomes `needs_attention`
- no automatic replanning or relaunch occurs

The operator may then create a new superseding plan revision. Replanning is explicit because automatic replanning would otherwise rewrite approved intent without review.

### 8. Visibility surfaces

At minimum, the plan surface must expose:

- newest-first plan list per mission
- latest plan summary for `mission plan show latest`
- each workstream's dependency state and launch state
- `launch_records` binding approved workstreams to actual chain IDs

## Error Cases

| Condition | Required behavior |
|---|---|
| Mission target does not exist | Fail closed. No plan artifact is created. |
| Mission has no goal text | Fail closed. The planner cannot operate on missing mission intent. |
| Planner returns malformed JSON or omits required workstream fields | Fail closed and surface validation errors. |
| Plan approve target does not exist | Fail closed. |
| Plan approve target is not the latest plan artifact for the mission | Fail closed and direct the operator to the latest revision. |
| Plan approve target is already approved or is no longer in `proposed` state | Fail closed. |
| Launch requested for an unapproved plan | Fail closed. |
| Launch requested for a blocked workstream with unsatisfied dependencies | Fail closed and list blocking workstream IDs. |
| Launch requested for a nonexistent workstream ID | Fail closed. |
| Prior plan already approved and operator generates a new one | New plan supersedes prior plan; prior artifact remains durable. |
| Launched workstream chain fails or blocks | Mark the workstream and plan `needs_attention`; do not auto-replan. |

## Acceptance Tests

- `AT-MISSION-PLAN-001`: `mission plan <mission_id|latest>` creates a plan artifact under `.agentxchain/missions/plans/<mission_id>/`.
- `AT-MISSION-PLAN-002`: plan input uses the mission artifact goal plus optional `--constraint` and `--role-hint` values.
- `AT-MISSION-PLAN-003`: plan output contains workstreams with `workstream_id`, roles, phases, dependency edges, and acceptance checks, but no preallocated `chain_id`.
- `AT-MISSION-PLAN-004`: malformed planner output fails validation and does not create an approved or partially-valid artifact.
- `AT-MISSION-PLAN-005`: `mission plan approve` is required before `mission plan launch`.
- `AT-MISSION-PLAN-006`: `mission plan launch --workstream <id>` fails when dependencies are unsatisfied.
- `AT-MISSION-PLAN-007`: successful launch records `workstream_id` → `chain_id` linkage in `launch_records` and attaches the chain to the mission.
- `AT-MISSION-PLAN-008`: failed launched workstreams mark the plan `needs_attention` and leave dependent workstreams blocked.
- `AT-MISSION-PLAN-009`: generating a revised plan writes a new artifact with `supersedes_plan_id` instead of mutating the prior plan.
- `AT-MISSION-PLAN-010`: `mission plan approve` approves only the latest proposed plan for a mission and stamps approval metadata on that artifact.
- `AT-MISSION-PLAN-011`: approving a newer plan supersedes any older active proposed/approved plans so only one approved plan remains current.
- `AT-MISSION-PLAN-012`: attempting to approve an already-approved or older superseded plan fails closed.

## Open Questions

1. Should the first implementation expose a planner-role selection surface, or should it use one fixed internal planner contract?
2. Should plan approval stay operator-only in v1, or should a governed approval gate be able to approve a plan artifact later?
3. Should mission dashboard UI gain a dedicated `Plans` subview in the first slice, or should CLI/artifact proof land before browser visibility?
