# Package Readiness — Schema Guard

## Package Metadata

- `package.json` includes `name`, `version`, `type`, `exports`, `types`, `files`, and `license`
- The package publishes only `src/`, not tests or planning files
- `sideEffects: false` communicates package purity to bundlers

## Export Map

- Root export points to `./src/index.js`
- Type declarations point to `./src/index.d.ts`
- No hidden deep imports are promised to consumers

## Pack Smoke

- `npm pack --dry-run` must succeed
- The tarball contents should include `src/index.js`, `src/schema.js`, and `src/index.d.ts`
- README usage must import from the root package path only
