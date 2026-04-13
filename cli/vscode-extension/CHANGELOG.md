# Change Log

All notable changes to the AgentXchain VS Code extension.

## [0.1.1] — 2026-04-12

### Fixed

- Replaced the broken Marketplace placeholder icon with the website's AgentXchain brand mark as a real 128x128 PNG so the Marketplace listing and VS Code extension sidebar render the correct logo.

## [0.1.0] — 2026-04-10

### Added

- **Governed observer mode** — read-only status display via `agentxchain status --json`, including continuity guidance, workflow-kit artifact visibility, and pending gate display.
- **Governed operator mode** — phase transition approval (`approve-transition`), run completion approval (`approve-completion`), step dispatch (`step`), and run launch (`run`) in integrated terminals. Sidebar buttons appear contextually based on governed state.
- **Governed recovery** — session restart via `agentxchain restart` with confirmation dialog. Restart button appears when CLI continuity recommends it.
- **Governed dashboard** — launch browser dashboard via `agentxchain dashboard` in integrated terminal.
- **Governed notifications** — automatic VS Code notifications on state changes: pending phase transition, pending run completion, blocked state, and turn completion. Turn-completion notifications suppressed during active IDE-launched runs.
- **Governed reports** — full governance report rendering via `agentxchain export` piped to `agentxchain report --format json`. Shows project metadata, run status, turn timeline, decision ledger, workflow-kit artifacts, and verification.
- **Legacy mode** — lock-based coordination commands (`claim`, `release`, `generate`) for v3-style workflows. Legacy commands fail closed on governed repos.
- **Activity bar** — AgentXchain sidebar with webview dashboard panel.
- **File watcher** — state-change detection driven by `.agentxchain/` file modifications. No polling.
