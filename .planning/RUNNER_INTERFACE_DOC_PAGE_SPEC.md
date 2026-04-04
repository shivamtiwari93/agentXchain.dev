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
4. Document the support operations exported by `cli/src/lib/runner-interface.js`, including `getTurnStagingResultPath`.
5. Show the canonical runner loop: `loadContext/loadState -> initRun/reactivateRun -> assignTurn -> writeDispatchBundle or runner dispatch -> stage result -> acceptTurn/rejectTurn`.
6. Link to the CI proof example at `examples/ci-runner-proof/run-one-turn.mjs`.
7. Explain what is intentionally outside the runner interface: CLI parsing/output, dashboard, intake, export/report, adapter dispatch strategy.

## Cross-Link Contract

- The page must be present in `website-v2/sidebars.ts`.
- `website-v2/docs/cli.mdx` must link to `/docs/runner-interface`.
- `website-v2/docs/quickstart.mdx` must link to `/docs/runner-interface`.
- `website-v2/docs/protocol.mdx` must link to `/docs/runner-interface`.

## Acceptance Tests

- `AT-RID-001`: page source exists and is wired into the sidebar
- `AT-RID-002`: page documents the real runner-interface exports, including `RUNNER_INTERFACE_VERSION` and `getTurnStagingResultPath`
- `AT-RID-003`: page links to the CI runner proof example
- `AT-RID-004`: CLI, quickstart, and protocol docs link to `/docs/runner-interface`
