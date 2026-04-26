# BUG-76 / BUG-77 Continuous Planning Baseline Classifier Spec

**Status:** BUG-76 and BUG-77 both implemented and regression-tested.

## Purpose

Continuous vision-driven mode must not report terminal completion when concrete product work remains in repo-native planning artifacts.

BUG-76 is the strongest failure shape: `.planning/ROADMAP.md` contains explicit unchecked `M<n>` milestone work, but `run --continuous` can exit with `runs_completed: 0`, `status: completed`, no objective, no pending intents, and no next actions.

BUG-77 is the related roadmap-replenishment shape: `.planning/ROADMAP.md` is exhausted, but `.planning/VISION.md` still contains unplanned future scope, so continuous mode should route PM to derive the next bounded roadmap increment instead of claiming full vision completion or staying anchored to stale milestone gates.

## Interface

- Classifier helper (BUG-76): `deriveRoadmapCandidates(root, roadmapPath?)` in `cli/src/lib/vision-reader.js`
- Classifier helper (BUG-77): `detectRoadmapExhaustedVisionOpen(root, visionPath, roadmapPath?)` in `cli/src/lib/vision-reader.js`
- Continuous seed path: `seedFromVision(root, visionPath, options?)` in `cli/src/lib/continuous-run.js`
- Status surface: `agentxchain status --json` `next_actions[]` — emits `roadmap_open_work_detected` (BUG-76) or `roadmap_exhausted_vision_open` (BUG-77)
- BUG-76 command-chain proof: `cli/test/beta-tester-scenarios/bug-76-roadmap-open-work-continuous.test.js`
- BUG-77 command-chain proof: `cli/test/beta-tester-scenarios/bug-77-roadmap-exhausted-vision-open.test.js`

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
- `AT-BUG77-001`: when ROADMAP has no unchecked M milestone but VISION has unplanned V2/V3 scope, continuous mode must dispatch PM in roadmap-replenishment mode instead of claiming full completion. The seeded intent must carry `preferred_role: "pm"` when a PM role exists and `phase_scope: "planning"` when the project has a planning route, so this behavior is explicit rather than an accident of default routing. **Implemented and tested: `cli/test/beta-tester-scenarios/bug-77-roadmap-exhausted-vision-open.test.js`.**
- `AT-BUG77-002`: `agentxchain status --json` exposes `next_actions[].type = "roadmap_exhausted_vision_open"` when terminal-looking state has exhausted roadmap but open vision scope.
- `AT-BUG77-003`: `detectRoadmapExhaustedVisionOpen()` in `vision-reader.js` classifies roadmap/vision state and returns `{ open, reason, unplanned_sections, evidence_map }`.

## Resolved Open Questions

1. BUG-77 uses `roadmap_replenishment` as the `source` field on seeded intents and `roadmap_exhausted_vision_open` as the intake event category. This is distinct from both `roadmap_open_work` (BUG-76) and `vision_scan` (broad vision derivation).
2. Stale milestone gates are NOT automatically bypassed. The replenishment intent goes through the normal intake pipeline. If the governed run becomes blocked on a stale gate, the operator is shown the blocker. A clean replenishment run starts fresh without inheriting stale gate context because `prepareIntentForDispatch` with `allowTerminalRestart: true` creates a new run.
