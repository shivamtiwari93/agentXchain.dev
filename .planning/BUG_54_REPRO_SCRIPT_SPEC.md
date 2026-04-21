Status: Active — BUG-54 root-cause diagnostic contract

# BUG-54 Reproduction Script Spec

## Purpose

Provide an operator-runnable, repo-native diagnostic that reproduces the
`local_cli` adapter's exact subprocess launch shape and captures enough raw
evidence to discriminate BUG-54 root-cause hypotheses without guessing.

This script is not a reliability fix. It is the proof surface required before
shipping one.

## Interface

- `cli/scripts/reproduce-bug-54.mjs`
- Shipped package path for tester runs:
  `$(npm root)/agentxchain/scripts/reproduce-bug-54.mjs`, with
  `$(npm root -g)` as the global-install fallback.
- `cli/src/lib/adapters/local-cli-adapter.js`
- `cli/test/reproduce-bug-54-script.test.js`

## Behavior

- The script must auto-discover a project root containing `agentxchain.json`,
  select a `local_cli` runtime, and resolve a prompt from either:
  - `--synthetic "<prompt>"`
  - `--turn-id <id>` dispatch bundle replay
  - most recent dispatch bundle
  - synthetic fallback when no bundle exists
- The script must use the adapter's shared command-resolution and transport
  helpers so the spawned command/args/transport match the real adapter path.
- Each attempt must capture:
  - spawn timestamps
  - pid
  - first stdout/stderr timestamps
  - raw full stdout/stderr
  - byte and line counts
  - watchdog fire state
  - spawn/process error details (`code`, `errno`, `syscall`, `message`)
  - exit code/signal/duration
  - final classification
- The script must redact prompt content out of the JSON header when transport is
  `argv` by replacing the prompt argument with `<prompt:N bytes>`.
- The script must report auth-related environment presence as booleans only.
  It must never serialize secret values.
- The script must write a full JSON payload to disk and emit concise
  per-attempt progress lines to stderr for live operator feedback.
- Classification vocabulary is frozen to:
  - `spawn_error_pre_process`
  - `spawn_attach_failed`
  - `spawn_unattached`
  - `watchdog_no_output`
  - `watchdog_stderr_only`
  - `exit_no_output`
  - `exit_stderr_only`
  - `exit_clean_with_stdout`
  - `exit_nonzero_with_stdout`

## Error Cases

- Missing project root or runtime id must fail with a clear non-zero error.
- Missing dispatch bundle for an explicit `--turn-id` must fail loudly.
- Spawn failures must still produce a JSON attempt entry rather than crashing
  the harness.
- A runtime that authenticates via keychain/OAuth may succeed even when all
  probed auth env flags are `false`; env presence booleans are diagnostic
  context, not proof of auth failure by themselves.

## Acceptance Tests

- `cli/test/reproduce-bug-54-script.test.js`
  - ENOENT runtime classifies as `spawn_attach_failed`
  - stderr-only runtime classifies as `exit_stderr_only`
  - silent runtime killed by watchdog classifies as `watchdog_no_output`
  - stdout runtime classifies as `exit_clean_with_stdout`
  - redacted args hide the raw prompt and auth env fields remain booleans
- Real-runtime smoke:
  - running the script against a real `claude` `local_cli` runtime with a
    synthetic prompt must complete and emit a JSON payload. This is a manual
    AGENT-TALK evidence step, not a CI gate, because auth/runtime availability
    is machine-specific.
- Tester-facing runbooks and release notes must resolve the script from the
  installed `agentxchain` package via `npm root`, not from a repo-relative
  `cli/` path. Testers reproduce inside their own project worktree, where the
  AgentXchain.dev repo layout is not present.

## Open Questions

- Whether a future release-boundary test should execute the installed-package
  repro script itself. Current position: no, because the script is a diagnostic
  artifact shipped for tester environments, not normal runtime behavior.
