# Live Proposed-Authority Proof — Spec

## Purpose

Prove that `api_proxy` proposed authority works end-to-end with a **real AI provider** (Anthropic Claude), not just mock servers. This closes the disallowed claim in `LAUNCH_EVIDENCE_REPORT.md` that `api_proxy` proposed authority is only proven via mock-provider subprocess E2E.

## Scope Truth

**What this proves:**
- A real Anthropic model (`claude-sonnet-4-6` in the current harness) can be exercised through the dedicated proposed-authority proof harness
- Proposal materialization under `.agentxchain/proposed/<turn_id>/` works with real model output
- `proposal apply` copies real-model-proposed files into the workspace
- The proof harness now rejects scenario-wrong staged outputs before `acceptTurn` so invalid completion-turn payloads do not get mistaken for proof

**What this does NOT prove:**
- Live run completion with a real provider is still unproven
- Multi-provider proposed authority (requires `OPENAI_API_KEY`)
- Large-scale or complex file proposals
- Conflict detection with real provider output (covered by mock E2E)

## Scenario

1. Init governed project with a `dev` role: `write_authority: "proposed"`, `runtime_class: "api_proxy"`, provider: `anthropic`, model: `claude-sonnet-4-6`
2. Seed planning gate files so the run starts in `implementation` phase
3. Assign dev turn → dispatch to real Anthropic API
4. Model returns turn result with `proposed_changes[]` containing `IMPLEMENTATION_NOTES.md`
5. Accept turn → proposals materialized under `.agentxchain/proposed/<turn_id>/`
6. Verify the proposed file exists only in `.agentxchain/proposed/<turn_id>/` before apply
7. `proposal apply <turn_id>` → file copied to workspace
8. Commit the applied proposal so the next proposed-authority turn has a clean baseline
9. Dispatch a dedicated completion-request turn
10. Reject any staged completion payload that still claims file changes, proposed changes, internal `.agentxchain/*` paths, or omits `run_completion_request: true`
11. On a compliant completion turn, verify the run pauses on `pending_run_completion`
12. `approve-completion` succeeds and marks the run `completed`

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
3. The proposed file is absent from the workspace before `proposal apply`
4. `proposal apply` moves the proposed file into the workspace
5. The completion-turn harness rejects scenario-wrong staged outputs before acceptance
6. Decision ledger contains `proposal:applied` entry
7. Run reaches `completed` state once a compliant completion turn is produced

## Error Cases

- Model returns invalid JSON → retry up to 3 times, then fail
- Model omits `proposed_changes` → fail with clear error
- Model returns a validator-clean but scenario-wrong completion payload → reject and retry before acceptance
- API timeout → fail with timeout error
- Missing API key → skip (not fail)

## Open Questions

Can a real Anthropic provider satisfy the dedicated completion-turn contract reliably enough to close live completion proof, or does the prompt/adapter boundary need product-level tightening?
