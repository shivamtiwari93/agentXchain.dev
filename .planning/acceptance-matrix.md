# Acceptance Matrix — M7: Windsurf & OpenCode Connector Expansion

**Run:** run_0db6a75ab239c3a3
**Turn:** turn_1cd75071e9051de9 (QA)
**Scope:** 2 detection functions, 2 validation rules, 3+3 probe registrations (incl. Cursor gap fix), 2 doctor annotations, 28 new tests across 2 files. Vitest contract bumped 671 → 673.

## Section A: SYSTEM_SPEC Acceptance Tests

| Req # | Requirement (from SYSTEM_SPEC §Acceptance Tests) | Evidence | Status |
|-------|------------------------------------------------------|----------|--------|
| AT-CONN-001 | isWindsurfLocalCliRuntime detects 'windsurf' command variants | QA verified source: `claude-local-auth.js:59-66` — normalizes tokens, lowercases head, matches `'windsurf'` or suffix `'/windsurf'`. Identical pattern to `isCursorLocalCliRuntime` (line 50). Test WS-DET-001 through WS-DET-007 all pass (bare command, absolute path, array, false cases). | PASS |
| AT-CONN-002 | isOpenCodeLocalCliRuntime detects 'opencode' command variants | QA verified source: `claude-local-auth.js:68-75` — identical pattern. Matches `'opencode'` or suffix `'/opencode'`. Test OC-DET-001 through OC-DET-007 all pass. | PASS |
| AT-CONN-003 | validateLocalCliCommandCompatibility rejects windsurf without --agent | QA verified source: `local-cli-adapter.js:852-869` — `isWindsurfLocalCliRuntime(runtimeShape)` gates check, `!tokens.includes('--agent')` triggers rejection with `error_class: 'local_cli_command_incompatible'`, `diagnostic.rule: 'windsurf_requires_agent_mode'`. Test WS-VAL-001 and WS-VAL-002 pass. | PASS |
| AT-CONN-004 | validateLocalCliCommandCompatibility rejects opencode without --non-interactive | QA verified source: `local-cli-adapter.js:871-888` — `isOpenCodeLocalCliRuntime(runtimeShape)` gates check, `!tokens.includes('--non-interactive')` triggers rejection with `diagnostic.rule: 'opencode_requires_non_interactive'`. Test OC-VAL-001 and OC-VAL-002 pass. | PASS |
| AT-CONN-005 | KNOWN_CLI_AUTHORITY_FLAGS includes all 5 CLI connectors | QA verified source: `connector-probe.js:18-49` — 5 entries: claude (line 19), codex (line 25), cursor (line 31, gap fix), windsurf (line 37), opencode (line 43). Each has `binary`, `authoritative_flag`, `weak_flags`, `label`. | PASS |
| AT-CONN-006 | KNOWN_CLI_TRANSPORTS includes all 5 CLI connectors | QA verified source: `connector-probe.js:55-61` — 5 entries: claude→stdin, codex→argv+stdin, cursor→dispatch_bundle_only (gap fix), windsurf→dispatch_bundle_only, opencode→stdin. Transport assignments match execution models (IDE=dispatch_bundle_only, CLI=stdin). | PASS |
| AT-CONN-007 | Doctor labels Windsurf as "(Windsurf IDE local_cli connector)" | QA verified source: `doctor.js:512-517` — `isWindsurfLocalCliRuntime(rt)` branch returns `detail: \`${probe.detail} (Windsurf IDE local_cli connector)\``. Import at line 24 confirmed. | PASS |
| AT-CONN-008 | Doctor labels OpenCode as "(OpenCode local_cli connector)" | QA verified source: `doctor.js:519-524` — `isOpenCodeLocalCliRuntime(rt)` branch returns `detail: \`${probe.detail} (OpenCode local_cli connector)\``. Follows Cursor pattern (line 505). | PASS |
| AT-CONN-009 | Windsurf config accepted by loadNormalizedConfig as valid local_cli | QA verified: test WS-CFG-001 passes — config with `type: 'local_cli'`, `command: ['windsurf', '--agent']`, `prompt_transport: 'dispatch_bundle_only'` validates successfully through `loadNormalizedConfig()`. | PASS |
| AT-CONN-010 | OpenCode config accepted by loadNormalizedConfig as valid local_cli | QA verified: test OC-CFG-001 passes — config with `type: 'local_cli'`, `command: ['opencode', '--non-interactive']`, `prompt_transport: 'stdin'` validates successfully through `loadNormalizedConfig()`. | PASS |

**Summary: 10/10 PASS**

## Section B: Code Correctness Verification

| Check | Detail | Status |
|-------|--------|--------|
| Detection function pattern (claude-local-auth.js:59-75) | Both `isWindsurfLocalCliRuntime` and `isOpenCodeLocalCliRuntime` are exact structural clones of `isCursorLocalCliRuntime` (line 50-57): normalize tokens → length check → lowercase head → match name or path suffix. Pure functions, no side effects, no I/O. | PASS |
| Validation rule ordering (local-cli-adapter.js:833-890) | Validation chain: Claude (line 774) → Codex (line 794) → Cursor (line 833) → Windsurf (line 852) → OpenCode (line 871) → ok (line 890). Detection functions gate each block, making order-dependent false positives impossible (mutually exclusive head tokens). | PASS |
| Import consistency (local-cli-adapter.js:40-42) | `isWindsurfLocalCliRuntime` and `isOpenCodeLocalCliRuntime` properly imported from `claude-local-auth.js` alongside existing imports. | PASS |
| Import consistency (doctor.js:24) | Both detection functions imported on same line as `isCursorLocalCliRuntime` and `getClaudeSubprocessAuthIssue`. | PASS |
| Doctor branch ordering (doctor.js:505-525) | Cursor → Windsurf → OpenCode → Claude auth probe → generic. IDE connectors return early before Claude-specific auth probe. Matches architecture constraint from SYSTEM_SPEC §2.4.2. | PASS |
| Cursor gap fix — authority flags (connector-probe.js:31-36) | Cursor entry added with `authoritative_flag: '--background-agent'`, `weak_flags: []`, `label: 'Cursor IDE'`. Closes gap from original Cursor delivery. | PASS |
| Cursor gap fix — transports (connector-probe.js:58) | `cursor: ['dispatch_bundle_only']` added. Matches IDE-based execution model. | PASS |
| Windsurf transport assignment (connector-probe.js:59) | `windsurf: ['dispatch_bundle_only']` — correct, Windsurf is a VS Code fork (IDE) that reads dispatch bundles from disk, not stdin. | PASS |
| OpenCode transport assignment (connector-probe.js:60) | `opencode: ['stdin']` — correct, OpenCode is a terminal CLI that receives prompts via pipe. | PASS |
| Error contract consistency | Both Windsurf and OpenCode validation blocks return `{ ok: false, error_class: 'local_cli_command_incompatible', recovery, error, diagnostic }` matching the existing contract used by Claude, Codex, and Cursor rules. | PASS |
| Vitest contract (vitest-contract.test.js:56) | Asserts `TEST_FILES.length === 673`. 11/11 pass. Bumped from 671 (2 new test files added). | PASS |
| No new runtime types | `VALID_RUNTIME_TYPES` unchanged. Windsurf and OpenCode use `local_cli`. | PASS |
| No new modules | All changes are additions to existing modules. No new source files created. | PASS |
| No adapter dispatch changes | `dispatchLocalCli()` handles all local_cli connectors generically. Only detection/validation pipeline touched. | PASS |

## Section C: Regression Suites (QA-Verified)

| Suite | Count | Result |
|-------|-------|--------|
| windsurf-connector.test.js | 14 | PASS |
| opencode-connector.test.js | 14 | PASS |
| cursor-connector.test.js | 14 | PASS (no regressions) |
| connector-probe.test.js | 3 | PASS |
| vitest-contract.test.js | 11 | PASS (673 files) |
| **Total (5 suites)** | **56** | **0 failures** |

All test suites run independently by QA using `npx vitest run test/<file>`.

## Section D: Dev Challenge Review

### DEC-001 (No material deviations from PM spec): VERIFIED

QA independently compared all source changes against SYSTEM_SPEC §2.1-§2.4 deliverables. Line numbers, function signatures, error contracts, and insertion points all match. Dev's claim is accurate — no deviations to challenge.

### DEC-002 (Windsurf checks only --agent, not 'agent' subcommand): APPROVED

Cursor accepts both `--background-agent` flag AND `agent` subcommand (local-cli-adapter.js:834). Windsurf only checks `--agent` (line 853). This is correct — Windsurf IDE uses `--agent` as a CLI flag, not a subcommand. The Cursor dual-check exists because Cursor's CLI historically supported both forms. Different tool, different UX.

### DEC-003 (12 pre-existing test failures unrelated to connector changes): PENDING FULL SUITE

Dev claims 12 failing files in docs contracts, dashboard view registry, and E2E proposal/remote-agent tests are pre-existing and unrelated. Dev verified by grep showing zero references to changed modules in failing test files. QA will confirm with full suite run.

## Section E: QA Findings

### Finding 1 (info): Stale QA artifacts from wrong run

All three QA workflow artifacts (acceptance-matrix.md, ship-verdict.md, RELEASE_NOTES.md) referenced run_b2a4084d6b3fe3b3 (M8: Persistent Run History & Audit Trail) instead of current run_0db6a75ab239c3a3 (M7: Windsurf & OpenCode Connectors). All three rewritten from scratch by this QA turn.

### Finding 2 (info): Dev verification evidence accurately stated

Dev claimed 28 tests across 2 new files (14 Windsurf + 14 OpenCode), plus connector-probe (3) and vitest-contract (11) passes. QA independently confirmed: 14/14, 14/14, 3/3, 11/11. No evidence inflation.

### Finding 3 (info): Architecture invariants maintained

All 6 SYSTEM_SPEC §5 invariants confirmed: no new runtime types, no new modules, no adapter dispatch changes, Cursor gap fixed, detection functions are side-effect-free, validation order is deterministic.
