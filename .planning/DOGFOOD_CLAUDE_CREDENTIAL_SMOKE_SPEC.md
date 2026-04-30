# Dogfood Claude Credential Smoke Spec

## Purpose

DOGFOOD-100 is paused on an operator-only Claude/Anthropic credential validity blocker. Repeated manual checks have already shown a verification trap: a plain `claude --print` can fail under an incompatible local Node runtime before it reaches Anthropic auth, while the retained AgentXchain dispatch uses a compatible Node wrapper and reaches the real provider 401.

This spec defines a repo-owned smoke helper that future agents can run before touching the paused Tusq session. The helper must distinguish credential failure from local Node runtime failure without printing secrets or mutating AgentXchain state.

## Interface

- Shipped bin: `agentxchain-dogfood-claude-smoke`
- Script: `node cli/scripts/dogfood-claude-smoke.mjs`
- Canonical shipped-package DOGFOOD check:
  - `npx --yes -p agentxchain@latest -c 'agentxchain-dogfood-claude-smoke --credential-env-file <agentxchain-repo>/.env --cwd <tusq-repo> --json'`
- Optional flags:
  - `--credential-env-file <path>`: load dotenv-style credential environment before running Claude. This deliberately avoids Node's own `--env-file` flag.
  - `--cwd <path>`: working directory for the Claude process.
  - `--claude <path-or-name>`: Claude executable, default `claude`.
  - `--node <path>`: compatible Node binary override.
  - `--timeout-ms <n>`: subprocess timeout, default `15000`.
  - `--prompt <text>`: non-secret prompt, default `Say only READY.`
  - `--json`: emit compact JSON only.
- Output JSON fields:
  - `ok`
  - `classification`
  - `auth_env_present`
  - `node`
  - `claude`
  - `exit_code`
  - `exit_signal`
  - `stdout_snippet`
  - `stderr_snippet`

## Behavior

The helper loads an optional env file into a child-process environment and records only boolean auth-key presence. It resolves a compatible Node binary using the same compatibility floor as AgentXchain's Claude local CLI recovery path. When the resolved Claude executable is a Node shebang entrypoint, the helper launches it as `<compatible-node> <claude-entry> --print` so the smoke test does not accidentally reproduce the old Node 18 `Object not disposable` failure.

The helper classifies:

- `success` when Claude exits 0.
- `anthropic_auth_failed` when stdout or stderr contains Anthropic/Claude auth failure text.
- `node_runtime_incompatible` when stdout or stderr contains the Claude Node incompatibility signature.
- `timeout` when the subprocess exceeds the watchdog.
- `spawn_error` when the process cannot be spawned.
- `exit_nonzero` for other non-zero exits.

The helper exits `0` only for `success`. Auth failure and runtime failure are distinct non-zero exits so shell usage can gate DOGFOOD-100 resumption.

## Error Cases

- Missing credential env file: fail with `env_file_missing`.
- Invalid timeout: fail with `usage_error`.
- Missing compatible Node for a Node-shebang Claude entrypoint: fail with `node_runtime_incompatible`.
- Claude binary missing: fail with `spawn_error`.
- Process writes provider 401 to stdout and empty stderr: classify as `anthropic_auth_failed`.
- Output snippets are bounded and must not include env-file secret values.

## Acceptance Tests

- A fake Node-shebang Claude executable is launched through the compatible Node wrapper and classifies `success`.
- A fake Claude executable that writes Anthropic 401 text to stdout and exits 1 classifies `anthropic_auth_failed`.
- A fake Claude executable that writes `Object not disposable` classifies `node_runtime_incompatible`.
- Loading an env file reports auth-key presence without leaking the secret value in stdout or stderr.
- `npm pack --dry-run --json` includes `scripts/dogfood-claude-smoke.mjs`, so DOGFOOD credential checks can be run from shipped package artifacts instead of relying on an unpublished checkout-only script.
- `package.json` exposes `agentxchain-dogfood-claude-smoke` as a bin pointing at `./scripts/dogfood-claude-smoke.mjs`, so future checks can use `npx -p agentxchain@latest` without tarball extraction.

## Open Questions

- None for the current DOGFOOD-100 blocker. If this helper becomes a public CLI command later, define the command UX separately instead of expanding this diagnostic script ad hoc.
