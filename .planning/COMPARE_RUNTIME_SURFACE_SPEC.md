# Spec: Comparison Surface Runtime Claims

## Purpose

Freeze the public comparison-surface contract for how AgentXchain's runtime surface is described. Comparison pages and long-form comparison docs may summarize the product, but they must not collapse the shipped connector/runtime surface into stale subsets or vague category laundry lists that under-report what AgentXchain supports today.

## Interface

- Files:
  - `website-v2/src/pages/compare/vs-autogen.mdx`
  - `website-v2/src/pages/compare/vs-openai-agents-sdk.mdx`
  - `website-v2/docs/compare-autogen.mdx`
  - `website-v2/src/pages/compare/vs-warp.mdx`
- Guard:
  - `cli/test/compare-runtime-surface.test.js`

## Behavior

- If a comparison page enumerates AgentXchain runtimes or adapters explicitly, it must name all five shipped adapter paths: `manual`, `local_cli`, `api_proxy`, `mcp`, and `remote_agent`.
- If a long-form comparison doc explains protocol portability or runtime participation concretely, it must either name the shipped adapters explicitly or use clearly open-ended wording. It must not replace the adapter contract with category laundry lists such as `Python, TypeScript, shell scripts, cloud APIs, IDE extensions`.
- If a comparison page summarizes the runtime surface without listing each adapter, it must use clearly open-ended wording such as `any agent runtime under protocol governance`; it must not imply a closed three-mode subset.
- Public compare pages must reject stale shorthand such as `manual, local CLI, API proxy` and `Manual, local CLI, and API-backed runtimes` because those phrases understate the actual shipped surface.

## Error Cases

- A page lists only `manual`, `local CLI`, and `API proxy` while omitting `mcp` and `remote_agent`.
- A page uses vague wording like `API-backed runtimes` that hides the full shipped adapter surface.
- A long-form doc substitutes platform categories for the adapter contract and implies that protocol portability is just a language or IDE story.
- Future compare pages add an explicit runtime list but leave out one of the five shipped adapters.

## Acceptance Tests

1. `AT-COMPARE-RUNTIME-001`: `vs-autogen.mdx` names all five shipped adapters and rejects the stale three-adapter wording.
2. `AT-COMPARE-RUNTIME-002`: `vs-openai-agents-sdk.mdx` names all five shipped adapters and rejects the stale `API-backed runtimes` phrasing.
3. `AT-COMPARE-RUNTIME-003`: `compare-autogen.mdx` explains protocol portability through the five shipped adapters and rejects the stale language/platform laundry list.
4. `AT-COMPARE-RUNTIME-004`: `vs-warp.mdx` names the five shipped adapters in the remote-execution row and rejects the vague `connector-based execution` wording.
5. `AT-COMPARE-RUNTIME-005`: `cd website-v2 && npm run build` succeeds after the comparison surfaces are updated.

## Open Questions

- If more comparison pages start enumerating adapters directly, this guard should expand to them instead of duplicating one-off assertions in multiple test files.
