# Gate Action Timeout Metadata Parity — Spec

## Purpose

Ensure that when a gate action times out (as opposed to failing with a non-zero exit code), every operator-facing surface distinguishes the timeout from a generic failure. The storage layer (`governed-state.js`) already records `timed_out` and `timeout_ms` in `blocked_reason.gate_action`; this spec closes the downstream rendering gap.

## Surfaces Fixed

| Surface | File | Before | After |
|---------|------|--------|-------|
| `status` CLI | `cli/src/commands/status.js` | Generic "failed" + exit code | "timed out after Nms" when `timed_out` is true |
| Report (text) | `cli/src/lib/report.js` | No timeout indicator | `timed_out after Nms` appended to gate-action line |
| Report (markdown) | `cli/src/lib/report.js` | No timeout indicator | `⏱ timed out after Nms` appended |
| Report (HTML) | `cli/src/lib/report.js` | No timeout indicator | `<em>⏱ timed out after Nms</em>` appended |
| Dashboard blocked view | `cli/dashboard/components/blocked.js` | Generic "❌ failed" + exit code | "⏱ timed out after Nms" |
| Dashboard gate review | `cli/dashboard/components/gate.js` | Generic "❌" + exit code | "⏱" + "timed out after Nms" |

## Surfaces Already Correct (No Change)

| Surface | File | Status |
|---------|------|--------|
| `approve-transition` | `cli/src/commands/approve-transition.js` | Already renders `timeout after Nms` |
| `approve-completion` | `cli/src/commands/approve-completion.js` | Already renders `timeout after Nms` |
| `replay` | `cli/src/commands/replay.js` | Already renders `timed_out=true` |
| `governed-state.js` | `cli/src/lib/governed-state.js` | Already stores `timed_out`, `timeout_ms` in `blocked_reason.gate_action` |

## Acceptance Tests

- `AT-GA-009`: Timeout metadata surfaces in `status`, report text, report markdown, and report HTML — all four assert `timed out after 1000ms` pattern match.
- `AT-GA-008`: Original timeout evidence storage test (unchanged).
- All existing gate-action tests continue to pass (8/8).
- Dashboard gate-action E2E tests continue to pass (2/2).

## Decision

`DEC-GATE-ACTION-TIMEOUT-PARITY-001`: All operator-facing surfaces that render gate-action failure evidence must distinguish timed-out actions from generic failures using the `timed_out` and `timeout_ms` fields already stored in `blocked_reason.gate_action`.
