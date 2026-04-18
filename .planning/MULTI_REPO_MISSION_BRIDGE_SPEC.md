# Multi-Repo Mission Bridge Spec

**Status:** proposed
**Author:** Claude Opus 4.6 — Turn 123
**Decision:** DEC-MISSION-MULTI-001

## Purpose

Bridge the single-repo `mission` surface and the multi-repo `multi` coordinator so that an operator can start a mission that spans multiple repos and see unified progress through `mission show`.

Currently these surfaces are disconnected:
- `mission` groups chains within one repo
- `multi` coordinates governed runs across repos

Operators managing cross-repo work must switch between `mission show` and `multi status` with no linkage. This spec adds the data binding and CLI surface to unify them.

## Scope Boundary

This spec adds **binding and visibility only**. It does NOT:
- Replace the `multi` command family (those remain the execution surface)
- Add new orchestration logic
- Change how coordinator state works
- Merge mission plans with coordinator workstreams

The coordinator remains the execution engine. The mission becomes the grouping layer that can optionally reference a coordinator.

## Interface

### Data Model

Mission artifact gains an optional `coordinator` field:

```json
{
  "mission_id": "mission-shared-auth",
  "title": "Shared auth library",
  "goal": "Extract auth into a shared library and integrate it in the main app.",
  "status": "active",
  "created_at": "2026-04-17T...",
  "updated_at": "2026-04-17T...",
  "chain_ids": [],
  "coordinator": {
    "super_run_id": "srun_1713400000_abc12345",
    "config_path": "./agentxchain-multi.json",
    "workspace_path": "."
  }
}
```

When `coordinator` is `null` or absent, the mission is single-repo (backward-compatible).

### CLI: `mission start --multi`

```bash
agentxchain mission start \
  --title "Shared auth library" \
  --goal "Extract auth into shared lib" \
  --multi \
  --coordinator-config ./agentxchain-multi.json \
  [--coordinator-workspace .] \
  [--json]
```

Behavior:
1. Creates the mission artifact (same as today)
2. Loads and validates `agentxchain-multi.json` via `loadCoordinatorConfig()`
3. Initializes the coordinator run via `initializeCoordinatorRun()`
4. Binds the coordinator's `super_run_id` to the mission artifact
5. Returns both the mission and coordinator init result

Error cases:
- `--multi` without `--coordinator-config`: error with guidance
- Invalid coordinator config: error from `loadCoordinatorConfig()` validation
- Coordinator init failure: mission is NOT created (atomic — both succeed or neither)

### CLI: `mission show` (enhanced)

When the mission has a `coordinator` binding:

```
Mission: mission-shared-auth
Title:   Shared auth library
Goal:    Extract auth into shared lib
Status:  progressing (multi-repo)

Coordinator
  Super Run:  srun_1713400000_abc12345
  Status:     active
  Phase:      implementation
  Repos:
    auth-lib   active  implementation  gov_171340_abc1
    main-app   active  implementation  gov_171340_def2
  Barriers:
    barrier-api-contract  interface_alignment  satisfied
    barrier-integration   ordered_repo_sequence  pending

Plan: plan-2026-04-17...
  ...existing plan display...
```

JSON output includes `coordinator_status` object with the coordinator state summary.

### CLI: `mission bind-coordinator`

For binding an existing mission to an existing coordinator:

```bash
agentxchain mission bind-coordinator [mission_id] \
  --super-run-id <srun_...> \
  --coordinator-config ./agentxchain-multi.json \
  [--coordinator-workspace .] \
  [--json]
```

## Behavior

### Mission Creation with `--multi`

1. Validate coordinator config first (fail-fast before creating mission)
2. Create mission artifact with `coordinator: null` initially
3. Initialize coordinator run
4. Update mission artifact with coordinator binding
5. If step 3 fails, delete the mission artifact (rollback)

### Mission Show with Coordinator

1. Load mission artifact
2. If `coordinator` field exists, load coordinator state from the workspace path
3. If coordinator state is missing or unreadable, show `coordinator: unreachable` but don't fail
4. Merge coordinator summary into the mission show output
5. The `derived_status` accounts for coordinator status:
   - coordinator `blocked` → mission `needs_attention`
   - coordinator `completed` → mission remains `progressing` (single-repo chains may still be running)

### Backward Compatibility

- Missions without `coordinator` field behave exactly as before
- All existing mission tests pass unchanged
- The `multi` command family is unaffected

## Acceptance Tests

- **AT-MISSION-MULTI-001**: `mission start --multi --coordinator-config <valid>` creates both a mission artifact and coordinator state, and `mission show --json` includes `coordinator_status` with `super_run_id`
- **AT-MISSION-MULTI-002**: `mission start --multi` without `--coordinator-config` exits with error and creates no mission
- **AT-MISSION-MULTI-003**: `mission start --multi --coordinator-config <invalid>` exits with error and creates no mission (atomic rollback)
- **AT-MISSION-MULTI-004**: `mission show` on a coordinator-bound mission includes repo status and barrier summary
- **AT-MISSION-MULTI-005**: `mission show` on a coordinator-bound mission with missing coordinator state shows `coordinator: unreachable` without crashing
- **AT-MISSION-MULTI-006**: `mission bind-coordinator` binds an existing mission to an existing coordinator and `mission show` reflects the binding
- **AT-MISSION-MULTI-007**: `mission list` includes `coordinator` field summary for multi-repo missions
- **AT-MISSION-MULTI-008**: Missions without `coordinator` field are completely unaffected (backward compat)

## Open Questions

1. Should `mission plan` decomposition be aware of multi-repo workstreams? (Deferred — this spec only adds binding, not plan-coordinator integration.)
2. Should `mission plan launch` on a multi-repo mission dispatch via the coordinator? (Deferred — operators use `multi step` for now.)
