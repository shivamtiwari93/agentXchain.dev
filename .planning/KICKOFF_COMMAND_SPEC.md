# Spec: `agentxchain kickoff` Command

## Purpose

Interactive guided wizard that orchestrates the full project kickoff sequence: PM launch → human signoff gate → validation → remaining agent launch → lock release → optional supervisor start.

## Interface

```
agentxchain kickoff [--ide <ide>] [--autonudge] [--send] [--interval <minutes>]
```

- `--ide`: IDE to use for agent launches (default: `cursor`)
- `--autonudge`: enable auto-nudge in supervisor
- `--send`: enable send mode in supervisor
- `--interval`: supervisor poll interval in minutes

## Behavior

1. Load config. If missing → exit 1.
2. Pick PM agent ID (`pm` key, or first agent with "product manager" in name, or first agent).
3. If no PM found → exit 1.
4. Print kickoff banner with project name, PM agent, and IDE.
5. Launch PM agent via `startCommand`.
6. Interactive gate: prompt "Is PM kickoff complete?"
   - No → print paused message, exit.
7. Validate project in kickoff mode.
   - Fail → print errors and exit 1.
8. Launch remaining agents via `startCommand({ remaining: true })`.
9. Interactive gate: prompt "Release human lock now?"
   - Yes → run `releaseCommand`.
   - No → print guidance.
10. If IDE is Cursor and autonudge enabled, prompt "Start supervisor?"
    - Yes → run `superviseCommand`.
    - No → print guidance.

## Error Cases

| Condition | Behavior |
|-----------|----------|
| No `agentxchain.json` | Print error, exit 1 |
| No agents configured | Print error, exit 1 |

## Acceptance Tests

- `AT-KICKOFF-001`: missing project root exits non-zero with init guidance
- `AT-KICKOFF-002`: empty agents exits non-zero
- `AT-KICKOFF-003`: PM agent selection prefers `pm` key
- `AT-KICKOFF-004`: banner shows project name and PM agent ID

## Open Questions

None. The interactive prompts (`inquirer`) cannot be tested via subprocess without TTY mocking. The pre-interactive guard paths are the testable subprocess surface.
