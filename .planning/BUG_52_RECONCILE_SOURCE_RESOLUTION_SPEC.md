## BUG-52 Reconcile Source Resolution Spec

### Purpose

Define how `reconcilePhaseAdvanceBeforeDispatch()` finds the accepted turn that originally requested a phase transition when `last_gate_failure.requested_by_turn` no longer points at the declarer.

### Interface

- Production seam: `reconcilePhaseAdvanceBeforeDispatch(root, config, state?)`
- Internal source inputs:
  - `.agentxchain/state.json` `last_gate_failure`
  - `.agentxchain/history.jsonl` accepted turn history
- Proof surfaces:
  - `cli/test/beta-tester-scenarios/bug-52-gate-unblock-phase-advance.test.js`
  - `cli/test/claim-reality-preflight.test.js`

### Behavior

1. The reconciler first tries the exact `last_gate_failure.requested_by_turn` lookup.
2. If that history entry is missing or has `phase_transition_request: null`, the reconciler must fall back to the most recent history entry that matches:
   - `phase_transition_request === last_gate_failure.to_phase`
   - `phase === last_gate_failure.from_phase` when `from_phase` is present
3. The fallback is specific to phase-transition reconciliation. It must not change run-completion lookup behavior.
4. Once a matching declarer is found, the reconciler re-runs `evaluatePhaseExit()` and, if the gate now passes, advances phase before dispatch exactly as the existing BUG-52 contract requires.

### Error Cases

- If no matching declarer exists in history, reconciliation is a no-op.
- If the matched declarer's gate is still failing on disk, reconciliation is a no-op.
- If `last_gate_failure` is not a phase-transition failure, the fallback must not run.

### Acceptance Tests

- Planning lane: `accept-turn`, then `checkpoint-turn`, then `escalate`, then `unblock` advances `planning -> implementation` and dispatches `dev`.
- QA lane: `accept-turn`, then `checkpoint-turn`, then `escalate`, then `unblock` advances `qa -> launch` and dispatches `launch`.
- Accumulated-state fallback: if `last_gate_failure.requested_by_turn` is repointed at a history entry with `phase_transition_request: null`, unblock still advances by finding the most recent matching declarer in history.
- Claim-reality guard fails if the BUG-52 scenario drops the separated `checkpoint-turn` invocation.

### Open Questions

- Whether future recovery commands besides pre-dispatch reconcile should share the same fallback helper.
