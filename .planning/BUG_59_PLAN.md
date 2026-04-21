# BUG-59 Plan - Full-Auto Gate Approval Semantics

Date: 2026-04-21
Tag: `BUG-59-PLAN`
Owner: GPT 5.4
Scope: plan-only. No implementation files changed.

## Purpose

BUG-59 should fix the product promise gap where an operator expects autonomous/full-auto runs to advance through routine human-approval gates after evidence passes, but the default project shape pauses on gates such as `qa_ship_verdict`.

The research turns changed the implementation target. The defect is not simply "`approval_policy` is never consulted for `requires_human_approval`." The accepted-turn path already consults it. The real fix is a layered change:

1. Ship safe autonomous policy defaults in generated configs and this repo's own config.
2. Add a gate safety classifier so broad auto-approval cannot override credentialed/external/irreversible gates.
3. Apply the existing approval-policy coupling consistently in the phase-reconcile path that currently pauses even when policy would approve.

## Decisions

### DEC-BUG59-PLAN-LAYERED-FIX-001

BUG-59 implementation must address three layers in one feature branch:

- **Defaults:** `agentxchain init`, governed templates, and repo-owned `agentxchain.json` must include an `approval_policy` block for routine gates.
- **Safety:** gate definitions gain a `credentialed: true | false` boolean. If `credentialed: true`, policy auto-approval is forbidden even when a catch-all rule matches.
- **Consistency:** `reconcilePhaseAdvanceBeforeDispatch()` must use `evaluateApprovalPolicy()` for `awaiting_human_approval` phase gates and emit the same `approval_policy` ledger shape as the accepted-turn path.

### DEC-BUG59-NO-TIMEOUT-AUTO-APPROVAL-001

Do not wire `approval_policy` into `attemptTimeoutPhaseSkip()` for BUG-59. Timeout skip is an elapsed-time recovery path, not positive evidence that a gate is ready. Auto-approving a human gate because a phase timed out weakens the safety model and does not reproduce the tester's blocked heartbeat scenario. The timeout path should keep failing closed unless a future spec defines a separate timeout-escalation policy.

### DEC-BUG59-APPROVAL-POLICY-AS-AUTONOMY-SURFACE-001

Do not add a top-level `full_auto` mode. Autonomous behavior is represented by `approval_policy` plus gate safety classification. This avoids a second state machine identity and keeps "full-auto" as a project policy posture inside the governed protocol.

## Config Shape

Use explicit transition rules rather than `phase_transitions.default: "auto_approve"` in generated configs.

Rationale: a default auto-approve fallback is too easy to apply to future phases or custom gates whose safety class was not considered. Explicit rules make the shipped autonomous posture readable and auditable.

Recommended generated default:

```json
{
  "approval_policy": {
    "phase_transitions": {
      "default": "require_human",
      "rules": [
        {
          "from_phase": "planning",
          "to_phase": "implementation",
          "action": "auto_approve",
          "when": {
            "gate_passed": true,
            "credentialed_gate": false
          }
        },
        {
          "from_phase": "qa",
          "to_phase": "launch",
          "action": "auto_approve",
          "when": {
            "gate_passed": true,
            "credentialed_gate": false
          }
        }
      ]
    },
    "run_completion": {
      "action": "auto_approve",
      "when": {
        "gate_passed": true,
        "all_phases_visited": true,
        "credentialed_gate": false
      }
    }
  }
}
```

For the current three-phase default (`planning`, `implementation`, `qa`), use explicit rules for `planning -> implementation` and `qa -> run_completion` through the run-completion policy. If a template includes `qa -> launch`, add the explicit `qa -> launch` rule there.

## Gate Safety Field

Add `credentialed: true | false` to gate definitions.

Semantics:

- `credentialed: true` means the gate protects an external credentialed, irreversible, or materially operator-owned action. It always requires human approval.
- `credentialed: false` means the gate is eligible for policy auto-approval if structural predicates pass and policy conditions match.
- Missing `credentialed` defaults to `false` for backward compatibility, but generated templates should set it explicitly on every human-approval gate to make intent visible.

Rejected alternatives:

- `safety_class: "routine" | "credentialed" | "irreversible"` is more expressive but too large for the first fix and risks bikeshedding the taxonomy before the product has enough examples.
- `auto_approvable` repeats the policy answer at the gate layer and cannot express why the gate is safe or unsafe.

## Policy Predicate Extension

Add `when.credentialed_gate: boolean` to `approval_policy`.

Evaluation rule:

- The predicate resolves against `config.gates[gateResult.gate_id]?.credentialed === true`.
- If a gate is credentialed, `evaluateApprovalPolicy()` must return `require_human` before honoring any `auto_approve` rule. This is a hard safety stop, not merely a condition failure.

Implementation detail: `gate_passed` remains the structural/evidence boundary. For BUG-59, do not add `acceptance_criteria_all_pass` or `smoke_tests_exit` policy predicates yet. QA evidence should enter via existing gate predicates such as `requires_verification_pass` and required files. Add `requires_verification_pass: true` to the repo's `qa_ship_verdict` and generated QA ship gates so "QA auto-approval" actually depends on a pass/attested-pass turn.

## Code Integration

Do not move policy into `gate-evaluator.js`.

Implementation sites:

- `cli/src/lib/approval-policy.js`
  - Add the hard credentialed-gate guard.
  - Add `when.credentialed_gate`.
- `cli/src/lib/normalized-config.js`
  - Validate `when.credentialed_gate` as boolean.
  - Validate gate `credentialed` as boolean when present.
- `cli/src/lib/schemas/agentxchain-config.schema.json`
  - Add `credentialed` under `$defs.gate.properties`.
- `cli/src/lib/governed-state.js`
  - Add policy handling to `reconcilePhaseAdvanceBeforeDispatch()` when `evaluatePhaseExit()` returns `awaiting_human_approval`.
  - Emit the same phase-transition ledger shape already used by `applyAcceptedTurn()`: `type`, `gate_type`, `action`, `matched_rule`, `from_phase`, `to_phase`, `reason`, `gate_id`, `timestamp`.
  - Emit `phase_entered` with `trigger: "auto_approved"` to match the accepted-turn path.
- `cli/src/commands/init.js`, `cli/src/templates/governed/enterprise-app.json`, repo `agentxchain.json`
  - Add explicit `credentialed` fields.
  - Add safe explicit `approval_policy` defaults.
  - Add `requires_verification_pass: true` to QA ship gates that are supposed to auto-approve only when QA evidence passed.

Do not change `attemptTimeoutPhaseSkip()` in this implementation.

## Acceptance Tests

Add these tests before or with implementation:

- Unit: `approval-policy.test.js` covers `credentialed_gate: false` positive, `credentialed_gate: true` condition failure, and hard stop where a credentialed gate remains `require_human` even under catch-all `auto_approve`.
- Config validation: schema/normalized-config tests reject non-boolean `credentialed` and non-boolean `when.credentialed_gate`.
- Reconcile path: a pending phase transition re-evaluated by `reconcilePhaseAdvanceBeforeDispatch()` auto-advances under matching policy and writes an `approval_policy` ledger entry.
- Negative path: same reconcile scenario with `credentialed: true` remains paused with `pending_phase_transition`.
- Beta scenario: `cli/test/beta-tester-scenarios/bug-59-full-auto-gate-closure.test.js` proves a clean generated governed config can pass a QA gate with verification pass and no manual approval.
- Beta negative scenario: same policy plus credentialed QA/release gate blocks human approval.

Existing tests that assert no policy means human approval should remain unchanged. The fix should not silently alter projects without an `approval_policy` block.

## Documentation And Specs

Update in the implementation turn:

- `SPEC-GOVERNED-v5.md`
- `PROTOCOL-v7.md`
- `.planning/QA_ACCEPTANCE_GATE_SPEC.md`
- `.planning/GATE_ACTIONS_SPEC.md` if auto-approved gates do or do not trigger gate actions
- public docs under `website-v2/docs/` for continuous/autonomous operation

Docs must say:

- "Full-auto" means configured approval policy, not a new protocol mode.
- Routine gates can auto-approve after evidence passes.
- Credentialed gates cannot be auto-approved by policy.
- `--auto-approve` is an operator override and is not equivalent to project policy.

## BUG-53 Overlap

BUG-59 partially overlaps BUG-53. This plan fixes autonomous gate closure. It does not prove the continuous loop will derive the next objective after run completion. After implementation, rerun the BUG-53 reproduction. Close BUG-53 only if the continuous session chains naturally; otherwise leave BUG-53 scoped to next-objective derivation.

## Plan Review Gate

Implementation remains blocked until Claude reviews this plan in `AGENT-TALK.md` and either accepts it or challenges specific points. The review must explicitly decide:

- whether `credentialed` boolean is sufficient for the first release,
- whether explicit transition rules beat `default: auto_approve`,
- whether excluding `attemptTimeoutPhaseSkip()` is acceptable,
- whether adding `requires_verification_pass` to QA ship gates belongs in BUG-59 or a follow-up.
