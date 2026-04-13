# Windsurf Integration Guide — Truthfulness Spec

## Purpose

Freeze the public boundary for the Windsurf (Codeium) integration guide so the docs never claim capabilities the repo does not actually ship.

## Current State (2026-04-13)

- The repo contains **zero Windsurf-specific adapter code** — grep of `cli/src` returns nothing.
- The `local_cli` adapter is generic: it spawns any CLI command. There is no Windsurf-aware transport, auth, or model routing.
- The previous guide showed `windsurf --cli` as a command — this flag is **unverified**. Windsurf is a GUI-first IDE (VS Code fork by Codeium). There is no documented public headless CLI mode for agentic coding as of this writing.
- The guide was presenting a speculative `local_cli` config as a working integration.

## Truth Boundary

1. **AgentXchain does not ship a native Windsurf connector.** The repo has no Windsurf-specific adapter, auth, or transport code.
2. **Windsurf is a GUI-first IDE.** Its primary product surface is the desktop editor, not a headless CLI.
3. **The supported path today** is to use Windsurf as the editing environment while connecting a proven CLI agent (Claude Code, Codex CLI, or any `local_cli`/`api_proxy` runtime) for governed turns.
4. **If Windsurf ships a documented headless CLI** in the future, the generic `local_cli` adapter would support it. The guide should note this possibility without claiming it exists today.
5. **Windsurf's terminal** can be used to run `agentxchain` commands, similar to any IDE terminal. This is a valid but indirect usage pattern.

## Invariants

- WS-1: The guide must NOT show `windsurf --cli` or any unverified Windsurf CLI command in the primary config example.
- WS-2: The guide must state that AgentXchain does not currently ship a native Windsurf connector.
- WS-3: The primary documented path must be Windsurf-as-editor + separate CLI agent runtime.
- WS-4: If a speculative `local_cli` config is shown, it must be explicitly labeled as "if Windsurf adds CLI support" — not presented as a working config.
- WS-5: The index page entry for Windsurf must not imply a direct adapter integration exists.

## Acceptance Tests

- [ ] `windsurf.mdx` contains "does not currently ship a native Windsurf connector" or equivalent
- [ ] `windsurf.mdx` does NOT contain `windsurf --cli` as an unqualified working command
- [ ] `windsurf.mdx` primary config example uses a proven CLI agent (Claude Code, Codex, etc.)
- [ ] `index.mdx` Windsurf entry includes a qualifying note similar to the Jules entry
- [ ] Test file guards all four invariants
