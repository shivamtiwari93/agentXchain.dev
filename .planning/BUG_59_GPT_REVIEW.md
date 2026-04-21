# BUG-59 GPT 5.4 Review

Tag: `BUG-59-REVIEW-GPT`
Date: 2026-04-21
Scope: documentation-only review. No implementation files were changed.

## Status

This review is incomplete as a formal Pre-work Turn B because no `BUG-59-RESEARCH-CLAUDE` entry exists yet in `.planning/AGENT-TALK.md` or the planning docs. I cannot adversarially review Claude's BUG-59 research until Claude writes it.

I did complete the independent code review requested for GPT: read the gate evaluator, approval-policy evaluator, governed-state call path, run-loop auto-approval path, continuous-run handoff, admission-control policy checks, and current approval-policy tests.

## Primary Challenge

The roadmap's root-cause sentence is too broad:

> `approval_policy` is disconnected from `requires_human_approval` at `cli/src/lib/gate-evaluator.js:290-295`, so full-auto/autonomous runs always block on human-approval gates even when the configured policy says auto-approve.

The pure gate evaluator does return `awaiting_human_approval` at `cli/src/lib/gate-evaluator.js:290-295` and `405-408`, but that is not the end of the production state-machine path. `applyAcceptedTurn()` in `cli/src/lib/governed-state.js` explicitly consults `evaluateApprovalPolicy()` after both run-completion and phase-transition human-approval gate results:

- `cli/src/lib/governed-state.js:4768-4797` auto-completes a run and writes an `approval_policy` ledger entry when `evaluateRunCompletion()` returns `awaiting_human_approval` and policy returns `auto_approve`.
- `cli/src/lib/governed-state.js:4890-4919` auto-advances a phase and writes an `approval_policy` ledger entry when `evaluatePhaseExit()` returns `awaiting_human_approval` and policy returns `auto_approve`.

So the defect is not "policy never affects human-approval gates." The current code and tests prove it does affect them in the accepted-turn drain path. The likely product gap is narrower: the system lacks a first-class full-auto/autonomous mode with credentialed-gate boundaries, and some operator paths may not configure or preserve `approval_policy` in the tester's heartbeat scenario.

## Evidence Run

Command:

```bash
cd cli && node --test --test-timeout=30000 test/approval-policy.test.js test/e2e-parallel-approval-policy-lifecycle.test.js
```

Result: `17 tests / 11 suites / 17 pass / 0 fail / 0 skipped`.

Important covered behavior:

- `approval_policy.phase_transitions.default: "auto_approve"` returns `auto_approve`.
- Specific `from_phase` / `to_phase` rules work and first match wins.
- `when.gate_passed`, `when.roles_participated`, and `when.all_phases_visited` are enforced.
- The E2E lifecycle proves a `requires_human_approval` planning gate auto-advances, a parallel implementation gate waits for required participants then auto-advances, and a run-completion gate auto-completes with ledger/report evidence.

## Current Approval Policy Behavior

Supported config shape today:

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
            "roles_participated": ["pm"]
          }
        }
      ]
    },
    "run_completion": {
      "action": "auto_approve",
      "when": {
        "gate_passed": true,
        "all_phases_visited": true
      }
    }
  }
}
```

Supported `when` predicates today:

- `gate_passed: true`
- `roles_participated: string[]`
- `all_phases_visited: true`

Unsupported predicates needed for the tester wording:

- `acceptance_criteria_all_pass: true`
- `smoke_tests_exit: 0`
- `verification_commands_passed: true`
- `no_active_turns: true`
- `credentialed_gate: false`

Those unsupported predicates matter because the tester's report says "38/38 acceptance criteria PASS, smoke tests exit 0, no active turn." Today, policy can only see the abstract gate result plus phase participation, not the richer QA evidence details.

## Call-Site Review

Production references:

- `cli/src/lib/gate-evaluator.js:183` exports `evaluatePhaseExit()`.
- `cli/src/lib/gate-evaluator.js:325` exports `evaluateRunCompletion()`.
- `cli/src/lib/governed-state.js:1645` uses `evaluatePhaseExit()` for phase gate evaluation outside the accept-drain policy path.
- `cli/src/lib/governed-state.js:2660` uses `evaluatePhaseExit()` in unblock/approval recovery.
- `cli/src/lib/governed-state.js:4004` uses `evaluatePhaseExit()` for pre-gate/proposal checks.
- `cli/src/lib/governed-state.js:4749` uses `evaluateRunCompletion()` in `applyAcceptedTurn()`, then consults approval policy if the gate awaits human approval.
- `cli/src/lib/governed-state.js:4846` uses `evaluatePhaseExit()` in `applyAcceptedTurn()`, then consults approval policy if the gate awaits human approval.
- `cli/src/lib/governed-state.js:5199` probes phase exits for reconciliation.
- `cli/src/lib/reference-conformance-adapter.js:682` and `724` are conformance fixture paths, not primary runtime state transitions.

Implementation risk: moving policy into `gate-evaluator.js` would duplicate or bypass the existing state-machine policy handling unless the old governed-state calls are removed or normalized. A naive "wire it into the evaluator" patch can double-log, skip ledger context, or change diagnostic/conformance paths that should remain pure.

## Full-Auto Semantics Matrix

| Gate/boundary | Under full-auto, should auto-advance? | Rationale | Override mechanism if no |
|---|---:|---|---|
| `planning_signoff` | Yes, when required planning artifacts and structural checks pass. | Planning signoff is routine workflow control, not an external action. | Per-gate `credentialed: true` or policy rule `require_human`. |
| `implementation_complete` with verification pass | Yes. | This is the core autonomous delivery loop: structural files plus verification evidence should move to QA. | Policy rule can require human for high-risk phases. |
| `qa_ship_verdict` as phase transition to launch/release | Yes if it only means "QA passed and release phase can start." | The tester likely means a routine phase-complete gate. | Mark the gate credentialed or irreversible if it authorizes publishing/deploying. |
| `qa_ship_verdict` as permission to publish/deploy/send external effects | No by default. | Credentialed external side effects need explicit human or separately scoped credentials policy. | Gate-level `credentialed: true` must force human approval despite broad auto-approve rules. |
| `run_completion` | Yes, when final gate passes and no credentialed action is attached. | Completion is an internal state transition. | Credentialed final gate or explicit `run_completion.action: "require_human"`. |
| Phase transitions with failing gates | No. | Auto-approval must never override missing files, failed semantic checks, or failed verification. | None; fix the gate inputs. |
| Intake triage | Usually no for new untrusted external work; yes only for repo-owned scheduled/vision objectives with explicit auto-triage policy. | Intake creates work, not just approves a proven gate. | Separate intake policy, not gate approval policy. |
| Proposal acceptance | No by default. | Applying proposed changes mutates repo state and may be high blast-radius. | Explicit proposal policy with diff/classification constraints; not inherited from gate approval. |

## Config Schema Recommendation

Use an expanded `approval_policy`, not a new top-level `full_auto` mode.

Recommended shape for the plan turn to evaluate:

```json
{
  "approval_policy": {
    "mode": "manual_first",
    "phase_transitions": {
      "default": "auto_approve",
      "rules": [
        {
          "from_phase": "qa",
          "to_phase": "release",
          "action": "auto_approve",
          "when": {
            "gate_passed": true,
            "verification_passed": true,
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
  },
  "gates": {
    "qa_ship_verdict": {
      "requires_human_approval": true,
      "credentialed": false
    },
    "npm_publish": {
      "requires_human_approval": true,
      "credentialed": true
    }
  }
}
```

Why this direction:

- It preserves the existing policy subsystem and report surfaces.
- It avoids introducing a third project mode whose behavior overlaps with `governed`.
- It makes "full-auto" a policy posture, not a second state machine.
- It creates a narrow credentialed-gate escape hatch that broad auto-approve rules cannot override.

Failure modes of other options:

- Top-level `full_auto` risks splitting the state machine and docs into two product identities.
- Moving policy directly into `gate-evaluator.js` risks contaminating a mostly pure evaluator with ledger/state context and duplicating `governed-state.js` policy calls.
- Per-gate `auto_approvable` alone is not expressive enough for role participation, verification, and all-phases-visited conditions that already exist in policy.

## Answers To Roadmap Questions

1. `--auto-approve` is not equivalent to the tester's ask. It is a CLI/run-loop operator flag that approves pauses when encountered (`cli/src/commands/run.js:550-553`). It does not express credentialed-gate policy, reusable project defaults, richer predicates, or audit-friendly "why this gate was auto-approved by policy" semantics.

2. If a project sets `approval_policy.phase_transitions.rules[].action: "auto_approve"` today, it does something in the accepted-turn drain path. `governed-state.js:4890-4919` evaluates the policy and advances. The E2E approval-policy lifecycle proves this. The roadmap hypothesis that it never fires for human-approval gates is false.

3. No role's `write_authority` by itself can close a human approval gate. `write_authority` controls artifact mutation and turn result authority; gate closure is decided by gate predicates plus approval policy or explicit human/run-loop approval. That is correct for credentialed gates and insufficient for routine phase gates unless policy is configured.

## Open Risks Before Implementation

- Claude's required research pass is missing, so no implementation should start.
- The tester's exact config is not attached here; without it, BUG-59 may be a docs/config-default problem rather than a code-disconnect problem.
- Current policy does not classify credentialed gates; adding credentialed safety is real work, not just a wiring patch.
- Current policy event payloads contain matched rule and gate context but not explicit evidence refs for acceptance criteria or smoke commands.
- `approval_policy` docs already exist, so any claim that full-auto is impossible must reconcile with published docs and E2E tests.

## Verification

- `cd cli && node --test --test-timeout=30000 test/approval-policy.test.js test/e2e-parallel-approval-policy-lifecycle.test.js`
- Prior to this research pivot, the full CLI gate was green: `6693 tests / 1375 suites / 6688 pass / 0 fail / 5 skipped`.
