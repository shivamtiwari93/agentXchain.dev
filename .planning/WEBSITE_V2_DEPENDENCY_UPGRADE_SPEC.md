# Website-v2 Dependency Upgrade Spec — 2026-04-08

## Purpose

Eliminate all 18 high-severity `npm audit` findings in `website-v2` caused by `serialize-javascript <=7.0.4` in the Docusaurus dependency chain, plus 2 moderate findings in `cli` from `hono`/`@hono/node-server`.

## Root Cause

- **website-v2**: Docusaurus 3.9.2 depends on `@docusaurus/bundler` → `copy-webpack-plugin@11.0.0` / `css-minimizer-webpack-plugin@5.0.1` → `serialize-javascript@6.0.2`. The advisory covers `<=7.0.4` (RCE via RegExp.flags/Date.prototype.toISOString; CPU exhaustion via crafted array-like objects).
- **cli**: `hono <=4.12.11` (cookie validation, IP restriction bypass, path traversal) and `@hono/node-server <1.19.13` (middleware bypass).

## Fix Path

### website-v2
1. Upgrade Docusaurus from `3.9.2` → `3.10.0` (all 5 pinned packages).
2. Add `@docusaurus/faster@3.10.0` as a new explicit dependency (required by 3.10.0's bundler).
3. Add `overrides.serialize-javascript: "^7.0.5"` to force the patched version through the transitive chain, since `copy-webpack-plugin@11` and `css-minimizer-webpack-plugin@5` still pin `serialize-javascript@^6.0.0`.

### cli
1. `npm audit fix` — updates `hono` and `@hono/node-server` to patched versions. No breaking changes.

## Affected Packages

| Package | Before | After | Scope |
|---------|--------|-------|-------|
| `@docusaurus/core` | 3.9.2 | 3.10.0 | website-v2 |
| `@docusaurus/preset-classic` | 3.9.2 | 3.10.0 | website-v2 |
| `@docusaurus/module-type-aliases` | 3.9.2 | 3.10.0 | website-v2 (dev) |
| `@docusaurus/tsconfig` | 3.9.2 | 3.10.0 | website-v2 (dev) |
| `@docusaurus/types` | 3.9.2 | 3.10.0 | website-v2 (dev) |
| `@docusaurus/faster` | — | 3.10.0 | website-v2 (new) |
| `serialize-javascript` | 6.0.2 | 7.0.5 | website-v2 (override) |
| `hono` | <=4.12.11 | patched | cli |
| `@hono/node-server` | <1.19.13 | patched | cli |

## Acceptance Tests

1. `cd website-v2 && npm audit --omit=dev` → **0 vulnerabilities**
2. `cd cli && npm audit --omit=dev` → **0 vulnerabilities**
3. `cd website-v2 && npm run build` → **production build succeeds**
4. `cd cli && npm test` → **all tests pass, 0 failures**
5. `serialize-javascript` resolves to `>=7.0.5` in `npm ls serialize-javascript`

## Rollback Plan

Revert `package.json` changes and `npm install` to restore `3.9.2`. The override is additive and has no side effects on rollback.

## Residual Risk

- The `overrides` field is an npm-specific mechanism. If the project ever uses yarn or pnpm, equivalent resolution fields would need to be added.
- Docusaurus 3.10.0 is a minor release. Changelog reviewed: no breaking changes for our usage (static MDX pages, preset-classic, custom CSS, gtag plugin).
