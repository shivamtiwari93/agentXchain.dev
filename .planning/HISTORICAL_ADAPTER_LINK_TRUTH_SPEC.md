# Historical Adapters Link Truth Spec

> Contract for historical docs pages that point readers at the live `/docs/adapters` alias.

## Purpose

Prevent historical docs pages from understating the current shipped adapter surface when they send readers to the live adapters reference. A historical page may describe its original release context, but if it points at `/docs/adapters`, the linked description must not freeze an older four-adapter subset and present it as current truth.

## Interface

Files under this contract:

- `website-v2/docs/releases/v2-24-0.mdx`
- `website-v2/docs/releases/v2-24-1.mdx`
- `website-v2/docs/adapters.mdx`
- `cli/test/release-docs-content.test.js`

## Behavior

1. Historical release notes may link to `/docs/adapters` for deeper runtime detail.
2. When they do, the surrounding prose must either:
   - use neutral current wording such as `all five shipped adapter paths`, or
   - explicitly name the full current adapter surface: `manual`, `local_cli`, `api_proxy`, `mcp`, `remote_agent`.
3. Historical pages must not describe the live adapters reference with stale subset wording such as `manual, local CLI, API-backed, and MCP paths`.
4. The live adapters reference remains the authority for the current shipped adapter boundary.

## Error Cases

- A historical release note links to `/docs/adapters` but still describes only four paths and omits `remote_agent`.
- A historical release note uses vague legacy wording like `API-backed` that collapses the current adapter boundary.
- The regression guard checks only the prose fix and not the contract, leaving the drift easy to reintroduce.

## Acceptance Tests

- `AT-HALT-001`: `v2-24-0.mdx` links to `/docs/adapters` using neutral current wording or the full five-adapter surface.
- `AT-HALT-002`: `v2-24-1.mdx` links to `/docs/adapters` using neutral current wording or the full five-adapter surface.
- `AT-HALT-003`: `cli/test/release-docs-content.test.js` rejects the stale `manual, local CLI, API-backed, and MCP paths` wording for both historical pages.

## Open Questions

None.
