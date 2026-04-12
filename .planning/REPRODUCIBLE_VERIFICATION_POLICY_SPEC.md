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
3. The replay result is injected into the policy-evaluation context as trusted acceptance metadata.
4. The policy rule triggers unless replay `overall === "match"`.
5. Trigger reasons:
   - `not_reproducible`: no `verification.machine_evidence` commands were declared
   - `mismatch`: one or more replayed commands exited differently, errored, or timed out
6. Because this is wired through the normal policy engine:
   - `block` rejects acceptance with `error_code: "policy_violation"`
   - `escalate` blocks the run with `error_code: "policy_escalation"`
   - `warn` allows acceptance but returns advisory warnings
7. `verify turn` must use the same replay helper so the inspection surface and the enforcement surface cannot drift.
8. Successful acceptance under this rule should expose a compact `verification_replay` summary on the accepted turn result so operators can see that reproducibility was actually enforced.

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
7. `AT-RVP-007`: `verify turn` uses the same shared replay helper and still reports `match`, `mismatch`, and `not_reproducible` with the existing CLI contract.
8. `AT-RVP-008`: public docs explain that policies can now enforce reproducible verification at turn acceptance, while `verify turn` remains the read-only inspection surface.

## Open Questions

1. Should a future slice allow policy-level replay timeout overrides, or is the fixed 30s timeout sufficient until operators report real pressure?
2. Should acceptance reports/renderers surface `verification_replay` more prominently once operators start using the rule in production?
