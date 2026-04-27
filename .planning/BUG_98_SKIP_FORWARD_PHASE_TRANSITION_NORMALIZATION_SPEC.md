# BUG-98 Skip-Forward Phase Transition Normalization Spec

## Purpose

Recover governed turns that express valid forward-progress intent but copy a later phase name from historical context instead of the immediate next phase. This closes the DOGFOOD-100 blocker where a QA turn running in `implementation` emitted `phase_transition_request: "launch"` even though the only legal next phase was `qa`.

## Interface

- Input: staged `turn-result.json`, current state phase, normalized routing config.
- Normalization context:
  - `phase`: authoritative current phase from state.
  - `routing`: ordered phase map from config.
  - `allowedNextRoles`: roles legal in the current phase.
- Output: normalized turn result plus `staged_result_auto_normalized` event metadata.

## Behavior

- If the turn is authoritative, `status: "completed"`, the current phase is known, the current phase is not terminal, `run_completion_request` is not true, and `phase_transition_request` points to a defined phase after the immediate next phase, rewrite it to the immediate next phase.
- Emit `field: "phase_transition_request"` with `rationale: "skip_forward_phase_corrected_to_next_phase"`.
- If `proposed_next_role` equals the stale requested phase or is illegal for the current phase, and the immediate next phase has an `entry_role` that is allowed in the current phase, rewrite `proposed_next_role` to that entry role.
- Emit `field: "proposed_next_role"` with `rationale: "aligned_to_corrected_phase_entry_role"`.
- Dispatch prompts must explicitly state not to skip ahead to later phases.

## Error Cases

- Unknown `phase_transition_request` remains a protocol error unless an existing gate-name normalizer can safely map it.
- Review-only skip-forward requests remain fail-closed so custom review phases cannot be silently bypassed.
- Backward or same-phase requests remain fail-closed for authoritative roles.
- Final-phase turns must still use `run_completion_request: true`, not a phase transition.
- If the immediate next phase has no routing entry role or that role is not allowed from the current phase, do not invent a role; leave `proposed_next_role` to existing validation/normalization rules.

## Acceptance Tests

- Unit: `implementation` turn with `phase_transition_request: "launch"` normalizes to `"qa"` and records a normalization event.
- Unit: backward authoritative `phase_transition_request: "planning"` remains rejected.
- Command-chain: `agentxchain accept-turn --turn <id>` accepts a retained QA turn in `implementation` whose staged result requests `"launch"` and proposes `"launch"`, normalizing to `phase_transition_request: "qa"` and `proposed_next_role: "qa"`.
- Existing BUG-95, BUG-96, and BUG-97 staged-result normalization regressions continue to pass.
- Shipped-package tusq.dev retry resumes the retained QA turn without manual staging edits or operator `accept-turn` recovery and proceeds past the skip-forward phase request.

## Open Questions

- None for this fix. Multi-phase skip-forward approval is a separate product feature and must not be inferred from this recovery path.
