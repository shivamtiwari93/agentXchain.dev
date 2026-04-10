# IDE Compatibility Boundary Spec

## Purpose

Keep the IDE surface truthful.

Today the in-repo VS Code extension is a **legacy lock-based coordination** tool. It is not a full governed-run control plane. Governed projects should still get useful read-only status in the IDE, but the extension must not pretend it can approve gates, drive governed transitions, or replace the browser dashboard / CLI.

## Interface

- `cli/vscode-extension/src/util.ts`
  - detect project mode as `legacy`, `governed`, or `unknown`
  - expose shared project-surface helpers for the extension UI
- `cli/vscode-extension/src/statusBar.ts`
  - show legacy lock-holder state for legacy projects
  - show governed phase/status in read-only form for governed projects
- `cli/vscode-extension/src/sidebar.ts`
  - render a governed-mode notice instead of a fake legacy dashboard when lock files do not exist
- `cli/vscode-extension/src/commands/{claim,release,generate,status}.ts`
  - `claim`, `release`, and `generate` fail closed with a clear governed-mode boundary message
  - `status` remains available for both modes
- Public docs / marketing
  - homepage copy must describe the IDE surface as legacy compatibility plus governed read-only status, not in-IDE governed approvals

## Behavior

### Mode detection

- Treat a project as `governed` when either:
  - `agentxchain.json` has governed shape (`schema_version`, `roles`, or `compat.lock_based_coordination === false`)
  - `.agentxchain/state.json` exists
- Treat a project as `legacy` when either:
  - `agentxchain.json` has legacy shape (`agents`, string `project`, or `compat.lock_based_coordination === true`)
  - root `lock.json` or root `state.json` exists
- Prefer governed detection when both signals exist.

### Governed extension behavior

- Status bar shows governed mode plus current phase/status when available.
- Sidebar shows project, mode, phase, run status, blocked reason if present, and a clear note:
  - governed approvals, reports, and detailed activity remain in CLI/browser surfaces
- `AgentXchain: Status` shows a read-only governed summary.
- `AgentXchain: Claim Lock`, `Release Lock`, and `Generate Agent Files` must not mutate or scaffold legacy artifacts inside governed projects.

### Legacy extension behavior

- Existing lock-based behavior remains unchanged.
- Claim/release/status continue to read root `lock.json` and `state.json`.

## Error Cases

- No `agentxchain.json`: show the existing “no project” messaging.
- Governed repo with missing `.agentxchain/state.json`: still identify the repo as governed from config shape and show that detailed governed state is unavailable.
- Legacy repo missing `lock.json`: keep the existing lock-not-found failures for legacy commands.

## Acceptance Tests

1. A temp repo with governed `agentxchain.json` and `.agentxchain/state.json` is detected as `governed`.
2. A temp repo with legacy `agentxchain.json`, `lock.json`, and `state.json` is detected as `legacy`.
3. The extension boundary notice explicitly directs governed users to the dashboard / CLI instead of promising in-IDE approvals.
4. Homepage copy does not claim IDE-based governed approvals or “governed workflows into your editor”.
5. Homepage copy still mentions the IDE surface, but as legacy compatibility / read-only governed status rather than a full governed control plane.

## Open Questions

- If a first-class governed IDE connector ships later, add a separate spec rather than mutating this boundary silently.
