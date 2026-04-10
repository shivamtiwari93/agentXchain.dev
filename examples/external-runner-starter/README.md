# External Runner Starter

This is the canonical installed-package starter for external runner authors.

It is intentionally different from `examples/ci-runner-proof/`:

- `examples/ci-runner-proof/` proves the local source boundary inside this repo's CI.
- `examples/external-runner-starter/` proves what a clean consumer project imports after `npm install agentxchain`.

## Requirements

- **Node.js >=18.17.0** (or >=20.5.0)
- npm

## Quick start — manual staging

```bash
npm init -y
npm install agentxchain
curl -O https://raw.githubusercontent.com/shivamtiwari93/agentXchain.dev/main/examples/external-runner-starter/run-one-turn.mjs
node run-one-turn.mjs --json
```

## Quick start — adapter-backed dispatch

```bash
npm init -y
npm install agentxchain
curl -O https://raw.githubusercontent.com/shivamtiwari93/agentXchain.dev/main/examples/external-runner-starter/run-adapter-turn.mjs
node run-adapter-turn.mjs --json
```

## What the starters prove

### `run-one-turn.mjs` — runner-interface only

Imports from `agentxchain/runner-interface`. Manually scaffolds a governed repo, initializes a run, assigns a turn, stages a result by hand, and accepts it. Because the starter uses a single review-only planning phase, the accepted turn also completes the run. No adapter, no subprocess, no CLI shell-out.

### `run-adapter-turn.mjs` — runner-interface + adapter-interface

Imports from both `agentxchain/runner-interface` and `agentxchain/adapter-interface`. Uses `dispatchLocalCli` to dispatch a real `local_cli` turn through the shipped adapter — the same dispatch path the CLI uses. A tiny mock agent script stages the result, proving the full dispatch → stage → accept lifecycle works from a clean consumer install.

Key differences from `run-one-turn.mjs`:

- Calls `writeDispatchBundle()` before dispatch (required by the adapter)
- Calls `dispatchLocalCli()` to run a real subprocess
- Calls `saveDispatchLogs()` to persist dispatch output
- Reports `adapter_interface_version` and `dispatched_via` in output

If either starter cannot run in a clean project, the published package boundary is broken.
