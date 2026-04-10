# Session Status Surface Spec

**Status:** shipped
**Author:** GPT 5.4 (Turn 20)

## Purpose

Make cross-session continuity operationally visible. Automatic checkpoints and `agentxchain restart` are not enough if an operator returning to a repo cannot see that continuity state from `agentxchain status`.

This slice exposes only what disk proves:

- the current session checkpoint in `.agentxchain/session.json`
- whether that checkpoint is stale relative to `.agentxchain/state.json`
- whether `.agentxchain/SESSION_RECOVERY.md` exists
- whether `restart` is a valid next step for the current run state

Actionability and checkpoint-drift truth are extended by `.planning/CONTINUITY_ACTIONABILITY_SPEC.md`.

## Interface

### Human-readable status

`agentxchain status`

### JSON status

`agentxchain status --json`

New additive JSON field:

- `continuity`
  - `checkpoint`
  - `stale_checkpoint`
  - `recovery_report_path`
  - `restart_recommended`

## Behavior

When a governed project has either `.agentxchain/session.json` or `.agentxchain/SESSION_RECOVERY.md`, `status` renders a `Continuity` section.

If a checkpoint exists, the section shows:

- session id
- checkpoint reason and timestamp
- last turn id
- last role

If the checkpoint `run_id` differs from `state.json` `run_id`, `status` warns that the checkpoint is stale and that `state.json` remains source of truth.

If the run is restartable (`active`, `paused`, or `idle`), `status` surfaces `agentxchain restart` as the continuity action.

If `.agentxchain/SESSION_RECOVERY.md` exists, `status` surfaces that report path.

`status --json` exposes the same continuity facts in machine-readable form.

## Error Cases

- Missing or corrupt `session.json` does not fail `status`; continuity falls back to the recovery report path if present.
- A stale checkpoint does not fail `status`; it warns and continues using `state.json` as source of truth.
- `restart_recommended` is false for terminal or blocked states because `restart` is not a truthful recovery action there.

## Acceptance Tests

- `AT-SSC-001`: `agentxchain status` shows checkpoint fields, restart guidance, and `SESSION_RECOVERY.md` path when continuity artifacts exist.
- `AT-SSC-002`: `agentxchain status` warns when checkpoint `run_id` mismatches `state.json`.
- `AT-SSC-003`: `agentxchain status --json` exposes additive `continuity` metadata with checkpoint, stale flag, recovery report path, and restart recommendation.
- `AT-SSC-004`: `README.md`, `/docs/cli`, and `/docs/multi-session` describe restart/checkpoint visibility truthfully in the same turn.

## Open Questions

None. Dashboard/report integration can consume the additive JSON surface later if operators prove they need continuity state outside the CLI.
