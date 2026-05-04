# PM Signoff — M7: Connector Ecosystem Expansion — Cursor IDE Connector

Approved: YES

**Run:** `run_10a2b2d8f0a8399b`
**Phase:** planning
**Turn:** `turn_7d29bbd18babb17b`
**Date:** 2026-05-04

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators who want to use Cursor IDE's background agent mode as a governed runtime — dispatching turns to Cursor the same way they dispatch to Claude or Codex, with full protocol governance, health checks, and connector validation.

### Core Pain Point

AgentXchain supports 5 runtime types (`manual`, `local_cli`, `api_proxy`, `mcp`, `remote_agent`), but among IDE-based agents, only Claude Code CLI and Codex are recognized as `local_cli` flavors. The adapter has Claude-specific validation (`isClaudeLocalCliRuntime`, `claude_print_stream_json_requires_verbose`) and Codex-specific validation (`isCodexLocalCliRuntime`, `codex_requires_exec`, `codex_exec_requires_json`), but no equivalent for Cursor.

Users who configure `cursor` as a `local_cli` runtime today get no flavor-specific guidance from `doctor`, no command compatibility validation, no auth check, and a confusing `unknown runtime binary` default in health probes.

### Design Decision: local_cli Variant, Not New Runtime Type

The ROADMAP item says "local_cli adapter variant" and that is the correct approach:

1. **No new runtime type.** Cursor uses `type: 'local_cli'` like Claude and Codex.
2. **Binary detection** via `isCursorLocalCliRuntime()` following the `isClaudeLocalCliRuntime`/`isCodexLocalCliRuntime` pattern in `claude-local-auth.js:32-48`.
3. **Command validation** rules added to `validateLocalCliCommandCompatibility()` in `local-cli-adapter.js:759-831`.
4. **Doctor health check** enhanced in `doctor.js:502-514` to produce Cursor-specific messages.
5. **Prompt transport** defaults to `dispatch_bundle_only` — Cursor's agent mode reads the staged dispatch bundle from `.agentxchain/dispatch/turns/<id>/PROMPT.md`.

### Evidence of Existing Patterns

| Pattern | Claude | Codex | Cursor (to add) |
|---|---|---|---|
| Binary detection | `isClaudeLocalCliRuntime()` (`claude-local-auth.js:32`) | `isCodexLocalCliRuntime()` (`claude-local-auth.js:41`) | `isCursorLocalCliRuntime()` |
| Command validation | `claude_print_stream_json_requires_verbose` (`local-cli-adapter.js:773`) | `codex_requires_exec` + `codex_exec_requires_json` (`local-cli-adapter.js:793, 811`) | TBD by dev |
| Auth check | `getClaudeSubprocessAuthIssue()` (`doctor.js:505`) | (none — Codex uses OPENAI_API_KEY) | Cursor API key check if applicable |
| Doctor detail | Claude-specific auth warning (`doctor.js:506-511`) | (falls through to generic probe) | Cursor-specific detail message |

### Legacy Context

A legacy v3 adapter exists at `cli/src/adapters/cursor-local.js` that opened Cursor windows, copied prompts to clipboard, and relied on human interaction. This is NOT the target pattern. The M7 connector uses the governed `local_cli` adapter with Cursor as a headless/background-agent CLI, following the same subprocess lifecycle (spawn → watchdog → staged result) as Claude and Codex.

## Challenge to Previous Turn

### OBJ-PM-001: Previous planning artifacts describe M6 Dashboard Live Observer, not M7 Connector Expansion (severity: high)

PM_SIGNOFF.md, SYSTEM_SPEC.md, and ROADMAP.md Phases table all describe M6: Dashboard Live Observer from `run_74fc370a40da7622`. This run's intent is M7: Connector Ecosystem Expansion — Add Cursor IDE connector. All three artifacts rewritten from scratch.

### OBJ-PM-002: Dev correctly identified that PM should not charter verification-only implementation turns (severity: medium)

In the M6 run, dev's OBJ-001 stated "PM DEC-003 stated 'Dev charter is verification-only: no code changes expected' — this contradicts the implementation-phase product code gate at turn-result-validator.js:733." This is a valid pattern correction. M7 charters real code changes for dev.

### Core Workflow (this run)

1. **PM (this turn)** — Scope Cursor IDE connector as local_cli variant, write planning artifacts with line-number references and acceptance criteria
2. **Dev** — Implement `isCursorLocalCliRuntime()`, Cursor command validation rules, doctor health check, connector-validate support, and tests
3. **QA** — Run full test suite, verify acceptance contract, confirm `agentxchain doctor` passes for a Cursor-configured runtime

### MVP Scope (this run)

**This run scopes only ROADMAP.md:87 — "Add Cursor IDE connector (local_cli adapter variant)".** The other M7 items (Windsurf, OpenCode, per-connector E2E, acceptance) are separate runs.

**PM deliverables (this turn):**
1. PM_SIGNOFF.md: Scope definition, design decision, acceptance criteria
2. SYSTEM_SPEC.md: Technical spec with exact file:line integration points, config shape, test plan
3. ROADMAP.md: Phases table updated for M7 Cursor connector scope

**Dev deliverables:**
1. `isCursorLocalCliRuntime()` in `claude-local-auth.js` (or new file — dev's call on organization)
2. Cursor command validation rules in `validateLocalCliCommandCompatibility()` in `local-cli-adapter.js`
3. Cursor-specific doctor health check detail in `doctor.js`
4. Config example for Cursor runtime in agentxchain.json template
5. Unit tests: binary detection, command validation, doctor health check (minimum 4 tests)

### Out of Scope

- Windsurf connector (separate M7 run)
- OpenCode connector (separate M7 run)
- New runtime type (Cursor reuses `local_cli`)
- Changes to local-cli-adapter.js subprocess lifecycle (spawn, watchdog, staged result)
- Changes to step.js dispatcher (Cursor uses existing `local_cli` branch at line 732)
- Legacy v3 cursor-local.js changes (deprecated, not part of governed protocol)
- Cursor-specific auth failure classification (deferred — add only if Cursor has identifiable auth failure output patterns)
- Full E2E governed turn validation with live Cursor process (deferred to acceptance item)

### Success Metric

| # | Acceptance Item | Verified By |
|---|----------------|-------------|
| 1 | Roadmap milestone addressed: M7: Connector Ecosystem Expansion | ROADMAP.md:87 scoped and planning artifacts written |
| 2 | Unchecked roadmap item completed: Add Cursor IDE connector (local_cli adapter variant) | `isCursorLocalCliRuntime()` + command validation + doctor health check + tests pass |
| 3 | Evidence source: .planning/ROADMAP.md:87 | ROADMAP.md:87 checked off after QA verification |

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Cursor CLI may not have a stable headless agent mode | Medium | Connector is configured via `command` array — users can adapt CLI args as Cursor evolves; `dispatch_bundle_only` transport is CLI-agnostic |
| Cursor may not have identifiable auth failure patterns in stderr | Low | Auth classification deferred; generic `local_cli` exit code handling covers non-zero exits |
| Binary name collision (cursor vs other tools) | Low | `isCursorLocalCliRuntime()` checks first token only, matching Claude/Codex pattern |

## Notes for Dev

**Your charter requires real code changes — this is NOT a verification-only run.**

Integration points (verify these line numbers before coding):
1. `claude-local-auth.js:32-48` — Add `isCursorLocalCliRuntime()` following `isClaudeLocalCliRuntime`/`isCodexLocalCliRuntime` pattern
2. `local-cli-adapter.js:759-831` — Add Cursor command validation rule(s) in `validateLocalCliCommandCompatibility()`
3. `local-cli-adapter.js:33-41` — Add import for `isCursorLocalCliRuntime` from `claude-local-auth.js`
4. `doctor.js:502-514` — Add Cursor-specific detail in `local_cli` case of `checkRuntimeReachable()`
5. `connector-validate.js:29` — Confirm Cursor runtimes are validatable (already covered by `local_cli` in VALIDATABLE_RUNTIME_TYPES)
6. `normalized-config.js:34` — No change needed (Cursor uses existing `local_cli` type)

Example agentxchain.json config for Cursor runtime:
```json
{
  "runtimes": {
    "cursor-agent": {
      "type": "local_cli",
      "command": ["cursor", "--background-agent"],
      "prompt_transport": "dispatch_bundle_only",
      "startup_watchdog_ms": 300000
    }
  }
}
```

**Minimum 4 tests required:**
1. `isCursorLocalCliRuntime()` returns true for `cursor` command, false for `claude`/`codex`
2. `validateLocalCliCommandCompatibility()` enforces Cursor-specific rules
3. `checkRuntimeReachable()` returns Cursor-specific detail for cursor runtimes
4. Cursor runtime config passes `normalizeConfig()` validation as `local_cli`

## Notes for QA

- Run full test suite: `cd cli && npm test`
- Verify new tests pass for Cursor binary detection, command validation, doctor check
- Verify `agentxchain doctor` produces Cursor-specific output for a Cursor-configured runtime
- Confirm no regressions in Claude/Codex local_cli paths
- After ship: verify ROADMAP.md:87 can be checked off

## Acceptance Contract

1. **Roadmap milestone addressed: M7: Connector Ecosystem Expansion** — ROADMAP.md:87 "Add Cursor IDE connector" scoped with planning artifacts, dev implements, QA verifies
2. **Unchecked roadmap item completed: Add Cursor IDE connector (local_cli adapter variant)** — `isCursorLocalCliRuntime()` detects Cursor binary; command validation enforces Cursor rules; `agentxchain doctor` reports Cursor-specific health; tests pass
3. **Evidence source: .planning/ROADMAP.md:87** — ROADMAP.md:87 checked off after QA full suite verification
