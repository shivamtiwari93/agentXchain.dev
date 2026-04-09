# Product Examples Spec

> Define the contract for the five human-requested product examples under `/examples/`.

## Purpose

Prove that AgentXchain can govern real product delivery across multiple software categories instead of only toy workflow demos.

## Interface

The example program consists of five governed product directories:

1. `examples/habit-board` — consumer SaaS
2. `examples/trail-meals-mobile` — mobile app
3. `examples/async-standup-bot` — B2B SaaS
4. `examples/decision-log-linter` — developer tool
5. `examples/schema-guard` — open source library

Every example must include:

- a working product codebase
- runnable tests
- `README.md`
- `agentxchain.json`
- `TALK.md`
- core workflow docs under `.planning/`
- category-appropriate workflow-kit artifacts

## Behavior

Each example must satisfy these invariants:

1. The product is real and runnable, not a placeholder scaffold.
2. The governed config reflects the product category and team shape instead of blindly copying `governed-todo-app`.
3. The workflow uses explicit roles, routing, gates, and workflow-kit artifacts.
4. The README explains what the product does, how to run it, how to test it, and how AgentXchain governed the work.
5. The example category materially changes the artifact contract:
   - consumer SaaS: user-flow and browser/device artifacts
   - mobile app: mobile-platform and offline/device artifacts
   - B2B SaaS: operational and integration artifacts
   - developer tool: command-surface and distribution artifacts
   - open source library: public-API and compatibility artifacts

## Error Cases

- Shipping only governed config with no real product code is failure.
- Shipping code with no tests is failure.
- Reusing the same 3-phase artifact shape for every example is failure.
- Claiming governed proof without actual workflow artifacts is failure.
- Marking the roadmap item complete before all five directories exist is failure.

## Acceptance Tests

- [ ] `PRODUCT-EX-001`: The spec names all five target examples and their categories.
- [ ] `PRODUCT-EX-002`: Every completed example has `README.md`, `agentxchain.json`, `.planning/`, source code, and tests.
- [ ] `PRODUCT-EX-003`: Every completed example passes its own local test command.
- [ ] `PRODUCT-EX-004`: Every completed example passes `agentxchain template validate --json`.
- [ ] `PRODUCT-EX-005`: At least one shipped example demonstrates explicit `workflow_kit` beyond the default 3-phase scaffold.

## Open Questions

- Whether every example should also preserve a repo-local governed run history artifact remains open. The human asked for governed build proof; do not mark the parent roadmap item complete until that provenance story is honestly handled for all five examples.
