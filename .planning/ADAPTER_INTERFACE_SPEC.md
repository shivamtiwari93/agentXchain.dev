# Adapter Interface Spec

> `DEC-ADAPTER-IFACE-001` — shipped adapters must have a stable public package boundary for external runner authors

## Purpose

AgentXchain already ships real adapter implementations (`manual`, `local_cli`, `mcp`, `api_proxy`) and public docs for them. But external runner authors still have to import deep internal source files to reuse those adapters. That is not a public contract. It is accidental reach-through.

This spec defines a versioned `agentxchain/adapter-interface` package export so CI, hosted, and programmatic runners can reuse the shipped adapters without violating internal-path boundaries.

## Interface

### Package export

- npm export path: `agentxchain/adapter-interface`
- source file: `cli/src/lib/adapter-interface.js`

### Version

`adapter-interface.js` exports:

```js
export const ADAPTER_INTERFACE_VERSION = '0.1';
```

### Public exports

`agentxchain/adapter-interface` exports only the stable adapter entrypoints and public adapter metadata:

```js
export const ADAPTER_INTERFACE_VERSION;

export function printManualDispatchInstructions(state, config, options?);
export function waitForStagedResult(root, options?);
export function readStagedResult(root, options?);

export function dispatchLocalCli(root, state, config, options?);
export function saveDispatchLogs(root, turnId, logs);
export function resolvePromptTransport(runtime);

export function dispatchApiProxy(root, state, config, options?);

export const DEFAULT_MCP_TOOL_NAME;
export const DEFAULT_MCP_TRANSPORT;
export function dispatchMcp(root, state, config, options?);
export function resolveMcpToolName(runtime);
export function resolveMcpTransport(runtime);
export function describeMcpRuntimeTarget(runtime);
```

### Explicit non-exports

The public interface MUST NOT expose internal parsing or provider-shape helpers such as:

- `extractTurnResult`
- `buildAnthropicRequest`
- `buildOpenAiRequest`
- `classifyError`
- `extractTurnResultFromMcpToolResult`
- `resolveMcpCommand`
- provider cost tables or internal retry constants

Those are implementation detail, not runner-facing contract.

## Behavior

1. External runner docs must distinguish:
   - `agentxchain/runner-interface` for governed state-machine operations
   - `agentxchain/adapter-interface` for shipped adapter dispatch entrypoints
2. `build-your-own-runner` docs must stop claiming that `runner-interface` alone is the full public integration boundary when using shipped adapters.
3. Release postflight must smoke-test `agentxchain/adapter-interface` from the packed/published artifact, not just `runner-interface`.
4. External runners remain free to implement their own dispatch instead of using the shipped adapters. `adapter-interface` is optional, not mandatory.

## Error Cases

- If `package.json` omits `./adapter-interface`, the contract fails.
- If docs tell external users to import shipped adapters from `cli/src/lib/adapters/*`, the contract fails.
- If release postflight validates only runner exports and not adapter exports, the package boundary proof is incomplete.
- If a public adapter export is removed or renamed without a version bump, the contract fails.

## Acceptance Tests

- `AT-ADAPTER-IFACE-001`: `cli/package.json` exports `./adapter-interface` and it points to `src/lib/adapter-interface.js`.
- `AT-ADAPTER-IFACE-002`: `adapter-interface.js` exports `ADAPTER_INTERFACE_VERSION` and the declared public adapter entrypoints only.
- `AT-ADAPTER-IFACE-003`: a programmatic runner can execute one governed `local_cli` turn using only `runner-interface.js` plus `adapter-interface.js`, with no CLI shell-out.
- `AT-ADAPTER-IFACE-004`: public docs mention `agentxchain/adapter-interface` for shipped adapters and do not present deep internal adapter paths as the external import boundary.
- `AT-ADAPTER-IFACE-005`: release postflight smoke imports `agentxchain/adapter-interface` successfully from a clean consumer install.
