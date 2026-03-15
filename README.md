# AgentXchain.dev — Open-source coordination framework

This repo is the **core** of AgentXchain: the protocol and tooling to run a **software development team inside your AI workspace** — working in a sequential, SDLC-like pipeline and iterating recursively in a prototyping loop to ship products. It is free to use (CLI, config, examples) and runs entirely in your environment.

**AgentXchain.ai** (the parent repo) is built on top of this: same protocol, plus a dashboard, UI configurability, and managed apps/integrations for Cursor, Claude Code, Codex, Antigravity, and VS Code.

---

## The problem AgentXchain solves

You need to **recreate a software development team inside your AI workspace**: multiple agents (e.g. PM, dev, QA) working **in sequence** like an SDLC pipeline, and going over that loop **recursively** in a prototyping manner to build and ship products. That kind of **multi-agent coordination** — a team working side by side, challenging each other, under real-world constraints — is not possible with MCP or A2A alone. AgentXchain fills that gap with a file-based, turn-based protocol and no central orchestrator.

---

## Philosophy: coordination, not orchestration

We aim for **multi-agent coordination**, not multi-agent orchestration:

- **No orchestrator** spawning sub-agents. The team works **side by side**: same workspace, shared state, explicit turn order.
- Agents **challenge each other** and are slightly divergent in perspective, but are **forced to converge** on a real product and release it in a time-bound way because of the protocol and constraints.
- That combination — **slight divergence + real-world pressure** — is the philosophy: we believe it leads to better software than a single orchestrator or uncoordinated agents.

---

## How AgentXchain differs from MCP and A2A

| | **MCP (Model Context Protocol)** | **A2A (Agent2Agent)** | **AgentXchain** |
|--|--|--|--|
| **Primary use** | Agent ↔ tools/data (servers, APIs) | Agent ↔ agent over the network (delegation, RPC) | **Team in a shared workspace**: multiple agents coordinating via shared files and turn order |
| **Model** | One agent, many tools | Many agents, message passing | **One “team”**: lock, state, roles, sequential turns, no central brain |
| **Fits** | “My agent can read docs and run scripts” | “My agent can call another agent’s API” | “My PM, dev, and QA agents work like a real team and ship a product” |

MCP and A2A don’t give you an **SDLC-style, recursive pipeline** in one workspace. AgentXchain does: same folder, `lock.json` / `state.json`, turn order, and roles so the “team” behaves like a software team, not a single agent or a loose mesh of services.

---

## Who this is for (.dev)

- **Hardcore engineers** who are already comfortable with the CLI, writing code, and AI-assisted development, and want to **augment** that with multi-agent coordination.
- Teams that want to **self-host** and own the protocol: full control, no hidden state, no vendor lock-in.
- Contributors who want to extend the protocol or add runners for other IDEs.

---

## What’s in this repo

- **Protocol and config.** Coordination is driven by JSON and docs: `lock.json`, `state.json`, roles, phases. The format is documented and stable; you can read, edit, and extend it.
- **CLI and scripts.** Commands for local use (e.g. init, check whose turn, run one agent loop). You drive the protocol from the terminal and your IDE; no dashboard required.
- **Examples.** The `examples/` folder has runnable examples (e.g. mood-tracking-app, and the original POC under `old/`). Use them to see the protocol in action and as a starting point.

**To use AgentXchain today:** clone this repo, follow the docs, run agents in Cursor (or another IDE) against the shared folder. No account or hosted service required.

---

## Where to go

- **Main example** (Protocol v2, Mood Tracking App): [examples/mood-tracking-app](examples/mood-tracking-app/).
- **Parent product** (dashboard, apps, cloud): the [AgentXchain.ai](../README.md) repo — built on this core for explorers and large teams.

---

## Relation to AgentXchain.ai

The **.ai** repo (parent of this folder) is the **hosted product**: dashboard, UI configurability, and automatic apps/integrations for Cursor, Claude Code, Codex, Antigravity, VS Code. Same protocol as here, but you install apps and use a cloud dashboard instead of the CLI. **.dev** is the open foundation: developer-first, full transparency, no lock-in. You can use .dev only, or use .ai when you want the managed experience.

<!-- Last doc update: README sync -->
