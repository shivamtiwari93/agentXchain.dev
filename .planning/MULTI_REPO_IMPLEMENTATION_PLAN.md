# Multi-Repo Orchestration — Implementation Plan

> Execution plan for `.planning/MULTI_REPO_ORCHESTRATION_SPEC.md`. Each slice has files, proof surfaces, and acceptance tests.

---

## Governing Decisions

- `DEC-MR-001` through `DEC-MR-007`: See `MULTI_REPO_ORCHESTRATION_SPEC.md`.
- `DEC-MR-IMPL-001`: Implementation proceeds in six slices, each independently testable. No slice ships without its acceptance tests green.
- `DEC-MR-IMPL-002`: The coordinator is a new module (`cli/src/lib/coordinator.js`), not a fork of `governed-state.js`. Repo-local state functions remain untouched.
- `DEC-MR-IMPL-003`: Coordinator config is a new file (`agentxchain-multi.json`), distinct from repo-local `agentxchain.json`. They never share a schema version.
- `DEC-MR-IMPL-004`: All coordinator state lives under `.agentxchain/multirepo/` in the coordinator workspace. Repo-local `.agentxchain/` directories are never mutated by coordinator code.
- `DEC-MR-IMPL-005`: The coordinator workspace is initially a directory on the local filesystem containing `agentxchain-multi.json`. OQ-MR-001 (dedicated control repo vs. anchor repo) is deferred — the implementation is path-based and agnostic to git topology.
- `DEC-MR-IMPL-006`: Normalized coordinator config and state use plain JSON-shaped object maps plus explicit order arrays, not JavaScript `Map`.
- `DEC-MR-IMPL-007`: Coordinator init validates existing governed repos; it does not silently bootstrap repo-local governed projects in v2.
- `DEC-MR-IMPL-008`: Additive changes to repo-local lifecycle modules are allowed when they reduce duplication. Direct adapter duplication is rejected.
- `DEC-MR-IMPL-010`: Init atomicity is coordinator-owned only. If coordinator bootstrap fails after creating a valid repo-local run, the coordinator does not roll that repo-local state back.

---

## Slice 0 — Config Schema & Validation

**Purpose:** Define and validate the coordinator config before any state machine or dispatch code exists.

**Files:**

| File | Description |
|------|-------------|
| `cli/src/lib/coordinator-config.js` | Load, validate, and normalize `agentxchain-multi.json` |
| `cli/test/coordinator-config.test.js` | Validation and normalization tests |

**Interface:**

```js
// coordinator-config.js
loadCoordinatorConfig(workspacePath)
  → { ok, config, errors[] }

validateCoordinatorConfig(raw)
  → { ok, errors[] }

normalizeCoordinatorConfig(raw)
  → { schema_version, project, repo_order[], repos: { [repoId]: { path, default_branch, required } }, workstream_order[], workstreams, routing, gates }

resolveRepoPaths(config, workspacePath)
  → { ok, resolved: { [repoId]: absolutePath }, errors[] }
```

**Behavior:**

1. `agentxchain-multi.json` must exist at workspace root.
2. Every declared `repos[id].path` must resolve to an absolute path relative to the workspace.
3. Every resolved repo path must contain a governed `agentxchain.json` that the normalized config loader recognizes as `protocol_mode: 'governed'`.
4. Workstream `repos` arrays must reference declared repo IDs.
5. Workstream `entry_repo` must be in the workstream's `repos` array.
6. Gate `requires_repos` must reference declared repo IDs.
7. Circular workstream dependencies are rejected.

**Acceptance Tests:**

| ID | Assertion |
|----|-----------|
| AT-MC-001 | Valid two-repo config loads and normalizes without errors |
| AT-MC-002 | Missing `agentxchain-multi.json` returns `{ ok: false }` with clear error |
| AT-MC-003 | Repo path that doesn't exist on disk fails with `repo_path_missing` error |
| AT-MC-004 | Repo path pointing to non-governed project fails with `repo_not_governed` error |
| AT-MC-005 | Workstream referencing undeclared repo ID fails validation |
| AT-MC-006 | Circular workstream dependency (`A depends_on B, B depends_on A`) fails validation |
| AT-MC-007 | Gate referencing undeclared repo ID fails validation |
| AT-MC-008 | `resolveRepoPaths` converts relative paths to absolute using workspace root |

---

## Slice 1 — Coordinator State Machine (Bootstrap + Idle)

**Purpose:** Initialize a multi-repo run, link repo-local runs, and persist coordinator state.

**Files:**

| File | Description |
|------|-------------|
| `cli/src/lib/coordinator-state.js` | State machine: init, pause, resume, status transitions |
| `cli/test/coordinator-state.test.js` | State transition tests |

**Interface:**

```js
// coordinator-state.js
initializeCoordinatorRun(workspacePath, config)
  → { ok, super_run_id, repo_runs: { [repoId]: { run_id, status, phase, initialized_by_coordinator } }, errors[] }

loadCoordinatorState(workspacePath)
  → state | null

saveCoordinatorState(workspacePath, state)
  → void

getCoordinatorStatus(workspacePath)
  → { super_run_id, status, phase, repo_runs, pending_barriers, pending_gate }
```

**State Files Created:**

```
<workspace>/.agentxchain/multirepo/
  ├── state.json
  ├── history.jsonl        (empty at init)
  ├── decision-ledger.jsonl (empty at init)
  ├── barriers.json        (initialized from workstream declarations)
  └── barrier-ledger.jsonl (empty at init)
```

**Behavior:**

1. `initializeCoordinatorRun` validates config via Slice 0.
2. For each declared repo, it reads the repo-local state. If no active run exists, it calls `initializeGovernedRun` on the repo. If an active run exists, it links it.
3. A `super_run_id` is generated (`srun_<timestamp>_<random>`).
4. All declared barriers from workstream configs are written to `barriers.json` with `status: "pending"`.
5. Coordinator state is persisted to `state.json`.
6. A `run_initialized` entry is appended to coordinator `history.jsonl`.
7. If any required repo fails validation or initialization, the entire init fails atomically at the coordinator layer — no partial coordinator state is written.
8. Repo-local runs created before a later coordinator bootstrap failure are not rolled back. Repo-local state remains authoritative and independently valid.

**Acceptance Tests:**

| ID | Assertion |
|----|-----------|
| AT-CS-001 | Two-repo initialization creates `super_run_id`, links both repo-local runs, writes all 5 coordinator state files (AT-MR-001) |
| AT-CS-002 | Init with existing repo-local run links it without re-initializing |
| AT-CS-003 | Init with one repo failing validation writes no coordinator state (atomic failure) |
| AT-CS-004 | `loadCoordinatorState` returns null for workspace with no coordinator state |
| AT-CS-005 | `getCoordinatorStatus` returns the full status snapshot after successful init |
| AT-CS-006 | `barriers.json` is populated from workstream declarations at init |
| AT-CS-007 | `history.jsonl` contains a `run_initialized` entry after successful init |

---

## Slice 2 — Assignment & Dispatch (Cross-Repo Context)

**Purpose:** Select assignable workstreams, generate cross-repo context artifacts, and dispatch repo-local turns.

**Files:**

| File | Description |
|------|-------------|
| `cli/src/lib/coordinator-dispatch.js` | Workstream selection, context generation, repo-local dispatch delegation |
| `cli/src/lib/cross-repo-context.js` | Generate `COORDINATOR_CONTEXT.json` and `COORDINATOR_CONTEXT.md` |
| `cli/test/coordinator-dispatch.test.js` | Dispatch and context artifact tests |

**Interface:**

```js
// coordinator-dispatch.js
selectNextAssignment(workspacePath, state, config)
  → { ok, workstream_id, repo_id, role, reason } | { ok: false, reason }

dispatchCoordinatorTurn(workspacePath, state, config, assignment)
  → { ok, repo_id, turn_id, bundle_path, context_ref }

// cross-repo-context.js
generateCrossRepoContext(workspacePath, state, config, targetRepoId, workstreamId)
  → { contextRef, jsonPath, mdPath }
```

**Behavior:**

1. `selectNextAssignment` evaluates every workstream against:
   - Phase eligibility (workstream phase matches or is behind global phase)
   - Dependency satisfaction (all `depends_on` workstreams are complete or at required barrier state)
   - Barrier satisfaction (no `pending` barriers block the target repo)
   - Repo availability (target repo is not blocked and has no conflicting active turn)
2. When upstream dependencies exist, `generateCrossRepoContext` reads accepted projections from coordinator history, active barrier state, and required follow-ups. It writes:
   - `COORDINATOR_CONTEXT.json` into the repo-local dispatch bundle directory
   - `COORDINATOR_CONTEXT.md` (human-readable companion)
3. The coordinator then delegates to the existing `writeDispatchBundle()` for the target repo, adding the cross-repo context artifacts to the bundle.
4. Stale context detection: if a pending repo-local turn exists and upstream has changed since the last context generation, the turn is marked for re-dispatch with a fresh `context_ref`.

**Acceptance Tests:**

| ID | Assertion |
|----|-----------|
| AT-CD-001 | Workstream with unsatisfied dependency barrier is not selectable |
| AT-CD-002 | Workstream with all barriers satisfied is selectable |
| AT-CD-003 | Assignment to blocked repo is rejected with `repo_blocked` reason |
| AT-CD-004 | `COORDINATOR_CONTEXT.json` contains upstream acceptance projections and barrier state (AT-MR-008) |
| AT-CD-005 | `COORDINATOR_CONTEXT.md` is a readable summary of the JSON context |
| AT-CD-006 | Stale context triggers re-dispatch with fresh `context_ref` |
| AT-CD-007 | Independent workstream remains assignable when unrelated workstream is blocked (AT-MR-006) |
| AT-CD-008 | Entry repo is selected first when a workstream has an `entry_repo` declaration |
| AT-CD-009 | `ordered_repo_sequence` barrier prevents downstream repo assignment before upstream acceptance (AT-MR-003) |

---

## Slice 3 — Acceptance Projection & Barrier Evaluation

**Purpose:** After a repo-local turn is accepted, project the result into coordinator state and evaluate barrier effects.

**Files:**

| File | Description |
|------|-------------|
| `cli/src/lib/coordinator-acceptance.js` | Projection, barrier update, context invalidation |
| `cli/test/coordinator-acceptance.test.js` | Acceptance and barrier transition tests |

**Interface:**

```js
// coordinator-acceptance.js
projectRepoAcceptance(workspacePath, state, config, repoId, acceptedTurn, workstreamId)
  → { ok, projection_ref, barrier_effects[], context_invalidations[] }

evaluateBarriers(workspacePath, state, config)
  → { barriers: { [barrierId]: barrierState }, changes: object[] }

recordBarrierTransition(workspacePath, barrierId, previousStatus, newStatus, causation)
  → void
```

**Behavior:**

1. When a repo-local `acceptGovernedTurn` succeeds, the coordinator:
   a. Creates a derived projection entry with `super_run_id`, `repo_id`, `workstream_id`, `summary`, `files_changed`, `decisions`, `barrier_effects`.
   b. Appends the projection to coordinator `history.jsonl`.
   c. Evaluates barrier effects in the same call so projection and barrier state cannot drift between steps.
2. `evaluateBarriers` remains available as a standalone full-snapshot rebuild path for recovery/resync.
3. Acceptance rejects any declared path that resolves outside the target repo root, including relative traversal (`../other-repo/...`) and absolute paths into another declared repo.
4. `evaluateBarriers` scans all declared barriers:
   - `all_repos_accepted`: satisfied when every repo in the workstream has at least one accepted turn in the current phase.
  - `interface_alignment`: satisfied when all repos have accepted the explicit `interface_alignment.decision_ids_by_repo` decision IDs declared for that workstream.
   - `ordered_repo_sequence`: satisfied when the upstream repo has an accepted turn in the current phase.
   - `shared_human_gate`: satisfied only by explicit human approval via coordinator command.
5. Barrier state changes are written to both `barriers.json` (snapshot) and `barrier-ledger.jsonl` (audit trail).
6. If a barrier change invalidates a pending downstream context, the coordinator marks the downstream turn for re-dispatch.

**Acceptance Tests:**

| ID | Assertion |
|----|-----------|
| AT-CA-001 | Repo-local acceptance produces a coordinator projection in `history.jsonl` without mutating repo-local history (AT-MR-007) |
| AT-CA-002 | Barrier moves from `pending` to `partially_satisfied` when one of two required repos accepts, and to `satisfied` when both accept |
| AT-CA-003 | Each barrier transition is recorded in `barrier-ledger.jsonl` with previous/new status and causation (AT-MR-010) |
| AT-CA-004 | `ordered_repo_sequence` barrier becomes `satisfied` only after the upstream repo's acceptance |
| AT-CA-005 | `shared_human_gate` barrier is NOT auto-satisfied by repo-local acceptances |
| AT-CA-006 | Cross-repo write violation (agent modifies files in non-target repo) is rejected at acceptance (AT-MR-002) |
| AT-CA-007 | Upstream acceptance that invalidates a downstream context marks the downstream turn for re-dispatch (AT-MR-004) |
| AT-CA-008 | `barriers.json` snapshot matches the cumulative result of all `barrier-ledger.jsonl` transitions |

---

## Slice 4 — Phase Gates & Completion

**Purpose:** Global phase advancement and initiative completion without coupling gate logic to divergence repair.

**Files:**

| File | Description |
|------|-------------|
| `cli/src/lib/coordinator-gates.js` | Phase gate evaluation, completion gate, human approval |
| `cli/test/coordinator-gates.test.js` | Gate and completion tests |

**Interface:**

```js
// coordinator-gates.js
evaluatePhaseGate(workspacePath, state, config, targetPhase?)
  → { ready, current_phase, target_phase, gate_id, required_repos[], workstreams[], blockers[], human_barriers[] }

requestPhaseTransition(workspacePath, state, config, targetPhase)
  → { ok, state, gate, evaluation }

approveCoordinatorPhaseTransition(workspacePath, state, config)
  → { ok, state, transition }

evaluateCompletionGate(workspacePath, state, config)
  → { ready, gate_id, required_repos[], blockers[], human_barriers[], requires_human_approval }

requestCoordinatorCompletion(workspacePath, state, config)
  → { ok, state, gate, evaluation }

approveCoordinatorCompletion(workspacePath, state, config)
  → { ok, state, completion }

```

**Behavior — Phase Gates:**

1. A global phase can advance only when:
   - Every required repo for active workstreams has drained active turns.
   - Repo-local exit gates are satisfied (read from repo-local state).
   - All non-human barriers for the phase are `satisfied`.
   - Any `shared_human_gate` is surfaced as a human approval dependency on the pending coordinator gate.
2. `requestPhaseTransition` persists `pending_gate` in coordinator `state.json`, pauses the coordinator, and appends a `phase_transition_requested` entry to coordinator `history.jsonl`.
3. `approveCoordinatorPhaseTransition` marks any pending `shared_human_gate` barriers as satisfied, advances the phase, clears `pending_gate`, and records the approval in coordinator history.

**Behavior — Completion:**

1. Initiative completion requires:
   - Each required repo has a completed repo-local run or a pending repo-local completion approval.
   - No repo is in `blocked` state.
   - Human completion approval.
2. `requestCoordinatorCompletion` pauses the coordinator with a `run_completion` pending gate after the structural checks pass.
3. `approveCoordinatorCompletion` marks the coordinator `completed`, clears `pending_gate`, and records the approval in history.

**Acceptance Tests:**

| ID | Assertion |
|----|-----------|
| AT-CG-001 | Phase gate blocks when one required repo has an active turn |
| AT-CG-002 | Phase gate blocks when a barrier is `partially_satisfied` |
| AT-CG-003 | Phase transition request pauses for approval, then approval advances the phase (AT-MR-005) |
| AT-CG-004 | Completion gate blocks when one required repo is `blocked` |
| AT-CG-005 | Completion request pauses for approval, then approval completes the initiative |
| AT-CG-006 | Approving a phase transition satisfies pending `shared_human_gate` barriers for that phase |

---

## Slice 5 — Recovery & Coordinator Hooks

**Purpose:** Detect divergence, rebuild coordinator state from repo-local authority, and enforce coordinator-scoped hooks.

**Files:**

| File | Description |
|------|-------------|
| `cli/src/lib/coordinator-recovery.js` | Divergence detection and re-sync from repo-local authority |
| `cli/src/lib/coordinator-hooks.js` | Coordinator-scoped hook execution (4 phases) |
| `cli/test/coordinator-recovery.test.js` | Divergence and re-sync tests |
| `cli/test/coordinator-hooks.test.js` | Coordinator hook scope tests |

**Interface:**

```js
// coordinator-recovery.js
detectDivergence(workspacePath, state, config)
  → { diverged, mismatches[] }

resyncFromRepoAuthority(workspacePath, state, config)
  → { ok, resynced_repos[], errors[] }

// coordinator-hooks.js
fireCoordinatorHook(workspacePath, phase, payload)
  → { verdicts[] }
```

**Behavior — Divergence Recovery:**

1. `detectDivergence` compares coordinator `state.json` expectations against each repo-local `state.json`.
2. Mismatches: coordinator thinks turn is active but repo says accepted/rejected; coordinator thinks run is active but repo says completed.
3. `resyncFromRepoAuthority` re-reads all repo-local state, rebuilds projections and barrier snapshots from repo-local history + `barrier-ledger.jsonl`, appends `state_resynced` to coordinator history.
4. If rebuild fails (ambiguous state), coordinator enters `blocked` with explicit mismatch details.
5. **Invariant:** re-sync never writes to repo-local state. Repo-local runs are authoritative.

**Behavior — Coordinator Hooks:**

1. Four phases only: `before_assignment`, `after_acceptance`, `before_gate`, `on_escalation`.
2. Hook payloads include `super_run_id`, `workstream_id`, `repo_id`, `pending_barriers`, `pending_gate`.
3. Hooks may NOT mutate repo-local state, repo-local history, or repo-local dispatch bundles.
4. `before_assignment` and `before_gate` are blocking. `after_acceptance` and `on_escalation` are advisory.

**Acceptance Tests:**

| ID | Assertion |
|----|-----------|
| AT-CR-001 | Divergence detected when coordinator says `active` but repo says `accepted` (AT-MR-009) |
| AT-CR-002 | Re-sync rebuilds coordinator projections from repo-local history without mutating repo-local state (AT-MR-009) |
| AT-CR-003 | Re-sync appends `state_resynced` to coordinator history |
| AT-CR-004 | Ambiguous divergence enters `blocked` with mismatch details |
| AT-CR-005 | Coordinator hook on `after_acceptance` that attempts repo-local mutation is rejected and restored (AT-MR-011) |
| AT-CR-006 | `before_assignment` hook block prevents dispatch |
| AT-CR-007 | `before_gate` hook block prevents phase advancement |
| AT-CR-008 | `on_escalation` fires when coordinator enters blocked state |
| AT-CR-009 | Full coordinator hook composition preserves order and payload contract across multi-repo lifecycle |

---

## Slice 6 — CLI Commands & E2E Proof

**Purpose:** Expose multi-repo orchestration via CLI commands and prove the full lifecycle end-to-end.

**Files:**

| File | Description |
|------|-------------|
| `cli/src/commands/multi.js` | `agentxchain multi <subcommand>` — coordinator CLI surface |
| `cli/test/e2e-multi-repo.test.js` | Full lifecycle E2E: init → dispatch → accept → barrier → gate → complete |
| `cli/test/multi-cli.test.js` | CLI subprocess tests for multi commands |

**CLI Surface:**

```
agentxchain multi init [--workspace <path>]
agentxchain multi status [--json] [--workspace <path>]
agentxchain multi step [--json] [--workspace <path>]
agentxchain multi approve-gate [--workspace <path>]
agentxchain multi resync [--workspace <path>]
```

**E2E Proof Scenario:**

1. Create two temp repos, each with governed init.
2. Create a coordinator workspace with `agentxchain-multi.json` declaring both repos, one workstream with `ordered_repo_sequence`.
3. `multi init` → verify `super_run_id`, both repos linked.
4. `multi step` → dispatches to entry repo with role from routing.
5. Manually stage and accept the repo-local turn.
6. `multi step` → first reconciles repo-local truth, projects any unprojected acceptances, evaluates barriers, then dispatches to the second repo with `COORDINATOR_CONTEXT.json`.
7. Manually stage and accept the second repo-local turn.
8. `multi step` → requests the next pending coordinator gate when the phase or run is ready to advance.
9. `multi approve-gate` → global phase advances or initiative completes, depending on the pending gate.
10. Complete remaining phases until `initiative_ship` is approved.
11. Verify: coordinator `history.jsonl` has projections for both repos. `barrier-ledger.jsonl` has full transition audit. No repo-local state was mutated by coordinator code.

**Acceptance Tests:**

| ID | Assertion |
|----|-----------|
| AT-CE-001 | `multi init` CLI creates coordinator state with linked repo runs |
| AT-CE-002 | `multi status` CLI shows coordinator phase, repo statuses, and barrier state |
| AT-CE-003 | `multi step` CLI dispatches to the correct repo based on barrier evaluation |
| AT-CE-004 | `multi step` requests the next coordinator gate once the current phase or final completion conditions are satisfied |
| AT-CE-005 | `multi approve-gate` advances the global phase or completes the initiative once all conditions are met |
| AT-CE-006 | Full E2E lifecycle from init to completion with two repos, one workstream, and ordered barrier |
| AT-CE-007 | `multi resync` CLI recovers from diverged coordinator state |

---

## Implementation Order & Dependencies

```
Slice 0 (Config)
  └── Slice 1 (State Machine)
       ├── Slice 2 (Dispatch)
       │    └── Slice 3 (Acceptance)
       │         ├── Slice 4 (Gates + Completion)
       │         └── Slice 5 (Recovery + Hooks)
       └──────────────────── Slice 6 (CLI + E2E)
```

- Slices 0 and 1 have no dependencies on existing code beyond the existing config/normalization helpers.
- Slice 2 depends on `dispatch-bundle.js` (existing) for repo-local dispatch delegation.
- Slice 3 depends on `governed-state.js` (existing) for reading accepted turns.
- Slice 4 depends on barrier projection from Slice 3.
- Slice 5 depends on `hook-runner.js` (existing) for hook execution patterns and on Slice 3 barrier/history data.
- Slice 6 depends on all prior slices.

**Key constraint:** Prefer new coordinator modules, but allow additive changes to existing repo-local modules when that is the lower-risk seam for reuse. Direct adapter duplication is a design smell; small extensions to `step` / `dispatch-bundle` to carry coordinator context are acceptable.

---

## Open Questions Carried Forward

| ID | Question | Tentative Answer |
|----|----------|-----------------|
| OQ-MR-001 | Where does the coordinator workspace live? | Local directory for v2. Dedicated git repo is a v3 concern. |
| OQ-MR-002 | Cross-repo branch coordination? | Not in v2. Repo-local branching is repo-local. |
| OQ-MR-003 | Simultaneous authoritative turns in different repos? | Closed by DEC-MR-008. All dispatched turns remain repo-scoped in v2; no cross-repo review dispatch. |
| OQ-MR-004 | CI aggregation? | Repo-local verification rolls up into projections. Coordinator does not run CI. |
| OQ-MR-005 | How does `multi step` interact with `api_proxy` and `local_cli` adapters? | Closed by DEC-MR-009. Reuse the repo-local single-turn lifecycle; coordinator context is additive, not adapter-direct. |
| OQ-MR-006 | Does `multi status --json` include repo-local turn details or just summaries? | Summaries for v2. Full detail is a dashboard concern. |

---

## Risk Register

| Risk | Mitigation |
|------|-----------|
| Coordinator state drift from repo-local truth | Slice 5 divergence recovery + `state_resynced` audit entry |
| Stale cross-repo context leading to incorrect downstream work | Slice 2 stale context detection + mandatory re-dispatch |
| Barrier evaluation complexity growing with new barrier types | v2 ships with 4 barrier types only. New types require spec amendment. |
| Coordinator crash mid-acceptance-projection leaves partial state | Acceptance projection is a single atomic write to coordinator state. If it fails, repo-local state is still authoritative and re-sync recovers. |
| Hook mutation of repo-local state from coordinator context | Coordinator hooks reject repo-local writes by path containment check (reuse of existing protected-path pattern from hook-runner.js) |
