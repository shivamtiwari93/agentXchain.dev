# AgentXchain VS Code Extension

This extension provides governed approval actions and project status inside VS Code.

## Current Boundary

- **Legacy mode:** supports lock-based coordination commands (`claim`, `release`, `generate`) for v3-style IDE-window workflows.
- **Governed mode (observer):** shows status for governed repos by invoking `agentxchain status --json` and rendering the CLI truth inside VS Code. Includes continuity guidance, workflow-kit artifact visibility, and pending gate display.
- **Governed mode (operator):** supports phase transition approval and run completion approval via CLI subprocess calls (`agentxchain approve-transition`, `agentxchain approve-completion`). Approval buttons appear in the sidebar dashboard when gates are pending.
- **Not shipped here:** `agentxchain step`, `agentxchain run`, notification fanout, or full governed reporting inside VS Code.

For additional governed operations, use:

- `agentxchain step`
- `agentxchain dashboard`
- the browser dashboard

Governed mode requires the `agentxchain` CLI to be available on your `PATH`. For local development or tests, you can point the extension at a specific binary with `AGENTXCHAIN_CLI_PATH`.

## Commands

- `AgentXchain: Show Status` — display governed or legacy project status
- `AgentXchain: Approve Phase Transition` — approve a pending phase transition gate (governed only)
- `AgentXchain: Approve Run Completion` — approve a pending run completion gate (governed only)
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
