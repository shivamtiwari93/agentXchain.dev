# BUG-76 / BUG-77 Continuous Planning Baseline Classifier Spec

**Status:** BUG-76 implementation in progress; BUG-77 remains the related roadmap-exhausted branch.

## Purpose

Continuous vision-driven mode must not report terminal completion when concrete product work remains in repo-native planning artifacts.

BUG-76 is the strongest failure shape: `.planning/ROADMAP.md` contains explicit unchecked `M<n>` milestone work, but `run --continuous` can exit with `runs_completed: 0`, `status: completed`, no objective, no pending intents, and no next actions.

BUG-77 is the related roadmap-replenishment shape: `.planning/ROADMAP.md` is exhausted, but `.planning/VISION.md` still contains unplanned future scope, so continuous mode should route PM to derive the next bounded roadmap increment instead of claiming full vision completion or staying anchored to stale milestone gates.

## Interface

- Classifier helper: `deriveRoadmapCandidates(root, roadmapPath?)` in `cli/src/lib/vision-reader.js`
- Continuous seed path: `seedFromVision(root, visionPath, options?)` in `cli/src/lib/continuous-run.js`
- Status surface: `agentxchain status --json` `next_actions[]`
- BUG-76 command-chain proof: `cli/test/beta-tester-scenarios/bug-76-roadmap-open-work-continuous.test.js`

## Behavior

1. Before deriving from broad VISION.md goals, continuous mode scans `.planning/ROADMAP.md` for unchecked checklist items under `M<n>` milestone headings.
2. The first unchecked, non-duplicated roadmap item becomes a `roadmap_open_work` candidate with:
   - milestone heading
   - checklist item text
   - source line
   - priority `p1`
3. `seedFromVision()` records that candidate through the normal intake pipeline with event category `roadmap_open_work_detected`.
4. The resulting intent charter starts with `[roadmap]` and includes acceptance criteria tied to the roadmap line.
5. `agentxchain status --json` appends a typed `next_actions[]` entry when the governed run/session looks terminal but unchecked roadmap work remains.
6. Existing VISION.md derivation still runs after roadmap-open-work candidates are exhausted.

## Error Cases

- Missing `ROADMAP.md` is not fatal; continuous mode falls back to VISION.md derivation.
- Unreadable `ROADMAP.md` is a classifier error because the operator cannot trust an idle completion if the roadmap could not be read.
- Checked items (`- [x]`) are ignored.
- Unchecked items not under `M<n>` headings are ignored for BUG-76; broader backlog parsing can be specified separately.
- Roadmap items already covered by active/completed intake charters are skipped to avoid duplicate intent spam.

## Acceptance Tests

- `AT-BUG76-001`: `deriveRoadmapCandidates()` returns M28 before VISION.md derivation when ROADMAP has unchecked M28/M29 items.
- `AT-BUG76-002`: `seedFromVision()` seeds a `[roadmap]` intent before broad `[vision]` intent derivation.
- `AT-BUG76-003`: `agentxchain status --json` exposes `next_actions[].type = "roadmap_open_work_detected"` when terminal-looking state has unchecked roadmap work.
- `AT-BUG76-004`: command-chain test spawns `agentxchain run --continuous` against a completed launch-state fixture with unchecked M28 and proves one governed run executes instead of idle-completing with `runs_completed: 0`.
- `AT-BUG77-001`: when ROADMAP has no unchecked M milestone but VISION has unplanned V2/V3 scope, continuous mode must dispatch PM in roadmap-replenishment mode instead of claiming full completion. **Not yet implemented in this slice.**

## Open Questions

1. Should BUG-77 use a new `roadmap_replenishment` intake source instead of overloading `vision_scan`?
2. Should blocked stale milestone gates ever be bypassed automatically for roadmap replenishment, or should the system create a typed blocker with an explicit operator command to start a clean replenishment run?
