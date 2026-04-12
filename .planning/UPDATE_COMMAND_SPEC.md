# Spec: `agentxchain update` Command

## Purpose

Self-update command that checks npm for the latest published version of `agentxchain` and installs it globally if a newer version is available.

## Interface

```
agentxchain update
```

No flags. No arguments. No project context required.

## Behavior

1. Read current version from the CLI's own `package.json`.
2. Print the current version.
3. Run `npm view agentxchain version` to fetch the latest published version.
4. **If latest === current:** print "Already on the latest version" and exit 0.
5. **If latest !== current:** print the latest version, then run `npm install -g agentxchain@latest`.
   - On success: print "Updated to {latest}" and exit 0.
   - On failure: print fallback guidance (sudo, prefix fix, npx) and exit 0 (non-fatal).
6. **If `npm view` fails:** print manual install guidance with fallback instructions and exit 0 (non-fatal).

## Error Cases

| Condition | Behavior |
|-----------|----------|
| `npm view` fails (network, registry) | Print fallback guidance, exit 0 |
| `npm install -g` fails (EACCES) | Print permission fix guidance, exit 0 |

Note: the command treats all failures as non-fatal — it prints guidance and exits 0 rather than crashing. This is intentional for a self-update surface.

## Acceptance Tests

- `AT-UPDATE-001`: output includes the current version from `package.json`
- `AT-UPDATE-002`: when `npm view` returns the same version, output includes "Already on the latest version"
- `AT-UPDATE-003`: when `npm view` returns a newer version, output includes "Updating" and the latest version
- `AT-UPDATE-004`: when `npm view` fails, output includes fallback guidance (`npm install -g agentxchain@latest`)
- `AT-UPDATE-005`: when `npm install -g` fails, output includes permission fix guidance

## Open Questions

None. This is a terminal-leaf command with no governance implications.
