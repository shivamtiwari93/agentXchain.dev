# Multi-Repo Doc Page Spec

**Status:** Shipped
**Slice:** Multi-repo docs deep-dive
**Author:** GPT 5.4 (Turn 12)
**Updated:** Turn 214 — GPT 5.4

## Purpose

Ship a dedicated `/docs/multi-repo` page that documents the coordinator workspace, config contract, lifecycle, barriers, hooks, context artifacts, dashboard surfaces, and recovery model from the actual shipped implementation.

## Interface

- Route: `/docs/multi-repo`
- Source: `website-v2/docs/multi-repo.mdx`
- Sidebar: docs sidebar under the existing delivery-oriented docs group
- Cross-links:
  - `/docs/cli` `multi` section links to `/docs/multi-repo`
  - `/docs/protocol` links to `/docs/multi-repo` for coordinator implementation details

## Behavior

1. The page documents `agentxchain-multi.json` as the coordinator config file at the workspace root.
2. The page documents the actual coordinator artifact root: `.agentxchain/multirepo/`.
3. The page documents the shipped `multi` lifecycle:
   - `multi init`
   - `multi step`
   - `multi resume`
   - repo-local `accept-turn` in the selected child repo
   - `multi approve-gate`
   - `multi resync --dry-run` / `multi resync`
4. The page states the real recovery contract: repo-local governed state is authoritative; coordinator state can be rebuilt from it; blocked-state recovery uses `multi resume`, not `multi resync` alone.
5. The page documents coordinator-only artifacts and payloads:
   - `.agentxchain/multirepo/state.json`
   - `.agentxchain/multirepo/history.jsonl`
   - `.agentxchain/multirepo/barriers.json`
   - `.agentxchain/multirepo/barrier-ledger.jsonl`
   - `COORDINATOR_CONTEXT.json`
   - `COORDINATOR_CONTEXT.md`
6. The page documents the four shipped coordinator hook phases:
   - `before_assignment`
   - `after_acceptance`
   - `before_gate`
   - `on_escalation`
7. The page documents the four shipped barrier types:
   - `all_repos_accepted`
   - `ordered_repo_sequence`
   - `interface_alignment`
   - `shared_human_gate`
8. The page documents coordinator custom-phase truth:
   - coordinator and child repos must declare the same ordered routing phases
   - custom phases such as `design` are supported when declared consistently
   - coordinator transitions may only target the immediate next declared phase
   - skipping a declared phase is rejected as `phase_skip_forbidden`
9. The page documents the coordinator inspection boundary:
   - `audit` reads the current live coordinator workspace
   - `export` writes the portable coordinator artifact
   - `report --input` reads an existing verified coordinator artifact
   - `replay export` opens an existing coordinator artifact in the read-only dashboard
   - partial coordinator artifacts keep `repo_ok_count` / `repo_error_count` plus row-only failed repos in report, while replay uses placeholder child repos instead of fabricated nested exports

## Error Cases

- Documenting `coordinator.yaml` instead of `agentxchain-multi.json`
- Claiming coordinator state lives outside `.agentxchain/multirepo/`
- Omitting `multi resume`, `multi approve-gate`, or `multi resync --dry-run`
- Hiding `multi step` auto-resync behavior
- Claiming `multi resync` alone clears coordinator blocked state
- Describing coordinator hooks or barrier types that are not in the shipped code
- Describing custom coordinator phases as unsupported or implying coordinator runs may skip declared phases
- Collapsing `audit`, `export`, `report --input`, and `replay export` into one vague coordinator-inspection story
- Claiming the live `dashboard` command reads saved export artifacts directly
- Claiming partial coordinator artifacts get fabricated failed-child drill-down in report or replay

## Acceptance Tests

- AT-MRD-001: `website-v2/docs/multi-repo.mdx` exists and is linked from the docs sidebar.
- AT-MRD-002: `/docs/cli` links to `/docs/multi-repo` and uses `agentxchain-multi.json`, not `coordinator.yaml`.
- AT-MRD-003: The page documents all six `multi` subcommands and the repo-local `accept-turn` step that completes the operator loop.
- AT-MRD-004: The page documents `.agentxchain/multirepo/` and both `COORDINATOR_CONTEXT` artifacts.
- AT-MRD-005: The page documents the four shipped barrier types and four shipped coordinator hook phases.
- AT-MRD-006: The page states that repo-local state is authority and that `multi step` auto-resyncs on safe divergence before dispatch.
- AT-MRD-007: The page documents `multi resume` as blocked-state recovery distinct from divergence `multi resync`.
- AT-MRD-008: The page documents a concrete coordinator custom-phase example and states that coordinator transitions may only target the immediate next declared phase.
- AT-MRD-009: The page freezes the coordinator inspection boundary: `audit` = live workspace, `export` = portable artifact, `report --input` = existing verified artifact, `replay export` = read-only dashboard for an existing artifact.
- AT-MRD-010: The page states the partial coordinator artifact boundary: report keeps `repo_ok_count` / `repo_error_count` plus row-only failed repos, replay uses placeholder child repos, and neither command fabricates missing nested exports.
