# Release Notes — M16: Role Charter Well-Formedness — Open-Ended Roles Validation (VISION.md:100–130)

**Run:** run_dc50efa0354c0768
**Turn:** turn_58f0ffa97741e28b (QA ship verdict)
**Date:** 2026-06-27

## Summary

First milestone to open the **"Roles Are Open-Ended, Not Fixed"** vision pillar (VISION.md:100–130). The
vision is emphatic that AgentXchain "must never assume that a software team consists only of `pm`, `dev`, and
`qa`" and must support arbitrary roles and charters — and it fixes a precise, testable four-part invariant for
*any* chartered role (VISION.md:123–128): every role has a mandate, has authority boundaries, produces governed
artifacts, and participates in a structured workflow. Until now nothing enforced that invariant on a role
definition — `normalized-config.js` only checks `mandate`/`title` are non-empty strings, and
`admission-control.js` checks phase-level topology, not whether a given *role* is a well-formed chartered
participant. M16 closes the gap with a read-only, compose-don't-reimplement validator that scores every role
against the four invariants, surfaced through a new `agentxchain role validate` command and embedded in the
governance report.

## What Changed (This Run)

### New module — `cli/src/lib/role-charter.js`

`evaluateRoleCharter(config, rawConfig, roleId)` scores a role against the four VISION:123–128 invariants and
returns a `RoleCharterReport` — `{ role_id, overall: 'well_formed' | 'incomplete', invariants[], missing[],
evidence_summary }`. Each invariant is `{ id, name, satisfied, detail, fix_hint }` (`fix_hint` null when
satisfied). `overall === 'well_formed'` **iff** all four are satisfied; every invariant is evaluated
independently (no short-circuit), so `missing[]` enumerates *all* unsatisfied ids.

| Invariant | Source (composed, not reimplemented) |
|-----------|--------------------------------------|
| `mandate` (VISION.md:124) | `role.mandate` is a non-empty trimmed string |
| `authority_boundary` (VISION.md:125) | `write_authority` valid AND `getRoleRuntimeCapabilityContract(...).effective_write_path` is coherent (not in `{none, unknown, invalid_review_only_binding, invalid_authoritative_binding}`) — runtime-capabilities.js |
| `produces_artifacts` (VISION.md:126) | reaches required-file production in ≥1 routed phase (`canRoleParticipateInRequiredFileProduction` + `getEffectiveGateArtifacts`) OR owns ≥1 satisfiable workflow-kit artifact (`canRoleSatisfyWorkflowArtifactOwnership`) — manual-runtime carve-out inherited |
| `workflow_participation` (VISION.md:127) | role id is `entry_role` or in `allowed_next_roles` of ≥1 phase in `config.routing` |

`evaluateAllRoleCharters(config, rawConfig)` aggregates `{ total, well_formed, incomplete,
incomplete_role_ids[], roles[] }` with roles sorted by id for deterministic output. `buildRoleCharterSummary(artifact)`
derives the compact report summary; `null` for a missing artifact. The module is strictly read-only and
tolerates both normalized (`runtime_id`) and raw (`runtime`) config shapes so the same code serves the CLI and
the governance report.

### New CLI command — `agentxchain role validate [role_id] [--json]`

Validates one role, or all defined roles when `role_id` is omitted. **Exit-code contract (a real CI gate):**
exit `0` when every evaluated role is `well_formed`, exit `1` when any is `incomplete` — listing each
unsatisfied invariant with a concrete fix hint. `--json` always emits the schema-valid report. An unknown
explicit `role_id` exits `1` with "Unknown role". Presentation only — all logic delegates to the module.

### Governance report integration — `cli/src/lib/report.js`

`buildGovernanceReport()` now embeds a `role_charters` summary (`total`, `well_formed`, `incomplete`,
`incomplete_role_ids[]`) in `subject.run`, beside the existing `ship_status` (M14) and `human_attention` (M15)
summaries (report.js:1085).

### Tests + contracts

- New `cli/test/role-charter.test.js` — **18 tests** (AT-RC-001…013 + report-integration + unknown-role):
  reference roles well-formed; enterprise `security_reviewer` (review_only on manual, routed + owns artifact)
  well-formed; empty mandate; review_only-on-local_cli incoherence; not-routed/owns-nothing; absent-from-routing;
  three-failing-invariants-no-short-circuit; `well_formed iff 4/4`; mixed aggregate sort/counts; CLI exit 0/1;
  `--json` schema (all + single); read-only (byte-identical config).
- Updated `cli/test/vitest-contract.test.js` (test-file count 690 → 691) — the coverage-count contract gates
  adding a test file.

### ROADMAP.md M16 closed

Build items (lines 188–193) checked off by the dev with delivery+verification provenance; the acceptance item
(line 194) checked off by this QA ship verdict.

## User Impact

- **Vision closure begins:** VISION.md:100–130 "Roles Are Open-Ended, Not Fixed" is now directly addressed. A
  user who adds a custom role (e.g. `security-reviewer`) gets a single answer to "is this role's charter
  complete, or is it mandate-only text with no authority boundary, no owned artifact, and no phase that routes
  to it?"
- **A real config-validation gate:** `agentxchain role validate` exits non-zero when any role is incomplete,
  making it usable in CI / `doctor` flows — each failure names the missing invariant(s) and a concrete fix.
- **Report visibility:** governance reports now carry a `role_charters` summary, so role well-formedness is
  visible in the standard report surface alongside ship-status and human-attention.
- **No breaking changes:** one new module, one new read-only subcommand, one additive report field, 18 new
  tests, and one legitimate contract count bump. The composition is read-only and reuses existing
  capability/routing/artifact evaluators.

## Known Limitations (non-blocking, see ship-verdict.md)

- **OBJ-001:** when a config is *both* schema-invalid *and* charter-incomplete, the live `role validate` is
  short-circuited by `loadProjectContext` with a misleading "No agentxchain.json found" before the charter
  validator runs. The module itself scores those cases correctly (unit-tested), and the realistic schema-valid
  malformed role IS reported live with fix hints. Recommended future fix: surface validation errors explicitly.

## Verification Summary

QA independently ran (turn_58f0ffa97741e28b):
- `npx vitest run test/role-charter.test.js` → **18/18 pass, exit 0**
- 12-suite blast-radius batch (report-cli, governance-report-content, workflow-kit-report, role-command,
  gate-evaluator, gate-evaluator-helpers, admission-control, vitest-contract, docs-cli-command-map-content,
  docs-cli-governance-content, run-completion, role-charter) → **267/267 pass, exit 0**
- `node cli/bin/agentxchain.js role validate` → "all well-formed (4/4 invariants each)", **exit 0**
- `role validate dev` → "✓ dev well-formed", **exit 0**; `role validate doesnotexist` → "Unknown role", **exit 1**
- QA-built config-valid charter-incomplete repo → "✗ ghost incomplete — missing: produces_artifacts,
  workflow_participation" + fix hints, **exit 1**
- `agentxchain export > exp.json && report --input exp.json --format json` → `subject.run.role_charters =
  {total:4, well_formed:4, incomplete:0}` present alongside `ship_status` + `human_attention`, **overall: pass**

Result: **8/8 acceptance criteria pass, 5/5 architecture invariants confirmed, 3/3 dev decisions verified,
0 blocking issues.** Limitation declared: the full ~691-file suite was not run to completion (over the
single-shot budget); verification scoped to the M16 blast radius + CLI/docs/coverage contracts, per the
accepted M14/M15 precedent. **Ship verdict: YES.**
