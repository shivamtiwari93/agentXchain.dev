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
- Multi-provider proposed authority (requires `OPENAI_API_KEY`)
- Large-scale or complex file proposals
- Conflict detection with real provider output (covered by mock E2E)

## Scenario

1. Init governed project with a `dev` role: `write_authority: "proposed"`, `runtime_class: "api_proxy"`, provider: `anthropic`, model: `claude-sonnet-4-6`
2. Seed planning gate files so the run starts in `implementation` phase
3. Assign dev turn → dispatch to real Anthropic API
4. Model returns turn result with `proposed_changes[]` containing `IMPLEMENTATION_NOTES.md`
4a. Proposal content must already satisfy the implementation gate semantic contract: exact `## Changes` and `## Verification` sections with real content
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
2. The proposal turn content already satisfies the implementation-gate semantic contract for `.planning/IMPLEMENTATION_NOTES.md`
3. Proposed files materialized under `.agentxchain/proposed/<turn_id>/`
4. The proposed file is absent from the workspace before `proposal apply`
5. `proposal apply` moves the proposed file into the workspace
6. The completion-turn harness rejects scenario-wrong staged outputs before acceptance
7. Decision ledger contains `proposal:applied` entry
8. Run reaches `completed` state once a compliant completion turn is produced

## Error Cases

- Model returns invalid JSON → retry up to 3 times, then fail
- Model omits `proposed_changes` → fail with clear error
- Model proposes `.planning/IMPLEMENTATION_NOTES.md` but omits gate-valid `## Changes` / `## Verification` content → fail and retry before acceptance
- Model returns a validator-clean but scenario-wrong completion payload → reject and retry before acceptance
- API timeout → fail with timeout error
- Missing API key → skip (not fail)

## Open Questions

~~Can a real Anthropic provider satisfy the dedicated completion-turn contract reliably enough to close live completion proof, or does the prompt/adapter boundary need product-level tightening?~~

**Resolved in three stages:**
- **Turn 133:** The no-op completion contract was broken in product code. Three interacting defects prevented no-op completion turns: (1) the validator required non-empty `proposed_changes` for all completed proposed+api_proxy turns with no exception for `run_completion_request: true`; (2) the prompt told proposed+api_proxy roles "You MUST return proposed changes" without qualifying completion turns; (3) phase/completion guidance existed for authoritative and review_only roles but was missing for proposed roles. All three fixed.
- **Turn 134:** After the contract fix, hardened live reruns exposed a different boundary: proposal-turn semantic reliability. The real model still failed to emit gate-valid `.planning/IMPLEMENTATION_NOTES.md` content with exact `## Changes` / `## Verification` sections after 3 attempts.
- **Turn 135:** Added diagnostic payload capture to the harness (persists rejected turn results to `.planning/LIVE_PROOF_DIAGNOSTICS/` for post-mortem inspection). Reran the harness — **full pass** on `run_7b067f892916b799`. Proposal turn accepted on attempt 3, completion turn accepted on attempt 2, run paused on `pending_run_completion`, `approve-completion` completed the run.
