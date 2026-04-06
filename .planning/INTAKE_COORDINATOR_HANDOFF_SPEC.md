# Intake-to-Coordinator Handoff Spec

**Status:** Shipped — implemented in Turn 22
**Author:** Claude Opus 4.6 (draft), GPT 5.4 (implementation corrections)
**Depends on:** `INTAKE_COORDINATOR_BOUNDARY_SPEC.md`, `V3_SCOPE.md`
**Supersedes:** Nothing (new surface)

---

## Purpose

Enable an intake signal detected in one governed repo to trigger coordinated work across multiple repos via an existing coordinator workstream — without breaking the repo-local authority boundary that `DEC-INTAKE-BOUNDARY-001` through `003` established.

### Operator Pain Today

1. Operator runs `intake record --source ci_failure` in the `api` repo.
2. Operator triages, approves, plans, and starts the intent → governed run begins in `api`.
3. The fix also requires changes in `web` (a sibling repo in the same coordinator workspace).
4. **No path exists.** The operator must manually navigate to the coordinator root, mentally map the intake intent to a workstream, run `multi step`, and hope the coordinator context carries enough signal for the agent in `web` to understand the original intent.
5. The original `intent_id` and its charter, acceptance contract, and evidence are invisible to the coordinator and to the `web` repo's governed turn.

This spec adds a narrow, explicit handoff path — not a new orchestration layer.

---

## Design Principles

1. **Repo-local authority is preserved.** Intake remains a repo-local command family. The handoff is an explicit operator action, not an automatic escalation.
2. **Coordinator is the coordination boundary.** The handoff targets an existing coordinator workstream. No new orchestration primitive is introduced.
3. **Intent is the source of truth.** The original intent artifact carries the charter, acceptance contract, and evidence. The handoff links the coordinator workstream to this intent and copies only the minimum context needed for truthful dispatch.
4. **No new state machines.** The handoff uses existing intake states (`planned` → `executing`) and existing coordinator operations (`multi step`). The new surface is a reference, not a lifecycle.
5. **Run identity must be explicit.** Every handoff reference is bound to one `super_run_id`. Stale handoff files must not bleed into later coordinator runs.

---

## Interface

### New command: `intake handoff`

```
agentxchain intake handoff <intent_id> \
  --coordinator-root <path> \
  --workstream <workstream_id> \
  [--json]
```

**Preconditions (all must hold or the command fails with exit code 1):**

| # | Precondition | Error message |
|---|---|---|
| 1 | CWD (or `--dir`) resolves to a governed project with `agentxchain.json` | `intake is repo-local; no governed project found` |
| 2 | Intent exists and is in `planned` state | `intent must be in planned state for handoff (current: <status>)` |
| 3 | `--coordinator-root` resolves to a directory containing `agentxchain-multi.json` | `coordinator root does not contain agentxchain-multi.json` |
| 4 | `--workstream` names a workstream defined in the coordinator config | `workstream <id> not found in coordinator config` |
| 5 | The current governed repo is listed in the workstream's `repos` array | `repo <id> is not a member of workstream <workstream_id>` |
| 6 | The coordinator has an active run (`super_run_id` exists, status is `active`) | `coordinator run is not active (status: <status>)` |

**Behavior:**

1. Load the intent from `.agentxchain/intake/intents/<intent_id>.json`.
2. Validate all preconditions.
3. Write a **handoff reference** into the coordinator's context directory:
   ```
   <coordinator_root>/.agentxchain/multirepo/handoffs/<intent_id>.json
   ```
   Schema:
   ```json
   {
     "schema_version": "1.0",
     "super_run_id": "srun_...",
     "intent_id": "intent_...",
     "source_repo": "<repo_id from agentxchain.json>",
     "source_event_id": "<event_id from the intent>",
     "source_signal_source": "<event.source>",
     "source_signal_category": "<event.category>",
     "source_event_ref": ".agentxchain/intake/events/<event_id>.json",
     "workstream_id": "<workstream>",
     "charter": "<copied from intent>",
     "acceptance_contract": ["<copied from intent>"],
     "evidence_refs": ["<relative paths to .agentxchain/intake/events/<event_id>.json>"],
     "handed_off_at": "<ISO timestamp>",
     "handed_off_by": "operator"
   }
   ```
4. Update the intent:
   - Add history entry: `{ from: "planned", to: "executing", at: <now>, reason: "handed off to coordinator workstream <workstream_id>" }`
   - Set `target_run` to `null` (the coordinator owns execution, not a repo-local run)
   - Set `target_workstream` to `{ coordinator_root: "<path>", workstream_id: "<id>", super_run_id: "<id>" }`
   - Set `status` to `executing`
5. Output the handoff reference path and the coordinator's `super_run_id`.

**What does NOT happen:**

- No repo-local governed run is initialized. The coordinator's `multi step` handles run lifecycle in each child repo.
- No coordinator state is mutated beyond writing the handoff reference file. The coordinator does not need to "accept" the handoff — it reads the reference when generating context.
- No automatic `multi step` is triggered. The operator explicitly runs `multi step` after the handoff.
- No intent state machine changes. `executing` already means "work is in progress." The `target_workstream` field distinguishes coordinator-mediated execution from repo-local execution.

---

## Source of Truth for Intent Artifacts

| Artifact | Location | Owner |
|---|---|---|
| Event | `<source_repo>/.agentxchain/intake/events/<event_id>.json` | Source repo |
| Intent | `<source_repo>/.agentxchain/intake/intents/<intent_id>.json` | Source repo |
| Handoff reference | `<coordinator_root>/.agentxchain/multirepo/handoffs/<intent_id>.json` | Coordinator |
| Coordinator context | Generated per dispatch by `multi step` | Coordinator |
| Repo-local governed state | `<child_repo>/.agentxchain/state.json` | Each child repo |

The intent artifact stays in the source repo. The coordinator gets a reference, not a copy. If the operator needs to inspect the original evidence, they read from the source repo.

---

## How `target_run` Changes

| Scenario | `target_run` | `target_workstream` |
|---|---|---|
| Repo-local `intake start` (existing) | Set to `state.run_id` | `null` |
| `intake handoff` (new) | `null` | `{ coordinator_root, workstream_id, super_run_id }` |

`resolveIntent` must handle both cases:

- If `target_run` is set: read repo-local governed state (existing behavior).
- If `target_workstream` is set: read coordinator state and check workstream completion barrier status. `completed` when barrier is `satisfied`, `blocked` when coordinator run is `blocked`, `failed` when the coordinator run ends without satisfying the barrier, and `executing` otherwise.

---

## One Intent ↔ One Workstream

An intent maps to exactly one workstream. It does not fan out to multiple workstreams. If an operator needs coordinated work across multiple workstreams, they create separate intents for each.

Rationale: workstreams already have their own barrier semantics (`all_repos_accepted`, `interface_alignment`, etc.). Layering intent-level multi-workstream tracking on top of workstream-level barriers creates a second coordination graph. That is unnecessary complexity for the first slice.

---

## Repo-Local Authority Remains Authoritative

The handoff reference is read-only context for the coordinator. It does not grant the coordinator write access to the source repo's intake state.

Specifically:
- The coordinator cannot transition the intent's status. Only `intake resolve` in the source repo can.
- The coordinator cannot modify the acceptance contract. Only `intake approve` (or re-triage) in the source repo can.
- The coordinator's `multi step` generates `COORDINATOR_CONTEXT.md` that includes the handoff charter and acceptance contract as informational context for the dispatched agent. The agent in a sibling repo can read what the intent requires, but cannot close it.

---

## Command: `intake resolve` (Extended)

`intake resolve` already reads `target_run` and maps governed-run status to intent status. The extension:

```
if intent.target_workstream:
  coordinator_state = loadCoordinatorState(intent.target_workstream.coordinator_root)
  assert coordinator_state.super_run_id == intent.target_workstream.super_run_id
  barrier = readBarriers(coordinator_root)[`${workstream_id}_completion`]

  if barrier.status === 'satisfied':
    intent.status = 'completed'
  elif coordinator_state.status == 'blocked':
    intent.status = 'blocked'
  elif coordinator_state.status == 'failed':
    intent.status = 'failed'
  elif coordinator_state.status === 'completed' and barrier.status !== 'satisfied':
    intent.status = 'failed'  # coordinator finished without satisfying the target workstream
  else:
    return { ok: true, no_change: true }  # still executing
```

---

## Coordinator Context Integration

When `multi step` dispatches a turn to any repo in a workstream that has one or more handoff references for the current `super_run_id`, the generated `COORDINATOR_CONTEXT.md` includes:

```markdown
## Intake Handoff

This workstream was initiated by intake intent `<intent_id>` from repo `<source_repo>`.

**Charter:** <charter text>

**Acceptance Contract:**
- <contract item 1>
- <contract item 2>

**Original Signal:** <source_signal_source> — <source_signal_category>

**Evidence:** See `<source_repo>/.agentxchain/intake/events/<event_id>.json`
```

This is informational context, not a behavioral contract. The agent uses it to understand why the workstream exists.

---

## What Starts the Handoff

The operator. Explicitly. There is no automatic escalation from repo-local intake to coordinator.

The sequence is:
1. `intake record` → `intake triage` → `intake approve` → `intake plan` (all in source repo)
2. Operator decides the fix spans repos.
3. `intake handoff <intent_id> --coordinator-root ../coordinator --workstream payment_flow`
4. `cd ../coordinator && agentxchain multi step`

Step 3 is the new surface. Steps 1-2 and 4 are existing.

---

## Acceptance Tests

| # | Test | Pass condition |
|---|---|---|
| AT-HANDOFF-001 | Handoff from `planned` intent to valid workstream | Handoff reference written, intent transitions to `executing`, `target_workstream` set |
| AT-HANDOFF-002 | Handoff rejects non-`planned` intent | Exit code 1, error mentions current status |
| AT-HANDOFF-003 | Handoff rejects missing coordinator root | Exit code 1, error mentions `agentxchain-multi.json` |
| AT-HANDOFF-004 | Handoff rejects unknown workstream | Exit code 1, error mentions workstream name |
| AT-HANDOFF-005 | Handoff rejects repo not in workstream | Exit code 1, error mentions repo ID |
| AT-HANDOFF-006 | `intake resolve` with `target_workstream` returns `completed` when barrier satisfied | Intent transitions to `completed` |
| AT-HANDOFF-007 | `intake resolve` with `target_workstream` returns `blocked` when coordinator blocked | Intent transitions to `blocked` |
| AT-HANDOFF-008 | `intake resolve` with `target_workstream` returns `no_change` when still executing | Intent stays `executing` |
| AT-HANDOFF-009 | Coordinator context includes handoff charter and acceptance contract | `COORDINATOR_CONTEXT.md` contains `## Intake Handoff` section |
| AT-HANDOFF-010 | Handoff rejects when coordinator run is not active | Exit code 1, error mentions coordinator status |
| AT-HANDOFF-011 | `intake resolve` with `target_workstream` returns `failed` when coordinator completes without satisfying the barrier | Intent transitions to `failed` |
| AT-HANDOFF-012 | `intake resolve` rejects coordinator super-run drift | Error mentions `super_run_id mismatch` |

---

## Open Questions

1. **Should `intake handoff` start the coordinator run if none exists?** Current spec says no — the coordinator must have an active run. This forces the operator to `multi init` first. That is explicit but adds a step. Counter-argument: auto-init would violate the principle that coordinator initialization is a deliberate operator action.

2. **Should `intake resolve` work cross-filesystem?** If `coordinator_root` is on a different mount or a remote path, `loadCoordinatorState` will fail. The spec assumes local filesystem adjacency. Remote coordinator resolution would require a different transport, which is out of scope for v1.

3. **Should the handoff reference include the full event payload or just a path?** Current spec uses path references (`evidence_refs`). Full payload embedding would make the reference self-contained but would drift if the event is updated. Path references are consistent with the "source repo owns the artifact" principle.

---

## Non-Goals (Explicit Exclusions)

- **Auto-escalation.** No signal type automatically triggers handoff. The operator decides.
- **Multi-workstream fan-out.** One intent → one workstream. Period.
- **Bidirectional sync.** The coordinator reads the handoff reference. The source repo reads coordinator state via `intake resolve`. Neither writes to the other's intake or governed state.
- **New intake states.** `executing` already covers "work in progress." No `coordinating` or `handed_off` state.
- **Hosted/remote coordinator.** Local filesystem only.
