# Compatibility Policy — Schema Guard

## Versioning Contract

- Semver policy: major for breaking API/issue-shape changes, minor for additive exports or options, patch for bug fixes and docs
- Supported runtime versions: Node.js 18+
- Supported environments: ESM-first Node.js packages and tools

## Deprecation And Migration

| Surface | Deprecation path | Migration guidance | Removal target |
|---------|------------------|--------------------|----------------|
| Export rename | Ship alias for one minor version first | Update import statements and README examples | Next major |
| Option rename | Support old + new option names in one minor version | Log the preferred option in docs/examples | Next major |
| Error-shape extension | Additive fields only in minor/patch | Consumers should read `path`, `code`, `message` as the stable minimum | N/A |

## Compatibility Risks

- Packaging / module-format risk if CommonJS support is implied but not implemented
- Consumer breakage if parsed-object behavior changes around unknown keys or default values
- Type drift risk if `src/index.d.ts` stops matching runtime exports
