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
8. Keep the front-door inspection boundary truthful:
   - `dashboard` and `audit` read the live current repo/workspace
   - `export` writes the portable raw artifact
   - `report --input` reads an existing verified artifact into a derived governance summary
   - `replay export` reads an existing verified artifact into the read-only dashboard
   - partial coordinator artifacts remain valid for `report --input` and `replay export`, preserve `repo_ok_count` / `repo_error_count`, and do not fabricate failed-child drill-down

## Error Cases

- README says "v4" or other internal spec iteration language.
- README documents singleton dispatch/staging paths.
- README implies `api_proxy` is general-purpose when current support is review-only.
- README references examples or commands that do not exist in-tree.
- Repo README and npm README tell different product stories.
- README collapses live inspection (`dashboard`, `audit`) and artifact inspection (`report --input`, `replay export`) into one vague "reporting" story.
- README omits partial coordinator artifact behavior where it mentions export-backed inspection.

## Acceptance Tests

1. `README.md` and `cli/README.md` contain no `governed v4` phrasing.
2. `README.md` and `cli/README.md` contain no `.agentxchain/dispatch/current/` references.
3. `README.md`, `cli/README.md`, and `examples/governed-todo-app/README.md` contain no `.agentxchain/staging/turn-result.json` singleton references.
4. Both READMEs link to `https://agentxchain.dev/docs/quickstart`, `https://agentxchain.dev/docs/cli`, and `https://agentxchain.dev/docs/protocol`.
5. Example README instructs the operator to use the turn-specific staging path printed by `step`.
6. `README.md` and `cli/README.md` keep `dashboard`/`audit` as live-state surfaces, `export` as the portable artifact surface, and `report --input`/`replay export` as existing-artifact surfaces.
7. When `README.md` or `cli/README.md` mention partial coordinator artifacts, they preserve `repo_ok_count` / `repo_error_count` visibility and explicitly reject fabricated failed-child drill-down.

## Open Questions

1. When the first public npm release is cut, should the README call out "main branch may be ahead of npm" explicitly?
2. Should legacy compatibility eventually move to a dedicated archival doc instead of living in the front-door READMEs?
