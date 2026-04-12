# Legacy Start Command Spec

## Purpose

Freeze the operator-facing contract for `agentxchain start`, the legacy v3 launcher that selects agents, enforces PM-first kickoff gating, and hands off to IDE-specific launch adapters.

## Interface

Command:

```bash
agentxchain start [--ide cursor|vscode|claude-code] [--agent <id>] [--remaining] [--dry-run]
```

Inputs:

- nearest legacy `agentxchain.json`
- configured legacy agents
- planning artifacts when `--remaining` is used
- IDE adapter availability (`cursor`/`open`, `pbcopy`/`xclip`, `claude`)

Outputs:

- non-zero exit with actionable guidance on invalid selection or blocked kickoff state
- dry-run listing of selected agents without side effects
- IDE-specific launch guidance or side effects for the selected agents

## Behavior

1. `start` fails closed when no legacy project root exists.
2. `start` fails closed when no agents are configured.
3. `--agent <id>` launches only that agent and rejects unknown IDs.
4. `--agent` and `--remaining` are mutually exclusive.
5. `--remaining` validates kickoff readiness in legacy planning mode before launching anything.
6. `--remaining` removes the PM agent from the launch set. If no non-PM agents remain, the command exits non-zero with an explicit tip.
7. `--dry-run` prints the selected agents and exits before any IDE adapter side effects.
8. Plain `start` without `--agent` or `--remaining` prints the PM-first tip when a PM-like agent exists.
9. `--ide vscode` prints usage guidance only; it does not spawn IDE processes or write a session file.
10. `--ide cursor` writes prompt and workspace files for the selected agents. PM kickoff launches use the kickoff prompt variant.
11. `--ide claude-code` spawns detached `claude` sessions for the selected agents and writes `.agentxchain-session.json`.

## Error Cases

- missing `agentxchain.json`
- empty `agents` object
- unknown `--agent`
- `--agent` combined with `--remaining`
- kickoff validation failures for `--remaining`
- zero selected launch agents after PM exclusion
- unknown `--ide`

## Acceptance Tests

- `AT-START-001`: missing project root exits non-zero with init guidance
- `AT-START-002`: empty `agents` exits non-zero
- `AT-START-003`: unknown `--agent` exits non-zero with available IDs
- `AT-START-004`: `--agent` and `--remaining` fail closed together
- `AT-START-005`: `--remaining` fails when PM kickoff validation is incomplete and prints PM signoff guidance
- `AT-START-006`: approved `--remaining --dry-run` excludes PM and lists only remaining agents
- `AT-START-007`: plain `--dry-run` prints the PM-first launch tip
- `AT-START-008`: `--ide vscode --agent <id>` prints VS Code usage guidance
- `AT-START-009`: `--ide cursor --agent pm` writes kickoff prompt/workspace files and uses clipboard/window launch helpers
- `AT-START-010`: `--ide claude-code --agent <id>` writes a session file for launched agents

## Open Questions

- `start` still advertises VS Code custom agents even though `generate` owns the actual `.agent.md` file regeneration path. That legacy surface is acceptable for now but should not be expanded further without a broader legacy-v3 cleanup decision.
