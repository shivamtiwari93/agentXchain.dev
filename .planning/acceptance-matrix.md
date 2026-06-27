# Acceptance Matrix — M16: Role Charter Well-Formedness — Open-Ended Roles Validation (VISION.md:100–130)

**Run:** run_dc50efa0354c0768
**Turn:** turn_58f0ffa97741e28b (QA; Staff QA ship verdict)
**Baseline:** git:21f0d5eb5916a53594c9e947560d8999d54d58db (HEAD of dogfood/2158-lights-out, integration ref)
**Scope:** Verify `role-charter.js` + `agentxchain role validate [role_id]` score every role against the
four VISION:123–128 charter invariants (mandate / authority boundary / produces governed artifacts /
participates in a structured workflow), `well_formed iff 4/4` with independent (non-short-circuiting)
invariant evaluation, exit 0 all-well-formed / exit 1 any-incomplete with concrete fix hints, the
governance report exposes a `role_charters` summary, the validator is read-only, and it composes existing
capability/routing/artifact primitives — reimplementing none. Addresses VISION.md:100–130 "Roles Are
Open-Ended, Not Fixed."

> **Stale-artifact correction (11th consecutive run):** The three QA workflow artifacts on disk at the start
> of this turn (acceptance-matrix.md, ship-verdict.md, RELEASE_NOTES.md) all referenced the PRIOR milestone —
> **M15 Human Attention Surface, `run_2929265fcbabe440`, `turn_92c39cb5177586c2`**. All three are rewritten
> from scratch for M16 / `run_dc50efa0354c0768` by this QA turn. See Finding 1. (Carried forward from the
> M15 QA turn's Finding 1, which itself carried it from M14 — now its 11th consecutive occurrence.)

> **Gate-contract note:** The Section A table below uses the contractually required `| Req # |` header
> (`evaluateAcceptanceMatrix`, workflow-gate-semantics.js). Each requirement row's Status cell is a bare
> `PASS` token (AFFIRMATIVE_ACCEPTANCE_STATUSES).

## Section A: Acceptance Criteria (derived from ROADMAP.md M16, lines 188–194)

| Req # | Criterion | Evidence (QA-run THIS turn) | Status |
|-------|-----------|-----------------------------|--------|
| AC-1 | New module `role-charter.js` with `evaluateRoleCharter(config, rawConfig, roleId)` and `evaluateAllRoleCharters(config, rawConfig)` scoring a role against the four VISION:123–128 invariants into a `RoleCharterReport` (`role_id`, `overall: 'well_formed'\|'incomplete'`, `invariants[]`, `missing[]`, `evidence_summary`); read-only; composes `runtime-capabilities.js`/`gate-evaluator.js`/routing — reimplements none | QA read the module (role-charter.js:231–276). Both functions ship. Invariant 1 (`evaluateMandate`) checks `role.mandate` non-empty/trimmed; Invariant 2 (`evaluateAuthorityBoundary`) delegates to `getRoleRuntimeCapabilityContract` (runtime-capabilities.js) and tests coherence of `effective_write_path`; Invariant 3 (`evaluateProducesArtifacts`) delegates to `canRoleParticipateInRequiredFileProduction`/`canRoleSatisfyWorkflowArtifactOwnership`/`getEffectiveGateArtifacts`; Invariant 4 (`evaluateWorkflowParticipation`) reads `config.routing`. No capability/gate/file-production logic reimplemented (imports + call sites confirmed). AT-RC-001/002/008 pass. | PASS |
| AC-2 | `agentxchain role validate [role_id]` (`--json`); validates one role or all; exit 0 all-well-formed / exit 1 any-incomplete; each unsatisfied invariant listed with a concrete fix hint | QA live smoke on THIS repo (4 roles pm/dev/qa/eng_director, all authoritative/local_cli): `role validate` → "all well-formed (4/4 invariants each)", **exit 0**; `role validate dev` → "✓ dev well-formed (4/4 invariants)", **exit 0**; `role validate doesnotexist` → "Unknown role", **exit 1**. QA-built charter-incomplete repo (config-valid `ghost` not routed/owning nothing): `role validate` → "✗ ghost incomplete — missing: produces_artifacts, workflow_participation" + two fix-hint lines, **exit 1**; `role validate pm` → **exit 0**. AT-RC-010/011/012 green. | PASS |
| AC-3 | `overall === 'well_formed'` **iff** all four invariants satisfied; `missing[]` enumerates unsatisfied ids; each invariant reports independently (no short-circuit) | role-charter.js:242–243 `overall = missing.length===0 ? 'well_formed':'incomplete'`; all four `evaluate*` run unconditionally (lines 235–240), no early return. AT-RC-007 asserts a role with 3 failing invariants still reports the 4th's true `satisfied:true`; AT-RC-009 asserts flipping the single failing invariant flips `overall`. Both green. | PASS |
| AC-4 | Reference roles (`pm`/`dev`/`qa`) AND an `enterprise-app` custom role (`security_reviewer`, review_only on a manual runtime, routed + owns a required workflow-kit artifact) both evaluate `well_formed` | AT-RC-001 asserts pm/dev/qa each `well_formed` (empty `missing`, all 4 `satisfied`). AT-RC-002 asserts `security_reviewer` `well_formed`: `authority_boundary` satisfied (review_only+manual → coherent `planning_only`) and `produces_artifacts` satisfied via ownership of `.planning/SECURITY_REVIEW.md`. Both green. Live: this repo's 4 reference-shaped roles all `well_formed`. | PASS |
| AC-5 | A malformed role → `incomplete` with its missing invariant id(s) and a fix hint | AT-RC-003 (empty mandate → missing `mandate`, fix_hint matches /mandate/); AT-RC-004 (review_only+local_cli → missing `authority_boundary`, fix_hint matches /authority\|write path/); AT-RC-005 (routed only to a no-file/no-owned phase → missing `produces_artifacts`); AT-RC-006 (absent from routing → missing `workflow_participation`); AT-RC-011 CLI (incomplete role lists role + missing + fix hint, exit 1). All green. Live: `ghost` reported `incomplete` with both missing ids and concrete fix hints. **Live-CLI reachability caveat: see Finding 2 / OBJ-001.** | PASS |
| AC-6 | Governance report integration — `buildGovernanceReport()` includes a `role_charters` summary (`total`, `well_formed`, `incomplete`, `incomplete_role_ids[]`) | QA ran a **real end-to-end** on this repo: `agentxchain export` → `agentxchain report --format json` → `subject.run.role_charters` is **present** = `{total:4, well_formed:4, incomplete:0, incomplete_role_ids:[]}`, coexisting with `ship_status` (M14) and `human_attention` (M15) in the same subject. Wired at report.js:1085 beside `human_attention`. `buildRoleCharterSummary` unit tests (clear / incomplete / null-artifact) green. governance-report-content + workflow-kit-report + report-cli suites green (within the 267-test batch). | PASS |
| AC-7 | Read-only — scoring mutates neither the repo nor the passed config object | AT-RC-013 snapshots `.agentxchain/` + `agentxchain.json` before/after `evaluateRoleCharter` + `evaluateAllRoleCharters` and asserts byte-identical, plus `config.roles.pm.mandate` unchanged. Green. Module performs no `writeFileSync`/state writeback (source-confirmed). | PASS |
| AC-8 | Acceptance / vision closure — `role validate` returns a per-role four-invariant assessment composed from existing primitives; reference + enterprise custom role pass; malformed role `incomplete` with missing invariant(s) + fix hint; exit 0/1 contract; report exposes `role_charters`; read-only; addresses VISION.md:100–130 four-part charter invariant (VISION.md:123–128) | All sub-clauses met by AC-1…AC-7 above, each on QA-run evidence. VISION.md:123–128's four invariants map 1:1 to the four scored invariants; the live CLI answers "is this role's charter complete?" with a per-invariant verdict + fix hints, and the exit-1 CI-gate path is real (unlike M15's status-only `attention`). | PASS |

**Acceptance: 8/8 PASS**

## Section B: Dev Decision Verification

| Decision | QA Verdict |
|----------|------------|
| DEC-001: Invariant 2 checked against the real coherent/incoherent partition of `effective_write_path` (`INCOHERENT_WRITE_PATHS = {none, unknown, invalid_review_only_binding, invalid_authoritative_binding}`), NOT a literal `=== 'none'` (which never fires — `getRoleRuntimeCapabilityContract` never returns `'none'`) | **VERIFIED — and a correctness fix over the spec.** The ROADMAP text literally says "non-`none` `effective_write_path`," but `getRoleRuntimeCapabilityContract` never emits `'none'`; the real incoherent sentinels are `invalid_review_only_binding` etc. A literal `=== 'none'` check would silently pass every role (invariant 2 would never fail). AT-RC-004 proves the implemented partition fires: review_only+local_cli → `invalid_review_only_binding` → `authority_boundary` unsatisfied. The `'none'` value is retained in the set as a harmless forward-compat guard. Sound. |
| DEC-002: `evaluateRoleCharter`/`evaluateAllRoleCharters` tolerate both normalized (`role.runtime_id`) and raw (`role.runtime`) config shapes via `role.runtime_id \|\| role.runtime` and `config?.X \|\| rawConfig?.X` fallbacks | **VERIFIED.** The CLI passes a normalized config (`runtime_id`); the report's export artifact passes raw agentxchain.json (`runtime`). Both code paths resolve. `getRoleRuntime` (role-charter.js:66) and `resolveConfigSources` (54) implement the fallback, mirroring admission-control.js. Proven live: CLI (normalized) → all well-formed; e2e report (raw export `config`) → `role_charters` present with correct counts. |
| DEC-003: Every invariant object carries `fix_hint` (null when satisfied); the manual-runtime carve-out for invariant 3 is inherited (via `canRoleParticipateInRequiredFileProduction` returning true for manual roles) rather than re-coded | **VERIFIED.** Every `evaluate*` returns `fix_hint` (null when satisfied) — confirmed in source and by AT-RC-003/004 asserting non-null fix hints on failure. The manual carve-out is inherited: AT-RC-002's `security_reviewer` (manual runtime) passes `produces_artifacts` via ownership without an automated write path — no special-casing in role-charter.js. Superset shape; no consumer breaks. |

## Section C: Architecture Invariants

| # | Invariant | Evidence | Status |
|---|-----------|----------|--------|
| 1 | Composition layer — reimplements no runtime-capability/gate-artifact/file-production logic | Delegates to `getRoleRuntimeCapabilityContract`, `canRoleParticipateInRequiredFileProduction`, `canRoleSatisfyWorkflowArtifactOwnership`, `getEffectiveGateArtifacts`; routing read directly. Confirmed in source (imports + call sites). | PASS |
| 2 | Strictly read-only — never mutates repo, state, or the passed config | AT-RC-013: `.agentxchain/` + config byte-identical, config object unmutated. No write calls in source. | PASS |
| 3 | `well_formed iff 4/4` — invariants evaluated independently, no short-circuit | role-charter.js:235–243; AT-RC-007 (3 failing, 4th still independently true) + AT-RC-009 (single flip flips overall). | PASS |
| 4 | Deterministic aggregate — roles sorted by id; counts reconcile (`well_formed + incomplete === total`) | `evaluateAllRoleCharters` sorts `Object.keys(roles).sort()`; AT-RC-008 asserts sorted order `['dev','ghost','pm','qa']` + count reconciliation. | PASS |
| 5 | CLI delegates entirely to the module — presentation + exit code only | `commands/role.js` `validateRoles` calls `evaluateRoleCharter`/`evaluateAllRoleCharters`, formats, sets exit code; all logic in `role-charter.js`. Consistent with thin `list`/`show`. | PASS |

**Invariants: 5/5 PASS**

## Section D: Composition Verification (VISION.md:100–130) — live repo state

`agentxchain role validate` (QA-run THIS turn) against `run_dc50efa0354c0768` mid-QA-phase:

| Surface | Live result | Interpretation |
|---------|-------------|----------------|
| `role validate` (all, default) | "Role charter validation (4 roles): all well-formed (4/4 invariants each)." — exit 0 | This repo's 4 chartered roles (pm/dev/qa/eng_director) each satisfy all four VISION:123–128 invariants. |
| `role validate dev` | "✓ dev well-formed (4/4 invariants)" — exit 0 | Single-role path + exit-0 for well-formed. |
| `role validate <charter-incomplete ghost>` (QA-built config) | "✗ ghost incomplete — missing: produces_artifacts, workflow_participation" + 2 fix-hint lines — exit 1 | The CI-gate path is real: any incomplete role fails the command with actionable fixes. |
| `export` → `report --format json` | `subject.run.role_charters = {total:4, well_formed:4, incomplete:0, incomplete_role_ids:[]}` (beside `ship_status` + `human_attention`) | Charter well-formedness embedded in the standard governance report; M14/M15/M16 summaries coexist. |

**VISION.md:100–130 addressed:** a single command answers "is this role's charter complete — or is it
mandate-only text with no authority boundary, no owned artifact, and no phase that routes to it?" per the
four-part invariant the vision fixes (VISION.md:123–128), and it does so by composing the existing
capability/routing/artifact primitives rather than reimplementing them.

## Section E: Regression Results (QA-Verified)

| Suite(s) | Tests | Result | Exit |
|----------|-------|--------|------|
| role-charter.test.js | 18 | PASS | 0 |
| Blast-radius batch: report-cli, governance-report-content, workflow-kit-report, role-command, gate-evaluator, gate-evaluator-helpers, admission-control, vitest-contract, docs-cli-command-map-content, docs-cli-governance-content, run-completion, role-charter (12 suites) | 267 | 0 failures | 0 |

Commands run by QA (THIS turn, turn_58f0ffa97741e28b):
- `npx vitest run test/role-charter.test.js` → 18 passed, exit 0
- `npx vitest run test/role-charter.test.js test/report-cli.test.js test/governance-report-content.test.js test/workflow-kit-report.test.js test/role-command.test.js test/gate-evaluator.test.js test/gate-evaluator-helpers.test.js test/admission-control.test.js test/vitest-contract.test.js test/docs-cli-command-map-content.test.js test/docs-cli-governance-content.test.js test/run-completion.test.js` → 267 passed, exit 0 (`runtime-capabilities.test.js` was also listed but does not exist — that logic is covered within the suites above; 12 of 13 named files ran)
- `node cli/bin/agentxchain.js role validate` → "all well-formed (4/4 invariants each)", exit 0
- `node cli/bin/agentxchain.js role validate dev` → "✓ dev well-formed", exit 0
- `node cli/bin/agentxchain.js role validate doesnotexist` → "Unknown role", exit 1
- (QA-built config-valid charter-incomplete repo) `role validate` → "✗ ghost incomplete — missing: produces_artifacts, workflow_participation" + fix hints, exit 1; `role validate pm` → exit 0; `role validate ghost --json` → `overall:'incomplete'`, exit 1
- `node cli/bin/agentxchain.js export > exp.json && report --input exp.json --format json` → `subject.run.role_charters = {total:4, well_formed:4, incomplete:0}` present alongside `ship_status` + `human_attention`, `overall: pass`

**Limitation (declared, not hidden):** The full CLI suite (~691 test files) was **not** run to completion this
turn — the prior M15 turn measured it at ~34 min, exceeding the single-shot foreground budget. Verification is
scoped to the M16 blast radius (the import graph of the 8 changed files) + the CLI-surface/docs/coverage
contracts, matching the accepted M14/M15 QA precedent. The dev's own targeted run (347/347 across 20 suites)
and this QA turn's independent 267-test batch overlap on the highest-risk suites and agree (0 failures). QA
does not claim the full suite passes; it claims every suite in the actual blast radius is green. The one known
full-suite failure cited across prior runs (`bug-54-real-claude-reliability` Scenario B, a real-binary 50 ms
watchdog timing test) imports none of the M16 changed files and was not run.

## Section F: QA Findings

### Finding 1 (process, non-blocking, fixed): Stale QA artifacts — 11th consecutive run
All three QA artifacts referenced the prior milestone (M15, `run_2929265fcbabe440`) instead of current M16
(`run_dc50efa0354c0768`). Eleventh consecutive run with this pattern (M14→M15→M16). All three rewritten from
scratch. Root cause remains unaddressed: QA artifacts are not run-scoped at phase entry, so they survive from
the prior milestone and read stale until QA rewrites them. **Recommend an intake item** to scaffold per-run
QA artifact stubs (or fail the gate when an artifact's `Run:` header does not match the active run id) — this
is now a durable governance gap, not a one-off.

### Finding 2 (design, non-blocking) — OBJ-001: Live `role validate` is gated by `loadProjectContext` schema validation, so schema-invalid malformed roles surface a misleading "No agentxchain.json found" instead of a charter verdict
When a config contains a role that fails `normalized-config.js` schema validation (e.g. empty mandate, or a
review_only+local_cli binding), `loadProjectContext()` returns null and `role validate` prints
**"No agentxchain.json found. Run `agentxchain init` first."** and exits 1 — the charter validator never runs,
so the operator does not see the per-invariant `incomplete` verdict + fix hints for that role. QA reproduced
this live (a config with `mandate:""` + review_only/local_cli). Two mitigating facts keep this **non-blocking**:
(a) the **module** still scores those exact cases correctly — AT-RC-003 (empty mandate) and AT-RC-004
(review_only+local_cli) pass at the unit level; only the live-CLI path short-circuits; (b) the realistic
malformed role the milestone narrative describes — "mandate-only text with no owned artifact and no phase that
routes to it" — is **schema-valid** and therefore IS reported `incomplete` with fix hints by the live CLI (QA
verified the `ghost` case live), so AC-5's live path is genuinely met. The gap is only for roles that are
**both** schema-invalid **and** charter-incomplete, where the older schema-validation error wins and the
message ("No agentxchain.json found") is misleading. **Recommend a future enhancement:** when a v4
agentxchain.json exists but fails normalized validation, `role validate` should surface the validation errors
explicitly (or still run the charter validator on the raw config) rather than claim the file is absent. Logged
for the decision trail; does not block M16.

### Finding 3 (informational): `role_charters` report summary reflects schema-valid configs only
`buildRoleCharterSummary` runs on the export artifact's raw `config`. For an exported run whose config is
schema-valid (the normal case), the summary is accurate (QA verified `{total:4, well_formed:4, incomplete:0}`
live). This is the expected behavior and is noted only to record that the report path shares the schema-valid
precondition discussed in Finding 2. Out of M16 scope.
