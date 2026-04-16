# Diff / Verify Gate-Action Timeout Parity

## Purpose

Ensure `run diff`, `verify export`, `verify diff`, and `export diff` surfaces distinguish gate-action timeouts from generic gate failures instead of rendering `[object Object]` or cause-less regression messages.

## Surfaces Fixed

| Surface | File | Before | After |
|---------|------|--------|-------|
| `run diff` text | `cli/src/commands/diff.js` | `Blocked reason: [object Object]` | `gate_action_failed: npm test timed out after 5000ms` |
| `run diff` text | `cli/src/commands/diff.js` | Generic object stringify for non-timeout | `gate_action_failed: npm test failed (exit 1)` |
| `export diff` / `verify diff` / `verify export` | `cli/src/lib/export-diff.js` | `Gate "X" regressed from approved to blocked` | `Gate "X" regressed from approved to blocked (gate action timed out after 5000ms)` |

## Changes

### `cli/src/commands/diff.js` — `formatValue`
- Object values no longer render as `[object Object]` — they use `JSON.stringify`.
- `blocked_reason` objects get dedicated formatting via `formatBlockedReason()`.
- Gate-action timeout: `gate_action_failed: <label> timed out after <timeout_ms>ms`.
- Gate-action generic failure: `gate_action_failed: <label> failed (exit <code>)`.
- Other blocked categories: `<category>: <detail>`.

### `cli/src/lib/export-diff.js` — `normalizeRunExport`
- Added `blocked_category`, `blocked_gate_action_timed_out`, `blocked_gate_action_timeout_ms` to normalized export.
- Gate regression messages now include cause detail when `blocked_category === 'gate_action_failed'`.

## Acceptance Tests

- `AT-RD-006`: `run diff` text output shows gate-action timeout evidence for timed-out blocked reason.
- `AT-RD-007`: `run diff` text output shows exit code for non-timeout gate-action failure.
- `AT-REG-012B`: `export diff` gate regression message includes timeout cause.
- `AT-REG-012C`: `export diff` gate regression message includes generic failure cause.

## Surfaces Already Correct (No Changes Needed)

- `status` CLI — already uses `timed_out` field (Turn 33)
- `report` text/markdown/HTML — already uses `timed_out` field (Turn 33)
- Dashboard blocked/gate views — already uses `timed_out` field (Turn 33)
- Approval commands — already uses `timed_out` field (Turn 32)
- `run diff --json` — structured output preserves the full `blocked_reason` object
