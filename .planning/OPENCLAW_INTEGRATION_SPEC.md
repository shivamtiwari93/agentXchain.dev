# OpenClaw Integration Spec

## Purpose

Make AgentXchain a first-class option for OpenClaw users in both directions:

- run OpenClaw as a governed agent inside AgentXchain
- expose AgentXchain governance actions inside OpenClaw through a native plugin

The human roadmap names this as a visibility play, but the work still has to obey real interface contracts. The official OpenClaw docs show a plugin SDK and a remote Gateway surface on port `18789`; they do **not** justify inventing a fake integration contract.

## Interface

### 1. OpenClaw inside AgentXchain

- Docs guide under `website-v2/docs/integrations/openclaw.mdx`
- Supported connection paths:
  - `local_cli`
    - command: `openclaw`
    - prompt transport: AgentXchain dispatch bundle rendered into stdin / args according to OpenClaw CLI contract
  - `remote_agent`
    - only if the actual OpenClaw gateway call contract is proven from docs or working traffic capture
    - current verified public docs show remote Gateway defaults at `ws://127.0.0.1:18789`, not a hand-waved REST surface

### 2. AgentXchain inside OpenClaw

- New plugin package in this repo for initial development:
  - proposed path: `plugins/openclaw-agentxchain/`
- Package shape:
  - `package.json`
  - `openclaw.plugin.json`
  - TypeScript entrypoint exporting `definePluginEntry({ register(api) { ... } })`
- Initial tools exposed to OpenClaw:
  - `agentxchain_step`
  - `agentxchain_accept_turn`
  - `agentxchain_approve_transition`

## Behavior

### OpenClaw as governed agent

- The docs must show a working `agentxchain.json` snippet using `local_cli` first.
- The guide must include:
  - prerequisites
  - exact adapter config
  - a minimal working example
  - gotchas around gateway mode and local vs remote assumptions
- `remote_agent` support must not be claimed until the OpenClaw gateway request contract is concrete and testable.

### AgentXchain OpenClaw plugin

- The plugin must use focused SDK subpath imports such as:
  - `openclaw/plugin-sdk/plugin-entry`
- The plugin must register tool functions through `register(api)`, not legacy `activate(api)`.
- Each tool should shell out to the AgentXchain CLI and return structured text output suitable for OpenClaw tool responses.
- Initial plugin scope is governance control, not a full bidirectional state sync layer.

## Error Cases

- Claiming `remote_agent` works over undocumented REST calls when the public docs only prove a WebSocket gateway path.
- Publishing a plugin without a valid `openclaw.plugin.json` manifest or compatibility metadata.
- Registering tools with deprecated monolithic SDK imports.
- Exposing destructive governance actions without explicit argument validation and fail-closed CLI error handling.
- Claiming ClawHub publication without an actual published package URL.

## Acceptance Tests

- Docs:
  - OpenClaw integration page builds clean in Docusaurus.
  - Page includes exact `agentxchain.json` configuration and a runnable example.
- Plugin:
  - package manifest validates structurally
  - TypeScript build passes
  - at least one test proves a registered OpenClaw tool shells out to AgentXchain CLI and returns output
- Proof:
  - if `remote_agent` support is shipped, add a concrete test or proof artifact for the actual gateway contract used

## Open Questions

- What is the documented callable interface for OpenClaw gateway operations that AgentXchain `remote_agent` can safely target? Current docs proof shows `ws://127.0.0.1:18789` remote gateway defaults, SSH tunneling, and gateway call/probe/status commands, but not yet a stable REST request schema.
- Is ClawHub publication possible from this environment without additional account setup? If not, keep the plugin package ready and log the exact publication blocker instead of pretending it shipped.

## Research Notes

- Official docs: `docs.openclaw.ai/plugins/building-plugins`
  - external plugins can be published to ClawHub or npm
  - `openclaw.plugin.json` manifest is required
  - new plugins should use `register(api)` via `definePluginEntry`
- Official docs: `docs.openclaw.ai/plugins/sdk-overview`
  - use focused SDK subpaths, not the deprecated monolithic root import
- Official docs: `docs.openclaw.ai/gateway/remote`
  - remote Gateway default is `ws://127.0.0.1:18789`
  - CLI surfaces (`gateway status`, `gateway probe`, `gateway call`) target that remote endpoint
