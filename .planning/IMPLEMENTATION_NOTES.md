# Implementation Notes — M16: Role Charter Well-Formedness — Open-Ended Roles Validation — Vision Closure (VISION.md:100–130)

**Run:** `run_dc50efa0354c0768`
**Turn:** `turn_29fc38df7a095987`
**Role:** dev
**Runtime:** `local-opus-4.8-ultra`
**Date:** 2026-06-27
**Baseline:** git:2fdba5642 (HEAD of dogfood/2158-lights-out, integration ref)

---

## Challenge to Previous Turn

The previous accepted turn is the PM signoff for M16 (`turn_5abb2e0f09dc2e4f`). I did **not** rubber-stamp it — I verified every compose-target API the spec named exists with the claimed signature **against current source at HEAD** before writing the module, and I found two spec details that did not match the code and adjusted accordingly:

- **Spec says "effective_write_path is not `none`."** `getRoleRuntimeCapabilityContract` (runtime-capabilities.js:104) **never returns the string `'none'`.** The actual incoherent-binding sentinels it emits are `'unknown'`, `'invalid_review_only_binding'`, and `'invalid_authoritative_binding'` (verified by direct probe: `review_only`+`local_cli` → `invalid_review_only_binding`, `review_only`+`manual` → `planning_only`, `authoritative`+`local_cli` → `direct`). I implemented invariant 2 against the real coherent/incoherent partition (`INCOHERENT_WRITE_PATHS` set) rather than a literal `=== 'none'` check that would never fire.
- **Spec says `invariants[]` items carry `{ id, name, satisfied, detail }`** in one place and `{ id, name, satisfied, detail, fix_hint }` in another. The CLI contract and AT-RC-003/004/005/006 require a concrete fix hint per failing invariant, so I included `fix_hint` on every invariant (`null` when satisfied). This is a superset of the narrower shape — no consumer breaks.
- **`config` shape:** `loadProjectContext` hands the CLI a **normalized** config where roles carry `runtime_id` (normalized-config.js:1304), while the governance report's export artifact `config` is the **raw** agentxchain.json where roles carry `runtime` (export.js:582). I made the evaluator tolerate both (`role.runtime_id || role.runtime`, and `config?.X || rawConfig?.X` fallbacks) exactly as admission-control.js does, so the same module serves the CLI and the report without a second code path.
- **`report.js buildGovernanceReport` operates on an export artifact, not a live repo** — so I mirrored `buildShipStatusSummary(artifact)` / `buildHumanAttentionSummary(artifact)` with an artifact-scoped `buildRoleCharterSummary(artifact)` rather than calling the live evaluator against the filesystem.

## Changes

### New: `cli/src/lib/role-charter.js`
Read-only, compose-don't-reimplement validator scoring every role against the four VISION:123–128 charter invariants. Composes `runtime-capabilities.js`, `gate-evaluator.js`, and config routing; reimplements no runtime-capability derivation, gate-artifact resolution, or file-production logic.

- `evaluateRoleCharter(config, rawConfig, roleId)` → `RoleCharterReport` `{ role_id, overall: 'well_formed'|'incomplete', invariants[], missing[], evidence_summary }`. Each invariant: `{ id, name, satisfied, detail, fix_hint }`. `overall === 'well_formed'` **iff** all four invariants are satisfied. Each invariant is evaluated independently — no short-circuit; `missing[]` enumerates every unsatisfied invariant id.
- **Invariant 1 — `mandate`** (VISION.md:124): `role.mandate` is a non-empty trimmed string.
- **Invariant 2 — `authority_boundary`** (VISION.md:125): `write_authority` is a valid enum AND the bound runtime exists AND `getRoleRuntimeCapabilityContract(roleId, role, runtime).effective_write_path` is **coherent** (not in `{none, unknown, invalid_review_only_binding, invalid_authoritative_binding}`). Catches the canonical incoherence `review_only` on a `local_cli` runtime.
- **Invariant 3 — `produces_artifacts`** (VISION.md:126): satisfied when **(a)** the role can reach required-file production in ≥1 routed phase — `canRoleParticipateInRequiredFileProduction(role, runtime)` AND that phase's exit gate has a required artifact per `getEffectiveGateArtifacts` — **OR (b)** it owns ≥1 workflow-kit artifact it can satisfy (`getEffectiveGateArtifacts` `owned_by === roleId` AND `canRoleSatisfyWorkflowArtifactOwnership`). The manual-runtime carve-out is inherited for free: `canRoleParticipateInRequiredFileProduction` already returns `true` for manual roles (the same carve-out admission-control.js relies on), so manual reviewers/architects are not penalized for lacking an automated write path.
- **Invariant 4 — `workflow_participation`** (VISION.md:127): the role id appears as `entry_role` or within `allowed_next_roles` of ≥1 phase in `config.routing`.
- `evaluateAllRoleCharters(config, rawConfig)` → `{ total, well_formed, incomplete, incomplete_role_ids[], roles[] }`, with `roles` in stable order (sorted by id) for deterministic output/tests.
- `buildRoleCharterSummary(artifact)` → compact `{ total, well_formed, incomplete, incomplete_role_ids }` for report integration; `null` for a missing artifact.

### Modified: `cli/src/commands/role.js` + registration in `cli/bin/agentxchain.js`
`agentxchain role validate [role_id] [--json]`. Presentation only — delegates all charter logic to the module (Architecture Invariant #6, consistent with the existing thin `list`/`show`). Validates one role, or all defined roles when `role_id` is omitted. **Exit-code contract:** exit `0` when every evaluated role is `well_formed`, exit `1` when any evaluated role is `incomplete` (a config-validation gate suitable for CI / `doctor` use). `--json` always emits the schema-valid report regardless of exit code. An unknown explicit `role_id` exits `1` with an "Unknown role" message, mirroring `role show`.

### Modified: `cli/src/lib/report.js`
Imports `buildRoleCharterSummary` and adds `role_charters` to the governed-run subject in `buildRunSubject()`, immediately after `human_attention` (report integration / AC-6).

### Tests + contracts
- New `cli/test/role-charter.test.js` — 18 tests covering AT-RC-001…013 plus the governance-report integration (`buildRoleCharterSummary`) cases.
- Updated `cli/test/vitest-contract.test.js` (test-file count 690 → 691), required because adding a test file is gated by the coverage-count contract.

## Verification

All commands run blocking in the foreground; exit codes recorded inline.

- `npx vitest run test/role-charter.test.js` → **18/18 pass** (AT-RC-001…013 + 2 report-integration + 1 unknown-role CLI case), exit 0.
- **Targeted regression over every test importing a file I changed** — `report.js`, the `role` command, `runtime-capabilities`, `gate-evaluator`, `buildGovernanceReport` (20 suites: beta-scenario-emission-guard, bug-35/36/37/84/86, ci-report-acceptance, claim-reality-preflight, connector-capability-declaration, coordinator-report-narrative, cost-summary, gate-evaluator(+helpers), recovery-classification, report-html, role-charter, run-command, run-completion, workflow-kit-remote-accountability, workflow-kit-report) → **347/347 pass**, exit 0.
- **CLI-surface + docs/command-map + coverage contracts** — `vitest-contract`, `docs-cli-command-map-content`, `docs-cli-governance-content`, `role-command`, `inspection-frontdoor-discoverability`, `status-runtime-guidance`, `docs-tutorial-content` → **all pass** (after bumping the test-file count 690 → 691). Confirms the new `role validate` subcommand does not break any command-enumeration/docs contract.
- Earlier focused cross-check (`human-attention`, `admission-control`, `gate-evaluator`, `governance-report-content`, `workflow-kit-report`, `role-charter`) → **132/132 pass**.
- **Live CLI smoke on this repo's own config** (pm/dev/qa/eng_director, all authoritative on local_cli):
  - `node cli/bin/agentxchain.js role validate` → "Role charter validation (4 roles): all well-formed (4/4 invariants each)." exit 0.
  - `node cli/bin/agentxchain.js role validate --json` → schema-valid `AllRoleCharterReport` (`total:4, well_formed:4, incomplete:0`).
  - `node cli/bin/agentxchain.js role validate dev` → "✓ dev well-formed (4/4 invariants)" exit 0.
- **Capability-contract probe** confirming the invariant-2 partition: `review_only`+`local_cli` → `invalid_review_only_binding` (incoherent), `review_only`+`manual` → `planning_only` (coherent), `authoritative`+`local_cli` → `direct` (coherent), `canRoleSatisfyWorkflowArtifactOwnership(review_only, manual)` → `true`.

### Full-suite note (honest scope statement)
I did **not** complete a single uninterrupted full-suite run this turn: `npx vitest run` over all 691 files exceeds the 10-minute foreground command budget on this machine (the prior M15 turn measured the full suite at ~34 min). To stay within single-shot constraints I instead ran the **exhaustive set of suites that import any file I touched** (the 20-suite targeted run above) plus all CLI-surface/docs/coverage contracts — every test in the actual blast radius of `role-charter.js`, `role.js`, `cli/bin/agentxchain.js`, and `report.js` is green. QA should run the full suite to confirm no second-order interaction outside that import graph.

## Acceptance Mapping

| AC | Evidence |
|----|----------|
| AC-1 (`evaluateRoleCharter`/`evaluateAllRoleCharters` score the 4 invariants) | Module ships both; AT-RC-001…009 pass |
| AC-2 (`role validate [role_id]` `--json`, exit 0 all-well-formed / exit 1 any-incomplete) | AT-RC-010, 011, 012 + live smoke pass |
| AC-3 (well_formed iff 4/4; invariants independent / no short-circuit) | AT-RC-007 (3 failing, 4th still evaluated & satisfied), AT-RC-009 pass |
| AC-4 (reference pm/dev/qa + enterprise `security_reviewer` validate well_formed) | AT-RC-001, AT-RC-002 pass |
| AC-5 (malformed role → incomplete + missing invariant ids + fix hint) | AT-RC-003…006, AT-RC-011 pass |
| AC-6 (governance report `role_charters` summary) | report.js integration + `buildRoleCharterSummary` tests pass |
| AC-7 (read-only) | AT-RC-013 (project files + config object byte-identical/unmutated) |
| AC-8 (vision closure VISION.md:100–130 four-part charter invariant) | QA ship verdict — left for QA |

## Notes for QA

- Run `cli/test/role-charter.test.js` (18) and the **full suite** (`npx vitest run`) — I could not fit the full suite in one foreground window this turn (see scope note above); confirm there is no regression outside the import graph I exercised.
- Verify the exit-code contract is real (it is a CI gate, unlike the M15 `attention` status surface): `role validate` exits `1` when any role is incomplete, `0` when all are well-formed.
- Verify invariant independence: a role failing 3 invariants still reports the 4th's true verdict (AT-RC-007) — no short-circuit.
- Verify read-only: `evaluateRoleCharter`/`evaluateAllRoleCharters` mutate neither the repo nor the passed config object (AT-RC-013).
- ROADMAP M16 acceptance line (194) is intentionally left unchecked for your ship verdict; the five build-item boxes (188–193) are checked because the code, CLI, semantics, report integration, and tests now exist and are green.
