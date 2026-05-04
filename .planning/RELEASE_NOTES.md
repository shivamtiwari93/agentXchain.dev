# Release Notes — M7: Windsurf & OpenCode Connector Expansion

## User Impact

This release completes the **M7 Connector Ecosystem Expansion** by adding **Windsurf IDE** and **OpenCode CLI** connectors to the agentxchain local_cli adapter stack. Operators can now configure governed runs that dispatch to Windsurf's agent mode or OpenCode's non-interactive mode, alongside existing Claude, Codex, and Cursor connectors. This closes ROADMAP.md:88-91 and substantively addresses the VISION.md:17 connector pillar.

### What Was Delivered

- **Windsurf IDE Connector**: Binary detection (`isWindsurfLocalCliRuntime`), command validation requiring `--agent` flag, probe registration with `dispatch_bundle_only` transport, doctor annotation as "Windsurf IDE local_cli connector". Config: `{ type: 'local_cli', command: ['windsurf', '--agent'], prompt_transport: 'dispatch_bundle_only' }`.

- **OpenCode CLI Connector**: Binary detection (`isOpenCodeLocalCliRuntime`), command validation requiring `--non-interactive` flag, probe registration with `stdin` transport, doctor annotation as "OpenCode local_cli connector". Config: `{ type: 'local_cli', command: ['opencode', '--non-interactive'], prompt_transport: 'stdin' }`.

- **Cursor Probe Gap Fix**: Added Cursor to `KNOWN_CLI_AUTHORITY_FLAGS` (authoritative flag: `--background-agent`) and `KNOWN_CLI_TRANSPORTS` (transport: `dispatch_bundle_only`), closing a gap from the original Cursor delivery.

- **28 Regression Tests**: 14 tests for Windsurf connector (binary detection, command validation, config roundtrip) and 14 tests for OpenCode connector (same structure). Both follow the proven `cursor-connector.test.js` pattern.

### Architecture Highlights

- **No new runtime types.** Windsurf and OpenCode use existing `local_cli` type. `VALID_RUNTIME_TYPES` unchanged.
- **No new modules.** All changes are additions to 4 existing files following the proven Cursor connector pattern.
- **No adapter dispatch changes.** `dispatchLocalCli()` handles all local_cli connectors generically. Only the detection/validation pipeline was extended.
- **Detection functions are pure.** Each `isXxxLocalCliRuntime()` normalizes tokens, lowercases the head, and returns a boolean. No I/O, no state.
- **Validation order is deterministic.** Claude → Codex → Cursor → Windsurf → OpenCode → ok. Detection functions make each block mutually exclusive.
- **Transport assignments match execution models.** IDE-based tools (Cursor, Windsurf) use `dispatch_bundle_only`. CLI-based tools (Claude, OpenCode) use `stdin`.

### Files Changed

| File | Change | LOC |
|------|--------|-----|
| `cli/src/lib/claude-local-auth.js` | Modified — 2 detection functions added | ~16 |
| `cli/src/lib/adapters/local-cli-adapter.js` | Modified — 2 validation rules + import updates | ~40 |
| `cli/src/lib/connector-probe.js` | Modified — 3 authority flags + 3 transports (incl. Cursor gap fix) | ~20 |
| `cli/src/commands/doctor.js` | Modified — 2 detection branches + import updates | ~15 |
| `cli/test/windsurf-connector.test.js` | New — 14 Windsurf connector tests | ~150 |
| `cli/test/opencode-connector.test.js` | New — 14 OpenCode connector tests | ~150 |
| `cli/test/vitest-contract.test.js` | Modified — file count 671 → 673 | 1 |

### Supported Connector Matrix (Post-Delivery)

| Connector | Binary | Authority Flag | Transport | Doctor Label |
|-----------|--------|---------------|-----------|--------------|
| Claude Code | `claude` | `--dangerously-skip-permissions` | stdin | (default) |
| OpenAI Codex | `codex` | `--dangerously-bypass-approvals-and-sandbox` | argv, stdin | (default) |
| Cursor IDE | `cursor` | `--background-agent` | dispatch_bundle_only | Cursor IDE local_cli connector |
| Windsurf IDE | `windsurf` | `--agent` | dispatch_bundle_only | Windsurf IDE local_cli connector |
| OpenCode CLI | `opencode` | `--non-interactive` | stdin | OpenCode local_cli connector |

### Known Limitations

- 12 pre-existing test failures in docs contracts, dashboard view registry, and E2E proposal/remote-agent tests remain from prior milestones. Unrelated to connector changes (verified: zero references to modified modules in failing files).

## Verification Summary

- 10/10 SYSTEM_SPEC acceptance tests pass (AT-CONN-001 through AT-CONN-010)
- 56 tests across 5 connector suites, 0 failures, 0 regressions
- Vitest contract: 11/11 pass (file count = 673)
- Code reviewed for pattern consistency, error contracts, import hygiene, and architecture invariants
