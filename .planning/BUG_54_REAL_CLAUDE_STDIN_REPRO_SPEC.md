Status: Active — real-Claude stdin proof slice for BUG-54

# BUG-54 Real Claude STDIN Repro Spec

## Purpose

Prove BUG-54 against the repo's real authoritative Claude runtime contract,
not a surrogate process and not `claude --version`.

The repo's documented/default local CLI path is:

- `command: ["claude", "--print", "--dangerously-skip-permissions"]`
- `prompt_transport: "stdin"`

If BUG-54 proof stops at `dispatch_bundle_only` or `--version`, it does not
exercise one of the roadmap's explicit root-cause hypotheses: stdin delivery
and early-exit behavior on the real Claude path.

## Interface

- `cli/src/lib/adapters/local-cli-adapter.js`
- `cli/test/local-cli-adapter.test.js`
- `cli/test/beta-tester-scenarios/bug-54-real-claude-reliability.test.js`

## Behavior

- Adapter diagnostics must surface watchdog-tuning evidence directly:
  - `spawn_attached.startup_watchdog_ms`
  - `first_output.startup_latency_ms`
  - `startup_watchdog_fired.elapsed_since_spawn_ms`
  - `process_exit.elapsed_since_spawn_ms`
  - `process_exit.startup_latency_ms`
- Real-Claude BUG-54 proof must include at least one loop that uses:
  - `claude --print --dangerously-skip-permissions`
  - `prompt_transport: "stdin"`
  - a non-empty prompt delivered through stdin
- The real-Claude test must fail loudly when Claude is installed but unhealthy
  during the probe step. Only a genuine "not installed / not on PATH" state may
  skip the test.

## Error Cases

- If `claude --version` times out or exits non-zero during probe, the real
  Claude test must fail, not silently skip.
- If real stdin dispatches emit `stdin_error`, BUG-54 remains open and the test
  must surface the diagnostic lines directly.
- If startup latency is absent from diagnostics on a successful first-output
  path, the adapter is not producing actionable watchdog evidence.

## Acceptance Tests

- `cli/test/local-cli-adapter.test.js`
  - spawn-but-silent subprocess logs elapsed watchdog timing
  - stdin transport logs a positive `stdin_bytes` count and exposes startup
    latency on the staged-result/first-output path
- `cli/test/beta-tester-scenarios/bug-54-real-claude-reliability.test.js`
  - real `claude --print --dangerously-skip-permissions` + `stdin` loop
    produces `spawn_prepare` with positive `stdin_bytes`
  - same loop produces `first_output` with positive `startup_latency_ms`
  - installed-but-slow/broken Claude probe fails loudly rather than skipping

## Open Questions

- Whether the next release should raise the default `startup_watchdog_ms`, or
  simply document operator tuning using the new latency diagnostics.
- Whether a packaged claim-reality probe for real-Claude paths is worth adding,
  or whether that should remain source-tree-only because it depends on an
  installed external binary.
