# Warp Comparison Claims Spec

## Purpose

Freeze the public claims made on `website-v2/docs/compare/vs-warp.mdx` against official Warp sources so the page reflects Warp's current Agentic Development Environment and Oz cloud-agent platform, not stale "AI terminal only" shorthand.

## Interface

Single comparison page: `website-v2/docs/compare/vs-warp.mdx`.

## Behavior

The public Warp comparison page must:

1. Describe Warp's current official framing as an Agentic Development Environment and Oz as the orchestration platform for cloud agents.
2. Acknowledge Warp Terminal and local Oz agents for interactive coding, debugging, command execution, planning, and codebase-aware workflows.
3. Acknowledge first-class support for third-party CLI agents including Claude Code, OpenAI Codex CLI, Gemini CLI, Amp, Droid, and OpenCode.
4. Acknowledge agent profiles and permissions: model choice, autonomy levels, code-diff approvals, file-read permissions, command execution permissions, Full Terminal Use permissions, MCP permissions, command allowlists, command denylists, and Run until completion.
5. Acknowledge Full Terminal Use for interactive terminal programs such as REPLs, servers, shells, editors, and debuggers.
6. Acknowledge Warp Drive as a reusable context surface for prompts, notebooks, workflows, rules, environment variables, and project-scoped `AGENTS.md`.
7. Acknowledge Codebase Context, including multi-repo context.
8. Acknowledge Oz CLI/API/SDK/web app, schedules, environments, secrets, Slack/Linear/GitHub/custom triggers, and Warp-hosted or self-hosted execution.
9. Keep the AgentXchain contrast on governed multi-role software delivery, mandatory challenge, phase gates, append-only decision history, and constitutional human authority.

## Source baseline

All claims checked against official Warp docs and product pages on 2026-04-25. Official source URLs are listed in the page's `Source baseline` section.

## Error Cases

- Do not describe Warp as only an "AI-native terminal"; the current official docs frame Warp as an Agentic Development Environment and Oz as the cloud-agent orchestration platform.
- Do not imply Warp lacks cloud agents, schedules, environments, integrations, API/SDK, session sharing, or observability.
- Do not imply AgentXchain replaces Warp as a terminal, coding environment, or Oz runtime.
- Do not claim Warp provides AgentXchain-style mandatory cross-role challenge, repo-native delivery phase gates, or append-only delivery ledgers unless official Warp docs introduce those semantics.
- Do not use undocumented Oz command examples; examples must match the official Oz CLI command shape.

## Acceptance Tests

- `AT-WARP-CLAIMS-001`: Page acknowledges Agentic Development Environment framing.
- `AT-WARP-CLAIMS-002`: Page acknowledges Oz cloud-agent orchestration.
- `AT-WARP-CLAIMS-003`: Page acknowledges third-party CLI agent support.
- `AT-WARP-CLAIMS-004`: Page acknowledges profiles, permissions, allowlists/denylists, and Run until completion.
- `AT-WARP-CLAIMS-005`: Page acknowledges Full Terminal Use.
- `AT-WARP-CLAIMS-006`: Page acknowledges Warp Drive and `AGENTS.md`.
- `AT-WARP-CLAIMS-007`: Page acknowledges Oz CLI/API/SDK/web app, schedules, environments, integrations, and self-hosted or Warp-hosted execution.
- `AT-WARP-CLAIMS-008`: Page contrasts with governed software delivery / governance protocol.
- `AT-WARP-CLAIMS-009`: Page exposes a source-baseline section with official source links and last-checked date.
- `AT-WARP-CLAIMS-010`: `.planning/COMPETITIVE_POSITIONING_MATRIX.md` includes a Warp row with 2026-04-25 source refresh.

## Decisions

- `DEC-WARP-COMPARE-ADE-OZ-BOUNDARY-001`: Public Warp comparison copy must treat "AI-native terminal" as an incomplete shorthand. Current official docs describe Warp as an Agentic Development Environment and Oz as the orchestration platform for cloud agents, so the comparison must lead with the Warp/Oz split.

## Open Questions

- Should a future page compare AgentXchain specifically against Oz Platform as a cloud-agent orchestration layer, separate from Warp Terminal?
