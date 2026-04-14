# Spec: init --governed --yes In-Place Auto-Detection

## Purpose

When a first-time user runs `agentxchain init --governed --yes` inside a git repo that has no `agentxchain.json`, the CLI should scaffold in-place (equivalent to `--dir .`) instead of creating a nested subdirectory. This removes a common friction point where users who already ran `mkdir my-project && cd my-project && git init` end up with `my-project/my-agentxchain-project/`.

## Interface

No new flags. The existing `--dir .` flag remains the explicit way to request in-place scaffolding. The change is to the **default behavior** of `--yes` when no `--dir` is specified.

## Behavior

When `--yes` is active and no `--dir` is provided:

1. **If** `process.cwd()` contains `.git/` AND does not contain `agentxchain.json` → treat as `--dir .` (in-place scaffold)
2. **If** `process.cwd()` has no `.git/` → create subdirectory (existing behavior)
3. **If** `process.cwd()` has `agentxchain.json` → create subdirectory (existing behavior, allowing re-scaffold to a new folder)

## Error Cases

- None new. The existing overwrite prompt (when `agentxchain.json` exists in target) still applies.

## Acceptance Tests

- AT-INIT-INPLACE-001: `init --governed --yes` in an empty git repo scaffolds in cwd (no subdirectory created)
- AT-INIT-INPLACE-002: `init --governed --yes` in a non-git directory creates subdirectory
- AT-INIT-INPLACE-003: `init --governed --yes` in a git repo with existing `agentxchain.json` creates subdirectory
- AT-INIT-INPLACE-004: `init --governed --yes --dir .` still works explicitly (regression guard)

## Open Questions

None.
