# BUG-54 Claude Auth Preflight Spec

## Purpose

Prevent `local_cli` Claude subprocesses from entering the known macOS keychain-auth hang shape: non-interactive spawn, no env-based auth, no `--bare`, zero bytes on both streams until the startup watchdog kills the child.

The framework must fail fast with actionable guidance instead of launching a subprocess that is known to hang.

## Interface

- `cli/src/lib/claude-local-auth.js`
  - shared helper for Claude-specific auth preflight evaluation
- `cli/src/lib/adapters/local-cli-adapter.js`
  - refuses the known-hanging Claude spawn shape before `spawn_prepare`
- `cli/src/lib/connector-probe.js`
  - fails `connector check` with the canonical auth-preflight error when the
    runtime is a known-hanging Claude local_cli shape
- `cli/src/lib/connector-validate.js`
  - refuses the known-hanging Claude shape before any scratch workspace is
    created, so `connector validate` does not waste the scratch + synthetic
    dispatch ceremony on a runtime that is already known to hang
- `cli/src/commands/doctor.js`
  - surfaces a warning during `agentxchain doctor`

## Behavior

1. If a `local_cli` runtime command resolves to `claude` and the runtime command does **not** include `--bare`, the framework checks for env-based Claude auth.
2. Env-based Claude auth is considered present when any of these are set:
   - `ANTHROPIC_API_KEY`
   - `CLAUDE_API_KEY`
   - `CLAUDE_CODE_OAUTH_TOKEN`
   - `CLAUDE_CODE_USE_VERTEX`
   - `CLAUDE_CODE_USE_BEDROCK`
3. If env auth is missing and `--bare` is absent:
   - `dispatchLocalCli()` returns `ok: false` before spawn
   - adapter logs a `claude_auth_preflight_failed` diagnostic row
   - `connector check` returns `level: 'fail'`, `probe_kind: 'auth_preflight'`,
     `error_code: 'claude_auth_preflight_failed'`, and the same remediation
   - `connector validate` returns `ok: false`, `error_code: 'claude_auth_preflight_failed'`,
     `dispatch: null`, `validation: null`, `scratch_root: null` — no scratch
     workspace is created and the synthetic dispatch is skipped entirely
   - `doctor` reports the runtime as `warn` with actionable fix text
4. If env auth is present, or `--bare` is already declared, the preflight does not block dispatch.

## Error Cases

- Claude runtime with no env auth and no `--bare`
  - refuse before spawn
  - message must name `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`
  - message must name `--bare`
- Non-Claude `local_cli` runtimes
  - unaffected
- Claude runtime with `--bare`
  - no auth-preflight warning
  - downstream Claude auth behavior is the CLI's responsibility

## Acceptance Tests

- `cli/test/local-cli-adapter.test.js`
  - fails fast before spawn when Claude lacks env auth and `--bare`
- `cli/test/connector-authority-intent.test.js`
  - connector analysis emits `auth_preflight` warning
  - `--bare` suppresses that warning
- `cli/test/connector-check-command.test.js`
  - `AT-CCP-011` — `connector check` fails the known-hanging Claude shape with
    `probe_kind: 'auth_preflight'` and `error_code: 'claude_auth_preflight_failed'`
  - `AT-CCP-012` — `--bare` suppresses the connector-check auth-preflight failure
- `cli/test/governed-doctor-e2e.test.js`
  - doctor reports `warn` for a Claude runtime lacking env auth and `--bare`
- `cli/test/connector-validate-command.test.js`
  - `AT-CCV-007` — `connector validate` fails fast with
    `error_code: 'claude_auth_preflight_failed'` and zero scratch workspace
    when env auth is missing
  - `AT-CCV-008` — `connector validate` does NOT auth-preflight-refuse when
    `--bare` is declared
- `cli/test/claim-reality-preflight.test.js`
  - packed tarball adapter refuses the same shape before spawn and logs
    `claude_auth_preflight_failed`
  - packed tarball `connector validate` refuses the same shape before
    scratch workspace setup and surfaces `error_code: 'claude_auth_preflight_failed'`
    with an `auth_preflight` warnings row

## Open Questions

- Whether a future release should auto-add `--bare` for Claude runtimes remains open. This spec intentionally does **not** do that because it could break environments that currently rely on working keychain-based auth.
- Whether `local_cli` schema should grow an explicit `auth_env` field for Claude remains open. The current contract uses shared well-known Claude env keys instead of a new config surface.
