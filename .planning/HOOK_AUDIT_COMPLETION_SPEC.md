# Hook Audit Completion Spec

## Purpose

Close the remaining unproven `hook_audit` `orchestrator_action` branches in Tier 2 so the corpus covers every action the runner can emit:

- `blocked_timeout`
- `warned_timeout`
- `warned_failure`
- `warned`

Claude's Turn 25 suggestion to "decide later" on plain `warned` is not good enough. The implementation emits 13 distinct `orchestrator_action` values. Stopping at 12 because one branch is less dramatic would leave the surface knowingly incomplete.

## Interface

No adapter changes are required. The existing `run_hooks` response already exposes:

```json
{
  "result": "success",
  "hook_ok": true,
  "blocked": false,
  "audit_entry": { "...": "first audit row" },
  "audit_entries": [{ "...": "all rows" }]
}
```

These fixtures stay single-hook and assert against `audit_entry`.

## Behavior

### HA-010: Blocking Hook Timeout

Hook process exceeds `timeout_ms`.

Expected:
- `hook_ok: false`
- `blocked: true`
- `audit_entry.timed_out: true`
- `audit_entry.verdict: "block"`
- `audit_entry.orchestrator_action: "blocked_timeout"`

### HA-011: Advisory Hook Timeout

Same timeout condition, but `mode: "advisory"`.

Expected:
- `hook_ok: true`
- `blocked: false`
- `audit_entry.timed_out: true`
- `audit_entry.verdict: "warn"`
- `audit_entry.orchestrator_action: "warned_timeout"`

### HA-012: Advisory Hook Process Failure

Hook exits non-zero without timing out.

Expected:
- `hook_ok: true`
- `blocked: false`
- `audit_entry.exit_code: 1`
- `audit_entry.timed_out: false`
- `audit_entry.verdict: "warn"`
- `audit_entry.orchestrator_action: "warned_failure"`

### HA-013: Advisory Hook Normal Warn Verdict

Hook exits 0 and returns valid JSON `{ "verdict": "warn" }`.

Expected:
- `hook_ok: true`
- `blocked: false`
- `audit_entry.exit_code: 0`
- `audit_entry.timed_out: false`
- `audit_entry.verdict: "warn"`
- `audit_entry.orchestrator_action: "warned"`

## Error Cases

- Timeout fixtures must assert `timed_out: true` and not infer an exact exit code because subprocess timeout status can vary across platforms.
- `warned` must be proven by a valid verdict payload, not smuggled through failure fallback. HA-002 is transport-failure coverage, not normal advisory warn coverage.

## Acceptance Tests

- AT-HA-010-001: blocking timeout returns `hook_ok === false`
- AT-HA-010-002: blocking timeout returns `blocked === true`
- AT-HA-010-003: blocking timeout emits `orchestrator_action === "blocked_timeout"`
- AT-HA-011-001: advisory timeout returns `hook_ok === true`
- AT-HA-011-002: advisory timeout emits `orchestrator_action === "warned_timeout"`
- AT-HA-012-001: advisory process failure emits `orchestrator_action === "warned_failure"`
- AT-HA-013-001: advisory valid warn emits `orchestrator_action === "warned"`

## Fixture Counts After

- hook_audit: `13`
- Tier 2: `23`
- Total corpus: `68`
