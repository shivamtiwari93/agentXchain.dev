# Dashboard Daemon Spec

## Purpose

Give operators a durable way to start the governed local dashboard, leave it running in the background, and stop it cleanly later without keeping a foreground terminal session alive.

The repo already ships a live dashboard bridge with file-watcher invalidation. The missing contract is process lifecycle management. `watch` has a daemon path and PID file; `dashboard` currently does not. That asymmetry makes the dashboard feel disposable instead of operator-grade.

## Interface

### CLI

```bash
agentxchain dashboard [--port <port>] [--no-open] [--daemon]
```

New flag:

- `--daemon`
  - Start the dashboard in a background child process.
  - Implies no browser auto-open for the daemonized child.
  - Prints the child PID and dashboard URL once the bridge is actually listening.

Existing flags remain:

- `--port <port>` default `3847`
- `--no-open`

### Runtime files

- PID file: `.agentxchain-dashboard.pid`
- Session metadata file: `.agentxchain-dashboard.json`

Session metadata shape:

```json
{
  "pid": 12345,
  "port": 3847,
  "url": "http://localhost:3847",
  "started_at": "2026-04-14T15:00:00.000Z"
}
```

### Stop integration

`agentxchain stop` must stop the dashboard daemon in addition to the legacy watch daemon and Claude Code sessions.

## Behavior

### Foreground dashboard

- `agentxchain dashboard` continues to run the bridge in the foreground.
- On successful startup it writes the PID/session files.
- On clean shutdown (`SIGINT`/`SIGTERM`) it removes both files.
- Foreground behavior remains otherwise unchanged.

### Daemon dashboard

- `agentxchain dashboard --daemon` spawns a child `agentxchain dashboard` process with an internal env guard.
- The child starts the bridge, writes the PID/session files after the server is listening, and keeps running in the background.
- The parent waits for the session file or early child exit, then prints:
  - dashboard URL
  - dashboard PID
- The parent exits non-zero if startup fails or times out.

### Existing daemon detection

- If a live dashboard PID already exists, `dashboard --daemon` fails closed instead of spawning a duplicate server.
- If the PID file exists but the process is gone, startup removes the stale files and continues.

### Stop behavior

- `agentxchain stop` sends `SIGTERM` to the dashboard PID when present.
- If only stale dashboard PID/session files exist, `stop` removes them and reports the cleanup.

## Error Cases

1. Missing governed project root: fail as today.
2. Dashboard assets missing: fail as today.
3. Port already in use: daemon startup fails and does not leave a claimed live session.
4. Stale PID/session files: remove them automatically before starting or when `stop` runs.
5. Dashboard session file unreadable: treat as stale metadata, do not trust it.
6. Dashboard startup times out in daemon mode: kill the child, remove partial files, and exit non-zero.

## Acceptance Tests

- `AT-DASH-DAEMON-001`: `agentxchain dashboard --help` documents `--daemon`.
- `AT-DASH-DAEMON-002`: foreground dashboard writes PID/session files after startup and removes them on clean shutdown.
- `AT-DASH-DAEMON-003`: `agentxchain dashboard --daemon --no-open` prints the live PID and URL and leaves a running dashboard daemon behind.
- `AT-DASH-DAEMON-004`: `agentxchain dashboard --daemon` fails when a live dashboard PID already exists.
- `AT-DASH-DAEMON-005`: `agentxchain stop` stops a live dashboard daemon and removes its PID/session files.
- `AT-DASH-DAEMON-006`: `agentxchain stop` removes stale dashboard PID/session files and reports the cleanup.
- `AT-DASH-DAEMON-007`: `/docs/cli` documents the daemon flag and the stop-path lifecycle truthfully.

## Open Questions

1. Should `doctor` report dashboard daemon state for governed projects? Not in this slice.
2. Should the dashboard session file include the mutation token? No. The token remains process-local HTTP session state only.
