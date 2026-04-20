Status: Active — targeted BUG-54 mitigation slice

# BUG-54 Runtime Startup Watchdog Override Spec

## Purpose

Allow `local_cli` runtimes to override the global startup watchdog so operators
can tune slower QA/Claude paths without inflating the startup threshold for
every runtime in the repo.

BUG-54 is explicitly investigating QA-specific local CLI startup behavior. A
single repo-wide `run_loop.startup_watchdog_ms` knob is too coarse for that.

## Interface

- `cli/src/lib/schemas/agentxchain-config.schema.json`
- `cli/src/lib/normalized-config.js`
- `cli/src/lib/adapters/local-cli-adapter.js`
- `cli/src/commands/run.js`
- `cli/src/commands/step.js`
- `cli/test/local-cli-adapter.test.js`
- `cli/test/normalized-config.test.js`
- `cli/test/config-governed.test.js`
- `cli/test/agentxchain-config-schema.test.js`
- `cli/test/beta-tester-scenarios/bug-54-real-claude-reliability.test.js`
- `website-v2/docs/cli.mdx`
- `website-v2/docs/protocol-reference.mdx`

## Behavior

- `local_cli` runtimes may declare `startup_watchdog_ms` as a positive integer.
- The effective startup watchdog resolves in this order:
  1. explicit dispatch option override
  2. `runtimes.<id>.startup_watchdog_ms`
  3. `run_loop.startup_watchdog_ms`
  4. built-in default `30000`
- Adapter diagnostics must report the effective watchdog value, not the raw
  global config value.
- `run` and `step` must pass the same effective watchdog value into
  `failTurnStartup()` so the operator-facing failure record matches the
  threshold the adapter actually used.

## Error Cases

- `runtimes.<id>.startup_watchdog_ms = 0`, negative, non-integer, or non-numeric
  must fail config validation.
- Non-`local_cli` runtimes do not gain a startup watchdog override in this
  slice. BUG-54 is a local CLI defect; widening the scope would be premature.

## Acceptance Tests

- Schema publishes `runtimes.<id>.startup_watchdog_ms` for `local_cli`.
- Validation accepts a positive integer local-cli override and rejects invalid
  values.
- `dispatchLocalCli()` prefers the runtime override over a tighter global
  watchdog and logs the effective `startup_watchdog_ms`.
- Real-Claude gated proof: a deliberately too-tight global watchdog is
  overridden by a per-runtime local-cli watchdog, and the dispatch survives to
  first output instead of failing as a startup timeout.

## Open Questions

- Whether the repo should later add phase-specific or role-specific watchdog
  overrides instead of runtime-scoped tuning.
- Whether a future release should raise the global default after enough tester
  evidence is collected.
