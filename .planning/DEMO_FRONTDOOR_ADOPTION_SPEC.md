# Demo Front-Door Adoption Spec

**Status:** shipped

## Purpose

Make the first 60 seconds of evaluating AgentXchain obvious and low-friction. A new evaluator should be able to see a governed PM -> Dev -> QA lifecycle before they are asked to scaffold a repo, wire runtimes, or understand the full workflow kit.

## Interface

- Root `README.md` adds a top-level `Try It Now` section with `npx agentxchain demo`.
- `cli/README.md` adds the same `Try It Now` section for npm/package consumers.
- `website-v2/docs/quickstart.mdx` adds `Path 0: Demo` ahead of the existing repo-bootstrap paths.
- `website-v2/src/pages/index.tsx` makes `npx agentxchain demo` the first CTA and keeps `npx agentxchain init` as the next step.
- `cli/test/demo-frontdoor-discoverability.test.js` guards the front-door demo path.

## Behavior

- The front door must present `agentxchain demo` before repo bootstrap because the demo is the fastest truthful proof of governance value.
- The copy must stay honest about prerequisites:
  - requires Node.js
  - requires `git`
  - does not require API keys, manual turn authoring, or repo setup
- The front door must not erase `init --governed`; after the demo, users still need an obvious path into a real project.
- Homepage CTA links should point to quickstart anchors, not to a generic package page that hides the actual first-run path.

## Error Cases

- Do not claim “zero prerequisites” or “Node.js only” because the demo shells out to `git`.
- Do not make `demo` the only visible path; evaluators who are already convinced still need the scaffold entry point.
- Do not satisfy discoverability by documenting `demo` only in the CLI reference. It must appear in the front-door surfaces.

## Acceptance Tests

- `AT-DEMO-FD-001`: root `README.md` contains `Try It Now` and `npx agentxchain demo`.
- `AT-DEMO-FD-002`: `cli/README.md` contains `Try It Now`, `npx agentxchain demo`, and a governed command-table row for `demo`.
- `AT-DEMO-FD-003`: quickstart contains `Path 0: Demo`, states `git` as a requirement, and explains what the demo proves.
- `AT-DEMO-FD-004`: homepage hero and closing CTA surface `npx agentxchain demo` first and retain `npx agentxchain init` as the next action.

## Open Questions

- None. This is a front-door discoverability correction, not a new runtime surface.
