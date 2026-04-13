## Purpose

Make `agentxchain step` expose the same run-level context quality that `run` and `status` already provide. An operator dispatching a single governed turn should not need a separate `status` call to confirm which run they are in, whether the run is a continuation or recovery, what context was inherited, or which phase gate they are currently working toward.

## Interface

- Command: `agentxchain step`
- Output contract additions before adapter-specific dispatch output:
  - `Run:` current run id
  - `Phase:` current governed phase
  - `Origin:` when governed state provenance is non-manual or otherwise summarizes to a visible value
  - `Inherits:` when `state.inherited_context.parent_run_id` exists
  - `Gate:` active phase exit gate with current gate status when configured
  - `Files:` required files for the active exit gate when the gate is not yet passed
  - `Needs:` human approval and/or verification pass when the active exit gate requires them

## Behavior

- `step` prints the run-context header once per invocation, after the run is initialized/reactivated and before adapter-specific dispatch output begins.
- Fresh manual runs still show `Run:` and `Phase:` but do not show `Origin:` or `Inherits:` when the provenance summary is intentionally empty.
- Continuation/recovery runs show `Origin:` using the same provenance summarization contract as `run` and `status`.
- Inherited-context runs show `Inherits:` with parent run id and parent status.
- The gate detail shown is only for the active phase's configured `exit_gate`.
- Required files are shown with `.planning/` stripped from the display label.
- `Files:` and `Needs:` are omitted when the active gate is already `passed`.

## Error Cases

- If the current phase has no configured `exit_gate`, `step` omits gate detail instead of fabricating one.
- If the gate exists in routing but has no gate definition, `step` still shows the `Gate:` line using the current gate status and omits `Files:` / `Needs:`.
- Missing required files must be visible in the header so operators can see the contract gap before or during dispatch.

## Acceptance Tests

- `AT-SCH-001`: continuation-backed governed state causes `step` to print `Origin:` with the parent run id.
- `AT-SCH-002`: inherited-context governed state causes `step` to print `Inherits:` plus active gate `Files:` and `Needs:` details.
- `AT-SCH-003`: fresh/manual governed state prints `Run:` / `Phase:` but omits `Origin:` and `Inherits:`.

## Open Questions

- None. This is a CLI truth/visibility slice, not a protocol change.
