# Lights-Out Operation Guide — Spec

**Status:** Shipped

## Purpose

Ship one operator-facing runbook for repo-local lights-out execution.

The current docs tell the truth about individual features:

- `run --continuous`
- `schedule daemon`
- intake injection
- blocked recovery
- session budgets

But they are fragmented across reference pages and release notes. That is not good enough for real operators. A new user should not have to reconstruct the lifecycle from four docs and three release pages.

This spec freezes a dedicated guide that answers one concrete question:

**How do I take a governed repo from zero to a running continuous session, observe it, recover it, reprioritize it, and stop it without guessing?**

## Interface

### Doc surface

- New docs page: `website-v2/docs/lights-out-operation.mdx`
- Sidebar entry under `Continuous Delivery`
- Supporting reference pages stay separate:
  - `lights-out-scheduling.mdx`
  - `continuous-delivery-intake.mdx`
  - `recovery.mdx`
  - `cli.mdx`

### Audience

- Repo-local operators running AgentXchain in one governed repository
- Not coordinator / multi-repo operators
- Not hosted/cloud control-plane operators

## Behavior

### 1. Freeze the boundary first

The guide must explicitly state:

- repo-local only
- one governed repo with `agentxchain.json`
- multi-repo operators should use `agentxchain multi`, not this guide
- `run --continuous` and `schedule daemon` are related but distinct:
  - `run --continuous` is the single-process loop
  - `schedule daemon` is the poll owner for schedule-driven operation

### 2. Provide a real operator path, not a feature catalog

The guide must walk through:

1. preflight requirements
2. config shape
3. first proof run
4. daemon launch
5. status/observation
6. recovery
7. priority injection
8. stop conditions

The commands must be concrete and copyable.

### 3. Preflight must be operational, not motivational

The guide must require:

- `.planning/VISION.md` exists in the governed project
- `agentxchain doctor`
- `agentxchain connector check`
- a review of approval policy / auto-approval stance
- explicit session-budget guidance

### 4. Dry-run the loop before daemonizing

The guide must recommend a bounded proof run before starting the daemon, using a command shaped like:

```bash
agentxchain run --continuous --vision .planning/VISION.md --max-runs 1
```

This is important because operators should prove that the adapter/runtime/config path is real before turning on unattended scheduling.

### 5. Daemon guidance must include the schedule-owned contract

The guide must show a `schedules.<id>.continuous` config example and explain:

- due-ness starts the session
- later polls advance the same session
- the daemon owns cadence
- status surfaces the active schedule-owned session

### 6. Recovery guidance must be truth-preserving

The guide must document:

- `agentxchain status`
- `agentxchain schedule status`
- blocked session behavior
- `agentxchain unblock <id>`
- paused-session resume on the next daemon poll
- session-budget exhaustion as terminal stop, not blocker

### 7. Priority injection must be part of the runbook

The guide must include:

- `agentxchain inject "..."`
- `--priority p0`
- the fact that injected `p0` takes precedence over new vision seeding

### 8. Stop behavior must be explicit

The guide must describe:

- first `SIGINT` finishes current in-flight work, then stops
- second `SIGINT` hard-aborts
- schedule daemon can be stopped with normal process control

## Error Cases

- The guide drifts into multi-repo advice: fail the content test.
- The guide omits blocked recovery or `unblock`: fail the content test.
- The guide claims session-budget exhaustion is a blocker: fail the content test.
- The guide skips the bounded proof run and jumps straight to daemonization: fail the content test.

## Acceptance Tests

- `AT-LIGHTSOUT-001`: a standalone `lights-out-operation.mdx` page exists and is linked from the `Continuous Delivery` sidebar. ✅
- `AT-LIGHTSOUT-002`: the guide states the repo-local boundary and sends multi-repo operators to `agentxchain multi`. ✅
- `AT-LIGHTSOUT-003`: the guide includes concrete preflight commands (`doctor`, `connector check`) and a bounded `run --continuous --max-runs 1` proof run before daemon launch. ✅
- `AT-LIGHTSOUT-004`: the guide documents schedule-owned continuous config, `agentxchain schedule daemon`, `agentxchain status`, `agentxchain schedule status`, and `agentxchain events --follow`. ✅
- `AT-LIGHTSOUT-005`: the guide documents blocked recovery via `agentxchain unblock <id>`, `p0` injection precedence, session-budget terminal stop, and SIGINT behavior. ✅
- `AT-LIGHTSOUT-006`: `lights-out-scheduling.mdx` links to the new runbook as the end-to-end operator path, preserving page-role separation between runbook and reference. ✅

## Open Questions

- None for this slice. Live-adapter dogfood is a separate credibility proof, not a substitute for operator documentation.
