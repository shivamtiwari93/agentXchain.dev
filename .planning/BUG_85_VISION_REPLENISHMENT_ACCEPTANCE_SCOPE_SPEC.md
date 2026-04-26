# BUG-85: VISION Replenishment Acceptance Scope Spec

## Purpose

Continuous mode must replenish an exhausted roadmap from remaining `VISION.md` scope without creating an acceptance item so broad that a valid PM planning turn cannot satisfy it.

BUG-85 was discovered during the tusq.dev DOGFOOD-100 run on `agentxchain@2.155.33`: roadmap replenishment generated one acceptance item containing every unplanned VISION heading. The PM turn added a concrete M30 milestone grounded in `VISION.md`, but acceptance failed because the turn did not semantically cover the entire heading list.

## Interface

`cli/src/lib/continuous-run.js` generates roadmap-replenishment intake intents when:

- `.planning/ROADMAP.md` has no unchecked milestone work, and
- `.planning/VISION.md` still contains unplanned scope.

The generated intent must include:

- a concise charter with a summarized candidate pool,
- `preferred_role: "pm"` when a PM role exists,
- `phase_scope: "planning"` when a planning route exists,
- an acceptance contract that asks for one bounded VISION-backed milestone, not all remaining VISION sections.

`cli/src/lib/governed-state.js` evaluates both new and legacy roadmap-replenishment acceptance items.

## Behavior

- New replenishment contracts require a new unchecked milestone in `ROADMAP.md`.
- New replenishment contracts require the milestone to cite at least one concrete `VISION.md` source section from the unplanned backlog.
- New replenishment contracts require bounded, testable, non-duplicate scope.
- Future charters may summarize the first few unplanned VISION sections and retain the full section list as structured event signal metadata.
- Legacy acceptance items of the form `Milestone scope derived from VISION.md sections: <huge list>` are satisfied when the turn cites `VISION.md` and at least one listed section.

## Error Cases

- If no concrete VISION source is cited, the scope-traceability item remains unaddressed.
- If the PM does not add unchecked roadmap items, the roadmap-item acceptance item remains unaddressed.
- If the turn only re-verifies previous completed milestones, the bounded/non-duplicate item remains eligible to fail under the normal coverage path.

## Acceptance Tests

- `cli/test/beta-tester-scenarios/bug-85-vision-replenishment-acceptance-scope.test.js` proves a legacy tusq-shaped failed PM result accepts when it cites `VISION.md` and one listed section.
- The same test proves newly generated roadmap-replenishment intents do not put the full unplanned VISION heading backlog into a single acceptance item.

## Open Questions

- Whether `detectRoadmapExhaustedVisionOpen()` should eventually rank unplanned VISION sections by product dependency order instead of preserving document order.
