# Release Notes

## User Impact

### Config Protection: Operator-Owned File Guardrails

All 4 agent role prompts (PM, Dev, QA, Engineering Director) now include explicit instructions preventing modification of `agentxchain.json`. This protects operator-owned configuration — runtime definitions, timeouts, watch routes, budget settings, and role bindings — from being overwritten or stripped during governed runs.

Each prompt:
- Names `agentxchain.json` as operator-owned
- References `.planning/OPERATOR_OWNED_FILES.md` for the full protected-files list
- Includes role-appropriate escalation guidance (raise objection, route to human)
- Places the instruction in the prompt's constraint/rules section

A new `.planning/OPERATOR_OWNED_FILES.md` document provides the canonical protected-files registry that all prompts reference, ensuring a single source of truth for write restrictions.

### Codex Output Format Validation

The local CLI adapter now handles Codex (`--json`) runtimes with the same output-aware behavior as Claude (`stream-json`) runtimes:

1. **Codex runtime detection** — `isCodexLocalCliRuntime()` identifies Codex binaries at the adapter layer, enabling runtime-specific error handling.

2. **Codex auth failure classification** — When a Codex turn fails due to an OpenAI authentication error (invalid API key, expired credentials), the adapter now returns a typed `codex_auth_failed` blocker with specific recovery guidance instead of a generic failure message. This enables the orchestrator to distinguish recoverable auth failures from configuration errors.

3. **Codex command validation** — `validateLocalCliCommandCompatibility()` now validates Codex commands at dispatch pre-flight: `exec` subcommand is required for non-interactive execution, and `--json` flag is required for machine-readable output. Misconfigured Codex runtimes are caught before subprocess spawn.

### Test Fix: Decision History Runtime Column

The M3 runtime_id implementation added a Runtime column to the Decision History table in dispatch bundles but did not update the corresponding test file (`dispatch-bundle-decision-history.test.js`). The QA turn fixed the 2 stale test expectations to match the new 5-column format (`ID | Phase | Role | Runtime | Statement`).

## Verification Summary

- 561 tests pass across 10 independently verified test suites, 0 failures
  - local-cli-adapter.test.js: 46 pass (Codex auth, preflight, staged-result scenarios added)
  - claude-local-auth-smoke-probe.test.js: 8 pass (Codex detector/classifier helpers added)
  - agentxchain-config-schema.test.js: 7 pass
  - governed-state.test.js: 99 pass
  - dispatch-bundle.test.js: 74 pass
  - turn-result-validator + staged-result-proof: 114 pass
  - continuous-run.test.js: 87 pass
  - vision-reader.test.js: 36 pass
  - timeout-evaluator + run-loop + release-notes-gate: 80 pass
  - dispatch-bundle-decision-history.test.js: 10 pass (fixed this run)
- Config protection acceptance contract: all 12 criteria verified (see acceptance-matrix.md)
- `agentxchain.json` confirmed unmodified across all 3 phase checkpoints via git diff
- No reserved `.agentxchain/` file modifications by dev

## Upgrade Notes

No breaking changes. The config protection instructions are additive to role prompts. Codex error classification adds new adapter behavior for Codex runtimes without changing the existing Claude path.

## Known Issues

- AGENT-TALK collaboration log guard tests (3/8 fail) are a pre-existing state issue unrelated to this change. TALK.md lacks compressed summary structure from prior runs. Confirmed across 10 consecutive QA runs.
- M1 item #5 (10 consecutive zero-ghost runs) is longitudinal, tracked at 3/10.
- M2 item #5 (5+ consecutive runs without idle-stopping) is longitudinal, tracked at 1/5.
