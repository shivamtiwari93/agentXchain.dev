# Legacy Branch Command Spec

## Purpose

Define the operator-visible contract for `agentxchain branch`, the legacy Cursor branch-override command used to inspect or change which git ref launch flows should target.

## Interface

- CLI command: `agentxchain branch [name]`
- Inputs:
  - nearest `agentxchain.json`
  - current local git branch when available
  - optional `cursor.ref` override in `agentxchain.json`
- Flags:
  - `--use-current`
  - `--unset`

## Behavior

1. The command requires a project root with `agentxchain.json`. If none is found, it exits non-zero.
2. With no positional branch name and no flags, it prints the current git branch, the configured Cursor override if present, and the effective branch that launches should use.
3. With a positional branch name, it validates the name, writes `cursor.ref` into `agentxchain.json`, and reports the new override.
4. With `--use-current`, it resolves the active git branch and stores that value in `cursor.ref`.
5. With `--unset`, it removes `cursor.ref`; if `cursor` becomes empty, it removes the empty `cursor` object too.
6. If git branch discovery fails, the command falls back to `main` as the effective git branch.

## Error Cases

- Missing project root: exit code `1` with a `No agentxchain.json found` message.
- `--unset` combined with a branch value or `--use-current`: exit code `1`.
- `--use-current` combined with a branch value: exit code `1`.
- Empty or invalid branch names: exit code `1` with an explanation of allowed characters.

## Acceptance Tests

- `AT-BRANCH-001`: default output reports current git branch and effective branch when no override exists.
- `AT-BRANCH-002`: explicit branch name writes `cursor.ref` and reports the override.
- `AT-BRANCH-003`: `--use-current` stores the current git branch in `cursor.ref`.
- `AT-BRANCH-004`: `--unset` removes `cursor.ref` and deletes an empty `cursor` object.
- `AT-BRANCH-005`: mutually exclusive argument combinations fail closed.
- `AT-BRANCH-006`: invalid branch names are rejected without mutating config.
- `AT-BRANCH-007`: missing project root exits non-zero with the project-missing message.

## Open Questions

- None.
