# Built-in GitHub Issues Plugin — Proof Spec

## Purpose

Prove that the built-in `github-issues` plugin works end-to-end through a real governed `agentxchain run` execution, producing externally verifiable artifacts on GitHub (issue comment + managed labels).

## Proof Boundary

This spec covers one coherent proof chain:

1. **Install**: short-name `agentxchain plugin install github-issues --config ...`
2. **Governed execution**: `agentxchain run --auto-approve` dispatches to Anthropic API
3. **External effect**: plugin hooks post a comment and sync labels on a real GitHub issue
4. **Verification**: `gh api` confirms the comment body and label set match the plugin contract

## Proof Surfaces

### Live proof script

`examples/governed-todo-app/run-github-issues-proof.mjs`

- Scaffolds a temp governed project (transformed governed-todo-app config, all api_proxy, review_only, empty gates)
- Installs `github-issues` by short name with `repo` and `issue_number` pointing to a dedicated proof issue on `shivamtiwari93/agentXchain.dev`
- Exports `GITHUB_TOKEN` from `gh auth token` or environment
- Runs `agentxchain run --auto-approve --max-turns 6`
- After run completes, verifies via GitHub API:
  - At least one comment on the issue contains the run marker `<!-- agentxchain:github-issues:run:{run_id} -->`
  - The comment body contains `after_acceptance` event data (run_id, phase, role_id)
  - The issue has at least the `agentxchain` label
  - The issue has at least one `agentxchain:phase:*` label
- Cleans up temp directory
- Supports `--json` mode for structured output

### Continuous subprocess proof

`cli/test/e2e-builtin-github-issues.test.js`

- Installs `github-issues` by short name into a temp governed project
- Runs a governed flow through the CLI with mock local runtimes (no real API needed)
- Verifies plugin hooks are invoked and produce `allow` or `warn` verdicts
- Does NOT hit real GitHub API (would require credentials in CI)

### Docs guard

`cli/test/builtin-plugin-docs-content.test.js` (extended)

- `plugin-github-issues.mdx` must name the live proof script
- `plugin-github-issues.mdx` must name the continuous subprocess proof
- Both README copies must name the built-in install path

## Config Shape

```json
{
  "repo": "shivamtiwari93/agentXchain.dev",
  "issue_number": <dedicated proof issue>,
  "token_env": "GITHUB_TOKEN"
}
```

## What This Is NOT

- Not a load test or rate-limit probe
- Not a test of GitHub Enterprise or custom `api_base_url`
- Not a test of `on_escalation` (would require a deliberately failing run; may add later)
- Not proof that the plugin works with non-GitHub token providers

## Acceptance Tests

- AT-GHI-PROOF-001: spec exists with required sections
- AT-GHI-PROOF-002: live proof script exists and references `agentxchain run`
- AT-GHI-PROOF-003: live proof verifies GitHub issue comment via API after run
- AT-GHI-PROOF-004: live proof verifies managed labels via API after run
- AT-GHI-PROOF-005: continuous subprocess proof installs plugin by short name
- AT-GHI-PROOF-006: continuous subprocess proof runs governed flow and verifies hook execution
- AT-GHI-PROOF-007: docs page names both proof surfaces
- AT-GHI-PROOF-008: README names built-in install path

## Open Questions

- Should the proof issue be a permanent fixture or created/closed per run? Decision: permanent fixture with upsert semantics (one comment per run, labels overwritten). This matches the plugin's own design.
