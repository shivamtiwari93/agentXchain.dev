# Ship Verdict — M16: Role Charter Well-Formedness — Open-Ended Roles Validation (VISION.md:100–130)

**Run:** run_dc50efa0354c0768
**Turn:** turn_58f0ffa97741e28b (Staff QA Engineer)
**Baseline:** git:21f0d5eb5916a53594c9e947560d8999d54d58db
**Date:** 2026-06-27

## Verdict: YES

## Rationale

All 8 M16 acceptance criteria (ROADMAP.md lines 188–194) independently verified by QA on QA-run evidence.
The surface — `role-charter.js` (`evaluateRoleCharter` / `evaluateAllRoleCharters` / `buildRoleCharterSummary`
scoring every role against the four VISION:123–128 charter invariants), the `agentxchain role validate
[role_id]` CLI (`--json`; exit 0 all-well-formed / exit 1 any-incomplete with concrete fix hints), and the
`role_charters` governance-report summary — is delivered, committed, and green: **18/18 role-charter tests**
and **267/267** across an independent 12-suite blast-radius regression batch, all exit 0, all re-run by QA
this turn. The live CLI on this repo prints "all well-formed (4/4 invariants each)" and exits 0; a QA-built
charter-incomplete config exits 1 with the missing invariant ids and actionable fix hints (the real CI-gate
path, which M15's status-only `attention` did not have). A real end-to-end `export → report` confirms
`subject.run.role_charters` is wired into the standard governance report and coexists with the M14
`ship_status` and M15 `human_attention` summaries. The validator is strictly read-only (AT-RC-013,
byte-identical state + unmutated config) and composes `runtime-capabilities.js` / `gate-evaluator.js` /
routing — reimplementing none. Two non-blocking findings logged (stale-artifact process gap; a live-CLI
reachability caveat for schema-invalid roles). No blocking issues.

## Challenge to the Previous Turn (dev, turn_29fc38df7a095987)

QA did **not** rubber-stamp the dev turn. Independently checked, beyond re-reading the report:

1. **Re-ran the dev's headline claim from scratch** — `role-charter.test.js` 18/18, then an independent
   267-test batch over the report/role/gate/admission/contract suites (not the dev's exact 20-suite set):
   0 failures. The two runs overlap on the highest-risk suites and agree.
2. **Independently confirmed the exit-code contract is real** by building a *config-valid but
   charter-incomplete* repo (a `ghost` role with a valid mandate/authority/runtime but absent from routing and
   owning nothing) and running the live CLI: exit 1 with "missing: produces_artifacts, workflow_participation"
   and two fix-hint lines. The dev claimed this; QA reproduced it on a fresh fixture.
3. **Ran the e2e report integration the dev only asserted via unit tests** — `export → report --format json`
   → `subject.run.role_charters = {total:4, well_formed:4, incomplete:0}`. Caught a transient `EAGAIN` stdin
   pipe error on the first attempt, isolated it as an I/O race (not a code defect — the export artifact carries
   `config` with all 4 roles), and re-ran via file input to a clean `overall: pass`.
4. **Verified DEC-001 is a genuine spec correction, not a deviation to wave through** — the ROADMAP literally
   says "non-`none` effective_write_path," but `getRoleRuntimeCapabilityContract` never returns `'none'`; a
   literal check would make invariant 2 dead code. The dev's `INCOHERENT_WRITE_PATHS` partition is what
   actually fires (AT-RC-004 proves it). QA confirmed the partition rather than trusting the note.
5. **Found and documented a live-CLI reachability gap the dev did not mention** (Finding 2 / OBJ-001): roles
   that are *both* schema-invalid *and* charter-incomplete are short-circuited by `loadProjectContext` with a
   misleading "No agentxchain.json found" message before the charter validator runs. Non-blocking (the module
   scores those cases correctly at the unit level, and the realistic schema-valid malformed role IS reported
   live), but logged honestly rather than omitted.

## Acceptance Test Results

- **8/8 PASS** (AC-1 through AC-8) — see acceptance-matrix.md Section A
- AC-1: module ships both evaluators, composes primitives, reimplements none (AT-RC-001/002/008)
- AC-2: `role validate [role_id]` `--json`, exit 0/1 contract (live + AT-RC-010/011/012)
- AC-3: `well_formed iff 4/4`, independent non-short-circuiting invariants (AT-RC-007/009)
- AC-4: reference pm/dev/qa + enterprise `security_reviewer` all `well_formed` (AT-RC-001/002)
- AC-5: malformed role → `incomplete` + missing ids + fix hint (AT-RC-003…006/011; live ghost) — see OBJ-001
- AC-6: governance report `role_charters` summary present (real e2e export→report, coexists w/ M14+M15)
- AC-7: read-only (AT-RC-013, byte-identical + unmutated config)
- AC-8: vision closure — four-invariant per-role assessment via composition → VISION.md:100–130/123–128

## Regression Results (QA-Verified)

| Suite(s) | Tests | Result | Exit |
|----------|-------|--------|------|
| role-charter.test.js | 18 | PASS | 0 |
| Blast-radius batch (12 suites: report-cli, governance-report-content, workflow-kit-report, role-command, gate-evaluator, gate-evaluator-helpers, admission-control, vitest-contract, docs-cli-command-map-content, docs-cli-governance-content, run-completion, role-charter) | 267 | 0 failures | 0 |
| Live `role validate` (all / single / unknown / charter-incomplete) | n/a | exit 0 all-well-formed, exit 1 incomplete, fix hints shown | 0/1 |
| Live `export`→`report --format json` | n/a | `subject.run.role_charters` present; coexists w/ ship_status + human_attention | 0 |

**Limitation declared:** the full ~691-file suite was **not** run to completion (prior M15 measurement ~34 min,
over the single-shot budget). Verification is scoped to the M16 blast radius (import graph of the 8 changed
files) + CLI/docs/coverage contracts — the accepted M14/M15 precedent. The dev's 347/347 (20 suites) and this
turn's independent 267/267 (12 suites) overlap and agree. The known full-suite failure
(`bug-54-real-claude-reliability` Scenario B, a real-binary timing test) imports none of the changed files and
was not run; QA does not claim it passes.

## Dev Decision Verification

| Decision | Status |
|----------|--------|
| DEC-001: invariant-2 coherence partition (`INCOHERENT_WRITE_PATHS`), not literal `=== 'none'` | VERIFIED — a spec correction; literal check would be dead code (AT-RC-004 proves the partition fires) |
| DEC-002: tolerate normalized (`runtime_id`) + raw (`runtime`) config shapes | VERIFIED — CLI (normalized) + e2e report (raw export config) both resolve, proven live |
| DEC-003: `fix_hint` on every invariant (null when satisfied); manual carve-out inherited for invariant 3 | VERIFIED — AT-RC-002 (manual security_reviewer passes via ownership), AT-RC-003/004 (non-null hints) |

## Architecture Invariants

| Invariant | Status |
|-----------|--------|
| Composition layer — reimplements no capability/gate/file-production logic | CONFIRMED |
| Strictly read-only | CONFIRMED (AT-RC-013) |
| `well_formed iff 4/4`, invariants independent | CONFIRMED (AT-RC-007/009) |
| Deterministic aggregate (sorted, counts reconcile) | CONFIRMED (AT-RC-008) |
| CLI delegates entirely to the module | CONFIRMED |

## Blocking Issues: 0

## Non-Blocking Findings (carried into the decision trail)

1. **Stale QA artifacts — 11th consecutive run (fixed):** all three artifacts referenced M15; rewritten for
   M16. Durable governance gap — recommend run-scoped QA artifact scaffolding (or a gate check that the
   artifact `Run:` header matches the active run).
2. **OBJ-001 — live `role validate` short-circuits on schema-invalid configs:** a role that is both
   schema-invalid (e.g. empty mandate / review_only+local_cli) and charter-incomplete is caught by
   `loadProjectContext` with a misleading "No agentxchain.json found" before the charter validator runs. The
   module scores those exact cases correctly at the unit level (AT-RC-003/004), and the realistic schema-valid
   malformed role IS reported live with fix hints (`ghost`, QA-verified) — so AC-5 holds. Per-spec for M16
   (the ROADMAP does not require charter reporting on schema-invalid configs); does not block. Recommend the
   CLI surface validation errors explicitly (or run the validator on the raw config) in a future increment.
3. **`role_charters` report summary shares the schema-valid precondition (informational):** accurate for the
   normal exported-run case (QA-verified live); noted only to connect the report path to Finding 2.

## Ship Decision

8/8 acceptance criteria pass. 18/18 + 267/267 tests, 0 failures, all QA-run, all exit 0. 5/5 invariants
maintained. 3/3 dev decisions verified (including a genuine spec correction in invariant-2 coherence that
turns a would-be dead check into a real one). Live CLI demonstrably answers VISION.md:100–130 — the four-part
charter invariant is now enforceable per-role with an exit-1 CI gate and actionable fix hints, and the
governance report exposes `role_charters` alongside the M14/M15 summaries. The two non-blocking findings
(stale-artifact process gap; schema-invalid short-circuit) are documented and out of M16 scope. ROADMAP M16
build items closed; acceptance line 194 checked off by this turn. **SHIP.**
