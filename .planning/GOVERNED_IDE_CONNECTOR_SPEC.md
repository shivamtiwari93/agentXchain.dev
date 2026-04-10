# Governed IDE Connector Spec

## Purpose

Define what a real governed IDE connector must prove before it can be claimed as a shipped product surface. This spec exists because the current VS Code extension is a legacy lock-based compatibility layer with governed read-only status (`DEC-IDE-BOUNDARY-001` through `004`). Any upgrade from read-only to governed-active must satisfy every acceptance test below.

## Scope

The governed IDE connector is **not a new adapter type**. It is a thin orchestration client that invokes existing CLI commands (`step`, `approve-transition`, `approve-completion`, `status`, `report`, `dashboard`) and renders their output in the IDE. The protocol dispatch path (`step.js` → adapter selection → turn result staging → validation) remains unchanged.

### Current shipped slice

As of 2026-04-10, the observer foundation and operator approval slice are shipped:

- governed project detection
- governed status via `agentxchain status --json`
- governed read-only rendering in the VS Code status command, status bar, and sidebar
- `execCliCommand` shared subprocess helper for all CLI-backed commands
- governed phase transition approval via `agentxchain approve-transition` subprocess call
- governed run completion approval via `agentxchain approve-completion` subprocess call
- sidebar approval action buttons that appear contextually when gates are pending
- modal confirmation dialogs before approval actions
- direct-mutation guard coverage proving governed state is not written by the extension
- 12 approval-specific acceptance tests + 10 existing IDE status tests

The `step`, `run`, `report`, `dashboard`, and `restart` command surfaces below remain the target contract, not shipped truth.

### What the IDE connector IS

- A governed-state observer that reads `.agentxchain/state.json`, `agentxchain.json`, and session/checkpoint data
- An operator action surface for: viewing status, approving phase transitions, approving run completion, viewing reports, and launching the browser dashboard
- A notification surface for: phase changes, blocked states, escalations, turn completions
- A governed-turn dispatch trigger (invokes `agentxchain step` or `agentxchain run` as a subprocess)

### What the IDE connector is NOT

- A new adapter/runtime type (no `ide` entry in `VALID_RUNTIME_TYPES`)
- A direct state mutator (never writes to `.agentxchain/` directly)
- A replacement for the browser dashboard (complex views like barrier ledger, cross-run analytics remain browser-only)
- A turn result author (the IDE does not produce `turn-result.json` — the dispatched adapter does)

## Interface

### Extension Commands (governed mode)

| Command | CLI Equivalent | Write Authority | Description |
|---------|---------------|-----------------|-------------|
| `AgentXchain: Status` | `agentxchain status --json` | read-only | Show governed state in a structured panel |
| `AgentXchain: Approve Phase Transition` | `agentxchain approve-transition` | operator action | Approve a pending phase gate |
| `AgentXchain: Approve Run Completion` | `agentxchain approve-completion` | operator action | Approve pending run completion |
| `AgentXchain: Step` | `agentxchain step` | operator action | Dispatch one governed turn |
| `AgentXchain: Run` | `agentxchain run` | operator action | Start or resume a governed run loop |
| `AgentXchain: Report` | `agentxchain report --format json` | read-only | Show governance report in panel |
| `AgentXchain: Open Dashboard` | `agentxchain dashboard` | read-only | Launch browser dashboard |
| `AgentXchain: Restart` | `agentxchain restart` | operator action | Recover from checkpoint |

### Status Bar

- Governed mode: show `phase → status` (e.g., `planning → active`, `implementation → blocked`)
- Click opens the Status panel
- Color coding: green (active), yellow (pending approval), red (blocked/escalated)

### Sidebar Panel

- Project name, mode, schema version
- Current phase, run status, turn count
- Pending actions (approve-transition, approve-completion) as clickable buttons
- Blocked reason if present
- Workflow-kit artifact status for current phase (exists/missing indicators)
- Last checkpoint timestamp and recommended recovery command

### File System Watcher

- Watch `.agentxchain/state.json` for state changes
- Watch `.agentxchain/staging/` for new turn results
- Watch `.agentxchain/session.json` for checkpoint updates
- Debounce: 500ms minimum between refreshes
- Do not watch `agentxchain.json` (config changes always accompany state changes per `DEC-WK-DASHBOARD-002`)

### Notification Surface

| Event | Trigger | Notification Type |
|-------|---------|-------------------|
| Phase transition pending | `state.queued_phase_transition` appears | Warning with "Approve" action button |
| Run completion pending | `state.queued_run_completion` appears | Warning with "Approve" action button |
| Turn completed | New accepted turn in history | Info |
| Blocked state | `state.blocked === true` | Error with blocked reason |
| Escalation | `state.escalation_active === true` | Error with escalation detail |

## Behavior

### Subprocess Dispatch

All operator actions execute CLI commands as child processes:

```
spawn('agentxchain', ['step', '--dir', workspaceRoot], { cwd: workspaceRoot })
```

The extension captures stdout/stderr and renders output in an IDE output channel. Exit code 0 = success, non-zero = show error notification.

### State Polling vs File Watching

- Primary: `fs.watch` on `.agentxchain/state.json` for instant reactivity
- Fallback: poll `agentxchain status --json` every 10 seconds when file watching is unreliable (network filesystems, containers)
- The extension must not assume file watching always works

### Legacy Coexistence

- Mode detection remains as specified in `IDE_COMPATIBILITY_BOUNDARY_SPEC.md`
- Legacy commands (`claim`, `release`, `generate`) continue to work for legacy projects
- Governed commands are hidden/disabled for legacy projects
- Both modes can coexist across different workspace folders in a multi-root workspace

### Multi-Root Workspace

- Each workspace folder is independently detected as governed or legacy
- Status bar shows the active editor's project state
- Sidebar shows all workspace folders with their respective modes

## Error Cases

1. **No CLI installed**: Show install guidance with `npm install -g agentxchain`
2. **CLI version mismatch**: Warn if extension expects features from a newer CLI version
3. **Subprocess timeout**: 60-second timeout for status/report; no timeout for step/run (long-running)
4. **Concurrent step**: If `step` is already running (exit code from lock), show "turn in progress" instead of spawning a second
5. **Network filesystem**: File watcher may not fire; fallback polling must be robust
6. **Corrupted state**: If `state.json` parse fails, show "state unreadable" and offer `agentxchain restart`

## Acceptance Tests

### AT-GIDE-001: Governed project detection

A workspace with governed `agentxchain.json` and `.agentxchain/state.json` shows governed commands and hides legacy commands.

### AT-GIDE-002: Status rendering

`AgentXchain: Status` invokes `agentxchain status --json` and renders phase, status, turn count, blocked state, and continuity info in a structured panel. The rendered content matches the CLI output.

### AT-GIDE-003: Phase transition approval

When `state.queued_phase_transition` is set, a notification appears with an "Approve" button. Clicking it runs `agentxchain approve-transition` as a subprocess. After success, the status bar updates to reflect the new phase.

### AT-GIDE-004: Run completion approval

When `state.queued_run_completion` is set, a notification appears with an "Approve" button. Clicking it runs `agentxchain approve-completion` as a subprocess. After success, the status bar shows "completed".

### AT-GIDE-005: Step dispatch

`AgentXchain: Step` spawns `agentxchain step` as a child process. Output streams to an IDE output channel. Exit code 0 updates the sidebar. Non-zero shows an error notification with the stderr content.

### AT-GIDE-006: Blocked state notification

When `.agentxchain/state.json` changes to `blocked: true`, a red notification appears showing the `blocked_reason`. The status bar turns red.

### AT-GIDE-007: File watcher reactivity

Mutating `.agentxchain/state.json` externally (e.g., via CLI in terminal) causes the IDE status bar and sidebar to update within 2 seconds without manual refresh.

### AT-GIDE-008: Legacy coexistence

In a multi-root workspace with one governed and one legacy folder, governed commands appear for the governed folder and legacy commands appear for the legacy folder. Neither set leaks into the other.

### AT-GIDE-009: No direct state mutation

The extension never writes to `.agentxchain/`, `agentxchain.json`, or any governed artifact. All mutations go through CLI subprocess calls. This is verifiable by auditing the extension source for `fs.writeFile`, `fs.writeFileSync`, `fs.mkdir`, etc. against governed paths.

### AT-GIDE-010: Workflow-kit artifact visibility

The sidebar shows workflow-kit artifacts for the current phase with exists/missing status, matching the output of `agentxchain status --json`.

### AT-GIDE-011: Checkpoint/continuity visibility

The sidebar shows the last checkpoint timestamp and recommended command from `status --json.continuity`. If a restart is recommended, a "Restart" button appears.

### AT-GIDE-012: Subprocess E2E proof

A test harness must prove the full governed lifecycle through the IDE surface:
1. `init` a governed project
2. `step` via IDE command → turn dispatched and accepted
3. Phase transition requested → notification appears → approve via IDE → phase advances
4. Run completion requested → notification appears → approve via IDE → run completes
5. `report` via IDE command → governance report rendered

This test must use real subprocess dispatch, not mocked extension host APIs.

## Proof Requirements Before Claiming "Governed IDE Support"

1. All 12 acceptance tests pass
2. Extension compiles and packages (`vsce package`) without errors
3. No `fs.writeFile`/`fs.writeFileSync`/`fs.mkdirSync` calls target `.agentxchain/` or governed artifacts
4. Homepage/docs copy updated to describe governed IDE capabilities honestly
5. `IDE_COMPATIBILITY_BOUNDARY_SPEC.md` updated or superseded with a pointer to this spec
6. Extension README updated with governed mode documentation
7. At least one real governed run completed through the IDE surface (not just unit tests)

## Open Questions

1. `agentxchain run` must not execute as a hidden background process. If it ships in the IDE, it should open in an integrated terminal panel so long-running governed loops remain operator-visible and killable. The remaining question is whether to ship `run` at all before `step` + approvals are proven.
2. Should notifications be opt-in or opt-out? Frequent turn completions in a fast run loop could be noisy.
3. Should the extension expose `proposal list|diff|apply` or keep proposal management CLI-only for now?
4. JetBrains / other IDE parity: should the spec require a platform-agnostic core that both VS Code and JetBrains extensions consume, or is VS Code-first acceptable?
