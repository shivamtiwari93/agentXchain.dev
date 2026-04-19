## Purpose

Prove that AgentXchain's published connector portability schemas compose end-to-end for external tooling.

This proof must validate a raw governed `agentxchain.json` against the published input schema, validate a real `connector capabilities --json` response against the published output schema, and assert that runtime and role references stay coherent across both surfaces.

## Interface

- Input schema package export: `agentxchain/schemas/agentxchain-config`
- Output schema package export: `agentxchain/schemas/connector-capabilities-output`
- CLI handshake surface: `agentxchain connector capabilities [runtime_id] [--all] --json`
- Executable proof file: `cli/test/connector-schema-roundtrip.test.js`

## Behavior

The proof must:

1. Create a real governed repo with `agentxchain init --governed`.
2. Load both schemas through package exports, not private file paths.
3. Validate the raw on-disk `agentxchain.json`.
4. Run the real CLI handshake and validate the JSON response.
5. Assert continuity rules:
   - every emitted `runtime_id` exists in `config.runtimes`
   - every emitted `runtime_type` matches the raw runtime's `type`
   - every emitted `role_binding.role_id` exists in `config.roles`
   - every bound role's raw `runtime` matches the handshake runtime that reported it
6. Include one custom runtime/role case so the proof is not limited to default scaffold wiring.

## Error Cases

- If a raw config uses normalized-only fields such as `runtime_id`, the input schema validation must fail before handshake assertions run.
- If the CLI emits a runtime missing from the raw config, the proof must fail.
- If the CLI reports a role binding under the wrong runtime, the proof must fail.
- If package exports drift from the actual schemas, the proof must fail on import or validation.

## Acceptance Tests

- `AT-CSR-001`: default governed scaffold validates through both schemas and preserves runtime/role continuity.
- `AT-CSR-002`: custom runtime and custom raw role validate through both schemas and preserve binding continuity.

## Open Questions

- None. This is a proof slice for already-shipped schema surfaces, not a new protocol surface.
