# Queued Gate Verification Context — Spec

> Preserve verification-pass gate truth when a queued request is evaluated from durable history at drain time.

---

## Purpose

Queued phase transitions and queued run completions are evaluated after the requesting turn has already been accepted into history. That means gate evaluation must use the durable accepted-turn record, not ephemeral staging assumptions.

This spec freezes one narrow contract:

- a queued gate with only `requires_verification_pass: true` must still see the requesting turn's verification result
- queued drain must pass when the original requester reported `verification.status: "pass"` or `"attested_pass"`
- queued drain must fail when that durable verification status is missing or non-passing

The goal is to stop speculative fixes around history shape and prove the real behavior directly.

---

## Interface

No new CLI or config surface.

Existing surfaces involved:

- accepted turn history entries in `.agentxchain/history.jsonl`
- queued request state in `.agentxchain/state.json`
- gate evaluation via `acceptGovernedTurn(...)`

---

## Behavior

1. When a turn requests a phase transition or run completion while sibling turns are still active, that request may be queued.
2. When the run drains, gate evaluation may reconstruct the requesting turn from durable history.
3. History-backed evaluation must preserve the accepted turn's verification context well enough for `requires_verification_pass` to behave identically to the immediate-acceptance path.
4. `verification.status: "pass"` and `"attested_pass"` satisfy the predicate.
5. Missing, `"fail"`, or `"skipped"` verification status fails the predicate and produces the normal gate-failure surface.

---

## Error Cases

- If a queued request references a turn that cannot be found in history, the system may evaluate against the current turn and return the existing no-request or gate-failure behavior; this spec does not widen recovery for missing history.
- This spec does not change workflow-file semantic checks or human-approval gates.

---

## Acceptance Tests

1. **AT-QGVC-001**: queued phase transition with `requires_verification_pass: true` advances when the requesting turn's durable verification status is `"pass"`.
2. **AT-QGVC-002**: queued phase transition with `requires_verification_pass: true` fails when the requesting turn's durable verification status is `"fail"`.
3. **AT-QGVC-003**: queued gate-failure persistence remains truthful for the failed verification case (`missing_verification: true`, gate status `failed`).

---

## Open Questions

None for this slice. The contract is to prove the current history-backed behavior, not to add a second verification field or a staged-result fallback without evidence.
