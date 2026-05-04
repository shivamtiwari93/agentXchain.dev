# System Spec — M7: Connector Ecosystem Expansion — Cursor IDE Connector

**Run:** `run_10a2b2d8f0a8399b`
**Baseline:** git:a24a39639c3fc1d2209911f1d457271279d5011d
**Package version:** `agentxchain@2.155.72`

## Purpose

Add Cursor IDE as a recognized `local_cli` adapter flavor, following the established Claude/Codex binary detection, command validation, and doctor health check patterns. No new runtime type — Cursor reuses the existing `local_cli` adapter and subprocess lifecycle.

---

## 1. Architecture Overview

Cursor IDE joins Claude and Codex as a recognized `local_cli` binary flavor. The adapter already supports arbitrary local CLI binaries — this change adds Cursor-specific:
- Binary detection (like Claude/Codex)
- Command compatibility validation (like Claude's `--verbose` rule, Codex's `exec` rule)
- Doctor health check messages
- Config documentation

```
┌─────────────────────────────────────────────────────────────┐
│                   local_cli Adapter                          │
│                   (local-cli-adapter.js)                     │
│                                                              │
│  Binary Detection:                                           │
│    isClaudeLocalCliRuntime()  ← claude-local-auth.js:32      │
│    isCodexLocalCliRuntime()   ← claude-local-auth.js:41      │
│    isCursorLocalCliRuntime()  ← NEW (claude-local-auth.js)   │
│                                                              │
│  Command Validation:                                         │
│    validateLocalCliCommandCompatibility()                     │
│      ├── claude: --print --stream-json requires --verbose    │
│      ├── codex: requires exec + --json                       │
│      └── cursor: TBD rules (NEW)                             │
│                                                              │
│  Subprocess Lifecycle (shared, no changes):                  │
│    spawn → startup watchdog → heartbeat → staged result      │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Integration Points

### 2.1 Binary Detection — `claude-local-auth.js`

**Location:** `cli/src/lib/claude-local-auth.js:32-48`

**Current state:** Exports `isClaudeLocalCliRuntime(runtime)` (line 32) and `isCodexLocalCliRuntime(runtime)` (line 41). Both check if the first command token matches the binary name.

**Change:** Add `isCursorLocalCliRuntime(runtime)` at line 49, following the identical pattern:

```javascript
export function isCursorLocalCliRuntime(runtime) {
  const tokens = normalizeCommandTokens(runtime);
  if (tokens.length === 0) return false;
  const head = tokens[0].toLowerCase();
  return head === 'cursor' || head.endsWith('/cursor');
}
```

**Export:** The function must be exported (it already will be via `export function`).

### 2.2 Adapter Import — `local-cli-adapter.js`

**Location:** `cli/src/lib/adapters/local-cli-adapter.js:33-41`

**Current state:** Imports `isClaudeLocalCliRuntime`, `isCodexLocalCliRuntime`, and related functions from `claude-local-auth.js`.

**Change:** Add `isCursorLocalCliRuntime` to the import statement at line 38.

### 2.3 Command Validation — `local-cli-adapter.js`

**Location:** `cli/src/lib/adapters/local-cli-adapter.js:759-831`

**Current state:** `validateLocalCliCommandCompatibility()` checks:
- Claude: `--print --output-format stream-json` requires `--verbose` (line 773)
- Codex: requires `exec` subcommand (line 793)
- Codex: `exec` requires `--json` (line 811)

**Change:** Add Cursor-specific validation after the Codex rules (after line 828). Minimum rule:

```javascript
const usesCursor = isCursorLocalCliRuntime(runtimeShape);
if (usesCursor && !tokens.includes('--background-agent') && !tokens.includes('agent')) {
  const runtimeLabel = runtimeId ? `Runtime "${runtimeId}"` : 'Cursor local_cli runtime';
  const recovery = `${runtimeLabel} uses "cursor" without a background agent flag. Governed local runs require Cursor's agent or background-agent mode for non-interactive execution.`;
  return {
    ok: false,
    error_class: 'local_cli_command_incompatible',
    recovery,
    error: recovery,
    diagnostic: {
      runtime_id: runtimeId,
      binary: binaryName,
      rule: 'cursor_requires_agent_mode',
      recovery,
    },
  };
}
```

**Dev discretion:** The exact flag name (`--background-agent`, `agent`, etc.) should be verified against Cursor's actual CLI. If Cursor's headless interface is not yet stable, the validation can be relaxed to a warning or deferred (document the decision).

### 2.4 Doctor Health Check — `doctor.js`

**Location:** `cli/src/commands/doctor.js:502-514`

**Current state:** The `local_cli` case in `checkRuntimeReachable()` probes the binary spawn context and then checks Claude-specific auth (`getClaudeSubprocessAuthIssue`).

**Change:** After the Claude auth check (line 513), add a Cursor-specific detail path:

```javascript
// After existing Claude auth check block (line 513):
if (probe.ok && isCursorLocalCliRuntime(rt)) {
  return attachRuntimeContract({
    ...base,
    level: 'pass',
    detail: `${probe.detail} (Cursor IDE local_cli connector)`,
  }, rtId, rt, boundRoleEntries);
}
```

**Import:** Add `isCursorLocalCliRuntime` to doctor.js imports (from `claude-local-auth.js` or `adapter-interface.js` if re-exported).

### 2.5 Config Validation — `normalized-config.js`

**Location:** `cli/src/lib/normalized-config.js:34, 445-462`

**No changes required.** Cursor uses `type: 'local_cli'`, which is already in `VALID_RUNTIME_TYPES` (line 34). The existing `local_cli` validation (startup_watchdog_ms, startup_heartbeat_ms, prompt_transport) all apply to Cursor.

### 2.6 Connector Validation — `connector-validate.js`

**Location:** `cli/src/lib/connector-validate.js:29`

**No changes required.** `VALIDATABLE_RUNTIME_TYPES` already includes `local_cli`. Cursor runtimes configured as `local_cli` are automatically validatable via `agentxchain connector validate <runtime-id>`.

### 2.7 Step Dispatcher — `step.js`

**Location:** `cli/src/commands/step.js:732`

**No changes required.** Cursor uses the existing `local_cli` dispatch path at line 732. The `dispatchLocalCli()` function handles arbitrary local CLI binaries.

---

## 3. Config Shape

Example `agentxchain.json` runtime configuration for Cursor:

```json
{
  "runtimes": {
    "cursor-agent": {
      "type": "local_cli",
      "command": ["cursor", "--background-agent"],
      "prompt_transport": "dispatch_bundle_only",
      "startup_watchdog_ms": 300000
    }
  },
  "roles": {
    "dev": {
      "runtime": "cursor-agent"
    }
  }
}
```

**Key config decisions:**

| Field | Value | Rationale |
|-------|-------|-----------|
| `type` | `"local_cli"` | Cursor is a local_cli variant, not a new type |
| `command` | `["cursor", "--background-agent"]` | Cursor's headless agent mode (flag name subject to Cursor CLI evolution) |
| `prompt_transport` | `"dispatch_bundle_only"` | Cursor reads the staged dispatch bundle from disk; prompt is not injected via argv/stdin |
| `startup_watchdog_ms` | `300000` (5 min) | Cursor IDE startup may be slower than Claude CLI; 5 min default matches IDE cold-start |

---

## 4. Files Changed (Expected)

| File | Change Type | Description |
|------|-------------|-------------|
| `cli/src/lib/claude-local-auth.js` | Add function | `isCursorLocalCliRuntime()` export |
| `cli/src/lib/adapters/local-cli-adapter.js` | Modify | Import `isCursorLocalCliRuntime`; add Cursor rule to `validateLocalCliCommandCompatibility()` |
| `cli/src/commands/doctor.js` | Modify | Import `isCursorLocalCliRuntime`; add Cursor detail in `local_cli` health check |
| `cli/test/cursor-connector.test.js` | New file | Tests for binary detection, command validation, doctor health check |

---

## 5. Test Plan

### Required Tests (minimum 4)

| # | Test | Location | Description |
|---|------|----------|-------------|
| T1 | Binary detection — positive | `cursor-connector.test.js` | `isCursorLocalCliRuntime({ command: 'cursor' })` returns `true`; `{ command: '/usr/local/bin/cursor' }` returns `true`; `{ command: ['cursor', '--background-agent'] }` returns `true` |
| T2 | Binary detection — negative | `cursor-connector.test.js` | `isCursorLocalCliRuntime({ command: 'claude' })` returns `false`; `{ command: 'codex' }` returns `false`; `{ command: '' })` returns `false` |
| T3 | Command validation | `cursor-connector.test.js` | `validateLocalCliCommandCompatibility({ command: 'cursor' })` returns `{ ok: false, error_class: 'local_cli_command_incompatible' }` (missing agent mode flag); `{ command: 'cursor', args: ['--background-agent'] }` returns `{ ok: true }` |
| T4 | Config validation roundtrip | `cursor-connector.test.js` | A Cursor runtime config `{ type: 'local_cli', command: ['cursor', '--background-agent'] }` passes `normalizeConfig()` validation without errors |

### Optional Tests (dev discretion)

| # | Test | Description |
|---|------|-------------|
| T5 | Doctor Cursor detail | `checkRuntimeReachable()` with a mocked Cursor binary returns Cursor-specific detail string |
| T6 | Non-interference | Claude and Codex validation rules still work unchanged (regression) |
| T7 | Vitest contract | File count updated if new test file added |

---

## 6. Key Architecture Invariants

1. **No new runtime type.** Cursor is `type: 'local_cli'` — the dispatcher, watchdog, heartbeat, staged-result, and abort paths are unchanged.
2. **Binary detection is first-token only.** `isCursorLocalCliRuntime()` checks `tokens[0]` like Claude/Codex — no deep path parsing.
3. **Command validation returns structured errors.** All rules use `{ ok: false, error_class: 'local_cli_command_incompatible', recovery, diagnostic }`.
4. **Dispatch bundle transport.** Cursor uses `prompt_transport: 'dispatch_bundle_only'` — the adapter does NOT inject the prompt into argv or stdin.
5. **Staged result is the only proof of completion.** Cursor must write `turn-result.json` to `.agentxchain/staging/turn-<id>/` like any other `local_cli` runtime.

---

## Dev Charter

### Scope

**Real code changes required — this is NOT a verification-only run.**

1. Add `isCursorLocalCliRuntime()` to `claude-local-auth.js` (or a new `cursor-local-auth.js` if dev prefers — PM does not prescribe file organization)
2. Add Cursor command validation to `validateLocalCliCommandCompatibility()` in `local-cli-adapter.js`
3. Add Cursor-specific doctor health check detail in `doctor.js`
4. Write minimum 4 tests (T1-T4 above)
5. Update vitest contract file count if new test file is added

### Out of Scope

- New runtime type in `VALID_RUNTIME_TYPES`
- Changes to `step.js` dispatcher
- Changes to subprocess lifecycle in `local-cli-adapter.js` (spawn, watchdog, heartbeat)
- Cursor auth failure classification (deferred)
- Legacy `cursor-local.js` modifications
- Windsurf/OpenCode connectors (separate M7 runs)

### Verification

Dev must confirm:
1. All new tests pass
2. Existing Claude/Codex local_cli tests pass (no regression)
3. `node --check` on all modified files
4. Vitest contract passes

## Interface

### Cursor Connector Integration Flow

```
User Config                     Binary Detection                  Command Validation
─────────────                   ─────────────────                 ──────────────────
agentxchain.json:               claude-local-auth.js:             local-cli-adapter.js:
  runtimes:                       isCursorLocalCliRuntime()         validateLocalCliCommandCompatibility()
    cursor-agent:                   ↓ true                           ↓
      type: local_cli          ──────────────────────────        checks cursor-specific rules
      command: ["cursor",         Doctor Health Check               ↓ ok: true/false
        "--background-agent"]   ─────────────────────────
      prompt_transport:           doctor.js:                      Dispatch (unchanged)
        dispatch_bundle_only      checkRuntimeReachable()         ──────────────────
                                    ↓                             step.js:732 → local_cli branch
                                  "cursor binary found             → dispatchLocalCli()
                                   (Cursor IDE connector)"          → spawn → watchdog → staged result
```

### Function Signatures

| Function | File | Signature | Returns |
|----------|------|-----------|---------|
| `isCursorLocalCliRuntime` | `claude-local-auth.js` | `(runtime: { command })` | `boolean` |
| `validateLocalCliCommandCompatibility` | `local-cli-adapter.js` | `({ command, args, runtimeId })` | `{ ok: boolean, error_class?, recovery?, diagnostic? }` |
| `checkRuntimeReachable` | `doctor.js` | `(root, rtId, rt, boundRoleEntries)` | `{ id, name, level, detail, ... }` |

## Acceptance Tests

- [ ] `isCursorLocalCliRuntime()` correctly identifies `cursor` binary (positive + negative cases)
- [ ] `validateLocalCliCommandCompatibility()` enforces Cursor agent mode requirement
- [ ] `agentxchain doctor` reports Cursor-specific detail for Cursor-configured runtimes
- [ ] Cursor runtime config passes `normalizeConfig()` validation as `local_cli`
- [ ] No regressions in Claude/Codex local_cli paths
- [ ] Full test suite passes with 0 failures (deferred to QA)
