# Mission Plan Autopilot Spec

**Status:** completed
**Decision:** `DEC-MISSION-AUTOPILOT-001`

## Purpose

Enable unattended execution of a full mission plan through dependency waves. The operator starts the autopilot, and it loops: launch all ready workstreams → wait for outcomes → re-scan → launch next wave → repeat until the plan completes or a failure stops execution.

This is the product surface identified in `DEC-MISSION-PLAN-LAUNCH-CASCADE-001` as the correct home for unattended dependency-chain execution — a dedicated command with its own contract, not a flag on batch launch.

## Interface

### CLI

```bash
agentxchain mission plan autopilot [plan_id] \
  --mission <mission_id>          # Explicit mission ID (default: latest)
  --max-waves <n>                 # Safety limit on dependency waves (default: 10)
  --continue-on-failure           # Skip failed workstreams, keep launching ready ones
  --auto-approve                  # Auto-approve run gates during execution
  --cooldown <seconds>            # Pause between waves (default: 5)
  --json                          # Output as JSON
  --dir <path>                    # Project directory
```

### Exported function

```js
export async function missionPlanAutopilotCommand(planTarget, opts)
```

## Behavior

### 1. Pre-flight

- Resolve mission and plan (same logic as `--all-ready`)
- Plan must be `approved` or `needs_attention` (with `--continue-on-failure`)
- At least one workstream must be `ready` initially — fail closed if zero ready

### 2. Wave loop

Each iteration ("wave") does:

1. **Scan** — reload plan from disk, call `getReadyWorkstreams(plan)`
2. **Guard** — if zero ready workstreams:
   - If all workstreams are `completed` → plan is done, exit success
   - If any are `needs_attention` and `--continue-on-failure` is off → exit with failure summary
   - If remaining workstreams are `blocked` (dependencies not met) → deadlock, exit with diagnostic
3. **Launch** — for each ready workstream in declaration order:
   - Call `launchWorkstream()` to create launch record
   - Execute via `executeChainedRun()`
   - Record outcome via `markWorkstreamOutcome()`
   - On failure: if `--continue-on-failure`, mark and continue; otherwise stop the wave
4. **Report** — print wave summary (N completed, N failed, N remaining)
5. **Cooldown** — wait `cooldown` seconds before next wave
6. **Wave counter** — increment and check against `--max-waves`; if exceeded, exit with "wave limit reached"

### 3. Terminal conditions

| Condition | Exit code | Message |
|-----------|-----------|---------|
| All workstreams completed | 0 | Plan completed successfully |
| Failure without `--continue-on-failure` | 1 | Workstream X failed, autopilot stopped |
| All launchable work done, some failed (with `--continue-on-failure`) | 1 | `plan_incomplete` — launchable work is exhausted but failed workstreams still need attention |
| Wave limit reached | 1 | Wave limit (N) reached, plan still in progress |
| No ready workstreams on first scan | 1 | No ready workstreams to launch |
| SIGINT | 1 | Autopilot interrupted by operator |
| Deadlock (blocked workstreams, no ready, no running) | 1 | Deadlock: N workstreams blocked with unsatisfiable dependencies |

### 4. Provenance

Each workstream launch records:
```json
{
  "trigger": "autopilot",
  "created_by": "operator",
  "trigger_reason": "mission:<id> workstream:<id> autopilot:wave-<N>"
}
```

### 5. JSON output

```json
{
  "plan_id": "...",
  "mission_id": "...",
  "waves": [
    {
      "wave": 1,
      "launched": ["ws-a", "ws-b"],
      "results": [
        { "workstream_id": "ws-a", "chain_id": "...", "status": "completed" },
        { "workstream_id": "ws-b", "chain_id": "...", "status": "completed" }
      ]
    }
  ],
  "summary": {
    "total_waves": 2,
    "total_launched": 4,
    "completed": 4,
    "failed": 0,
    "terminal_reason": "plan_completed"
  }
}
```

## Error Cases

- Plan not found → fail with message
- Plan not approved → fail with message
- Mission not found → fail with message
- Zero ready workstreams → fail with distribution summary
- `--max-waves` exceeded → fail with progress summary
- Execution error (spawn failure) → mark workstream `needs_attention`, apply failure policy
- SIGINT during execution → record partial outcome, exit 1

## Acceptance Tests

- `AT-AUTOPILOT-001`: Two-wave plan (A→B dependency) completes both waves unattended
- `AT-AUTOPILOT-002`: First-wave failure stops autopilot without `--continue-on-failure`
- `AT-AUTOPILOT-003`: First-wave failure with `--continue-on-failure` skips dependent, launches independent
- `AT-AUTOPILOT-004`: `--max-waves 1` stops after first wave even with ready workstreams remaining
- `AT-AUTOPILOT-005`: Plan already completed → exit success immediately
- `AT-AUTOPILOT-006`: Deadlock detection (all blocked, none ready)
- `AT-AUTOPILOT-007`: JSON output includes wave structure
- `AT-AUTOPILOT-008`: Provenance records `trigger: autopilot` with wave number
- `AT-AUTOPILOT-009`: CLI registration and help text

## Open Questions

None. The cascade rejection spec already identified this as the correct product surface, and the infrastructure (run-chain, mission binding, workstream outcomes, dependency checking) is fully in place.
