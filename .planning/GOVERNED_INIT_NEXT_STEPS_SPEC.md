# Governed Init Next Steps Spec

## Purpose

`agentxchain init --governed` scaffolds the right files, but the terminal handoff is weaker than the public docs. The docs treat `template validate`, git bootstrap, and an initial scaffold commit as the truthful first steps. The CLI output currently jumps straight to `agentxchain step`, which leaves cold-start operators under-guided.

This slice makes the post-init handoff honest and context-aware.

## Interface

### CLI Surface

```bash
agentxchain init --governed [--dir <path>] [-y]
```

### Output Contract

The governed init summary keeps the existing scaffold/tree output and readiness hints, but the `Next:` block must include:

1. target-directory `cd` guidance when the scaffold target differs from the current working directory
2. `git init` only when the scaffold target is not already inside a git worktree
3. `agentxchain template validate` before the first governed turn
4. `git add -A` and `git commit -m "initial governed scaffold"` before the first governed turn
5. `agentxchain step` and `agentxchain status`

## Behavior

1. The CLI detects whether the scaffold target is already inside a git repo by walking upward from the target directory and looking for `.git`.
2. If no git repo is present, `Next:` includes `git init`.
3. If a git repo is already present, `Next:` omits `git init` but still recommends `git add -A` and `git commit -m "initial governed scaffold"`.
4. `Next:` always includes `agentxchain template validate` before `agentxchain step`.
5. The readiness hints remain truthful:
   - manual roles are named
   - key-backed roles name their required env vars
   - the built-in `manual-qa` fallback remains visible

## Error Cases

| Condition | Behavior |
|---|---|
| target path is inside an existing git worktree | omit `git init` guidance |
| target path is not inside a git worktree | include `git init` guidance |
| target path differs from current working directory | include `cd <target>` guidance before other commands |

## Acceptance Tests

- `AT-INIT-NEXT-001`: fresh governed init output includes `agentxchain template validate`
- `AT-INIT-NEXT-002`: fresh governed init output includes `git init`
- `AT-INIT-NEXT-003`: fresh governed init output includes `git add -A` and `git commit -m "initial governed scaffold"`
- `AT-INIT-NEXT-004`: fresh governed init output still includes `agentxchain step` and `agentxchain status`
- `AT-INIT-NEXT-005`: governed init inside an existing git repo omits `git init`

## Open Questions

None. This is a narrow CLI truth fix.
