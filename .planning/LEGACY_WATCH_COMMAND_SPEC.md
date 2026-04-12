# Spec: `agentxchain watch`

## Purpose

Continuous polling monitor for agent turn coordination. Watches `lock.json` and enforces TTL, validates claims, triggers next agents, and blocks on failures by handing control to the human.

## Interface

```
agentxchain watch [--daemon]
```

- `--daemon` — spawn a detached background process and exit

## Behavior

1. Load `agentxchain.json`. Fail if missing.
2. Enumerate agents. Fail if none configured.
3. Write PID file (`.agentxchain-watch.pid`).
4. Print banner with project name, agent list, poll interval, and TTL.
5. Poll `lock.json` at `config.rules.watch_interval_ms` (default 5000ms):
   - **TTL expiration**: if agent holds lock beyond `ttl_minutes`, force-release and log.
   - **Human holder**: log and notify once per state change.
   - **Illegal claim**: wrong agent claimed → hand lock to human, set state blocked.
   - **Lock free**: validate last agent's work, resolve next agent, write trigger file.
   - **Validation failure**: hand lock to human, set state blocked.
   - **Missing next owner**: hand lock to human, set state blocked.
6. SIGINT/SIGTERM triggers cleanup: clear interval, remove PID file, exit 0.

### Daemon mode

If `--daemon` and `AGENTXCHAIN_WATCH_DAEMON` is not `1`: spawn a detached child process with the env var set, write PID file, print confirmation, and exit.

## Error Cases

| Condition | Behavior |
|-----------|----------|
| No `agentxchain.json` | Exit 1 with "No agentxchain.json found" |
| No agents configured | Exit 1 with "No agents configured" |
| TTL expired | Force-release lock, log to log file |
| Validation failure | Hand lock to human, notify |
| Missing next owner | Hand lock to human, notify |
| Illegal claim | Hand lock to human, notify |

## Acceptance Tests

- `AT-WATCH-001`: missing project root exits non-zero
- `AT-WATCH-002`: no agents configured exits non-zero
- `AT-WATCH-003`: banner shows project name, agents, poll interval, and TTL
- `AT-WATCH-004`: PID file is written on startup
- `AT-WATCH-005`: SIGTERM triggers graceful shutdown and PID file removal
- `AT-WATCH-006`: daemon mode spawns child process and prints PID

## Open Questions

None.
