# Demo Handoff Discoverability Spec

**Status:** shipped
**Author:** Claude Opus 4.6 — Turn 55
**Decision:** DEC-DEMO-HANDOFF-001

## Purpose

The `agentxchain demo` completion output is the highest-traffic handoff in the product. After watching a governed PM → Dev → QA lifecycle run, the operator is primed to try it on their own project. The current handoff under-routes: it points to `agentxchain init --governed` and two doc links but omits the `--goal` flag (mission context) and `agentxchain doctor` (readiness check).

## Current State

```
Try it for real:  agentxchain init --governed
Step by step:    https://agentxchain.dev/docs/getting-started
Read more:       https://agentxchain.dev/docs/quickstart
```

## Problems

1. **No `--goal`**: The operator does not learn that `init --governed --goal "..."` sets the project mission that every agent sees in dispatch bundles. Without it, the first governed run starts without mission context.
2. **No `doctor`**: The operator does not learn that `agentxchain doctor` validates the project is ready before the first governed turn. Without it, the first `agentxchain run` may fail on missing prerequisites.
3. **Doc links as primary handoff**: The two doc links are the most prominent next-steps, but operators who just watched a CLI demo want CLI actions, not reading.

## Required Changes

### Demo completion output (after Summary block)

Replace the three-line handoff with a four-step guided path:

```
  Next steps:

  1. Scaffold     agentxchain init --governed --goal "Your project mission"
  2. Verify       agentxchain doctor
  3. First turn   agentxchain run

  Docs:           https://agentxchain.dev/docs/quickstart
```

### Design Rationale

- **Step 1 (init --governed --goal)**: Shows the real init command with `--goal` so the operator understands mission context is a first-class concept.
- **Step 2 (doctor)**: Readiness check before the first governed turn — catches missing git, bad config, missing prompts.
- **Step 3 (run)**: The actual governed execution command. This is the destination.
- **Docs**: One link only. The quickstart covers both getting-started and full workflow.

### JSON mode

No change to JSON output structure. The handoff text is human-only.

## Acceptance Tests

- `AT-DH-001`: Demo completion output contains `agentxchain init --governed --goal` (shows goal flag).
- `AT-DH-002`: Demo completion output contains `agentxchain doctor` (shows readiness check).
- `AT-DH-003`: Demo completion output contains `agentxchain run` (shows execution command).
- `AT-DH-004`: Demo completion output contains "Next steps" as the handoff header.
- `AT-DH-005`: All three assertions hold in subprocess E2E (`node bin/agentxchain.js demo` stdout).

## Open Questions

None.
