# Approval Policy Spec

> Configurable conditional auto-approval for phase transitions and run completion.

## Purpose

The current gate system has two modes:
1. `requires_human_approval: true` on a gate → always pauses for human approval
2. `--auto-approve` on `agentxchain run` → bypasses ALL approval gates

There is no middle ground. For lights-out operation, operators need **conditional approval** — rules that auto-approve specific gates when evidence criteria are met, while still requiring human approval for high-risk transitions.

## Interface

New optional top-level config section in `agentxchain.json`:

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
            "gate_passed": true
          }
        },
        {
          "from_phase": "qa",
          "to_phase": "release",
          "action": "require_human"
        }
      ]
    },
    "run_completion": {
      "action": "require_human"
    }
  }
}
```

### Config Schema

**`approval_policy`** (optional object):

- **`phase_transitions`** (optional object):
  - **`default`**: `"require_human"` | `"auto_approve"` — fallback when no rule matches. Default: `"require_human"`.
  - **`rules`** (optional array): ordered list of rules, first match wins.
    - **`from_phase`** (optional string): source phase. Omit to match any.
    - **`to_phase`** (optional string): target phase. Omit to match any.
    - **`action`**: `"auto_approve"` | `"require_human"` — what to do when rule matches.
    - **`when`** (optional object): additional conditions. All must be true.
      - **`gate_passed`** (boolean): gate structural predicates must have passed.
      - **`roles_participated`** (string[]): these role IDs must have at least one accepted turn in the current phase.

- **`run_completion`** (optional object):
  - **`action`**: `"require_human"` | `"auto_approve"` — default: `"require_human"`.
  - **`when`** (optional object): conditions for auto-approval.
    - **`gate_passed`** (boolean): completion gate must have passed.
    - **`all_phases_visited`** (boolean): every phase in routing must have been active at least once.

### Invariants

1. `approval_policy` only applies to gates that have `requires_human_approval: true`. Gates without that flag already auto-advance — the policy does not affect them.
2. `--auto-approve` on `run` overrides approval_policy entirely (backwards compatible).
3. If `approval_policy` is absent, behavior is identical to today.
4. Policy evaluation is pure: `(gateResult, state, config) → "auto_approve" | "require_human"`.
5. Policy decisions are logged in the decision ledger for auditability.
6. `when.gate_passed: true` is the minimum safety condition — it means "only auto-approve if all structural predicates (files, verification, ownership) already passed."

## Behavior

### Gate Evaluator Changes

`evaluatePhaseExit` and `evaluateRunCompletion` already return `action: 'awaiting_human_approval'` when `requires_human_approval` is set. The new layer sits BETWEEN the gate evaluator and the state machine:

```
gate evaluator returns 'awaiting_human_approval'
  → approval policy evaluates rules
    → if policy says 'auto_approve': convert to 'advance' (or 'complete')
    → if policy says 'require_human': keep 'awaiting_human_approval'
```

This means:
- Gate predicates (files, verification, ownership) are ALWAYS evaluated first
- Approval policy can only RELAX the human-approval requirement, never override a gate failure
- The gate evaluator itself remains pure and unchanged

### New Function

```js
/**
 * Evaluate approval policy for a gate result.
 * @param {object} params
 * @param {object} params.gateResult - from evaluatePhaseExit or evaluateRunCompletion
 * @param {string} params.gateType - 'phase_transition' | 'run_completion'
 * @param {object} params.state - current run state
 * @param {object} params.config - normalized config
 * @returns {{ action: 'auto_approve' | 'require_human', matched_rule: object|null, reason: string }}
 */
export function evaluateApprovalPolicy({ gateResult, gateType, state, config })
```

### Integration Point

In `governed-state.js`, after `evaluatePhaseExit` or `evaluateRunCompletion` returns `'awaiting_human_approval'`:

```js
if (gateResult.action === 'awaiting_human_approval') {
  const policyResult = evaluateApprovalPolicy({
    gateResult, gateType: 'phase_transition', state, config,
  });
  if (policyResult.action === 'auto_approve') {
    // Convert to advance — log the policy decision
    gateResult = { ...gateResult, action: 'advance', auto_approved_by_policy: true };
  }
}
```

### Run.js Changes

The `approveGate` callback in `run.js` already handles `--auto-approve`. With approval policy, this callback is only reached when the policy says `require_human` (or when no policy is configured). No changes needed to `run.js` unless the operator wants policy-based approval in interactive mode — which we handle by evaluating the policy in `governed-state.js` before the state reaches the `approveGate` callback.

## Error Cases

1. **Invalid `approval_policy` config**: `normalized-config.js` validation rejects unknown fields, bad action values, or `from_phase`/`to_phase` referencing non-existent routing phases.
2. **`when.roles_participated` referencing unknown role**: validation warns but does not reject (role may be added later).
3. **Policy auto-approves but gate has not passed**: impossible — policy only evaluates when `action === 'awaiting_human_approval'`, which requires all predicates to have passed first.

## Acceptance Tests

1. **AT-AP-001**: No `approval_policy` config → behavior identical to today (all `requires_human_approval` gates pause).
2. **AT-AP-002**: `approval_policy.phase_transitions.default: "auto_approve"` + `when.gate_passed: true` → phase transition with `requires_human_approval` auto-advances when gate passes.
3. **AT-AP-003**: Rule with `from_phase: "planning"` + `to_phase: "implementation"` + `action: "auto_approve"` → only that specific transition auto-approves.
4. **AT-AP-004**: Rule with `action: "require_human"` for `qa → release` → that transition always pauses regardless of default.
5. **AT-AP-005**: `when.roles_participated: ["qa"]` → auto-approve only if QA role has an accepted turn in the current phase.
6. **AT-AP-006**: `--auto-approve` flag on `run` → overrides approval_policy, approves everything.
7. **AT-AP-007**: `run_completion.action: "auto_approve"` + `when.gate_passed: true` + `when.all_phases_visited: true` → run completes without human approval when all phases visited and gate passes.
8. **AT-AP-008**: Policy decision is recorded in decision ledger with `type: "approval_policy"`.
9. **AT-AP-009**: Config validation rejects `action: "skip"` (unknown action).
10. **AT-AP-010**: Config validation rejects `from_phase: "nonexistent"` when routing is defined.
11. **AT-AP-011**: Gate that fails structurally → policy is never evaluated, gate failure stands.
12. **AT-AP-012**: Multiple rules → first match wins.

## Open Questions

1. Should policy auto-approval emit a notification to the dashboard/operator? (Probably yes — `auto_approved_by_policy` flag in state or history.)
2. Should there be a `when.min_turns_in_phase` condition? (Useful but adds complexity — defer to v2.)
