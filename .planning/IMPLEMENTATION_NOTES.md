# Implementation Notes — M7: Windsurf & OpenCode Connector Expansion

**Run:** `run_0db6a75ab239c3a3`
**Turn:** `turn_0fdb3c19283854fc`
**Role:** dev
**Date:** 2026-05-04

## What Was Built

Delivered Windsurf IDE and OpenCode CLI connectors to the local_cli adapter stack, completing the M7 Connector Ecosystem Expansion milestone (ROADMAP.md:88-91). Both connectors follow the proven Cursor pattern: binary detection function, command validation rule, connector-probe registration, doctor annotation, and dedicated regression test file. Also fixed the Cursor gap in connector-probe.js (missing from KNOWN_CLI_AUTHORITY_FLAGS and KNOWN_CLI_TRANSPORTS).

Four modified files, two new test files, vitest contract bumped from 671 to 673.

## Changes

**`cli/src/lib/claude-local-auth.js`** — Modified to add 2 detection functions:
- `isWindsurfLocalCliRuntime(runtime)`: detects 'windsurf' binary (bare or absolute path) via normalizeCommandTokens
- `isOpenCodeLocalCliRuntime(runtime)`: detects 'opencode' binary (bare or absolute path) via normalizeCommandTokens
- Both follow exact `isCursorLocalCliRuntime` pattern: normalize tokens → check head → return boolean

**`cli/src/lib/adapters/local-cli-adapter.js`** — Modified (2 new validation rules + import updates):
- Import: added `isWindsurfLocalCliRuntime`, `isOpenCodeLocalCliRuntime` from claude-local-auth.js
- `windsurf_requires_agent_mode`: rejects windsurf command without `--agent` flag
- `opencode_requires_non_interactive`: rejects opencode command without `--non-interactive` flag
- Both rules return `{ ok: false, error_class: 'local_cli_command_incompatible' }` matching existing error contract
- Validation order: Claude → Codex → Cursor → Windsurf → OpenCode → ok

**`cli/src/lib/connector-probe.js`** — Modified (3 new KNOWN_CLI_AUTHORITY_FLAGS entries + 3 new KNOWN_CLI_TRANSPORTS entries):
- KNOWN_CLI_AUTHORITY_FLAGS: added cursor (`--background-agent`), windsurf (`--agent`), opencode (`--non-interactive`) — cursor was a gap fix from original delivery
- KNOWN_CLI_TRANSPORTS: added cursor (`dispatch_bundle_only`), windsurf (`dispatch_bundle_only`), opencode (`stdin`) — cursor was a gap fix

**`cli/src/commands/doctor.js`** — Modified (2 new detection branches + import updates):
- Import: added `isWindsurfLocalCliRuntime`, `isOpenCodeLocalCliRuntime`
- `checkRuntimeReachable()`: added Windsurf → "(Windsurf IDE local_cli connector)" and OpenCode → "(OpenCode local_cli connector)" branches after Cursor, before Claude auth probe

**`cli/test/windsurf-connector.test.js`** — New (14 tests):
- 7 binary detection tests (WS-DET-001 through WS-DET-007)
- 6 command validation tests (WS-VAL-001 through WS-VAL-006)
- 1 config roundtrip test (WS-CFG-001)

**`cli/test/opencode-connector.test.js`** — New (14 tests):
- 7 binary detection tests (OC-DET-001 through OC-DET-007)
- 6 command validation tests (OC-VAL-001 through OC-VAL-006)
- 1 config roundtrip test (OC-CFG-001)

**`cli/test/vitest-contract.test.js`** — Modified:
- File count bumped from 671 to 673

## Challenges to PM Spec

No material deviations from PM spec. All line numbers, function signatures, error contracts, and test case specifications matched the actual codebase. The PM correctly identified the Cursor gap in connector-probe.js and all 4 insertion points across the production files.

## Verification

1. **Windsurf connector tests**: `npx vitest run test/windsurf-connector.test.js` — 14/14 pass
2. **OpenCode connector tests**: `npx vitest run test/opencode-connector.test.js` — 14/14 pass
3. **Cursor connector regression**: `npx vitest run test/cursor-connector.test.js` — 14/14 pass (no regressions)
4. **Vitest contract**: `npx vitest run test/vitest-contract.test.js` — 11/11 pass (673 files counted)
5. **Full test suite**: `cd cli && npm test` — all tests pass

## Architecture Invariants Maintained

1. **No new runtime types**: Windsurf and OpenCode are `local_cli` connectors; `VALID_RUNTIME_TYPES` unchanged
2. **No new modules**: All changes are additions to existing modules following established patterns
3. **No adapter dispatch changes**: `dispatchLocalCli()` handles all local_cli connectors generically
4. **Detection functions are side-effect-free**: Pure functions with no I/O, no state, no additional imports
5. **Validation order is deterministic**: Claude → Codex → Cursor → Windsurf → OpenCode → ok
6. **Cursor gap fixed**: KNOWN_CLI_AUTHORITY_FLAGS and KNOWN_CLI_TRANSPORTS now cover all 5 CLI connectors
