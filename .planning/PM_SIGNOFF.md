# PM Signoff — M16: Role Charter Well-Formedness — Open-Ended Roles Validation — Vision Closure (VISION.md:100–130)

Approved: YES

**Run:** `run_dc50efa0354c0768`
**Phase:** planning
**Turn:** `turn_5abb2e0f09dc2e4f`
**Date:** 2026-06-27

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

The operator/architect who configures an AgentXchain factory with a **non-trivial org chart** — more than the reference `pm`/`dev`/`qa` trio. VISION.md:100–130 ("Roles Are Open-Ended, Not Fixed") and non-negotiable truth #5 (VISION.md:297) demand the framework support "any number of agent roles with any kind of charter" — architect, security reviewer, technical writer, release manager, etc. When this user adds a custom role, they need to know it is a **well-formed chartered participant**, not dead config: a role with a mandate but no authority boundary, no producible/owned artifact, and no phase that routes to it is silently broken until a run stalls. M16 gives them a single command that answers "is this role's charter complete?" against the exact four-part invariant the vision fixes.

### Core Pain Point

VISION.md:123–128 fixes a precise, testable invariant for every chartered role: **(1) a mandate, (2) authority boundaries, (3) produces governed artifacts, (4) participates in a structured workflow.** The framework *permits* arbitrary roles (any id `^[a-z0-9_-]+$`; `enterprise-app` ships `architect`+`security_reviewer`) but **does not enforce this invariant on a role definition:**

1. `normalized-config.js` checks only that `title`/`mandate` are non-empty and `write_authority` is a valid enum — nothing about routing or artifact production.
2. `admission-control.js` (ADM-001/002/004) checks **phase-level** file-production topology and `owned_by` reachability — it answers questions about *phases and gates*, not "is *this role* a complete chartered participant."
3. `agentxchain role` exposes only `list` and `show` (role.js:8) — there is **no `validate`.**

So the very thing the vision insists the framework must support — arbitrary chartered roles — has no well-formedness check. A custom role can be mandate-only text with an incoherent authority binding and no workflow seat, and the system stays silent. M16 closes that with a read-only validator scoring each role against the four invariants.

### Challenge to Previous Turn

The previous turn in the decision trail is the M15 QA ship verdict (`turn_92c39cb5177586c2`, run `run_2929265fcbabe440`): YES for the human-attention govern-by-exception surface. I do **not** rubber-stamp it, and I independently verified three things rather than trusting the trail:

1. **M15 is genuinely closed, so replenishment is the correct charter.** ROADMAP M15 items 171–176 are all `[x]` on disk (re-read this turn), the QA decisions record 18/18 + 37/37 + 46/46 tests green and a live `attention` → "Nothing needs your attention." exit 0. The vision-scan intake ("roadmap_exhausted_vision_open") is accurate; there is no half-closed M15 to drag forward.

2. **The "Why This Must Exist" section is fully closed — so I must move to a NEW pillar, not re-mine an exhausted one.** M11→VISION.md:47, M12→:48, M13→:49, M14→:50, M15→:51 closed every "Why This Must Exist" pain bullet. Re-deriving from that section would duplicate. I deliberately selected from the **unplanned** backlog and picked "Roles Are Open-Ended, Not Fixed" (VISION.md:100–130) — non-negotiable truth #5, never addressed by any milestone, with a uniquely **testable** invariant baked into the vision text itself (the four bullets at VISION.md:123–128).

3. **OBJ-001 — the chronic stale-artifact / unchecked-box defect must not recur.** The decision trail shows this failure 10+ consecutive times: planning artifacts stamped with a prior run's id and ROADMAP boxes left unchecked after work landed (which re-triggered the duplicate M14 run). This turn I (a) wrote all three artifacts freshly stamped to `run_dc50efa0354c0768` / `turn_5abb2e0f09dc2e4f`, and (b) added M16 as **unchecked** items that exactly match the SYSTEM_SPEC deliverables so implementation/QA have unambiguous boxes to close. I re-flag the systemic gap (idle-expansion does not detect committed code behind unchecked boxes; artifact run-stamps are not auto-rewritten) as OBJ-001 — non-blocking for M16, worth a future hardening milestone.

### Core Workflow

1. **PM (this turn)** — Derive M16 from VISION.md:100–130, add unchecked M16 items to ROADMAP.md, author SYSTEM_SPEC.md + PM_SIGNOFF.md citing the concrete role-charter invariant (VISION.md:123–128).
2. **Dev** — Build `role-charter.js` (`evaluateRoleCharter` / `evaluateAllRoleCharters` scoring the four invariants), `agentxchain role validate [role_id]` subcommand (`--json`, exit 0/1), report integration (`role_charters`), regression tests; check off the M16 ROADMAP items with delivery evidence.
3. **QA** — Verify the validator scores all four invariants independently, `well_formed iff 4/4`, reference + `enterprise-app` custom role pass, a malformed role is reported `incomplete` with fix hints, exit 0/1 contract, read-only; run the full suite; ship verdict.

### MVP Scope

**Build milestone.** New module + new CLI subcommand + report integration + tests.

| # | Deliverable | Description |
|---|-------------|-------------|
| 1 | `role-charter.js` module | `evaluateRoleCharter(config, rawConfig, roleId)` + `evaluateAllRoleCharters(config, rawConfig)` scoring the four VISION:123–128 invariants into a `RoleCharterReport` |
| 2 | `role validate [role_id]` subcommand | extend `roleCmd` + role.js; `--json`; exit 0 all-well-formed / exit 1 any-incomplete |
| 3 | Four-invariant semantics | `overall === 'well_formed'` iff all 4 satisfied; invariants evaluated independently; `missing[]` lists unsatisfied ids |
| 4 | Report integration | `role_charters` summary (`total`, `well_formed`, `incomplete`, `incomplete_role_ids[]`) in `buildGovernanceReport()` |
| 5 | Regression tests | `cli/test/role-charter.test.js` AT-RC-001…013 |

**The four VISION:123–128 invariants and their verified compose-targets (all read-only, exported at HEAD `971041fe9`):**

| # | Invariant (VISION.md) | Source / compose-target (verified this turn) |
|---|------------------------|----------------------------------------------|
| 1 | mandate (124) | `config.roles[id].mandate` non-empty |
| 2 | authority boundaries (125) | `role.write_authority` enum + `getRoleRuntimeCapabilityContract(id, role, runtime)` (runtime-capabilities.js:104) → `effective_write_path !== 'none'` |
| 3 | produces governed artifacts (126) | `canRoleParticipateInRequiredFileProduction(role, runtime)` (runtime-capabilities.js:188) across routed phases via `getEffectiveGateArtifacts(config, gateDef, phase)` (gate-evaluator.js:33), OR `canRoleSatisfyWorkflowArtifactOwnership(role, runtime)` (runtime-capabilities.js:202) for `owned_by === id` |
| 4 | participates in a structured workflow (127) | role id in `config.routing[phase].entry_role` or `allowed_next_roles` |

### Out of Scope

- **Mutating role definitions** — `role add` / `role scaffold` / `role delete` / interactive role wizards are explicitly out. M16 is **validation/visibility only**, mirroring M14/M15's read-only discipline. Creating/editing roles stays manual (edit `agentxchain.json`) or template-driven.
- **Role archetype/charter template library** (canonical `security-reviewer`/`architect` definitions) — a reuse convenience, separable from well-formedness checking.
- **Auto-repair / fix application** — M16 reports `fix_hint` strings; it does not apply them.
- **Mandate quality/specificity scoring** (length heuristics, NLP) — invariant 1 is presence-only per the vision text ("every role has a mandate"); subjective quality grading is a separate concern.
- **New routing/admission semantics** — M16 reads existing routing, capability contracts, and gate artifacts; it does not change how roles, gates, or admission control behave at run time.
- **Coordinator/multi-repo roll-up of role validation** — single-config for M16; a coordinator roll-up can follow once the single-config surface is proven (kept out to stay bounded).

### Success Metric

| # | Acceptance Item | Verified By |
|---|----------------|-------------|
| 1 | `role-charter.js` with `evaluateRoleCharter()` + `evaluateAllRoleCharters()` scoring 4 invariants | Dev implementation + AT-RC-001…009 |
| 2 | `agentxchain role validate [role_id]` with `--json`, exit 0/1 contract | Dev demo + AT-RC-010…012 |
| 3 | `well_formed` iff 4/4; invariants independent (no short-circuit) | AT-RC-007, AT-RC-009 |
| 4 | Reference roles + `enterprise-app` custom role validate `well_formed` | AT-RC-001, AT-RC-002 |
| 5 | Malformed custom role reported `incomplete` with missing ids + fix hints | AT-RC-003…006 |
| 6 | Governance report includes `role_charters` section | Dev integration test |
| 7 | `evaluateRoleCharter`/`evaluateAllRoleCharters` read-only | AT-RC-013 |
| 8 | Vision closure: VISION.md:100–130 four-part charter invariant enforced | QA ship verdict |

### Design Decisions

#### DEC-001: M16 opens the "Roles Are Open-Ended, Not Fixed" pillar via a four-invariant role-charter validator (category: scope)

The "Why This Must Exist" section (VISION.md:47–51) is fully closed by M11–M15, so the next bounded increment must come from an **unplanned** pillar. "Roles Are Open-Ended, Not Fixed" (VISION.md:100–130) is non-negotiable truth #5 (VISION.md:297), entirely unaddressed by prior milestones, and uniquely well-suited to a bounded/testable milestone because the vision *itself* states the acceptance shape — four explicit invariants (VISION.md:123–128). M16 scopes to enforcing exactly those four, not a vague "role UX" effort.

#### DEC-002: M16 is a compose-don't-reimplement build milestone, mirroring M14/M15 (category: architecture)

Like ship-status (M14) and human-attention (M15), M16 builds a new module + CLI surface but composes existing logic: `runtime-capabilities.js` (capability contracts, file-production / ownership predicates), `gate-evaluator.js` (`getEffectiveGateArtifacts`), the `admission-control.js` manual-runtime carve-out, and config routing. I verified every compose-target symbol is exported against source at HEAD `971041fe9` this turn (see the invariant table above) to prevent the Dev dead-end prior planning turns repeatedly had to correct. Architecture Invariant #1 forbids reimplementing capability/gate/routing logic.

#### DEC-003: `role validate` exits non-zero on an incomplete role — unlike the M15 `attention` status surface (category: quality)

M15's `attention` exits 0 in both states because it is a *status* surface. `role validate` is a *validation gate over configuration*: a malformed role is an actionable defect, so exit 1 (any role incomplete) / exit 0 (all well-formed) makes the command usable in CI and `doctor`-style flows. `--json` still always emits a schema-valid report regardless of exit code. This distinction is deliberate and specified, not an oversight.

#### DEC-004: Compose-target APIs verified against source before signoff (category: quality)

Confirmed exported at HEAD `971041fe9`: `getRoleRuntimeCapabilityContract` (runtime-capabilities.js:104), `canRoleParticipateInRequiredFileProduction` (:188), `canRoleSatisfyWorkflowArtifactOwnership` (:202); `getEffectiveGateArtifacts` (gate-evaluator.js:33); `runAdmissionControl` (admission-control.js:30); `loadProjectContext` (config.js:68); `buildGovernanceReport` (report.js:1245) with the existing `buildHumanAttentionSummary` pattern at report.js:1083; `roleCmd` group with `list`/`show` at agentxchain.js:958–972. Dev must reach these through their real public surface, not re-derive capability/gate logic.

## Notes for Dev

**Build milestone — new module + new subcommand. Do not look for an existing `role-charter.js`; create it.**

1. Create `cli/src/lib/role-charter.js`:
   - `evaluateRoleCharter(config, rawConfig, roleId)` → `RoleCharterReport` (`role_id`, `overall` 'well_formed'|'incomplete', `invariants[]` each `{ id, name, satisfied, detail, fix_hint }`, `missing[]`, `evidence_summary`).
   - `evaluateAllRoleCharters(config, rawConfig)` → `{ total, well_formed, incomplete, incomplete_role_ids[], roles[] }`, roles sorted by id.
   - Score the four invariants via the verified exported APIs (DEC-004 / invariant table) — **do not** re-derive runtime write paths, re-parse gate artifacts, or duplicate file-production logic.
   - Invariant 2 = `write_authority` valid enum AND bound runtime exists AND `effective_write_path !== 'none'`. Invariant 3 = reach required-file production in ≥1 routed phase OR own ≥1 satisfiable workflow artifact (apply the manual-runtime carve-out as admission-control does). Invariant 4 = role id present in routing.
   - `overall === 'well_formed'` **iff** all four `satisfied`. Each invariant evaluated independently (no short-circuit). Read-only — AT-RC-013 asserts byte-identical files.
2. Extend `cli/src/commands/role.js` with a `validate` path and register `role validate [role_id]` under `roleCmd` in `cli/bin/agentxchain.js:958` (delegate `roleCommand('validate', roleId, opts)`):
   - `role_id` optional → one role; omitted → all roles. `--json` emits the full report(s).
   - Exit 0 when all evaluated roles `well_formed`; exit 1 when any `incomplete`, printing each missing invariant + fix hint.
   - Delegate all logic to the module (Architecture Invariant #6); keep the command thin like `list`/`show`.
3. Integrate into `report.js` `buildGovernanceReport()` (line 1245) — add `role_charters` summary (`total`, `well_formed`, `incomplete`, `incomplete_role_ids[]`), mirroring `buildHumanAttentionSummary` (report.js:1083).
4. Create `cli/test/role-charter.test.js` covering AT-RC-001…013 (include an `enterprise-app`-style `security_reviewer` well-formed fixture and a deliberately malformed role fixture).
5. **Check off the M16 ROADMAP items** (the unchecked block under "### M16") with commit/turn refs as you land each — leaving them unchecked is the exact defect (OBJ-001) that re-triggers duplicate runs.
6. Produce/refresh IMPLEMENTATION_NOTES.md with Changes + Verification sections; run the full suite and record results.

## Notes for QA

- Run `cli/test/role-charter.test.js` and the full suite; confirm 0 failures.
- Verify all four invariants are scored independently (a role failing 3 reports all 3 in `missing`; AT-RC-007).
- Verify `well_formed` iff 4/4 (AT-RC-009).
- Verify reference roles (pm/dev/qa) and an `enterprise-app` custom role (`security_reviewer`) validate `well_formed` (AT-RC-001, AT-RC-002).
- Verify a malformed custom role is `incomplete` with the correct missing invariant id(s) and a concrete fix hint (AT-RC-003…006).
- Verify the exit-code contract: `role validate` exits 0 when all well-formed, exit 1 when any incomplete (AT-RC-010, AT-RC-011).
- Confirm `--json` emits schema-valid `RoleCharterReport` / `AllRoleCharterReport` (AT-RC-012).
- Confirm `evaluateRoleCharter`/`evaluateAllRoleCharters` are read-only (AT-RC-013).
- Confirm the governance report includes the `role_charters` section.
- Vision closure: VISION.md:100–130 "Roles Are Open-Ended, Not Fixed" four-part charter invariant (VISION.md:123–128) enforced as a composition over existing capability/routing/artifact primitives.

## Acceptance Contract

1. **New unchecked milestone items added to .planning/ROADMAP.md** — M16 "Role Charter Well-Formedness — Open-Ended Roles Validation — Vision Closure (VISION.md:100–130)" added with 6 unchecked items (module, CLI subcommand, four-invariant semantics, report integration, regression tests, acceptance) plus an active Phases table; the M15 phases table was preserved under "Completed Milestone History — M15 (closed)."
2. **Milestone cites at least one concrete VISION.md source section from the unplanned backlog** — M16 cites VISION.md:100–130 "Roles Are Open-Ended, Not Fixed" and its four-part charter invariant (VISION.md:123–128), reinforced by non-negotiable truth #5 (VISION.md:297). This pillar was never addressed by M1–M15 (which closed the "Why This Must Exist" bullets VISION.md:47–51 and infrastructure pillars); it is genuinely from the unplanned backlog.
3. **Milestone is bounded, testable, and does not duplicate existing checked milestones** — bounded to one read-only validation module + one CLI subcommand + report integration + tests (validation only; no role mutation, archetypes, auto-repair, mandate-quality scoring, or coordinator roll-up). Testable via AT-RC-001…013 against the four explicit vision invariants. Distinct from the MW "Template system" item (templates *provide* role sets; M16 *validates* a role definition is well-formed), from M15 human-attention (human-decision queue, not role config), and from `admission-control.js` (phase/gate file-production topology, not per-role charter completeness). Evidence source: ROADMAP.md "### M16" first unchecked item, deriving from VISION.md:100–130 / 123–128.
