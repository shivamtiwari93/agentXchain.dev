# BUG-54 Claude Auth Preflight Spec

## Purpose

Prevent `local_cli` Claude subprocesses from entering an observed auth-startup hang shape: non-interactive spawn, no env-based auth, no `--bare`, and a bounded smoke probe that produces no stdout before the watchdog fires.

The framework must fail fast with actionable guidance only after observing the failure shape. BUG-56 superseded the prior static contract because Claude Max + keychain can work non-interactively without env auth and without `--bare`.

## Interface

- `cli/src/commands/init.js`
  - default governed Claude local runtime includes `--bare`
- `cli/src/templates/governed/*.json`
  - template-owned Claude local runtimes include `--bare`
- `cli/src/lib/claude-local-auth.js`
  - shared helper for Claude-specific auth preflight evaluation and bounded smoke probing
- `cli/src/lib/adapters/local-cli-adapter.js`
  - refuses the known-hanging Claude spawn shape before `spawn_prepare`
- `cli/src/lib/connector-probe.js`
  - fails `connector check` with the canonical auth-preflight error when the
    runtime's bounded smoke probe observes the auth-hang/fail shape
- `cli/src/lib/connector-validate.js`
  - refuses the observed Claude auth-hang/fail shape before any scratch workspace is
    created, so `connector validate` does not waste the scratch + synthetic
    dispatch ceremony on a runtime that is already known to hang
- `cli/src/commands/doctor.js`
  - surfaces a warning during `agentxchain doctor`

## Behavior

1. New governed scaffolds and governed templates that use Claude local CLI currently emit `claude --print --dangerously-skip-permissions --bare` with `prompt_transport: "stdin"`. Whether to keep or revert that default after BUG-56 remains an open product decision; it is not the preflight gate's correctness mechanism.
2. If an existing or hand-edited `local_cli` runtime command resolves to `claude` and the runtime command does **not** include `--bare`, the framework checks for env-based Claude auth.
3. Env-based Claude auth is considered present when any of these are set:
   - `ANTHROPIC_API_KEY`
   - `CLAUDE_API_KEY`
   - `CLAUDE_CODE_OAUTH_TOKEN`
   - `CLAUDE_CODE_USE_VERTEX`
   - `CLAUDE_CODE_USE_BEDROCK`
4. If env auth is missing and `--bare` is absent, the framework runs a bounded smoke probe against the configured Claude command with a short stdin payload.
5. If the smoke probe observes stdout before the watchdog fires, the runtime is allowed to proceed. This is the supported Claude Max/keychain positive case from BUG-56.
6. If the smoke probe hangs, writes stderr without stdout, or exits non-zero without stdout:
   - `dispatchLocalCli()` returns `ok: false` before spawn
   - adapter logs a `claude_auth_preflight_failed` diagnostic row
   - `connector check` returns `level: 'fail'`, `probe_kind: 'auth_preflight'`,
     `error_code: 'claude_auth_preflight_failed'`, and the same remediation
   - `connector validate` returns `ok: false`, `error_code: 'claude_auth_preflight_failed'`,
     `dispatch: null`, `validation: null`, `scratch_root: null` — no scratch
     workspace is created and the synthetic dispatch is skipped entirely
   - `doctor` reports the runtime as `warn` with actionable fix text
7. If env auth is present, or `--bare` is already declared, the smoke probe is skipped and the preflight does not block dispatch.

## Error Cases

- Claude runtime with no env auth, no `--bare`, and a smoke probe that hangs/fails without stdout
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
  - fails fast before governed spawn only when the Claude smoke probe observes a hang
- `cli/test/connector-authority-intent.test.js`
  - static authority analysis does not emit auth-preflight warnings; auth prediction belongs to the smoke-probe path
- `cli/test/connector-check-command.test.js`
  - `AT-CCP-011` — `connector check` passes no-env/no-`--bare` Claude when the smoke probe observes stdout
  - `AT-CCP-011b` — `connector check` fails the observed hanging Claude shape with
    `probe_kind: 'auth_preflight'` and `error_code: 'claude_auth_preflight_failed'`
  - `AT-CCP-012` — `--bare` suppresses the connector-check auth-preflight failure
- `cli/test/governed-doctor-e2e.test.js`
  - doctor reports `warn` when a Claude runtime's auth smoke probe hangs
- `cli/test/governed-cli.test.js`
  - enterprise-app scaffolds `local-dev.command` with `--bare`
  - full-local-cli scaffolds every default Claude runtime with `--bare`
- `cli/test/connector-validate-command.test.js`
  - `AT-CCV-007` — `connector validate` allows no-env/no-`--bare` Claude when the smoke probe observes stdout
  - `AT-CCV-007b` — `connector validate` fails fast with
    `error_code: 'claude_auth_preflight_failed'` and zero scratch workspace
    when the smoke probe hangs
  - `AT-CCV-008` — `connector validate` does NOT auth-preflight-refuse when
    `--bare` is declared
- `cli/test/claim-reality-preflight.test.js`
  - packed tarball adapter refuses an observed hanging shim before spawn and logs
    `claude_auth_preflight_failed`
  - packed tarball `connector validate` refuses an observed hanging shim before
    scratch workspace setup and surfaces `error_code: 'claude_auth_preflight_failed'`
    with an `auth_preflight` warnings row
- `cli/test/beta-tester-scenarios/bug-56-claude-auth-preflight-probe-command-chain.test.js`
  - positive command chain proves working no-env/no-`--bare` Claude shim passes `connector check`, `connector validate`, and `run --continuous`
  - negative command chain proves hanging no-env/no-`--bare` Claude shim fails `connector check`, `connector validate`, and governed `run` with `claude_auth_preflight_failed`

## Open Questions

- Whether a future release should keep `--bare` in new scaffolds, revert to Claude Max/keychain-friendly defaults, or add an auth-mode prompt remains open. BUG-56 proves the preflight cannot rely on `--bare` as the only valid non-env path.
- Whether a future release should auto-migrate existing hand-edited Claude runtimes to add `--bare` remains open. This spec intentionally keeps migration out of scope.
- Whether `local_cli` schema should grow an explicit `auth_env` field for Claude remains open. The current contract uses shared well-known Claude env keys instead of a new config surface.
- Claude runtime with no env auth, no `--bare`, and a smoke probe that observes stdout
  - no auth-preflight warning or failure
  - downstream governed dispatch proceeds normally
