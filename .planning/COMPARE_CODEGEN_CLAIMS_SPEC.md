# Codegen Comparison Claims Spec

## Purpose

Freeze the public claims made on `website-v2/docs/compare/vs-codegen.mdx` against official Codegen sources so stale, unsourced, or exaggerated claims are caught by regression tests.

## Docs path

`website-v2/docs/compare/vs-codegen.mdx`

## Source baseline

All claims checked against official Codegen docs on 2026-04-25. Official source URLs are listed in the page's `Source baseline` section.

## Behavior

### Required claim surfaces

The public Codegen comparison page must:

1. Acknowledge Codegen as a managed SaaS platform (acquired by ClickUp).
2. Describe Codegen's model configuration accurately: organization-level selection across Anthropic, OpenAI, Google, and Grok providers; custom API keys and base URLs; no documented automatic task-type routing.
3. Describe agent rules as a three-tier hierarchy (User > Repository > Organization) with auto-discovery of `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, etc.
4. Describe agent permissions accurately: PR creation, rules detection, signed commits enforcement.
5. Acknowledge sandbox capabilities: Docker-based isolation, remote VS Code editor, environment variables, secrets, web preview.
6. Acknowledge CI auto-fix: Check Suite Auto-fixer with up to 3 retries.
7. Acknowledge the full integration surface including ClickUp, MCP servers.
8. Acknowledge on-premises Kubernetes deployment for Enterprise.
9. Acknowledge Claude Code integration (cloud logging, MCP provisioning).
10. Acknowledge analytics dashboard.
11. Acknowledge Python SDK, CLI, and REST API.

### Source-back requirement (AT-CODEGEN-CLAIMS-005)

The public Codegen comparison page must include a `Source baseline` section with:
- A last-checked date (2026-04-25 or later).
- Official source links covering at minimum: overview, capabilities, triggering, agent rules, agent permissions, model configuration, sandboxes, integrations, security, and API.

### Claim boundary decisions

- `DEC-CODEGEN-COMPARE-MODEL-ROUTING-001`: Public Codegen comparison copy must not claim "smart model routing" unless official docs document automatic task-type-based routing. Current docs show manual organization-level model selection only. Use "configurable model selection" instead.
- `DEC-CODEGEN-COMPARE-CLI-EXAMPLES-001`: Public Codegen comparison examples must use documented CLI commands. The current documented command is `codegen agent create "task"`. Do not use undocumented commands like `codegen deploy` or `codegen assign`.

## Error Cases

- If official Codegen docs remove or rename a linked source, the frozen-link regression test will fail. Update the page and test with the new URL.
- If Codegen adds features our page doesn't cover, we can update the page but must not overclaim capabilities we haven't verified.

## Acceptance Tests

- `AT-CODEGEN-CLAIMS-001`: Page acknowledges managed SaaS platform model.
- `AT-CODEGEN-CLAIMS-002`: Page acknowledges sandboxed Docker execution.
- `AT-CODEGEN-CLAIMS-003`: Page acknowledges agent rules and permissions.
- `AT-CODEGEN-CLAIMS-004`: Page contrasts with governed software delivery / governance protocol.
- `AT-CODEGEN-CLAIMS-005`: Source baseline section exists with official source links and last-checked date.
- `AT-CODEGEN-CLAIMS-006`: Page does not use undocumented `codegen deploy` or `codegen assign` examples.
- `AT-CODEGEN-CLAIMS-007`: Page acknowledges ClickUp acquisition.
- `AT-CODEGEN-CLAIMS-008`: Page acknowledges on-premises deployment.
- `AT-CODEGEN-CLAIMS-009`: `.planning/COMPETITIVE_POSITIONING_MATRIX.md` includes a Codegen row with 2026-04-25 source refresh.

## Open Questions

- Should we evaluate the ClickUp acquisition's impact on Codegen's product direction and pricing model in a future refresh?
- Should the `codegen-SDK` open-source library be separately acknowledged on the comparison page?
