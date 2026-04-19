# Cursor Integration Guide — Truthfulness Spec

**Status:** Shipped — guide published at `website-v2/docs/integrations/cursor.mdx`, invariants CUR-1..CUR-5 enforced.

## Purpose

Freeze the public boundary for the Cursor integration guide so the docs never claim capabilities the repo does not actually ship.

## Current State (2026-04-13)

- The repo contains **zero Cursor-specific adapter code** — grep of `cli/src` returns nothing.
- The `local_cli` adapter is generic. There is no Cursor-aware transport, auth, or model routing.
- The previous guide showed `cursor --cli` as a working command — this flag is **unverified** for agentic headless coding. Cursor's `cursor` CLI command exists for opening files and the editor, but `--cli` as an agentic subprocess mode is not a documented public surface.
- The guide simultaneously claimed CLI works and admitted "GUI agent mode" is stronger — incoherent framing.

## Truth Boundary

1. **AgentXchain does not ship a native Cursor connector.** The repo has no Cursor-specific adapter, auth, or transport code.
2. **Cursor is a GUI-first IDE.** Its strongest AI capabilities (Composer, Chat, agent mode) are in the GUI.
3. **Cursor has a CLI command** (`cursor`) for opening files and the editor, but `cursor --cli` for headless agentic coding is not a documented public surface.
4. **The supported path today** is to use Cursor as the editing environment while connecting a proven CLI agent (Claude Code, Codex CLI) for governed turns.
5. **Cursor's terminal** can run `agentxchain` commands normally.

## Invariants

- CUR-1: The guide must NOT show `cursor --cli` as a working agentic command in the primary config.
- CUR-2: The guide must state that AgentXchain does not currently ship a native Cursor connector.
- CUR-3: The primary documented path must be Cursor-as-editor + separate CLI agent runtime.
- CUR-4: If a speculative config is shown, it must be labeled as speculative.
- CUR-5: The index page entry for Cursor must not imply a direct adapter integration exists.

## Acceptance Tests

- [ ] `cursor.mdx` contains "does not currently ship a native Cursor connector" or equivalent
- [ ] `cursor.mdx` does NOT contain `cursor --cli` as an unqualified working command in primary config
- [ ] `cursor.mdx` primary config example uses a proven CLI agent
- [ ] `index.mdx` Cursor entry includes a qualifying note
- [ ] Test file guards all invariants
