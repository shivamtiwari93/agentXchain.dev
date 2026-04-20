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
5. **Turn 93 extension — `needs_human` orphan-request path.** When `last_gate_failure` is `null` but the accepted turn is still live enough to matter, the reconciler must treat the `null` failure as an opt-in entry path rather than a hard skip. This closes the `status: 'needs_human'` gap: `applyAcceptedTurn` short-circuits gate evaluation for `needs_human` turns (`cli/src/lib/governed-state.js:4657`), so any declared `phase_transition_request` is preserved only in history — never in `last_gate_failure` or `queued_phase_transition`. After `unblock` clears the human block, reconciliation must look up the most recent declarer by `last_completed_turn_id` and re-run `evaluatePhaseExit()` using that source. A non-`phase_transition` gate failure (for example `run_completion`) is still a hard skip; the relaxation only opens the `null` case.

### Error Cases

- If no matching declarer exists in history, reconciliation is a no-op.
- If the matched declarer's gate is still failing on disk, reconciliation is a no-op.
- If `last_gate_failure` is not `null` **and** not a phase-transition failure, the fallback must not run.
- If `last_gate_failure` is `null` **and** `last_completed_turn_id` does not resolve to a turn with a `phase_transition_request`, reconciliation is a no-op (dispatcher's existing role-selection path handles this correctly).

### Acceptance Tests

- Planning lane: `accept-turn`, then `checkpoint-turn`, then `escalate`, then `unblock` advances `planning -> implementation` and dispatches `dev`.
- QA lane: `accept-turn`, then `checkpoint-turn`, then `escalate`, then `unblock` advances `qa -> launch` and dispatches `launch`.
- Accumulated-state fallback: if `last_gate_failure.requested_by_turn` is repointed at a history entry with `phase_transition_request: null`, unblock still advances by finding the most recent matching declarer in history.
- **Turn 93 `needs_human` orphan-request path:** a `needs_human` PM turn that declares `phase_transition_request: 'implementation'` must still advance the phase after `accept-turn`, then `checkpoint-turn`, then `unblock` — even though `last_gate_failure` is `null` and `queued_phase_transition` is `null` throughout.
- Claim-reality guard fails if the BUG-52 scenario drops the separated `checkpoint-turn` invocation.

### Open Questions

- Whether future recovery commands besides pre-dispatch reconcile should share the same fallback helper.
- Whether non-`phase_transition` gate failures with an orphaned `queued_phase_transition` need an analogous relaxation. Deferred until a tester-quoted reproduction surfaces that shape; `null` is the only observed gap on v2.147.0.
