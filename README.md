# agentxchain.dev — Open source core

This directory is the home for the **agentxchain.dev** offering: the open-source protocol and tooling that developers run locally and customize fully.

---

## Purpose

- **Expose the protocol and config.** All coordination is driven by JSON (and related config): `lock.json`, `state.json`, sequence, roles, phases. The format is documented and stable. Developers can read, edit, and extend these files and build their own tooling on top.
- **Full control.** No hidden state. You can change sequencing, add custom fields, define new roles, and integrate with your own scripts or IDEs. The core is the coordination model, not a black box.
- **CLI.** Commands for local use (e.g. init, check whose turn, run one agent loop) so you can drive the protocol from the terminal without a dashboard. Run the repo locally in any IDE; the "runner" is your machine and your agent sessions.
- **Run locally.** Clone from GitHub, follow the docs, run agents in Cursor (or another IDE) against the shared folder. No account or hosted service required.
- **Examples.** The `examples/` folder in this directory contains runnable examples (e.g. mood-tracking-app, and the original POC under `old/`). Use them to see the protocol in action and as a starting point for your own projects.

---

## Where to go

- **Full framework docs** (how to run agents, MCP/A2A comparison): this README and the links below; the framework root is **agentXchain.dev/**.
- **Main example** (Protocol v2, Mood Tracking App): [examples/mood-tracking-app](examples/mood-tracking-app/).

---

## Who it's for

- Developers who want to see and edit every part of the protocol.
- Teams that want to self-host and own their agent coordination.
- Contributors who want to extend the protocol or add runners for other IDEs.

---

## Relation to agentxchain.ai

The **.ai** folder (parent of this folder) is the hosted, dashboard-first experience: configure via UI, install in IDEs, managed state and integrations. The **.dev** core is the open foundation: same protocol, full transparency, no vendor lock-in. You can use .dev only, or use .ai when you want the managed experience.
