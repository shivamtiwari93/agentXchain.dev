# AgentXchain VS Code Extension

This extension provides governed approval actions, step/run launch, restart recovery, governance reports, dashboard launch, notifications, and project status inside VS Code.

## Features

- **Legacy mode:** supports lock-based coordination commands (`claim`, `release`, `generate`) for v3-style IDE-window workflows.
- **Governed mode (observer):** shows read-only status for governed repos by invoking `agentxchain status --json` and rendering the CLI truth inside VS Code. Includes continuity guidance, workflow-kit artifact visibility, and pending gate display.
- **Governed mode (operator):** supports phase transition approval and run completion approval via CLI subprocess calls (`agentxchain approve-transition`, `agentxchain approve-completion`), plus governed step dispatch (`agentxchain step` or `agentxchain step --resume`) and governed run launch (`agentxchain run`) in integrated terminals. Approval, step, and run buttons appear in the sidebar dashboard only when the governed status payload says they are valid.
- **Governed mode (recovery and dashboard):** supports governed restart via CLI subprocess call (`agentxchain restart`) with confirmation, and browser dashboard launch via `agentxchain dashboard` in an integrated terminal. Restart appears contextually in the sidebar when CLI continuity recommends it.
- **Governed mode (notifications):** automatic VS Code notifications when governed state changes: pending phase transition (with "Approve" action), pending run completion (with "Approve" action), blocked state (error notification with reason), and turn completion (info notification). Turn-completion notifications are suppressed while an IDE-launched governed run terminal is active so `agentxchain run` does not spam the operator during a loop. Notifications are driven by file-watcher state diffs — no polling, no duplicate alerts for already-seen gates.
- **Governed mode (report):** renders a full governance report via `agentxchain export` piped to `agentxchain report --format json`. The report shows project metadata, run status, turn timeline with decisions/objections/costs, decision ledger, workflow-kit artifact status, verification, and artifact counts — all sourced from the CLI, not invented by the extension.
- **Not shipped here:** a dashboard replacement inside VS Code, multi-root governed parity, or direct proposal-management workflows.

For additional governed operations, use:

- the browser dashboard for deeper multi-repo and long-run views
- the CLI for proposal workflows and non-IDE automation

## Requirements

Governed mode requires the `agentxchain` CLI to be available on your `PATH`. For local development or tests, you can point the extension at a specific binary with `AGENTXCHAIN_CLI_PATH`.

- VS Code `^1.90.0`
- An AgentXchain repo with `agentxchain.json` in the workspace
- The `agentxchain` CLI installed and reachable on `PATH`, or `AGENTXCHAIN_CLI_PATH` set for local development

## Commands

- `AgentXchain: Show Status` — display governed or legacy project status
- `AgentXchain: Approve Phase Transition` — approve a pending phase transition gate (governed only)
- `AgentXchain: Approve Run Completion` — approve a pending run completion gate (governed only)
- `AgentXchain: Dispatch Governed Step` — launch `agentxchain step` in an integrated terminal (governed only)
- `AgentXchain: Start or Resume Governed Run` — launch `agentxchain run` in an integrated terminal (governed only)
- `AgentXchain: Show Governance Report` — render a full governance report from the current run (governed only)
- `AgentXchain: Restart Governed Session` — reconnect or reactivate a governed run from checkpoint state (governed only)
- `AgentXchain: Open Browser Dashboard` — launch `agentxchain dashboard` in an integrated terminal (governed only)
- `AgentXchain: Claim Lock (Human)` — claim the lock in legacy mode
- `AgentXchain: Release Lock` — release the lock in legacy mode
- `AgentXchain: Generate Agent Files` — generate agent files in legacy mode
- `AgentXchain: Init Project` — initialize a new AgentXchain project

`Claim Lock`, `Release Lock`, and `Generate Agent Files` are intentionally limited to legacy lock-based projects.

## Packaging

The extension package is built from this directory:

```bash
cd cli/vscode-extension
npm run compile
npm run package
```
