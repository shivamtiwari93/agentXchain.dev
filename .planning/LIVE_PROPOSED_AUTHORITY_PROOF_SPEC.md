# Live Proposed-Authority Proof — Spec

## Purpose

Prove that `api_proxy` proposed authority works end-to-end with a **real AI provider** (Anthropic Claude), not just mock servers. This closes the disallowed claim in `LAUNCH_EVIDENCE_REPORT.md` that `api_proxy` proposed authority is only proven via mock-provider subprocess E2E.

## Scope Truth

**What this proves:**
- A real Anthropic model (claude-haiku-4-5-20251001) returns valid `proposed_changes[]` in a governed turn
- Proposal materialization under `.agentxchain/proposed/<turn_id>/` works with real model output
- `proposal apply` copies real-model-proposed files into the workspace
- Phase gate passes after proposal apply
- Run completion succeeds after the full lifecycle

**What this does NOT prove:**
- Multi-provider proposed authority (requires `OPENAI_API_KEY`)
- Large-scale or complex file proposals
- Conflict detection with real provider output (covered by mock E2E)

## Scenario

1. Init governed project with a `dev` role: `write_authority: "proposed"`, `runtime_class: "api_proxy"`, provider: `anthropic`, model: `claude-haiku-4-5-20251001`
2. Seed planning gate files so the run starts in `implementation` phase
3. Assign dev turn → dispatch to real Anthropic API
4. Model returns turn result with `proposed_changes[]` containing `IMPLEMENTATION_NOTES.md`
5. Accept turn → proposals materialized under `.agentxchain/proposed/<turn_id>/`
6. Verify gate FAILS (file only in proposed dir, not workspace)
7. `proposal apply <turn_id>` → file copied to workspace
8. Approve implementation gate → phase transition to QA
9. Verify decision ledger has `proposal:applied` entry
10. Run completion succeeds (auto-complete, no human approval on QA gate)

## Interface

```
node examples/live-governed-proof/run-proposed-authority-proof.mjs [--json]
```

- Requires `ANTHROPIC_API_KEY` in environment
- Exits with `{ result: "skip" }` if key missing
- Exits with `{ result: "pass" }` on full lifecycle success
- Exits with `{ result: "fail", reason: "..." }` on any assertion failure
- Supports `--anthropic-base-url` for testing against mock servers

## Acceptance Tests

1. Real Anthropic API returns valid JSON with `proposed_changes[]`
2. Proposed files materialized under `.agentxchain/proposed/<turn_id>/`
3. Gate fails before `proposal apply`
4. Gate passes after `proposal apply`
5. Decision ledger contains `proposal:applied` entry
6. Run reaches `completed` state

## Error Cases

- Model returns invalid JSON → retry up to 3 times, then fail
- Model omits `proposed_changes` → fail with clear error
- API timeout → fail with timeout error
- Missing API key → skip (not fail)

## Open Questions

None — this is a narrow execution slice.
