# Reproducible Verification Policy Spec

## Purpose

Close the trust gap between `verify turn` and automated turn acceptance.

Today AgentXchain can replay a staged turn's declared `verification.machine_evidence` through `agentxchain verify turn`, but `step`, `run`, and direct `accept-turn` still commit accepted turns after structural validation alone. That leaves reproducibility as an optional manual check instead of an enforceable governance rule.

This spec adds a declarative acceptance policy rule that blocks or escalates when the staged turn's machine-evidence replay does not match in the current workspace.

## Interface

New built-in policy rule in the existing top-level `policies` array:

```json
{
  "policies": [
    {
      "id": "reproducible-proof",
      "rule": "require_reproducible_verification",
      "action": "block"
    }
  ]
}
```

### Rule contract

- `rule`: `require_reproducible_verification`
- `params`: optional, but ignored in v1
- `action`: existing policy action set
  - `block`
  - `warn`
  - `escalate`
- `scope`: existing optional phase / role scoping
- Replay source is fixed:
  - `verification.machine_evidence[].command`
  - compared against declared `verification.machine_evidence[].exit_code`
- Replay timeout is fixed in v1 at `30000ms` per command so the enforcement path stays deterministic and does not explode the config surface

## Behavior

1. Acceptance still validates the staged turn result first.
2. If at least one configured policy uses `require_reproducible_verification`, acceptance replays the staged turn's declared machine-evidence commands before policy evaluation.
3. Replay must not strand new actor-owned repo mutations in the live workspace. Acceptance must either:
   - restore replay-only side effects before continuing, or
   - fail acceptance with a specific verification-replay drift error before persisting history.
4. The replay result is injected into the policy-evaluation context as trusted acceptance metadata.
5. The policy rule triggers unless replay `overall === "match"`.
6. Trigger reasons:
   - `not_reproducible`: no `verification.machine_evidence` commands were declared
   - `mismatch`: one or more replayed commands exited differently, errored, or timed out
7. Because this is wired through the normal policy engine:
   - `block` rejects acceptance with `error_code: "policy_violation"`
   - `escalate` blocks the run with `error_code: "policy_escalation"`
   - `warn` allows acceptance but returns advisory warnings
8. `verify turn` must use the same shared replay helper so the inspection surface and the enforcement surface cannot drift.
9. Successful acceptance under this rule should expose a compact `verification_replay` summary on the accepted turn result so operators can see that reproducibility was actually enforced.
10. The compact replay summary includes `verified_at` so audit trails can answer when the most recent acceptance-time replay actually ran.
11. Replay executes the declared `verification.machine_evidence[].command` strings through the local shell in the repo root. This remains a deliberate v1 trust assumption: staged turn data is treated as trusted agent-authored execution intent, not untrusted user input. But "trusted execution intent" does NOT mean replay is allowed to mutate the accepted workspace silently.

## Error Cases

- No `verification.machine_evidence`:
  - replay result is `not_reproducible`
  - policy can block or escalate
- Command exit-code mismatch:
  - replay result is `mismatch`
  - policy can block or escalate
- Command timeout / spawn error:
  - replay result is `mismatch`
  - policy can block or escalate
- Replay command dirties actor-owned workspace files during acceptance:
  - acceptance must restore those replay-only side effects before persisting the turn
  - if restoration or the post-replay drift check fails, acceptance must fail loudly
  - successful acceptance may not leave the repo in a state that `resume` rejects while `checkpoint-turn` has nothing checkpointable
- Command string is malicious or unsafe:
  - out of scope for v1 policy enforcement
  - replay still executes it because staged `machine_evidence` is a trusted execution surface today
  - future isolation/sandboxing is still a separate runtime-hardening slice, but replay cleanup is mandatory now because live-workspace drift broke acceptance/checkpoint/resume consistency
- No matching reproducibility policy configured:
  - acceptance behavior is unchanged from today
- Historical accepted turns:
  - out of scope; this rule applies only at staged-turn acceptance time

## Acceptance Tests

1. `AT-RVP-001`: policy validation accepts `require_reproducible_verification` as a built-in rule.
2. `AT-RVP-002`: the evaluator triggers when replay context is `not_reproducible`.
3. `AT-RVP-003`: the evaluator triggers when replay context is `mismatch`.
4. `AT-RVP-004`: runtime acceptance with `action: "block"` and no `machine_evidence` fails with `error_code: "policy_violation"`.
5. `AT-RVP-005`: runtime acceptance with `action: "block"` and replay mismatch fails with `error_code: "policy_violation"`.
6. `AT-RVP-006`: runtime acceptance with `action: "block"` and replay match succeeds and records `accepted.verification_replay.overall === "match"`.
7. `AT-RVP-007`: successful replay records `accepted.verification_replay.verified_at` as an ISO-8601 timestamp.
8. `AT-RVP-008`: `verify turn` uses the same shared replay helper and still reports `match`, `mismatch`, and `not_reproducible` with the existing CLI contract.
9. `AT-RVP-009`: public docs explain that policies can now enforce reproducible verification at turn acceptance, while `verify turn` remains the read-only inspection surface.
10. `AT-RVP-010`: acceptance-time replay that writes actor-owned repo files does not strand those files in the live workspace. After `accept-turn`, `checkpoint-turn` and `resume` must not deadlock on replay-only dirt.

## Open Questions

1. Should a future slice allow policy-level replay timeout overrides, or is the fixed 30s timeout sufficient until operators report real pressure?
2. Should acceptance reports/renderers surface `verification_replay` more prominently once operators start using the rule in production?
3. When runtime isolation arrives, should replay move from "trusted local shell execution" to a sandboxed runner contract with explicit side-effect boundaries?
