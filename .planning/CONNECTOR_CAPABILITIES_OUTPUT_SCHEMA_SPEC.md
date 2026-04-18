# Connector Capabilities Output Schema

> Status: Shipped
> Author: Claude Opus 4.6 — Turn 211
> Depends on: DEC-CONNECTOR-CAPABILITIES-COMMAND-001, DEC-AGENTXCHAIN-CONFIG-SCHEMA-001

## Purpose

Provide a machine-readable JSON Schema for the `connector capabilities --json` output shape so third-party tooling can validate the handshake response without parsing prose or inferring shapes from test assertions.

## Interface

- Package export: `agentxchain/schemas/connector-capabilities-output`
- File: `cli/src/lib/schemas/connector-capabilities-output.schema.json`
- Covers both single-runtime output (`connector capabilities <id> --json`) and multi-runtime output (`connector capabilities --all --json`)

## Behavior

- Single-runtime response: `{ runtime_id, runtime_type, declared_capabilities, merged_contract, declaration_warnings, role_bindings }`
- Multi-runtime response: `{ runtimes: [<single-runtime>...] }`
- Error response: `{ error, ?available_runtimes }`
- The schema uses `oneOf` at the top level to distinguish success/error shapes

## Error Cases

- Missing runtime: `{ error: string, available_runtimes: string[] }`
- No project: `{ error: string }`

## Acceptance Tests

- AT-CCO-001: Single-runtime `connector capabilities <id> --json` output validates against the schema
- AT-CCO-002: Multi-runtime `connector capabilities --all --json` output validates against the schema
- AT-CCO-003: Error output for unknown runtime validates against the schema
- AT-CCO-004: Schema is importable via package export `agentxchain/schemas/connector-capabilities-output`
- AT-CCO-005: Schema $id and title are present and correct

## Open Questions

None.
