# Legacy Stop Command Spec

## Purpose

Define the operator-visible contract for `agentxchain stop`, the legacy IDE-session shutdown command used by local v3-style projects.

## Interface

- CLI command: `agentxchain stop`
- Inputs:
  - nearest `agentxchain.json`
  - optional `.agentxchain-watch.pid`
  - optional `.agentxchain-session.json`

## Behavior

1. The command requires a project root with `agentxchain.json`. If none is found, it exits non-zero.
2. If `.agentxchain-watch.pid` contains a live PID, the command sends `SIGTERM` and reports the stopped watch process.
3. If `.agentxchain-watch.pid` exists but does not point to a live process, the command removes the stale PID file and reports that cleanup.
4. If `.agentxchain-session.json` exists and is valid JSON:
   - it prints a stop summary including launched count and IDE
   - for `claude-code`, it sends `SIGTERM` to each launched agent PID and reports per-agent results
   - for `cursor` and `vscode`, it does not attempt PID shutdown and instead tells the operator to close chat sessions manually
   - it removes `.agentxchain-session.json`
5. If neither a live watch process nor a session file is present, the command reports that no active session was found.

## Error Cases

- Missing project root: exit code `1` with a `No agentxchain.json found` message.
- Invalid or unreadable session JSON: print `Could not read session file.` and return without deleting the file.
- Missing process during PID shutdown (`ESRCH`): treat as already stopped; do not fail the command.

## Acceptance Tests

- `AT-STOP-001`: live watch PID receives `SIGTERM` and exits.
- `AT-STOP-002`: stale watch PID file is deleted and reported.
- `AT-STOP-003`: `claude-code` launched agent PIDs receive `SIGTERM`, and the session file is removed.
- `AT-STOP-004`: `cursor` or `vscode` session prints manual-close guidance and removes the session file.
- `AT-STOP-005`: missing project root exits non-zero with the project-missing message.

## Open Questions

- None.
