# PM Signoff — M3: Multi-Model Turn Handoff Quality (Item #2: Output Format Parsing Validation)

Approved: YES

**Run:** `run_3a396386e18575b6`
**Phase:** planning
**Turn:** `turn_90518aab38b346cf`
**Date:** 2026-05-01

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators running multi-model governed runs where runtimes produce different output formats: Claude Code emits `--output-format stream-json` (newline-delimited JSON events on stdout), while OpenAI Codex CLI emits `--json` (a single structured JSON blob on stdout).

### Core Pain Point

The local CLI adapter's output handling is **asymmetrically developed**: Claude runtimes get three layers of output-aware behavior (flag compatibility validation, auth failure classification, Node incompatibility classification), while Codex runtimes get zero output-aware behavior. This creates two concrete problems:

1. **Codex failure misclassification**: When a Codex `--json` turn fails (auth error, command rejection, sandbox escape), the adapter reports a generic "subprocess exited without writing a staged turn result" error. The orchestrator cannot distinguish a recoverable Codex auth failure from a non-recoverable configuration error. This forces unnecessary human escalation for what should be automated recovery.

2. **No output format validation for non-Claude runtimes**: `validateLocalCliCommandCompatibility()` at `local-cli-adapter.js:741` only checks the Claude-specific `--print --output-format stream-json --verbose` combination. No analogous validation exists for Codex `exec --json` commands. A misconfigured Codex runtime (e.g., `codex exec` without `--json`, or `codex --json` without `exec`) will fail at runtime rather than being caught at dispatch pre-flight.

**Evidence of the gap:**

| Capability | Claude (`stream-json`) | Codex (`--json`) |
|-----------|----------------------|-----------------|
| Flag compatibility validation | YES (`validateLocalCliCommandCompatibility`) | NO |
| Auth failure classification | YES (`hasClaudeAuthFailureOutput`) | NO |
| Runtime incompatibility detection | YES (`hasClaudeNodeRuntimeIncompatibilityOutput`) | NO |
| Output collected for audit | YES | YES |
| Structured event parsing | NO (raw text) | NO (raw text) |
| Startup proof from stdout | YES (`recordFirstOutput`) | YES (`recordFirstOutput`) |

### Core Workflow

1. PM diagnoses the output format handling asymmetry and scopes dev charter (this turn)
2. Dev adds Codex output classification, Codex flag validation, and stream-json/--json test coverage
3. QA verifies both output formats produce correct adapter behavior end-to-end

### MVP Scope (this run)

- **PM (this turn):** Root-cause the output format handling gaps, scope implementation for dev
- **Dev:** Four code changes + regression tests:
  1. Add `isCodexLocalCliRuntime()` detector in `claude-local-auth.js` (or a new `codex-local-auth.js`) — pattern: binary is `codex` or ends with `/codex`
  2. Add `hasCodexAuthFailureOutput()` classifier — match Codex auth error patterns in stdout/stderr (e.g., `"unauthorized"`, `"invalid API key"`, `"authentication failed"`, OpenAI 401 patterns)
  3. Add Codex auth failure classification branch in `dispatchLocalCli()` close handler (parallel to the existing Claude branches at lines 504-535) — return `{ blocked: true, classified: { error_class: 'codex_auth_failed', recovery: '...' } }`
  4. Add Codex `exec --json` flag validation in `validateLocalCliCommandCompatibility()` — warn if `codex` binary is used without `exec` subcommand, or if `exec` is used without `--json` when `prompt_transport: 'stdin'` is set
  5. Regression tests covering:
     - (a) Codex `--json` stdout auth failure → typed `codex_auth_failed` blocker
     - (b) Codex missing `exec` subcommand → `local_cli_command_incompatible` pre-flight block
     - (c) Claude `stream-json` auth failure → existing `claude_auth_failed` (regression guard)
     - (d) Claude `stream-json` normal output → `ok: true` with staged result (regression guard)
     - (e) Codex `--json` normal output → `ok: true` with staged result (new)

### Out of Scope

- M3 item #3 (model identity metadata in turn checkpoints) — separate run
- M3 item #4 (test cross-model challenge quality) — longitudinal assessment
- M3 item #5 (acceptance criterion: 3 consecutive cycles) — longitudinal
- **Parsing stream-json events for cost extraction** — this is M4 scope ("Add turn-level cost tracking for local_cli runtimes (parse stream-json cost events)")
- **Parsing stream-json events for structured turn results** — the file-based staging contract is the authoritative turn result channel; stdout parsing is diagnostic-only
- Changes to the adapter interface contract (adapter-interface.js)
- Changes to manual-adapter.js or api-proxy-adapter.js
- Codex smoke probe (analogous to `runClaudeSmokeProbe`) — future hardening, not needed for output format validation

### Success Metric

1. `isCodexLocalCliRuntime()` correctly identifies Codex runtimes — `connector-probe.js` already has this logic at line 354 but it's not exported for adapter use
2. Codex auth failure output is classified as `codex_auth_failed` typed blocker — matching the `claude_auth_failed` pattern
3. `validateLocalCliCommandCompatibility()` catches misconfigured Codex commands at pre-flight
4. Test A: Codex `--json` auth failure → `result.blocked === true && result.classified.error_class === 'codex_auth_failed'`
5. Test B: Codex missing `exec` → `result.ok === false && result.classified.error_class === 'local_cli_command_incompatible'`
6. Test C: Codex `--json` normal turn → `result.ok === true` (staged result written)
7. Test D: Claude `stream-json` auth failure → still `claude_auth_failed` (no regression)
8. All existing tests continue to pass

## Challenge to Previous Work

### OBJ-PM-001: Prior M3 run (runtime_id) was correctly scoped but left the output format gap unaddressed (severity: low)

The prior run (`run_fb3583590a1a4799`) added `runtime_id` to decision ledger entries and CONTEXT.md rendering. This was correct work — model attribution in handoff context is necessary for cross-model challenge quality. However, the shipped changes address context *metadata* (which model produced a turn), not context *fidelity* (whether the adapter correctly handles each model's output format). A QA role on Opus 4.6 now knows a Dev turn was produced by GPT 5.5 via `local-gpt-5.5`, but if that GPT 5.5 turn had failed with a Codex auth error, the QA role would have seen only a generic failure message — no typed error class, no specific recovery instruction.

The two M3 items are complementary: item #1 (runtime_id) tells you *who* produced the turn; item #2 (output format parsing) ensures the adapter *correctly handles* each model's output.

### OBJ-PM-002: Codex runtime has been operating without error classification since initial deployment (severity: medium)

The `local-gpt-5.5` runtime was added to `agentxchain.json` and bound to the `dev` and `eng_director` roles. Yet the adapter's error classification code at `local-cli-adapter.js:504-535` only fires for `isClaudeLocalCliRuntime(runtime)`. Every Codex failure since deployment has been reported as a generic "subprocess exited (code N) without writing a staged turn result" — no typed error class, no specific recovery action, no `blocked: true` flag. This means Codex failures are treated as retryable (ghost reissue) rather than blocked (human escalation), wasting retry budget on configuration problems.

This is not a regression from the prior run — it's a pre-existing gap that the M3 milestone was designed to address.

## Notes for Dev

Your charter is **output format validation and Codex error classification in the local CLI adapter**.

### 1. Add Codex runtime detection

The pattern already exists in `connector-probe.js:354`:
```javascript
const isCodex = binaryName === 'codex' || binaryName.endsWith('/codex');
```

Create a parallel detector for adapter use. Either:
- Add `isCodexLocalCliRuntime(runtime)` to `claude-local-auth.js` (rename file to `local-cli-auth.js` if you prefer), or
- Create a new `codex-local-auth.js` with the same structure

The detector should normalize command tokens and check the binary name, same as `isClaudeLocalCliRuntime()`.

### 2. Add Codex auth failure classifier

Create `hasCodexAuthFailureOutput(logs)` that matches common Codex/OpenAI auth error patterns:
```javascript
const CODEX_AUTH_FAILURE_RE = /unauthorized|invalid api key|invalid_api_key|authentication failed|openai.*401|api_key.*invalid/i;
```

Test against `logs.some(line => CODEX_AUTH_FAILURE_RE.test(line))`, same pattern as `hasClaudeAuthFailureOutput()`.

### 3. Add Codex error branch in dispatchLocalCli close handler

In `local-cli-adapter.js`, after the Claude auth check at line ~504, add a parallel Codex branch:

```javascript
} else if (isCodexLocalCliRuntime(runtime) && hasCodexAuthFailureOutput(logs)) {
  const recovery = 'Refresh OpenAI credentials before resuming: export a valid OPENAI_API_KEY, then run agentxchain step --resume.';
  settle({
    ok: false,
    blocked: true,
    exitCode,
    timedOut: false,
    aborted: false,
    firstOutputAt,
    classified: {
      error_class: 'codex_auth_failed',
      recovery,
    },
    error: `Codex local_cli authentication failed. ${recovery}`,
    logs,
  });
}
```

### 4. Add Codex flag validation in validateLocalCliCommandCompatibility

Extend the function at `local-cli-adapter.js:741` to also validate Codex commands:

```javascript
if ((binaryName === 'codex' || binaryName.endsWith('/codex')) && !tokens.includes('exec')) {
  const runtimeLabel = runtimeId ? `Runtime "${runtimeId}"` : 'Codex local_cli runtime';
  const recovery = `${runtimeLabel} uses "codex" without the "exec" subcommand. Governed local runs require "codex exec" for non-interactive execution.`;
  return {
    ok: false,
    error_class: 'local_cli_command_incompatible',
    recovery,
    error: recovery,
    diagnostic: { runtime_id: runtimeId, binary: binaryName, rule: 'codex_requires_exec', recovery },
  };
}
```

### 5. Regression tests

Add tests in `local-cli-adapter.test.js`:

**Test A: Codex --json auth failure → typed blocker**
- Fixture: shim script that outputs `{"error": "unauthorized", "message": "Invalid API key"}` to stdout and exits 1
- Config: `command: [shim, 'exec', '--json']` with binary name aliased to `codex`
- Assert: `result.blocked === true`, `result.classified.error_class === 'codex_auth_failed'`

**Test B: Codex missing exec → pre-flight block**
- Config: `command: ['codex', '--json', '{prompt}']` (no `exec`)
- Assert: `result.ok === false`, blocked before spawn

**Test C: Codex --json normal turn → staged result success**
- Fixture: shim script that writes a valid `turn-result.json` to staging dir and emits JSON to stdout
- Assert: `result.ok === true`

**Test D: Claude stream-json auth failure → still claude_auth_failed (regression guard)**
- Ensure existing test at line ~279 continues to pass

### 6. Check off M3 item #2

In `.planning/ROADMAP.md` line 40, change:
```
- [ ] Validate that stream-json and --json output formats are correctly parsed by the adapter
```
to:
```
- [x] Validate that stream-json and --json output formats are correctly parsed by the adapter
```

## Notes for QA

- Verify Codex auth failures produce `codex_auth_failed` typed blocker, not generic failure
- Verify Codex missing `exec` is caught at pre-flight validation, not at runtime
- Verify existing Claude error classification is unaffected (no regression)
- Verify the `isCodexLocalCliRuntime()` detector correctly identifies Codex binaries
- Run the full test suite — confirm no regressions
- Check that `validateLocalCliCommandCompatibility()` tests cover both Claude and Codex validation rules

## Acceptance Contract Response

1. **Roadmap milestone addressed: M3: Multi-Model Turn Handoff Quality** — YES. This run addresses the second M3 item: validating that both `stream-json` (Claude) and `--json` (Codex) output formats are correctly handled by the adapter, and closing the Codex error classification gap.

2. **Unchecked roadmap item completed: Validate that stream-json and --json output formats are correctly parsed by the adapter** — YES (after dev implements). The gap is asymmetric error classification: Claude gets three layers of output-aware behavior while Codex gets none. Dev charter adds Codex auth classification, Codex flag validation, and comprehensive test coverage for both formats.

3. **Evidence source: .planning/ROADMAP.md:40** — Line 40 will be checked off by dev after implementation. Evidence: Codex auth failures classified as `codex_auth_failed` typed blockers, Codex command validation catches missing `exec`, regression tests prove both output formats work through the adapter.
