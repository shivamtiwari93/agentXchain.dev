# V1.1 Release Handoff Spec — AgentXchain

> Sequencing contract for the future human-operated `1.1.0` cut, with explicit separation from the still-active `1.0.0` release path.

---

## Purpose

Define a single, unambiguous human handoff rule for the `1.1.0` release track.

This spec exists because the repo currently contains both:

- an immediate human release path for `1.0.0`
- future-facing planning artifacts for `1.1.0`

Without an explicit sequencing contract, the operator could incorrectly treat the `1.1.0` checklist as the active release-day command sheet while the workspace is still on the pre-`1.0.0` public release track.

---

## Interface/Schema

### Handoff State

```ts
type V1_1ReleaseHandoffState = {
  current_cli_version: string;
  immediate_human_track: "v1.0.0" | "v1.1.0";
  v1_0_public_release_complete: boolean;
  v1_1_docs_ready: boolean;
  v1_1_preflight_ready: boolean;
  dedicated_parallel_dogfood_required: boolean;
  schema_migration_preflight_required: boolean;
};
```

### Authoritative Surfaces

- Immediate release-day tasks: `.planning/HUMAN_TASKS.md`
- Current public-release gate: `.planning/V1_RELEASE_CHECKLIST.md`
- Future `1.1.0` release gate: `.planning/V1_1_RELEASE_CHECKLIST.md`
- Future `1.1.0` scope: `.planning/V1_1_RELEASE_SCOPE_SPEC.md`

### Current Repository Facts

- `cli/package.json` is still below `1.0.0`
- `cli/scripts/release-preflight.sh` is now version-parameterized for `1.0.0` and future cuts via `--target-version`
- `HUMAN_TASKS.md` still correctly lists the immediate `1.0.0` release-day actions

---

## Behavior

### 1. Immediate Human Track Selection

While `cli/package.json` remains below `1.0.0`, the immediate human-operated release path remains the `1.0.0` cut described in:

- `.planning/HUMAN_TASKS.md`
- `.planning/V1_RELEASE_CHECKLIST.md`
- `.planning/RELEASE_CUT_SPEC.md`

The `1.1.0` planning artifacts are future-facing only during this period.

### 2. When The `1.1.0` Handoff Becomes Actionable

The `1.1.0` handoff becomes actionable only after all of the following are true:

1. the `1.0.0` public release is complete
2. the operator intentionally starts a `1.1.0` release candidate cycle
3. release preflight tooling is available for `1.1.0` via the parameterized `--target-version` interface
4. the `1.1.0` human release sequence is reflected in the operator-facing handoff docs

Until then, `.planning/V1_1_RELEASE_CHECKLIST.md` is a readiness/planning artifact, not the active release-day task list.

### 3. Parallel-Turn Dogfood Requirement

`1.1.0` does **not** require a dedicated human-operated parallel-turn dogfood run as a release gate.

Reason:

- the automated acceptance matrix already covers the parallel happy path, CLI targeting, conflict detection, and conflict recovery
- Scenario D remains valuable, but it validates human/operator ergonomics rather than product correctness

Therefore:

- automated E2E coverage is sufficient for the `1.1.0` release gate
- Scenario D remains a post-release, non-gating validation track

### 4. Schema-Migration Check Placement

`release-preflight.sh` does **not** need a dedicated v1.1 schema-migration smoke check before the `1.1.0` cut.

Reason:

- release preflight is a local package-release tool
- schema migration is a governed project/runtime behavior already covered by automated tests and specs
- adding project-state migration logic to the shell preflight would expand its scope and create a second source of truth for state validation

Therefore:

- schema migration remains verified by the test suite and normative specs
- release preflight should stay focused on workspace/package release invariants

### 5. HUMAN_TASKS Duplication Rule

`HUMAN_TASKS.md` should not list speculative `1.1.0` release-day tasks while the repo is still on the `1.0.0` release track.

The file should:

- keep the immediate public-release steps visible
- keep Scenario D tracked as post-release human validation
- avoid duplicating a second, future release-day sequence until the project actually transitions to a `1.1.0` cut

---

## Error Cases

1. **Premature track switch:** If the operator follows the `1.1.0` release brief before the `1.0.0` public release is complete, the release handoff is invalid even though preflight tooling is already parameterized.
2. **False gate expansion:** If a dedicated parallel-turn dogfood run is treated as mandatory for `1.1.0`, the checklist incorrectly blocks release on post-release operator evidence.
3. **Preflight scope creep:** If schema-migration verification is duplicated in release preflight without a broader tooling design, the release shell script becomes a second validator with drift risk.
4. **Task duplication:** If `HUMAN_TASKS.md` lists both immediate `1.0.0` and speculative `1.1.0` release-day commands simultaneously, the operator surface becomes ambiguous.

---

## Acceptance Tests

1. A reviewer can determine from this spec which human release track is active today without inferring from conversation history.
2. The spec explicitly states that `1.1.0` handoff is future-facing until `1.0.0` is released even though release preflight is already parameterized.
3. The spec closes the question of whether a dedicated parallel-turn dogfood run is required before `1.1.0`.
4. The spec closes the question of whether `release-preflight.sh` needs a v1.1 schema-migration smoke check.
5. The spec preserves `HUMAN_TASKS.md` as the active immediate release surface instead of duplicating future release-day steps prematurely.

---

## Open Questions

None for this slice. The preflight parameterization contract is now frozen and implemented.
