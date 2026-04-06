# Runner Package Contract

**Status:** Shipped

## Purpose

Make the external runner-consumer path real instead of implied.

The repo already proves runner behavior with repo-native CI scripts, but those proofs run against local source and do not prove that a published `agentxchain` package can be installed into a clean project and imported through `agentxchain/runner-interface` and `agentxchain/run-loop`.

This slice closes that gap.

## Interface

- Public docs:
  - `website-v2/docs/build-your-own-runner.mdx`
  - `website-v2/docs/runner-interface.mdx`
- External-consumer starter example:
  - `examples/external-runner-starter/README.md`
  - `examples/external-runner-starter/run-one-turn.mjs`
- Release truth:
  - `cli/scripts/release-postflight.sh`
- Guard / proof:
  - `cli/test/external-runner-package-contract.test.js`
  - `cli/test/release-postflight.test.js`

## Behavior

1. Public docs must describe the package boundary with the published import paths:
   - `agentxchain/runner-interface`
   - `agentxchain/run-loop`
2. Public docs must distinguish repo-native proof scripts from external-consumer starter code:
   - `examples/ci-runner-proof/` remains the repo proof surface
   - `examples/external-runner-starter/` is the canonical installed-package starter
3. The starter example must be runnable after:
   - `npm init -y`
   - `npm install agentxchain`
   - `node run-one-turn.mjs`
4. The starter example must import only through the package exports and must not reference:
   - `cli/src/lib/runner-interface.js`
   - `cli/src/lib/run-loop.js`
   - `agentxchain step`
5. Release postflight must prove both package surfaces:
   - CLI binary executes from the published tarball
   - runner package exports are importable from the published tarball in a clean consumer project

## Error Cases

- If docs still present `cli/src/lib/runner-interface.js` as the canonical external import path, the guard must fail.
- If the starter example uses repo-relative imports, the guard must fail.
- If `release-postflight.sh` verifies only the CLI binary and not the runner exports, the contract is incomplete.
- If the packed tarball installs but `agentxchain/runner-interface` or `agentxchain/run-loop` cannot be imported in a clean project, the proof must fail.

## Acceptance Tests

- `AT-RPC-001`: public docs use package export paths for external runner authors
- `AT-RPC-002`: starter example uses package exports and documents `npm install agentxchain`
- `AT-RPC-003`: a temp consumer project can install the packed tarball and run the starter example successfully
- `AT-RPC-004`: `release-postflight.sh` includes runner export smoke as a required release check
- `AT-RPC-005`: `release-postflight.test.js` fails if runner export smoke is missing or broken

## Open Questions

1. If external runner adoption becomes common, should AgentXchain publish a dedicated starter repository or template generator instead of keeping the starter inside this repo?
