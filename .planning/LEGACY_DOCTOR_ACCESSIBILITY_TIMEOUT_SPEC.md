# Legacy Doctor Accessibility Timeout — Spec

## Purpose

Prevent the legacy v3 `agentxchain doctor` command from hanging on macOS when the Accessibility probe blocks inside `osascript`.

The governed (v4) doctor is now the primary readiness surface, but the legacy v3 path still exists and must not trap operators in a long-running or stuck accessibility prompt.

## Interface

```
agentxchain doctor
```

- Scope: legacy v3 config path only
- No new flags
- No behavior change for governed v4 projects

## Behavior

### Accessibility probe

- The legacy doctor still checks macOS Accessibility through `osascript`
- The probe must use a hard timeout
- If the probe times out:
  - the doctor must continue rendering the legacy report
  - the Accessibility check must be `warn`, not `fail`
  - the detail must explain that the probe timed out and tell the operator to grant Accessibility access

### Non-timeout failures

- If `osascript` exits quickly with an error, keep the existing `warn` outcome
- If the probe succeeds, return `pass`
- On non-macOS platforms, keep the existing `warn` outcome: "only checked on macOS"

## Error Cases

- `osascript` blocks waiting on a permission prompt or OS dialog
- `osascript` exists in `PATH` but never returns
- `osascript` exits non-zero because System Events access is denied

## Acceptance Tests

- **AT-LDAT-001**: On a legacy v3 project, a fake `osascript` binary that sleeps longer than the timeout does not hang `agentxchain doctor`; the command exits promptly and reports a warning for macOS Accessibility
- **AT-LDAT-002**: The timeout warning detail explicitly mentions that the probe timed out
- **AT-LDAT-003**: Governed v4 projects are unaffected; this timeout logic remains isolated to the legacy doctor path

## Open Questions

- None for this slice. A broader v3 deprecation decision is separate from this hang fix.

## Decision

- `DEC-LEGACY-DOCTOR-ACCESS-001`: The legacy v3 macOS Accessibility probe is timeout-bounded. A blocked `osascript` process must degrade to a warning instead of hanging the doctor command.
