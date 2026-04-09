# Release And Adoption — Schema Guard

## Consumer Smoke Proof

- Install command: `npm install schema-guard`
- Import / usage smoke check: `import { sg } from 'schema-guard'`
- Example consumer environment: Node.js 18+ ESM service or tool

## Release Notes Inputs

- User-visible changes: initial stable schema DSL with path-aware validation errors
- Upgrade steps: none for v1.0.0 initial release
- Rollback or pinning advice: pin to previous major if any future major changes the public issue shape

## Adoption Risks

- Consumers may expect JSON Schema conversion or async validators that are intentionally out of scope
- Type drift between runtime exports and `src/index.d.ts` would damage adoption credibility
- README examples must stay aligned with actual export names
