## BUG-52 Reconcile Source Resolution Spec

### Purpose

Define how `reconcilePhaseAdvanceBeforeDispatch()` finds the accepted turn that originally requested a phase transition when `last_gate_failure.requested_by_turn` no longer points at the declarer.

### Interface

- Production seam: `reconcilePhaseAdvanceBeforeDispatch(root, config, state?)`
- Internal source inputs:
  - `.agentxchain/state.json` `last_gate_failure`
  - `.agentxchain/state.json` `queued_phase_transition`
  - `.agentxchain/state.json` `last_completed_turn_id`
  - `.agentxchain/history.jsonl` accepted turn history
- Proof surfaces:
  - `cli/test/beta-tester-scenarios/bug-52-gate-unblock-phase-advance.test.js`
  - `cli/test/claim-reality-preflight.test.js`

### Behavior

1. The reconciler resolves phase-transition source in this order:
   - exact `last_gate_failure.requested_by_turn`
   - exact `queued_phase_transition.requested_by_turn`
   - exact `last_completed_turn_id`
2. If the exact lookup does not itself carry `phase_transition_request`, fallback search is allowed only when a scoped descriptor exists:
   - `last_gate_failure` may fall back to the most recent history entry matching `to_phase` and, when present, `from_phase`
   - `queued_phase_transition` may fall back to the most recent history entry matching `queued_phase_transition.to` and, when present, `queued_phase_transition.from`
3. Bare `last_completed_turn_id` with `last_gate_failure === null` and `queued_phase_transition === null` must **not** trigger a global "latest phase request anywhere in history" scan. If the latest accepted turn had no `phase_transition_request`, reconciliation is a no-op.
4. The fallback is specific to phase-transition reconciliation. It must not change run-completion lookup behavior.
5. Once a matching declarer is found, the reconciler re-runs `evaluatePhaseExit()` and, if the gate now passes, advances phase before dispatch exactly as the existing BUG-52 contract requires.
6. **Turn 93 extension — `needs_human` orphan-request path.** When `last_gate_failure` is `null` but the accepted turn is still live enough to matter, the reconciler must treat the `null` failure as an opt-in entry path rather than a hard skip. This closes the `status: 'needs_human'` gap: `applyAcceptedTurn` short-circuits gate evaluation for `needs_human` turns (`cli/src/lib/governed-state.js:4657`), so any declared `phase_transition_request` is preserved only in history — never in `last_gate_failure` or `queued_phase_transition`. After `unblock` clears the human block, reconciliation must first try `last_completed_turn_id` and re-run `evaluatePhaseExit()` using that source when the accepted turn itself declared the request.
7. **Turn 94 extension — queued request recovery and null-source fail-closed.** If a blocked state still carries `queued_phase_transition`, reconciliation must treat that queued request as first-class preserved state even when the latest accepted turn had no `phase_transition_request`. Conversely, if both `last_gate_failure` and `queued_phase_transition` are absent, reconciliation must fail closed rather than mining an unrelated older request out of history.
8. **Turn 203 extension — operator_unblock fires standing-gate reconcile regardless of activeCount.** `cli/src/commands/resume.js` must route every `blocked + resumeVia === 'operator_unblock'` invocation through `reconcilePhaseAdvanceBeforeDispatch` with `allow_active_turn_cleanup: true` and `allow_standing_gate: true`, whether or not any active turns are retained. The prior `activeCount > 0` guard made `buildStandingPhaseTransitionSource` unreachable for the tester's v2.151.0 `tusq.dev` repro shape (PM `needs_human` accepted + checkpointed without declaring `phase_transition_request`, leaving `active_turns: {}` at unblock time), causing the dispatcher to loop back to PM. See `DEC-BUG52-UNBLOCK-ADVANCES-PHASE-ACTIVECOUNT-AGNOSTIC-001`.

### Error Cases

- If no matching declarer exists in history, reconciliation is a no-op.
- If the matched declarer's gate is still failing on disk, reconciliation is a no-op.
- If `last_gate_failure` is not `null` **and** not a phase-transition failure, the fallback must not run.
- If `last_gate_failure` is `null`, `queued_phase_transition` is `null`, and `last_completed_turn_id` does not resolve to a turn with a `phase_transition_request`, reconciliation is a no-op (dispatcher's existing role-selection path handles this correctly).
- If `queued_phase_transition.requested_by_turn` is missing from history, fallback search must remain constrained to `queued_phase_transition.from` / `queued_phase_transition.to`; it must not broaden into an unscoped history scan.

### Acceptance Tests

- Planning lane: `accept-turn`, then `checkpoint-turn`, then `escalate`, then `unblock` advances `planning -> implementation` and dispatches `dev`.
- QA lane: `accept-turn`, then `checkpoint-turn`, then `escalate`, then `unblock` advances `qa -> launch` and dispatches `launch`.
- Accumulated-state fallback: if `last_gate_failure.requested_by_turn` is repointed at a history entry with `phase_transition_request: null`, unblock still advances by finding the most recent matching declarer in history.
- **Turn 93 `needs_human` orphan-request path:** a `needs_human` PM turn that declares `phase_transition_request: 'implementation'` must still advance the phase after `accept-turn`, then `checkpoint-turn`, then `unblock` — even though `last_gate_failure` is `null` and `queued_phase_transition` is `null` throughout.
- **Turn 94 queued-request recovery path:** `resume` must advance from `queued_phase_transition.requested_by_turn` even when `last_completed_turn_id` points at a later accepted turn with `phase_transition_request: null`.
- **Turn 94 null-source fail-closed path:** `resume` must not advance when the latest blocked turn had no `phase_transition_request` and the only matching request lives deeper in history with no surviving `last_gate_failure` or `queued_phase_transition`.
- **Turn 203 activeCount=0 standing-gate path:** a PM turn accepted + checkpointed with `needs_human` and `phase_transition_request: null` leaves `active_turns: {}` at unblock time; `unblock <hesc>` must still advance the phase via the standing-gate reconcile (gate evidence present, `planning_signoff: pending`, `pending_phase_transition: null`, `queued_phase_transition: null`, `last_gate_failure: null`).
- Claim-reality guard fails if the BUG-52 scenario drops the separated `checkpoint-turn` invocation.

### Open Questions

- Whether future recovery commands besides pre-dispatch reconcile should share the same fallback helper.
- Whether non-`phase_transition` gate failures with an orphaned `queued_phase_transition` need an analogous relaxation. Deferred until a tester-quoted reproduction surfaces that shape; Turn 94 resolves the pure queued-request path, but off-type gate failures remain intentionally out of scope.
