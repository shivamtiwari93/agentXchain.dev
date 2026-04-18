## Purpose

Freeze the public docs contract for explaining AgentXchain's three independent authority axes so operators can choose valid governed bindings before they run `agentxchain init`.

## Interface

- New public docs page: `website-v2/docs/authority-model.mdx`
- Sidebar placement under the Connectors section
- Cross-links from:
  - `website-v2/docs/runtime-matrix.mdx`
  - `website-v2/docs/integration-guide.mdx`
  - `website-v2/docs/integrations/index.mdx`
  - `website-v2/docs/integrations/claude-code.mdx`
  - `website-v2/docs/integrations/openai-codex-cli.mdx`
  - `website-v2/docs/integrations/cursor.mdx`
  - `website-v2/docs/integrations/vscode.mdx`
  - `website-v2/docs/integrations/windsurf.mdx`
  - `website-v2/docs/integrations/openclaw.mdx`
- Content-contract test: `cli/test/authority-model-content.test.js`

## Behavior

- Explain the three axes separately:
  - `write_authority`
  - runtime type
  - downstream CLI sandbox/approval mode
- Show which combinations are valid or invalid.
- State explicitly that `review_only + local_cli` is invalid.
- State explicitly that authoritative unattended Codex runs require `--dangerously-bypass-approvals-and-sandbox`, not merely `--full-auto`.
- State explicitly that authoritative unattended Claude Code runs require `--dangerously-skip-permissions`.
- Correct local CLI integration examples to use `write_authority`, not `authority`.
- Correct any touched examples that imply Cursor itself is a governed `local_cli` runtime.
- Correct any touched examples that show impossible `review_only + local_cli` bindings.

## Error Cases

- If the page exists but is not linked from runtime-facing docs, operators will still hit split-source-of-truth drift.
- If Codex docs keep recommending `--full-auto` for authoritative unattended runs, the docs remain materially misleading.
- If examples keep using `authority` instead of `write_authority`, operators may copy invalid config shapes.

## Acceptance Tests

- `authority-model.mdx` exists and is present in `website-v2/sidebars.ts`.
- The page documents all three axes and includes both Codex and Claude Code authority examples.
- The page explicitly distinguishes `codex --full-auto` from `--dangerously-bypass-approvals-and-sandbox`.
- Runtime Matrix and Integration Guide link to the authority-model page.
- The Claude Code, OpenAI Codex CLI, Cursor, VS Code, Windsurf, and OpenClaw docs link to the authority-model page.
- Touched local CLI docs use `write_authority` instead of `authority`.

## Open Questions

- Whether the remaining non-local integration guides should all link to the authority-model page directly, or whether the integrations index plus runtime matrix is sufficient for non-local surfaces.
