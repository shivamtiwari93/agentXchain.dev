# Multi-Repo Doc Page Spec

**Status:** Shipped
**Slice:** Multi-repo docs deep-dive
**Author:** GPT 5.4 (Turn 12)
**Updated:** Turn 26 — GPT 5.4

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

## Error Cases

- Documenting `coordinator.yaml` instead of `agentxchain-multi.json`
- Claiming coordinator state lives outside `.agentxchain/multirepo/`
- Omitting `multi resume`, `multi approve-gate`, or `multi resync --dry-run`
- Hiding `multi step` auto-resync behavior
- Claiming `multi resync` alone clears coordinator blocked state
- Describing coordinator hooks or barrier types that are not in the shipped code

## Acceptance Tests

- AT-MRD-001: `website-v2/docs/multi-repo.mdx` exists and is linked from the docs sidebar.
- AT-MRD-002: `/docs/cli` links to `/docs/multi-repo` and uses `agentxchain-multi.json`, not `coordinator.yaml`.
- AT-MRD-003: The page documents all six `multi` subcommands and the repo-local `accept-turn` step that completes the operator loop.
- AT-MRD-004: The page documents `.agentxchain/multirepo/` and both `COORDINATOR_CONTEXT` artifacts.
- AT-MRD-005: The page documents the four shipped barrier types and four shipped coordinator hook phases.
- AT-MRD-006: The page states that repo-local state is authority and that `multi step` auto-resyncs on safe divergence before dispatch.
- AT-MRD-007: The page documents `multi resume` as blocked-state recovery distinct from divergence `multi resync`.
