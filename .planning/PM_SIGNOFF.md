# PM Signoff — M7: Windsurf & OpenCode Connector Expansion

Approved: YES

**Run:** `run_0db6a75ab239c3a3`
**Phase:** planning
**Turn:** `turn_f009aec3517d24c7`
**Date:** 2026-05-04

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators who want to connect local AI agents running in **Windsurf IDE** or **OpenCode CLI** to governed multi-agent runs. These operators expect `agentxchain doctor` to detect, validate, and report on Windsurf and OpenCode connectors with the same fidelity as Claude, Codex, and Cursor connectors.

### Core Pain Point

VISION.md (line 17) declares **connectors to local and cloud AI agents** as a core product pillar. The cloud agent connectors are complete (api_proxy: Anthropic, OpenAI, Google, Ollama + MCP + remote_agent). The local agent connectors cover Claude, Codex, and Cursor — but M7 (ROADMAP.md:88-91) has three unchecked items:

- `[ ] Add Windsurf connector` (line 88)
- `[ ] Add OpenCode connector` (line 89)
- `[ ] Acceptance: agentxchain doctor passes for each new connector type` (line 91)

Without these, the connector pillar is incomplete. Operators using Windsurf or OpenCode cannot run governed turns through those tools.

**Evidence:**
- `claude-local-auth.js:32-57` — Only 3 detection functions: `isClaudeLocalCliRuntime`, `isCodexLocalCliRuntime`, `isCursorLocalCliRuntime`
- `connector-probe.js:18-31` — `KNOWN_CLI_AUTHORITY_FLAGS` only covers Claude and Codex (Cursor not listed either)
- `doctor.js:505` — Only `isCursorLocalCliRuntime` has special handling; no Windsurf/OpenCode detection
- `local-cli-adapter.js:831-848` — Only Cursor has command validation rules; no Windsurf/OpenCode

### Challenge to Previous Turn

#### OBJ-PM-001: Planning artifacts describe M8 hosted runner E2E lifecycle (run_bbbb5f230a0ec907), not the connector vision charter (severity: high)

All three planning artifacts are scoped for ROADMAP.md:98 — "a governed run completes via the hosted runner with dashboard visibility":
- PM_SIGNOFF.md: scopes continuation enqueue in execution-worker.js + E2E lifecycle test
- SYSTEM_SPEC.md: details `enqueueContinuation()` function, mock dispatch, poll-until-complete
- ROADMAP.md phases table: shows `run_bbbb5f230a0ec907` with hosted runner E2E scope

This run (`run_0db6a75ab239c3a3`) has a completely different charter: `[vision] What We Are Building: connectors** to local and cloud AI agents`. The connector vision maps to M7 completion, not M8 hosted runner lifecycle. All three artifacts rewritten from scratch.

#### OBJ-PM-002: Cursor connector missing from KNOWN_CLI_AUTHORITY_FLAGS in connector-probe.js (severity: low)

The Cursor connector was delivered in run_10a2b2d8f0a8399b (ROADMAP.md:87), but `connector-probe.js:18-31` `KNOWN_CLI_AUTHORITY_FLAGS` only lists Claude and Codex. Cursor's `--background-agent` flag should be registered alongside the other CLI authority flags. This omission should be fixed when adding Windsurf and OpenCode entries.

### Core Workflow (this run)

1. **PM (this turn)** — Scope Windsurf + OpenCode connectors following the Cursor pattern; identify all insertion points
2. **Dev** — Implement detection, validation, probe, doctor, and tests for both connectors
3. **QA** — Verify all tests pass, verify doctor detects both connectors, run full regression suite, check off M7 items

### MVP Scope (this run)

**This run completes M7: Connector Ecosystem Expansion (ROADMAP.md:88-91).**

**PM deliverables (this turn):**
1. PM_SIGNOFF.md: Scope, gap analysis, acceptance criteria
2. SYSTEM_SPEC.md: Technical spec for Windsurf + OpenCode connectors
3. ROADMAP.md: Update phases table for this run

**Dev deliverables:**
1. `cli/src/lib/claude-local-auth.js` — **Modify**: add `isWindsurfLocalCliRuntime()` + `isOpenCodeLocalCliRuntime()` detection functions
2. `cli/src/lib/adapters/local-cli-adapter.js` — **Modify**: add Windsurf + OpenCode command validation rules in `validateLocalCliCommandCompatibility()`
3. `cli/src/lib/connector-probe.js` — **Modify**: add Windsurf, OpenCode, and Cursor to `KNOWN_CLI_AUTHORITY_FLAGS` + `KNOWN_CLI_TRANSPORTS`
4. `cli/src/commands/doctor.js` — **Modify**: add Windsurf + OpenCode detection in `checkRuntimeReachable()` local_cli case
5. `cli/test/windsurf-connector.test.js` — **Create**: ~14 tests following cursor-connector.test.js pattern
6. `cli/test/opencode-connector.test.js` — **Create**: ~14 tests following cursor-connector.test.js pattern

### Out of Scope

- Changes to api-proxy-adapter.js (cloud connectors are complete)
- Changes to mcp-adapter.js or remote-agent-adapter.js
- Changes to run-loop.js, governed-state.js, or any state machine code
- Changes to hosted-runner.js or execution-worker.js
- Changes to dashboard components
- New runtime types (local_cli covers all CLI-based agents)
- Plugin system for custom connectors (future work)
- Real binary installation of Windsurf or OpenCode (tests mock detection)
- Changes to dispatchLocalCli (generic, works for all local_cli connectors)

### Success Metric

| # | Acceptance Item | Verified By |
|---|----------------|-------------|
| 1 | Vision goal addressed: connectors to local and cloud AI agents | M7 connector ecosystem expansion complete — 5 local CLI variants (Claude, Codex, Cursor, Windsurf, OpenCode) + 4 cloud providers + MCP + remote_agent |
| 2 | Windsurf connector: detection, validation, probe, doctor | windsurf-connector.test.js passes all tests |
| 3 | OpenCode connector: detection, validation, probe, doctor | opencode-connector.test.js passes all tests |
| 4 | KNOWN_CLI_AUTHORITY_FLAGS includes all 5 connectors | connector-probe.js updated |
| 5 | Doctor detects and labels both connectors | doctor.js shows "(Windsurf IDE local_cli connector)" and "(OpenCode local_cli connector)" |
| 6 | ROADMAP.md:88-91 checked off | QA verification |

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Windsurf CLI flags may change before vendor stabilizes | Low | Use generic `--agent` flag; easy to update when vendor documents final interface |
| OpenCode CLI interface not fully documented | Low | Use `--non-interactive` as the standard flag; CLI-based tools converge on this pattern |
| Cursor connector-probe.js gap may cause regression | Low | Fix by adding Cursor to KNOWN_CLI_AUTHORITY_FLAGS alongside new entries |

### Design Decision: Follow Proven Cursor Connector Pattern (DEC-001)

Both Windsurf and OpenCode connectors follow the exact pattern established by the Cursor connector (run_10a2b2d8f0a8399b):
1. Detection function in claude-local-auth.js (`isXxxLocalCliRuntime`)
2. Command validation in local-cli-adapter.js (`validateLocalCliCommandCompatibility`)
3. Authority flags in connector-probe.js (`KNOWN_CLI_AUTHORITY_FLAGS`)
4. Doctor special handling in doctor.js (`checkRuntimeReachable`)
5. Regression tests in a dedicated test file

This is deliberately formulaic. The pattern has been validated by QA twice (Cursor in run_f89a47c58f54929c with 474 tests, 0 failures).

### Design Decision: Windsurf Uses dispatch_bundle_only Transport (DEC-002)

Windsurf is an IDE (VS Code fork by Codeium). Like Cursor, it reads the turn bundle from disk rather than receiving prompts via stdin. The `dispatch_bundle_only` prompt transport matches the IDE execution model where the agent runs inside the editor and accesses `.agentxchain/staging/` directly.

### Design Decision: OpenCode Uses stdin Transport (DEC-003)

OpenCode is a terminal-based CLI tool. Like Claude Code, it receives prompts via stdin. The `stdin` prompt transport matches the CLI execution model where the orchestrator pipes the rendered PROMPT.md to the subprocess.

## Notes for Dev

**Your charter is 4 modified files + 2 new test files (6 total).**

See SYSTEM_SPEC.md for full technical details including:
- Exact detection function signatures
- Exact command validation rules and error messages
- Exact KNOWN_CLI_AUTHORITY_FLAGS entries
- Exact doctor.js insertion points
- Test case lists for both connector test files

## Notes for QA

- Verify windsurf-connector.test.js passes: `cd cli && npx vitest run test/windsurf-connector.test.js`
- Verify opencode-connector.test.js passes: `cd cli && npx vitest run test/opencode-connector.test.js`
- Verify cursor-connector.test.js still passes (no regressions)
- Verify KNOWN_CLI_AUTHORITY_FLAGS has entries for all 5 CLI connectors
- Run full test suite: `cd cli && npm test`
- After ship: verify ROADMAP.md:88, :89, and :91 can be checked off

## Acceptance Contract

1. **Vision goal addressed: connectors to local and cloud AI agents** — M7 connector ecosystem complete with 5 local CLI connectors (Claude, Codex, Cursor, Windsurf, OpenCode) + 4 cloud API providers (Anthropic, OpenAI, Google, Ollama) + MCP + remote_agent. The connector pillar from VISION.md:17 is substantively addressed.
2. **Evidence:** ROADMAP.md:88 (Windsurf), :89 (OpenCode), :91 (doctor acceptance) checked off after QA verification

## API Map

No new API routes. Changes are internal to the connector detection, validation, and diagnostic pipeline:

| Module | Change | Purpose |
|--------|--------|---------|
| `claude-local-auth.js` | +2 detection functions | Binary name matching for Windsurf + OpenCode |
| `local-cli-adapter.js` | +2 validation blocks + import updates | Command flag requirements for governed execution |
| `connector-probe.js` | +3 entries in KNOWN_CLI_AUTHORITY_FLAGS, +3 in KNOWN_CLI_TRANSPORTS | Connector probe coverage for Cursor + Windsurf + OpenCode |
| `doctor.js` | +2 detection branches + import updates | Doctor label annotation |
