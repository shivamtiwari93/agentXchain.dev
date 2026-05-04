# System Spec — M7: Windsurf & OpenCode Connector Expansion

**Run:** `run_0db6a75ab239c3a3`
**Baseline:** git:a3b9a32 (latest checkpoint)
**Package version:** `agentxchain@2.155.72`

## Purpose

Complete the M7 Connector Ecosystem Expansion milestone by adding Windsurf IDE and OpenCode CLI connectors to the local_cli adapter stack. Both follow the proven Cursor connector pattern: binary detection → command validation → connector probe registration → doctor annotation → regression tests.

This closes ROADMAP.md:88-91 and substantively addresses the VISION.md:17 connector pillar: "connectors to local and cloud AI agents."

---

## 1. Architecture Overview

### 1.1 Current Connector Detection Chain

```
agentxchain.json → runtimes.xxx.type === 'local_cli'
  │
  ├─ claude-local-auth.js: isClaudeLocalCliRuntime()      (line 32)
  ├─ claude-local-auth.js: isCodexLocalCliRuntime()        (line 41)
  ├─ claude-local-auth.js: isCursorLocalCliRuntime()       (line 50)
  │
  ├─ local-cli-adapter.js: validateLocalCliCommandCompatibility()  (line 760)
  │   ├─ claude_print_stream_json_requires_verbose         (line 774)
  │   ├─ codex_requires_exec                               (line 794)
  │   ├─ codex_exec_requires_json                          (line 812)
  │   └─ cursor_requires_agent_mode                        (line 831)
  │
  ├─ connector-probe.js: KNOWN_CLI_AUTHORITY_FLAGS         (line 18)
  │   ├─ claude: --dangerously-skip-permissions
  │   └─ codex: --dangerously-bypass-approvals-and-sandbox
  │   (NOTE: Cursor missing — gap from original delivery)
  │
  ├─ connector-probe.js: KNOWN_CLI_TRANSPORTS              (line 37)
  │   ├─ claude: ['stdin']
  │   └─ codex: ['argv', 'stdin']
  │   (NOTE: Cursor missing)
  │
  └─ doctor.js: checkRuntimeReachable()                    (line 498)
      └─ isCursorLocalCliRuntime → "(Cursor IDE local_cli connector)"  (line 505)
```

### 1.2 Extended Chain (After This Deliverable)

```
  ├─ claude-local-auth.js: isWindsurfLocalCliRuntime()     ← NEW
  ├�� claude-local-auth.js: isOpenCodeLocalCliRuntime()     ← NEW
  │
  ├─ local-cli-adapter.js: validateLocalCliCommandCompatibility()
  │   ├─ ... (existing 4 rules unchanged)
  │   ├─ windsurf_requires_agent_mode                      ← NEW
  │   └─ opencode_requires_non_interactive                 ← NEW
  │
  ├─ connector-probe.js: KNOWN_CLI_AUTHORITY_FLAGS
  │   ├─ claude: --dangerously-skip-permissions
  │   ├─ codex: --dangerously-bypass-approvals-and-sandbox
  │   ├─ cursor: --background-agent                        ← NEW (gap fix)
  │   ├─ windsurf: --agent                                 ← NEW
  │   └─ opencode: --non-interactive                       ← NEW
  │
  ├─ connector-probe.js: KNOWN_CLI_TRANSPORTS
  │   ├─ claude: ['stdin']
  │   ├─ codex: ['argv', 'stdin']
  │   ├─ cursor: ['dispatch_bundle_only']                  ← NEW (gap fix)
  │   ├─ windsurf: ['dispatch_bundle_only']                ← NEW
  │   └─ opencode: ['stdin']                               ← NEW
  │
  └─ doctor.js: checkRuntimeReachable()
      ├─ isCursorLocalCliRuntime → "(Cursor IDE local_cli connector)"
      ├─ isWindsurfLocalCliRuntime → "(Windsurf IDE local_cli connector)"   ← NEW
      └─ isOpenCodeLocalCliRuntime → "(OpenCode local_cli connector)"       ← NEW
```

---

## 2. Deliverables

### 2.1 claude-local-auth.js — Add Detection Functions

**Modify existing file:** `cli/src/lib/claude-local-auth.js`

#### 2.1.1 Add `isWindsurfLocalCliRuntime(runtime)` after `isCursorLocalCliRuntime` (after line 57)

```javascript
export function isWindsurfLocalCliRuntime(runtime) {
  const tokens = normalizeCommandTokens(runtime);
  if (tokens.length === 0) {
    return false;
  }
  const head = tokens[0].toLowerCase();
  return head === 'windsurf' || head.endsWith('/windsurf');
}
```

#### 2.1.2 Add `isOpenCodeLocalCliRuntime(runtime)` after `isWindsurfLocalCliRuntime`

```javascript
export function isOpenCodeLocalCliRuntime(runtime) {
  const tokens = normalizeCommandTokens(runtime);
  if (tokens.length === 0) {
    return false;
  }
  const head = tokens[0].toLowerCase();
  return head === 'opencode' || head.endsWith('/opencode');
}
```

Both follow the exact structure of `isCursorLocalCliRuntime` (lines 50-57). The `normalizeCommandTokens` helper (line 20) is module-private and handles both string and array command formats.

---

### 2.2 local-cli-adapter.js — Add Command Validation Rules

**Modify existing file:** `cli/src/lib/adapters/local-cli-adapter.js`

#### 2.2.1 Update import (line 33-42)

Add the new detection functions to the existing import from `claude-local-auth.js`:

```javascript
import {
  getClaudeSubprocessAuthIssue,
  hasClaudeAuthenticationFailureText,
  hasClaudeNodeIncompatibilityText,
  hasCodexAuthenticationFailureText,
  isClaudeLocalCliRuntime,
  isCodexLocalCliRuntime,
  isCursorLocalCliRuntime,
  isWindsurfLocalCliRuntime,    // ← NEW
  isOpenCodeLocalCliRuntime,    // ← NEW
  resolveClaudeCompatibleNodeBinary,
} from '../claude-local-auth.js';
```

#### 2.2.2 Add Windsurf validation rule after Cursor block (after line 848, before `return { ok: true }`)

```javascript
  const usesWindsurf = isWindsurfLocalCliRuntime(runtimeShape);
  if (usesWindsurf && !tokens.includes('--agent')) {
    const runtimeLabel = runtimeId ? `Runtime "${runtimeId}"` : 'Windsurf local_cli runtime';
    const recovery = `${runtimeLabel} uses "windsurf" without an agent flag. Governed local runs require Windsurf's --agent mode for non-interactive execution.`;
    return {
      ok: false,
      error_class: 'local_cli_command_incompatible',
      recovery,
      error: recovery,
      diagnostic: {
        runtime_id: runtimeId,
        binary: binaryName,
        rule: 'windsurf_requires_agent_mode',
        has_agent_flag: false,
        recovery,
      },
    };
  }
```

#### 2.2.3 Add OpenCode validation rule after Windsurf block

```javascript
  const usesOpenCode = isOpenCodeLocalCliRuntime(runtimeShape);
  if (usesOpenCode && !tokens.includes('--non-interactive')) {
    const runtimeLabel = runtimeId ? `Runtime "${runtimeId}"` : 'OpenCode local_cli runtime';
    const recovery = `${runtimeLabel} uses "opencode" without --non-interactive. Governed local runs require OpenCode's non-interactive mode for unattended execution.`;
    return {
      ok: false,
      error_class: 'local_cli_command_incompatible',
      recovery,
      error: recovery,
      diagnostic: {
        runtime_id: runtimeId,
        binary: binaryName,
        rule: 'opencode_requires_non_interactive',
        has_non_interactive_flag: false,
        recovery,
      },
    };
  }
```

**Design invariant:** Both rules return `{ ok: false, error_class: 'local_cli_command_incompatible' }` matching the existing error contract. The `diagnostic.rule` field provides machine-readable identification for error reporting.

---

### 2.3 connector-probe.js — Register Authority Flags and Transports

**Modify existing file:** `cli/src/lib/connector-probe.js`

#### 2.3.1 Replace KNOWN_CLI_AUTHORITY_FLAGS (lines 18-31)

Replace the current 2-entry array with a 5-entry array:

```javascript
const KNOWN_CLI_AUTHORITY_FLAGS = [
  {
    binary: 'claude',
    authoritative_flag: '--dangerously-skip-permissions',
    weak_flags: [],
    label: 'Claude Code',
  },
  {
    binary: 'codex',
    authoritative_flag: '--dangerously-bypass-approvals-and-sandbox',
    weak_flags: ['--full-auto'],
    label: 'OpenAI Codex CLI',
  },
  {
    binary: 'cursor',
    authoritative_flag: '--background-agent',
    weak_flags: [],
    label: 'Cursor IDE',
  },
  {
    binary: 'windsurf',
    authoritative_flag: '--agent',
    weak_flags: [],
    label: 'Windsurf IDE',
  },
  {
    binary: 'opencode',
    authoritative_flag: '--non-interactive',
    weak_flags: [],
    label: 'OpenCode CLI',
  },
];
```

#### 2.3.2 Replace KNOWN_CLI_TRANSPORTS (lines 37-40)

Replace the current 2-entry object with a 5-entry object:

```javascript
const KNOWN_CLI_TRANSPORTS = {
  claude: ['stdin'],
  codex: ['argv', 'stdin'],
  cursor: ['dispatch_bundle_only'],
  windsurf: ['dispatch_bundle_only'],
  opencode: ['stdin'],
};
```

**Rationale:**
- **Cursor** (gap fix): IDE-based → reads dispatch bundle from disk, not stdin
- **Windsurf**: IDE-based (VS Code fork by Codeium) → same `dispatch_bundle_only` model as Cursor
- **OpenCode**: Terminal CLI → same `stdin` model as Claude Code

---

### 2.4 doctor.js — Add Detection Branches

**Modify existing file:** `cli/src/commands/doctor.js`

#### 2.4.1 Update import (line 24)

```javascript
import {
  getClaudeSubprocessAuthIssue,
  isCursorLocalCliRuntime,
  isWindsurfLocalCliRuntime,
  isOpenCodeLocalCliRuntime,
} from '../lib/claude-local-auth.js';
```

#### 2.4.2 Add Windsurf and OpenCode branches in `checkRuntimeReachable`

Insert after the Cursor branch (after line 510, before the `claudeAuthIssue` check at line 512):

```javascript
        if (isWindsurfLocalCliRuntime(rt)) {
          return attachRuntimeContract({
            ...base,
            level: 'pass',
            detail: `${probe.detail} (Windsurf IDE local_cli connector)`,
          }, rtId, rt, boundRoleEntries);
        }
        if (isOpenCodeLocalCliRuntime(rt)) {
          return attachRuntimeContract({
            ...base,
            level: 'pass',
            detail: `${probe.detail} (OpenCode local_cli connector)`,
          }, rtId, rt, boundRoleEntries);
        }
```

**Order matters:** Cursor → Windsurf → OpenCode → Claude auth probe → generic. The IDE connectors (Cursor, Windsurf) return early before the Claude-specific auth probe, matching the existing pattern at line 505.

---

## 3. Test Specifications

### 3.1 windsurf-connector.test.js (~14 tests)

**New file:** `cli/test/windsurf-connector.test.js`

Following `cursor-connector.test.js` structure. Imports `isWindsurfLocalCliRuntime` from `claude-local-auth.js`, `validateLocalCliCommandCompatibility` from `local-cli-adapter.js`, and `loadNormalizedConfig` from `normalized-config.js`.

#### Test Cases

| # | Test ID | Suite | Description | Key Assertion |
|---|---------|-------|-------------|---------------|
| 1 | WS-DET-001 | Binary detection | returns true for bare windsurf command | `isWindsurfLocalCliRuntime({ command: 'windsurf' }) === true` |
| 2 | WS-DET-002 | Binary detection | returns true for absolute path | `isWindsurfLocalCliRuntime({ command: '/usr/local/bin/windsurf' }) === true` |
| 3 | WS-DET-003 | Binary detection | returns true for command array with flags | `isWindsurfLocalCliRuntime({ command: ['windsurf', '--agent'] }) === true` |
| 4 | WS-DET-004 | Binary detection | returns false for claude command | `isWindsurfLocalCliRuntime({ command: 'claude' }) === false` |
| 5 | WS-DET-005 | Binary detection | returns false for cursor command | `isWindsurfLocalCliRuntime({ command: 'cursor' }) === false` |
| 6 | WS-DET-006 | Binary detection | returns false for empty command | `isWindsurfLocalCliRuntime({ command: '' }) === false` |
| 7 | WS-DET-007 | Binary detection | returns false for undefined runtime | `isWindsurfLocalCliRuntime(undefined) === false` |
| 8 | WS-VAL-001 | Command validation | rejects windsurf without --agent | `result.ok === false`, `diagnostic.rule === 'windsurf_requires_agent_mode'` |
| 9 | WS-VAL-002 | Command validation | accepts windsurf with --agent | `result.ok === true` |
| 10 | WS-VAL-003 | Command validation | rejects absolute-path windsurf without --agent | `result.ok === false`, `diagnostic.rule === 'windsurf_requires_agent_mode'` |
| 11 | WS-VAL-004 | Command validation | does not interfere with Claude validation | Claude rules still fire for claude command |
| 12 | WS-VAL-005 | Command validation | does not interfere with Cursor validation | Cursor rules still fire for cursor command |
| 13 | WS-VAL-006 | Command validation | does not interfere with Codex validation | Codex rules still fire for codex command |
| 14 | WS-CFG-001 | Config validation | accepts Windsurf runtime config as valid local_cli | `loadNormalizedConfig(config).ok === true` |

### 3.2 opencode-connector.test.js (~14 tests)

**New file:** `cli/test/opencode-connector.test.js`

Following `cursor-connector.test.js` structure. Imports `isOpenCodeLocalCliRuntime` from `claude-local-auth.js`.

#### Test Cases

| # | Test ID | Suite | Description | Key Assertion |
|---|---------|-------|-------------|---------------|
| 1 | OC-DET-001 | Binary detection | returns true for bare opencode command | `isOpenCodeLocalCliRuntime({ command: 'opencode' }) === true` |
| 2 | OC-DET-002 | Binary detection | returns true for absolute path | `isOpenCodeLocalCliRuntime({ command: '/usr/local/bin/opencode' }) === true` |
| 3 | OC-DET-003 | Binary detection | returns true for command array with flags | `isOpenCodeLocalCliRuntime({ command: ['opencode', '--non-interactive'] }) === true` |
| 4 | OC-DET-004 | Binary detection | returns false for claude command | `isOpenCodeLocalCliRuntime({ command: 'claude' }) === false` |
| 5 | OC-DET-005 | Binary detection | returns false for cursor command | `isOpenCodeLocalCliRuntime({ command: 'cursor' }) === false` |
| 6 | OC-DET-006 | Binary detection | returns false for empty command | `isOpenCodeLocalCliRuntime({ command: '' }) === false` |
| 7 | OC-DET-007 | Binary detection | returns false for undefined runtime | `isOpenCodeLocalCliRuntime(undefined) === false` |
| 8 | OC-VAL-001 | Command validation | rejects opencode without --non-interactive | `result.ok === false`, `diagnostic.rule === 'opencode_requires_non_interactive'` |
| 9 | OC-VAL-002 | Command validation | accepts opencode with --non-interactive | `result.ok === true` |
| 10 | OC-VAL-003 | Command validation | rejects absolute-path opencode without flag | `result.ok === false`, `diagnostic.rule === 'opencode_requires_non_interactive'` |
| 11 | OC-VAL-004 | Command validation | does not interfere with Claude validation | Claude rules still fire for claude command |
| 12 | OC-VAL-005 | Command validation | does not interfere with Cursor validation | Cursor rules still fire for cursor command |
| 13 | OC-VAL-006 | Command validation | does not interfere with Windsurf validation | Windsurf rules still fire for windsurf command |
| 14 | OC-CFG-001 | Config validation | accepts OpenCode runtime config as valid local_cli | `loadNormalizedConfig(config).ok === true` |

### 3.3 Config Shapes for Test Roundtrips

**Windsurf config (WS-CFG-001):**
```javascript
{
  schema_version: '1.0',
  project: { id: 'windsurf-test', name: 'Windsurf Test' },
  runtimes: {
    'windsurf-agent': {
      type: 'local_cli',
      command: ['windsurf', '--agent'],
      prompt_transport: 'dispatch_bundle_only',
      startup_watchdog_ms: 300000,
    },
  },
  roles: {
    dev: {
      title: 'Developer',
      mandate: 'Implement features.',
      write_authority: 'authoritative',
      runtime: 'windsurf-agent',
    },
  },
  phases: ['planning', 'implementation', 'qa'],
  gates: {
    planning_signoff: { required_files: [] },
    implementation_complete: { required_files: [] },
    qa_ship_verdict: { required_files: [] },
  },
}
```

**OpenCode config (OC-CFG-001):**
```javascript
{
  schema_version: '1.0',
  project: { id: 'opencode-test', name: 'OpenCode Test' },
  runtimes: {
    'opencode-agent': {
      type: 'local_cli',
      command: ['opencode', '--non-interactive'],
      prompt_transport: 'stdin',
      startup_watchdog_ms: 180000,
    },
  },
  roles: {
    dev: {
      title: 'Developer',
      mandate: 'Implement features.',
      write_authority: 'authoritative',
      runtime: 'opencode-agent',
    },
  },
  phases: ['planning', 'implementation', 'qa'],
  gates: {
    planning_signoff: { required_files: [] },
    implementation_complete: { required_files: [] },
    qa_ship_verdict: { required_files: [] },
  },
}
```

---

## 4. Files Changed (Expected)

| File | Change Type | LOC | Description |
|------|-------------|-----|-------------|
| `cli/src/lib/claude-local-auth.js` | **Modify** | ~16 | Add `isWindsurfLocalCliRuntime()` + `isOpenCodeLocalCliRuntime()` |
| `cli/src/lib/adapters/local-cli-adapter.js` | **Modify** | ~30 | Add Windsurf + OpenCode validation rules + import updates |
| `cli/src/lib/connector-probe.js` | **Modify** | ~20 | Add Cursor + Windsurf + OpenCode to KNOWN_CLI_AUTHORITY_FLAGS + TRANSPORTS |
| `cli/src/commands/doctor.js` | **Modify** | ~15 | Add Windsurf + OpenCode detection in local_cli case + import updates |
| `cli/test/windsurf-connector.test.js` | **Create** | ~150 | 14 Windsurf connector tests |
| `cli/test/opencode-connector.test.js` | **Create** | ~150 | 14 OpenCode connector tests |

4 modified files, 2 new files. Vitest contract file count increases from 671 to 673.

---

## 5. Key Architecture Invariants

1. **No new runtime types.** Windsurf and OpenCode are `local_cli` connectors, not new runtime types. `VALID_RUNTIME_TYPES` remains `['manual', 'local_cli', 'api_proxy', 'mcp', 'remote_agent']`.
2. **No new modules.** All changes are additions to existing modules following established patterns.
3. **No adapter dispatch changes.** `dispatchLocalCli()` handles all local_cli connectors generically. Only the validation + detection pipeline needs connector-specific knowledge.
4. **Cursor authority flag gap fixed.** Adding Cursor to `KNOWN_CLI_AUTHORITY_FLAGS` alongside the new entries closes a gap from the original Cursor delivery (run_10a2b2d8f0a8399b).
5. **Detection functions are side-effect-free.** Each `isXxxLocalCliRuntime()` is a pure function: normalize command tokens → check head string → return boolean. No I/O, no state, no additional imports.
6. **Validation order is deterministic.** In `validateLocalCliCommandCompatibility`, rules are checked sequentially: Claude → Codex → Cursor → Windsurf → OpenCode → ok. A command matching one binary will only trigger that binary's rule.

---

## Interface

### Connector Registration Points

```
claude-local-auth.js
  └─ export isWindsurfLocalCliRuntime(runtime) → boolean
  └─ export isOpenCodeLocalCliRuntime(runtime) → boolean

local-cli-adapter.js: validateLocalCliCommandCompatibility()
  └─ windsurf_requires_agent_mode → { ok: false, error_class, diagnostic }
  └─ opencode_requires_non_interactive → { ok: false, error_class, diagnostic }

connector-probe.js: KNOWN_CLI_AUTHORITY_FLAGS
  └─ { binary: 'cursor', authoritative_flag: '--background-agent', label: 'Cursor IDE' }
  └─ { binary: 'windsurf', authoritative_flag: '--agent', label: 'Windsurf IDE' }
  └─ { binary: 'opencode', authoritative_flag: '--non-interactive', label: 'OpenCode CLI' }

connector-probe.js: KNOWN_CLI_TRANSPORTS
  └─ cursor: ['dispatch_bundle_only']
  └─ windsurf: ['dispatch_bundle_only']
  └─ opencode: ['stdin']

doctor.js: checkRuntimeReachable()
  └─ isWindsurfLocalCliRuntime(rt) → "(Windsurf IDE local_cli connector)"
  └─ isOpenCodeLocalCliRuntime(rt) → "(OpenCode local_cli connector)"
```

### Recommended Runtime Configurations

**Windsurf:**
```json
{
  "runtimes": {
    "windsurf-agent": {
      "type": "local_cli",
      "command": ["windsurf", "--agent"],
      "prompt_transport": "dispatch_bundle_only",
      "startup_watchdog_ms": 300000
    }
  }
}
```

**OpenCode:**
```json
{
  "runtimes": {
    "opencode-agent": {
      "type": "local_cli",
      "command": ["opencode", "--non-interactive"],
      "prompt_transport": "stdin",
      "startup_watchdog_ms": 180000
    }
  }
}
```

---

## Dev Charter

### Scope

**4 modified files + 2 new test files: Windsurf + OpenCode connector scaffolding.**

1. `cli/src/lib/claude-local-auth.js` — Add 2 detection functions
2. `cli/src/lib/adapters/local-cli-adapter.js` — Add 2 validation rules + import updates
3. `cli/src/lib/connector-probe.js` — Add 3 entries to KNOWN_CLI_AUTHORITY_FLAGS (Cursor + Windsurf + OpenCode) + 3 entries to KNOWN_CLI_TRANSPORTS (Cursor + Windsurf + OpenCode)
4. `cli/src/commands/doctor.js` — Add 2 detection branches + import updates
5. `cli/test/windsurf-connector.test.js` — 14 tests
6. `cli/test/opencode-connector.test.js` — 14 tests

### Out of Scope

- Changes to `dispatchLocalCli` (generic, works for all local_cli connectors)
- Changes to api-proxy-adapter.js, mcp-adapter.js, remote-agent-adapter.js
- Changes to run-loop.js, governed-state.js, hosted-runner.js, execution-worker.js
- Real binary installation or end-to-end Windsurf/OpenCode dispatch
- Plugin system for custom connectors

### Verification

Dev must confirm:
1. `isWindsurfLocalCliRuntime()` correctly detects 'windsurf' command variants
2. `isOpenCodeLocalCliRuntime()` correctly detects 'opencode' command variants
3. `validateLocalCliCommandCompatibility()` rejects windsurf without `--agent`
4. `validateLocalCliCommandCompatibility()` rejects opencode without `--non-interactive`
5. `KNOWN_CLI_AUTHORITY_FLAGS` has entries for all 5 CLI tools (Claude, Codex, Cursor, Windsurf, OpenCode)
6. `KNOWN_CLI_TRANSPORTS` has entries for all 5 CLI tools
7. `doctor.js` shows Windsurf and OpenCode labels in local_cli case
8. All 14 windsurf-connector.test.js tests pass
9. All 14 opencode-connector.test.js tests pass
10. cursor-connector.test.js still passes (no regressions)
11. Vitest contract passes with 673 files
12. Full test suite passes: `cd cli && npm test`

## Acceptance Tests

- [ ] AT-CONN-001: isWindsurfLocalCliRuntime detects 'windsurf' command variants
- [ ] AT-CONN-002: isOpenCodeLocalCliRuntime detects 'opencode' command variants
- [ ] AT-CONN-003: validateLocalCliCommandCompatibility rejects windsurf without --agent
- [ ] AT-CONN-004: validateLocalCliCommandCompatibility rejects opencode without --non-interactive
- [ ] AT-CONN-005: KNOWN_CLI_AUTHORITY_FLAGS includes all 5 CLI connectors
- [ ] AT-CONN-006: KNOWN_CLI_TRANSPORTS includes all 5 CLI connectors
- [ ] AT-CONN-007: Doctor labels Windsurf as "(Windsurf IDE local_cli connector)"
- [ ] AT-CONN-008: Doctor labels OpenCode as "(OpenCode local_cli connector)"
- [ ] AT-CONN-009: Windsurf config accepted by loadNormalizedConfig as valid local_cli
- [ ] AT-CONN-010: OpenCode config accepted by loadNormalizedConfig as valid local_cli
