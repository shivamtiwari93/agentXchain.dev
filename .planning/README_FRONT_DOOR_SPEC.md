# README Front Door Spec — AgentXchain

> Public repository and npm package READMEs must describe the same governed product story and the same live command/file contracts.

---

## Purpose

Define the minimum truth contract for `README.md` and `cli/README.md` so the GitHub landing surface and the npm package page match the current governed workflow.

## Interface

Covered files:

- `README.md` — repository front door
- `cli/README.md` — npm package front door
- `examples/governed-todo-app/README.md` — example walkthrough referenced by both

## Behavior

The front-door docs must:

1. Lead with governed multi-agent delivery, mandatory challenge, audit trail, and human gates.
2. Describe the current governed surface as `1.0`/`1.1` compatible, not internal "v4" shorthand.
3. Document turn-scoped dispatch and staging paths:
   - `.agentxchain/dispatch/turns/<turn_id>/`
   - `.agentxchain/staging/<turn_id>/turn-result.json`
4. Show the real human gate commands:
   - `accept-turn`
   - `approve-transition`
   - `approve-completion`
5. Preserve legacy IDE-window coordination as compatibility mode, but not as the primary product story.
6. Link to the public docs surface on `agentxchain.dev`.
7. Mention the scaffold-time local dev override path (`--dev-command`, `--dev-prompt-transport`) when describing governed setup.

## Error Cases

- README says "v4" or other internal spec iteration language.
- README documents singleton dispatch/staging paths.
- README implies `api_proxy` is general-purpose when current support is review-only.
- README references examples or commands that do not exist in-tree.
- Repo README and npm README tell different product stories.

## Acceptance Tests

1. `README.md` and `cli/README.md` contain no `governed v4` phrasing.
2. `README.md` and `cli/README.md` contain no `.agentxchain/dispatch/current/` references.
3. `README.md`, `cli/README.md`, and `examples/governed-todo-app/README.md` contain no `.agentxchain/staging/turn-result.json` singleton references.
4. Both READMEs link to `https://agentxchain.dev/docs/quickstart`, `https://agentxchain.dev/docs/cli`, and `https://agentxchain.dev/docs/protocol`.
5. Example README instructs the operator to use the turn-specific staging path printed by `step`.

## Open Questions

1. When the first public npm release is cut, should the README call out "main branch may be ahead of npm" explicitly?
2. Should legacy compatibility eventually move to a dedicated archival doc instead of living in the front-door READMEs?
