# External Runner Starter

This is the canonical installed-package starter for external runner authors.

It is intentionally different from `examples/ci-runner-proof/`:

- `examples/ci-runner-proof/` proves the local source boundary inside this repo's CI.
- `examples/external-runner-starter/` proves what a clean consumer project imports after `npm install agentxchain`.

## Requirements

- **Node.js >=18.17.0** (or >=20.5.0)
- npm

## Quick start

```bash
npm init -y
npm install agentxchain
curl -O https://raw.githubusercontent.com/shivamtiwari93/agentXchain.dev/main/examples/external-runner-starter/run-one-turn.mjs
node run-one-turn.mjs --json
```

## What it proves

`run-one-turn.mjs` imports from:

- `agentxchain/runner-interface`

If you want to reuse the shipped adapters instead of staging results yourself, import them from:

- `agentxchain/adapter-interface`

Then it:

1. scaffolds a tiny governed repo in a temp directory
2. initializes a run
3. assigns a turn
4. stages a valid result at `getTurnStagingResultPath(turn.turn_id)`
5. accepts the turn without any CLI shell-out

If this starter cannot run in a clean project, the published package boundary is broken.
