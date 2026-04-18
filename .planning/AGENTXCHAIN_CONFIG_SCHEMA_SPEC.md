# AgentXchain Config Schema Spec

## Purpose

Provide a machine-readable JSON Schema artifact for governed `agentxchain.json` so non-reference runners and external tooling can validate the raw repo config without reverse-engineering the normalizer.

This spec closes a specific protocol gap:

- raw config uses `roles.<role>.runtime`
- normalized in-memory config exposes `roles.<role>.runtime_id`
- external tooling reads `agentxchain.json`, not the reference runner's normalized object

The schema must make that boundary explicit so the config surface and the connector-capability handshake do not drift apart.

## Interface

- Schema file: `cli/src/lib/schemas/agentxchain-config.schema.json`
- Package export: `agentxchain/schemas/agentxchain-config`
- Scope: governed config (`schema_version: "1.0"` and compatibility `schema_version: 4`)
- Initial strictness target:
  - strongly validate `project`, `roles`, `runtimes`, and runtime capability declarations
  - document the canonical raw role binding field as `runtime`
  - reject `runtime_id` inside raw role objects
  - allow broader optional top-level sections without pretending every extension is frozen yet

## Behavior

The schema must:

- validate real governed repo configs already accepted by the reference runner
- require `roles.<role>.runtime`
- reject raw role objects that try to use `runtime_id` instead of `runtime`
- validate declared runtime capabilities under `runtimes.<id>.capabilities`
- distinguish raw-config truth from normalized/internal truth in docs

The docs surface must state:

- `role.runtime` is the canonical raw-config field in `agentxchain.json`
- `runtime_id` is a normalization/runtime artifact used in dispatch, state, and turn-result surfaces
- the machine-readable schema is shipped in the npm package

## Error Cases

- A raw config with `roles.dev.runtime_id = "local-dev"` but no `runtime` is invalid
- A runtime capability declaration with unsupported field names should fail schema validation
- A role object with extra normalized-only fields should fail schema validation instead of silently teaching the wrong raw contract

## Acceptance Tests

1. A real governed fixture config validates against the schema.
2. A mutated fixture that replaces `role.runtime` with `role.runtime_id` fails validation.
3. A runtime with a valid `capabilities` declaration validates.
4. Package exports expose `agentxchain/schemas/agentxchain-config`.
5. Protocol docs explicitly state raw `runtime` vs normalized `runtime_id`.
6. CLI docs include the already-shipped `connector capabilities` command so the machine-readable handshake is not undocumented.

## Open Questions

- Whether to freeze every optional governed top-level section in the JSON Schema immediately, or keep some extension-oriented sections open until their protocol promotion work is complete.
