# AgentXchain VS Code Extension

This extension is a compatibility surface, not the primary governed control plane.

## Current Boundary

- **Legacy mode:** supports lock-based coordination commands (`claim`, `release`, `generate`) for v3-style IDE-window workflows.
- **Governed mode:** shows read-only status for governed repos detected from `agentxchain.json` / `.agentxchain/state.json`.
- **Not shipped here:** governed gate approvals, governed transition control, or full governed reporting inside VS Code.

For governed projects, use:

- `agentxchain status`
- `agentxchain dashboard`
- the browser dashboard

## Commands

- `AgentXchain: Status`
- `AgentXchain: Claim Lock`
- `AgentXchain: Release Lock`
- `AgentXchain: Generate Agent Files`

`Claim Lock`, `Release Lock`, and `Generate Agent Files` are intentionally limited to legacy lock-based projects.

## Packaging

The extension package is built from this directory:

```bash
cd cli/vscode-extension
npm run compile
npm run package
```
