# Implementation Notes

## Architecture

- `src/schema.js` owns the runtime schema primitives and composition helpers
- `src/index.js` is the stable export barrel
- `src/index.d.ts` mirrors the public runtime surface for TypeScript consumers

## Error Model

- Every issue includes `path`, `code`, and `message`
- `parse()` throws `SchemaGuardError` with the collected issues
- `safeParse()` returns a discriminated success/failure result instead of throwing

## Verification

- `node --test test/`
- `node test/smoke.js`
- `npm pack --dry-run`
