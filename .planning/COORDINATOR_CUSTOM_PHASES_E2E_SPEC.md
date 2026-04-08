# Coordinator Custom Phases E2E Spec

## Purpose

Prove that custom phases (beyond the default `planning → implementation → qa`) work correctly in multi-repo coordinator execution. Single-repo custom phases are proven by `e2e-custom-phases-runtime.test.js`. This spec closes the gap between "single-repo custom phases work" and "multi-repo coordinator custom phases work."

## Interface

The test exercises:
- Coordinator config with 4 phases: `planning → design → implementation → qa`
- Two child repos (`api`, `web`) with matching 4-phase routing
- Real CLI subprocess execution (`agentxchain step --resume`) in child repos
- Coordinator phase gate evaluation and approval via `multi step` and `multi approve-gate`

## Behavior

### Happy Path (AT-COORD-CP-001)
1. Coordinator initializes with 4-phase routing including custom `design` phase
2. Planning phase executes across both child repos (api, web)
3. `multi step` requests `planning → design` phase transition
4. `multi approve-gate` advances to `design` phase
5. Design phase executes across both child repos
6. `multi step` requests `design → implementation` phase transition
7. `multi approve-gate` advances to `implementation` phase
8. Implementation phase executes across both child repos
9. QA phase executes across both child repos
10. Run completes successfully

### Skip Rejection (AT-COORD-CP-002)
1. Coordinator initializes with 4-phase routing including custom `design` phase
2. Planning phase completes across both child repos
3. Attempt to evaluate phase gate for `planning → implementation` (skipping `design`)
4. Coordinator returns `phase_skip_forbidden` blocker
5. Phase remains `planning`, status remains `active`

### Phase Order Truth (AT-COORD-CP-003)
1. Final coordinator state has phase history showing ordered progression through all 4 phases
2. Coordinator history contains phase transition entries for each custom phase boundary
3. Barriers for all workstreams are satisfied

## Error Cases

- Child repo with mismatched phase order: rejected at `multi init` by `repo_phase_alignment_invalid`
- Phase skip via direct `requestPhaseTransition(targetPhase)`: rejected by `phase_skip_forbidden`
- Transition from final phase: rejected by `no_next_phase`

## Acceptance Tests

| ID | Assertion |
|---|---|
| AT-COORD-CP-001 | Coordinator with custom `design` phase completes a full lifecycle through `planning → design → implementation → qa` with real child-repo execution |
| AT-COORD-CP-002 | Coordinator rejects `planning → implementation` skip when `design` is declared between them |
| AT-COORD-CP-003 | Coordinator history contains phase transition entries for `planning→design` and `design→implementation` and `implementation→qa` |

## Open Questions

None — this is a proof test for behavior already implemented in `coordinator-gates.js` and `coordinator-config.js`.
