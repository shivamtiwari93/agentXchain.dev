# V3-S3 Spec — Intake Start Bridge

> Standalone implementation spec for the shipped v3 slice that added `agentxchain intake start`, the `planned -> executing` transition, and linkage from a planned intake intent into the existing governed run engine.

---

## Purpose

S1 and S2 can detect work, classify it, approve it, and generate planning artifacts. That is necessary but incomplete. A `planned` intent still has no truthful bridge into governed execution.

S3 closes that gap with one command:

- `agentxchain intake start` — start governed execution for a `planned` intent without inventing a second execution engine

This slice must reuse the existing governed run and dispatch machinery. It must not smuggle in autonomous execution from raw CI or schedule signals.

---

## Interface

### CLI Command

```bash
agentxchain intake start --intent <id> [--role <role>] [--json]
```

**Options:**

- `--intent <id>` — required, the planned intent to start
- `--role <role>` — optional, override the default entry role for the current governed phase
- `--json` — output structured JSON instead of text

### Intent Schema Extension

After S3 starts an intent, the intent file gains three additive fields:

```json
{
  "target_run": "run_1712273200000_a1b2",
  "target_turn": "turn_1712273200100_c3d4",
  "started_at": "2026-04-04T01:12:00Z"
}
```

- `target_run` links the intent to the governed run that owns execution
- `target_turn` links the intent to the first assigned governed turn
- `started_at` records when the intent entered governed execution

### Output Contract

**Text output:**

```text
  Started intent intent_1712173200000_c3d4
  Run:   run_1712273200000_a1b2
  Turn:  turn_1712273200100_c3d4
  Role:  pm
  Status: planned -> executing
```

**JSON output:**

```json
{
  "ok": true,
  "intent": { "...": "..." },
  "run_id": "run_1712273200000_a1b2",
  "turn_id": "turn_1712273200100_c3d4",
  "role": "pm",
  "dispatch_dir": ".agentxchain/dispatch/turns/turn_1712273200100_c3d4"
}
```

---

## Behavior

### State Transition

S3 adds one new transition:

```text
planned -> executing
```

### Execution Contract

1. `intake start` only works in governed projects with a valid `agentxchain.json` and governed `state.json`.
2. The target intent must exist and be in `planned` state.
3. If `intent.planning_artifacts` contains paths, every recorded artifact must still exist on disk before execution begins.
4. The command must reuse governed-run primitives directly. It must not shell out to `agentxchain resume` or `agentxchain step`.
5. Run bootstrap rules:
   - if governed state is `idle` with no `run_id`, initialize a run via the existing governed-state primitive
   - if governed state is `active` with no active turns, reuse the active run
6. Busy-run rules:
   - if any active turn already exists, reject start
   - if the run is `blocked`, reject start
   - if the run is `completed`, reject start
   - if the run is `paused`, reject start because paused remains an approval-held state in the current governed schema
   - if `pending_phase_transition` or `pending_run_completion` is present, reject start
7. Role selection rules:
   - default to the current phase entry role from governed routing
   - allow `--role` override using the same validation rules as governed `resume`
8. After run/bootstrap resolution, assign a governed turn using the existing governed-state assignment primitive and materialize the dispatch bundle.
9. On success, update the intent:
   - `status = "executing"`
   - `target_run = <run_id>`
   - `target_turn = <turn_id>`
   - `started_at = now`
   - append history entry with `from: "planned"`, `to: "executing"`, `run_id`, `turn_id`, and `role`
10. `intake start` does not wait for the turn to finish. Follow-on execution remains on the existing governed surfaces (`step --resume`, `accept-turn`, `reject-turn`, `status`).

### Single-Run Limitation

S3 must document the current engine truth instead of hiding it:

- AgentXchain today behaves like a single-run engine per project state file.
- `intake start` does not solve post-completion run recycling.
- Starting a new intent after a completed governed run is explicitly out of scope for S3.
- S3 does not widen the meaning of `paused`. Relaxing the governed schema to support paused-without-pending intake resume is explicitly rejected for this slice.

---

## Error Cases

1. **No governed project root**: exit 2 with `agentxchain.json not found`
2. **Missing governed state file**: exit 2 with `No governed state.json found`
3. **Intent not found**: exit 2 with `intent <id> not found`
4. **Wrong intent state**: exit 1 with `cannot start from status "<current>" (must be planned)`
5. **Missing recorded planning artifacts**: exit 1 listing the missing paths, no state change
6. **Run already busy with active turns**: exit 1 naming the active turn(s), no state change
7. **Run blocked or awaiting approval**: exit 1 with the governing reason, no state change
8. **Run already completed**: exit 1 with a deterministic message explaining that S3 does not reopen completed runs
9. **Unknown role override**: exit 1 listing available roles
10. **Assignment failure from governed engine**: propagate deterministic error from the governed assignment primitive, no intake intent mutation

---

## Acceptance Tests

- `AT-V3S3-001`: `intake start` on a `planned` intent in an idle governed project initializes a run, assigns the default phase entry role, and transitions the intent to `executing`
- `AT-V3S3-002`: `intake start --role <role>` records the overridden role when the override is valid
- `AT-V3S3-003`: `intake start` on an `approved` or `triaged` intent fails with exit 1 and no mutation
- `AT-V3S3-004`: `intake start` rejects when any recorded planning artifact path is missing on disk
- `AT-V3S3-005`: `intake start` rejects when another active governed turn already exists
- `AT-V3S3-006`: `intake start` rejects when governed state is `blocked`
- `AT-V3S3-007`: `intake start` rejects when governed state is `completed`
- `AT-V3S3-008`: success output includes `run_id`, `turn_id`, and dispatch directory in JSON mode
- `AT-V3S3-009`: success appends an intent-history transition from `planned` to `executing` with linkage fields
- `AT-V3S3-010`: `intake start` rejects a paused run that is awaiting approval instead of pretending paused is intake-resumable

---

## Open Questions

None for S3 itself. Multi-intent scheduling and post-completion run recycling are explicitly deferred beyond this slice.
