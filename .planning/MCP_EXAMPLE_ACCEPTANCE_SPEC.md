# MCP Example Acceptance Spec

> Narrow proof slice for the shipped MCP stdio adapter: the reference example must produce a turn result that the governed validator actually accepts, and operators must have one concrete governed-project path that uses it.

Depends on: [MCP_STDIO_ADAPTER_SPEC.md](./MCP_STDIO_ADAPTER_SPEC.md)

## Purpose

Close the gap between "MCP adapter exists" and "an operator can use the shipped example without reverse-engineering or hitting a validator failure."

The current risk is not theoretical:

- `examples/mcp-echo-agent/` is presented as a reference implementation
- `examples/governed-todo-app/` is presented as the main governed example
- but there is no proof that the echo server's returned payload passes `validateStagedTurnResult()`
- and there is no governed-example path showing how to wire MCP into a real project

This slice adds product-proof, not another docs-only claim.

## Interface

### Example Server Contract

`examples/mcp-echo-agent/server.js` must return a **validator-clean** turn result through `structuredContent`.

The example is intentionally minimal and does not need to write files or run verification, but it must still satisfy the actual governed schema and protocol rules:

- valid `DEC-*` decision shape
- valid `OBJ-*` objection shape
- legal `verification.status`
- legal `artifact.type`
- routing-safe `proposed_next_role`

### Governed Example Documentation

`examples/governed-todo-app/README.md` must include a concrete "swap dev to MCP" path that uses the shipped echo server via a repo-relative command path.

This does not require duplicating the entire example directory as a second project.

## Behavior

### 1. Example Server Must Be Acceptance-Safe

The example server should return a no-op but valid result:

- `status: "completed"`
- `files_changed: []`
- `verification.status: "skipped"`
- `artifact.type: "review"` so the payload is safe regardless of whether the bound role is authoritative or review-only
- at least one valid objection so review-only roles do not fail the challenge requirement
- `proposed_next_role: "human"` so routing legality does not depend on phase-specific role sets

### 2. Real MCP Governed Turn Proof

One E2E test must prove a governed project can complete a real CLI `step` through the MCP adapter and have the turn auto-accepted.

The proof target is the implementation phase of `examples/governed-todo-app/` with the dev runtime swapped to the shipped MCP echo server.

### 3. No Duplicate Example Project

Do not clone `examples/governed-todo-app/` into a second MCP-only directory.

That would create drift. The proof should come from:

- one reusable governed example
- one reusable MCP server example
- test coverage that proves they work together

## Error Cases

| Condition | Required behavior |
|---|---|
| Echo server returns an invalid decision/objected/verification/artifact shape | Test must fail at governed validation, not pass on string-matching alone |
| Governed todo app README omits the MCP swap path | Docs/test surface fails |
| MCP dev step stages a result but CLI `step` cannot auto-accept it | E2E proof fails |
| Example requires copying a second full project directory | Reject as maintenance drift |

## Acceptance Tests

- **AT-MCP-EXAMPLE-001**: Dispatching the shipped echo server through the MCP adapter produces a staged result that passes `validateStagedTurnResult()`.
- **AT-MCP-EXAMPLE-002**: A governed implementation turn in the todo example can run through `agentxchain step --role dev` with an MCP runtime bound to the echo server and exits successfully.
- **AT-MCP-EXAMPLE-003**: After that MCP-backed `step`, the turn is accepted into history and no active turn remains assigned.
- **AT-MCP-EXAMPLE-004**: `examples/governed-todo-app/README.md` documents the MCP dev-runtime swap using the shipped echo server.

## Open Questions

1. If the next connector slice adds HTTP MCP transport, should the same governed-example proof expand to transport matrix coverage, or should stdio and HTTP stay in separate acceptance tests?
