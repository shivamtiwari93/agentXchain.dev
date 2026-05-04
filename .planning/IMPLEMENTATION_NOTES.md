# Implementation Notes — M7: Per-Connector Governed Turn E2E Validation

**Run:** `run_f89a47c58f54929c`
**Turn:** `turn_548c173db537029e`
**Role:** dev
**Date:** 2026-05-04

## What Was Built

Added Codex and Cursor governed turn E2E tests to `connector-validate-command.test.js`, completing per-connector E2E coverage for all three `local_cli` connector flavors.

### Changes

**`cli/test/connector-validate-command.test.js`** — 2 new shim helpers + 2 new E2E tests:

1. `writeCodexShim(root, contents)` — creates `shim-bin/codex` with chmod 0o755
2. `writeCursorShim(root, contents)` — creates `shim-bin/cursor` with chmod 0o755
3. **AT-CCV-009** — Codex governed turn E2E: config `['codex', 'exec', '--json']` + `dispatch_bundle_only` → shim reads `ASSIGNMENT.json`, writes `turn-result.json` → `connector validate` returns `overall: 'pass'`
4. **AT-CCV-010** — Cursor governed turn E2E: config `['cursor', '--background-agent']` + `dispatch_bundle_only` → shim reads `ASSIGNMENT.json`, writes `turn-result.json` → `connector validate` returns `overall: 'pass'`

### Design Decisions

- Added tests to existing `connector-validate-command.test.js` rather than creating a new file — keeps all connector validate E2E tests in one place and avoids vitest contract file count update.
- Codex/Cursor shims are simpler than the Claude shim (AT-CCV-007) — no stdin handling needed since both use `dispatch_bundle_only` transport, and no auth smoke probe handling since `getClaudeSubprocessAuthIssue()` returns `null` for non-Claude runtimes.
- Both shims handle the spawn probe gracefully by exiting cleanly when `AGENTXCHAIN_TURN_ID` is empty.

### PM Charter Challenge

- PM DEC-002 (dev scope is 2 new E2E tests, no pipeline code changes): **Confirmed correct.** Pipeline already supports all `local_cli` runtimes.
- PM DEC-003 (ROADMAP.md:87 check-off in QA): **Agreed.** Cursor E2E (AT-CCV-010) now provides the validation evidence for check-off.

## Verification

| Test File | Tests | Result |
|-----------|-------|--------|
| `connector-validate-command.test.js` | 12 | All pass |
| `connector-validate.test.js` | (included in broader run) | Pass |
| `connector-probe.test.js` | (included in broader run) | Pass |
| `local-cli-adapter.test.js` | (included in broader run) | Pass |
| `cursor-connector.test.js` | 14 | All pass |
| `vitest-contract.test.js` | 11 | All pass |

Full suite deferred to QA.
