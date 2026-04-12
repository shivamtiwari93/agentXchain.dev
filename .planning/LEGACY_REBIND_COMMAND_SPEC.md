# Spec: `agentxchain rebind`

## Purpose

Regenerates agent session bindings (prompt files and VS Code/Cursor workspace configs) for one or more agents. Resets auto-nudge dispatch state.

## Interface

```
agentxchain rebind [--agent <id>] [--open]
```

- `--agent <id>` — rebind only the specified agent (default: all agents)
- `--open` — open Cursor editor window(s) after rebinding

## Behavior

1. Load `agentxchain.json`. Fail if missing.
2. Enumerate agents. Fail if none configured.
3. If `--agent` is specified, filter to that agent. Fail if agent ID not found.
4. For each selected agent:
   - Generate `.agentxchain-prompts/{id}.prompt.md` via `generatePollingPrompt()`
   - Generate `.agentxchain-workspaces/{id}.code-workspace` with project root folder and agent ID setting
   - If `--open`, open Cursor with the workspace file
5. Delete `.agentxchain-autonudge.state` if it exists.
6. Print summary showing count and file locations.

## Error Cases

| Condition | Behavior |
|-----------|----------|
| No `agentxchain.json` | Exit 1 with "No agentxchain.json found" |
| No agents configured | Exit 1 with "No agents configured" |
| `--agent` ID not found | Exit 1 with "Agent not found" |

## Acceptance Tests

- `AT-REBIND-001`: missing project root exits non-zero
- `AT-REBIND-002`: no agents configured exits non-zero
- `AT-REBIND-003`: rebind all agents creates prompt and workspace files for each
- `AT-REBIND-004`: `--agent` flag rebinds only the specified agent
- `AT-REBIND-005`: unknown `--agent` ID exits non-zero
- `AT-REBIND-006`: autonudge state file is deleted after rebind
- `AT-REBIND-007`: summary output shows correct count and paths

## Open Questions

None.
