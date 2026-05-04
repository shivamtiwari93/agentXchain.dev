# PM Signoff — M7: Connector Ecosystem Expansion — Doctor Health Check Per Connector Type

Approved: YES

**Run:** `run_3da0168fc830ad47`
**Phase:** planning
**Turn:** `turn_9ba736449e3f3c46`
**Date:** 2026-05-04

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators who run `agentxchain doctor` to verify project readiness before governed runs. Each recognized connector type (Claude, Codex, Cursor) must be explicitly recognized and health-checked by doctor.

### Core Pain Point

`agentxchain doctor` has connector-specific recognition for Claude (auth smoke probe) and Cursor (annotation at `doctor.js:505`), but **Codex has no explicit recognition in doctor**. When a project uses a Codex runtime, doctor falls through to the Claude auth check (which returns `null` for non-Claude), then emits a generic pass detail without identifying it as a Codex connector. Additionally, **no doctor E2E tests exist for Codex or Cursor connectors** — `governed-doctor-e2e.test.js` has zero references to either.

| Connector | Doctor recognition | Doctor annotation | Doctor E2E test |
|-----------|-------------------|-------------------|-----------------|
| Claude | Yes (auth probe at `doctor.js:512`) | Implicit (auth check detail) | Yes (`governed-doctor-e2e.test.js`) |
| Codex | **NO** — falls through to generic `local_cli` | **NO** annotation | **NO** |
| Cursor | Yes (line 505) | "(Cursor IDE local_cli connector)" | **NO** |

### Root Cause

`doctor.js:24` imports `isCursorLocalCliRuntime` but NOT `isCodexLocalCliRuntime`. The `checkRuntimeReachable()` function at line 502-522 has explicit Cursor handling (line 505-510) but no Codex branch. Codex runtimes silently pass through the Claude auth check path.

## Challenge to Previous Turn

### OBJ-PM-001: Planning artifacts describe per-connector E2E validation (run_f89a47c58f54929c), not doctor acceptance (run_3da0168fc830ad47) (severity: high)

All three planning artifacts were written for the previous run's scope — ROADMAP.md:90 "Validate each connector with a single governed turn end-to-end." This run targets ROADMAP.md:91 — "Acceptance: `agentxchain doctor` passes for each new connector type." All three artifacts rewritten from scratch.

### OBJ-PM-002: ROADMAP.md:87 and :90 remain unchecked despite QA verification evidence (severity: medium)

QA turn `turn_d9ed8684dd317bb7` verified:
- Cursor connector: 14 tests in `cursor-connector.test.js` pass
- Per-connector E2E: AT-CCV-007 (Claude), AT-CCV-009 (Codex), AT-CCV-010 (Cursor) all pass `connector validate` with `overall: 'pass'`
- 474 targeted tests across 10 test files, 0 failures

Both ROADMAP.md:87 (Cursor connector) and :90 (per-connector E2E validation) should be checked off. PM checks them off in this planning turn.

### Core Workflow (this run)

1. **PM (this turn)** — Scope doctor acceptance, check off :87 and :90, rewrite planning artifacts
2. **Dev** — Add Codex recognition to doctor, add doctor E2E tests for Codex + Cursor
3. **QA** — Run full test suite, verify doctor passes for all three connector types, check off ROADMAP.md:91

### MVP Scope (this run)

**This run scopes ROADMAP.md:91 — "Acceptance: `agentxchain doctor` passes for each new connector type."**

**PM deliverables (this turn):**
1. PM_SIGNOFF.md: Scope definition, design decisions, acceptance criteria
2. SYSTEM_SPEC.md: Technical spec with file:line references for doctor changes
3. ROADMAP.md: Check off :87 and :90, update phases table for doctor scope

**Dev deliverables:**
1. Import `isCodexLocalCliRuntime` in `doctor.js` (line 24)
2. Add Codex recognition branch in `checkRuntimeReachable()` (after Cursor check at line 505)
3. Add 3 doctor E2E tests in `governed-doctor-e2e.test.js`:
   - Codex runtime → doctor passes with Codex annotation
   - Cursor runtime → doctor passes with Cursor annotation
   - Claude regression — doctor still runs auth check
4. Update vitest contract file count if new test file added (unlikely — tests go in existing file)

### Out of Scope

- Windsurf connector (not implemented yet — separate M7 run)
- OpenCode connector (not implemented yet — separate M7 run)
- Codex auth probe (OPENAI_API_KEY validation) — desirable but not required for doctor pass; deferred
- Changes to `connector-validate.js` pipeline (already proven by previous run)
- Changes to binary detection or command validation (already implemented)
- Changes to `claude-local-auth.js` (detection functions already exist; only doctor.js needs new import + branch)

### Success Metric

| # | Acceptance Item | Verified By |
|---|----------------|-------------|
| 1 | Roadmap milestone addressed: M7: Connector Ecosystem Expansion | ROADMAP.md:91 scoped with planning artifacts |
| 2 | Unchecked roadmap item completed: `agentxchain doctor` passes for each new connector type | Doctor E2E tests prove Codex + Cursor + Claude all pass with connector-specific recognition |
| 3 | Evidence source: .planning/ROADMAP.md:91 | ROADMAP.md:91 checked off after QA verification |

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Codex shim binary needed for doctor binary probe | Low | Doctor tests use `makeGoverned()` which already sets up mock runtimes; just need connector-specific command tokens |
| Doctor test scaffolding may not recognize Codex/Cursor commands | Low | The `makeGoverned()` helper already overrides runtime configs; tests mutate command to connector-specific tokens |
| Adding Codex branch changes doctor control flow | Low | Codex branch is identical to Cursor branch — early return with annotation, no auth check needed |

### Design Decision: Codex Recognition Mirrors Cursor Pattern

The Codex doctor branch follows the identical pattern to Cursor (lines 505-510):

```javascript
if (isCodexLocalCliRuntime(rt)) {
  return attachRuntimeContract({
    ...base,
    level: 'pass',
    detail: `${probe.detail} (Codex local_cli connector)`,
  }, rtId, rt, boundRoleEntries);
}
```

This ensures:
1. Codex is explicitly recognized before falling into the Claude auth path
2. Codex annotation appears in doctor JSON output (testable)
3. No spurious Claude auth probe runs for Codex runtimes (matching Cursor's design)

## Notes for Dev

**Your charter requires 3 changes to doctor.js and 3 new tests.**

### doctor.js changes (3 lines of logic):
1. Import `isCodexLocalCliRuntime` at line 24 (add to existing import from `claude-local-auth.js`)
2. Add Codex recognition branch after Cursor check (line 510), before Claude auth check (line 512)
3. Annotation string: `(Codex local_cli connector)` — follows Cursor's `(Cursor IDE local_cli connector)` pattern

### Test additions (3 tests in `governed-doctor-e2e.test.js`):
1. **AT-GD-CODEX-001**: Scaffold governed project with Codex runtime config `{ type: 'local_cli', command: ['codex', 'exec', '--json'], prompt_transport: 'dispatch_bundle_only' }` → doctor JSON output has runtime check with `level: 'pass'` and `detail` containing `Codex local_cli connector`
2. **AT-GD-CURSOR-001**: Scaffold governed project with Cursor runtime config `{ type: 'local_cli', command: ['cursor', '--background-agent'], prompt_transport: 'dispatch_bundle_only' }` → doctor JSON output has runtime check with `level: 'pass'` and `detail` containing `Cursor IDE local_cli connector`
3. **AT-GD-CLAUDE-REGRESSION**: Existing Claude runtime config → doctor still runs auth check path (regression guard)

**IMPORTANT:** The `makeGoverned()` helper overwrites all runtimes with `mockRuntime` (line 38-40). For connector-specific tests, mutate the config AFTER `makeGoverned()` to set the connector-specific command tokens. The mock binary (`MOCK_AGENT`) will still serve as the executable — what matters is the command tokens in the config that doctor uses for `isCodexLocalCliRuntime()` / `isCursorLocalCliRuntime()` detection.

**Dev decides** the exact test structure — inline in existing describe blocks or in a new `describe('Connector-specific doctor recognition')` group.

## Notes for QA

- Run full test suite: `cd cli && npm test`
- Verify `governed-doctor-e2e.test.js` passes with the 3 new tests
- Verify no regressions in existing doctor tests
- After ship: verify ROADMAP.md:91 can be checked off

## Acceptance Contract

1. **Roadmap milestone addressed: M7: Connector Ecosystem Expansion** — ROADMAP.md:91 scoped with planning artifacts; doctor connector recognition added for all three local_cli types
2. **Unchecked roadmap item completed: `agentxchain doctor` passes for each new connector type** — Doctor E2E tests prove Claude (regression), Codex (new), and Cursor (new) all pass doctor with connector-specific recognition annotations
3. **Evidence source: .planning/ROADMAP.md:91** — ROADMAP.md:91 checked off after QA full suite verification
