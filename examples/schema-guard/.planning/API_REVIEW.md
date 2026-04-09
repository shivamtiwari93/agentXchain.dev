# API Review — Schema Guard

## Stable Exports

- Keep the root export map small and explicit
- Export named builders instead of a giant class hierarchy
- Preserve `SchemaGuardError` and `formatIssues` as first-class consumer tools
- Keep `sg` as a thin convenience namespace, not a second API surface with extra behavior

## Rejected Shortcuts

- Do not silently allow unknown object keys by default
- Do not return booleans from validation; return parsed data or structured issues
- Do not hide error paths inside free-form strings only
- Do not over-promise advanced TypeScript inference the runtime does not actually honor

## Semver Risks

- Changing `safeParse` result shape is breaking
- Changing object unknown-key defaults is breaking
- Changing thrown error type from `SchemaGuardError` is breaking
- Replacing `enumValue` with a different export name without an alias would be breaking
