# Build Your Own Runner Docs Specification

**Status:** Shipped

## Purpose

Make third-party runner adoption executable instead of implicit. `/docs/runner-interface` declares the boundary, but runner authors still have to reconstruct the actual build sequence from reference material and proof scripts. This page turns the proven boundary into a step-by-step tutorial.

## Interface

- Public route: `/docs/build-your-own-runner`
- Source file: `website-v2/docs/build-your-own-runner.mdx`
- Supporting example README: `examples/ci-runner-proof/README.md`

## Behavior

1. State clearly that runner authors should import only through `cli/src/lib/runner-interface.js` for governed execution operations.
2. Walk through the canonical sequence in operator order:
   - `loadContext()`
   - `loadState(root, config)`
   - `initRun(root, config)` or `reactivateRun(root, state, details?)`
   - `assignTurn(root, config, roleId)`
   - `writeDispatchBundle(root, state, config, opts?)` or runner-specific dispatch
   - `getTurnStagingResultPath(turn.turn_id)`
   - `acceptTurn(root, config, opts?)` or `rejectTurn(root, config, result, reason, opts?)`
   - `approvePhaseGate(root, config)` / `approveCompletionGate(root, config)` when pending
3. Tie the tutorial to the shipped example proofs:
   - `examples/ci-runner-proof/run-one-turn.mjs`
   - `examples/ci-runner-proof/run-to-completion.mjs`
   - `examples/ci-runner-proof/run-with-run-loop.mjs`
4. Explain the escalation path between the proof tiers:
   - start with the single-turn primitive
   - graduate to full lifecycle
   - adopt `runLoop` only after primitive correctness is proven
5. Document the real failure traps runner authors hit:
   - importing internal helpers directly instead of `runner-interface.js`
   - shelling out to `agentxchain step` and calling that a second runner
   - staging results anywhere other than `getTurnStagingResultPath(turn.turn_id)`
   - assuming `acceptTurn()` preserves transient dispatch and staging artifacts
6. The example README must be runnable and concise:
   - show all three example commands
   - describe what each proof tier demonstrates
   - point back to the public docs pages for the normative boundary and tutorial

## Error Cases

- If docs claim a function name or order that does not match `runner-interface.js`, the guard test must fail.
- If the tutorial stops at abstract advice and does not name the shipped example files, the guard test must fail.
- If the example README drifts from the public page or omits the graduated proof path, the guard test must fail.

## Acceptance Tests

- `AT-BYR-001`: `/docs/build-your-own-runner` exists, is present in the sidebar, and is listed in the docs surface spec
- `AT-BYR-002`: the page documents the real runner-interface sequence and operation names
- `AT-BYR-003`: the page distinguishes the three shipped runner proof tiers and the correct adoption order
- `AT-BYR-004`: the page and example README document the real failure traps and canonical staging path
- `AT-BYR-005`: README and front-door surfaces link to the tutorial where runner adoption is discussed

## Open Questions

1. Should a future release add a published starter package for external runners, or is the docs + examples surface sufficient until a real third-party runner exists?
