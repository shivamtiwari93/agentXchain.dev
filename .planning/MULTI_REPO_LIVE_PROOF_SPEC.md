# Multi-Repo Live Proof Spec

## Purpose

Publish one real, model-backed multi-repo coordinator proof so `agentxchain.dev` does not stop at synthetic E2E and conceptual docs.

The repo already proves coordinator behavior with subprocess fixtures. That is necessary but insufficient for the public product claim. The missing surface is one dated case study showing the real coordinator loop driving real child-repo turns, real repo-local approvals, real coordinator gates, and real cross-repo context with live API dispatch.

## Interface

- Live proof script: `examples/live-governed-proof/run-multi-repo-proof.mjs`
- Public docs page: `website-v2/docs/multi-repo.mdx`
- Content proof: `cli/test/multi-repo-live-proof-content.test.js`

## Behavior

1. The live proof must scaffold a temporary coordinator workspace with two governed child repos: `api` and `web`.
2. Each child repo must use real `api_proxy` dispatch against Anthropic with `review_only` roles so the proof stays honest about remote-governance constraints.
3. The proof must use the real coordinator command loop:
   - `agentxchain multi init`
   - `agentxchain multi step --json`
   - repo-local `agentxchain step --resume --auto-reject`
   - repo-local `agentxchain approve-transition` or `agentxchain approve-completion` when required
   - `agentxchain multi approve-gate` when the coordinator requests a phase or completion gate
4. Repo-local gates must remain real:
   - child repo planning turns require repo-local `approve-transition`
   - child repo completion turns require repo-local `approve-completion`
   - the coordinator must not be documented or implemented as a shortcut around child repo truth
5. The proof must verify:
   - coordinator state reaches `completed`
   - both workstream barriers become `satisfied`
   - coordinator history contains at least 4 `turn_dispatched` and 4 `acceptance_projection` entries
   - downstream `web` dispatch receives `COORDINATOR_CONTEXT.json` with upstream acceptance from `api`
   - both repos incur real API cost
6. The docs page must publish a dated case study with:
   - execution date
   - CLI version
   - `super_run_id`
   - repo order / accepted projection count
   - context proof summary
   - total real API cost
   - script path and command

## Error Cases

- Using staged fixture JSON instead of real model dispatch
- Claiming multi-repo proof while skipping repo-local approvals
- Publishing invented metrics because a live run failed
- Treating coordinator completion as sufficient without verifying downstream context generation
- Generalizing this proof into “all multi-repo topologies are proven”

## Acceptance Tests

- `AT-MRLP-001`: spec exists with live proof script, docs page, and content proof surfaces
- `AT-MRLP-002`: `run-multi-repo-proof.mjs` exists and invokes `multi init`, `multi step --json`, child-repo `step --resume --auto-reject`, and `multi approve-gate`
- `AT-MRLP-003`: the script verifies `COORDINATOR_CONTEXT.json` includes an upstream acceptance from `api`
- `AT-MRLP-004`: `multi-repo.mdx` includes a dated live-proof section naming the script and command
- `AT-MRLP-005`: `multi-repo.mdx` records CLI version, `super_run_id`, accepted projection count, and total cost
- `AT-MRLP-006`: `multi-repo.mdx` explicitly says repo-local approvals remain required inside the live proof

## Open Questions

- Whether a later slice should add a permanent checked-in multi-repo example workspace instead of only a temp live-proof harness
