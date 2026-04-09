# Schema Guard Roadmap

## Goal

Ship a reusable validation library that proves AgentXchain can govern a package with a public API, compatibility commitments, and release-readiness checks.

## Scope

1. Primitive schemas: string, number, boolean, literal, enum
2. Structural schemas: array, object, union
3. Composition: optional, nullable, default, refine, transform, pipe
4. Error model: path-aware issues plus thrown `SchemaGuardError`
5. Packaging: ESM export map, types entry, pack smoke, README usage

## Non-Goals

- JSON Schema import/export
- async validation
- browser bundle tooling
- deep type inference parity with larger libraries like Zod

## Delivery Checks

- Node test suite covers primitives, nested objects, and composition
- `npm pack --dry-run` proves packaging readiness
- `agentxchain template validate --json` proves governed workflow artifacts are complete
