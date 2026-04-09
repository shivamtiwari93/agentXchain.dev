# Schema Guard — Product Example Spec

## Purpose

Prove AgentXchain can govern the development of a real **open-source validation library** end-to-end. This is the "open source library" category from the product-examples roadmap.

`schema-guard` is a small but non-trivial schema-validation package for Node.js applications. It provides a declarative schema DSL, nested object validation, composable validators, path-aware errors, and TypeScript-friendly package exports.

## Why This Domain

- It proves AgentXchain can govern a **publishable npm package**, not only apps and CLIs.
- It forces a **public API surface** that must stay stable across releases.
- It introduces **semver and compatibility discipline** as first-class workflow concerns.
- It requires **consumer-facing packaging truth**: exports, types, install/import smoke, and release-readiness.

## Project Structure

```text
examples/schema-guard/
├── agentxchain.json
├── package.json
├── README.md
├── TALK.md
├── src/
│   ├── index.js
│   ├── schema.js
│   └── index.d.ts
├── test/
│   ├── schema.test.js
│   ├── object.test.js
│   ├── composition.test.js
│   └── smoke.js
└── .planning/
    ├── ROADMAP.md
    ├── public-api.md
    ├── compatibility-policy.md
    ├── API_REVIEW.md
    ├── IMPLEMENTATION_NOTES.md
    ├── release-adoption.md
    ├── package-readiness.md
    ├── acceptance-matrix.md
    └── ship-verdict.md
```

## Governance Shape

**5 roles**:

| Role | Title | Mandate |
|------|-------|---------|
| `pm` | Product Manager | Freeze scope, consumer persona, acceptance bar, and non-goals |
| `api_reviewer` | API Reviewer | Challenge exported surface, error semantics, and semver traps |
| `library_engineer` | Library Engineer | Implement the package, tests, and TypeScript-facing exports |
| `qa` | QA Engineer | Prove nested validation, composition, error paths, and consumer smoke |
| `release_engineer` | Release Engineer | Own package metadata, export map, pack/install readiness, and adoption docs |

**5 phases**: `planning -> api_review -> implementation -> qa -> release`

This is intentionally different from the other examples:

- not a web app
- not a mobile app
- not a CLI
- not operations-heavy SaaS

The differentiator is public API review and release/package discipline.

## Behavior

### Schema DSL

- Define schemas for strings, numbers, booleans, literals, enums, arrays, objects, unions, nullable values, and optional values
- Compose validators via `.refine(...)`, `.transform(...)`, `.pipe(...)`, `.optional()`, `.nullable()`, and `.default(...)`

### Validation Behavior

- `parse(input)` returns typed data or throws a structured `SchemaGuardError`
- `safeParse(input)` returns `{ success: true, data }` or `{ success: false, issues }`
- Validation issues include path, error code, and message
- Nested object and array validation preserves accurate paths like `$.profile.email` or `$.items[2].price`

### Packaging Behavior

- Library is importable as an ESM package
- `package.json` includes an export map and `types` entry
- TypeScript-friendly declarations exist in `src/index.d.ts`
- `npm pack --dry-run` is a valid distribution-readiness smoke check

## Error Cases

- Wrong input types must fail with path-aware issues
- Unknown object keys must fail by default
- Invalid refinement functions must fail with explicit custom issues
- Union schemas must fail closed when no branch matches
- Missing required exports or type declarations is a release-readiness failure

## Acceptance Tests

1. `schema.test.js`: primitive schemas validate happy paths and reject invalid types
2. `schema.test.js`: `parse()` throws `SchemaGuardError` with issue metadata
3. `object.test.js`: nested objects surface accurate paths and reject unknown keys
4. `object.test.js`: defaults and optional fields behave predictably
5. `composition.test.js`: composable validators support refine, transform, pipe, and union
6. `composition.test.js`: custom messages override fallback text
7. `smoke.js`: library validates a realistic nested checkout or user payload end-to-end
8. `npm pack --dry-run`: package metadata and export map are distribution-ready
9. `agentxchain template validate --json`: library workflow-kit validates cleanly

## Library Proof Constraints

This example MUST prove it is a real library package:

1. `package.json` uses package exports and a `types` entry
2. `src/index.d.ts` exists and matches the public API
3. `.planning/public-api.md` defines the stable exports
4. `.planning/compatibility-policy.md` defines semver and deprecation rules
5. `.planning/API_REVIEW.md` explicitly challenges API shortcuts and semver traps
6. `.planning/package-readiness.md` covers pack/install/import smoke and release checks

## Open Questions

None. Governed provenance is handled at the repo level by commit history plus per-example `TALK.md`, not by shipping frozen `.agentxchain/history.jsonl` snapshots inside examples.
