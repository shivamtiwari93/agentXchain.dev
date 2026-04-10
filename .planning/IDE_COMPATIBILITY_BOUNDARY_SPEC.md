# IDE Compatibility Boundary Spec

## Purpose

Keep the IDE surface truthful.

Today the in-repo VS Code extension is still the **legacy lock-based coordination** tool for old v3-style workflows, but the governed VS Code slice is no longer read-only. Governed projects now get CLI-backed status, approvals, step/run launch, and state-change notifications in the IDE. The extension is still not a full governed control plane and must not pretend to replace the browser dashboard or broader CLI.

## Interface

- `cli/vscode-extension/src/util.ts`
  - detect project mode as `legacy`, `governed`, or `unknown`
  - expose shared project-surface helpers for the extension UI
- `cli/vscode-extension/src/statusBar.ts`
  - show legacy lock-holder state for legacy projects
  - show governed phase/status for governed projects
- `cli/vscode-extension/src/sidebar.ts`
  - render governed status plus only the CLI-backed actions that are actually valid
- `cli/vscode-extension/src/commands/{claim,release,generate,status}.ts`
  - `claim`, `release`, and `generate` fail closed with a clear governed-mode boundary message
  - `status` remains available for both modes
- `cli/vscode-extension/src/commands/{approve-transition,approve-completion,step,run}.ts`
  - governed actions remain CLI-backed only
  - approvals use subprocess execution
  - step/run use integrated terminals for operator-visible output and killability
- Public docs / marketing
  - homepage copy must describe the IDE surface as legacy compatibility plus a bounded governed operator slice, not a full in-IDE replacement for the dashboard / CLI

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
- Sidebar shows project, mode, phase, run status, blocked reason if present, approval buttons when gates are pending, and step/run launch buttons only when the CLI-backed status contract says they are valid.
- `AgentXchain: Status` shows a governed summary backed by `agentxchain status --json`.
- `AgentXchain: Approve Phase Transition` and `AgentXchain: Approve Run Completion` remain CLI subprocess wrappers, not direct state mutation paths.
- `AgentXchain: Step` and `AgentXchain: Run` launch integrated terminals. They do not run hidden background loops.
- Reports, restart flows, multi-repo operations, and richer governance views remain in browser/CLI surfaces.
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
3. The extension boundary notice explicitly says governed actions remain CLI-backed and points users to the dashboard / CLI for deeper governed surfaces.
4. Homepage copy mentions the shipped governed IDE slice honestly: status, approvals, step/run launch, and notifications.
5. Homepage copy still avoids claiming the IDE is a full governed control plane or a dashboard replacement.

## Open Questions

- `.planning/GOVERNED_IDE_CONNECTOR_SPEC.md` is now the detailed governed contract. This boundary spec remains the high-level honesty guard for legacy-vs-governed positioning and public copy.
