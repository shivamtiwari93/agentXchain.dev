# Runner Interface Docs Page Specification

**Status:** Shipped

## Purpose

Publish a public-facing `/docs/runner-interface` page so third-party runner authors can build against the declared library boundary without reading `.planning/` internals or reverse-engineering example scripts.

## Route

- Public route: `/docs/runner-interface`
- Source file: `website-v2/docs/runner-interface.mdx`

## Required Content

1. State that the CLI is the primary shipped runner, but not the only possible runner.
2. Document the current interface version and that operations are versioned.
3. Document the lifecycle operations exported by `cli/src/lib/runner-interface.js`.
4. Document the support operations exported by `cli/src/lib/runner-interface.js`, including the real `writeDispatchBundle(root, state, config, opts?)` signature and `getTurnStagingResultPath`.
5. Show the canonical runner loop: `loadContext/loadState -> initRun/reactivateRun -> assignTurn -> writeDispatchBundle or runner dispatch -> stage result -> acceptTurn/rejectTurn`.
6. Link to both primitive CI proof examples at `examples/ci-runner-proof/run-one-turn.mjs` and `examples/ci-runner-proof/run-to-completion.mjs`.
7. Explain that `runLoop` is a higher-level library composition surface and does not replace the primitive runner-interface proofs.
8. Explain that `acceptTurn()` removes the accepted turn's dispatch and staging directories after commit, so runners must inspect or archive those artifacts before acceptance if they need them.
9. Explain what is intentionally outside the runner interface: CLI parsing/output, dashboard, intake, export/report, adapter dispatch strategy.
10. If the page enumerates shipped CLI adapter paths concretely, it must name the full current surface: `manual`, `local_cli`, `api_proxy`, `mcp`, and `remote_agent`.

## Cross-Link Contract

- The page must be present in `website-v2/sidebars.ts`.
- `website-v2/docs/cli.mdx` must link to `/docs/runner-interface`.
- `website-v2/docs/quickstart.mdx` must link to `/docs/runner-interface`.
- `website-v2/docs/protocol.mdx` must link to `/docs/runner-interface`.

## Acceptance Tests

- `AT-RID-001`: page source exists and is wired into the sidebar
- `AT-RID-002`: page documents the real runner-interface exports, including `RUNNER_INTERFACE_VERSION` and `getTurnStagingResultPath`
- `AT-RID-003`: page links to both CI runner proof examples and distinguishes primitive runner-interface proof from `runLoop`
- `AT-RID-004`: CLI, quickstart, and protocol docs link to `/docs/runner-interface`
- `AT-RID-005`: page/spec document the real `writeDispatchBundle(root, state, config, opts?)` signature and `acceptTurn()` cleanup semantics
- `AT-RID-006`: when the page enumerates CLI adapter paths, it names all five shipped adapters and does not omit `remote_agent`
