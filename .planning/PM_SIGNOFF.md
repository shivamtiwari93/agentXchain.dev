# PM Signoff — M7: Connector Ecosystem Expansion — Per-Connector Governed Turn E2E Validation

Approved: YES

**Run:** `run_f89a47c58f54929c`
**Phase:** planning
**Turn:** `turn_4c3388b43da61521`
**Date:** 2026-05-04

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators who need confidence that each local_cli connector flavor (Claude, Codex, Cursor) can complete a full governed turn lifecycle — from config to dispatch to staged result acceptance — without manual intervention.

### Core Pain Point

The connector ecosystem now has three recognized `local_cli` flavors (Claude, Codex, Cursor), each with binary detection, command validation, and doctor health checks. However, there is no single test that proves each connector type can complete a full governed turn end-to-end through the `connector validate` pipeline. The existing coverage is:

| Connector | Binary detection | Command validation | Doctor health | Governed turn E2E |
|-----------|-----------------|-------------------|---------------|-------------------|
| Claude    | Yes             | Yes               | Yes           | **Yes** (AT-CCV-007 in `connector-validate-command.test.js:318`) |
| Codex     | Yes             | Yes               | Yes           | **No** |
| Cursor    | Yes             | Yes               | Yes           | **No** |

Claude has a governed turn E2E via the AT-CCV-007 test (shim binary + full `connector validate` pipeline). Codex and Cursor have unit-level coverage (binary detection, command validation, config roundtrip) but no governed turn E2E.

### Design Decision: Shim-Binary E2E Per Connector Type

Each connector type gets a governed turn E2E test that:

1. Scaffolds a governed project with the connector-specific config
2. Writes a shim binary (shell script) named after the connector (`claude`, `codex`, `cursor`) into a temp `shim-bin/` directory
3. Configures `PATH` so the shim is discoverable by `probeRuntimeSpawnContext()`
4. Runs `validateConfiguredConnector()` (the programmatic API) or `agentxchain connector validate` (the CLI)
5. Asserts `overall: 'pass'`, `dispatch.ok: true`, `validation.ok: true`

The shim binary reads `ASSIGNMENT.json` from the dispatch bundle and writes a schema-valid `turn-result.json` to the staged path, exercising the full dispatch-to-acceptance pipeline.

### Evidence of Existing Patterns

The AT-CCV-007 test in `connector-validate-command.test.js:318` already demonstrates this pattern for Claude:
- `writeClaudeShim()` creates a shell script at `shim-bin/claude`
- The shim reads `ASSIGNMENT.json` and writes a valid turn-result.json
- The test invokes `connector validate local-dev --role dev --json`
- The test asserts `overall: 'pass'`

Dev reuses this pattern for Codex and Cursor.

## Challenge to Previous Turn

### OBJ-PM-001: Previous planning artifacts describe Cursor connector (ROADMAP.md:87), not per-connector E2E validation (ROADMAP.md:90) (severity: high)

PM_SIGNOFF.md, SYSTEM_SPEC.md, and ROADMAP.md Phases table all describe the Cursor IDE connector implementation from `run_10a2b2d8f0a8399b`. This run's intent is ROADMAP.md:90 — "Validate each connector with a single governed turn end-to-end." All three artifacts rewritten from scratch.

### OBJ-PM-002: ROADMAP.md:87 (Cursor connector) remains unchecked despite successful dev implementation (severity: low)

The previous dev turn implemented the Cursor connector with 14 passing tests, but ROADMAP.md:87 still shows `[ ]`. This was correctly deferred for QA verification. However, no QA turn was dispatched in the Cursor connector run. The check-off should happen as part of this run's QA phase after verifying the Cursor E2E test passes alongside Claude and Codex.

### Core Workflow (this run)

1. **PM (this turn)** — Scope per-connector governed turn E2E validation, write planning artifacts
2. **Dev** — Add Codex and Cursor governed turn E2E tests, verify all three connector types pass
3. **QA** — Run full test suite, verify acceptance contract, check off ROADMAP.md:87 and ROADMAP.md:90

### MVP Scope (this run)

**This run scopes ROADMAP.md:90 — "Validate each connector with a single governed turn end-to-end."** Additionally, ROADMAP.md:87 can be checked off as a side-effect once the Cursor E2E validates end-to-end.

**PM deliverables (this turn):**
1. PM_SIGNOFF.md: Scope definition, design decisions, acceptance criteria
2. SYSTEM_SPEC.md: Technical spec with file:line references, shim binary patterns, test plan
3. ROADMAP.md: Phases table updated for per-connector E2E validation scope

**Dev deliverables:**
1. Codex connector E2E test: shim binary + governed turn + assertion
2. Cursor connector E2E test: shim binary + governed turn + assertion
3. Optional: refactor AT-CCV-007 (Claude) into a shared test file alongside Codex/Cursor, or leave Claude in place and add Codex/Cursor to the same file
4. Update vitest contract file count if new test file is added
5. Minimum 2 new tests (Codex E2E + Cursor E2E); Claude E2E is AT-CCV-007 (existing)

### Out of Scope

- Windsurf connector (not implemented yet — separate M7 run)
- OpenCode connector (not implemented yet — separate M7 run)
- Changes to `connector-validate.js` pipeline logic (already works)
- Changes to binary detection, command validation, or doctor health checks (already implemented)
- Live binary testing (shim binaries are sufficient for governed turn E2E proof)
- `api_proxy`, `mcp`, `remote_agent` E2E (AT-CCV-006 already covers api_proxy; others are out of M7 scope)

### Success Metric

| # | Acceptance Item | Verified By |
|---|----------------|-------------|
| 1 | Roadmap milestone addressed: M7: Connector Ecosystem Expansion | ROADMAP.md:90 scoped and planning artifacts written |
| 2 | Unchecked roadmap item completed: Validate each connector with a single governed turn end-to-end | Claude (AT-CCV-007) + Codex (new) + Cursor (new) all pass `connector validate` with `overall: 'pass'` |
| 3 | Evidence source: .planning/ROADMAP.md:90 | ROADMAP.md:90 checked off after QA verification |

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Codex shim binary may need different argv handling than Claude | Low | Codex uses `exec --json` and reads dispatch bundle — shim pattern is identical (read ASSIGNMENT.json, write turn-result.json) |
| Cursor shim binary runs with `dispatch_bundle_only` transport | Low | Same shim pattern — all three connector types read the dispatch bundle, not stdin |
| Test execution time for 3 shim-based E2E tests | Low | Each test scaffolds a governed project, shim dispatch completes in <5s |

## Notes for Dev

**Your charter requires 2 new E2E tests — Codex and Cursor governed turn validation.**

Claude E2E already exists at `connector-validate-command.test.js:318` (AT-CCV-007). You need to add equivalent tests for Codex and Cursor. The approach:

1. Write a `writeCodexShim(root, contents)` helper (like `writeClaudeShim`) that creates `shim-bin/codex`
2. Write a `writeCursorShim(root, contents)` helper that creates `shim-bin/cursor`
3. Each shim: reads `ASSIGNMENT.json`, writes valid `turn-result.json` to staged path
4. Each test: configures the connector-specific runtime, puts `shim-bin/` on PATH, runs `connector validate`, asserts `overall: 'pass'`

Config shapes:
- **Codex:** `{ type: 'local_cli', command: ['codex', 'exec', '--json'], prompt_transport: 'dispatch_bundle_only' }`
- **Cursor:** `{ type: 'local_cli', command: ['cursor', '--background-agent'], prompt_transport: 'dispatch_bundle_only' }`

**Dev decides** whether to add tests to `connector-validate-command.test.js` or create a new `connector-e2e-per-type.test.js` file. Either is acceptable.

**Minimum 2 new tests required:**
1. Codex governed turn E2E — shim binary `codex` + full connector validate pipeline → `overall: 'pass'`
2. Cursor governed turn E2E — shim binary `cursor` + full connector validate pipeline → `overall: 'pass'`

## Notes for QA

- Run full test suite: `cd cli && npm test`
- Verify Claude E2E (AT-CCV-007), Codex E2E (new), and Cursor E2E (new) all pass
- Confirm no regressions in existing connector validate tests
- After ship: verify ROADMAP.md:87 and ROADMAP.md:90 can both be checked off

## Acceptance Contract

1. **Roadmap milestone addressed: M7: Connector Ecosystem Expansion** — ROADMAP.md:90 scoped with planning artifacts; governed turn E2E tests added for all three local_cli connector types
2. **Unchecked roadmap item completed: Validate each connector with a single governed turn end-to-end** — Claude (AT-CCV-007), Codex (new test), and Cursor (new test) all complete a governed turn through `connector validate` with `overall: 'pass'`
3. **Evidence source: .planning/ROADMAP.md:90** — ROADMAP.md:90 checked off after QA full suite verification
