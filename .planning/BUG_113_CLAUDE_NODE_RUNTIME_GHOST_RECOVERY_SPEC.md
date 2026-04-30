# BUG-113: Claude Node Runtime Ghost Recovery

## Purpose

During BUG-112 shipped-package reverify on Tusq session `cont-7dc5b5df`, `agentxchain@2.155.67` correctly auto-reissued retained provider-timeout QA turn `turn_aa9664d36f8cac23`. The reissued Claude QA subprocess then exited in under one second with `TypeError: Object not disposable` under `Node.js v18.13.0`, produced no stdout, and AgentXchain classified the failure as `stdout_attach_failed` ghost startup. Continuous ghost retry repeated the same local runtime incompatibility and exhausted, again pausing full-auto.

This is not a product QA failure and not a normal ghost turn. It is a local Claude Code runtime compatibility failure caused by the `claude` shebang resolving through an older Node binary. AgentXchain should classify that signature explicitly and, when a compatible Node binary is available, reissue the retained turn without requiring operator-side `reissue-turn`.

## Interface

- Fresh dispatch input:
  - runtime is Claude local CLI.
  - subprocess exits without a staged result.
  - stderr/log text contains `TypeError: Object not disposable`, Claude Code's compiled `throw TypeError("Object not disposable")` helper, or equivalent Claude Node incompatibility evidence.
- Fresh dispatch output:
  - adapter returns `blocked: true`.
  - `classified.error_class === "claude_node_incompatible"`.
  - run blocks as `dispatch:claude_node_incompatible`, not `ghost_turn`.
- Retained continuous input:
  - `state.status === "blocked"`.
  - `state.blocked_reason.category === "ghost_turn"`.
  - retained active turn has `status === "failed_start"` and `failed_start_reason === "stdout_attach_failed"`.
  - runtime is Claude local CLI.
  - retained dispatch log contains Claude Node incompatibility evidence.
  - a compatible Node binary is resolvable.
- Retained continuous output:
  - `reissueTurn()` creates a new turn even if the generic ghost retry budget was exhausted.
  - state returns to `active`.
  - session returns to `running`.
  - stale `session.ghost_retry` exhaustion is cleared.
  - an `auto_retried_ghost` event records `recovery_class: "claude_node_runtime_recovered"`.

## Behavior

For fresh Claude local CLI dispatches, AgentXchain should classify the Node incompatibility before the generic startup-failure path. This prevents retry budget burn and gives a precise recovery.

For retained DOGFOOD state, continuous startup should inspect retained ghost logs before generic ghost retry exhaustion. If the failure is the Claude Node incompatibility signature and a compatible Node binary is available, it should reissue once through the governed reissue path and continue. If no compatible Node binary is available, it should reclassify to a typed dispatch blocker with recovery guidance instead of preserving `ghost_turn`.

When launching `claude` by command name and a compatible Node binary is available, the local CLI adapter should invoke the resolved Claude CLI entrypoint with that Node binary. This avoids stale `/usr/bin/env node` PATH resolution selecting Node 18 while Node 20 is installed.

## Error Cases

- Non-Claude local CLI runtime: keep existing ghost behavior.
- Claude auth markers: BUG-111 auth classification remains separate.
- Missing retained dispatch log: keep existing ghost behavior.
- Incompatibility marker absent: keep existing ghost behavior and same-signature exhaustion.
- Compatible Node binary absent: reclassify to `dispatch:claude_node_incompatible` with explicit recovery guidance.
- Compatible Node binary exists but Claude still fails: the next dispatch failure is classified from its actual log evidence.

## Acceptance Tests

- `cli/test/local-cli-adapter.test.js` proves fresh Claude Node incompatibility stderr returns `classified.error_class === "claude_node_incompatible"` and does not set `startupFailure`.
- `cli/test/continuous-run.test.js` proves retained Claude Node-incompatible ghost blockers auto-reissue when `AGENTXCHAIN_CLAUDE_NODE` points at an available Node binary, even if `session.ghost_retry.exhausted === true`, using the actual Claude Code minified `throw TypeError("Object not disposable")` signature observed in Tusq.
- Existing BUG-112 retained provider-timeout tests still pass.
- Existing generic ghost retry tests still pass.

## Open Questions

- Whether future releases should introduce a distinct `auto_retried_claude_node_runtime` event. For this patch, reusing `auto_retried_ghost` with `recovery_class` avoids expanding the event registry while preserving machine-readable evidence.
