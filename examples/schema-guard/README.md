# Schema Guard

A governed open-source library example for AgentXchain.

`schema-guard` is a small schema-validation package for Node.js. It provides declarative schemas, nested object validation, path-aware error reporting, custom messages, composable validators, and TypeScript-friendly exports.

## What This Example Proves

- AgentXchain can govern a **publishable npm library**, not only apps and CLIs.
- The governed workflow includes **API review** and **release engineering** as explicit roles.
- The example ships real package code, declarations, tests, and category-specific planning artifacts for semver and distribution readiness.

## Run It

```bash
cd examples/schema-guard
npm test
npm run smoke
npm run pack:check
```

## Usage

```js
import { sg } from './src/index.js';

const userSchema = sg.object({
  id: sg.string({ pattern: /^usr_[a-z0-9]+$/ }),
  email: sg.string().refine((value) => value.includes('@'), 'email must contain @'),
  roles: sg.array(sg.enum(['admin', 'member']), { minLength: 1 }),
  profile: sg.object({
    displayName: sg.string({ minLength: 2 }),
    timezone: sg.string().optional(),
  }),
});

const result = userSchema.safeParse({
  id: 'usr_ax1',
  email: 'user@example.com',
  roles: ['member'],
  profile: { displayName: 'Agent User' },
});
```

## Public API

- `string`, `number`, `boolean`, `literal`, `enumValue`
- `array`, `object`, `union`, `optional`, `nullable`, `any`
- `sg` helper namespace
- `SchemaGuardError` and `formatIssues`

Composable schema instances support:

- `.optional()`
- `.nullable()`
- `.default(...)`
- `.refine(...)`
- `.transform(...)`
- `.pipe(...)`
- `.describe(...)`

## Governed Delivery Shape

- `pm` owns scope, non-goals, and acceptance bar
- `api_reviewer` freezes the exported surface and semver rules before implementation
- `library_engineer` implements the package and TypeScript-facing exports
- `qa` verifies nested validation, composition, error paths, and smoke scenarios
- `release_engineer` owns package metadata, export-map truth, and distribution readiness

The workflow routes through `planning -> api_review -> implementation -> qa -> release`, with explicit workflow-kit artifacts for public API review, compatibility policy, QA proof, and package readiness.

## Key Files

```text
schema-guard/
├── agentxchain.json
├── package.json
├── src/
├── test/
├── .planning/
└── .agentxchain/prompts/
```

## How AgentXchain Governed This Example

The product contract is defined in:

- `.planning/ROADMAP.md`
- `.planning/public-api.md`
- `.planning/compatibility-policy.md`
- `.planning/API_REVIEW.md`
- `.planning/IMPLEMENTATION_NOTES.md`
- `.planning/release-adoption.md`
- `.planning/package-readiness.md`
- `.planning/acceptance-matrix.md`

The governed config in `agentxchain.json` uses the `library` template plus a custom workflow-kit to prove that library delivery needs different review and release discipline than apps or CLIs.
