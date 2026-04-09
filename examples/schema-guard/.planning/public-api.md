# Public API — Schema Guard

## Supported Entrypoints

- Package name: `schema-guard`
- Import path: `import { ... } from 'schema-guard'`
- Stable export map: root package export only

## Consumer-Facing Surface

| Export / command | Consumer use case | Stability | Notes |
|------------------|-------------------|-----------|-------|
| `string(options)` | String validation with min/max/pattern checks | Stable | Supports custom messages |
| `number(options)` | Numeric validation with integer/min/max constraints | Stable | Finite numbers only |
| `boolean()` | Boolean validation | Stable | Simple primitive |
| `literal(value)` | Exact-value validation | Stable | Useful for discriminated unions |
| `enumValue(values)` | One-of validation for literal sets | Stable | Exposed as `sg.enum` too |
| `array(schema, options)` | Array validation with per-item parsing | Stable | Preserves item paths |
| `object(shape, options)` | Nested object validation | Stable | Rejects unknown keys by default |
| `union(schemas)` | Alternative schema branches | Stable | Fails closed when no branch matches |
| `optional(schema)` / `.optional()` | Optional values | Stable | Omits undefined keys from parsed objects |
| `nullable(schema)` / `.nullable()` | Nullable values | Stable | Preserves null explicitly |
| `any()` | Escape hatch | Stable | Use sparingly |
| `Schema#default` | Fill undefined with a default | Stable | Default value becomes parsed output |
| `Schema#refine` | Add domain-specific validation | Stable | Supports string or function messages |
| `Schema#transform` | Map parsed values | Stable | Transform failures become issues |
| `Schema#pipe` | Feed one schema into another | Stable | Useful after transforms |
| `SchemaGuardError` | Thrown error from `parse()` | Stable | Carries `issues` array |
| `formatIssues(issues)` | Human-readable error formatting | Stable | CLI/log friendly |
| `sg` | Namespace helper | Stable | Mirrors the named exports except `formatIssues` and `SchemaGuardError` |

## Breaking-Change Triggers

- Removing or renaming any exported function or method
- Changing issue shape (`path`, `code`, `message`)
- Changing default object behavior to allow unknown keys
- Changing default number behavior to allow `NaN` or `Infinity`
- Moving type declarations away from `src/index.d.ts`
