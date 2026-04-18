# Coordinator Wave Execution Spec

**Status:** completed
**Author:** Claude Opus 4.6 — Turn 137

## Purpose

Unlock `mission plan launch --all-ready` and `mission plan autopilot` for coordinator-bound missions.

These commands were originally fail-closed for coordinator missions (DEC-MISSION-COORD-LAUNCH-005, DEC-MISSION-COORD-LAUNCH-006) because coordinator workstreams complete through barrier satisfaction, not chain reports, so the single-repo wave model could not apply unchanged. This spec defined the coordinator-native wave model that respects barrier semantics while giving operators the same unattended execution surface they already have for single-repo plans. Shipped in v2.134.0.

## Core Concepts

### What is a coordinator wave?

A **wave** is one pass through all `ready` workstreams in a coordinator-bound plan. Within a wave, each ready workstream gets one coordinator dispatch (one `(workstream, repo)` turn). Dispatches within a wave execute **sequentially** — same as single-repo `--all-ready`.

> **Why not parallel dispatch within a wave?** Two reasons:
> 1. Coordinator workstreams may share repos. Parallel dispatch could hit `repo_busy` conflicts.
> 2. The current dispatcher is serial. Parallelism is a future optimization, not a correctness requirement.

### What is a coordinator dispatch?

One call to the existing `launchCoordinatorWorkstream()` path. This dispatches the next assignable `(workstream, repo)` pair, runs the repo-local turn via `local_cli`, and waits for acceptance. This is already implemented and working.

### Wave completion and the next wave

A wave ends when all dispatched workstreams in that wave have either:
- completed their repo-local turn (accepted or failed), OR
- no further repo can be assigned (workstream fully accepted / needs_attention / repo_busy)

After a wave ends, the plan is **re-synchronized** (`synchronizeCoordinatorPlanState`). This:
1. Updates barrier state from acceptance projections
2. Transitions completed workstreams
3. Unblocks dependent workstreams (blocked → ready)
4. Surfaces repo failures as `needs_attention`

If new `ready` workstreams appear, the next wave begins.

### Termination

The wave loop terminates when any of these hold:

| Terminal reason | Exit code | Meaning |
|---|---|---|
| `plan_completed` | 0 | All workstreams completed, all barriers satisfied |
| `failure_stopped` | 1 | A workstream entered `needs_attention` and `--continue-on-failure` is not set |
| `plan_incomplete` | 1 | `--continue-on-failure` was set but work is exhausted with failures remaining |
| `deadlock` | 1 | No ready workstreams, no launched workstreams, but some blocked workstreams remain |
| `wave_limit_reached` | 1 | Hit `--max-waves` ceiling |
| `interrupted` | 1 | SIGINT received |
| `no_ready_workstreams` | 1 | Initial state has no launchable work |

These match the single-repo autopilot terminal reasons exactly.

## Interface

### `mission plan launch --all-ready` (coordinator-bound)

```bash
agentxchain mission plan launch latest --all-ready
```

Behavior for coordinator-bound missions:

1. Load plan + coordinator config + coordinator state.
2. Synchronize plan state from coordinator.
3. Collect all workstreams with `launch_status === 'ready'`.
4. For each ready workstream (sequentially):
   a. Call `launchCoordinatorWorkstream()`.
   b. Wait for the repo-local turn to reach a terminal state (accepted, failed, needs_human).
   c. Re-synchronize plan state to update barriers and completion.
   d. If workstream enters `needs_attention`: stop remaining launches (unless `--continue-on-failure`).
5. After all launches in the batch: final synchronize, print summary, exit.

Output: summary table showing each workstream dispatched, which repo, outcome, and barrier progress.

### `mission plan autopilot` (coordinator-bound)

```bash
agentxchain mission plan autopilot latest [--max-waves N] [--cooldown-seconds N] [--continue-on-failure]
```

Behavior for coordinator-bound missions:

1. Load plan + coordinator config + coordinator state.
2. Enter wave loop:
   a. Synchronize plan state from coordinator.
   b. If plan status is `completed` → exit 0 (`plan_completed`).
   c. Collect ready workstreams. If none:
      - If any launched → wait for them (re-sync after cooldown).
      - If any blocked but none ready/launched → exit 1 (`deadlock`).
      - Otherwise → exit 1 (`no_ready_workstreams`).
   d. For each ready workstream in this wave:
      - Dispatch via `launchCoordinatorWorkstream()`.
      - Wait for repo-local turn terminal state.
      - Re-synchronize plan state.
      - If `needs_attention` and not `--continue-on-failure` → exit 1 (`failure_stopped`).
   e. Increment wave counter. If `>= --max-waves` → exit 1 (`wave_limit_reached`).
   f. Wait `--cooldown-seconds` (default 5). Re-sync. Loop.
3. On SIGINT → exit 1 (`interrupted`).

### Coordinator-specific differences from single-repo autopilot

| Aspect | Single-repo | Coordinator |
|---|---|---|
| Workstream launch | Chain run | Coordinator dispatch + repo-local turn |
| Completion signal | Chain report terminal | Barrier satisfaction |
| Re-sync between waves | Reload plan from disk | `synchronizeCoordinatorPlanState()` |
| Multi-repo within one workstream | N/A | Successive waves dispatch to next unaccepted repo |
| `--continue-on-failure` | Skip to next workstream | Skip to next workstream; `needs_attention` logged |

### Key design constraint: one repo per workstream per wave

A coordinator workstream with N repos (e.g., `api` + `web`) does NOT dispatch all N repos in one wave. Each wave dispatches **one repo** per workstream (the next assignable one per `selectAssignmentForWorkstream`). This means:

- A 2-repo workstream needs at least 2 waves to complete.
- This is correct because repo B may depend on repo A's accepted output (e.g., interface alignment barriers).
- The operator can override this by running `mission plan launch --workstream <id>` manually between waves if they want to force a specific dispatch order.

### Wave summary output

Each wave prints:

```
Wave 1:
  ws-planning  → api  (dev)  → accepted  [barrier: 1/2 repos]
  ws-docs      → web  (pm)   → accepted  [barrier: 1/1 repos — completed]
Wave 2:
  ws-planning  → web  (dev)  → accepted  [barrier: 2/2 repos — completed]
  ws-impl      → api  (dev)  → accepted  [barrier: 1/2 repos]
  ...
```

## Behavior

### Dispatch-wait-sync loop (per workstream within a wave)

```
dispatch(workstream) → wait_for_turn_terminal → sync_plan → check_failure → next
```

**Wait for turn terminal:** The existing `launchCoordinatorWorkstream` path dispatches a `local_cli` turn and returns. The wave executor must then poll for turn completion. This mirrors how `--all-ready` works for single-repo: it runs the chain and waits for the chain report.

For coordinator dispatch, "turn terminal" means the repo-local turn has reached `accepted`, `failed`, `rejected`, `failed_acceptance`, `needs_human`, or `conflicted` status. The wave executor reads `state.json` from the target repo to determine this.

**Sync plan:** After each turn terminal, call `synchronizeCoordinatorPlanState()` to update barriers, accepted repos, workstream statuses, and failure state.

**Check failure:** If the workstream's launch record entered `needs_attention`, the wave executor treats this as a failure for `--continue-on-failure` gating.

### Cross-workstream dependency unblocking

This is already handled by `synchronizeCoordinatorPlanState()`:
- When a workstream's barrier reaches `satisfied`, the workstream becomes `completed`.
- `checkDependencySatisfaction()` then marks dependent workstreams as `ready`.
- The next wave picks them up.

No new dependency logic is needed.

### Retry semantics

This spec does NOT add coordinator-specific retry to autopilot. If a workstream enters `needs_attention`:
- Without `--continue-on-failure`: autopilot stops.
- With `--continue-on-failure`: autopilot skips the failed workstream and continues.

The operator must manually resolve the failure (via `reissue-turn`, `reject-turn`, or `mission plan launch --workstream <id>`) and then re-run autopilot. This matches the single-repo behavior where `needs_attention` is not auto-recovered.

**Rationale:** Auto-retry for coordinator failures is dangerous because the failure may be in repo A while the wave is about to dispatch repo B with context derived from A's (failed) output. Retry must be operator-initiated until we have a coordinator-level retry spec.

### SIGINT handling

Same as single-repo autopilot:
- Set `interrupted = true`.
- Do not dispatch new workstreams.
- Wait for the currently-running turn to finish (do not kill the subprocess).
- Exit 1 with `terminal_reason: 'interrupted'`.

## Error Cases

1. **Coordinator workspace not readable** — fail before first wave with actionable error.
2. **Coordinator state not active** — fail before first wave. The coordinator must be initialized.
3. **Phase mismatch** — if no ready workstream matches the coordinator's current phase, report phase mismatch and exit.
4. **All repos busy** — if every assignable repo in a ready workstream has active turns, skip that workstream for this wave and log a warning. If ALL ready workstreams are skipped for repo_busy, treat it as `deadlock` after a cooldown retry.
5. **Barrier satisfaction race** — if `synchronizeCoordinatorPlanState` discovers a barrier was satisfied by external means (e.g., operator ran `mission plan launch --workstream` in another terminal), the wave executor must pick up the updated state cleanly. This is already handled by reload-from-disk.

## Acceptance Tests

- `AT-COORD-WAVE-001`: `mission plan launch --all-ready` for a coordinator-bound mission dispatches all ready workstreams sequentially and re-syncs barrier state after each dispatch.
- `AT-COORD-WAVE-002`: `mission plan autopilot` runs multiple waves, unblocking dependent workstreams across wave boundaries, and terminates with `plan_completed` when all barriers are satisfied.
- `AT-COORD-WAVE-003`: A 2-repo workstream requires 2 waves to complete (one repo per wave per workstream).
- `AT-COORD-WAVE-004`: `--continue-on-failure` allows autopilot to skip `needs_attention` workstreams and continue dispatching others.
- `AT-COORD-WAVE-005`: Without `--continue-on-failure`, autopilot stops on the first `needs_attention` with `failure_stopped`.
- `AT-COORD-WAVE-006`: SIGINT during a wave finishes the current turn, does not dispatch further, and exits with `interrupted`.
- `AT-COORD-WAVE-007`: `--max-waves` ceiling produces `wave_limit_reached` terminal reason.
- `AT-COORD-WAVE-008`: Deadlock detection fires when blocked workstreams exist but no ready/launched workstreams remain.
- `AT-COORD-WAVE-009`: Wave summary output shows workstream, repo, role, outcome, and barrier progress for each dispatch.
- `AT-COORD-WAVE-010`: Autopilot re-syncs coordinator state between waves, picking up externally-completed workstreams.

## Open Questions

1. **Parallel dispatch within a wave.** Should a future slice allow dispatching multiple ready workstreams concurrently when they target different repos? This would reduce wall-clock time for large multi-repo plans. Answer: defer to a future spec. Sequential is correct-by-default; parallel is an optimization.

2. **Wave-level decision ledger entries.** Should each wave produce a `DEC-WAVE-*` entry, or is per-dispatch `DEC-*` sufficient? Proposal: per-dispatch is sufficient for now. Wave-level entries would be noise without wave-level retry.

3. **Coordinator-level retry within autopilot.** Should a future `--auto-retry` flag allow autopilot to call `reissue-turn` on failed repo-local turns and retry within the same autopilot session? Answer: out of scope for this spec. Requires a separate coordinator retry spec that defines safety boundaries for auto-retry across repos.
