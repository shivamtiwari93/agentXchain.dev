# Spec — `agentxchain supervise`

## Purpose

`supervise` is a convenience command that launches the `watch` process and an optional `auto-nudge` subprocess together under a single supervisor. It provides graceful shutdown: Ctrl+C (SIGINT) or SIGTERM kills both children and exits cleanly.

## Interface

```
agentxchain supervise [--autonudge] [--send] [--interval <seconds>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--autonudge` | `false` | Also launch the AppleScript auto-nudge loop |
| `--send` | `false` | Auto-send nudges instead of paste-only (requires `--autonudge`) |
| `--interval` | `3` | Nudge poll interval in seconds (requires `--autonudge`) |

## Behavior

1. **Config check**: calls `loadConfig()`. If no `agentxchain.json` found → print error, `process.exit(1)`.
2. **Platform guard** (only when `--autonudge`): if `process.platform !== 'darwin'` → print error, `process.exit(1)`.
3. **Script existence guard** (only when `--autonudge`): if `scripts/run-autonudge.sh` missing → print error, `process.exit(1)`.
4. **Banner**: prints project root, mode (watch-only or watch+auto-nudge), send mode, interval.
5. **Watch spawn**: spawns `node <cli-bin> watch` as child with `AGENTXCHAIN_WATCH_DAEMON=0`, inherits stdio.
6. **Nudge spawn** (only when `--autonudge`): spawns `bash run-autonudge.sh --project <root> --interval <n> [--send|--paste-only]`.
7. **PID report**: prints PIDs of watch and (optionally) nudge children.
8. **Shutdown handler**: on SIGINT or SIGTERM, sends SIGTERM to all children, waits 200ms, calls `process.exit(0)`. Idempotent (guarded by `shuttingDown` flag).
9. **Child exit handler**: if either child exits unexpectedly (while not shutting down), prints error and triggers shutdown.

## Error Cases

| Condition | Result |
|-----------|--------|
| No `agentxchain.json` | stderr: "No agentxchain.json found", exit 1 |
| `--autonudge` on non-macOS | stderr: "--autonudge currently supports macOS only", exit 1 |
| `--autonudge` with missing script | stderr: "Auto-nudge script not found: <path>", exit 1 |
| Watch child exits unexpectedly | stderr: "Watch process exited unexpectedly (code X)", shutdown |
| Nudge child exits unexpectedly | stderr: "Auto-nudge exited unexpectedly (code X)", shutdown |

## Acceptance Tests

- `AT-SUPERVISE-001`: fails outside a project root (no `agentxchain.json`)
- `AT-SUPERVISE-002`: watch-only mode spawns a child process and prints watch PID
- `AT-SUPERVISE-003`: banner shows correct mode and project
- `AT-SUPERVISE-004`: SIGTERM triggers graceful shutdown (watch child killed)
- `AT-SUPERVISE-005`: watch child unexpected exit triggers supervisor shutdown
- `AT-SUPERVISE-006`: `--interval` flag is passed through correctly (defaults to 3)

## Open Questions

None.
