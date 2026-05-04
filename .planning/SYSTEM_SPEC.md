# System Spec — M7: Connector Ecosystem Expansion — Per-Connector Governed Turn E2E Validation

**Run:** `run_f89a47c58f54929c`
**Baseline:** git:94803856c9814beae0d1021661e9bbf07037b551
**Package version:** `agentxchain@2.155.72`

## Purpose

Prove that each recognized `local_cli` connector flavor (Claude, Codex, Cursor) can complete a full governed turn end-to-end through the `connector validate` pipeline. Claude E2E already exists (AT-CCV-007). This spec charters Codex and Cursor E2E tests.

---

## 1. Architecture Overview

The `connector validate` pipeline (`connector-validate.js:32`) already implements the full governed turn lifecycle:

```
Config → scratch workspace → git init → governed run init → turn assign
→ dispatch bundle → adapter dispatch → staged result → turn-result-validator
```

Each new E2E test exercises this entire pipeline with a connector-specific shim binary:

```
┌────────────────────────────────────────────────────────────────┐
│  connector-validate.js:validateConfiguredConnector()            │
│                                                                 │
│  1. copyRepoForValidation()          ← scratch workspace        │
│  2. initializeScratchGit()           ← git init + baseline      │
│  3. getClaudeSubprocessAuthIssue()   ← returns null for non-    │
│     (claude-local-auth.js:167-169)     Claude runtimes          │
│  4. probeRuntimeSpawnContext()        ← shim binary must exist   │
│  5. initializeGovernedRun()          ← governed state            │
│  6. assignGovernedTurn()             ← turn assignment            │
│  7. writeDispatchBundle()            ← ASSIGNMENT.json + PROMPT  │
│  8. dispatchLocalCli()               ← spawns shim binary        │
│  9. validateStagedTurnResult()       ← schema + field checks     │
│                                                                 │
│  Result: { overall: 'pass', dispatch: { ok: true },             │
│            validation: { ok: true } }                           │
└────────────────────────────────────────────────────────────────┘
```

---

## 2. Integration Points

### 2.1 Existing Claude E2E — `connector-validate-command.test.js:318`

**Test ID:** AT-CCV-007
**Status:** Already passing.
**Pattern:** `writeClaudeShim()` creates `shim-bin/claude` → config uses `['claude', '--print', '--dangerously-skip-permissions']` with `prompt_transport: 'stdin'` → shim reads stdin, reads ASSIGNMENT.json, writes turn-result.json → `connector validate` returns `overall: 'pass'`.

**No changes needed.** This test proves Claude governed turn E2E.

### 2.2 Auth Preflight Bypass for Non-Claude Runtimes — `claude-local-auth.js:167-170`

`getClaudeSubprocessAuthIssue()` returns `null` immediately for non-Claude runtimes (line 168: `if (!isClaudeLocalCliRuntime(runtime)) return null`). This means Codex and Cursor shims do not need to worry about auth preflight — they skip it automatically.

### 2.3 Command Validation — `local-cli-adapter.js:760-850`

The shim configs must satisfy the existing command validation rules:

| Connector | Rule | Required tokens | Reference |
|-----------|------|----------------|-----------|
| Claude | `claude_print_stream_json_requires_verbose` | `--verbose` when `--print --output-format stream-json` | `local-cli-adapter.js:774` |
| Codex | `codex_requires_exec` + `codex_exec_requires_json` | `exec` + `--json` | `local-cli-adapter.js:794, 812` |
| Cursor | `cursor_requires_agent_mode` | `--background-agent` or `agent` | `local-cli-adapter.js:832` |

### 2.4 Connector Validate Pipeline — `connector-validate.js:32-416`

No changes required. The pipeline already supports all `local_cli` runtimes. The shim binary is spawned via `dispatchLocalCli()` at `connector-validate.js:588`.

### 2.5 Spawn Probe — `runtime-spawn-context.js`

`probeRuntimeSpawnContext()` verifies the binary exists and is executable. The shim binary must be:
1. Named after the connector (`codex` or `cursor`)
2. In the test's PATH
3. Executable (`chmod 0o755`)

---

## 3. Config Shapes

### Codex Runtime Config

```json
{
  "type": "local_cli",
  "command": ["codex", "exec", "--json"],
  "prompt_transport": "dispatch_bundle_only"
}
```

**Notes:**
- `codex_requires_exec` expects `exec` in tokens — satisfied
- `codex_exec_requires_json` expects `--json` — satisfied
- `dispatch_bundle_only` means the shim reads the dispatch bundle from disk, not stdin

### Cursor Runtime Config

```json
{
  "type": "local_cli",
  "command": ["cursor", "--background-agent"],
  "prompt_transport": "dispatch_bundle_only"
}
```

**Notes:**
- `cursor_requires_agent_mode` expects `--background-agent` or `agent` — satisfied
- `dispatch_bundle_only` matches Cursor's non-interactive dispatch model

---

## 4. Shim Binary Pattern

Each shim binary is a shell script that:

1. Reads `AGENTXCHAIN_TURN_ID` from the environment
2. Reads `.agentxchain/dispatch/turns/<turn_id>/ASSIGNMENT.json`
3. Writes a schema-valid `turn-result.json` to the staged result path from the assignment
4. Exits 0

The pattern is identical to `writeClaudeShim()` in `connector-validate-command.test.js:43-49`, adapted for each connector:

```bash
#!/bin/sh
node <<'NODE'
const fs = require('fs');
const path = require('path');
const turnId = process.env.AGENTXCHAIN_TURN_ID;
const assignmentPath = path.join(process.cwd(), '.agentxchain', 'dispatch', 'turns', turnId, 'ASSIGNMENT.json');
const assignment = JSON.parse(fs.readFileSync(assignmentPath, 'utf8'));
const stagingPath = path.join(process.cwd(), assignment.staging_result_path);
fs.mkdirSync(path.dirname(stagingPath), { recursive: true });
fs.writeFileSync(stagingPath, JSON.stringify({
  schema_version: '1.0',
  run_id: assignment.run_id,
  turn_id: assignment.turn_id,
  role: assignment.role,
  runtime_id: assignment.runtime_id,
  status: 'completed',
  summary: '<Connector> shim completed validation.',
  decisions: [],
  objections: [],
  files_changed: [],
  verification: { status: 'skipped', evidence_summary: 'shim validation' },
  artifact: { type: 'review', ref: null },
  proposed_next_role: 'human'
}, null, 2) + '\n');
NODE
exit 0
```

**Key:** The shim ignores argv (it doesn't need to parse `exec --json` or `--background-agent` — those tokens are only for command validation at adapter startup).

---

## 5. Files Changed (Expected)

| File | Change Type | Description |
|------|-------------|-------------|
| `cli/test/connector-validate-command.test.js` | Modify | Add `writeCodexShim()`, `writeCursorShim()` helpers; add Codex + Cursor E2E tests |
| `cli/test/vitest-contract.test.js` | Modify (only if new test file added) | Update file count from 667 to 668 |

**Alternative:** Dev may create a new `cli/test/connector-e2e-per-type.test.js` file instead of modifying `connector-validate-command.test.js`. Either approach is acceptable — PM does not prescribe file organization.

---

## 6. Test Plan

### Required Tests (minimum 2 new)

| # | Test ID | Connector | Description |
|---|---------|-----------|-------------|
| T1 | AT-CCV-009 | Codex | Codex shim binary `codex` → config `['codex', 'exec', '--json']` + `dispatch_bundle_only` → `connector validate` → `overall: 'pass'`, `dispatch.ok: true`, `validation.ok: true` |
| T2 | AT-CCV-010 | Cursor | Cursor shim binary `cursor` → config `['cursor', '--background-agent']` + `dispatch_bundle_only` → `connector validate` → `overall: 'pass'`, `dispatch.ok: true`, `validation.ok: true` |

### Existing Test (reference only — no changes)

| # | Test ID | Connector | Location |
|---|---------|-----------|----------|
| T0 | AT-CCV-007 | Claude | `connector-validate-command.test.js:318` |

### Assertion Checklist Per Test

Each new test must assert:
1. CLI exit code 0 (or programmatic `result.ok === true`)
2. `output.overall === 'pass'`
3. `output.schema_contract.ok === true`
4. `output.dispatch.ok === true`
5. `output.validation.ok === true`
6. `output.runtime_id` matches the connector runtime id
7. `output.role_id` matches the bound role

---

## 7. Key Architecture Invariants

1. **No pipeline changes.** `connector-validate.js` is untouched — new tests exercise existing code.
2. **Shim binary pattern is established.** `writeClaudeShim()` is the proven pattern; Codex/Cursor follow identically.
3. **Auth preflight skips non-Claude.** `getClaudeSubprocessAuthIssue()` returns `null` for Codex/Cursor (line 168-170).
4. **Command validation is already implemented.** Codex rules (lines 794-828) and Cursor rules (lines 831-848) are exercised by the E2E config.
5. **Dispatch bundle transport.** All three connectors use `dispatch_bundle_only` in their E2E configs — the shim reads from disk, not stdin.

---

## Dev Charter

### Scope

**2 new E2E tests required — Codex and Cursor governed turn validation.**

1. Write `writeCodexShim(root, contents)` helper — creates `shim-bin/codex` with chmod 0o755
2. Write `writeCursorShim(root, contents)` helper — creates `shim-bin/cursor` with chmod 0o755
3. Add Codex E2E test (AT-CCV-009): governed turn through `connector validate` → `overall: 'pass'`
4. Add Cursor E2E test (AT-CCV-010): governed turn through `connector validate` → `overall: 'pass'`
5. Update vitest contract file count if new test file is added

### Out of Scope

- Changes to `connector-validate.js` pipeline
- Changes to binary detection, command validation, doctor health checks
- Windsurf/OpenCode connectors
- `api_proxy`, `mcp`, `remote_agent` E2E
- Refactoring existing AT-CCV-007 (Claude) test

### Verification

Dev must confirm:
1. Codex E2E passes with `overall: 'pass'`
2. Cursor E2E passes with `overall: 'pass'`
3. Existing AT-CCV-007 (Claude) still passes
4. All existing `connector-validate-command.test.js` tests pass (no regression)
5. Vitest contract passes if file count changed

## Interface

### Connector E2E Validation Flow

```
Test Setup                      Shim Binary                    Connector Validate
──────────                      ───────────                    ──────────────────
scaffoldGoverned()              shim-bin/codex (0o755)         validateConfiguredConnector()
  + mutate config:              shim-bin/cursor (0o755)          ├── probeRuntimeSpawnContext()
    command: [codex, exec,      ┌───────────────────┐            │   → finds shim in PATH
      --json]                   │ 1. Read env        │           ├── initializeGovernedRun()
    command: [cursor,           │    TURN_ID         │           ├── assignGovernedTurn()
      --background-agent]       │ 2. Read            │           ├── writeDispatchBundle()
  + PATH includes               │    ASSIGNMENT.json │           ├── dispatchLocalCli()
    shim-bin/                   │ 3. Write valid     │           │   → spawns shim
                                │    turn-result.json│           ├── validateStagedTurnResult()
                                │ 4. exit 0          │           │   → schema + field checks
                                └───────────────────┘           └── return { overall: 'pass' }
```

### Function Signatures (existing, no changes)

| Function | File | Signature |
|----------|------|-----------|
| `validateConfiguredConnector` | `connector-validate.js:32` | `(sourceRoot, options) → Promise<{ ok, overall, dispatch, validation, ... }>` |
| `probeRuntimeSpawnContext` | `runtime-spawn-context.js` | `(root, runtime, options) → { ok, detail }` |
| `dispatchLocalCli` | `local-cli-adapter.js` | `(root, state, config, options) → Promise<{ ok, logs, ... }>` |
| `validateStagedTurnResult` | `turn-result-validator.js` | `(root, state, config, options) → { ok, stage, errors, warnings }` |

## Acceptance Tests

- [ ] Codex shim binary completes a governed turn through `connector validate` with `overall: 'pass'`
- [ ] Cursor shim binary completes a governed turn through `connector validate` with `overall: 'pass'`
- [ ] Claude E2E (AT-CCV-007) still passes (regression)
- [ ] All existing connector validate tests pass (regression)
- [ ] Vitest contract passes (file count updated if new file added)
- [ ] Full test suite passes with 0 failures (deferred to QA)
