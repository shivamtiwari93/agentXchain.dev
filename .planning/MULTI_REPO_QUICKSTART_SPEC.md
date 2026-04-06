# Multi-Repo Quickstart Spec

**Status:** Shipped
**Slice:** Coordinator cold-start onboarding
**Author:** GPT 5.4 (Turn 6)

## Purpose

Give a new operator a literal cold-start path for governed coordination across repositories.

The repo already ships coordinator commands, deep-dive docs, and internal lifecycle tests. That is not enough. A credible multi-repo product surface needs one onboarding path that starts from empty directories, scaffolds real governed child repos, creates a real `agentxchain-multi.json`, dispatches a real coordinator turn, and proves the first coordinated phase with the real CLI.

## Interface

- Docs surface: `website-v2/docs/quickstart.mdx`
- Optional cross-link target: `website-v2/docs/multi-repo.mdx`
- Proof surface:
  - `cli/test/e2e-multi-repo-quickstart.test.js`
  - `cli/test/docs-multi-repo-quickstart-content.test.js`

## Behavior

### 1. Quickstart scope

The quickstart must cover the first truthful coordinated phase, not every possible coordinator feature.

The documented path must include:

1. create a coordinator workspace
2. scaffold two governed child repos with `init --governed --dir repos/<id> -y`
3. initialize git and make an initial commit in each child repo
4. create `agentxchain-multi.json` at the workspace root
5. run `agentxchain multi init`
6. run `agentxchain multi step --json` to dispatch the first repo-local planning turn
7. complete that repo-local planning turn truthfully
8. run repo-local `accept-turn`
9. run repo-local `approve-transition`
10. return to the workspace and run `agentxchain multi step --json` again
11. prove the second repo dispatch contains coordinator context from the first repo acceptance
12. complete the second repo-local planning turn the same way
13. run `agentxchain multi step --json` again and observe a coordinator phase-gate request
14. run `agentxchain multi approve-gate`

### 2. Repo-local gates remain real

The quickstart must explicitly document that child repos keep their own governed gates.

That means:

- repo-local `accept-turn` is not enough for planning turns
- each child repo planning turn still requires repo-local `approve-transition`
- only after the child repos clear their own planning gates can the coordinator request its cross-repo phase gate

The coordinator is not a shortcut around repo-local gate truth.

### 3. Cold-start proof strategy

The E2E test must run the real CLI binary as subprocesses.

The test may write planning files and staged turn-result JSON directly where the docs intentionally describe manual authoring. It must not cheat by hand-writing child repo state or bypassing `init` for the child repos.

### 4. Minimal coordinator config

The documented quickstart config must be minimal but truthful:

- `schema_version: "0.1"`
- two repos under `repos/`
- one planning workstream and one implementation workstream
- routing for `planning` and `implementation`
- one initiative completion gate

The quickstart does not need to teach every barrier type or hook phase. The deep-dive multi-repo page already owns that reference surface.

## Error Cases

- Documenting `multi init` as if it scaffolds child repos automatically
- Omitting the manual creation of `agentxchain-multi.json`
- Pretending repo-local `approve-transition` is unnecessary for child planning turns
- Claiming the coordinator gate appears immediately after repo-local `accept-turn`
- Proving the flow with hand-written child repo state instead of real `init --governed`
- Teaching a config shape that differs from the shipped `agentxchain-multi.json` contract

## Acceptance Tests

- AT-MRQ-001: `quickstart.mdx` documents a multi-repo cold-start section with child repo scaffolds under `repos/`.
- AT-MRQ-002: The docs show `agentxchain-multi.json`, `agentxchain multi init`, `agentxchain multi step --json`, and `agentxchain multi approve-gate`.
- AT-MRQ-003: The docs require repo-local `accept-turn` and repo-local `approve-transition` before the coordinator phase gate.
- AT-MRQ-004: The docs mention `COORDINATOR_CONTEXT.json` as the cross-repo handoff artifact for downstream repos.
- AT-MRQ-005: The E2E proof uses `init --governed` to scaffold real child repos, not hand-written governed fixtures.
- AT-MRQ-006: The E2E proof reaches a coordinator `phase_transition_requested` result after both child repos complete and approve their planning turns.

## Open Questions

1. Should a later slice add a dedicated `/docs/multi-repo-quickstart` page once the multi-repo onboarding surface grows beyond one bounded section in `/docs/quickstart`?
