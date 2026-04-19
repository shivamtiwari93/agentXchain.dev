# BUG-44 Phase-Scoped Intent Retirement Spec

## Purpose

Prevent stale phase-bound repair intents from surviving after the run exits that phase and then blocking later acceptance in a new phase.

## Interface

- Intent files may carry `phase_scope: <phase-id> | null`.
- Intake triage/injection auto-derives `phase_scope` when the charter or acceptance contract references a known gate name.
- `acceptGovernedTurn()` must:
  - evaluate intent coverage with phase/gate context
  - retire approved intents on successful phase advance
- Run events gain `intent_retired_by_phase_advance`.

## Behavior

1. **Phase scope derivation**
   - If an intent explicitly records `phase_scope`, keep it.
   - Otherwise, if its charter or acceptance items reference a gate such as `implementation_complete`, map that gate to the owning phase and store the derived scope when triaging.

2. **Phase-aware coverage**
   - Intent coverage evaluation must treat an acceptance item as covered when:
     - the item belongs to an already-exited phase, or
     - the item references a gate with pass-language (`can advance`, `passes`, `passed`, `advance to`) and that gate is already `passed`.

3. **Retirement on phase advance**
   - When a phase transition succeeds, scan approved intents for the current run.
   - If an approved intent is scoped to the exited phase, transition it to `status: "satisfied"`.
   - If an approved intent has no stored `phase_scope` but all of its acceptance items are now satisfied by gate state or exited-phase semantics, also transition it to `satisfied`.
   - Emit `intent_retired_by_phase_advance` with the retired intent ids.

## Error Cases

- Unknown or invalid `phase_scope` values should fail triage validation when project routing is available.
- Intents from other runs must not be retired by the current run’s phase transition.
- Missing or malformed intent files must not break turn acceptance; retirement is best-effort over readable files only.

## Acceptance Tests

- `cli/test/intent-phase-scope.test.js`
  - inject/triage auto-derives `phase_scope` from `implementation_complete`
  - QA acceptance skips stale implementation-scoped coverage after the gate already passed
  - gate-state language is treated as covered even without an explicit stored phase scope
- `cli/test/beta-tester-scenarios/bug-44-phase-scoped-intent-retirement.test.js`
  - seeds the tester’s implementation repair intent
  - advances implementation to QA
  - dispatches QA through `agentxchain resume`
  - accepts QA through `agentxchain accept-turn`
  - proves QA acceptance does not fail on stale implementation coverage
- `cli/test/beta-tester-scenarios/bug-44-continue-from-continuous.test.js`
  - seeds the tester’s implementation repair intent plus a real QA follow-up intent on the same run
  - advances implementation to QA through the real acceptance path so phase-bound retirement actually happens
  - runs the exact command shape `agentxchain run --continue-from <run_id> --continuous --auto-approve --auto-checkpoint ...`
  - proves continuous mode dispatches the QA intent, not the exited implementation repair intent, and completes QA without the stale coverage pause
- `cli/test/claim-reality-preflight.test.js`
  - runs the packaged `agentxchain` tarball through the exact `run --continue-from <run_id> --continuous --auto-approve --auto-checkpoint ...` command shape
  - proves the shipped CLI retires the implementation-scoped intent, dispatches the QA follow-up intent, and completes QA without stale coverage enforcement

## Open Questions

- The timestamp-based fallback from older intent history remains weaker than intent-provenance linkage for ancient repos. BUG-44 does not expand that migration model; it only prevents stale phase-bound coverage from surviving after phase exit.
