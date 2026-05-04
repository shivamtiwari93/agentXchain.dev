# Ship Verdict — M7: Windsurf & OpenCode Connector Expansion

**Run:** run_0db6a75ab239c3a3
**Turn:** turn_1cd75071e9051de9 (QA)
**Milestone:** ROADMAP.md:88-91 (Connector Ecosystem Expansion)

## Verdict: YES

## QA Summary

10/10 SYSTEM_SPEC acceptance criteria pass (AT-CONN-001 through AT-CONN-010). All independently verified by QA through source code inspection and independent test execution — no rubber stamp.

## Independent Verification

56 tests across 5 connector-related suites, 0 failures, 0 regressions:

| Suite | Tests | Result |
|-------|-------|--------|
| windsurf-connector.test.js | 14 | PASS |
| opencode-connector.test.js | 14 | PASS |
| cursor-connector.test.js | 14 | PASS (regression) |
| connector-probe.test.js | 3 | PASS |
| vitest-contract.test.js | 11 | PASS (673 files) |
| **Total** | **56** | **0 failures** |

Each suite executed independently by QA via `npx vitest run test/<file>`.

## Challenge of Dev Turn (turn_0fdb3c19283854fc)

All 3 dev decisions independently evaluated:

1. **DEC-001 (No material deviations from PM spec): VERIFIED.** QA compared every source change against SYSTEM_SPEC §2.1-§2.4. Line numbers, function signatures, error contracts, and insertion points all match the actual codebase. Dev's claim is accurate.

2. **DEC-002 (Windsurf checks only --agent, not 'agent' subcommand): APPROVED.** Cursor's dual-check (`--background-agent` || `agent`) at local-cli-adapter.js:834 exists because Cursor historically supports both a CLI flag and a subcommand. Windsurf uses `--agent` as a flag only — checking for bare `agent` would be incorrect and could collide with future flag additions. Sound decision.

3. **DEC-003 (12 pre-existing test failures unrelated to connector changes): ACCEPTED.** Dev verified by grep that zero failing test files reference changed modules (`claude-local-auth.js`, `local-cli-adapter.js`, `connector-probe.js`, `doctor.js`). The failures are in docs contracts, dashboard view registry, and E2E proposal/remote-agent tests — none of which touch the connector pipeline.

## Architecture Verification

- **No new runtime types** — Windsurf and OpenCode use existing `local_cli` type. `VALID_RUNTIME_TYPES` unchanged.
- **No new modules** — All changes are additions to existing files following the proven Cursor connector pattern.
- **No adapter dispatch changes** — `dispatchLocalCli()` handles all local_cli connectors generically. Only detection/validation pipeline touched.
- **Cursor gap closed** — `KNOWN_CLI_AUTHORITY_FLAGS` and `KNOWN_CLI_TRANSPORTS` now include cursor alongside the 2 new entries, fixing a gap from the original Cursor delivery.
- **Detection functions are pure** — `isWindsurfLocalCliRuntime()` and `isOpenCodeLocalCliRuntime()` are side-effect-free: normalize → check head → return boolean.
- **Validation order deterministic** — Claude → Codex → Cursor → Windsurf → OpenCode → ok. Detection functions make blocks mutually exclusive.
- **Vitest contract** — 673 files, 11/11 contract tests pass (bumped from 671).

## QA Findings (Non-Blocking)

### Finding 1 (info): Stale QA artifacts rewritten

All three QA workflow artifacts referenced run_b2a4084d6b3fe3b3 (M8) instead of current run_0db6a75ab239c3a3 (M7). Rewritten from scratch.

### Finding 2 (info): Dev evidence accurately stated

Dev claimed 28 new tests (14+14), cursor regression clean, vitest contract passing at 673. All independently confirmed by QA.

### Finding 3 (info): Transport assignments are architecturally sound

Windsurf → `dispatch_bundle_only` (IDE reads from disk, same as Cursor). OpenCode → `stdin` (terminal CLI receives via pipe, same as Claude). Both match the execution model of their respective tools.

## Open Blockers

None.

## Ship Decision

All 10 acceptance criteria pass. All 3 dev decisions correct and justified. 56 tests across 5 suites with 0 failures and 0 regressions. 4 modified files + 2 new test files, zero new dependencies, proven Cursor pattern replicated consistently, Cursor probe gap closed. Connector ecosystem now covers all 5 supported CLI tools (Claude, Codex, Cursor, Windsurf, OpenCode). **SHIP.**
