# System Spec — M7: Connector Ecosystem Expansion — Doctor Health Check Per Connector Type

**Run:** `run_3da0168fc830ad47`
**Baseline:** git:5448b7882
**Package version:** `agentxchain@2.155.72`

## Purpose

Prove that `agentxchain doctor` passes for each recognized `local_cli` connector type (Claude, Codex, Cursor) with explicit connector-specific recognition. Currently Codex has no doctor recognition and no doctor E2E tests exist for Codex or Cursor.

---

## 1. Architecture Overview

The `governedDoctor()` function (`doctor.js:62`) iterates over all runtimes in the project config (`doctor.js:95-98`) and calls `checkRuntimeReachable()` for each. For `local_cli` runtimes, the function:

1. Probes binary existence via `probeRuntimeSpawnContext()` (`doctor.js:503`)
2. Checks for Cursor → returns early with Cursor annotation (`doctor.js:505-510`)
3. Falls through to Claude auth probe (`doctor.js:512-519`)
4. Returns generic pass/fail based on probe result (`doctor.js:521`)

**The gap:** There is no Codex recognition branch between Cursor (line 505) and Claude auth (line 512). Codex runtimes silently pass through the Claude auth check, which returns `null` (benign), then get a generic pass detail without connector identification.

```
Current flow:                         Target flow:
                                      
probe.ok?                             probe.ok?
  ├── isCursor? → pass (annotated)      ├── isCursor? → pass (annotated)
  ├── Claude auth → warn/pass            ├── isCodex?  → pass (annotated)  ← NEW
  └── generic pass/fail                  ├── Claude auth → warn/pass
                                         └── generic pass/fail
```

---

## 2. Code Changes

### 2.1 Import Addition — `doctor.js:24`

**Current:**
```javascript
import { getClaudeSubprocessAuthIssue, isCursorLocalCliRuntime } from '../lib/claude-local-auth.js';
```

**Target:**
```javascript
import { getClaudeSubprocessAuthIssue, isCodexLocalCliRuntime, isCursorLocalCliRuntime } from '../lib/claude-local-auth.js';
```

### 2.2 Codex Recognition Branch — `doctor.js:510` (insert after Cursor block)

Insert a new `isCodexLocalCliRuntime(rt)` check between the Cursor check (line 510) and the Claude auth check (line 512):

```javascript
if (isCodexLocalCliRuntime(rt)) {
  return attachRuntimeContract({
    ...base,
    level: 'pass',
    detail: `${probe.detail} (Codex local_cli connector)`,
  }, rtId, rt, boundRoleEntries);
}
```

This mirrors the Cursor pattern exactly:
- Early return prevents falling into Claude auth probe
- Annotation identifies the connector type in JSON output
- `attachRuntimeContract()` preserves capability contract surface

### 2.3 No Other Source Changes

No changes to:
- `claude-local-auth.js` — `isCodexLocalCliRuntime()` already exists at line 41
- `connector-validate.js` — pipeline untouched
- `local-cli-adapter.js` — command validation untouched
- `runtime-spawn-context.js` — binary probe untouched

---

## 3. Integration Points

### 3.1 Existing Detection Functions — `claude-local-auth.js:32-57`

| Function | Line | Detection Rule |
|----------|------|---------------|
| `isClaudeLocalCliRuntime()` | 32 | command[0] is `claude` or ends with `/claude` |
| `isCodexLocalCliRuntime()` | 41 | command[0] is `codex` or ends with `/codex` |
| `isCursorLocalCliRuntime()` | 50 | command[0] is `cursor` or ends with `/cursor` |

All three use `normalizeCommandTokens()` (line 20) for consistent token extraction.

### 3.2 Runtime Spawn Probe — `runtime-spawn-context.js`

`probeRuntimeSpawnContext(root, rt, { runtimeId })` checks binary existence and executability. In tests, the mock binary (`test-support/mock-agent.mjs`) satisfies the probe — the connector-specific command tokens are only used for `isCodexLocalCliRuntime()` / `isCursorLocalCliRuntime()` detection, not for actual binary lookup.

**Test implication:** The `makeGoverned()` helper in `governed-doctor-e2e.test.js:23` sets up mock runtimes with `process.execPath` as the command. For connector-specific tests, dev must override the runtime config to use connector-appropriate command tokens while keeping the mock binary resolvable.

### 3.3 Doctor JSON Output — `doctor.js:382-416`

The `--json` flag produces structured output:
```javascript
const result = { ok: failCount === 0, overall, checks, ... };
console.log(JSON.stringify(result, null, 2));
```

Each runtime check in `checks[]` has:
- `id`: `runtime_<runtimeId>`
- `name`: `Runtime: <runtimeId>`
- `level`: `pass` / `warn` / `fail`
- `detail`: string (where connector annotation appears)

Tests assert against `check.detail` containing the connector annotation string.

### 3.4 Auth Bypass for Non-Claude Runtimes — `claude-local-auth.js:167-170`

```javascript
export async function getClaudeSubprocessAuthIssue(runtime) {
  if (!isClaudeLocalCliRuntime(runtime)) return null;
  ...
}
```

Even without the new Codex branch, Codex already returns `null` here. The Codex branch adds explicit recognition + annotation and prevents the unnecessary function call.

---

## 4. Test Plan

### 4.1 New Tests — `governed-doctor-e2e.test.js`

All 3 tests go in the existing `describe('Governed Doctor E2E')` block (line 179).

| # | Test ID | Connector | Description |
|---|---------|-----------|-------------|
| T1 | AT-GD-CODEX-001 | Codex | Codex runtime config → doctor JSON has `level: 'pass'` + detail contains `Codex local_cli connector` |
| T2 | AT-GD-CURSOR-001 | Cursor | Cursor runtime config → doctor JSON has `level: 'pass'` + detail contains `Cursor IDE local_cli connector` |
| T3 | AT-GD-CLAUDE-REGR | Claude | Claude runtime config → doctor JSON has runtime check (regression guard for auth probe path) |

### 4.2 Test Config Shapes

Each test scaffolds a governed project via `makeGoverned()`, then mutates the runtime config:

**Codex runtime:**
```json
{
  "type": "local_cli",
  "command": ["<path-to-mock-agent>", "exec", "--json"],
  "prompt_transport": "dispatch_bundle_only"
}
```

**Key:** The command must start with a binary that satisfies both:
1. `probeRuntimeSpawnContext()` — binary must exist and be executable
2. `isCodexLocalCliRuntime()` — command[0] must be `codex` or end in `/codex`

**Resolution:** Create a symlink or copy of the mock agent named `codex` in a temp `shim-bin/` directory, prepend to `PATH`. Alternatively, use `process.execPath` for the probe but override the runtime's `command` to use a connector-prefixed path. Dev decides the exact approach — the pattern from `connector-validate-command.test.js` (shim binaries) is the established precedent.

**Cursor runtime:** Same pattern with `cursor` binary name and `['cursor', '--background-agent']` command.

**Claude runtime:** The existing `makeGoverned()` config uses `process.execPath` which is NOT detected as Claude. Dev must set command to a Claude-like path for the regression test.

### 4.3 Assertion Checklist Per Test

Each test must verify:
1. Doctor exit code 0
2. JSON output `ok: true`
3. JSON output `overall: 'pass'` (or `'warn'` — both are exit 0)
4. Runtime check `level: 'pass'`
5. Runtime check `detail` contains the connector-specific annotation string

| Test | Expected annotation substring |
|------|------------------------------|
| AT-GD-CODEX-001 | `Codex local_cli connector` |
| AT-GD-CURSOR-001 | `Cursor IDE local_cli connector` |
| AT-GD-CLAUDE-REGR | (no specific annotation — Claude uses auth probe detail) |

---

## 5. Files Changed (Expected)

| File | Change Type | Description |
|------|-------------|-------------|
| `cli/src/commands/doctor.js` | Modify | Add `isCodexLocalCliRuntime` import (line 24) + Codex recognition branch (after line 510) |
| `cli/test/governed-doctor-e2e.test.js` | Modify | Add 3 connector-specific doctor E2E tests |

No new files expected. No vitest contract file count change.

---

## 6. Key Architecture Invariants

1. **Doctor recognition order: Cursor → Codex → Claude auth → generic.** This ensures each recognized connector type gets its annotation before falling into the Claude auth probe path.
2. **No source changes to `claude-local-auth.js`.** All detection functions already exist and are exported.
3. **Mock binary pattern.** Tests use the existing `mock-agent.mjs` or shim binaries — no real CLI binaries needed.
4. **Doctor pass criteria unchanged.** Exit 0 when no `fail` level checks; `warn` level is acceptable.

---

## Dev Charter

### Scope

**2 doctor.js code changes + 3 new tests.**

1. Import `isCodexLocalCliRuntime` from `claude-local-auth.js` (line 24)
2. Add Codex recognition branch in `checkRuntimeReachable()` after Cursor check (line 510)
3. Add AT-GD-CODEX-001: Codex doctor passes with annotation
4. Add AT-GD-CURSOR-001: Cursor doctor passes with annotation
5. Add AT-GD-CLAUDE-REGR: Claude doctor regression guard

### Out of Scope

- Codex auth probe (OPENAI_API_KEY validation in doctor)
- Windsurf/OpenCode connector recognition
- Changes to `connector-validate.js` pipeline
- Changes to `claude-local-auth.js`

### Verification

Dev must confirm:
1. AT-GD-CODEX-001 passes with `detail` containing `Codex local_cli connector`
2. AT-GD-CURSOR-001 passes with `detail` containing `Cursor IDE local_cli connector`
3. AT-GD-CLAUDE-REGR passes (no regression in Claude auth path)
4. All existing `governed-doctor-e2e.test.js` tests pass (no regression)
5. Vitest contract passes

## Interface

### Doctor Connector Recognition Flow (after change)

```
checkRuntimeReachable(root, rtId, rt, boundRoleEntries)
│
├── rt.type !== 'local_cli' → other handlers
│
└── rt.type === 'local_cli'
    │
    ├── probe = probeRuntimeSpawnContext()
    │
    ├── probe.ok === false → { level: 'fail', detail: probe.detail }
    │
    ├── isCursorLocalCliRuntime(rt)?
    │   └── YES → { level: 'pass', detail: '... (Cursor IDE local_cli connector)' }
    │
    ├── isCodexLocalCliRuntime(rt)?           ← NEW
    │   └── YES → { level: 'pass', detail: '... (Codex local_cli connector)' }
    │
    ├── getClaudeSubprocessAuthIssue(rt)?
    │   └── issue → { level: 'warn', detail: '... auth issue ...' }
    │
    └── default → { level: 'pass', detail: probe.detail }
```

### Function Signatures (existing, no changes)

| Function | File:Line | Signature |
|----------|-----------|-----------|
| `checkRuntimeReachable` | `doctor.js:491` | `(root, rtId, rt, boundRoleEntries) → Promise<check>` |
| `isCodexLocalCliRuntime` | `claude-local-auth.js:41` | `(runtime) → boolean` |
| `isCursorLocalCliRuntime` | `claude-local-auth.js:50` | `(runtime) → boolean` |
| `isClaudeLocalCliRuntime` | `claude-local-auth.js:32` | `(runtime) → boolean` |
| `probeRuntimeSpawnContext` | `runtime-spawn-context.js` | `(root, rt, options) → { ok, detail }` |
| `getClaudeSubprocessAuthIssue` | `claude-local-auth.js:167` | `(runtime) → Promise<null \| { detail, fix }>` |

## Acceptance Tests

- [ ] Codex runtime → `agentxchain doctor --json` passes with `detail` containing `Codex local_cli connector`
- [ ] Cursor runtime → `agentxchain doctor --json` passes with `detail` containing `Cursor IDE local_cli connector`
- [ ] Claude runtime → `agentxchain doctor --json` passes without regression in auth probe path
- [ ] All existing `governed-doctor-e2e.test.js` tests pass (no regression)
- [ ] Vitest contract passes
- [ ] Full test suite passes with 0 failures in connector-related tests (deferred to QA)
